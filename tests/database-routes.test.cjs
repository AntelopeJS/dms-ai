const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { z } = require("zod");
const { installRequireMocks } = require("./helpers/require-mocks.cjs");

const DIST_DIR = path.resolve(__dirname, "../dist");
const TextSchema = z.string();
const UnknownConnectionSchema = z.object({ known: z.array(z.string()) });
const SIDECAR_TOKEN = "sidecar-secret";
const CATALOG_PATH =
  "@ajs.connection/erp/@antelopejs/interface-database-catalog";
const ACCOUNTS = {
  schema: "sales",
  name: "accounts",
  kind: "table",
  key: { columns: ["id"], source: "primary" },
  writes: { insert: false, update: false, delete: false },
  columns: [],
  references: [],
  referencedBy: [],
  indexes: [],
};

/**
 * The async module context: dms-ai while its code is evaluated, and the module serving HTTP while
 * a request is handled, as the runtime runs them.
 */
const context = { module: "dms-ai" };

/** What the stand-in catalog and Builder were called with. */
const calls = {
  /** @type {string[][]} */
  describe: [],
  /** @type {{ input: unknown }[]} */
  mapResources: [],
  /** @type {string[]} */
  unlisted: [],
};

const catalog = {
  Info: async () => ({
    engine: "postgresql",
    version: "17.5",
    database: "erp",
    role: "reader",
  }),
  ListRelations: async () => [],
  /** @param {string[]} relations */
  DescribeRelations: async (relations) => {
    calls.describe.push(relations);
    return relations.map(() => ACCOUNTS);
  },
  Profile: async () => ({}),
  CheckReference: async () => ({ status: "ok", value: {} }),
};

function loadRoutes() {
  const decorator = () => () => undefined;
  /** @type {Map<string, unknown>} */
  const mocks = new Map([
    [
      "@antelopejs/interface-api",
      {
        HTTPResult,
        Controller: () => class {},
        Get: decorator,
        Post: decorator,
        Parameter: decorator,
        JSONBody: decorator,
      },
    ],
    [
      "@antelopejs/interface-core",
      {
        GetResponsibleModule: () => context.module,
        /**
         * @param {string} module
         * @param {() => unknown} callback
         */
        RunWithResponsibleModule: (module, callback) => {
          const previous = context.module;
          context.module = module;
          try {
            return callback();
          } finally {
            context.module = previous;
          }
        },
        GetInterfaceInstances: () =>
          context.module === "dms-ai"
            ? [{ id: "erp", path: CATALOG_PATH, provider: "postgres-erp" }]
            : [],
      },
    ],
    [CATALOG_PATH, catalog],
    [
      "@antelopejs/interface-dms-builder",
      {
        Operations: {
          /** @param {unknown} input */
          MapResources: async (input) => {
            calls.mapResources.push({ input });
            return { ok: true, data: {}, changes: [] };
          },
          PublishSite: async () => {
            calls.unlisted.push("PublishSite");
            return { ok: true, data: {}, changes: [] };
          },
          SetPageBlocks: async () => {
            calls.unlisted.push("SetPageBlocks");
            return { ok: true, data: {}, changes: [] };
          },
        },
      },
    ],
    ["../builder/presence", { isBuilderAvailable: async () => true }],
    ["../lifecycle/spawn-sidecar", { getSidecarToken: () => SIDECAR_TOKEN }],
  ]);
  installRequireMocks(mocks);
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(DIST_DIR)) delete require.cache[file];
  }
  return {
    ...require("../dist/routes/database.js"),
    ...require("../dist/routes/builder.js"),
  };
}

const routes = loadRoutes();
context.module = "api";

void test("database routes answer nothing to a caller without the sidecar's token", async () => {
  const controller = new routes.AIDatabaseController();
  const forbidden = await controller.relations("not-the-token", {
    connection: "erp",
  });
  assert.ok(forbidden instanceof HTTPResult);
  assert.equal(forbidden.getStatus(), 403);
});

void test("lists dms-ai's own connections while a request runs in the HTTP module's context", async () => {
  const controller = new routes.AIDatabaseController();
  const listed = await controller.connections(SIDECAR_TOKEN);
  assert.ok(!(listed instanceof HTTPResult));
  assert.deepEqual(
    listed.map((entry) => entry.connection),
    ["erp"],
  );
  assert.equal(context.module, "api");
});

void test("an unknown connection answers 404, naming the connections the project declares", async () => {
  const controller = new routes.AIDatabaseController();
  const missing = await controller.describe(SIDECAR_TOKEN, {
    connection: "crm",
    relations: ["a.b"],
  });
  assert.ok(missing instanceof HTTPResult);
  assert.equal(missing.getStatus(), 404);
  assert.deepEqual(
    UnknownConnectionSchema.parse(
      JSON.parse(TextSchema.parse(missing.getBody())),
    ).known,
    ["erp"],
  );
});

