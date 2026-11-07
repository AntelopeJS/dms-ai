import { existsSync, readFileSync, statSync } from "node:fs";
import { guarded } from "../guard.mjs";
import { AI, ai, check, freshSidecar, list, member, parseJson, pick, raw, recordRaw, same, sidecarLock, sidecarPath, text, tokenOf, until } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

const MCP_MESSAGE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const MCP_NOTIFICATION = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
const TOOLS_ONLY_THE_CHAT_SHOWS = ["ask_user", "preview_blocks"];
const FORWARDED = { "x-forwarded-for": "203.0.113.9" };

/** Every route the module serves to the owner, with the method and a path that exists. */
const OWNER_ROUTES = [
  ["GET", "/status"], ["POST", "/sidecar/restart"], ["GET", "/status/facts"], ["GET", "/status/banner"], ["GET", "/sidecar-info"],
  ["GET", "/metrics/kpi/actions"], ["GET", "/metrics/series"], ["GET", "/metrics/allowed"], ["GET", "/metrics/top-tools"], ["GET", "/metrics/usage"], ["GET", "/metrics/usage/summary"],
  ["GET", "/activity"], ["GET", "/activity/x"], ["GET", "/activity/export.csv"],
  ["GET", "/changes"], ["GET", "/recent-changes"], ["GET", "/changes/x"], ["GET", "/changes/x/undo-preview"], ["GET", "/changes/x/undo-confirm"], ["POST", "/changes/x/undo"], ["POST", "/changes/x/redo"],
  ["GET", "/skills/catalog"], ["GET", "/skills/conflicts"], ["GET", "/settings"], ["PUT", "/settings"],
  ["GET", "/codex/account/banner"], ["POST", "/codex/callback"], ["POST", "/codex/logout"],
  ["GET", "/channel/events"], ["POST", "/channel/x/messages"],
];

/** The routes only the sidecar calls, with its own token. */
const SIDECAR_ROUTES = [["GET", "/logs"], ["GET", "/pages-registry"], ["GET", "/builder/status"], ["POST", "/builder/op"], ["GET", "/database/connections"], ["POST", "/database/relations"], ["POST", "/database/describe"], ["POST", "/database/profile"]];

/** @param {Ctx} ctx @param {string} method @param {string} path @param {string | undefined} who */
function call(ctx, method, path, who) {
  const hasBody = method === "POST" || method === "PUT";
  return raw(ctx, `${method} ${path} as ${who ?? "nobody"}`, {
    path: `${AI}${path}`,
    method,
    as: who,
    headers: hasBody ? { "content-type": "application/json" } : {},
    body: hasBody ? "{}" : undefined,
  });
}

/**
 * What the backend published for the bridge of an outside Claude Code session: the route and this start's credential.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<{ file: string, url: string, token: string }>} The file, the route and the credential
 */
async function publishedMcp(ctx) {
  const file = sidecarPath(ctx, "mcp.json");
  await until(() => existsSync(file), { timeoutMs: 30_000 });
  const published = existsSync(file) ? parseJson(readFileSync(file, "utf8")) : undefined;
  return { file, url: text(published, "url"), token: text(published, "token") };
}

