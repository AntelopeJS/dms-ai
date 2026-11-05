const assert = require("node:assert/strict");
const { grantFor, waitForLock } = require("./assistant.cjs");
const {
  addSales,
  createRole,
  inviteMember,
  onboardOwner,
  ownerInNewTenant,
} = require("./dms.cjs");

const ASSISTANT = "ai.assistant";
const SALES_PAGE_ID = "dms-ai-test-sales";
const SALES_TABLE_PERMISSION = `${SALES_PAGE_ID}.content`;
const READER_PERMISSIONS = [
  ASSISTANT,
  SALES_PAGE_ID,
  SALES_TABLE_PERMISSION,
  `${SALES_TABLE_PERMISSION}.list`,
];
const TENANT_B = "tenant-b";
const SALES_A = [
  { label: "A-north", amount: 120, costPrice: 70 },
  { label: "A-south", amount: 80, costPrice: 50 },
];
const SALES_B = [{ label: "B-east", amount: 999, costPrice: 1 }];

/** @typedef {import("./dms.cjs").Session} Session */

/** @type {Map<string, Session>} */
const people = new Map();
/** @type {Array<() => void>} */
const openStreams = [];
/** @type {Promise<void> | undefined} */
let seeding;

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
 * @param {string} name
 * @param {Session} session
 */
function addPerson(name, session) {
  people.set(name, session);
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

function closeGrants() {
  for (const close of openStreams) close();
}

async function seedTenantA() {
  const owner = await onboardOwner("owner@data-paths.test");
  const readers = await createRole(owner, "Readers", READER_PERMISSIONS);
  const pageOnly = await createRole(owner, "Page only", [
    ASSISTANT,
    SALES_PAGE_ID,
  ]);
  const noAssistant = await createRole(owner, "No assistant", [
    SALES_PAGE_ID,
    SALES_TABLE_PERMISSION,
    `${SALES_TABLE_PERMISSION}.list`,
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

/**
 * Seeds both tenants' owners, members and sales once, however many test
 * files ask for them.
 *
 * @returns {Promise<void>}
 */
function seedPeople() {
  seeding ??= (async () => {
    await waitForLock();
    await seedTenantB(await seedTenantA());
  })();
  return seeding;
}

module.exports = {
  ASSISTANT,
  SALES_A,
  SALES_B,
  SALES_PAGE_ID,
  TENANT_B,
  addPerson,
  closeGrants,
  openGrant,
  person,
  seedPeople,
};