void test("MapResources reaches the Builder as the agent's choices, without dms-ai reading the catalog", async () => {
  calls.mapResources = [];
  calls.describe = [];
  const input = {
    module: "erp-tables",
    connection: "erp",
    resources: [
      {
        relation: "sales.accounts",
        tableView: true,
        writable: false,
        fields: [],
      },
    ],
  };
  const controller = new routes.AIBuilderController();
  await controller.op(SIDECAR_TOKEN, { op: "MapResources", args: [input] });
  assert.equal(calls.mapResources.length, 1);
  assert.deepEqual(calls.mapResources[0].input, input);
  assert.deepEqual(calls.describe, []);
});

for (const op of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  void test(`the Builder op route refuses the inherited name ${op} as an unknown op`, async () => {
    calls.mapResources = [];
    const controller = new routes.AIBuilderController();
    const refused = await controller.op(SIDECAR_TOKEN, { op, args: [] });
    assert.ok(refused instanceof HTTPResult);
    assert.equal(refused.getStatus(), 400);
    assert.deepEqual(JSON.parse(TextSchema.parse(refused.getBody())), {
      error: "unknown_op",
      op,
    });
    assert.deepEqual(calls.mapResources, []);
  });
}

void test("the Builder op route answers an unknown op in the bytes the sidecar reads", async () => {
  const controller = new routes.AIBuilderController();
  const bodies = [];
  for (const body of [{ op: "Nope", args: [] }, { args: [] }]) {
    const refused = await controller.op(SIDECAR_TOKEN, body);
    assert.ok(refused instanceof HTTPResult);
    bodies.push(refused.getBody());
  }
  assert.deepEqual(bodies, [
    '{"error":"unknown_op","op":"Nope"}',
    '{"error":"unknown_op"}',
  ]);
});

for (const op of ["PublishSite", "SetPageBlocks"]) {
  void test(`the Builder op route refuses ${op}, which the interface carries but dms-ai does not list`, async () => {
    calls.unlisted = [];
    const controller = new routes.AIBuilderController();
    const refused = await controller.op(SIDECAR_TOKEN, { op, args: [] });
    assert.ok(refused instanceof HTTPResult);
    assert.equal(refused.getStatus(), 400);
    assert.deepEqual(JSON.parse(TextSchema.parse(refused.getBody())), {
      error: "unknown_op",
      op,
    });
    assert.deepEqual(calls.unlisted, []);
  });
}

/** @type {{ label: string, op: unknown }[]} */
const MALFORMED_OPS = [
  { label: "an array holding a valid name", op: ["MapResources"] },
  { label: "a number", op: 7 },
  { label: "null", op: null },
  { label: "an object", op: { name: "MapResources" } },
];

for (const { label, op } of MALFORMED_OPS) {
  void test(`the Builder op route refuses ${label} as the op with a 400, running nothing`, async () => {
    calls.mapResources = [];
    const controller = new routes.AIBuilderController();
    const refused = await controller.op(SIDECAR_TOKEN, { op, args: [{}] });
    assert.ok(refused instanceof HTTPResult);
    assert.equal(refused.getStatus(), 400);
    assert.equal(
      JSON.parse(TextSchema.parse(refused.getBody())).error,
      "unknown_op",
    );
    assert.deepEqual(calls.mapResources, []);
  });
}

/** @type {{ label: string, args: unknown }[]} */
const MALFORMED_ARGS = [
  { label: "missing", args: undefined },
  { label: "null", args: null },
  { label: "an object", args: {} },
  { label: "a string", args: "[]" },
  { label: "a number", args: 0 },
];

for (const { label, args } of MALFORMED_ARGS) {
  void test(`the Builder op route refuses args that are ${label} with a 400, running nothing`, async () => {
    calls.mapResources = [];
    const controller = new routes.AIBuilderController();
    const refused = await controller.op(SIDECAR_TOKEN, {
      op: "MapResources",
      args,
    });
    assert.ok(refused instanceof HTTPResult);
    assert.equal(refused.getStatus(), 400);
    assert.deepEqual(JSON.parse(TextSchema.parse(refused.getBody())), {
      error: "invalid_args",
      op: "MapResources",
    });
    assert.deepEqual(calls.mapResources, []);
  });
}

void test("the Builder op route refuses a request without a body with a 400", async () => {
  const controller = new routes.AIBuilderController();
  const refused = await controller.op(SIDECAR_TOKEN);
  assert.ok(refused instanceof HTTPResult);
  assert.equal(refused.getStatus(), 400);
});
