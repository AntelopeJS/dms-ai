import { guarded } from "../guard.mjs";
import { AI, ai, alive, check, freshSidecar, list, pageHas, parseJson, pause, pick, raw, recordRaw, same, sidecarLock, statusIs, text, until, withEnv } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

const READY = (/** @type {unknown} */ status) => text(status, "status") === "ready";

export const journeys = guarded([
  {
    id: "the-status-reads-ready-and-names-the-sidecar",
    title: "the status, its rows and its banner describe a ready assistant, the probe says the sidecar runs, and the health route answers without a session",
    entryPoint: "GET /ai/status, /ai/status/facts, /ai/status/banner, /ai/sidecar-info, /ai/health",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const lock = sidecarLock(ctx);
      const status = await ai(ctx, "status", "GET", "/status");
      const facts = await ai(ctx, "facts", "GET", "/status/facts");
      const banner = await ai(ctx, "banner", "GET", "/status/banner");
      const info = await ai(ctx, "sidecar info", "GET", "/sidecar-info");
      const health = await raw(ctx, "health without a session", { path: `${AI}/health` });
      const rows = list(facts.body, "items");
      await ctx.verify("a ready assistant", [
        same("the status", text(status.body, "status"), "ready"),
        same("the agent is Claude Code", text(status.body, "provider"), "claude"),
        same("the port is the sidecar's lock", pick(status.body, "port"), lock?.port),
        same("the process state", [pick(status.body, "isRunning"), pick(status.body, "hasGivenUp"), pick(status.body, "disabled")], [true, false, false]),
        same("nothing waits", [pick(status.body, "pendingApprovals"), pick(status.body, "workingConversations")], [0, 0]),
        same("the status says it is never cached", status.status, 200),
        same("six rows, in order", rows.map((row) => text(row, "id")), ["state", "agent", "scope", "mode", "builder", "sidecar"]),
        same("the sidecar row shows localhost and the port, copyable", [text(rows[5], "value"), pick(rows[5], "copy")], [`localhost:${lock?.port}`, true]),
        same("no banner when all is well", banner.status, 204),
        same("the probe", [pick(info.body, "isRunning"), pick(info.body, "hasGivenUp"), pick(info.body, "disabled")], [true, false, false]),
        same("the probe leaks neither the port nor a credential", Object.keys(info.body ?? {}).sort(), ["disabled", "hasGivenUp", "isRunning"]),
      ]);
      recordRaw(ctx, health, [same("health answers 200 with no session", health.status, 200), same("health body", health.json, { ok: true, module: "ai" })]);
    },
  },
  {
    id: "a-restart-gives-a-new-sidecar-and-keeps-what-you-set",
    title: "Restart assistant stops the sidecar and starts another on a new port, and the settings and the transcripts stay",
    entryPoint: "POST /ai/sidecar/restart, the Overview banner button",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const before = sidecarLock(ctx);
      await ai(ctx, "set Thinking to low", "PUT", "/settings", { body: { thinking: "low" } });
      const restart = await ai(ctx, "restart", "POST", "/sidecar/restart");
      const after = await until(() => {
        const lock = sidecarLock(ctx);
        return lock !== null && lock.pid !== before?.pid ? lock : null;
      });
      const ready = await statusIs(ctx, READY, 60_000);
      const settings = await ai(ctx, "settings", "GET", "/settings");
      await ctx.verify("a new sidecar", [
        same("the restart answers 2xx", restart.status !== null && restart.status < 300, true),
        check("a new process", after !== null && after !== undefined && after.pid !== before?.pid, `${before?.pid} -> ${after ? after.pid : "none"}`),
        check("the old process is gone", before !== null && !alive(before.pid), `pid ${before?.pid}`),
        same("the assistant is ready again", text(ready.status, "status"), "ready"),
        same("the status reports the new port", pick(ready.status, "port"), after ? after.port : null),
        same("Thinking is still low", text(settings.body, "thinking"), "low"),
      ]);
    },
  },
  {
    id: "a-sidecar-that-keeps-dying-gives-up-and-the-banner-offers-a-restart",
    title: "a sidecar killed again and again is restarted until the budget is spent, then the Overview says it is offline with Restart assistant, and the restart brings it back",
    entryPoint: "GET /ai/status/banner, the Overview banner, POST /ai/sidecar/restart",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const first = sidecarLock(ctx);
      process.kill(first?.pid ?? 0, "SIGKILL");
      const revived = await until(() => {
        const lock = sidecarLock(ctx);
        return lock && lock.pid !== first?.pid && alive(lock.pid) ? lock : null;
      }, { timeoutMs: 40_000 });
      const readyAgain = await statusIs(ctx, READY, 40_000);
      await ctx.verify("one crash is absorbed", [
        check("a new sidecar came up by itself", Boolean(revived), `${first?.pid} -> ${revived ? revived.pid : "none"}`),
        same("the assistant is ready", text(readyAgain.status, "status"), "ready"),
      ]);
      let gaveUp = false;
      for (let attempt = 0; attempt < 8 && !gaveUp; attempt += 1) {
        const lock = sidecarLock(ctx);
        if (lock && alive(lock.pid)) process.kill(lock.pid, "SIGKILL");
        await pause(1500);
        const state = await ai(ctx, "has it given up", "GET", "/status");
        gaveUp = pick(state.body, "hasGivenUp") === true;
      }
      const offline = await ai(ctx, "status", "GET", "/status");
      const banner = await ai(ctx, "banner", "GET", "/status/banner");
      await ctx.verify("the budget is spent", [
        same("the status is offline", text(offline.body, "status"), "offline"),
        same("the backend says it gave up", pick(offline.body, "hasGivenUp"), true),
        same("the banner is the offline one", [text(banner.body, "title"), text(banner.body, "actions", "0", "target", "url") || list(banner.body, "actions").map((a) => text(a, "target", "url"))[0]], ["$dms_ai.status.banner.offline.title", "/ai/sidecar/restart"]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the Overview says so", [
        pageHas(tab, "the banner", /The assistant is offline/),
        pageHas(tab, "its explanation", /Its sidecar isn't running\. Restart it to use the assistant again\./),
        pageHas(tab, "the status row", /Status\s*Offline/),
        pageHas(tab, "the sidecar row", /Sidecar\s*Not running/),
      ]);
      await tab.click({ role: "button", name: "Restart assistant" });
      const back = await statusIs(ctx, READY, 60_000);
      await ctx.verify("the button restarts it", [same("ready again", text(back.status, "status"), "ready"), tab.visible({ role: "button", name: "Restart assistant" }, { hidden: true, timeoutMs: 30_000 })]);
    },
  },
  {
    id: "dms-ai-0-starts-the-backend-without-a-sidecar",
    title: "DMS_AI=0 starts the backend with no sidecar: the status is offline and disabled, the banner has no restart button, and every route that needs the sidecar answers 503 or empty figures",
    entryPoint: "DMS_AI=0, GET /ai/status, /ai/status/banner, /ai/settings, /ai/metrics/*, the Overview",
    async run(/** @type {Ctx} */ ctx) {
      await withEnv(ctx, { DMS_AI: "0" }, async () => {
        const status = await ai(ctx, "status", "GET", "/status");
        const banner = await ai(ctx, "banner", "GET", "/status/banner");
        const info = await ai(ctx, "sidecar info", "GET", "/sidecar-info");
        const settings = await ai(ctx, "settings", "GET", "/settings");
        const put = await ai(ctx, "settings write", "PUT", "/settings", { body: { thinking: "low" } });
        const skills = await ai(ctx, "skills", "GET", "/skills/catalog");
        const kpi = await ai(ctx, "a figure", "GET", "/metrics/kpi/actions");
        const lock = sidecarLock(ctx);
        await ctx.verify("no sidecar", [
          same("offline", text(status.body, "status"), "offline"),
          same("disabled and not running", [pick(status.body, "disabled"), pick(status.body, "isRunning")], [true, false]),
          same("the probe agrees and does not start one", [pick(info.body, "disabled"), pick(info.body, "isRunning")], [true, false]),
          same("no sidecar was spawned", lock === null || !alive(lock.pid), true),
          same("the banner says the configuration turned it off", text(banner.body, "description"), "$dms_ai.status.banner.offline.disabled"),
          same("the banner carries no restart action", list(banner.body, "actions").length, 0),
          same("settings are unavailable", settings.status, 503),
          same("a write is unavailable too", put.status, 503),
          same("the skills table is unavailable", skills.status, 503),
          same("a figure answers empty, not an error", kpi.status, 200),
        ]);
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/overview");
        await ctx.verify("the Overview", [
          pageHas(tab, "says it is turned off", /Its sidecar is turned off in this module's configuration\./),
          pageHas(tab, "has no Restart assistant button", /Restart assistant/, false),
        ]);
      });
      const back = await statusIs(ctx, READY, 60_000);
      await ctx.verify("without the variable it starts again", [same("ready", text(back.status, "status"), "ready")]);
    },
  },
  {
    id: "a-backend-that-crashed-leaves-no-sidecar-for-long",
    title: "stopping the project stops the sidecar, and a sidecar left behind by a killed backend is stopped by the next start",
    entryPoint: "SIGTERM and SIGKILL of the backend, the next project start",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const backend = ctx.state.processes.find((entry) => entry.name === "backend");
      const left = sidecarLock(ctx);
      process.kill(backend?.pid ?? 0, "SIGKILL");
      await pause(1500);
      const survived = left !== null && alive(left.pid);
      await ctx.restartBackend();
      const ready = await statusIs(ctx, READY, 60_000);
      const now = sidecarLock(ctx);
      const gone = await until(() => left !== null && !alive(left.pid), { timeoutMs: 30_000 });
      await ctx.verify("the crash leaves one behind and the next start removes it", [
        check("the killed backend's sidecar was still running", survived, `pid ${left?.pid}`),
        check("the next start stopped it", Boolean(gone), `pid ${left?.pid}`),
        check("a new one runs", now !== null && now.pid !== left?.pid && alive(now.pid), `${left?.pid} -> ${now?.pid}`),
        same("ready", text(ready.status, "status"), "ready"),
      ]);
      const before = sidecarLock(ctx);
      const live = ctx.state.processes.find((entry) => entry.name === "backend");
      process.kill(live?.pid ?? 0, "SIGTERM");
      const stopped = await until(() => before !== null && !alive(before.pid), { timeoutMs: 30_000 });
      await ctx.verify("stopping the project stops the sidecar", [check("the sidecar is gone", Boolean(stopped), `pid ${before?.pid}`)]);
      await ctx.restartBackend();
    },
  },
]);

export { parseJson };
