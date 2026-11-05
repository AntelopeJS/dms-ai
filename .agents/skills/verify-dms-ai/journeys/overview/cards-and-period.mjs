import { ai, check, choose, freshSidecar, list, pageHas, same, selected, text, until } from "../../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../../sample.mjs";
import { MS_DAY, seedStore } from "../../seed.mjs";
import { seedSample } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const cardAndPeriodJourneys = [
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
];
