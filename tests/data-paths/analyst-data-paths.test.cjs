const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { z } = require("zod");
const {
  actorFrames,
  analyst,
  grantFor,
  openEvents,
  stopSidecar,
  waitForLock,
  waitUntilRefused,
} = require("./helpers/assistant.cjs");
const {
  addSales,
  call,
  createRole,
  inviteMember,
  onboardOwner,
  ownerInNewTenant,
} = require("./helpers/dms.cjs");

const PAGE_ID = "dms-ai-test-sales";
const TABLE_PERMISSION = `${PAGE_ID}.content`;
const LIST_PERMISSION = `${TABLE_PERMISSION}.list`;
const ASSISTANT = "ai.assistant";
const READER_PERMISSIONS = [
  ASSISTANT,
  PAGE_ID,
  TABLE_PERMISSION,
  LIST_PERMISSION,
];
const TENANT_B = "tenant-b";
const SALES_A = [
  { label: "A-north", amount: 120, costPrice: 70 },
  { label: "A-south", amount: 80, costPrice: 50 },
];
const SALES_B = [{ label: "B-east", amount: 999, costPrice: 1 }];
const LABELS_A = SALES_A.map((sale) => sale.label).sort();
const LABELS_B = SALES_B.map((sale) => sale.label).sort();
const LISTED_FIELDS = ["_id", "amount", "label"];
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const SEED_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 20_000;

const PagesAnswer = z.object({
  pages: z.array(z.object({ path: z.string() })),
});
const TablesAnswer = z.object({
  tables: z.array(
    z.object({
      id: z.string(),
      columns: z.array(z.object({ field: z.string() })),
    }),
  ),
});
const SaleRow = z.looseObject({ _id: z.string(), label: z.string() });
const RowsAnswer = z.object({ rows: z.array(SaleRow), total: z.number() });
const ListAnswer = z.object({ results: z.array(z.looseObject({})) });
const ToolAnswer = z.object({
  content: z.tuple([z.object({ text: z.string() })]),
  isError: z.boolean().optional(),
});
const BuiltTools = z.array(
  z.object({
    name: z.string(),
    handler: z.function({
      input: [z.record(z.string(), z.string())],
      output: z.promise(ToolAnswer),
    }),
  }),
);
const BuiltClient = z.object({
  get: z.function({
    input: [z.string(), z.instanceof(URLSearchParams), z.string()],
    output: z.promise(z.json()),
  }),
});
const LoadSummary = z.looseObject({
  rowCount: z.number(),
  isPartial: z.boolean(),
});
const Computed = z.object({ result: z.json() });
const API_BASE_URL_ENV = "DMS_AI_TEST_API_BASE_URL";
const SIDECAR_DIST = path.join(__dirname, "..", "..", "sidecar", "dist");

/** @typedef {import("./helpers/dms.cjs").Session} Session */

/** @type {Map<string, Session>} */
const people = new Map();
/** @type {Array<() => void>} */
const openStreams = [];

/**
 * @param {string} name
 * @returns {Session}
 */
function person(name) {
  const found = people.get(name);
  assert.ok(found, `nobody seeded as ${name}`);
  return found;
}

/**
 * Opens an event stream as the named user and returns the grant it carried.
 *
 * @param {string} name
 */
async function openGrant(name) {
  const opened = await grantFor(person(name));
  openStreams.push(opened.close);
  return opened;
}

/**
 * @param {string} grant
 * @returns {Promise<{ page: string, tables: z.infer<typeof TablesAnswer>["tables"] }>}
 */
async function salesTables(grant) {
  const pages = await analyst("pages", PagesAnswer, { grant });
  assert.equal(pages.status, HTTP_OK, pages.text);
  const page = pages.body?.pages.find((p) => p.path.includes(PAGE_ID));
  assert.ok(page, `the sales page is not readable: ${pages.text}`);
  const query = new URLSearchParams({ page: page.path });
  const tables = await analyst("tables", TablesAnswer, { grant, query });
  assert.ok(tables.body, tables.text);
  return { page: page.path, tables: tables.body.tables };
}

/**
 * @param {string} grant
 * @param {string} page
 * @param {string} table
 */
function rowsOf(grant, page, table) {
  const query = new URLSearchParams({ page, table, limit: "100" });
  return analyst("rows", RowsAnswer, { grant, query });
}

/**
 * @param {string} grant
 * @returns {Promise<string[]>}
 */
