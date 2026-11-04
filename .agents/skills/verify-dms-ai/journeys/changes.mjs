import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { ai, check, clickUntil, fixture, list, pageHas, pick, same, text, until, withEnv } from "../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../sample.mjs";
import { MS_DAY, conversation, projectRoot, recordChangeSet, seedStore, userMessage, writeProjectFile } from "../seed.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** The sample, seeded: three change sets over `src/notes/a.txt` and `src/notes/b.txt`. */
async function seedSample(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
  return now;
}

/** @param {Ctx} ctx @param {string} name @returns {string} the text of a project file, or "<absent>" */
function fileText(ctx, name) {
  const file = join(projectRoot(ctx), "src", "notes", name);
  return existsSync(file) ? readFileSync(file, "utf8") : "<absent>";
}

/** @param {Ctx} ctx @param {string} id @returns {Promise<{ state: string, by: string, log: string[] }>} the state of a set */
async function stateOf(ctx, id) {
  const body = (await ai(ctx, `change set ${id}`, "GET", `/changes/${id}`)).body;
  return { state: text(body, "changeSet", "state"), by: text(body, "changeSet", "stateChangedBy"), log: [] };
}

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
        same("lines per set", list(all.body, "results").map((row) => [pick(row, "added"), pick(row, "removed")]), [[1, 0], [1, 0], [1, 0], [2, 1], [1, 0]]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes");
      await ctx.verify("the list", [
        pageHas(tab, "its count", /Change sets · 5/i),
        pageHas(tab, "set 5 first, then 4", /Add the fourth note #5 · [^\n]*· \+1 −0 · Safe mode[\s\S]*Add the third note #4/),
        pageHas(tab, "set 3 with its lines, scope and tag", /Extend the first note #3 · [^\n]*· \+1 −0 · Safe mode · Auto-fix/),
        pageHas(tab, "set 2", /Reword the second note #2 · [^\n]*· \+2 −1 · Code mode/),
        pageHas(tab, "set 1", /Add the notes file #1 · [^\n]*· \+1 −0 · Safe mode/),
        pageHas(tab, "the newest set is open", /Change set #5 · checkpoint before/i),
        pageHas(tab, "its rows", /Asked by\s*Verify Admin\s*Agent · scope\s*Claude Code · Safe mode\s*Approvals\s*0 needed · 0 Builder ops\s*Checks\s*Typecheck passed/),
        pageHas(tab, "its diff", /src\/notes\/d\.txt new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ fourth note\s*Undo restores this file to the checkpoint and reloads the page\./),
      ]);
      await tab.page.getByRole("button", { name: /Extend the first note/ }).first().click();
      await ctx.verify("set 3", [
        pageHas(tab, "open", /Change set #3 · checkpoint before/i),
        pageHas(tab, "its diff", /src\/notes\/a\.txt \+1\s*@@ -1,1 \+1,2 @@\s*1 first note\s*2 \+ second line\s*Undo restores this file to the checkpoint and reloads the page\./),
      ]);
      await tab.page.getByRole("button", { name: /Reword the second note/ }).first().click();
      await ctx.verify("set 2", [
        pageHas(tab, "its heading", /Change set #2 · checkpoint before/i),
        pageHas(tab, "its rows", /Agent · scope\s*Claude Code · Code mode\s*Approvals\s*2 needed · 0 Builder ops\s*Checks\s*Typecheck failed/),
        pageHas(tab, "the overlap warning", /May include changes from another chat/),
        pageHas(tab, "its diff: the removed and the added lines", /src\/notes\/b\.txt \+2 −1\s*@@ -1,2 \+1,3 @@\s*1 line one\s*2 − line two\s*2 \+ line 2 reworded\s*3 \+ line three/),
      ]);
      await tab.page.getByRole("button", { name: /Add the notes file/ }).first().click();
      await ctx.verify("set 1", [
        pageHas(tab, "its rows", /Approvals\s*1 needed · 2 Builder ops\s*Checks\s*Typecheck skipped/),
        pageHas(tab, "the Open page link, since the set changed a page", /Open page/),
        pageHas(tab, "the new file, with its lines", /src\/notes\/a\.txt new \+1\s*@@ -0,0 \+1,1 @@\s*1 \+ first note/),
      ]);
      await tab.click({ role: "radio", name: "Code" });
      await ctx.verify("the Code scope", [pageHas(tab, "keeps set 2", /Reword the second note #2/), pageHas(tab, "drops set 1", /Add the notes file #1/, false)]);
      await tab.click({ role: "radio", name: "All" });
      await tab.click({ role: "textbox", name: "Search files or changes" });
      await tab.fill({ role: "textbox", name: "Search files or changes" }, "a.txt");
      await ctx.verify("a search over a path", [pageHas(tab, "keeps sets 3 and 1", /Extend the first note #3[\s\S]*Add the notes file #1/), pageHas(tab, "drops set 2 and the ones that add other files", /Reword the second note #2|Add the third note #4/, false)]);
      await tab.fill({ role: "textbox", name: "Search files or changes" }, "zzzz");
      await ctx.verify("a search that matches nothing", [pageHas(tab, "says so", /No change set matches/), pageHas(tab, "and what to do", /Try another search or scope\./)]);
      await tab.goto("/modules/ai/changes?set=cs-two");
      await ctx.verify("a link opens a set", [pageHas(tab, "set 2 is open", /Change set #2 · checkpoint before/i)]);
    },
  },
  {
    id: "undo-and-redo-restore-the-files-and-record-who-did-it",
    title: "Undo change set opens a dialog titled Undo change set #3? that says how many files it restores; Undo puts the file back as it was before, the set reads Undone with the name of the person, Redo returns the file as the assistant left it, and the audit log and the Undone figure follow",
    entryPoint: "/modules/ai/changes, POST /ai/changes/:id/undo and /redo",
    async run(/** @type {Ctx} */ ctx) {
      const now = await seedSample(ctx);
      const before = fileText(ctx, "b.txt");
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes?set=cs-two");
      await ctx.verify("before", [same("the file holds the assistant's last version", before, "line one\nline 2 reworded\nline three\n")]);
      await clickUntil(tab, { role: "button", name: "Undo change set" }, /Undo change set #2\?/);
      await ctx.verify("the dialog", [
        pageHas(tab, "its title", /Undo change set #2\?/),
        pageHas(tab, "what it does", /Restores the file to how it was before this change set, then reloads the page\./),
        pageHas(tab, "no later set to offer", /Also undo the later change sets/, false),
      ]);
      await tab.click({ role: "button", name: "Undo", exact: true });
      const undone = await until(async () => (await stateOf(ctx, "cs-two")).state === "undone", { timeoutMs: 20_000, everyMs: 1500 });
      const state = await stateOf(ctx, "cs-two");
      await ctx.verify("after Undo", [
        check("the set is undone", undone, state.state),
        same("the file is back as it was before", fileText(ctx, "b.txt"), "line one\nline two\n"),
        same("by whom", state.by, "Verify Admin"),
        same("the other sets are untouched", [(await stateOf(ctx, "cs-one")).state, (await stateOf(ctx, "cs-three")).state], ["applied", "applied"]),
      ]);
      await tab.goto("/modules/ai/changes?set=cs-two");
      await ctx.verify("the card", [pageHas(tab, "says who undid it", /Undone[\s\S]*Verify Admin/), tab.visible({ role: "button", name: "Redo" })]);
      const again = await ai(ctx, "undo it again", "POST", "/changes/cs-two/undo", { body: {} });
      await ctx.verify("a second Undo", [same("is refused 4xx", again.status !== null && again.status >= 400 && again.status < 500, true), same("with the reason", text(again.body, "message"), "Change set #2 is already undone.")]);
      const log = list((await ai(ctx, "the log", "GET", "/activity?search=Reword")).body, "results");
      const overview = await ai(ctx, "undone figure", "GET", `/metrics/kpi/undone?from=${new Date(now - 7 * MS_DAY).toISOString()}&to=${new Date(Date.now() + 1000).toISOString()}`);
      await ctx.verify("the audit log and the figure", [
        same("one Undo row naming the set and the person", log.map((row) => [text(row, "tool"), text(row, "target"), text(row, "resultDetail")]), [["UndoChangeSet", "#2 Reword the second note", "Verify Admin"]]),
        same("the Undone figure counts it", pick(overview.body, "value"), 1),
      ]);
      await tab.click({ role: "button", name: "Redo" });
      const redone = await until(async () => (await stateOf(ctx, "cs-two")).state === "applied", { timeoutMs: 20_000, everyMs: 1500 });
      const redoneLog = list((await ai(ctx, "the log", "GET", "/activity?search=Reword")).body, "results").map((row) => text(row, "tool"));
      await ctx.verify("after Redo", [
        check("the set is applied again", redone, (await stateOf(ctx, "cs-two")).state),
        same("the file returns as the assistant left it", fileText(ctx, "b.txt"), "line one\nline 2 reworded\nline three\n"),
        same("the log has the Undo and the Redo", redoneLog.sort(), ["RedoChangeSet", "UndoChangeSet"]),
      ]);
      const wrong = await ai(ctx, "redo an applied set", "POST", "/changes/cs-two/redo", { body: {} });
      await ctx.verify("a Redo of an applied set", [same("is refused with the reason", [wrong.status !== null && wrong.status >= 400 && wrong.status < 500, text(wrong.body, "message")], [true, "Change set #2 is already applied."])]);
    },
  },
  {
    id: "an-owner-without-a-name-is-recorded-by-email",
    title: "Undo and Redo record the signed-in user's name, or their email when they have no name: the set, the card and the audit row show the email",
    entryPoint: "POST /ai/changes/:id/undo, /modules/ai/changes, GET /ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const email = ctx.state.accounts?.admin?.email ?? "";
      const renamed = await fixture(ctx, "give the owner no name", "POST", "/user-name", { email, name: "" });
      await ctx.verify("the owner", [same("has no name now", pick(renamed.body, "updated"), true)], { critical: true });
      const undone = await ai(ctx, "undo set 4", "POST", "/changes/cs-four/undo", { body: {} });
      const state = await stateOf(ctx, "cs-four");
      const log = list((await ai(ctx, "the log", "GET", "/activity?search=third")).body, "results");
      await ctx.verify("the record", [
        same("the undo is accepted", undone.status, 200),
        same("the set says who: the email", [state.state, state.by], ["undone", email]),
        same("so does the audit row", log.map((row) => [text(row, "tool"), text(row, "resultDetail")]), [["UndoChangeSet", email]]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes?set=cs-four");
      await ctx.verify("the card", [pageHas(tab, "names the email", new RegExp(`Undone[\\s\\S]*${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))]);
    },
  },
  {
    id: "undoing-a-set-lists-the-later-sets-on-the-same-files",
    title: "Undo of a set whose file a later set changed again lists that set in the dialog, with Also undo the later change sets on; Undo them together restores both, Undo this one only keeps the later set's lines",
    entryPoint: "GET /ai/changes/:id/undo-preview, /undo-confirm, POST /ai/changes/:id/undo",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const preview = await ai(ctx, "preview", "GET", "/changes/cs-one/undo-preview");
      const confirm = await ai(ctx, "confirm", "GET", "/changes/cs-one/undo-confirm");
      await ctx.verify("the routes", [
        same("the preview names the file and the conflict", [pick(preview.body, "files"), list(preview.body, "conflicts").map((c) => [pick(c, "number"), text(c, "title"), pick(c, "files")])], [["src/notes/a.txt"], [[3, "Extend the first note", ["src/notes/a.txt"]]]]),
        same("a set with no later set has no conflict", list((await ai(ctx, "preview 2", "GET", "/changes/cs-two/undo-preview")).body, "conflicts").length, 0),
        check("the confirmation names the later set", JSON.stringify(confirm.body).includes("Extend the first note"), JSON.stringify(confirm.body).slice(0, 300)),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes?set=cs-one");
      await clickUntil(tab, { role: "button", name: "Undo change set" }, /Undo change set #1\?/);
      await ctx.verify("the dialog", [
        pageHas(tab, "its title", /Undo change set #1\?/),
        pageHas(tab, "the conflict sentence", /A later change set touches the same file\./),
        pageHas(tab, "the later set with its number, title and shared files", /#3[\s\S]*Extend the first note[\s\S]*1/),
        pageHas(tab, "the switch", /Also undo the later change sets/),
        pageHas(tab, "its hint", /Safe: undoing this one alone keeps their lines and may not compile\./),
      ]);
      await tab.click({ role: "button", name: "Undo", exact: true });
      await until(async () => (await stateOf(ctx, "cs-one")).state === "undone", { timeoutMs: 20_000, everyMs: 1500 });
      await ctx.verify("both undone", [
        same("the two sets", [(await stateOf(ctx, "cs-one")).state, (await stateOf(ctx, "cs-three")).state], ["undone", "undone"]),
        same("the file is gone: the first set added it", fileText(ctx, "a.txt"), "<absent>"),
        same("the other file is untouched", fileText(ctx, "b.txt"), "line one\nline 2 reworded\nline three\n"),
      ]);
      await ai(ctx, "redo the first", "POST", "/changes/cs-one/redo", { body: {} });
      await ai(ctx, "redo the third", "POST", "/changes/cs-three/redo", { body: {} });
      await ctx.verify("redone", [same("the file as the last set left it", fileText(ctx, "a.txt"), "first note\nsecond line\n")]);
      const alone = await ai(ctx, "undo this one only", "POST", "/changes/cs-one/undo", { body: {} });
      await ctx.verify("this one only", [
        same("accepted", alone.status, 200),
        same("only the first set is undone", [(await stateOf(ctx, "cs-one")).state, (await stateOf(ctx, "cs-three")).state], ["undone", "applied"]),
        same("the file is gone although the later set still reads Applied", fileText(ctx, "a.txt"), "<absent>"),
      ]);
    },
  },
  {
    id: "without-git-the-page-says-change-sets-are-off",
    title: "on a machine without Git the sidecar reports checkpoints unavailable, the Changes page says Change sets are off and what to install, and nothing is recorded",
    entryPoint: "GET /ai/status, /modules/ai/changes",
    async run(/** @type {Ctx} */ ctx) {
      await seedStore(ctx, {});
      const bin = join(ctx.state.home, "nogit");
      mkdirSync(bin, { recursive: true });
      symlinkSync(process.execPath, join(bin, "node"));
      await withEnv(ctx, { PATH: bin }, async () => {
        const ready = await until(async () => text((await ai(ctx, "status", "GET", "/status")).body, "status") === "ready", { timeoutMs: 90_000, everyMs: 2000 });
        const status = (await ai(ctx, "status", "GET", "/status")).body;
        const tab = await ctx.tab();
        await tab.signIn("admin");
        await tab.goto("/modules/ai/changes");
        await ctx.verify("no Git", [
          check("the assistant still starts", ready, text(status, "status")),
          same("checkpoints are unavailable", pick(status, "checkpointsAvailable"), false),
          pageHas(tab, "the page says it", /Change sets are off/),
          pageHas(tab, "and why", /Git isn't available on this machine, so the assistant can't save checkpoints to undo its changes\. Install Git and restart the assistant\./),
          pageHas(tab, "it is not the empty state", /No changes yet/, false),
        ]);
      });
    },
  },
  {
    id: "change-sets-older-than-the-retention-are-dropped-when-the-assistant-starts",
    title: "the assistant keeps a change set within the checkpoint retention and drops an older one at its start: 7 days with a set 6 days old and one 8 days old, then the default 30 days with sets 29 and 31 days old",
    entryPoint: "settings.json checkpointRetentionDays, GET /ai/changes",
    async run(/** @type {Ctx} */ ctx) {
      for (const [retention, kept, dropped] of [[7, 6, 8], [30, 29, 31], [90, 89, 91]]) {
        const now = Date.now();
        await seedStore(ctx, {
          settings: retention === 30 ? undefined : { checkpointRetentionDays: retention },
          conversations: { c: conversation([userMessage("Old work", now - 100 * MS_DAY)]) },
          build: () => [
            recordChangeSet(ctx, { id: `kept-${retention}`, number: 1, title: `Kept at ${retention} days`, conversationId: "c", createdAtMs: now - kept * MS_DAY }, () => writeProjectFile(ctx, "src/notes/k.txt", `kept ${retention}\n`)),
            recordChangeSet(ctx, { id: `dropped-${retention}`, number: 2, title: `Dropped at ${retention} days`, conversationId: "c", createdAtMs: now - dropped * MS_DAY }, () => writeProjectFile(ctx, "src/notes/d.txt", `dropped ${retention}\n`)),
          ],
        });
        const body = (await ai(ctx, `the sets at ${retention} days`, "GET", "/changes")).body;
        await ctx.verify(`${retention} days`, [
          same("the set inside the retention stays", list(body, "results").map((row) => text(row, "title")), [`Kept at ${retention} days`]),
          same("the older set is gone", (await ai(ctx, "the old set", "GET", `/changes/dropped-${retention}`)).status, 404),
        ]);
      }
    },
  },
]);
