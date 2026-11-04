import { guarded } from "../guard.mjs";
import { AI, ai, check, clickUntil, freshSidecar, list, pageHas, pick, raw, recordRaw, same, selected, text, withEnv } from "../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../sample.mjs";
import { MS_DAY, MS_HOUR, conversation, seedStore, toolResult, toolUse, userMessage } from "../seed.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** Seeds one conversation of 10,005 reads, one every second. */
async function seedMany(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  const messages = [userMessage("Many reads", now - 2 * MS_DAY)];
  for (let index = 0; index < 10_005; index += 1) {
    const at = now - MS_DAY + index * 1000;
    messages.push(toolUse(`r-${index}`, "Read", { file_path: `docs/${index}.md` }, at, { allowedBy: "read_auto" }), toolResult(`r-${index}`, at + 100, { allowedBy: "read_auto" }));
  }
  await seedStore(ctx, { conversations: { many: conversation(messages) } });
}

const CSV_HEADER = "time,tool,target,agent,allowed_by,result,result_detail,change_set,conversation_id,conversation,duration_ms,read_only,auto_fix\r\n";

/** @param {Ctx} ctx @param {string} query @returns {Promise<{ total: number, tools: string[], rows: import("../ai.mjs").Row[] }>} */
async function log(ctx, query) {
  const answer = await ai(ctx, `the log ${query}`, "GET", `/activity${query}`);
  const rows = list(answer.body, "results");
  return { total: Number(pick(answer.body, "total")), tools: rows.map((row) => text(row, "tool")), rows };
}

/** @param {string[]} names @returns {string[]} sorted copy */
const sorted = (names) => [...names].sort();

