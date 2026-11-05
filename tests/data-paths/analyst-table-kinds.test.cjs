const assert = require("node:assert/strict");
const { z } = require("zod");
const { analyst } = require("./helpers/assistant.cjs");
const { call, createRole, inviteMember } = require("./helpers/dms.cjs");
const {
  ASSISTANT,
  SALES_PAGE_ID,
  addPerson,
  openGrant,
  person,
  seedPeople,
} = require("./helpers/people.cjs");

const LEDGER_PAGE_ID = "dms-ai-test-ledger";
const LEDGER_TABLE_PERMISSION = `${LEDGER_PAGE_ID}.content`;
const LEDGER_ROUTE = "/api/dms-ai-test/ledger";
const FEED_PAGE_ID = "dms-ai-test-feed";
const FEED_REQUESTS = "/api/dms-ai-test/feed/requests";
const ACTIVE = ["L-open", "L-paid"];
const ARCHIVED = ["L-old"];
const FEED_FIELDS = ["_id", "amount", "kind"];
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const SEED_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 20_000;

const PagesAnswer = z.object({
  pages: z.array(z.object({ path: z.string() })),
});
const Column = z.object({
  field: z.string(),
  sortable: z.boolean(),
  filterModes: z.array(z.string()),
});
const TablesAnswer = z.object({
  tables: z.array(
    z.looseObject({
      id: z.string(),
      searchable: z.boolean(),
      columns: z.array(Column),
      hasArchive: z.boolean(),
      canViewArchived: z.boolean().optional(),
    }),
  ),
});
const Row = z.looseObject({ _id: z.string() });
const RowsAnswer = z.object({ rows: z.array(Row), total: z.number() });
const Refusal = z.object({ error: z.string(), detail: z.string().optional() });
const ListAnswer = z.object({
  results: z.array(z.object({ _id: z.string(), label: z.string() })),
});
const FeedRequests = z.object({ queries: z.array(z.string()) });

/** @type {Map<string, Promise<string>>} */
const grants = new Map();

/**
 * One grant per user for the whole file: the backend caps a user's streams.
 *
 * @param {string} name
 * @returns {Promise<string>}
 */
function grantOf(name) {
  let grant = grants.get(name);
  if (grant === undefined) {
    grant = openGrant(name).then((opened) => opened.grant);
    grants.set(name, grant);
  }
  return grant;
}

/**
 * @param {string} grant
 * @param {string} pageId
 */
async function tablesOf(grant, pageId) {
  const pages = await analyst("pages", PagesAnswer, { grant });
  const page = pages.body?.pages.find((p) => p.path.includes(pageId));
  assert.ok(page, `${pageId} is not readable: ${pages.text}`);
  const query = new URLSearchParams({ page: page.path });
  const tables = await analyst("tables", TablesAnswer, { grant, query });
  assert.ok(tables.body, tables.text);
  const [table] = tables.body.tables;
  assert.ok(table, tables.text);
  return { page: page.path, table };
}

/**
 * @param {string} grant
 * @param {string} pageId
 * @param {Record<string, string>} [params]
 */
async function rowsOf(grant, pageId, params = {}) {
  const { page, table } = await tablesOf(grant, pageId);
  const query = new URLSearchParams({ page, table: table.id, ...params });
  const rows = await analyst("rows", RowsAnswer, { grant, query });
  const refusal = Refusal.safeParse(JSON.parse(rows.text));
  return { ...rows, refusal: refusal.success ? refusal.data : undefined };
}

/**
 * @param {Awaited<ReturnType<typeof rowsOf>>} rows
 * @param {string} field
 */
function valuesOf(rows, field) {
  assert.ok(rows.body, rows.text);
  return rows.body.rows.map((row) => String(row[field])).sort();
}

/**
 * @param {Awaited<ReturnType<typeof rowsOf>>} rows
 * @param {number} status
 * @param {string} error
 */
function assertRefused(rows, status, error) {
  assert.equal(rows.status, status, rows.text);
  assert.equal(rows.refusal?.error, error, rows.text);
}

