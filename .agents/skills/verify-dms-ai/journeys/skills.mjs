import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { ai, check, freshSidecar, list, pageHas, pick, same, text, until } from "../ai.mjs";

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
        same("a project skill's frontmatter", [text(note, "description"), text(note, "category"), pick(note, "tags")], ["Explains the verification playground's note page. Use when the user mentions notes or the verification playground.", "verification", ["notes", "playground", "verification"]]),
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
      await tab.fill({ role: "textbox", name: "Search name, module or tag" }, "playground");
      await ctx.verify("a search by tag", [pageHas(tab, "keeps verify-note", /verify-note/), pageHas(tab, "drops dms-pages", /dms-pages/, false)]);
      await tab.page.locator("article", { hasText: "verify-note" }).first().click();
      await ctx.verify("the reading panel", [
        pageHas(tab, "its header", /Skill \d+ of \d+/),
        pageHas(tab, "the rows", /Source\s*Module[\s\S]*Full name\s*\S+:verify-note[\s\S]*Origin\s*verify-dms-ai-app[\s\S]*Used\s*0[\s\S]*Last used/),
        pageHas(tab, "the SKILL.md", /The note page of the verification playground holds one text field\./),
      ]);
    },
  },
]);
