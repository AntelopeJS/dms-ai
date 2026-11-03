import { guarded } from "../guard.mjs";
import { ai, check, freshSidecar, pageHas, selected, raw, recordRaw, same, text, withEnv, AI } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

const CSV_HEADER = "time,tool,target,agent,allowed_by,result,result_detail,change_set,conversation_id,conversation,duration_ms,read_only,auto_fix\r\n";

export const journeys = guarded([
  {
    id: "an-empty-log-says-so-and-exports-its-header",
    title: "with no tool call yet the Activity page says No activity yet, shows its tabs, periods and filters, and the CSV export holds only its header",
    entryPoint: "/modules/ai/activity, GET /ai/activity, /ai/activity/export.csv",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const rows = await ai(ctx, "the log", "GET", "/activity");
      const csv = await raw(ctx, "the CSV", { path: `${AI}/activity/export.csv`, as: "admin" });
      const record = await ai(ctx, "an unknown record", "GET", "/activity/nope");
      await ctx.verify("the API", [
        same("no rows", rows.body, { results: [], total: 0 }),
        same("a record that does not exist", [record.status, text(record.body, "message")], [404, "Unknown activity."]),
      ]);
      recordRaw(ctx, csv, [
        same("the CSV is the header alone", csv.text, CSV_HEADER),
        check("served as a CSV", /text\/csv/.test(csv.headers["content-type"] ?? ""), csv.headers["content-type"]),
        check("as a download", /attachment/.test(csv.headers["content-disposition"] ?? ""), csv.headers["content-disposition"]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [
        pageHas(tab, "the empty state", /No activity yet/),
        pageHas(tab, "and what it will hold", /Every tool the assistant uses lands here, with who allowed it and what came out\./),
        tab.visible({ role: "radio", name: "Last 24 hours" }),
        tab.visible({ role: "radio", name: "Last 7 days" }),
        tab.visible({ role: "radio", name: "Last 30 days" }),
        selected(tab, { role: "radio", name: "All time" }, true),
        selected(tab, { role: "radio", name: "Last 7 days" }, false),
        pageHas(tab, "the tabs", /All\s*Changed files\s*Asked you\s*Denied or blocked\s*Failed/),
        tab.visible({ role: "button", name: "Export CSV" }),
      ]);
    },
  },
  {
    id: "the-log-says-when-the-assistant-is-down",
    title: "with the sidecar off the Activity page says Can't reach the assistant and that this is not an empty log",
    entryPoint: "DMS_AI=0, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await withEnv(ctx, { DMS_AI: "0" }, async () => {
        const rows = await ai(ctx, "the log", "GET", "/activity");
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/activity");
        await ctx.verify("down", [
          same("the route answers 503", rows.status, 503),
          pageHas(tab, "the offline state", /Can't reach the assistant/),
          pageHas(tab, "its reason", /The audit log comes from the assistant, which isn't running\. This isn't an empty log\./),
          pageHas(tab, "it is not the empty state", /No activity yet/, false),
        ]);
      });
    },
  },
]);