async function seedLedger() {
  const owner = person("ownerA");
  const role = await createRole(owner, "Ledger readers", [
    ASSISTANT,
    LEDGER_PAGE_ID,
    LEDGER_TABLE_PERMISSION,
    `${LEDGER_TABLE_PERMISSION}.list`,
  ]);
  addPerson(
    "ledgerReaderA",
    await inviteMember(owner, "ledger-reader@data-paths.test", role),
  );
  const options = { method: "POST", token: owner.token };
  for (const label of [...ACTIVE, ...ARCHIVED]) {
    const added = await call(`${LEDGER_ROUTE}/new`, z.unknown(), {
      ...options,
      body: { label },
    });
    assert.equal(added.status, HTTP_OK, added.text);
  }
  const listed = await call(`${LEDGER_ROUTE}/list?limit=100`, ListAnswer, {
    token: owner.token,
  });
  assert.ok(listed.body, listed.text);
  for (const row of listed.body.results) {
    if (!ARCHIVED.includes(row.label)) continue;
    const archived = await call(
      `${LEDGER_ROUTE}/archive?ids=${row._id}`,
      z.unknown(),
      { method: "PUT", token: owner.token },
    );
    assert.equal(archived.status, HTTP_OK, archived.text);
  }
}

before(async function () {
  this.timeout(SEED_TIMEOUT_MS);
  await seedPeople();
  await seedLedger();
});

describe("[data paths] Analyst reads a table in archive mode one side at a time", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("lists the owner the active rows by default and the archived ones when asked, though the list route alone mixes them", async () => {
    const direct = await call(`${LEDGER_ROUTE}/list?limit=100`, ListAnswer, {
      token: person("ownerA").token,
    });
    assert.ok(direct.body, direct.text);
    assert.deepEqual(
      direct.body.results.map((row) => row.label).sort(),
      [...ACTIVE, ...ARCHIVED].sort(),
    );

    const grant = await grantOf("ownerA");
    const { table } = await tablesOf(grant, LEDGER_PAGE_ID);
    assert.equal(table.hasArchive, true);
    assert.equal(table.canViewArchived, true);
    const active = await rowsOf(grant, LEDGER_PAGE_ID);
    assert.deepEqual(valuesOf(active, "label"), ACTIVE);
    assert.equal(active.body?.total, ACTIVE.length);
    const explicit = await rowsOf(grant, LEDGER_PAGE_ID, {
      archived: "active",
    });
    assert.deepEqual(valuesOf(explicit, "label"), ACTIVE);
    const archived = await rowsOf(grant, LEDGER_PAGE_ID, {
      archived: "archived",
    });
    assert.deepEqual(valuesOf(archived, "label"), ARCHIVED);
    assert.equal(archived.body?.total, ARCHIVED.length);
  });

  it("gives a role that lists the table but may not view its archive the active rows and refuses the archived ones", async () => {
    const grant = await grantOf("ledgerReaderA");
    const { table } = await tablesOf(grant, LEDGER_PAGE_ID);
    assert.equal(table.hasArchive, true);
    assert.equal(table.canViewArchived, false);
    assert.deepEqual(
      valuesOf(await rowsOf(grant, LEDGER_PAGE_ID), "label"),
      ACTIVE,
    );
    const refused = await rowsOf(grant, LEDGER_PAGE_ID, {
      archived: "archived",
    });
    assertRefused(refused, HTTP_FORBIDDEN, "archive_forbidden");
    assert.doesNotMatch(refused.text, /L-old/);
  });

  it("refuses archived rows of a table that has no archive, and reads its rows as active", async () => {
    const grant = await grantOf("ownerA");
    const { table } = await tablesOf(grant, SALES_PAGE_ID);
    assert.equal(table.hasArchive, false);
    const refused = await rowsOf(grant, SALES_PAGE_ID, {
      archived: "archived",
    });
    assertRefused(refused, HTTP_BAD_REQUEST, "no_archive");
    const active = await rowsOf(grant, SALES_PAGE_ID, { archived: "active" });
    assert.equal(active.refusal, undefined);
  });
});

