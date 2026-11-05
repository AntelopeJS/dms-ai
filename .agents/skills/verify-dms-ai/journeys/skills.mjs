import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { ai, check, clickUntil, freshSidecar, list, pageHas, pick, same, statusIs, text, until } from "../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../sample.mjs";
import { seedStore } from "../seed.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** @param {Ctx} ctx @param {string} source */
async function catalog(ctx, source) {
  const answer = await ai(ctx, `catalog ${source || "all"}`, "GET", `/skills/catalog${source ? `?filter_source=is:${source}` : ""}`);
  return list(answer.body, "results");
}

/** @param {Ctx} ctx @param {string} name @param {string} body */
function localSkill(ctx, name, body) {
  const dir = join(ctx.state.home, ".claude", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

const SHIPPED = ["dms-ai", "dms-ai-code-mode", "dms-builder-safe", "dms-external-database"];

/**
 * A check on the names of the cards the page shows once it has settled, the conflicts banner aside.
 *
 * @param {import("../ai.mjs").Tab} tab The tab
 * @param {string} name What is checked
 * @param {string[]} expected The card names, sorted
 * @returns {Promise<import("../ai.mjs").Check>} The check
 */
async function cards(tab, name, expected) {
  const names = async () => (await tab.page.locator("article").allInnerTexts()).map((card) => card.trim().split(/\s+/)[0]).sort();
  await until(async () => JSON.stringify(await names()) === JSON.stringify(expected), { timeoutMs: 20_000 });
  return same(name, await names(), expected);
}

export const journeys = guarded([
  {
    id: "the-catalog-lists-what-modules-ship",
    title: "the catalog lists the skills of the loaded modules by their frontmatter: name, description, icon, category, tags, origin, and skips a SKILL.md without frontmatter, name or description",
    entryPoint: "GET /ai/skills/catalog",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const rows = await catalog(ctx, "");
      const byName = new Map(rows.map((row) => [text(row, "name"), row]));
      const note = byName.get("verify-note");
      const names = rows.map((row) => text(row, "name"));
      await ctx.verify("the module skills", [
        check("the four skills dms-ai ships are there", SHIPPED.every((name) => byName.has(name)), names.join(",")),
        same("a shipped skill's origin and source", [text(byName.get("dms-ai"), "origin"), text(byName.get("dms-ai"), "source")], ["dms-ai", "module"]),
        check("the DMS core skills are there", ["dms", "dms-pages", "dms-auth", "dms-best-practices", "dms-module", "dms-project"].every((name) => byName.has(name)), names.join(",")),
        same("a project skill's frontmatter", [text(note, "description"), text(note, "category"), pick(note, "tags")], ["Explains the verification playground's note page. Use when the user mentions notes or the verification playground.", "verification", ["notes", "playground", "verification", "inkwell"]]),
        same("its icon", text(note, "icon"), "i-lucide-notebook"),
        same("its name is qualified by its module", text(note, "qualifiedName").endsWith(":verify-note"), true),
        same("its origin is the module that ships it", text(note, "origin"), "verify-dms-ai-app"),
        check("its body is its SKILL.md", text(note, "body").includes("# verify-note"), text(note, "body").slice(0, 60)),
        same("a skill never used", [pick(note, "uses30d"), pick(note, "lastUsedAt")], [0, undefined]),
        same("no SKILL.md without frontmatter, name or description", ["no-frontmatter", "no-name", "verify-no-description"].filter((name) => byName.has(name)), []),
      ]);
    },
  },
  {
    id: "a-module-skill-shadows-a-local-skill-of-the-same-name",
    title: "a local skill named like a module skill is marked Shadowed with the module skill that wins, the conflicts route counts the shared names, and the page shows the banner and the badge",
    entryPoint: "GET /ai/skills/catalog, /ai/skills/conflicts, /modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      localSkill(ctx, "verify-note", "---\nname: verify-note\ndescription: A local copy of a module skill.\n---\n\n# local copy\n");
      await ai(ctx, "switch machine-local skills on", "PUT", "/settings", { body: { allowLocalSkills: true } });
      await ai(ctx, "restart so the folder is read", "POST", "/sidecar/restart");
      await until(async () => text((await ai(ctx, "ready", "GET", "/status")).body, "status") === "ready", { timeoutMs: 60_000 });
      const rows = (await catalog(ctx, "")).filter((row) => text(row, "name") === "verify-note");
      const winner = rows.find((row) => text(row, "source") === "module");
      const loser = rows.find((row) => text(row, "source") === "local");
      const conflicts = await ai(ctx, "conflicts", "GET", "/skills/conflicts");
      await ctx.verify("the catalog", [
        same("both copies are listed", rows.length, 2),
        same("the module copy is used", pick(winner, "isShadowed"), false),
        same("the local copy is shadowed", pick(loser, "isShadowed"), true),
        same("and says which skill is used instead", text(loser, "shadowedBy"), text(winner, "_id")),
      ]);
      await ctx.verify("the conflicts route", [
        same("a warning", text(conflicts.body, "tone"), "warning"),
        same("it names the shared names", text(conflicts.body, "description", "params", "names").split(", ").sort(), ["verify-note", "verify-twin"]),
        same("it counts them", pick(conflicts.body, "title", "params", "count", "value"), 2),
        same("it links to the skill settings", text(list(conflicts.body, "actions")[0], "to"), "/modules/ai/settings#dms-form-settings-section-skills"),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/skills");
      await ctx.verify("the page", [
        pageHas(tab, "the banner", /2 skill names are shared by several skills/),
        pageHas(tab, "the badge", /Shadowed/),
      ]);
    },
  },
  {
    id: "two-skills-of-one-module-with-one-name-shadow-one-copy",
    title: "two skills of one module with one name: the catalog marks the second Shadowed with the one used instead, the conflicts route warns, and the page shows the banner and the badge",
    entryPoint: "GET /ai/skills/conflicts, /modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const rows = (await catalog(ctx, "")).filter((row) => text(row, "name") === "verify-twin");
      const conflicts = await ai(ctx, "conflicts", "GET", "/skills/conflicts");
      const [first, second] = rows;
      await ctx.verify("the catalog", [
        same("both copies are listed", rows.length, 2),
        same("exactly one is shadowed", rows.filter((row) => pick(row, "isShadowed") === true).length, 1),
        check("the shadowed one says which skill is used instead", rows.some((row) => pick(row, "isShadowed") === true && text(row, "shadowedBy") !== ""), JSON.stringify(rows.map((row) => pick(row, "shadowedBy")))),
        check("the two copies have different bodies", text(first, "body") !== text(second, "body"), ""),
      ]);
      await ctx.verify("the conflicts route", [
        same("a warning", text(conflicts.body, "tone"), "warning"),
        same("one name", pick(conflicts.body, "title", "params", "count", "value"), 1),
        same("the name shared", text(conflicts.body, "description", "params", "names"), "verify-twin"),
        same("it links to the skill settings", text(list(conflicts.body, "actions")[0], "to"), "/modules/ai/settings#dms-form-settings-section-skills"),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/skills");
      await ctx.verify("the page", [
        pageHas(tab, "the banner", /1 skill name is shared by several skills\s*verify-twin: only one copy of the name is used, the other is marked Shadowed\. Rename a copy to use both\./),
        pageHas(tab, "the badge", /Shadowed/),
      ]);
    },
  },
  {
    id: "machine-local-skills-need-their-switch",
    title: "skills of ~/.claude/skills appear under Local only with Use machine-local skills on, and leave with it",
    entryPoint: "PUT /ai/settings, GET /ai/skills/catalog?filter[source]=local, /modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      localSkill(ctx, "my-local-skill", "---\nname: my-local-skill\ndescription: A skill of this machine. Use when the verification run asks for it.\ntags: [machine]\n---\n\n# my-local-skill\n\nLOCAL-BODY\n");
      await ai(ctx, "restart so the folder is read", "POST", "/sidecar/restart");
      await until(async () => text((await ai(ctx, "ready", "GET", "/status")).body, "status") === "ready", { timeoutMs: 60_000 });
      const off = await catalog(ctx, "local");
      await ai(ctx, "switch machine-local skills on", "PUT", "/settings", { body: { allowLocalSkills: true } });
      const on = await until(async () => {
        const rows = await catalog(ctx, "local");
        return rows.length > 0 ? rows : null;
      }, { timeoutMs: 20_000 });
      const row = (on ?? [])[0];
      await ctx.verify("the switch", [
        same("off: no local skill", off.length, 0),
        same("on: the skill appears with its source", [text(row, "name"), text(row, "source")], ["my-local-skill", "local"]),
        same("its origin is the folder", text(row, "origin"), "~/.claude/skills"),
        check("its body", text(row, "body").includes("LOCAL-BODY"), text(row, "body")),
        same("the All list holds it too", (await catalog(ctx, "")).some((r) => text(r, "name") === "my-local-skill"), true),
        same("the Modules list does not", (await catalog(ctx, "module")).some((r) => text(r, "name") === "my-local-skill"), false),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/skills");
      await ctx.verify("the page", [pageHas(tab, "the Local tab counts one", /Local\s*1/)]);
      await tab.click({ role: "button", name: "Local 1" });
      await ctx.verify("the Local tab", [pageHas(tab, "the card", /my-local-skill\s*~\/\.claude\/skills\s*Local/), pageHas(tab, "only that card", /dms-pages/, false)]);
      await ai(ctx, "switch it off", "PUT", "/settings", { body: { allowLocalSkills: false } });
      const gone = await until(async () => (await catalog(ctx, "local")).length === 0, { timeoutMs: 20_000 });
      await ctx.verify("switching off", [check("the local skill leaves", gone, gone)]);
    },
  },
  {
    id: "use-counts-and-last-use-come-from-the-conversations",
    title: "a skill's use count over 30 days, its last use and its last conversation come from the Skill calls in the stored conversations, and the cards are sorted by use, most used first",
    entryPoint: "GET /ai/skills/catalog, /modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      const now = Date.now();
      await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
      const rows = await catalog(ctx, "");
      const named = (/** @type {string} */ name) => rows.find((row) => text(row, "name") === name);
      const used = named("dms-ai");
      await ctx.verify("the catalog", [
        same("dms-ai: used 4 times", pick(used, "uses30d"), 4),
        same("dms-ai-code-mode: once", pick(named("dms-ai-code-mode"), "uses30d"), 1),
        same("dms-builder-safe: once, ten days ago", pick(named("dms-builder-safe"), "uses30d"), 1),
        same("dms-pages: twice 29 days ago, not the three calls 31 days ago", pick(named("dms-pages"), "uses30d"), 2),
        same("a skill never called", pick(named("dms-auth"), "uses30d"), 0),
        same("the last use of dms-ai is the latest of its calls", Date.parse(text(used, "lastUsedAt")) > now - 3 * 3_600_000 && Date.parse(text(used, "lastUsedAt")) < now - 2 * 3_600_000, true),
        same("and its conversation", text(used, "lastConversationId"), "conv-new"),
        same("its last use is that day", Math.round((now - Date.parse(text(named("dms-builder-safe"), "lastUsedAt"))) / 86_400_000), 10),
        same("dms-pages: its last use is the 29 day old call, not the older ones", Math.round((now - Date.parse(text(named("dms-pages"), "lastUsedAt"))) / 86_400_000), 29),
        same("a skill never called has no last use", pick(named("dms-auth"), "lastUsedAt"), undefined),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/skills");
      await ctx.verify("the page", [
        pageHas(tab, "the most used first, with their counts", /dms-ai dms-ai Module[^\n]*4 uses[\s\S]*dms-pages dms Module[^\n]*2 uses[\s\S]*dms-ai-code-mode dms-ai Module[^\n]*1 use/i),
        pageHas(tab, "the others never used", /never used/),
      ]);
    },
  },
  {
    id: "the-page-lists-24-skills-and-opens-a-panel-768-px-wide",
    title: "with 30 machine-local skills the Local tab counts 30 and lists 24 cards on the first page and 6 on the second; the reading panel of a card is 768 px wide on a large screen",
    entryPoint: "/modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      for (let index = 1; index <= 30; index += 1) {
        const name = `local-skill-${String(index).padStart(2, "0")}`;
        localSkill(ctx, name, `---\nname: ${name}\ndescription: Local skill number ${index}. Use when the verification asks for it.\n---\n\n# ${name}\n`);
      }
      await ai(ctx, "switch machine-local skills on", "PUT", "/settings", { body: { allowLocalSkills: true } });
      await ai(ctx, "restart so the folder is read", "POST", "/sidecar/restart");
      await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
      const local = await until(async () => (await catalog(ctx, "local")).length === 30, { timeoutMs: 30_000, everyMs: 1500 });
      await ctx.verify("the catalog", [check("30 local skills", local, local)]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.page.setViewportSize({ width: 1440, height: 900 });
      await tab.goto("/modules/ai/skills");
      await clickUntil(tab, { role: "button", name: "Local 30" }, /30 skills\s*Page size\s*24/);
      const cards = () => tab.page.locator("article").count();
      await until(async () => (await cards()) > 0, { timeoutMs: 15_000 });
      await ctx.verify("the first page", [check("24 cards", (await cards()) === 24, await cards()), pageHas(tab, "the tab count", /Local\s*30/), pageHas(tab, "30 skills and the page size", /30 skills\s*Page size\s*24/)]);
      await tab.snapshot("page one of the local skills");
      await ctx.verify("the pager text", [pageHas(tab, "names the page", /Page 1 of 2/)]);
      await clickUntil(tab, { role: "button", name: "Next page" }, /Page 2 of 2/);
      await until(async () => (await cards()) === 6, { timeoutMs: 15_000 });
      await ctx.verify("the second page", [check("6 cards", (await cards()) === 6, await cards()), pageHas(tab, "page 2 of 2", /Page 2 of 2/)]);
      await tab.page.locator("article").first().click();
      await until(async () => (await tab.page.getByRole("dialog").count()) > 0, { timeoutMs: 15_000 });
      const box = await tab.page.getByRole("dialog").first().boundingBox();
      await ctx.verify("the reading panel", [same("768 px wide", box === null ? null : Math.round(box.width), 768), pageHas(tab, "its position among the cards", /Skill \d+ of 30/), pageHas(tab, "its rows", /Source\s*Local[\s\S]*Origin\s*~\/\.claude\/skills[\s\S]*Used\s*0/)]);
    },
  },
  {
    id: "the-page-shows-cards-tabs-search-and-the-reading-panel",
    title: "the Skills page shows a card per skill with module and badge, tabs with counts, a search over name, module and tag, and a panel with Source, Full name, Origin, Used and the SKILL.md",
    entryPoint: "/modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const rows = await catalog(ctx, "");
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/skills");
      await ctx.verify("the page", [
        pageHas(tab, "the tabs count the catalog", new RegExp(`All\\s*${rows.length}\\s*Modules\\s*${rows.length}\\s*Local\\s*0`)),
        pageHas(tab, "a card shows the skill, its module, its badge and its use", /verify-note\s*verify-dms-ai-app\s*Module/),
        pageHas(tab, "never used", /never used/),
        pageHas(tab, "the skill settings link", /Skill settings/),
      ]);
      await tab.click({ role: "button", name: "Open search" });
      await tab.click({ role: "textbox", name: "Search name, module or tag" });
      await tab.fill({ role: "textbox", name: "Search name, module or tag" }, "verify-note");
      await ctx.verify("a search by name", [pageHas(tab, "keeps verify-note", /verify-note/), pageHas(tab, "drops dms-pages", /dms-pages/, false)]);
      await tab.page.locator("article", { hasText: "verify-note" }).first().click();
      await ctx.verify("the reading panel", [
        pageHas(tab, "its header", /Skill \d+ of \d+/),
        pageHas(tab, "the rows", /Source\s*Module[\s\S]*Full name\s*\S+:verify-note[\s\S]*Origin\s*verify-dms-ai-app[\s\S]*Used\s*0[\s\S]*Last used/),
        pageHas(tab, "the SKILL.md", /The note page of the verification playground holds one text field\./),
      ]);
    },
  },
  {
    id: "a-search-finds-a-skill-by-its-tag-or-its-module",
    title: "the search box, labelled Search name, module or tag, finds verify-note by its tag inkwell and the playground's skills by their module verify-dms-ai-app, words found nowhere in their name or description",
    entryPoint: "/modules/ai/skills",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const rows = await catalog(ctx, "");
      const note = rows.find((row) => text(row, "name") === "verify-note");
      await ctx.verify("the words are only a tag and only a module", [
        same("inkwell is a tag of verify-note", pick(note, "tags"), ["notes", "playground", "verification", "inkwell"]),
        same("no name or description holds inkwell or dms-ai-app", rows.filter((row) => /inkwell|dms-ai-app/.test(`${text(row, "name")} ${text(row, "description")}`)).map((row) => text(row, "name")), []),
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/skills");
      await tab.click({ role: "button", name: "Open search" });
      await tab.click({ role: "textbox", name: "Search name, module or tag" });
      await tab.fill({ role: "textbox", name: "Search name, module or tag" }, "inkwell");
      await ctx.verify("a search by tag", [await cards(tab, "only verify-note", ["verify-note"])]);
      await tab.fill({ role: "textbox", name: "Search name, module or tag" }, "dms-ai-app");
      await ctx.verify("a search by module", [await cards(tab, "the skills of verify-dms-ai-app, as the catalog lists them", rows.filter((row) => text(row, "origin") === "verify-dms-ai-app").map((row) => text(row, "name")).sort())]);
    },
  },
]);
