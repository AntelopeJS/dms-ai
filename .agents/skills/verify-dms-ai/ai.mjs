import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { previousWindowStart, windowStart } from "./windows.mjs";

/**
 * @typedef {import("../../../node_modules/@antelopejs/dms/bin/control/journey.mjs").JourneyContext} Ctx
 * @typedef {import("../../../node_modules/@antelopejs/dms/bin/control/tab.mjs").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {{ folder: string, status: number | null, headers: Record<string, string>, bytes: Buffer, text: string, json: unknown }} Raw
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The module's owner-only API, which the dashboard's pages and the chat call. */
export const AI = "/ai";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-ai";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (!isRow(current)) return undefined;
    current = current[step];
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...string} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...string} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * An equality check over JSON values, with both sides in the detail.
 *
 * @param {string} name What is compared
 * @param {unknown} actual The value found
 * @param {unknown} expected The value wanted
 * @returns {Check} The check
 */
export function same(name, actual, expected) {
  const [left, right] = [JSON.stringify(actual), JSON.stringify(expected)];
  return { name, pass: left === right, detail: `expected ${right}, got ${left}` };
}

/**
 * @param {string} body A response body
 * @returns {unknown} Its JSON value, or undefined when it is not JSON
 */
export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * @param {Uint8Array} bytes Some bytes
 * @returns {string} Their SHA-256, hex
 */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Calls the module's owner-only API.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under `/ai`
 * @param {{ body?: unknown, as?: string }} [options] The JSON body, and the account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function ai(ctx, label, method, path, options = {}) {
  return ctx.api(label, { method, path: `${AI}${path}`, body: options.body, as: options.as });
}

/**
 * Calls the verification playground's trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the fixture
 * @param {unknown} [body] The JSON body
 * @returns {Promise<Answer>} The answer
 */
export function fixture(ctx, label, method, path, body) {
  return ctx.api(label, { method, path: `${FIXTURE}${path}`, body, as: "anon" });
}

/**
 * The session token of an account, after one authenticated call signed it in.
 *
 * @param {Ctx} ctx The journey
 * @param {string} account The account
 * @returns {Promise<string | undefined>} The token
 */
export async function tokenOf(ctx, account) {
  if (!ctx.state.tokens?.[account]) await ctx.api(`sign ${account} in`, { method: "GET", path: `${AI}/status`, as: account });
  return ctx.state.tokens?.[account];
}

/**
 * A request to any URL with its response headers and bytes kept in the evidence, redirects not followed.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the request does
 * @param {{ url?: string, path?: string, origin?: "api" | "web", method?: string, headers?: Record<string, string>, as?: string, body?: string | Buffer }} request What to send; `as` adds the account's session token
 * @returns {Promise<Raw>} The answer
 */
export async function raw(ctx, label, request) {
  const folder = ctx.step(label);
  const origin = request.origin === "web" ? ctx.state.webUrl : ctx.state.apiUrl;
  const url = request.url ?? `${origin}${request.path ?? "/"}`;
  const method = request.method ?? "GET";
  /** @type {Record<string, string>} */
  const headers = { ...request.headers };
  if (request.as) headers.authorization = `Bearer ${(await tokenOf(ctx, request.as)) ?? ""}`;
  const shown = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, /auth|cookie|token/i.test(name) ? "<secret>" : value]));
  writeFileSync(join(folder, "request.json"), `${JSON.stringify({ method, url, headers: shown }, null, 2)}\n`);
  const response = await fetch(url, { method, headers, redirect: "manual", body: request.body });
  const bytes = Buffer.from(await response.arrayBuffer());
  /** @type {Record<string, string>} */
  const received = {};
  for (const [name, value] of response.headers) received[name] = value;
  const body = bytes.toString("utf8");
  writeFileSync(join(folder, "response.json"), `${JSON.stringify({ status: response.status, headers: received, bytes: bytes.byteLength, sha256: sha256(bytes), body: body.slice(0, 4000) }, null, 2)}\n`);
  return { folder, status: response.status, headers: received, bytes, text: body, json: parseJson(body) };
}

/**
 * Records checks against the evidence folder `raw` made.
 *
 * @param {Ctx} ctx The journey
 * @param {Raw} answer The answer
 * @param {Check[]} checks The checks
 * @returns {boolean} Whether they all passed
 */
export function recordRaw(ctx, answer, checks) {
  return ctx.record(answer.folder, checks);
}

