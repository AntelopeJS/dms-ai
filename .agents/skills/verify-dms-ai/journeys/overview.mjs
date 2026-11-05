import { guarded } from "../guard.mjs";
import { ai, check, choose, clickUntil, freshSidecar, list, pageHas, periodQuery, pick, same, selected, text, until } from "../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../sample.mjs";
import { MS_DAY, seedStore } from "../seed.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** The sample, seeded: 44 records, 5 change sets. */
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
        same("actions: 31 against 6 before, +416.7%", [pick(actions, "value"), pick(actions, "previousValue"), pick(actions, "delta")], [31, 6, 416.7]),
        same("the sparkline adds up to the value", sum(pick(actions, "sparkline")), 31),
        same("change sets: 5, none before, no trend from zero", [pick(sets, "value"), pick(sets, "previousValue"), pick(sets, "delta")], [5, 0, undefined]),
        same("approved by you: 4 of the 8 asked, 50%", [pick(approved, "value"), text(approved, "caption")], [4, "4 / 8 · 50%"]),
        same("undone: none", pick(undone, "value"), 0),
        same("the chart totals the actions and compares with the period before", [pick(series, "value"), pick(series, "previousValue"), list(series, "comparisonSeries").length], [31, 6, 1]),
        same("how actions were allowed, in order", list(allowed, "items").map((item) => [text(item, "id"), pick(item, "value")]), [["read_auto", 17], ["builder_auto", 2], ["approved", 4], ["rule", 3], ["full_auto", 1], ["blocked", 1], ["denied", 2], ["expired", 1], ["deletions_asked", 1]]),
        same("read-only against 6 before, +183.3%", pick(list(allowed, "items")[0], "delta"), 183.3),
        same("a way with none before shows no trend", pick(list(allowed, "items")[1], "delta"), undefined),
        same("the five most used tools", list(top, "items").map((item) => [text(item, "id"), pick(item, "value"), text(item, "description")]), [["LS", 7, "$dms_ai.activity.tool_source.code"], ["Bash", 6, "$dms_ai.activity.tool_source.code"], ["Skill", 5, "$dms_ai.activity.tool_source.assistant"], ["Edit", 4, "$dms_ai.activity.tool_source.code"], ["Read", 3, "$dms_ai.activity.tool_source.code"]]),
        same("List folder: 7 against 3 before, +133.3%", pick(list(top, "items")[0], "delta"), 133.3),
        same("Read: 3 against 2 before, +50%", pick(list(top, "items")[4], "delta"), 50),
      ]);
      const recent = await ai(ctx, "the recent sets", "GET", "/recent-changes");
      await ctx.verify("the recent change sets", [same("the four latest of five, newest first", [list(recent.body, "results").map((row) => Number(pick(row, "number"))), pick(recent.body, "total")], [[5, 4, 3, 2], 4])]);
      const day = await metric(ctx, "kpi/actions", periodQuery(now, 1));
      const month = await metric(ctx, "kpi/actions", periodQuery(now, 30));
      await ctx.verify("24 hours and 30 days", [
        same("24 hours: 26 (the 2 at 23 hours, not the 3 at 25), 3 the day before", [pick(day, "value"), pick(day, "previousValue")], [26, 3]),
        same("30 days: 39 (the 2 at 29 days, not the 3 at 31) against 5 before, +680%", [pick(month, "value"), pick(month, "previousValue"), pick(month, "delta")], [39, 5, 680]),
        same("30 days, the ways: read-only 25", pick(list(await metric(ctx, "allowed", periodQuery(now, 30)), "items")[0], "value"), 25),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the page, 7 days", [
        pageHas(tab, "Actions", /Actions\s*31\s*\S*\s*\+416\.7%\s*vs 6\s*Tool calls, Builder operations included/i),
        pageHas(tab, "Change sets", /Change sets\s*5\s*\S*\s*vs 0\s*Turns that changed files, undone too/i),
        pageHas(tab, "Approved by you", /Approved by you\s*4\s*\S*\s*vs 0\s*Requests you allowed when asked/i),
        pageHas(tab, "Undone", /Undone\s*0\s*\S*\s*0\.0% vs 0\s*Change sets rolled back/i),
        pageHas(tab, "the ways, in order, numbered, with the trend of the first", /Read-only, automatic\s*17\s*\S*\s*\+183\.3%\s*2\s*Builder, automatic\s*2\s*—\s*3\s*Approved by you\s*4\s*—\s*4\s*Allowed by a rule\s*3\s*—\s*5\s*Full auto\s*1\s*—\s*6\s*Blocked · safe mode\s*1\s*—\s*7\s*Denied by you\s*2\s*—\s*8\s*Expired\s*1\s*—\s*9\s*Deletions asked\s*Deletions always ask, even in Full auto\s*1/i),
                pageHas(tab, "the top five with their group, runs and trend", /Top tools[\s\S]*1 List folder Code mode 7\s*\S*\s*\+133\.3%\s*2 Run command Code mode 6\s*—\s*3 Use skill Assistant 5\s*\S*\s*\+400\.0%\s*4 Edit file Code mode 4\s*—\s*5 Read file Code mode 3\s*\S*\s*\+50\.0%/i),
        pageHas(tab, "the recent change sets: the four latest, newest first", /Recent change sets\s*4[\s\S]*5 Add the fourth note[\s\S]*4 Remove the old note[\s\S]*3 Extend the notes[\s\S]*2 Reword the second note/i),
        pageHas(tab, "and not the fifth", /Add the notes files/, false),
                pageHas(tab, "none after the fifth", /Top tools[\s\S]*\s6 (Add block|Write file|Delete page|Search code|Find files)/i, false),
      ]);
      await clickUntil(tab, { role: "radio", name: "Last 24 hours" }, /^(?![\s\S]*Last 7 days)[\s\S]*Last 24 hours/);
      await ctx.verify("24 hours", [pageHas(tab, "Actions", /Actions\s*26\s*\S*\s*\+766\.7%\s*vs 3/i), pageHas(tab, "labelled", /Last 24 hours/)]);
      await clickUntil(tab, { role: "radio", name: "Last 30 days" }, /^(?![\s\S]*Last 7 days)[\s\S]*Last 30 days/);
      await ctx.verify("30 days", [pageHas(tab, "Actions", /Actions\s*39\s*\S*\s*\+680\.0% vs 5/i)]);
    },
  },
  {
    id: "a-click-on-a-recent-set-opens-it-on-the-changes-page",
    title: "a click on a row of Recent change sets opens the Changes page on that set, named in the URL (?set=), with its diff",
    entryPoint: "/modules/ai/overview, /modules/ai/changes?set=",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the row is listed", [pageHas(tab, "set 2 in Recent change sets", /Recent change sets[\s\S]*2 Reword the second note/i)]);
      const row = tab.page.getByRole("row", { name: /Reword the second note/ }).first();
      await until(async () => {
        await row.click({ timeout: 5000 }).catch(() => undefined);
        return until(async () => new URL(tab.page.url()).pathname === "/modules/ai/changes", { timeoutMs: 4000, everyMs: 500 });
      }, { timeoutMs: 30_000, everyMs: 0 });
      const url = new URL(tab.page.url());
      await ctx.verify("the Changes page", [
        same("the URL names the set", [url.pathname, url.searchParams.get("set")], ["/modules/ai/changes", "cs-two"]),
        pageHas(tab, "set 2 is open", /Change set #2 · checkpoint before/i),
        pageHas(tab, "with its diff", /src\/notes\/b\.txt/),
      ]);
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
    id: "a-rise-in-undone-sets-reads-as-bad-news",
    title: "a rise of the Undone figure is drawn in another tone than a rise of Actions or of Change sets: more undone sets is bad news",
    entryPoint: "/modules/ai/overview",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      await seedStore(ctx, {
        conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }),
        build: () => {
          const sets = sampleChangeSets(ctx, now);
          const stamp = (/** @type {number} */ index, /** @type {number} */ at) => { sets[index].stateLog = [{ state: "undone", atMs: at, by: "Verify Admin" }]; };
          stamp(0, now - 9 * MS_DAY);
          stamp(1, now - 2 * 3_600_000);
          stamp(2, now - 3_600_000);
          sets[4].createdAtMs = now - 9 * MS_DAY;
          return sets;
        },
      });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the figures", [
        pageHas(tab, "Actions rose", /Actions\s*31\s*\S*\s*\+416\.7%\s*vs 6/i),
        pageHas(tab, "Change sets rose", /Change sets\s*4\s*\S*\s*\+300\.0% vs 1/i),
        pageHas(tab, "Undone rose", /Undone\s*2\s*\S*\s*\+100\.0% vs 1/i),
      ]);
      const colour = (/** @type {RegExp} */ pattern) => tab.page.getByText(pattern).first().evaluate((element) => getComputedStyle(element).color);
      const [actions, sets, undone] = [await colour(/\+416\.7%/), await colour(/\+300\.0%/), await colour(/\+100\.0%/)];
      await ctx.verify("the tone", [
        same("a rise of Change sets is drawn like a rise of Actions", sets, actions),
        check("a rise of Undone is drawn in another colour", undone !== actions, `Actions ${actions}, Change sets ${sets}, Undone ${undone}`),
      ]);
    },
  },
  {
    id: "each-recent-set-offers-undo-or-redo-by-its-state",
    title: "on the Overview an applied change set has Undo and an undone one has Redo, whichever rows are undone: one undone row among four, then two, and the State column follows",
    entryPoint: "/modules/ai/overview",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {{ undone: number[], undoButtons: number, redoButtons: number }[]} */
      const cases = [{ undone: [4], undoButtons: 3, redoButtons: 1 }, { undone: [1, 3], undoButtons: 2, redoButtons: 2 }];
      for (const { undone, undoButtons, redoButtons } of cases) {
        const now = Date.now();
        await seedStore(ctx, {
          conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }),
          build: () => {
            const sets = sampleChangeSets(ctx, now);
            for (const index of undone) {
              sets[index].state = "undone";
              sets[index].stateLog = [{ state: "undone", atMs: now - 3_600_000, by: "Verify Admin" }];
            }
            return sets;
          },
        });
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/overview");
        const undoCount = () => tab.page.getByRole("button", { name: "Undo", exact: true }).count();
        const redoCount = () => tab.page.getByRole("button", { name: "Redo", exact: true }).count();
        await until(async () => (await undoCount()) + (await redoCount()) === 4, { timeoutMs: 20_000 });
        await ctx.verify(`${redoButtons} undone among the four latest`, [
          check(`${undoButtons} Undo buttons`, (await undoCount()) === undoButtons, await undoCount()),
          check(`${redoButtons} Redo buttons`, (await redoCount()) === redoButtons, await redoCount()),
          ...[5, 4, 3, 2].map((number) => pageHas(tab, `set ${number}`, new RegExp(`${number} [A-Z][^\\n]*? ${undone.includes(number - 1) ? "Undone Redo" : "Applied Undo"}`))),
        ]);
      }
    },
  },
  {
    id: "the-assistant-card-follows-the-saved-defaults",
    title: "the Agent, Default scope and Approvals rows of the Overview follow the saved defaults: Ask first, Accept edits and Plan only, Code mode, and the agent",
    entryPoint: "PUT /ai/settings, /modules/ai/overview",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      for (const [mode, label] of [["normal", "Ask first"], ["acceptEdits", "Accept edits"], ["plan", "Plan only"]]) {
        await ai(ctx, `default approval ${mode}`, "PUT", "/settings", { body: { mode } });
        const facts = list((await ai(ctx, "facts", "GET", "/status/facts")).body, "items");
        await tab.goto("/modules/ai/overview");
        await ctx.verify(`the default is ${label}`, [
          same("the row of the route", facts.find((row) => text(row, "id") === "mode") ? text(facts.find((row) => text(row, "id") === "mode"), "value") : "", `$dms_ai.status.mode.${mode}`),
          pageHas(tab, "the Approvals row", new RegExp(`Approvals\\s*${label}\\s*Builder`, "i")),
        ]);
      }
      await ai(ctx, "default scope Code", "PUT", "/settings", { body: { generationMode: "vibe" } });
      await tab.goto("/modules/ai/overview");
      await ctx.verify("scope Code", [pageHas(tab, "the Default scope row, with no hint: Code is what was chosen", /Default scope\s*Code mode\s*Approvals/i), pageHas(tab, "no Safe needs Builder", /Safe needs Builder/, false)]);
      await ai(ctx, "default scope Safe", "PUT", "/settings", { body: { generationMode: "safe" } });
      await tab.goto("/modules/ai/overview");
      await ctx.verify("scope Safe, which needs the Builder", [pageHas(tab, "shows Code mode and says why", /Default scope\s*Code mode\s*Safe needs Builder/i)]);
      await ai(ctx, "agent Codex", "PUT", "/settings", { body: { provider: "codex" } });
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the agent Codex", [pageHas(tab, "the Agent row", /Agent\s*Codex/i)]);
      await ai(ctx, "agent Claude", "PUT", "/settings", { body: { provider: "claude" } });
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the agent Claude Code", [pageHas(tab, "the Agent row", /Agent\s*Claude Code/i)]);
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
      await ctx.verify("the default", [pageHas(tab, "compares with the period before", /vs [A-Z][a-z]{2} \d+ – \d+/), pageHas(tab, "with deltas", /\+416\.7%\s*vs 6/), check("the button names it", (await menu.first().getAttribute("aria-label")) !== undefined || (await menu.count()) === 1, await menu.count())]);
      await menu.first().click();
      await tab.snapshot("the comparison menu");
      await ctx.verify("the menu", [pageHas(tab, "offers the previous period", /vs previous period/), pageHas(tab, "the previous year", /vs previous year/), pageHas(tab, "and no comparison", /No comparison/)]);
      await tab.page.getByRole("menuitem", { name: "No comparison" }).first().click();
      await ctx.verify("No comparison", [pageHas(tab, "keeps the figures", /Actions\s*31/i), pageHas(tab, "drops the delta", /\+416\.7%\s*vs 6/, false), pageHas(tab, "drops every comparison", /vs 0|vs 6|vs 3/, false), pageHas(tab, "the chart has no comparison line", /Comparison/, false)]);
      await tab.reload();
      await ctx.verify("a reload remembers it", [pageHas(tab, "still no delta", /\+416\.7%\s*vs 6/, false), pageHas(tab, "and the figures", /Actions\s*31/i)]);
      await menu.first().click();
      await tab.page.getByRole("menuitem", { name: "vs previous year" }).first().click();
      await ctx.verify("vs previous year", [pageHas(tab, "compares with the year before: nothing then", /Actions\s*31\s*\S*\s*vs 0/i)]);
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
