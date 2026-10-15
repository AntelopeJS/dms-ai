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

/** What the stand-in catalog and Builder were called with. */
const calls = { describe: [], mapResources: [] };

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
      GetInterfaceInstances: () => [
        { id: "erp", path: CATALOG_PATH, provider: "postgres-erp" },
      ],
    },
    [CATALOG_PATH]: catalog,
    "@antelopejs/interface-dms-builder": {
      MapResources: async (input, descriptions) => {
        calls.mapResources.push({ input, descriptions });
        return { ok: true, data: {}, changes: [] };
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

void test("database routes answer nothing to a caller without the sidecar's token", async () => {
  const controller = new routes.AIDatabaseController();
  const forbidden = await controller.relations("not-the-token", {
    connection: "erp",
  });
  assert.ok(forbidden instanceof HTTPResult);
  assert.equal(forbidden.getStatus(), 403);
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

void test("MapResources reaches the Builder with the catalog's descriptions, never the caller's", async () => {
  calls.mapResources = [];
  const forged = {
    schema: "sales",
    name: "accounts",
    key: null,
    columns: [{ name: "password" }],
  };
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
  await controller.op(SIDECAR_TOKEN, {
    op: "MapResources",
    args: [input, [forged]],
  });
  assert.equal(calls.mapResources.length, 1);
  assert.deepEqual(calls.mapResources[0].input, input);
  assert.deepEqual(calls.mapResources[0].descriptions, [ACCOUNTS]);
});