/**
 * Creates a member of the default tenant whose role holds the given permissions and signs them up.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name in the journey
 * @param {string[]} [permissions] The permission ids of the member's role
 * @returns {Promise<{ roleId: string, userId: string }>} The ids
 */
export async function member(ctx, name, permissions = []) {
  const invite = await fixture(ctx, `invite ${name}`, "POST", "/member", { name, permissions });
  const email = text(invite.body, "email");
  const password = ctx.password();
  const signup = await ctx.api(`${name} signs up`, {
    method: "POST",
    path: "/api/auth/signup",
    body: { name, email, password, lang: "en", token: text(invite.body, "token") },
    as: "anon",
  });
  const userId = text(signup.body, "user", "_id");
  ctx.addAccount(name, { email, password, userId });
  await ctx.verify(`${name} is a member`, [check("the signup answers a session", signup.status === 200 && userId !== "", signup.status)], { critical: true });
  return { roleId: text(invite.body, "roleId"), userId };
}

/**
 * The sidecar's own folder of the run: its lock, its stored state and its log. It sits in the playground's
 * `node_modules/.cache/dms-ai`, so a checkout holds one run at a time.
 *
 * @param {Ctx} ctx The journey
 * @param {...string} parts A path under it
 * @returns {string} The folder or file
 */
export function sidecarPath(ctx, ...parts) {
  return join(ctx.state.runPlayground ?? ctx.state.playground, "node_modules", ".cache", "dms-ai", ...parts);
}

/**
 * The lock the running sidecar published: where it listens, its process and its credentials.
 *
 * @param {Ctx} ctx The journey
 * @returns {{ port: number, pid: number, token: string, clientToken: string } | null} The lock, or null when there is none
 */
export function sidecarLock(ctx) {
  const file = sidecarPath(ctx, "sidecar.lock");
  if (!existsSync(file)) return null;
  const lock = parseJson(readFileSync(file, "utf8"));
  const port = pick(lock, "port");
  const pid = pick(lock, "pid");
  if (!Number.isInteger(port) || !Number.isInteger(pid)) return null;
  return { port: Number(port), pid: Number(pid), token: text(lock, "token"), clientToken: text(lock, "clientToken") };
}

/**
 * @param {number} ms How long to wait
 * @returns {Promise<void>}
 */
export function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls until `read` answers a truthy value or the time is up.
 *
 * @template T
 * @param {() => Promise<T> | T} read What to read
 * @param {{ timeoutMs?: number, everyMs?: number }} [options] How long and how often
 * @returns {Promise<T>} The last value read
 */
export async function until(read, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let value = await read();
  while (!value && Date.now() < deadline) {
    await pause(options.everyMs ?? 500);
    value = await read();
  }
  return value;
}

/**
 * Whether a process of this machine still runs.
 *
 * @param {number} pid The process id
 * @returns {boolean} True when it answers signal 0
 */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
}

/**
 * The status the owner reads, polled until it satisfies `accept`.
 *
 * @param {Ctx} ctx The journey
 * @param {(status: unknown) => boolean} accept What the status must be
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<{ status: unknown, ok: boolean }>} The last status and whether it was accepted
 */
export async function statusIs(ctx, accept, timeoutMs = 30_000) {
  let last = null;
  const ok = await until(
    async () => {
      const answer = await ctx.api("read the status", { method: "GET", path: `${AI}/status` });
      last = answer.body;
      return accept(answer.body);
    },
    { timeoutMs },
  );
  return { status: last, ok: Boolean(ok) };
}

/**
 * Restarts the backend with these variables in its environment, runs `body`, and restarts it again with the
 * variables it had, so later journeys get the module's defaults back.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables
 * @param {() => Promise<void>} body What to do under that configuration
 * @returns {Promise<void>}
 */
