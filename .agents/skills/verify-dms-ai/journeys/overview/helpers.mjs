import { ai } from "../../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../../sample.mjs";
import { seedStore } from "../../seed.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

/** The sample, seeded: 44 records, 5 change sets, the first `undone` of them undone an hour ago. */
export async function seedSample(/** @type {Ctx} */ ctx, { undone = 0 } = {}) {
  const now = Date.now();
  const build = () => {
    const sets = sampleChangeSets(ctx, now);
    for (const set of sets.slice(0, undone)) set.stateLog = [{ state: "undone", atMs: now - 3_600_000, by: "Verify Admin" }];
    return sets;
  };
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build });
  return now;
}

/** @param {Ctx} ctx @param {string} path @param {string} query @returns {Promise<unknown>} the body */
export async function metric(ctx, path, query) {
  return (await ai(ctx, `metric ${path}`, "GET", `/metrics/${path}?${query}`)).body;
}
