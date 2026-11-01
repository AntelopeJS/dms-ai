const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");

const dist = (file) => path.resolve(__dirname, "../dist", file);
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
  describe: [],
  mapResources: [],
  previewQuery: /** @type {unknown[]} */ ([]),
};

const catalog = {
  Info: async () => ({
    engine: "postgresql",
    version: "17.5",
    database: "erp",
    role: "reader",
  }),
  ListRelations: async () => [],
  DescribeRelations: async (relations) => {
    calls.describe.push(relations);
    return relations.map(() => ACCOUNTS);
  },
  Profile: async () => ({}),
  CheckReference: async () => ({ status: "ok", value: {} }),
};

function loadRoutes() {
  const decorator = () => () => undefined;
  const mocks = {
    "@antelopejs/interface-api": {
      HTTPResult,
      Controller: () => class {},
      Get: decorator,
      Post: decorator,
      Parameter: decorator,
      JSONBody: decorator,
    },
    "@antelopejs/interface-core": {
      GetResponsibleModule: () => context.module,
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
    [CATALOG_PATH]: catalog,
    "@antelopejs/interface-dms-builder": {
      MapResources: async (input) => {
        calls.mapResources.push({ input });
        return { ok: true, data: {}, changes: [] };
      },
      PreviewQuery: async (request) => {
        calls.previewQuery.push(request);
        return { ok: true, data: { body: { value: 3 } }, changes: [] };
      },
    },
    "../builder/presence": { isBuilderAvailable: async () => true },
    "../lifecycle/spawn-sidecar": { getSidecarToken: () => SIDECAR_TOKEN },
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    request in mocks ? mocks[request] : originalLoad(request, parent, isMain);
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(dist(""))) delete require.cache[file];
  }
  return {
    ...require(dist("routes/database.js")),
    ...require(dist("routes/builder.js")),
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
  assert.equal(missing.getStatus(), 404);
  assert.deepEqual(JSON.parse(missing.getBody()).known, ["erp"]);
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

void test("PreviewQuery reaches the Builder with the query and the route arguments, and answers its result", async () => {
  calls.previewQuery = [];
  const request = {
    query: {
      name: "revenue",
      resource: "order",
      template: "series",
      response: "card",
      compare: true,
    },
    args: { from: "2026-01-01", to: "2026-01-31" },
  };
  assert.deepEqual(
    await new routes.AIBuilderController().op(SIDECAR_TOKEN, {
      op: "PreviewQuery",
      args: [request],
    }),
    { ok: true, data: { body: { value: 3 } }, changes: [] },
  );
  assert.deepEqual(calls.previewQuery, [request]);
});
