import { ai } from "../../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../../sample.mjs";
import { seedStore } from "../../seed.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

/** The sample, seeded: 44 records, 5 change sets. */
export async function seedSample(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
  return now;
}

/** @param {Ctx} ctx @param {string} path @param {string} query @returns {Promise<unknown>} the body */
export async function metric(ctx, path, query) {
  return (await ai(ctx, `metric ${path}`, "GET", `/metrics/${path}?${query}`)).body;
}
