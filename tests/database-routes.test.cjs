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

void test("the Builder op route still runs the op a one-element array names, as it did before the inherited-name check", async () => {
  calls.mapResources = [];
  const controller = new routes.AIBuilderController();
  await controller.op(SIDECAR_TOKEN, { op: ["MapResources"], args: [{}] });
  assert.equal(calls.mapResources.length, 1);
});

void test("the Builder op route answers builder_unavailable, running nothing, to a request without arguments", async () => {
  calls.mapResources = [];
  const controller = new routes.AIBuilderController();
  const refused = await controller.op(SIDECAR_TOKEN, { op: "MapResources" });
  assert.ok(refused instanceof HTTPResult);
  assert.equal(refused.getStatus(), 409);
  assert.equal(
    JSON.parse(TextSchema.parse(refused.getBody())).error,
    "builder_unavailable",
  );
  assert.deepEqual(calls.mapResources, []);
});
