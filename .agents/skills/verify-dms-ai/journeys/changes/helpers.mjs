import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ai, text } from "../../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../../sample.mjs";
import { projectRoot, seedStore } from "../../seed.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

/** The sample, seeded: three change sets over `src/notes/a.txt` and `src/notes/b.txt`. */
export async function seedSample(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
  return now;
}

/** @param {Ctx} ctx @param {string} name @returns {string} the text of a project file, or "<absent>" */
export function fileText(ctx, name) {
  const file = join(projectRoot(ctx), "src", "notes", name);
  return existsSync(file) ? readFileSync(file, "utf8") : "<absent>";
}

/** @param {Ctx} ctx @param {string} id @returns {Promise<{ state: string, by: string, log: string[] }>} the state of a set */
export async function stateOf(ctx, id) {
  const body = (await ai(ctx, `change set ${id}`, "GET", `/changes/${id}`)).body;
  return { state: text(body, "changeSet", "state"), by: text(body, "changeSet", "stateChangedBy"), log: [] };
}
