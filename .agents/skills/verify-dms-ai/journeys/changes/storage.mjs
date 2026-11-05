import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { ai, check, list, pageHas, pick, same, text, until, withEnv } from "../../ai.mjs";
import { MS_DAY, conversation, recordChangeSet, seedStore, userMessage, writeProjectFile } from "../../seed.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const storageJourneys = [
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
    title: "the assistant keeps a change set within the checkpoint retention and drops an older one at its start: 7 days with sets 6 and 7.5 days old, then the default 30 days with sets 29 and 30.5 days old, then 90 days with sets 89 and 90.5 days old",
    entryPoint: "settings.json checkpointRetentionDays, GET /ai/changes",
    async run(/** @type {Ctx} */ ctx) {
      for (const [retention, kept, dropped] of [[7, 6, 7.5], [30, 29, 30.5], [90, 89, 90.5]]) {
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
];
