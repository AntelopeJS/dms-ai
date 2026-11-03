import { guarded } from "../guard.mjs";
import { writeFileSync } from "node:fs";
import { ai, check, freshSidecar, list, pageHas, pick, same, selected, shownBy, sidecarPath, statusIs, stopBackend, text, until } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

const DEFAULTS = {
  provider: "claude",
  mode: "normal",
  thinking: "medium",
  claudeModel: "claude-opus-5-5",
  generationMode: "safe",
  allowLocalSkills: false,
  alwaysAskDependencies: true,
  alwaysAskBlockRemoval: true,
  requestTimeoutMinutes: "5",
  notifyRequests: true,
  checkpointRetentionDays: "30",
  alwaysAskDeletions: true,
};

/** @param {Ctx} ctx @param {string} label */
async function settings(ctx, label) {
  return (await ai(ctx, label, "GET", "/settings")).body;
}

/** @param {unknown} body */
function picked(body) {
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, pick(body, key)]));
}

export const journeys = guarded([
  {
    id: "the-defaults-are-the-documented-ones",
    title: "a new install answers the documented defaults, and says what this install can do",
    entryPoint: "GET /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const body = await settings(ctx, "read the defaults");
      await ctx.verify("the table of the Settings page", [
        same("every default", picked(body), DEFAULTS),
        same("the capabilities: no Builder, Claude ready, Codex not", [pick(body, "builderAvailable"), pick(body, "providers", "claude", "available"), pick(body, "providers", "codex", "available")], [false, true, false]),
        check("Codex says why", text(body, "providers", "codex", "reason").includes("Sign in with ChatGPT"), text(body, "providers", "codex", "reason")),
        same("the defaults the form can reset to", [pick(body, "defaults", "thinking"), pick(body, "defaults", "requestTimeoutMinutes"), pick(body, "defaults", "checkpointRetentionDays")], ["medium", 5, 30]),
      ]);
    },
  },
  {
    id: "every-setting-saves-alone-and-survives-a-restart",
    title: "each field saves on its own, the others stay, and all of them survive a sidecar restart and a backend restart",
    entryPoint: "PUT /ai/settings, POST /ai/sidecar/restart",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const changes = [
        ["provider", "codex"], ["mode", "plan"], ["thinking", "off"], ["claudeModel", "claude-test-model"], ["generationMode", "vibe"], ["allowLocalSkills", true],
        ["alwaysAskDependencies", false], ["alwaysAskBlockRemoval", false], ["requestTimeoutMinutes", "30"], ["notifyRequests", false], ["checkpointRetentionDays", "90"],
      ];
      const expected = { ...DEFAULTS };
      for (const [key, value] of changes) {
        const answer = await ai(ctx, `save ${key}`, "PUT", "/settings", { body: { [key]: value } });
        expected[key] = value;
        await ctx.verify(`${key} saved alone`, [same("the answer is the whole form", picked(answer.body), expected), same("a read agrees", picked(await settings(ctx, `read after ${key}`)), expected)]);
      }
      await ai(ctx, "restart the sidecar", "POST", "/sidecar/restart");
      await until(async () => text((await ai(ctx, "ready", "GET", "/status")).body, "status") === "ready", { timeoutMs: 60_000 });
      await ctx.verify("after a sidecar restart", [same("the same settings", picked(await settings(ctx, "read")), expected)]);
      await ctx.restartBackend();
      await until(async () => text((await ai(ctx, "ready", "GET", "/status")).body, "status") === "ready", { timeoutMs: 60_000 });
      await ctx.verify("after a backend restart", [same("the same settings", picked(await settings(ctx, "read")), expected)]);
    },
  },
  {
    id: "a-stored-settings-file-is-read-back-by-the-next-start",
    title: "a settings file left by an earlier run is read when the assistant starts: each field it holds is used, and a value or a key the file should not hold is ignored while the default stays",
    entryPoint: "<project>/node_modules/.cache/dms-ai/settings.json, GET /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      await stopBackend(ctx);
      writeFileSync(sidecarPath(ctx, "settings.json"), JSON.stringify({ thinking: "high", mode: "acceptEdits", generationMode: "vibe", claudeModel: "claude-from-file", allowLocalSkills: true, requestTimeoutMinutes: 30, checkpointRetentionDays: 7, notifyRequests: false, provider: "nobody", alwaysAskDependencies: "yes", unknownKey: 1 }));
      await ctx.restartBackend();
      await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
      const body = await settings(ctx, "read what the file holds");
      await ctx.verify("the file", [
        same("the fields it holds", [pick(body, "thinking"), pick(body, "mode"), pick(body, "generationMode"), pick(body, "claudeModel"), pick(body, "allowLocalSkills"), pick(body, "requestTimeoutMinutes"), pick(body, "checkpointRetentionDays"), pick(body, "notifyRequests")], ["high", "acceptEdits", "vibe", "claude-from-file", true, "30", "7", false]),
        same("an unknown provider keeps the default", pick(body, "provider"), "claude"),
        same("a value of the wrong type keeps the default", pick(body, "alwaysAskDependencies"), true),
        same("an unknown key is not served", pick(body, "unknownKey"), undefined),
      ]);
    },
  },
  {
    id: "a-value-outside-the-options-is-refused-and-changes-nothing",
    title: "a value outside the options answers 400 with its reason, nothing changes, an unknown field is ignored and the deletions switch cannot be turned off",
    entryPoint: "PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const refused = [
        [{ thinking: "bogus" }, /off.*low.*medium.*high/s],
        [{ mode: "full-auto" }, /normal.*acceptEdits.*plan/s],
        [{ generationMode: "code" }, /safe.*vibe/s],
        [{ requestTimeoutMinutes: "7" }, /5\|15\|30/],
        [{ checkpointRetentionDays: "8" }, /7\|30\|90/],
        [{ claudeModel: "" }, /Too small/],
      ];
      const checks = [];
      for (const [body, reason] of refused) {
        const answer = await ai(ctx, `refuse ${JSON.stringify(body)}`, "PUT", "/settings", { body });
        checks.push(same(`${JSON.stringify(body)} is 400`, answer.status, 400), check(`${JSON.stringify(body)} says why`, reason.test(text(answer.body, "message")), text(answer.body, "message")));
      }
      await ctx.verify("every refusal", checks);
      const odd = await ai(ctx, "unknown field and the locked switch", "PUT", "/settings", { body: { nonsense: 1, alwaysAskDeletions: false } });
      await ctx.verify("what cannot be written", [
        same("200", odd.status, 200),
        same("deletions still ask", pick(odd.body, "alwaysAskDeletions"), true),
        same("the unknown field is not stored", pick(odd.body, "nonsense"), undefined),
        same("nothing else moved", picked(await settings(ctx, "read")), DEFAULTS),
      ]);
    },
  },
  {
    id: "the-page-saves-each-change-as-you-make-it",
    title: "the Settings page saves a choice, a switch and a menu the moment you change them, and a reload shows them kept",
    entryPoint: "/modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("the page", [pageHas(tab, "says it saves instantly", /Saved instantly/), pageHas(tab, "has the usage section", /Tokens · last 14 days/i)]);
      await tab.click({ role: "radio", name: "Plan only" });
      await tab.click({ role: "radio", name: "Low" });
      await tab.click({ role: "switch", name: "Adding or removing dependencies" });
      await tab.click({ role: "switch", name: "Notify me in the DMS" });
      await tab.click({ role: "switch", name: "Machine-local skills" });
      await tab.click({ role: "combobox", name: "Deny after" });
      await tab.click({ role: "option", name: "15 minutes" });
      await tab.click({ role: "combobox", name: "Checkpoints" });
      await tab.click({ role: "option", name: "Keep 90 days" });
      const saved = await until(async () => {
        const body = await settings(ctx, "read");
        return pick(body, "mode") === "plan" && pick(body, "checkpointRetentionDays") === "90" && pick(body, "requestTimeoutMinutes") === "15";
      });
      const body = await settings(ctx, "read the saved form");
      await ctx.verify("every choice reached the sidecar", [
        check("saved", saved, saved),
        same("mode", pick(body, "mode"), "plan"),
        same("thinking", pick(body, "thinking"), "low"),
        same("dependencies switch", pick(body, "alwaysAskDependencies"), false),
        same("notify switch", pick(body, "notifyRequests"), false),
        same("local skills switch", pick(body, "allowLocalSkills"), true),
        same("deny after", pick(body, "requestTimeoutMinutes"), "15"),
        same("checkpoints", pick(body, "checkpointRetentionDays"), "90"),
        same("the untouched switch", pick(body, "alwaysAskBlockRemoval"), true),
        same("the untouched scope", pick(body, "generationMode"), "safe"),
      ]);
      await tab.reload();
      await ctx.verify("a reload shows them", [
        selected(tab, { role: "radio", name: "Plan only" }, true),
        selected(tab, { role: "radio", name: "Ask first" }, false),
        selected(tab, { role: "radio", name: "Low" }, true),
        selected(tab, { role: "switch", name: "Adding or removing dependencies" }, false),
        selected(tab, { role: "switch", name: "Removing or moving Builder blocks" }, true),
        selected(tab, { role: "switch", name: "Notify me in the DMS" }, false),
        selected(tab, { role: "switch", name: "Machine-local skills" }, true),
        shownBy(tab, { role: "combobox", name: "Deny after" }, "15 minutes"),
        shownBy(tab, { role: "combobox", name: "Checkpoints" }, "Keep 90 days"),
      ]);
    },
  },
  {
    id: "the-page-disables-what-this-machine-cannot-do",
    title: "Codex, Full auto and Safe mode are disabled with their reason, and the deletions switch is locked on",
    entryPoint: "/modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("the disabled options", [
        tab.enabled({ role: "radio", name: "Codex" }, { disabled: true }),
        tab.enabled({ role: "radio", name: "Full auto" }, { disabled: true }),
        tab.enabled({ role: "radio", name: "Safe mode · recommended" }, { disabled: true }),
        tab.enabled({ role: "radio", name: "Code mode" }),
        tab.enabled({ role: "radio", name: "Claude Code" }),
        pageHas(tab, "Codex says why", /Sign in with ChatGPT in Assistant › Settings to run Codex on your ChatGPT plan\./),
        pageHas(tab, "Full auto is not a default", /Not available as a default\. Turn it on per chat, for a limited time\./),
        pageHas(tab, "Safe mode needs the Builder", /Needs the dms-builder module, which isn't loaded\./),
        pageHas(tab, "deletions are locked", /Deleting pages, tables, fields or queries · locked/),
        tab.count({ role: "switch", name: "Deleting pages, tables, fields or queries" }, 0),
        selected(tab, { role: "radio", name: "Claude Code" }, true),
        selected(tab, { role: "radio", name: "Medium" }, true),
      ]);
      const chosen = list((await ai(ctx, "read", "GET", "/settings")).body, "x").length;
      await ctx.verify("nothing was changed by looking", [same("defaults", picked(await settings(ctx, "read")), DEFAULTS), same("no rows", chosen, 0)]);
    },
  },
  {
    id: "usage-counts-nothing-before-a-conversation",
    title: "the Usage section and its routes count zero tokens and zero conversations over 14 days before any turn ran",
    entryPoint: "GET /ai/metrics/usage, /ai/metrics/usage/summary, the Usage section",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const usage = await ai(ctx, "usage", "GET", "/metrics/usage");
      const summary = await ai(ctx, "summary", "GET", "/metrics/usage/summary");
      const days = list(usage.body, "series").flatMap((series) => list(series, "data"));
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("zero", [
        same("a total of zero", pick(usage.body, "value"), 0),
        same("fourteen days", days.length, 14),
        same("every day is zero", days.every((day) => pick(day, "y") === 0), true),
        same("the two summary rows", list(summary.body, "items").map((row) => [text(row, "id"), pick(row, "value")]), [["tokens", 0], ["conversations", 0]]),
        pageHas(tab, "the section", /Tokens\s*0\s*Conversations\s*0/i),
      ]);
    },
  },
]);
