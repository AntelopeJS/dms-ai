import { guarded } from "../guard.mjs";
import { ai, check, choose, same, selected, text, until } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** The introduction's first look: the owner opens the Overview, reads the status and changes a default. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "an owner opens the Assistant Overview, reads Ready and Claude Code, changes Thinking to High and sees it kept after a reload",
    entryPoint: "/modules/ai/overview, /modules/ai/settings, GET /ai/status, PUT /ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      const status = await ai(ctx, "read the status", "GET", "/status");
      await ctx.verify("the sidecar is ready", [
        same("the status", text(status.body, "status"), "ready"),
        same("the agent", text(status.body, "provider"), "claude"),
      ], { critical: true });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the Overview shows the status rows", [
        tab.shows(/Ready/, { timeoutMs: 30_000 }),
        tab.shows(/Claude Code/),
        tab.shows(/localhost:\d+/),
      ]);
      await tab.goto("/modules/ai/settings");
      await choose(tab, { role: "radio", name: "High" });
      const saved = await until(async () => text((await ai(ctx, "read the settings", "GET", "/settings")).body, "thinking") === "high", { timeoutMs: 45_000, everyMs: 1500 });
      await ctx.verify("the choice is saved as you make it", [check("thinking is high through the API", saved, saved)], { critical: true });
      await tab.reload();
      await ctx.verify("a reload keeps it", [selected(tab, { role: "radio", name: "High" }, true), selected(tab, { role: "radio", name: "Medium" }, false)]);
    },
  },
]);