describe("[data paths] Analyst refuses a filter the table does not serve", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("refuses a field with no column, naming it, and still applies a real filter", async () => {
    const grant = await grantOf("ownerA");
    const { table } = await tablesOf(grant, LEDGER_PAGE_ID);
    const label = table.columns.find((column) => column.field === "label");
    assert.ok(label?.filterModes.includes("is"), JSON.stringify(table));
    const unknown = await rowsOf(grant, LEDGER_PAGE_ID, {
      filter_isArchived: "is:true",
    });
    assertRefused(unknown, HTTP_BAD_REQUEST, "unknown_filter");
    assert.match(unknown.refusal?.detail ?? "", /isArchived/);
    const filtered = await rowsOf(grant, LEDGER_PAGE_ID, {
      filter_label: "is:L-open",
    });
    assert.deepEqual(valuesOf(filtered, "label"), ["L-open"]);
  });

  it("refuses a mode the column does not list, and a column that does not filter", async () => {
    const grant = await grantOf("ownerA");
    const badMode = await rowsOf(grant, LEDGER_PAGE_ID, {
      filter_label: "no_such_mode:L-open",
    });
    assertRefused(badMode, HTTP_BAD_REQUEST, "unknown_filter_mode");
    const notFiltering = await rowsOf(grant, SALES_PAGE_ID, {
      filter_label: "is:A-north",
    });
    assertRefused(notFiltering, HTTP_BAD_REQUEST, "not_filterable");
  });
});

/** @returns {Promise<string | undefined>} */
async function lastFeedQuery() {
  const seen = await call(FEED_REQUESTS, FeedRequests);
  assert.ok(seen.body, seen.text);
  return seen.body.queries.at(-1);
}

describe("[data paths] Analyst reads a source table through its own route", function () {
  this.timeout(TEST_TIMEOUT_MS);

  it("pages the rows the route answers whole, with only the listed columns", async () => {
    const grant = await grantOf("ownerA");
    const { table } = await tablesOf(grant, FEED_PAGE_ID);
    assert.equal(table.hasArchive, false);
    assert.equal(table.searchable, false);
    assert.ok(table.columns.every((column) => !column.sortable));
    const page = await rowsOf(grant, FEED_PAGE_ID, { offset: "1", limit: "2" });
    assert.deepEqual(valuesOf(page, "_id"), ["feed-1", "feed-2"]);
    assert.equal(page.body?.total, 5);
    for (const row of page.body?.rows ?? []) {
      assert.deepEqual(Object.keys(row).sort(), FEED_FIELDS);
    }
    assert.equal(await lastFeedQuery(), "");
  });

  it("hands the route the filter it applies", async () => {
    const grant = await grantOf("ownerA");
    const filtered = await rowsOf(grant, FEED_PAGE_ID, {
      filter_kind: "is:in",
      limit: "10",
    });
    assert.deepEqual(valuesOf(filtered, "kind"), ["in", "in", "in"]);
    assert.equal(filtered.body?.total, 3);
    assert.equal(await lastFeedQuery(), "filter_kind=is%3Ain");
  });

  it("refuses a sort, a search or an archive the route does not do", async () => {
    const grant = await grantOf("ownerA");
    const sorted = await rowsOf(grant, FEED_PAGE_ID, { sortKey: "kind" });
    assertRefused(sorted, HTTP_BAD_REQUEST, "not_supported");
    assert.match(sorted.refusal?.detail ?? "", /AnalystLoad.*AnalystCompute/);
    const searched = await rowsOf(grant, FEED_PAGE_ID, { search: "in" });
    assertRefused(searched, HTTP_BAD_REQUEST, "not_supported");
    const archived = await rowsOf(grant, FEED_PAGE_ID, {
      archived: "archived",
    });
    assertRefused(archived, HTTP_BAD_REQUEST, "no_archive");
  });
});
