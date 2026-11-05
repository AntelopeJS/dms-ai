import { guarded } from "../guard.mjs";
import { writeFileSync } from "node:fs";
import { ai, check, freshSidecar, pick, same, sidecarPath, statusIs, stopBackend, text, until } from "../ai.mjs";
import { DEFAULTS, settings, picked } from "./settings/helpers.mjs";
import { pageJourneys } from "./settings/page.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

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
        [{ requestTimeoutMinutes: "14" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "45" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "60" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: "0" }, /5\|15\|30/],
        [{ requestTimeoutMinutes: 60 }, /5\|15\|30/],
        [{ checkpointRetentionDays: "8" }, /7\|30\|90/],
        [{ checkpointRetentionDays: "14" }, /7\|30\|90/],
        [{ checkpointRetentionDays: "1" }, /7\|30\|90/],
        [{ checkpointRetentionDays: "180" }, /7\|30\|90/],
        [{ checkpointRetentionDays: 180 }, /7\|30\|90/],
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
  ...pageJourneys,
]);
