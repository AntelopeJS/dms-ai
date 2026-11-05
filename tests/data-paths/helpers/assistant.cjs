const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { z } = require("zod");
const { call } = require("./dms.cjs");

const LOCK_PATH = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "dms-ai",
  "sidecar.lock",
);
const EVENTS_PATH = "/ai/channel/events";
const READY_EVENT = "event: ready";
const WAIT_TIMEOUT_MS = 10_000;
const WAIT_STEP_MS = 50;
const API_BASE_URL_ENV = "DMS_AI_TEST_API_BASE_URL";
const HTTP_OK = 200;

const LockSchema = z.object({
  port: z.number(),
  pid: z.number(),
  token: z.string(),
  clientToken: z.string(),
});
const ActorSchema = z.object({
  type: z.literal("actor"),
  userId: z.string(),
  name: z.string(),
  tenantId: z.string(),
  isOwner: z.boolean(),
  modes: z.array(z.string()),
  grant: z.string(),
});
const ActorsSchema = z.object({ actors: z.array(ActorSchema) });

/** @typedef {z.infer<typeof ActorSchema>} Actor */
/** @typedef {import("./dms.cjs").Session} Session */

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The stand-in sidecar's lock: its port and the tokens it published.
 *
 * @returns {z.infer<typeof LockSchema>}
 */
function readLock() {
  return LockSchema.parse(JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")));
}

/** @returns {Promise<z.infer<typeof LockSchema>>} */
async function waitForLock() {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      return readLock();
    } catch {
      await delay(WAIT_STEP_MS);
    }
  }
  return assert.fail("the stand-in sidecar never wrote its lock");
}

/**
 * Every actor frame the backend sent the stand-in sidecar so far.
 *
 * @returns {Promise<Actor[]>}
 */
async function actorFrames() {
  const lock = await waitForLock();
  const response = await fetch(`http://127.0.0.1:${lock.port}/actors`, {
    headers: { "x-dms-ai-token": lock.token },
  });
  assert.equal(response.status, HTTP_OK);
  return ActorsSchema.parse(JSON.parse(await response.text())).actors;
}

/**
 * A stream as the dashboard opens it: refused with a status, or open until
 * closed.
 *
 * @typedef {object} EventStream
 * @property {number | undefined} status
 * @property {string} text
 * @property {() => void} close
 */

/**
 * Opens the assistant's event stream as a signed-in user, the way the
 * dashboard does. Resolves once the stream says ready, or with the status of
 * a refusal.
 *
 * @param {Session} session
 * @returns {Promise<EventStream>}
 */
function openEvents(session) {
  const url = new URL(EVENTS_PATH, process.env[API_BASE_URL_ENV]);
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      { headers: { authorization: `Bearer ${session.token}` } },
      (res) => {
        let text = "";
        const close = () => req.destroy();
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += String(chunk);
          if (res.statusCode === HTTP_OK && text.includes(READY_EVENT)) {
            resolve({ status: res.statusCode, text, close });
          }
        });
        res.on("end", () => resolve({ status: res.statusCode, text, close }));
      },
    );
    req.on("error", reject);
  });
}

/**
 * Opens a stream as the user and returns the actor frame the backend handed
 * the sidecar for it, with the stream to close.
 *
 * @param {Session} session
 * @returns {Promise<{ actor: Actor, grant: string, close: () => void }>}
 */
async function grantFor(session) {
  const before = (await actorFrames()).length;
  const stream = await openEvents(session);
  assert.equal(stream.status, HTTP_OK, `events refused: ${stream.text}`);
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const fresh = (await actorFrames()).slice(before);
    const actor = fresh.find((frame) => frame.userId === session.userId);
    if (actor) return { actor, grant: actor.grant, close: stream.close };
    await delay(WAIT_STEP_MS);
  }
  stream.close();
  return assert.fail(`no actor frame reached the sidecar for ${session.email}`);
}

/**
 * @typedef {object} AnalystOptions
 * @property {string} [grant] sent as the data grant header
 * @property {string} [token] the sidecar token; the stand-in's by default
 * @property {URLSearchParams} [query]
 */

/**
 * Calls an Analyst route the way the sidecar does.
 *
 * @template T
 * @param {string} route
 * @param {z.ZodType<T>} schema
 * @param {AnalystOptions} [options]
 * @returns {Promise<import("./dms.cjs").Answer<T>>}
 */
function analyst(route, schema, options = {}) {
  const headers = new Headers();
  headers.set("x-dms-ai-token", options.token ?? readLock().token);
  if (options.grant !== undefined) headers.set("x-dms-ai-grant", options.grant);
  const search = options.query?.toString() ?? "";
  return call(`/ai/analyst/${route}${search ? `?${search}` : ""}`, schema, {
    headers,
  });
}

/**
 * Polls until the check answers anything but 200, or gives up and returns its
 * last answer.
 *
 * @param {() => Promise<{ status: number }>} check
 * @returns {Promise<{ status: number }>}
 */
async function waitUntilRefused(check) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let last = await check();
  while (last.status === HTTP_OK && Date.now() < deadline) {
    await delay(WAIT_STEP_MS);
    last = await check();
  }
  return last;
}

/** Stops the stand-in sidecar the module spawned for the run. */
function stopSidecar() {
  try {
    process.kill(readLock().pid, "SIGTERM");
  } catch {
    return;
  }
}

module.exports = {
  actorFrames,
  analyst,
  grantFor,
  openEvents,
  stopSidecar,
  waitForLock,
  waitUntilRefused,
};
