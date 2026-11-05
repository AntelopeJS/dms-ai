import { guarded } from "../guard.mjs";
import { ai, list, pageHas, pick, same, text, withEnv } from "../ai.mjs";
import { seedStore } from "../seed.mjs";
import { seedSample } from "./changes/helpers.mjs";
import { undoJourneys } from "./changes/undo.mjs";
import { storageJourneys } from "./changes/storage.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "no-change-set-yet-says-so",
    title: "before any turn changed a file the Changes page and the Overview say No changes yet, the routes answer empty lists, and a set that does not exist answers 404 on every route",
    entryPoint: "/modules/ai/changes, GET /ai/changes, /ai/changes/:id, /ai/recent-changes",
    async run(/** @type {Ctx} */ ctx) {
      await seedStore(ctx, {});
      const changes = await ai(ctx, "list", "GET", "/changes");
      const recent = await ai(ctx, "recent", "GET", "/recent-changes");
      const unknown = [];
      for (const [method, path] of [["GET", "/changes/nope"], ["GET", "/changes/nope/undo-preview"], ["GET", "/changes/nope/undo-confirm"], ["POST", "/changes/nope/undo"], ["POST", "/changes/nope/redo"]]) {
        const answer = await ai(ctx, `${method} ${path}`, method, path, { body: method === "POST" ? {} : undefined });
        unknown.push([`${method} ${path}`, answer.status, text(answer.body, "message")]);
      }
      await ctx.verify("the API", [
        same("an empty list", changes.body, { results: [], total: 0 }),
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
        const changes = await ai(ctx, "list", "GET", "/changes");
        const set = await ai(ctx, "a set", "GET", "/changes/nope");
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/changes");
        await ctx.verify("down", [
          same("the list is 503", changes.status, 503),
          same("a set is 503", set.status, 503),
          pageHas(tab, "the offline state", /Can't reach the assistant/),
          pageHas(tab, "its reason", /The assistant isn't running, so this couldn't be loaded\. This isn't an empty list\./),
        ]);
      });
    },
  },
  {
    id: "the-list-searches-filters-and-opens-a-set-with-its-diff",
    title: "the Changes page lists the sets newest first with title, number, time, lines and scope, searches titles and file paths, filters by scope, and opens a set with Asked by, Agent · scope, Approvals, Checks, the Auto-fix tag, the overlap warning and its diff",
    entryPoint: "/modules/ai/changes, GET /ai/changes?search=, ?set=<id>",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const all = await ai(ctx, "all", "GET", "/changes");
      const code = await ai(ctx, "scope Code", "GET", "/changes?filter_scope=is:vibe");
      const numbers = (/** @type {import("../ai.mjs").Answer} */ answer) => list(answer.body, "results").map((row) => Number(pick(row, "number")));
      await ctx.verify("the API", [
        same("newest first", numbers(all), [5, 4, 3, 2, 1]),
        same("the scope Code", numbers(code), [2]),
        same("lines per set", list(all.body, "results").map((row) => [pick(row, "added"), pick(row, "removed")]), [[2, 0], [0, 2], [2, 0], [3, 1], [2, 0]]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes");
      await ctx.verify("the list", [
        pageHas(tab, "its count", /Change sets · 5/i),
        pageHas(tab, "set 5 first, then 4", /Add the fourth note #5 · [^\n]*· \+2 −0 · Safe mode[\s\S]*Remove the old note #4 · [^\n]*· \+0 −2 · Safe mode/),
        pageHas(tab, "set 3 with its lines, scope and tag", /Extend the notes #3 · [^\n]*· \+2 −0 · Safe mode · Auto-fix/),
        pageHas(tab, "set 2", /Reword the second note #2 · [^\n]*· \+3 −1 · Code mode/),
        pageHas(tab, "set 1", /Add the notes files #1 · [^\n]*· \+2 −0 · Safe mode/),
        pageHas(tab, "the newest set is open", /Change set #5 · checkpoint before/i),
        pageHas(tab, "its rows", /Asked by\s*Verify Admin\s*Agent · scope\s*Claude Code · Safe mode\s*Approvals\s*0 needed · 0 Builder ops\s*Checks\s*Typecheck passed/),
        pageHas(tab, "its diff", /src\/notes\/d\.txt new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ fourth note[\s\S]*src\/notes\/f\.txt \+1\s*@@ -1,2 \+1,3 @@[\s\S]*3 \+ third line\s*Undo restores these 2 files to the checkpoint and reloads the page\./),
      ]);
      await tab.page.getByRole("button", { name: /Extend the notes/ }).first().click();
      await ctx.verify("set 3", [
        pageHas(tab, "open", /Change set #3 · checkpoint before/i),
        pageHas(tab, "its diff", /src\/notes\/a\.txt \+1\s*@@ -1,1 \+1,2 @@\s*1 first note\s*2 \+ second line[\s\S]*src\/notes\/f\.txt \+1\s*@@ -1,1 \+1,2 @@\s*1 shared note\s*2 \+ second line\s*Undo restores these 2 files to the checkpoint and reloads the page\./),
      ]);
      await tab.page.getByRole("button", { name: /Reword the second note/ }).first().click();
      await ctx.verify("set 2", [
        pageHas(tab, "its heading", /Change set #2 · checkpoint before/i),
        pageHas(tab, "its rows", /Agent · scope\s*Claude Code · Code mode\s*Approvals\s*2 needed · 0 Builder ops\s*Checks\s*Typecheck failed/),
        pageHas(tab, "the overlap warning", /May include changes from another chat/),
        pageHas(tab, "its diff: the removed and the added lines", /src\/notes\/b\.txt \+2 −1\s*@@ -1,2 \+1,3 @@\s*1 line one\s*2 − line two\s*2 \+ line 2 reworded\s*3 \+ line three[\s\S]*src\/notes\/e\.txt new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ extra note\s*Undo restores these 2 files to the checkpoint and reloads the page\./),
      ]);
      await tab.page.getByRole("button", { name: /Add the notes files/ }).first().click();
      await ctx.verify("set 1", [
        pageHas(tab, "its rows", /Approvals\s*1 needed · 2 Builder ops\s*Checks\s*Typecheck skipped/),
        pageHas(tab, "the Open page link, since the set changed a page", /Open page/),
        pageHas(tab, "the new file, with its lines", /src\/notes\/a\.txt new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ first note[\s\S]*src\/notes\/f\.txt new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ shared note/),
      ]);
      await tab.page.getByRole("button", { name: /Remove the old note/ }).first().click();
      await ctx.verify("set 4, which deletes a file", [
        pageHas(tab, "its heading", /Change set #4 · checkpoint before/i),
        pageHas(tab, "the file is labelled deleted, with the lines it lost", /src\/notes\/g\.txt deleted −2\s*@@ -1,2 \+0,0 @@\s*1 − old note\s*2 − old note again\s*Undo restores this file to the checkpoint and reloads the page\./),
      ]);
      await tab.click({ role: "radio", name: "Code" });
      await ctx.verify("the Code scope", [pageHas(tab, "keeps set 2", /Reword the second note #2/), pageHas(tab, "drops set 1", /Add the notes files #1/, false)]);
      await tab.click({ role: "radio", name: "All" });
      await tab.click({ role: "textbox", name: "Search files or changes" });
      await tab.fill({ role: "textbox", name: "Search files or changes" }, "a.txt");
      await ctx.verify("a search over a path", [pageHas(tab, "keeps sets 3 and 1", /Extend the notes #3[\s\S]*Add the notes files #1/), pageHas(tab, "drops set 2 and the ones that add other files", /Reword the second note #2|Remove the old note #4/, false)]);
      await tab.fill({ role: "textbox", name: "Search files or changes" }, "zzzz");
      await ctx.verify("a search that matches nothing", [pageHas(tab, "says so", /No change set matches/), pageHas(tab, "and what to do", /Try another search or scope\./)]);
      await tab.goto("/modules/ai/changes?set=cs-two");
      await ctx.verify("a link opens a set", [pageHas(tab, "set 2 is open", /Change set #2 · checkpoint before/i)]);
    },
  },
  ...undoJourneys,
  ...storageJourneys,
]);
