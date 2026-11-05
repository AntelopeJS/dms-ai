import { ai, pick } from "../../ai.mjs";

/** @typedef {import("../../ai.mjs").Ctx} Ctx */

export const DEFAULTS = {
  provider: "claude",
  mode: "normal",
  thinking: "medium",
  claudeModel: "claude-opus-5-5",
  generationMode: "safe",
  allowLocalSkills: false,
  alwaysAskDependencies: true,
  alwaysAskBlockRemoval: true,
  requestTimeoutMinutes: "5",
  notifyRequests: true,
  checkpointRetentionDays: "30",
  alwaysAskDeletions: true,
};

/** @param {Ctx} ctx @param {string} label */
export async function settings(ctx, label) {
  return (await ai(ctx, label, "GET", "/settings")).body;
}

/** @param {unknown} body */
export function picked(body) {
  return Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, pick(body, key)]));
}