export async function withEnv(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Stops the backend and its sidecar, forgets everything the sidecar stored (settings, conversations), and starts
 * the backend again, so a journey begins from the module's defaults whatever the earlier ones saved.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<void>}
 */
export async function freshSidecar(ctx) {
  const backend = ctx.state.processes.find((entry) => entry.name === "backend");
  const lock = sidecarLock(ctx);
  if (backend && alive(backend.pid)) process.kill(backend.pid, "SIGTERM");
  await until(() => !(backend && alive(backend.pid)) && !(lock && alive(lock.pid)), { timeoutMs: 30_000 });
  rmSync(sidecarPath(ctx), { recursive: true, force: true });
  rmSync(join(ctx.state.home, ".claude"), { recursive: true, force: true });
  await ctx.restartBackend();
  await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
}

/**
 * A check on whether a radio button or a switch is selected, read from the page.
 *
 * @param {Tab} tab The tab
 * @param {{ role: string, name: string, exact?: boolean }} target The control
 * @param {boolean} expected Whether it must be selected
 * @returns {Promise<Check>} The check
 */
export async function selected(tab, target, expected) {
  const control = tab.locator(target).first();
  const state = await control.isChecked({ timeout: 15_000 }).catch(() => null);
  return check(`${target.name} is ${expected ? "selected" : "not selected"}`, state === expected, `checked=${state}`);
}

/**
 * The visible text of the page.
 *
 * @param {Tab} tab The tab
 * @returns {Promise<string>} The body text
 */
export function bodyText(tab) {
  return tab.page.locator("body").innerText({ timeout: 15_000 }).catch(() => "");
}

/**
 * A check that the page, once it has settled, shows exactly this text in a region.
 *
 * @param {Tab} tab The tab
 * @param {string} name What is checked
 * @param {RegExp} pattern The text
 * @param {boolean} [want] Whether it must show
 * @returns {Promise<Check>} The check
 */
export async function pageHas(tab, name, pattern, want = true) {
  const found = await until(async () => pattern.test((await bodyText(tab)).replace(/\s+/g, " ")) === want, { timeoutMs: 20_000 });
  const body = await bodyText(tab);
  const flat = body.replace(/\s+/g, " ");
  return check(name, Boolean(found), flat.length > 1800 ? `${flat.slice(0, 300)} … ${flat.slice(-1500)}` : flat);
}

/**
 * A check on the text of one control, such as the label a menu shows.
 *
 * @param {Tab} tab The tab
 * @param {{ role: string, name: string, exact?: boolean }} target The control
 * @param {string} expected The text it must show
 * @returns {Promise<Check>} The check
 */
export async function shownBy(tab, target, expected) {
  const found = await tab.locator(target).first().innerText({ timeout: 15_000 }).catch(() => "");
  return check(`${target.name} shows ${expected}`, found.trim() === expected, found.trim());
}

/**
 * Stops the backend and its sidecar and waits until both are gone, so a journey can change the sidecar's folder.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<void>}
 */
export async function stopBackend(ctx) {
  const backend = ctx.state.processes.find((entry) => entry.name === "backend");
  const lock = sidecarLock(ctx);
  if (backend && alive(backend.pid)) process.kill(backend.pid, "SIGTERM");
  await until(() => !(backend && alive(backend.pid)) && !(lock && alive(lock.pid)), { timeoutMs: 30_000 });
}

/**
 * Clicks a radio button or a switch until it is selected: the dashboard hydrates after it renders, and a click
 * that lands first does nothing. Gives up after six clicks and leaves the next check to fail.
 *
 * @param {Tab} tab The tab
 * @param {{ role: string, name: string, exact?: boolean }} target The control
 * @returns {Promise<void>}
 */
export async function choose(tab, target) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await tab.click(target);
    const done = await until(async () => tab.locator(target).first().isChecked({ timeout: 2000 }).catch(() => false), { timeoutMs: 6000, everyMs: 500 });
    if (done) return;
  }
}

/**
 * The window a period option of the pages sends: the period, compared with the one before it (see `windowStart`).
 *
 * @param {number} now The time
 * @param {1 | 7 | 30} days The length of the period
 * @returns {string} The query string
 */
export function periodQuery(now, days) {
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
  return `from=${iso(windowStart(now, days))}&to=${iso(now)}&compareFrom=${iso(previousWindowStart(now, days))}&compareTo=${iso(windowStart(now, days))}`;
}

/**
 * Clicks a control until the page shows what it opens: a click that lands before the dashboard hydrates does
 * nothing. Gives up after six clicks and leaves the next check to fail.
 *
 * @param {Tab} tab The tab
 * @param {{ role: string, name: string, exact?: boolean }} target The control
 * @param {RegExp} opens The text the page shows once it worked
 * @returns {Promise<void>}
 */
export async function clickUntil(tab, target, opens) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await tab.click(target);
    const shown = await until(async () => opens.test((await bodyText(tab)).replace(/\s+/g, " ")), { timeoutMs: 4000, everyMs: 500 });
    if (shown) return;
  }
}
