import { guarded } from "../guard.mjs";
import { AI, ai, check, freshSidecar, member, parseJson, raw, recordRaw, same, sidecarLock, text } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

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
