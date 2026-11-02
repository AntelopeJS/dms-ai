const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { installRequireMocks } = require("./helpers/require-mocks.cjs");

const DIST_DIR = path.resolve(__dirname, "../dist");
const FULL_PATH = "@ajs.connection/erp/@antelopejs/interface-database-catalog";
const PARTIAL_PATH =
  "@ajs.connection/legacy/@antelopejs/interface-database-catalog";

const full = {
  Info: async () => ({}),
  ListRelations: async () => [],
  DescribeRelations: async () => [],
  Profile: async () => ({}),
  CheckReference: async () => ({}),
};
const partial = { Info: async () => ({}), ListRelations: "not a function" };
const defective = Object.fromEntries(
  Object.keys(full).flatMap((name) => {
    const without = Object.fromEntries(
      Object.entries(full).filter(([key]) => key !== name),
    );
    return [
      [`lacks-${name}`, without],
      [`breaks-${name}`, { ...without, [name]: "not a function" }],
    ];
  }),
);
const defectivePath = (id) =>
  `@ajs.connection/${id}/@antelopejs/interface-database-catalog`;

function loadCatalog() {
  installRequireMocks(
    new Map([
      [
        "@antelopejs/interface-core",
        {
          GetResponsibleModule: () => "dms-ai",
          /** @param {string} _module @param {() => unknown} callback */
          RunWithResponsibleModule: (_module, callback) => callback(),
          GetInterfaceInstances: () => [
            { id: "erp", path: FULL_PATH, selected: true },
            { id: "legacy", path: PARTIAL_PATH, selected: false },
            ...Object.keys(defective).map((id) => ({
              id,
              path: defectivePath(id),
              selected: false,
            })),
          ],
        },
      ],
      [FULL_PATH, full],
      [PARTIAL_PATH, partial],
      ...Object.entries(defective).map(([id, module]) => [
        defectivePath(id),
        module,
      ]),
    ]),
  );
  for (const file of Object.keys(require.cache)) {
    if (file.startsWith(DIST_DIR)) delete require.cache[file];
  }
  return require("../dist/database/catalog.js");
}

const catalog = loadCatalog();

void test("a declared connection answers the catalog its provider loaded", () => {
  assert.equal(catalog.catalogOf("erp"), full);
});

void test("a connection whose module lacks a catalog function is refused by name", () => {
  assert.throws(() => catalog.catalogOf("legacy"), {
    name: "TypeError",
    message:
      "Catalog connection legacy does not answer the interface-database-catalog functions",
  });
});

for (const id of Object.keys(defective)) {
  void test(`connection ${id} is refused by name`, () => {
    assert.throws(() => catalog.catalogOf(id), {
      name: "TypeError",
      message: `Catalog connection ${id} does not answer the interface-database-catalog functions`,
    });
  });
}

void test("an undeclared connection answers nothing", () => {
  assert.equal(catalog.catalogOf("crm"), undefined);
});
