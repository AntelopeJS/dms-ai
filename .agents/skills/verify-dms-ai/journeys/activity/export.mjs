import { AI, ai, check, list, pageHas, pick, raw, recordRaw, same } from "../../ai.mjs";
import { MS_HOUR } from "../../seed.mjs";
import { seedMany, CSV_HEADER, log, seedSample } from "./helpers.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const exportJourneys = [
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
      recordRaw(ctx, csv, [same("the header and 10,000 data lines", lines.length, 10_001), same("the newest first", lines[1]?.includes("docs/10004.md"), true), same("the 10,000th is the 10,000th newest", lines[10_000]?.includes("docs/5.md"), true)]);
    },
  },
  {
    id: "a-list-page-holds-200-rows-however-many-are-asked",
    title: "10,005 records list 25 rows a page, 200 at most however many are asked, and 50 after Load more",
    entryPoint: "GET /ai/activity, /modules/ai/activity",
    async run(/** @type {Ctx} */ ctx) {
      await seedMany(ctx);
      const page = await ai(ctx, "the log", "GET", "/activity");
      await ctx.verify("the log", [same("10,005 records", pick(page.body, "total"), 10_005), same("25 rows a page", list(page.body, "results").length, 25), same("200 at most in one list, however many are asked", (await log(ctx, "?limit=10000")).rows.length, 200)]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/activity");
      await ctx.verify("the page", [pageHas(tab, "25 of 10,005", /25 of 10,005\s*Load more/)]);
      await tab.click({ role: "button", name: "Load more" });
      await ctx.verify("Load more adds the next 25", [pageHas(tab, "50 of 10,005", /50 of 10,005/), check("50 rows and the header", (await tab.page.getByRole("row").count()) === 51, await tab.page.getByRole("row").count())]);
    },
  },
];
