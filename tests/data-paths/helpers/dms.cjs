const assert = require("node:assert/strict");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { TenantModel } = require("@antelopejs/interface-dms/db");
const { UserModel } = require("@antelopejs/interface-dms/auth/db");
const {
  ProvisionTenant,
} = require("@antelopejs/interface-dms/tenant-provisioning");
const {
  applyTenantOwnership,
} = require("@antelopejs/interface-dms/tenant-ownership");
const { z } = require("zod");

const API_BASE_URL_ENV = "DMS_AI_TEST_API_BASE_URL";
const PASSWORD = "TestPassw0rd!";
const LANGUAGE = "en";
const ROLES_TABLE = "/api/tables/roles";
const INVITES_TABLE = "/api/tables/admin-invites";
const MEMBERS_PAGE = "/dms/pages/settings/workspace/members";
const INVITES_PAGE = "/dms/pages/settings/workspace/invites";
const HTTP_OK = 200;

const TokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
});
const MeSchema = z.object({ _id: z.string() });
const RolesSchema = z.object({
  results: z.array(z.object({ _id: z.string(), name: z.string() })),
});
const InvitesSchema = z.object({
  results: z.array(z.object({ _id: z.string(), email: z.string() })),
});
const LinkSchema = z.object({ url: z.string() });

/**
 * A signed-in user: their session's tokens and, once known, their id.
 *
 * @typedef {object} Session
 * @property {string} email
 * @property {string} token
 * @property {string} refreshToken
 * @property {string} userId
 */

/**
 * @typedef {object} RequestOptions
 * @property {string} [method]
 * @property {string} [token] the bearer the request is signed in with
 * @property {Headers} [headers]
 * @property {object} [body] sent as JSON
 */

/**
 * An answer: its status, its text, and its body when the schema reads it.
 *
 * @template T
 * @typedef {object} Answer
 * @property {number} status
 * @property {string} text
 * @property {T | undefined} body
 */

/** The token antelope.test.ts gives the DMS, which its first owner registers with. */
const SETUP_TOKEN_ENV = "DMS_SETUP_TOKEN";

/** @returns {string} */
function baseUrl() {
  const url = process.env[API_BASE_URL_ENV];
  assert.ok(url, `${API_BASE_URL_ENV} is unset: the sales host publishes it`);
  return url;
}

/**
 * @template T
 * @param {string} text
 * @param {z.ZodType<T>} schema
 * @returns {T | undefined}
 */