/** The sample, seeded: 44 records, 31 of them in the last seven days. */
async function seedSample(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
  return now;
}

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
        check("as a download named for the day", /^attachment; filename="dms-ai-activity-\d{4}-\d{2}-\d{2}\.csv"$/.test(csv.headers["content-disposition"] ?? ""), csv.headers["content-disposition"]),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [
        pageHas(tab, "the empty state", /No activity yet/),
        pageHas(tab, "and what it will hold", /Every tool the assistant uses lands here, with who allowed it and what came out\./),
        selected(tab, { role: "radio", name: "Last 24 hours" }, false),
        selected(tab, { role: "radio", name: "Last 7 days" }, false),
        selected(tab, { role: "radio", name: "Last 30 days" }, false),
        selected(tab, { role: "radio", name: "All time" }, true),
        pageHas(tab, "the tabs", /All\s*0\s*Changed files\s*0\s*Asked you\s*0\s*Denied or blocked\s*0\s*Failed\s*0/),
        pageHas(tab, "the quick filters", /Tool\s*Agent\s*Read-only/),
        pageHas(tab, "the columns", /TIME\s*ACTION\s*ALLOWED\s*RESULT\s*CONVERSATION\s*DURATION/),
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
  {
    id: "the-log-lists-every-call-with-its-tabs-filters-and-pages",
    title: "seeded calls fill the log newest first, 25 rows a page; each tab, the tool, agent and read-only filters, the search over tool, target and conversation, and the periods give exactly their rows",
    entryPoint: "GET /ai/activity, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      const now = await seedSample(ctx);
      const day = MS_DAY;
      const all = await log(ctx, "");
      await ctx.verify("the list", [
        same("44 records", all.total, 44),
        same("a page holds 25", all.rows.length, 25),
        same("newest first: the last call, then the one before", all.tools.slice(0, 2), ["Glob", "Grep"]),
        same("offset 25 gives the other 19, the oldest last", (await log(ctx, "?offset=25")).rows.map((row) => text(row, "conversationTitle")), ["Edge reads", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Explain the project", "Explain the project", "Explain the project", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Edge reads", "Old question", "Old question"]),
        same("limit 10", (await log(ctx, "?limit=10")).rows.length, 10),
        same("limit 1000 is capped by the sidecar, not refused", (await log(ctx, "?limit=1000")).rows.length, 44),
        same("every row names its agent", [...new Set(all.rows.map((row) => text(row, "agent")))].sort(), ["claude", "codex"]),
      ]);
      const changed = await log(ctx, "?filter_category=is:changed");
      const asked = await log(ctx, "?filter_category=is:asked");
      const denied = await log(ctx, "?filter_category=is:denied");
      const failed = await log(ctx, "?filter_category=is:failed");
      await ctx.verify("the tabs", [
        same("Changed files: the writes and Builder operations that succeeded", [changed.total, sorted(changed.tools)], [6, ["BuilderAddBlock", "BuilderAddBlock", "BuilderDeletePage", "Edit", "Edit", "Write"]]),
        same("Asked you: every call that needed an approval, whatever the answer", [asked.total, sorted(asked.tools)], [8, ["Bash", "Bash", "Bash", "BuilderDeletePage", "Edit", "Edit", "Edit", "Write"]]),
        same("Denied or blocked: denied, blocked and expired", [denied.total, sorted(denied.tools), sorted(denied.rows.map((row) => text(row, "allowedBy")))], [4, ["Bash", "Bash", "Edit", "Edit"], ["blocked", "denied", "denied", "expired"]]),
        same("Failed", [failed.total, failed.tools, text(failed.rows[0], "target")], [1, ["Bash"], "pnpm lint"]),
      ]);
      await ctx.verify("the filters", [
        same("tool Bash", (await log(ctx, "?filter_tool=is:Bash")).total, 6),
        same("tool Skill", (await log(ctx, "?filter_tool=is:Skill")).total, 11),
        same("tool List folder", (await log(ctx, "?filter_tool=is:LS")).total, 10),
        same("agent Codex", (await log(ctx, "?filter_agent=is:codex")).total, 3),
        same("agent Claude Code", (await log(ctx, "?filter_agent=is:claude")).total, 41),
        same("Read-only hidden", (await log(ctx, "?filter_isReadOnly=is:false")).total, 14),
        same("a tab and a tool together", (await log(ctx, "?filter_category=is:asked&filter_tool=is:Edit")).total, 3),
      ]);
      await ctx.verify("the search", [
        same("over the target, any case", (await log(ctx, "?search=PNPM")).total, 5),
        same("over the tool", (await log(ctx, "?search=skill")).total, 11),
        same("over the conversation title", (await log(ctx, "?search=explain")).total, 3),
        same("over another title", (await log(ctx, "?search=edge reads")).total, 15),
        same("over a path", (await log(ctx, "?search=notes/b")).total, 3),
        same("a word nothing holds", (await log(ctx, "?search=zzzz")).total, 0),
      ]);
      const deletion = all.rows.find((row) => text(row, "tool") === "BuilderDeletePage");
      const command = all.rows.find((row) => text(row, "target") === "rm -rf dist");
      await ctx.verify("a deletion's target", [
        same("is the page, in the error tone", [text(deletion, "target"), pick(deletion, "actionDetail", "text"), pick(deletion, "actionDetail", "tone")], ["/orders", "/orders", "error"]),
        same("another command is not", [pick(command, "actionDetail", "text"), pick(command, "actionDetail", "tone")], ["rm -rf dist", undefined]),
        same("nor an edit", pick(all.rows.find((row) => text(row, "tool") === "Edit"), "actionDetail", "tone"), undefined),
      ]);
      const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
      await ctx.verify("the periods", [
        same("24 hours: the 24 calls and the 2 at 23 hours, not the 3 at 25", (await log(ctx, `?from=${iso(now - day)}`)).total, 26),
        same("7 days: the 2 at 6.5 days, not the 3 at 7.5", (await log(ctx, `?from=${iso(now - 7 * day)}`)).total, 31),
        same("30 days: the 2 at 29 days, not the 3 at 31", (await log(ctx, `?from=${iso(now - 30 * day)}`)).total, 39),
        same("everything before 8 days ago", (await log(ctx, `?to=${iso(now - 8 * day)}`)).total, 10),
        same("a window between two others", (await log(ctx, `?from=${iso(now - 30 * day)}&to=${iso(now - 8 * day)}`)).total, 5),
      ]);
    },
  },
  {
    id: "the-page-shows-the-log-its-tabs-periods-and-more-rows",
    title: "the Activity page shows tab counts, 25 of 44 rows with Load more, Result and Allowed labels, a tab's rows, a period's rows and a search",
    entryPoint: "/modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      const rowCount = () => tab.page.getByRole("row").count();
      await ctx.verify("the first page", [
        pageHas(tab, "the tab counts", /All\s*44\s*Changed files\s*6\s*Asked you\s*8\s*Denied or blocked\s*4\s*Failed\s*1/),
        pageHas(tab, "25 of 44 and Load more", /25 of 44\s*Load more/),
        pageHas(tab, "the columns", /TIME\s*ACTION\s*ALLOWED\s*RESULT\s*CONVERSATION\s*DURATION/),
        pageHas(tab, "the last call first, as its tool and target", /Find files =SUM\(1,2\),"q"\s*Read-only, automatic\s*Done\s*Add a revenue chart/),
        pageHas(tab, "a failed call", /Run command pnpm lint\s*Full auto\s*Failed/),
        pageHas(tab, "a denied call with its reason", /Run command rm -rf dist\s*Denied by you\s*Not run\s*use the Builder/),
        pageHas(tab, "a blocked call", /Edit file src\/notes\/c\.txt\s*Blocked · safe mode\s*Blocked\s*Blocked by safe mode/),
        pageHas(tab, "an expired call", /Run command pnpm build\s*Expired\s*Expired\s*Request expired/),
        pageHas(tab, "a stopped call", /Run command pnpm test\s*Allowed by a rule\s*Stopped/),
        pageHas(tab, "a call approved by you", /Edit file src\/notes\/b\.txt\s*Approved by you\s*Done/),
        pageHas(tab, "a call of the Builder", /Add block\s*Builder, automatic\s*Done/),
        check("25 rows and the header", (await rowCount()) === 26, await rowCount()),
      ]);
      await tab.click({ role: "button", name: "Load more" });
      await ctx.verify("Load more", [pageHas(tab, "44 of 44", /44 of 44/), pageHas(tab, "the oldest row", /Read file docs\/0\.md/), pageHas(tab, "no more button", /Load more/, false), check("44 rows and the header", (await rowCount()) === 45, await rowCount())]);
      await tab.click({ role: "button", name: "Failed 1" });
      await ctx.verify("the Failed tab", [pageHas(tab, "its row", /Run command pnpm lint/), pageHas(tab, "and no other", /Search code total/, false), check("one row and the header", (await rowCount()) === 2, await rowCount())]);
      await tab.click({ role: "button", name: "Denied or blocked 4" });
      await ctx.verify("the Denied or blocked tab", [pageHas(tab, "the blocked edit", /Edit file src\/notes\/c\.txt/), pageHas(tab, "the denied command", /Run command rm -rf dist/), check("four rows and the header", (await rowCount()) === 5, await rowCount())]);
      await tab.click({ role: "button", name: "All 44" });
      await tab.click({ role: "radio", name: "Last 7 days" });
      await ctx.verify("7 days", [pageHas(tab, "drops the old conversations", /Explain the project/, false), pageHas(tab, "25 of 31 and Load more", /25 of 31\s*Load more/)]);
      await tab.click({ role: "radio", name: "All time" });
      await tab.click({ role: "button", name: "Open search" });
      await tab.fill({ role: "textbox", name: "Search tools, files, pages" }, "notes/c.txt");
      await ctx.verify("a search over a target only", [pageHas(tab, "keeps the row", /Edit file src\/notes\/c\.txt/), pageHas(tab, "and no other", /Run command pnpm lint|Search code total|Write file/, false), check("one row and the header", (await rowCount()) === 2, await rowCount())]);
      await tab.fill({ role: "textbox", name: "Search tools, files, pages" }, "/orders");
      const red = (/** @type {RegExp} */ pattern) => tab.page.getByText(pattern).first().evaluate((element) => getComputedStyle(element).color);
      const target = await red(/^\/orders$/);
      await tab.fill({ role: "textbox", name: "Search tools, files, pages" }, "rm -rf");
      const plain = await red(/^rm -rf dist$/);
      await ctx.verify("a deletion's target", [check("is drawn in another colour than a command's", target !== plain, `deletion ${target}, command ${plain}`)]);
      await tab.fill({ role: "textbox", name: "Search tools, files, pages" }, "Explain");
      await ctx.verify("the search", [pageHas(tab, "keeps the codex conversation", /Read file docs\/1\.md/), pageHas(tab, "drops the others", /Run command pnpm lint/, false)]);
    },
  },
  {
    id: "a-row-opens-its-detail-with-the-arguments-trail-output-and-diff",
    title: "a click on a row opens the Action detail panel: position, group and time, Allowed and Result, Arguments, the Decision trail from Requested to Done, Output and Show raw JSON; J and K step, and ?record= opens a row",
    entryPoint: "/modules/ai/activity, GET /ai/activity/:id",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const write = await ai(ctx, "the Write call", "GET", "/activity/conv-new:call-11");
      const denied = await ai(ctx, "the denied call", "GET", "/activity/conv-new:call-16");
      const auto = await ai(ctx, "the automatic call", "GET", "/activity/conv-new:call-1");
      const labels = (/** @type {import("../ai.mjs").Answer} */ answer) => list(answer.body, "decisionTrail").map((step) => text(step, "label"));
      await ctx.verify("the detail routes", [
        same("a write asked about and approved: the trail", labels(write), ["Requested", "Asked you", "Allowed by you (Verify Admin)", "Done"]),
        same("its arguments and output", [pick(write.body, "args"), text(write.body, "output")], [{ file_path: "src/notes/a.txt" }, "Write answered"]),
        same("it belongs to change set 1 and shows its diff", [pick(write.body, "changeSetNumber"), list(write.body, "diff").map((file) => text(file, "path")), pick(write.body, "added"), pick(write.body, "removed")], [1, ["src/notes/a.txt"], 1, 0]),
        same("a read-only call: the automatic decision", labels(auto), ["Requested", "Allowed automatically (read-only)", "Done"]),
      ]);
      await ctx.verify("a denied call", [check("the trail names the refusal", labels(denied).some((label) => label.startsWith("Denied")), labels(denied).join(" > ")), same("and ends there", labels(denied).at(-1) === "Done", false)]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await clickUntil(tab, { role: "cell", name: "Search code total" }, /Action detail/);
      await ctx.verify("the panel", [
        pageHas(tab, "its title", /Action detail/),
        pageHas(tab, "its position among the rows", /2 \/ 44\s*K\s*J/),
        pageHas(tab, "its group and target", /Code · [^\n]*\s*Grep · total/i),
        pageHas(tab, "Allowed and Result", /Allowed\s*Read-only, automatic\s*Result\s*Done/i),
        pageHas(tab, "its arguments", /Arguments\s*pattern\s*total/i),
        pageHas(tab, "its trail", /Decision trail\s*[^\n]*Requested\s*[^\n]*Allowed automatically \(read-only\)\s*[^\n]*Done/i),
        pageHas(tab, "its output", /Output\s*Text\s*Grep answered/i),
        tab.visible({ role: "button", name: "Show raw JSON" }),
        tab.enabled({ role: "button", name: "Previous" }),
      ]);
      await tab.press("j");
      await ctx.verify("J goes to the next row", [pageHas(tab, "3 of 44", /3 \/ 44/), pageHas(tab, "the panel is still open", /Action detail/)]);
      await tab.press("k");
      await ctx.verify("K goes back", [pageHas(tab, "2 of 44", /2 \/ 44/), pageHas(tab, "the first row", /Grep · total/)]);
      await tab.goto(`/modules/ai/activity?record=${encodeURIComponent("conv-new:call-11")}`);
      await ctx.verify("a link opens a row", [
        pageHas(tab, "the write", /Write · src\/notes\/a\.txt|Edit file · src\/notes\/a\.txt|Write file · src\/notes\/a\.txt/),
        pageHas(tab, "applied with its set", /Applied\s*·\s*#1/i),
        pageHas(tab, "the trail with the name", /Allowed by you \(Verify Admin\)/),
        pageHas(tab, "its diff", /first note/),
        pageHas(tab, "View change set #1", /View change set #1/),
      ]);
      await tab.click({ role: "button", name: "Show raw JSON" });
      await ctx.verify("the raw record", [pageHas(tab, "holds the id", /"id": "conv-new:call-11"/)]);
    },
  },
  {
    id: "the-export-holds-every-row-whatever-the-tab-and-the-period",
    title: "the CSV export writes one line per record in the documented columns, quoting commas and quotes and guarding a formula, whatever the page shows",
    entryPoint: "GET /ai/activity/export.csv",
    async run(/** @type {Ctx} */ ctx) {
      await seedSample(ctx);
      const csv = await raw(ctx, "the CSV on a filtered request", { path: `${AI}/activity/export.csv?filter_category=is:failed&from=${new Date(Date.now() - 4 * MS_HOUR).toISOString()}`, as: "admin" });
      const lines = csv.text.split("\r\n");
      recordRaw(ctx, csv, [
        same("the header", lines[0] + "\r\n", CSV_HEADER),
        check("the filter and the period apply to the export", lines.length === 3 && /pnpm lint/.test(lines[1] ?? ""), lines.length),
        same("a final line break", csv.text.endsWith("\r\n"), true),
      ]);
      const every = await raw(ctx, "the whole CSV", { path: `${AI}/activity/export.csv`, as: "admin" });
      const rows = every.text.split("\r\n").filter(Boolean);
      const glob = rows.find((line) => line.includes("Glob"));
      recordRaw(ctx, every, [
        same("44 records and the header", rows.length, 45),
        check("a formula is guarded and a quote doubled inside quotes", Boolean(glob) && glob.includes('"\'=SUM(1,2),""q"""'), glob),
        check("the denied row names its agent and result", rows.some((line) => /,Bash,rm -rf dist,claude,denied,denied,use the Builder,/.test(line)), ""),
        check("a Codex row", rows.some((line) => /,Read,docs\/0\.md,codex,read_auto,done,/.test(line)), ""),
      ]);
    },
  },
  {
    id: "the-export-stops-at-10000-rows",
    title: "an audit log of 10,005 records exports 10,000 data lines, as the docs say",
    entryPoint: "GET /ai/activity/export.csv",
    async run(/** @type {Ctx} */ ctx) {
      await seedMany(ctx);
      const csv = await raw(ctx, "the CSV", { path: `${AI}/activity/export.csv`, as: "admin" });
      const lines = csv.text.split("\r\n").filter(Boolean);
      recordRaw(ctx, csv, [same("the header and 10,000 data lines", lines.length, 10_001), same("the newest first", lines[1]?.includes("docs/10004.md"), true)]);
    },
  },
  {
    id: "the-export-holds-what-the-sidecar-lets-through",
    title: "pinning today's behaviour next to the documented one: 10,005 records export 200 data lines, the newest first, and the page lists them 25 at a time, 50 after Load more",
    entryPoint: "GET /ai/activity/export.csv, GET /ai/activity, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await seedMany(ctx);
      const page = await ai(ctx, "the log", "GET", "/activity");
      const csv = await raw(ctx, "the CSV", { path: `${AI}/activity/export.csv`, as: "admin" });
      const lines = csv.text.split("\r\n").filter(Boolean);
      await ctx.verify("the log", [same("10,005 records", pick(page.body, "total"), 10_005), same("25 rows a page", list(page.body, "results").length, 25), same("200 at most in one list, however many are asked", (await log(ctx, "?limit=10000")).rows.length, 200)]);
      recordRaw(ctx, csv, [same("the header and 200 data lines", lines.length, 201), same("the newest first", lines[1]?.includes("docs/10004.md"), true), same("the 200th is the 200th newest", lines[200]?.includes("docs/9805.md"), true)]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [pageHas(tab, "25 of 10,005", /25 of 10,005\s*Load more/)]);
      await tab.click({ role: "button", name: "Load more" });
      await ctx.verify("Load more adds the next 25", [pageHas(tab, "50 of 10,005", /50 of 10,005/), check("50 rows and the header", (await tab.page.getByRole("row").count()) === 51, await tab.page.getByRole("row").count())]);
    },
  },
]);
