import { guarded } from "../guard.mjs";
import { ai, check, choose, freshSidecar, list, pageHas, periodQuery, pick, same, selected, text } from "../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../sample.mjs";
import { seedStore } from "../seed.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** The sample, seeded: 24 calls in the last seven days, 3 ten days ago and 2 forty days ago, 3 change sets. */
async function seedSample(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
  return now;
}

/** @param {Ctx} ctx @param {string} path @param {string} query @returns {Promise<unknown>} the body */
async function metric(ctx, path, query) {
  return (await ai(ctx, `metric ${path}`, "GET", `/metrics/${path}?${query}`)).body;
}

export const journeys = guarded([
  {
    id: "an-unused-assistant-reads-zero-everywhere",
    title: "on a new project the Overview shows its status rows, four key figures at zero, an empty activity chart and empty recent changes and top tools, and the metric routes answer zero",
    entryPoint: "/modules/ai/overview, GET /ai/metrics/*",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const kpis = [];
      for (const name of ["actions", "change-sets", "approved", "undone"]) kpis.push([name, (await ai(ctx, `kpi ${name}`, "GET", `/metrics/kpi/${name}`)).body]);
      const series = await ai(ctx, "series", "GET", "/metrics/series");
      const allowed = await ai(ctx, "allowed", "GET", "/metrics/allowed");
      const top = await ai(ctx, "top tools", "GET", "/metrics/top-tools");
      await ctx.verify("the figures", [
        same("every figure is zero", kpis.map(([name, body]) => [name, pick(body, "value")]), [["actions", 0], ["change-sets", 0], ["approved", 0], ["undone", 0]]),
        same("the chart has no action on any day", list(series.body, "series").flatMap((s) => list(s, "data")).every((day) => pick(day, "y") === 0), true),
        same("nothing was allowed", list(allowed.body, "items").length, 0),
        same("no top tools", list(top.body, "items").length, 0),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the page", [
        pageHas(tab, "the status rows", /Status\s*Ready\s*Agent\s*Claude Code\s*Default scope\s*Code mode\s*Safe needs Builder\s*Approvals\s*Ask first\s*Builder\s*Not installed\s*Sidecar\s*localhost:\d+/),
        pageHas(tab, "the four figures", /Actions\s*0\s*\S*\s*0\.0% vs 0\s*Tool calls, Builder operations included\s*Change sets\s*0\s*\S*\s*0\.0% vs 0\s*Turns that changed files, undone too\s*Approved by you\s*0\s*\S*\s*0\.0% vs 0\s*Requests you allowed when asked\s*Undone\s*0\s*\S*\s*0\.0% vs 0\s*Change sets rolled back/i),
        pageHas(tab, "the empty chart", /No action over this period/),
        pageHas(tab, "no change sets", /No changes yet/),
        pageHas(tab, "no tools", /No tool ran over this period/),
        pageHas(tab, "deletions always ask", /Deletions always ask, in every mode/),
        pageHas(tab, "the section titles", /Activity[\s\S]*How actions were allowed[\s\S]*Recent change sets[\s\S]*All changes[\s\S]*Top tools[\s\S]*Runs over the selected period/i),
        pageHas(tab, "no banner", /The assistant is offline|2 requests are waiting|last turn failed/, false),
      ]);
    },
  },
  {
    id: "the-figures-count-the-seeded-log-exactly",
    title: "over a seeded log the key figures, the chart, the ways actions were allowed, the deletions line and the top five tools count exactly what the log holds in 24 hours, 7 days and 30 days, with the trend against the period before",
    entryPoint: "GET /ai/metrics/*, /modules/ai/overview",
    async run(/** @type {Ctx} */ ctx) {
      const now = await seedSample(ctx);
      const week = periodQuery(now, 7);
      const actions = await metric(ctx, "kpi/actions", week);
      const sets = await metric(ctx, "kpi/change-sets", week);
      const approved = await metric(ctx, "kpi/approved", week);
      const undone = await metric(ctx, "kpi/undone", week);
      const series = await metric(ctx, "series", week);
      const allowed = await metric(ctx, "allowed", week);
      const top = await metric(ctx, "top-tools", `${week}&limit=5`);
      const sum = (/** @type {unknown} */ numbers) => (Array.isArray(numbers) ? numbers.reduce((/** @type {number} */ total, /** @type {unknown} */ n) => total + Number(n), 0) : -1);
      await ctx.verify("7 days", [
        same("actions: 24 against 3 before, +700%", [pick(actions, "value"), pick(actions, "previousValue"), pick(actions, "delta")], [24, 3, 700]),
        same("the sparkline adds up to the value", sum(pick(actions, "sparkline")), 24),
        same("change sets: 3, none before, no trend from zero", [pick(sets, "value"), pick(sets, "previousValue"), pick(sets, "delta")], [3, 0, undefined]),
        same("approved by you: 4 of the 8 asked, 50%", [pick(approved, "value"), text(approved, "caption")], [4, "4 / 8 · 50%"]),
        same("undone: none", pick(undone, "value"), 0),
        same("the chart totals the actions and compares with the period before", [pick(series, "value"), pick(series, "previousValue"), list(series, "comparisonSeries").length], [24, 3, 1]),
        same("how actions were allowed, in order", list(allowed, "items").map((item) => [text(item, "id"), pick(item, "value")]), [["read_auto", 10], ["builder_auto", 2], ["approved", 4], ["rule", 3], ["full_auto", 1], ["blocked", 1], ["denied", 2], ["expired", 1], ["deletions_asked", 1]]),
        same("read-only against 3 before, +233.3%", pick(list(allowed, "items")[0], "delta"), 233.3),
        same("a way with none before shows no trend", pick(list(allowed, "items")[1], "delta"), undefined),
        same("the five most used tools", list(top, "items").map((item) => [text(item, "id"), pick(item, "value"), text(item, "description")]), [["Bash", 6, "$dms_ai.activity.tool_source.code"], ["Skill", 5, "$dms_ai.activity.tool_source.assistant"], ["Edit", 4, "$dms_ai.activity.tool_source.code"], ["Read", 3, "$dms_ai.activity.tool_source.code"], ["BuilderAddBlock", 2, "$dms_ai.activity.tool_source.builder"]]),
        same("Read: 3 against 2 before, +50%", pick(list(top, "items")[3], "delta"), 50),
      ]);
      const day = await metric(ctx, "kpi/actions", periodQuery(now, 1));
      const month = await metric(ctx, "kpi/actions", periodQuery(now, 30));
      await ctx.verify("24 hours and 30 days", [
        same("24 hours: 24, none the day before", [pick(day, "value"), pick(day, "previousValue")], [24, 0]),
        same("30 days: 27 against 2 before, +1250%", [pick(month, "value"), pick(month, "previousValue"), pick(month, "delta")], [27, 2, 1250]),
        same("30 days, the ways: read-only 13", pick(list(await metric(ctx, "allowed", periodQuery(now, 30)), "items")[0], "value"), 13),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the page, 7 days", [
        pageHas(tab, "Actions", /Actions\s*24\s*\S*\s*\+700\.0% vs 3\s*Tool calls, Builder operations included/i),
        pageHas(tab, "Change sets", /Change sets\s*3\s*\S*\s*vs 0\s*Turns that changed files, undone too/i),
        pageHas(tab, "Approved by you", /Approved by you\s*4\s*\S*\s*vs 0\s*Requests you allowed when asked/i),
        pageHas(tab, "Undone", /Undone\s*0\s*\S*\s*0\.0% vs 0\s*Change sets rolled back/i),
        pageHas(tab, "the ways, in order, numbered, with the trend of the first", /Read-only, automatic\s*10\s*\S*\s*\+233\.3%\s*2\s*Builder, automatic\s*2\s*—\s*3\s*Approved by you\s*4\s*—\s*4\s*Allowed by a rule\s*3\s*—\s*5\s*Full auto\s*1\s*—\s*6\s*Blocked · safe mode\s*1\s*—\s*7\s*Denied by you\s*2\s*—\s*8\s*Expired\s*1\s*—\s*9\s*Deletions asked\s*Deletions always ask, even in Full auto\s*1/i),
        pageHas(tab, "the top tools with their group and runs", /Top tools[\s\S]*Run command[\s\S]*6[\s\S]*Use skill[\s\S]*5[\s\S]*Edit file[\s\S]*4[\s\S]*Read file[\s\S]*3[\s\S]*Add block[\s\S]*2/i),
        pageHas(tab, "the recent change sets", /Recent change sets\s*3/i),
      ]);
      await choose(tab, { role: "radio", name: "Last 24 hours" });
      await ctx.verify("24 hours", [pageHas(tab, "Actions", /Actions\s*24\s*\S*\s*vs 0/i), pageHas(tab, "labelled", /Last 24 hours/)]);
      await choose(tab, { role: "radio", name: "Last 30 days" });
      await ctx.verify("30 days", [pageHas(tab, "Actions", /Actions\s*27\s*\S*\s*\+1,250\.0% vs 2/i)]);
    },
  },
  {
    id: "the-approved-and-undone-cards-show-their-share",
    title: "the Approved by you card shows the share of the requests you allowed, such as 4 / 8 · 50%, and the Undone card the share of the change sets rolled back",
    entryPoint: "GET /ai/metrics/kpi/approved, /modules/ai/overview",
    async run(/** @type {Ctx} */ ctx) {
      const now = await seedSample(ctx);
      const approved = await metric(ctx, "kpi/approved", periodQuery(now, 7));
      await ctx.verify("the route", [same("the caption of Approved by you", text(approved, "caption"), "4 / 8 · 50%")]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the page", [pageHas(tab, "shows the share on the card", /Approved by you\s*4[\s\S]*4 \/ 8 · 50%/i)]);
    },
  },
  {
    id: "the-comparison-menu-offers-three-choices-and-no-comparison-hides-the-deltas",
    title: "the comparison menu offers vs previous period, vs previous year and No comparison; No comparison removes every delta and the chart's comparison line, and the choice is remembered",
    entryPoint: "/modules/ai/overview",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      const menu = tab.page.getByRole("button", { name: /^Comparison:/ });
      await ctx.verify("the default", [pageHas(tab, "compares with the period before", /vs [A-Z][a-z]{2} \d+ – \d+/), pageHas(tab, "with deltas", /\+700\.0% vs 3/), check("the button names it", (await menu.first().getAttribute("aria-label")) !== undefined || (await menu.count()) === 1, await menu.count())]);
      await menu.first().click();
      await tab.snapshot("the comparison menu");
      await ctx.verify("the menu", [pageHas(tab, "offers the previous period", /vs previous period/), pageHas(tab, "the previous year", /vs previous year/), pageHas(tab, "and no comparison", /No comparison/)]);
      await tab.page.getByRole("menuitem", { name: "No comparison" }).first().click();
      await ctx.verify("No comparison", [pageHas(tab, "keeps the figures", /Actions\s*24/i), pageHas(tab, "drops the delta", /\+700\.0% vs 3/, false), pageHas(tab, "drops every comparison", /vs 0|vs 3|vs 2/, false), pageHas(tab, "the chart has no comparison line", /Comparison/, false)]);
      await tab.reload();
      await ctx.verify("a reload remembers it", [pageHas(tab, "still no delta", /\+700\.0% vs 3/, false), pageHas(tab, "and the figures", /Actions\s*24/i)]);
      await menu.first().click();
      await tab.page.getByRole("menuitem", { name: "vs previous year" }).first().click();
      await ctx.verify("vs previous year", [pageHas(tab, "compares with the year before: nothing then", /Actions\s*24\s*\S*\s*vs 0/i)]);
    },
  },
  {
    id: "the-period-and-the-comparison-are-remembered-and-shared-with-activity",
    title: "the Overview opens on 7D with vs previous period, the browser remembers the period picked and the Activity page opens on it after a reload",
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
      await choose(tab, { role: "radio", name: "Last 30 days" });
      await tab.reload();
      await ctx.verify("a reload remembers it", [selected(tab, { role: "radio", name: "Last 30 days" }, true)]);
      await tab.goto("/modules/ai/activity");
      await ctx.verify("Activity opens on the same period", [selected(tab, { role: "radio", name: "Last 30 days" }, true)]);
      await tab.goto("/modules/ai/overview");
      await choose(tab, { role: "radio", name: "Last 24 hours" });
      await ctx.verify("24 hours", [selected(tab, { role: "radio", name: "Last 24 hours" }, true)]);
    },
  },
]);