function parseBody(text, schema) {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One request to the booted API; never throws on a status.
 *
 * @template T
 * @param {string} path
 * @param {z.ZodType<T>} schema
 * @param {RequestOptions} [options]
 * @returns {Promise<Answer<T>>}
 */
async function call(path, schema, options = {}) {
  const headers = new Headers(options.headers);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  /** @type {RequestInit} */
  const init = { method: options.method ?? "GET", headers };
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(new URL(path, baseUrl()), init);
  const text = await response.text();
  return { status: response.status, text, body: parseBody(text, schema) };
}

/**
 * @template T
 * @param {string} path
 * @param {z.ZodType<T>} schema
 * @param {RequestOptions} [options]
 * @returns {Promise<T>}
 */
async function ok(path, schema, options) {
  const answer = await call(path, schema, options);
  const label = `${options?.method ?? "GET"} ${path}: ${answer.text}`;
  assert.equal(answer.status, HTTP_OK, label);
  assert.ok(answer.body !== undefined, label);
  return answer.body;
}

/**
 * @param {string} email
 * @param {z.infer<typeof TokensSchema>} tokens
 * @returns {Promise<Session>}
 */
async function sessionOf(email, tokens) {
  const me = await ok("/api/auth/me", MeSchema, { token: tokens.access_token });
  return {
    email,
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
    userId: me._id,
  };
}

/**
 * Registers the platform owner through onboarding and signs them in.
 *
 * @param {string} email
 * @returns {Promise<Session>}
 */
async function onboardOwner(email) {
  await ok("/api/onboarding/register", z.unknown(), {
    method: "POST",
    body: {
      email,
      firstName: "Olive",
      lastName: "Owner",
      password: PASSWORD,
      setupToken: process.env[SETUP_TOKEN_ENV],
    },
  });
  const tokens = await ok("/api/auth/login", TokensSchema, {
    method: "POST",
    body: { email, password: PASSWORD },
  });
  return sessionOf(email, tokens);
}

/**
 * Creates a role in the tenant of the owner's token and returns its id.
 *
 * @param {Session} owner
 * @param {string} name
 * @param {string[]} permissions
 * @returns {Promise<string>}
 */
async function createRole(owner, name, permissions) {
  await ok(`${ROLES_TABLE}/new`, z.unknown(), {
    method: "POST",
    token: owner.token,
    body: { name, permissions },
  });
  const listed = await ok(`${ROLES_TABLE}/list?limit=100`, RolesSchema, {
    token: owner.token,
  });
  const role = listed.results.find((row) => row.name === name);
  assert.ok(role, `role ${name} was not listed`);
  return role._id;
}

/**
 * @param {Session} owner
 * @param {string} email
 * @returns {Promise<string>}
 */
async function inviteToken(owner, email) {
  const listed = await ok(`${INVITES_TABLE}/list?limit=100`, InvitesSchema, {
    token: owner.token,
  });
  const invite = listed.results.find((row) => row.email === email);
  assert.ok(invite, `no invite listed for ${email}`);
  const { url } = await ok(`${INVITES_PAGE}/${invite._id}/link`, LinkSchema, {
    token: owner.token,
  });
  const token = new URL(url).searchParams.get("token");
  assert.ok(token, `the invite link carries no token: ${url}`);
  return token;
}

/**
 * Invites a new user into the tenant of the owner's token with one role,
 * signs them up with the invite's token and returns their session.
 *
 * @param {Session} owner
 * @param {string} email
 * @param {string} roleId
 * @returns {Promise<Session>}
 */
async function inviteMember(owner, email, roleId) {
  await ok(`${MEMBERS_PAGE}/invite`, z.unknown(), {
    method: "POST",
    token: owner.token,
    body: {
      emails: [email],
      roles: [roleId],
      language: LANGUAGE,
      asTenantOwner: false,
    },
  });
  const tokens = await ok("/api/auth/signup", TokensSchema, {
    method: "POST",
    body: {
      name: email.split("@")[0],
      email,
      password: PASSWORD,
      lang: LANGUAGE,
      token: await inviteToken(owner, email),
    },
  });
  return sessionOf(email, tokens);
}

/**
 * Creates and provisions a second tenant, which the DMS only does from code,
 * makes the owner its tenant owner, and switches the owner's session to it
 * over HTTP.
 *
 * @param {Session} owner
 * @param {string} tenantId
 * @returns {Promise<Session>}
 */
async function ownerInNewTenant(owner, tenantId) {
  const now = new Date();
  await GetModel(TenantModel).insert({
    _id: tenantId,
    name: tenantId,
    createdAt: now,
    updatedAt: now,
  });
  await ProvisionTenant({ tenantId, extras: {} });
  await applyTenantOwnership(GetModel(UserModel), owner.userId, tenantId, {
    roleIds: [],
    isTenantOwner: true,
  });
  const tokens = await ok("/api/auth/switch-tenant", TokensSchema, {
    method: "POST",
    body: { refreshToken: owner.refreshToken, tenantId },
  });
  return sessionOf(owner.email, tokens);
}

/**
 * Adds rows to the sales table of the tenant the token names.
 *
 * @param {Session} member
 * @param {object[]} rows
 * @returns {Promise<void>}
 */
async function addSales(member, rows) {
  for (const row of rows) {
    await ok("/api/dms-ai-test/sales/new", z.unknown(), {
      method: "POST",
      token: member.token,
      body: row,
    });
  }
}

module.exports = {
  addSales,
  call,
  createRole,
  inviteMember,
  onboardOwner,
  ownerInNewTenant,
};
