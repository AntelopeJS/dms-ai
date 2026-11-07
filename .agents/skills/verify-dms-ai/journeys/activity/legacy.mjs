import { ai, list, pageHas, pick, same, text } from "../../ai.mjs";
import { MS_HOUR, MS_MINUTE, conversation, seedStore, toolResult, toolUse, userMessage } from "../../seed.mjs";
import { log } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const legacyJourneys = [
  {
    id: "a-call-recorded-under-a-legacy-tool-name-reads-under-the-current-one",
    title: "a stored conversation that names Builder tools in the old CamelCase, with and without the mcp__dms-ai__ prefix, shows them in the Activity log and in the Overview's top tools under their snake_case names, from the Builder, and allowed automatically",
    entryPoint: "GET /ai/activity, GET /ai/metrics/top-tools, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      const at = now - MS_HOUR;
      const call = (/** @type {string} */ id, /** @type {string} */ name, /** @type {number} */ when) => [toolUse(id, name, { pageId: "home" }, when), toolResult(id, when + 800)];
      await seedStore(ctx, {
        conversations: {
          "conv-legacy": conversation([userMessage("Add a block", at - MS_MINUTE), ...call("legacy-1", "BuilderAddBlock", at), ...call("legacy-2", "mcp__dms-ai__BuilderAddBlock", at + 2 * MS_MINUTE)]),
        },
      });
      const activity = await log(ctx, "");
      const top = await ai(ctx, "top tools", "GET", "/metrics/top-tools");
      await ctx.verify("the stored legacy names", [
        same("two rows, both under the current name", [activity.total, activity.tools], [2, ["builder_add_block", "builder_add_block"]]),
        same("both allowed as Builder operations, not asked about", activity.rows.map((row) => [text(row, "allowedBy"), text(row, "result")]), [["builder_auto", "done"], ["builder_auto", "done"]]),
        same("the Overview counts them as one tool from the Builder", list(top.body, "items").map((item) => [text(item, "id"), pick(item, "value"), text(item, "description")]), [["builder_add_block", 2, "$dms_ai.activity.tool_source.builder"]]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [pageHas(tab, "the rows read Add block, allowed as a Builder operation", /Add block\s*Builder, automatic\s*Done[\s\S]*Add block\s*Builder, automatic\s*Done/)]);
      await tab.goto("/modules/ai/overview");
      await ctx.verify("the Overview", [pageHas(tab, "its top tools list Add block, from the Builder, twice", /Top tools[\s\S]*1 Add block Builder 2/i)]);
    },
  },
];
