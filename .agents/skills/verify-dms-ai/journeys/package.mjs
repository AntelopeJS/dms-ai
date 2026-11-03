import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { guarded } from "../guard.mjs";
import { ai, check, list, parseJson, pick, same, text } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** @param {Ctx} ctx @param {string} file */
function read(ctx, file) {
  return readFileSync(join(ctx.state.repo, file), "utf8");
}

export const journeys = guarded([
  {
    id: "the-tarball-holds-what-the-manifest-names",
    title: "the package a project installs holds its build, the dashboard layer, the skills and the sidecar's build, and leaves out the tests, the docs sources and the playground",
    entryPoint: "npm pack --dry-run, package.json",
    async run(/** @type {Ctx} */ ctx) {
      const manifest = parseJson(read(ctx, "package.json"));
      const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: ctx.state.repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const packed = (Array.isArray(parseJson(out)) ? list(parseJson(out)[0], "files") : []).map((entry) => text(entry, "path"));
      await ctx.verify("the files", [
        check("the entry the manifest names", packed.includes(String(pick(manifest, "main"))), String(pick(manifest, "main"))),
        check("its declarations", packed.includes(String(pick(manifest, "types"))), String(pick(manifest, "types"))),
        check("the dashboard layer", packed.includes("frontend-vue/dms.frontend.ts") && packed.some((path) => path.startsWith("frontend-vue/app/chat/")), packed.length),
        check("the sidecar's build and manifest", packed.includes("sidecar/dist/index.js") && packed.includes("sidecar/package.json"), ""),
        check("the shipped skills", packed.includes("skills/dms-ai/SKILL.md") && packed.includes("skills/dms-builder-safe/REFERENCE.md"), ""),
        same("no test, docs source, playground or agent folder", packed.filter((path) => /^(tests|docs|playground|\.agents|\.campaign|sidecar\/(src|tests))\//.test(path)), []),
        same("the dashboard layer is declared", pick(manifest, "dmsFrontend"), "dist/frontend-module.js"),
        same("the skills are declared", pick(manifest, "antelopeJs", "skills"), ["./skills"]),
        same("the optional Codex peer is pinned exactly", /^\d+\.\d+\.\d+$/.test(String(pick(manifest, "peerDependencies", "@openai/codex"))), true),
        same("only the root export, and package.json", Object.keys(pick(manifest, "exports") ?? {}), [".", "./package.json"]),
      ]);
    },
  },
  {
    id: "the-docs-name-every-skill-the-module-ships",
    title: "the Skills page and the README name each skill folder the package ships and the catalog lists under the module",
    entryPoint: "skills/, README.md, docs/4.usage/5.skills.md, GET /ai/skills/catalog",
    async run(/** @type {Ctx} */ ctx) {
      const folders = execFileSync("ls", [join(ctx.state.repo, "skills")], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
      const rows = list((await ai(ctx, "catalog", "GET", "/skills/catalog")).body, "results");
      const listed = rows.filter((row) => text(row, "origin") === "dms-ai").map((row) => text(row, "name")).sort();
      const readme = read(ctx, "README.md");
      const page = read(ctx, "docs/4.usage/5.skills.md");
      await ctx.verify("the skills", [
        same("the catalog lists the folders", listed, folders),
        same("the README names each folder", folders.filter((name) => !readme.includes(`\`${name}\``)), []),
        same("the Skills page names each folder", folders.filter((name) => !page.includes(`\`${name}\``)), []),
      ]);
    },
  },
]);