export const journeys = guarded([
  {
    id: "every-owner-route-refuses-nobody-and-a-member",
    title: "each owner route answers 401 without a session and 403 to a member whose role holds no permission, and the refused calls change nothing",
    entryPoint: "every owner route of /ai as nobody and as a member",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await member(ctx, "plain", []);
      const before = (await ai(ctx, "settings before", "GET", "/settings")).body;
      const anonymous = [];
      const refused = [];
      const allowed = [];
      for (const [method, path] of OWNER_ROUTES) {
        anonymous.push([`${method} ${path}`, (await call(ctx, method, path, undefined)).status]);
        refused.push([`${method} ${path}`, (await call(ctx, method, path, "plain")).status]);
      }
      for (const [method, path] of OWNER_ROUTES.filter(([, p]) => !p.startsWith("/channel") && p !== "/sidecar/restart" && p !== "/codex/logout")) {
        const answer = await call(ctx, method, path, "admin");
        allowed.push([`${method} ${path}`, answer.status !== 401 && answer.status !== 403]);
      }
      const after = (await ai(ctx, "settings after", "GET", "/settings")).body;
      await ctx.verify("the refusals", [
        same("nobody gets 401 on every route", anonymous.filter(([, status]) => status !== 401), []),
        same("a member gets 403 on every route", refused.filter(([, status]) => status !== 403), []),
        same("the owner is let in", allowed.filter(([, ok]) => !ok), []),
        same("nothing changed", after, before),
      ]);
    },
  },
  {
    id: "the-sidecar-routes-answer-only-the-sidecar",
    title: "logs, pages registry, Builder and database routes refuse a signed-in owner and nobody with 403, and answer a caller that holds the sidecar's token; health needs no sign-in",
    entryPoint: "/ai/logs, /ai/pages-registry, /ai/builder/*, /ai/database/* with and without x-dms-ai-token",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const lock = sidecarLock(ctx);
      const owner = [];
      const nobody = [];
      const wrong = [];
      for (const [method, path] of SIDECAR_ROUTES) {
        owner.push([`${method} ${path}`, (await call(ctx, method, path, "admin")).status]);
        nobody.push([`${method} ${path}`, (await call(ctx, method, path, undefined)).status]);
        wrong.push([`${method} ${path}`, (await raw(ctx, `${method} ${path} with a wrong token`, { path: `${AI}${path}`, method, headers: { "x-dms-ai-token": "not-the-token", "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined })).status]);
      }
      await ctx.verify("the refusals", [
        same("an owner session is not the sidecar", owner.filter(([, status]) => status !== 403), []),
        same("nobody is refused", nobody.filter(([, status]) => status !== 403), []),
        same("a wrong token is refused", wrong.filter(([, status]) => status !== 403), []),
      ]);
      const logs = await raw(ctx, "logs with the sidecar's token", { path: `${AI}/logs?limit=5`, headers: { "x-dms-ai-token": lock?.token ?? "" } });
      const registry = await raw(ctx, "pages registry with the sidecar's token", { path: `${AI}/pages-registry`, headers: { "x-dms-ai-token": lock?.token ?? "" } });
      const clientToken = await raw(ctx, "logs with the client credential", { path: `${AI}/logs`, headers: { "x-dms-ai-token": lock?.clientToken ?? "" } });
      recordRaw(ctx, logs, [same("the sidecar reads the logs", logs.status, 200), check("as a list", Array.isArray(logs.json), logs.text.slice(0, 80)), check("at most the limit", Array.isArray(logs.json) && logs.json.length <= 5, logs.text.length)]);
      recordRaw(ctx, registry, [same("the sidecar reads the pages registry", registry.status, 200)]);
      recordRaw(ctx, clientToken, [same("the browser's credential is not the backend token", clientToken.status, 403)]);
      const health = await raw(ctx, "health", { path: `${AI}/health` });
      recordRaw(ctx, health, [same("health needs no session", [health.status, parseJson(health.text)], [200, { ok: true, module: "ai" }])]);
      const info = await ai(ctx, "the probe", "GET", "/sidecar-info");
      await ctx.verify("the owner's probe", [same("never shows the token", JSON.stringify(info.body).includes(lock?.token ?? "x"), false), same("never shows the port", JSON.stringify(info.body).includes(String(lock?.port)), false)]);
    },
  },
  {
    id: "the-project-mcp-route-serves-only-a-local-caller-holding-the-start-credential",
    title: "POST /ai/mcp refuses a forwarded request with 403, and a request without the bearer the backend published, with a wrong one or with a session token with 401; the published bearer reaches the project's tools, a notification is accepted and a malformed message refused; the sidecar's own /mcp/project takes only its client credential",
    entryPoint: "POST /ai/mcp (direct, forwarded, through the dashboard), POST <sidecar>/mcp/project, <cache>/mcp.json",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const published = await publishedMcp(ctx);
      const session = await tokenOf(ctx, "admin");
      const post = (/** @type {string} */ label, /** @type {Record<string, string>} */ headers, /** @type {string} */ body = MCP_MESSAGE, /** @type {string} */ url = published.url) =>
        raw(ctx, label, { url, method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      const bearer = (/** @type {string} */ token) => ({ authorization: `Bearer ${token}` });
      const sameLength = "0".repeat(published.token.length);
      /** @type {[string, Awaited<ReturnType<typeof post>>, number][]} */
      const outsiders = [
        ["no bearer", await post("no bearer", {}), 401],
        ["a wrong bearer", await post("a wrong bearer", bearer("not-the-token")), 401],
        ["a wrong bearer of the right length", await post("a wrong bearer of the right length", bearer(sameLength)), 401],
        ["the token without Bearer", await post("the token without Bearer", { authorization: published.token }), 401],
        ["another scheme", await post("another scheme", { authorization: `Basic ${published.token}` }), 401],
        ["the owner's session token", await post("the owner's session token", bearer(session ?? "no-session")), 401],
        ["forwarded, no bearer", await post("forwarded, no bearer", FORWARDED), 403],
        ["forwarded with the right bearer", await post("forwarded with the right bearer", { ...bearer(published.token), ...FORWARDED }), 403],
        ["the standard Forwarded header with the right bearer", await post("the standard Forwarded header with the right bearer", { ...bearer(published.token), forwarded: "for=203.0.113.9" }), 403],
        ["through the dashboard origin with the right bearer", await post("through the dashboard origin with the right bearer", { ...bearer(published.token), origin: ctx.state.webUrl }, MCP_MESSAGE, `${ctx.state.webUrl}${AI}/mcp`), 403],
      ];
      await ctx.verify("the published credential", [
        check("the backend published the route and a credential", published.token.length >= 32 && published.url.endsWith("/ai/mcp"), `${published.url} token of ${published.token.length} characters`),
        same("readable by its owner only", statSync(published.file).mode & 0o777, 0o600),
      ]);
      for (const [name, answer, status] of outsiders) recordRaw(ctx, answer, [same(`${name} is refused`, answer.status, status), check("and the refusal does not show the credential", !answer.text.includes(published.token), answer.text.slice(0, 80))]);
      const tools = await post("tools/list with the published bearer", bearer(published.token));
      const names = list(pick(tools.json, "result"), "tools").map((tool) => text(tool, "name"));
      recordRaw(ctx, tools, [
        same("the project's tools are served", [tools.status, pick(tools.json, "jsonrpc"), pick(tools.json, "id")], [200, "2.0", 1]),
        check("with the logs and database tools", names.includes("query_logs") && names.includes("database_connections"), names.join(", ")),
        same("none of the tools that exist only in the dashboard chat", names.filter((name) => TOOLS_ONLY_THE_CHAT_SHOWS.includes(name)), []),
      ]);
      const notification = await post("a notification", bearer(published.token), MCP_NOTIFICATION);
      const malformed = await post("a malformed message", bearer(published.token), JSON.stringify({ not: "json-rpc" }));
      recordRaw(ctx, notification, [same("a notification is accepted with no body", [notification.status, notification.text], [202, ""])]);
      recordRaw(ctx, malformed, [same("a message that is not JSON-RPC is refused as an invalid request", [malformed.status, pick(malformed.json, "error", "code")], [400, -32600])]);
      const lock = sidecarLock(ctx);
      const sidecarUrl = `http://127.0.0.1:${lock?.port}/mcp/project`;
      const direct = await post("the sidecar, no credential", {}, MCP_MESSAGE, sidecarUrl);
      const swapped = await post("the sidecar, the bearer of the route", bearer(published.token), MCP_MESSAGE, sidecarUrl);
      const sidecarToken = await post("the sidecar, its backend token", bearer(lock?.token ?? ""), MCP_MESSAGE, sidecarUrl);
      const client = await post("the sidecar, its client credential", bearer(lock?.clientToken ?? ""), MCP_MESSAGE, sidecarUrl);
      recordRaw(ctx, direct, [same("no credential is refused", direct.status, 401)]);
      recordRaw(ctx, swapped, [same("the route's bearer is not the client credential", swapped.status, 401)]);
      recordRaw(ctx, sidecarToken, [same("the backend token is not the client credential", sidecarToken.status, 401)]);
      recordRaw(ctx, client, [same("the client credential reaches the tools", [client.status, list(pick(client.json, "result"), "tools").length > 0], [200, true])]);
    },
  },
  {
    id: "the-dashboard-origin-forwards-ai-with-the-session",
    title: "the frontend server forwards /ai/** to the backend: the owner's session reaches the owner routes there, nobody gets 401, and health answers",
    entryPoint: "GET <dashboard>/ai/status, /ai/health, /ai/sidecar-info",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const anonymous = await raw(ctx, "status through the dashboard, nobody", { origin: "web", path: `${AI}/status` });
      const health = await raw(ctx, "health through the dashboard", { origin: "web", path: `${AI}/health` });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      const read = (/** @type {string} */ path) => tab.page.evaluate(async (url) => { const response = await fetch(url, { credentials: "include" }); return { status: response.status, text: await response.text() }; }, path);
      const owner = await read(`${AI}/status`);
      const settings = await read(`${AI}/settings`);
      const ownerBody = parseJson(owner.text);
      const settingsBody = parseJson(settings.text);
      recordRaw(ctx, anonymous, [same("nobody", anonymous.status, 401)]);
      recordRaw(ctx, health, [same("health", [health.status, health.json], [200, { ok: true, module: "ai" }])]);
      await ctx.verify("the owner's session through the dashboard", [same("status", [owner.status, text(ownerBody, "status")], [200, "ready"]), same("settings", [settings.status, text(settingsBody, "provider")], [200, "claude"])]);
    },
  },
]);
