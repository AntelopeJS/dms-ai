import { ai, check, clickUntil, fixture, list, pageHas, pick, same, text, until } from "../../ai.mjs";
import { MS_DAY } from "../../seed.mjs";
import { seedSample, fileText, stateOf } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const undoJourneys = [
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
        pageHas(tab, "what it does: two files", /Restores 2 files to how they were before this change set, then reloads the page\./),
        pageHas(tab, "no later set to offer", /Also undo the later change sets/, false),
      ]);
      await tab.click({ role: "button", name: "Undo", exact: true });
      const undone = await until(async () => (await stateOf(ctx, "cs-two")).state === "undone", { timeoutMs: 20_000, everyMs: 1500 });
      const state = await stateOf(ctx, "cs-two");
      await ctx.verify("after Undo", [
        check("the set is undone", undone, state.state),
        same("the edited file is back as it was before", fileText(ctx, "b.txt"), "line one\nline two\n"),
        same("the added file is gone", fileText(ctx, "e.txt"), "<absent>"),
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
        same("the files return as the assistant left them", [fileText(ctx, "b.txt"), fileText(ctx, "e.txt")], ["line one\nline 2 reworded\nline three\n", "extra note\n"]),
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
      const log = list((await ai(ctx, "the log", "GET", "/activity?search=old note")).body, "results");
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
    title: "Undo of a set whose files later sets changed again lists those sets in the dialog with the number of files each shares (2 and 1), with Also undo the later change sets on; Undo them together restores all, Undo this one only keeps the later sets' lines",
    entryPoint: "GET /ai/changes/:id/undo-preview, /undo-confirm, POST /ai/changes/:id/undo",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const preview = await ai(ctx, "preview", "GET", "/changes/cs-one/undo-preview");
      const confirm = await ai(ctx, "confirm", "GET", "/changes/cs-one/undo-confirm");
      const confirmThree = await ai(ctx, "confirm 3", "GET", "/changes/cs-three/undo-confirm");
      const confirmTwo = await ai(ctx, "confirm 2", "GET", "/changes/cs-two/undo-confirm");
      const confirmFour = await ai(ctx, "confirm 4", "GET", "/changes/cs-four/undo-confirm");
            await ctx.verify("the routes", [
        same("the preview names the files and the conflicts, the latest first", [pick(preview.body, "files"), list(preview.body, "conflicts").map((c) => [pick(c, "number"), text(c, "title"), pick(c, "files")])], [["src/notes/a.txt", "src/notes/f.txt"], [[5, "Add the fourth note", ["src/notes/f.txt"]], [3, "Extend the notes", ["src/notes/a.txt", "src/notes/f.txt"]]]]),
        same("set 1: 2 files, 2 later sets, sharing 1 and 2 files", [pick(confirm.body, "params", "count"), pick(confirm.body, "params", "conflicts"), text(confirm.body, "description"), list(confirm.body, "impact").map((row) => [text(row, "label"), pick(row, "count")])], [2, 2, "$dms_ai.changes_table.undo_confirm.description_conflicts", [["#5 · Add the fourth note", 1], ["#3 · Extend the notes", 2]]]),
        same("set 3: 2 files, 1 later set sharing 1", [pick(confirmThree.body, "params", "count"), pick(confirmThree.body, "params", "conflicts"), text(confirmThree.body, "description"), list(confirmThree.body, "impact").map((row) => [text(row, "label"), pick(row, "count")])], [2, 1, "$dms_ai.changes_table.undo_confirm.description_conflict", [["#5 · Add the fourth note", 1]]]),
        same("set 2: 2 files, no later set", [pick(confirmTwo.body, "params", "count"), pick(confirmTwo.body, "params", "conflicts"), text(confirmTwo.body, "description"), list(confirmTwo.body, "impact").length], [2, 0, "$dms_ai.changes_table.undo_confirm.description", 0]),
        same("set 4: 1 file, no later set", [pick(confirmFour.body, "params", "count"), pick(confirmFour.body, "params", "conflicts"), list(confirmFour.body, "impact").length], [1, 0, 0]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes?set=cs-one");
      await clickUntil(tab, { role: "button", name: "Undo change set" }, /Undo change set #1\?/);
      await ctx.verify("the dialog", [
        pageHas(tab, "its title", /Undo change set #1\?/),
        pageHas(tab, "the files and the later sets", /Restores 2 files to how they were before this change set\. 2 later change sets touch the same files\./),
        pageHas(tab, "the later sets with the files they share", /#5 · Add the fourth note[\s\S]*1[\s\S]*#3 · Extend the notes[\s\S]*2/),
        pageHas(tab, "the switch", /Also undo the later change sets/),
        pageHas(tab, "its hint", /Safe: undoing this one alone keeps their lines and may not compile\./),
      ]);
      await tab.click({ role: "button", name: "Undo", exact: true });
      await until(async () => (await stateOf(ctx, "cs-one")).state === "undone", { timeoutMs: 20_000, everyMs: 1500 });
      await ctx.verify("all three undone", [
        same("the sets", [(await stateOf(ctx, "cs-one")).state, (await stateOf(ctx, "cs-three")).state, (await stateOf(ctx, "cs-five")).state], ["undone", "undone", "undone"]),
        same("the files the first set added are gone", [fileText(ctx, "a.txt"), fileText(ctx, "f.txt"), fileText(ctx, "d.txt")], ["<absent>", "<absent>", "<absent>"]),
        same("the other files are untouched", [fileText(ctx, "b.txt"), fileText(ctx, "e.txt")], ["line one\nline 2 reworded\nline three\n", "extra note\n"]),
      ]);
      for (const id of ["cs-one", "cs-three", "cs-five"]) await ai(ctx, `redo ${id}`, "POST", `/changes/${id}/redo`, { body: {} });
      await ctx.verify("redone", [same("the files as the last sets left them", [fileText(ctx, "a.txt"), fileText(ctx, "f.txt"), fileText(ctx, "d.txt")], ["first note\nsecond line\n", "shared note\nsecond line\nthird line\n", "fourth note\n"])]);
      const alone = await ai(ctx, "undo this one only", "POST", "/changes/cs-one/undo", { body: {} });
      await ctx.verify("this one only", [
        same("accepted", alone.status, 200),
        same("only the first set is undone", [(await stateOf(ctx, "cs-one")).state, (await stateOf(ctx, "cs-three")).state, (await stateOf(ctx, "cs-five")).state], ["undone", "applied", "applied"]),
        same("its files are gone although the later sets still read Applied", [fileText(ctx, "a.txt"), fileText(ctx, "f.txt")], ["<absent>", "<absent>"]),
      ]);
    },
  },
  {
    id: "undoing-a-set-that-deletes-a-file-brings-the-file-back",
    title: "Undo of a set that deleted a file puts the file back with its lines, in a dialog that restores the file, and Redo deletes it again",
    entryPoint: "/modules/ai/changes, POST /ai/changes/:id/undo and /redo",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      await ctx.verify("before", [same("the file is gone", fileText(ctx, "g.txt"), "<absent>")]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/changes?set=cs-four");
      await clickUntil(tab, { role: "button", name: "Undo change set" }, /Undo change set #4\?/);
      await ctx.verify("the dialog", [pageHas(tab, "restores one file", /Restores the file to how it was before this change set, then reloads the page\./)]);
      await tab.click({ role: "button", name: "Undo", exact: true });
      await until(async () => (await stateOf(ctx, "cs-four")).state === "undone", { timeoutMs: 20_000, everyMs: 1500 });
      await ctx.verify("after Undo", [same("the file is back with both lines", fileText(ctx, "g.txt"), "old note\nold note again\n"), same("the set reads Undone", (await stateOf(ctx, "cs-four")).state, "undone")]);
      await ai(ctx, "redo", "POST", "/changes/cs-four/redo", { body: {} });
      await ctx.verify("after Redo", [same("the file is deleted again", fileText(ctx, "g.txt"), "<absent>")]);
    },
  },
];