async function readLabels(grant) {
  const { page, tables } = await salesTables(grant);
  assert.equal(tables.length, 1);
  const rows = await rowsOf(grant, page, tables[0]?.id ?? "");
  assert.ok(rows.body, rows.text);
  return rows.body.rows.map((row) => row.label).sort();
}

async function seedTenantA() {
  const owner = await onboardOwner("owner@data-paths.test");
  const readers = await createRole(owner, "Readers", READER_PERMISSIONS);
  const pageOnly = await createRole(owner, "Page only", [ASSISTANT, PAGE_ID]);
  const noAssistant = await createRole(owner, "No assistant", [
    PAGE_ID,
    TABLE_PERMISSION,
    LIST_PERMISSION,
  ]);
  people.set("ownerA", owner);
  people.set(
    "readerA",
    await inviteMember(owner, "reader-a@data-paths.test", readers),
  );
  people.set(
    "pageOnlyA",
    await inviteMember(owner, "page-only@data-paths.test", pageOnly),
  );
  people.set(
    "noAssistantA",
    await inviteMember(owner, "no-assistant@data-paths.test", noAssistant),
  );
  await addSales(owner, SALES_A);
  return owner;
}

/** @param {Session} ownerA */
async function seedTenantB(ownerA) {
  const owner = await ownerInNewTenant(ownerA, TENANT_B);
  const readers = await createRole(owner, "Readers", READER_PERMISSIONS);
  people.set("ownerB", owner);
  people.set(
    "readerB",
    await inviteMember(owner, "reader-b@data-paths.test", readers),
  );
  await addSales(owner, SALES_B);
}

before(async function () {
  this.timeout(SEED_TIMEOUT_MS);
  await waitForLock();
  await seedTenantB(await seedTenantA());
});

after(() => {
  for (const close of openStreams) close();
  stopSidecar();
});

describe("[data paths] Analyst serves a user what their role lets them read", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("serves the owner the page, its table and every row of their tenant", async () => {
    const { grant, actor } = await openGrant("ownerA");
    assert.equal(actor.isOwner, true);
    const { page, tables } = await salesTables(grant);
    assert.deepEqual(
      tables.map((table) => table.columns.map((column) => column.field)),
      [["label", "amount"]],
    );
    const rows = await rowsOf(grant, page, tables[0]?.id ?? "");
    assert.ok(rows.body, rows.text);
    assert.equal(rows.body.total, SALES_A.length);
    assert.deepEqual(rows.body.rows.map((row) => row.label).sort(), LABELS_A);
  });

  it("gives a user whose role grants the page but not the table's list no table and no rows", async () => {
    const { grant } = await openGrant("pageOnlyA");
    const { page, tables } = await salesTables(grant);
    assert.deepEqual(tables, []);
    const rows = await rowsOf(grant, page, "content");
    assert.notEqual(rows.status, HTTP_OK);
    assert.equal(rows.body, undefined);
    assert.doesNotMatch(rows.text, /A-north|A-south/);
  });

  it("refuses the event stream, and so any grant, to a user without the assistant permission", async () => {
    const outsider = person("noAssistantA");
    const before = await actorFrames();
    const stream = await openEvents(outsider);
    stream.close();
    assert.equal(stream.status, HTTP_FORBIDDEN);
    const after = await actorFrames();
    assert.equal(after.length, before.length);
    assert.ok(after.every((frame) => frame.userId !== outsider.userId));
  });
});

describe("[data paths] Analyst keeps each tenant's rows to that tenant", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("shows a tenant A reader tenant A's rows only", async () => {
    const { grant, actor } = await openGrant("readerA");
    assert.equal(actor.isOwner, false);
    assert.deepEqual(await readLabels(grant), LABELS_A);
  });

  it("shows a tenant B reader tenant B's rows only", async () => {
    const { grant } = await openGrant("readerB");
    assert.deepEqual(await readLabels(grant), LABELS_B);
  });

  it("shows the owner acting in tenant B tenant B's rows only", async () => {
    const { grant, actor } = await openGrant("ownerB");
    assert.equal(actor.tenantId, TENANT_B);
    assert.deepEqual(await readLabels(grant), LABELS_B);
  });
});

