import { guarded } from "../guard.mjs";
import { ai, freshSidecar, list, pageHas, pick, same, selected } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "an-unused-assistant-reads-zero-everywhere",
    title: "on a new project the Overview shows its status rows, four key figures at zero, an empty activity chart and empty recent changes and top tools, and the metric routes answer zero",
    entryPoint: "/modules/ai/overview, GET /ai/metrics/*",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const kpis = [];
      for (const metric of ["actions", "changes", "approved", "undone"]) kpis.push([metric, (await ai(ctx, `kpi ${metric}`, "GET", `/metrics/kpi/${metric}`)).body]);
      const series = await ai(ctx, "series", "GET", "/metrics/series");
      const allowed = await ai(ctx, "allowed", "GET", "/metrics/allowed");
      const top = await ai(ctx, "top tools", "GET", "/metrics/top-tools");
      await ctx.verify("the figures", [
        same("every figure is zero", kpis.map(([metric, body]) => [metric, pick(body, "value")]), [["actions", 0], ["changes", 0], ["approved", 0], ["undone", 0]]),
        same("the chart has no action on any day", list(series.body, "series").flatMap((s) => list(s, "data")).every((day) => pick(day, "y") === 0), true),
        same("nothing was allowed", list(allowed.body, "items").length, 0),
        same("no top tools", list(top.body, "items").length, 0),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the page", [
        pageHas(tab, "the status rows", /Status\s*Ready\s*Agent\s*Claude Code\s*Default scope\s*Code mode\s*Safe needs Builder\s*Approvals\s*Ask first\s*Builder\s*Not installed\s*Sidecar\s*localhost:\d+/),
        pageHas(tab, "the four figures", /Actions\s*0[\s\S]*Change sets\s*0[\s\S]*Approved by you\s*0[\s\S]*Undone\s*0/),
        pageHas(tab, "their captions", /Tool calls, Builder operations included[\s\S]*Turns that changed files, undone too[\s\S]*Requests you allowed when asked[\s\S]*Change sets rolled back/),
        pageHas(tab, "the empty chart", /No action over this period/),
        pageHas(tab, "no change sets", /No changes yet/),
        pageHas(tab, "no tools", /No tool ran over this period/),
        pageHas(tab, "deletions always ask", /Deletions always ask, in every mode/),
        pageHas(tab, "no banner", /The assistant is offline|2 requests are waiting|last turn failed/, false),
      ]);
    },
  },
  {
    id: "the-period-and-the-comparison-are-remembered-and-shared-with-activity",
    title: "the Overview opens on 7D with vs previous period, the comparison menu offers three choices, No comparison hides the deltas, and the period picked carries to the Activity page after a reload",
    entryPoint: "/modules/ai/overview, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the defaults", [
        selected(tab, { role: "radio", name: "Last 7 days" }, true),
        selected(tab, { role: "radio", name: "Last 24 hours" }, false),
        pageHas(tab, "the comparison", /vs previous period|vs [A-Z][a-z]{2} \d+ – \d+/),
        pageHas(tab, "the deltas", /0\.0% vs 0/),
      ]);
      await tab.click({ role: "radio", name: "Last 30 days" });
      await ctx.verify("30 days", [selected(tab, { role: "radio", name: "Last 30 days" }, true), pageHas(tab, "the chart is labelled for 30 days", /Last 30 days/)]);
      await tab.reload();
      await ctx.verify("a reload remembers it", [selected(tab, { role: "radio", name: "Last 30 days" }, true)]);
      await tab.goto("/modules/ai/activity");
      await ctx.verify("Activity opens on the same period", [selected(tab, { role: "radio", name: "Last 30 days" }, true)]);
      await tab.goto("/modules/ai/overview");
      await tab.click({ role: "radio", name: "Last 24 hours" });
      await ctx.verify("24 hours", [selected(tab, { role: "radio", name: "Last 24 hours" }, true)]);
    },
  },
]);
