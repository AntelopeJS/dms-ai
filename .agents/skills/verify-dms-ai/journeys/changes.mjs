import { guarded } from "../guard.mjs";
import { ai, freshSidecar, pageHas, same, text, withEnv } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "no-change-set-yet-says-so",
    title: "before any turn changed a file the Changes page and the Overview say No changes yet, the routes answer empty lists, and a set that does not exist answers 404 on every route",
    entryPoint: "/modules/ai/changes, GET /ai/changes, /ai/changes/:id, /ai/recent-changes",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const list = await ai(ctx, "list", "GET", "/changes");
      const recent = await ai(ctx, "recent", "GET", "/recent-changes");
      const unknown = [];
      for (const [method, path] of [["GET", "/changes/nope"], ["GET", "/changes/nope/undo-preview"], ["GET", "/changes/nope/undo-confirm"], ["POST", "/changes/nope/undo"], ["POST", "/changes/nope/redo"]]) {
        const answer = await ai(ctx, `${method} ${path}`, method, path, { body: method === "POST" ? {} : undefined });
        unknown.push([`${method} ${path}`, answer.status, text(answer.body, "message")]);
      }
      await ctx.verify("the API", [
        same("an empty list", list.body, { results: [], total: 0 }),
        same("an empty recent list", recent.body, { results: [], total: 0 }),
        same("an unknown set is 404 everywhere", unknown.filter(([, status]) => status !== 404), []),
        same("with the same message", [...new Set(unknown.map(([, , message]) => message))], ["Unknown change set."]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes");
      await ctx.verify("the page", [
        pageHas(tab, "the empty state", /No changes yet/),
        pageHas(tab, "what it will hold", /When the assistant edits a page or a file, the change set lands here with its diff and an undo\./),
        tab.visible({ role: "textbox", name: "Search files or changes" }),
        pageHas(tab, "the scope filter", /All\s*Safe\s*Code/),
      ]);
      await tab.goto("/modules/ai/changes?set=nope");
      await ctx.verify("a link to a set that does not exist", [pageHas(tab, "opens the list, not an error", /No changes yet/), pageHas(tab, "no server error", /Internal Server Error|500/, false)]);
    },
  },
  {
    id: "the-changes-say-when-the-assistant-is-down",
    title: "with the sidecar off the Changes page says Can't reach the assistant, and the routes answer 503",
    entryPoint: "DMS_AI=0, /modules/ai/changes",
    async run(/** @type {Ctx} */ ctx) {
      await withEnv(ctx, { DMS_AI: "0" }, async () => {
        const list = await ai(ctx, "list", "GET", "/changes");
        const set = await ai(ctx, "a set", "GET", "/changes/nope");
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/changes");
        await ctx.verify("down", [
          same("the list is 503", list.status, 503),
          same("a set is 503", set.status, 503),
          pageHas(tab, "the offline state", /Can't reach the assistant/),
          pageHas(tab, "its reason", /The assistant isn't running, so this couldn't be loaded\. This isn't an empty list\./),
        ]);
      });
    },
  },
]);