describe("[data paths] Analyst reads nothing without a live grant", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("reads nothing with the sidecar token alone, a made-up grant, or another sidecar's token", async () => {
    const { grant } = await openGrant("ownerA");
    const noGrant = await analyst("pages", PagesAnswer);
    assert.equal(noGrant.status, HTTP_UNAUTHORIZED);
    const madeUp = await analyst("pages", PagesAnswer, {
      grant: "0".repeat(grant.length),
    });
    assert.equal(madeUp.status, HTTP_UNAUTHORIZED);
    const wrongToken = await analyst("pages", PagesAnswer, {
      grant,
      token: "not-the-token",
    });
    assert.equal(wrongToken.status, HTTP_FORBIDDEN);
  });

  it("stops honouring a grant once its event stream is closed", async () => {
    const { grant, close } = await grantFor(person("readerA"));
    const live = await analyst("pages", PagesAnswer, { grant });
    assert.equal(live.status, HTTP_OK);
    close();
    const refused = await waitUntilRefused(() =>
      analyst("pages", PagesAnswer, { grant }),
    );
    assert.equal(refused.status, HTTP_UNAUTHORIZED);
  });
});

describe("[data paths] Analyst rows carry the listed columns only", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("leaves out a field the DMS lists but the table view shows no column for", async () => {
    const direct = await call(
      "/api/dms-ai-test/sales/list?limit=100",
      ListAnswer,
      {
        token: person("ownerA").token,
      },
    );
    assert.ok(direct.body, direct.text);
    assert.ok(direct.body.results.every((row) => "costPrice" in row));

    const { grant } = await openGrant("ownerA");
    const { page, tables } = await salesTables(grant);
    const rows = await rowsOf(grant, page, tables[0]?.id ?? "");
    assert.ok(rows.body, rows.text);
    assert.equal(rows.body.rows.length, SALES_A.length);
    for (const row of rows.body.rows) {
      assert.deepEqual(Object.keys(row).sort(), LISTED_FIELDS);
    }
  });
});

/**
 * The built sidecar's Analyst tools, reading the real backend with the
 * stand-in sidecar's token and the grant given.
 *
 * @param {string} grant
 */
async function builtAnalystTools(grant) {
  /** @param {string} file */
  const load = (file) =>
    import(pathToFileURL(path.join(SIDECAR_DIST, file)).href);
  const lock = await waitForLock();
  const tools = BuiltTools.parse(
    (await load("mcp/tools/analyst.js")).buildAnalystTools({
      analystClient: BuiltClient.parse(
        (await load("analyst/analyst-client.js")).createAnalystClient({
          backendBaseUrl: process.env[API_BASE_URL_ENV],
          token: lock.token,
        }),
      ),
      currentGrant: () => grant,
    }),
  );
  /**
   * @param {string} name
   * @param {Record<string, string>} args
   */
  return async (name, args) => {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `the built sidecar has no ${name}`);
    const answer = await tool.handler(args);
    const [content] = answer.content;
    return {
      isError: answer.isError === true,
      text: content.text,
      body: z.json().parse(JSON.parse(content.text)),
    };
  };
}

describe("[data paths] the built sidecar's Analyst computes over the rows it loads", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("loads the owner's rows and groups them in the sandbox", async () => {
    const { grant } = await openGrant("ownerA");
    const { page, tables } = await salesTables(grant);
    const run = await builtAnalystTools(grant);
    const loaded = await run("AnalystLoad", {
      name: "sales",
      page,
      table: tables[0]?.id ?? "",
    });
    assert.equal(loaded.isError, false, loaded.text);
    const summary = LoadSummary.parse(loaded.body);
    assert.equal(summary.rowCount, SALES_A.length);
    assert.equal(summary.isPartial, false);
    const computed = await run("AnalystCompute", {
      code: `const byLabel = {};
        for (const sale of sales) byLabel[sale.label] = sale.amount;
        return { byLabel, total: sales.reduce((sum, sale) => sum + sale.amount, 0) };`,
    });
    assert.equal(computed.isError, false, computed.text);
    assert.deepEqual(Computed.parse(computed.body).result, {
      byLabel: Object.fromEntries(SALES_A.map((s) => [s.label, s.amount])),
      total: SALES_A.reduce((sum, sale) => sum + sale.amount, 0),
    });
  });

  it("loads nothing for a user whose role does not list the table", async () => {
    const { grant } = await openGrant("pageOnlyA");
    const { page } = await salesTables(grant);
    const run = await builtAnalystTools(grant);
    const loaded = await run("AnalystLoad", {
      name: "sales",
      page,
      table: "content",
    });
    assert.equal(loaded.isError, true);
    assert.doesNotMatch(loaded.text, /A-north|A-south/);
    const seen = await run("AnalystCompute", {
      code: "return Object.keys(datasets)",
    });
    assert.deepEqual(Computed.parse(seen.body).result, []);
  });
});
