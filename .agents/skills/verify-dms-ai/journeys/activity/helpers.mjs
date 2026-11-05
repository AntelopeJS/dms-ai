import { ai, list, pick, text } from "../../ai.mjs";
import { sampleChangeSets, sampleConversations } from "../../sample.mjs";
import { MS_DAY, conversation, seedStore, toolResult, toolUse, userMessage } from "../../seed.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

/** Seeds one conversation of 10,005 reads, one every second. */
export async function seedMany(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  const messages = [userMessage("Many reads", now - 2 * MS_DAY)];
  for (let index = 0; index < 10_005; index += 1) {
    const at = now - MS_DAY + index * 1000;
    messages.push(toolUse(`r-${index}`, "Read", { file_path: `docs/${index}.md` }, at, { allowedBy: "read_auto" }), toolResult(`r-${index}`, at + 100, { allowedBy: "read_auto" }));
  }
  await seedStore(ctx, { conversations: { many: conversation(messages) } });
}

export const CSV_HEADER = "time,tool,target,agent,allowed_by,result,result_detail,change_set,conversation_id,conversation,duration_ms,read_only,auto_fix\r\n";

/** @param {Ctx} ctx @param {string} query @returns {Promise<{ total: number, tools: string[], rows: import("../../ai.mjs").Row[] }>} */
export async function log(ctx, query) {
  const answer = await ai(ctx, `the log ${query}`, "GET", `/activity${query}`);
  const rows = list(answer.body, "results");
  return { total: Number(pick(answer.body, "total")), tools: rows.map((row) => text(row, "tool")), rows };
}

/** @param {string[]} names @returns {string[]} sorted copy */
export const sorted = (names) => [...names].sort();

/** The sample, seeded: 44 records, 31 of them in the last seven days. */
export async function seedSample(/** @type {Ctx} */ ctx) {
  const now = Date.now();
  await seedStore(ctx, { conversations: sampleConversations(now, { one: "cs-one", two: "cs-two" }), build: () => sampleChangeSets(ctx, now) });
  return now;
}
