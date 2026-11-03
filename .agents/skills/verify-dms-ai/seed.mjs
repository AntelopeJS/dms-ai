import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sidecarPath, statusIs, stopBackend, text } from "./ai.mjs";

/** @typedef {import("./ai.mjs").Ctx} Ctx */
/** @typedef {Record<string, unknown>} Row */

export const MS_MINUTE = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;

/**
 * A user message of a stored conversation.
 *
 * @param {string} content The text
 * @param {number} timestampMs When
 * @returns {Row} The message
 */
export function userMessage(content, timestampMs) {
  return { role: "user", content, timestampMs };
}

/**
 * The call of a tool, as the sidecar stores it: arguments as JSON text.
 *
 * @param {string} callId The call id
 * @param {string} toolName The tool
 * @param {unknown} args Its arguments
 * @param {number} timestampMs When
 * @param {Row} [extra] More fields (`allowedBy`, `changeSetId`, `isAutoFix`)
 * @returns {Row} The message
 */
export function toolUse(callId, toolName, args, timestampMs, extra = {}) {
  return { role: "tool_use", toolName, callId, content: JSON.stringify(args), timestampMs, ...extra };
}

/**
 * The answer of a tool call.
 *
 * @param {string} callId The call id
 * @param {number} timestampMs When
 * @param {Row} [extra] `content`, `status`, `outcome`, `allowedBy`, `changeSetId`
 * @returns {Row} The message
 */
export function toolResult(callId, timestampMs, extra = {}) {
  return { role: "tool_result", callId, content: "ok", status: "success", timestampMs, ...extra };
}

/**
 * The audit record of an approval.
 *
 * @param {string} callId The call id
 * @param {string} toolName The tool
 * @param {number} timestampMs When
 * @param {Row} extra `allowedBy`, `kind`, `summary`, `decidedBy`, `feedback`, `alwaysAsk`
 * @returns {Row} The message
 */
export function permission(callId, toolName, timestampMs, extra) {
  return { role: "permission", callId, toolName, timestampMs, requestedAtMs: timestampMs - 2000, decision: "approved", ...extra };
}

/**
 * A stored conversation.
 *
 * @param {Row[]} messages Its messages
 * @param {Row} [extra] `provider`, `usageLog`, `tokenUsage`, `model`
 * @returns {Row} The conversation
 */
export function conversation(messages, extra = {}) {
  const times = messages.map((m) => Number(m.timestampMs));
  return { messages, createdAtMs: Math.min(...times), updatedAtMs: Math.max(...times), provider: "claude", ...extra };
}

/**
 * Where the sidecar's shadow repository and project are.
 *
 * @param {Ctx} ctx The journey
 * @returns {{ gitDir: string, root: string, env: NodeJS.ProcessEnv }} The paths and the git environment
 */
function shadow(ctx) {
  const gitDir = sidecarPath(ctx, "checkpoints.git");
  const root = ctx.state.runPlayground ?? ctx.state.playground;
  return { gitDir, root, env: { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: root, GIT_INDEX_FILE: join(gitDir, "index") } };
}

/**
 * @param {Ctx} ctx The journey
 * @param {string[]} args The git arguments
 * @returns {string} Its output
 */
function git(ctx, args) {
  const { root, env } = shadow(ctx);
  return execFileSync("git", ["--literal-pathspecs", "-c", "core.quotepath=false", ...args], { cwd: root, env, encoding: "utf8" });
}

/** Prepares the shadow repository the way the sidecar does, leaving out what it leaves out. */
function initShadow(ctx) {
  const { gitDir } = shadow(ctx);
  mkdirSync(gitDir, { recursive: true });
  git(ctx, ["init", "--quiet"]);
  for (const [key, value] of [["gc.auto", "0"], ["core.autocrlf", "false"], ["core.quotepath", "false"]]) git(ctx, ["config", key, value]);
  mkdirSync(join(gitDir, "info"), { recursive: true });
  writeFileSync(join(gitDir, "info", "exclude"), ["node_modules/", "dist/", ".antelope/", ".git/", "generated-skills/", ""].join("\n"));
}

/** @returns {string} the tree of the project now */
function snapshot(ctx) {
  git(ctx, ["add", "--all", "--ignore-errors", "--", "."]);
  return git(ctx, ["write-tree"]).trim();
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} before A tree
 * @param {string} after A tree
 * @returns {{ path: string, status: string, added: number, removed: number }[]} The files that differ
 */
function changedFiles(ctx, before, after) {
  const numstat = git(ctx, ["diff-tree", "--numstat", "-r", "--no-renames", "-z", before, after]).split("\0");
  const names = git(ctx, ["diff-tree", "--name-status", "-r", "--no-renames", "-z", before, after]).split("\0");
  const status = new Map();
  for (let i = 0; i + 1 < names.length; i += 2) status.set(names[i + 1], { A: "added", M: "modified", D: "deleted" }[names[i].charAt(0)] ?? "modified");
  return numstat.filter(Boolean).map((record) => {
    const [added, removed, path] = record.split("\t");
    return { path, status: status.get(path) ?? "modified", added: Number(added), removed: Number(removed) };
  });
}

/**
 * Records a real change set: the project's files are written by `apply` between two snapshots of the shadow
 * repository, so Undo and Redo restore bytes on disk. Returns the record to put in `change-sets.json`.
 *
 * @param {Ctx} ctx The journey
 * @param {Row} meta `id`, `number`, `title`, `conversationId`, `createdAtMs` and the summary fields
 * @param {() => void} apply Writes the project's files
 * @returns {Row} The change set record
 */
export function recordChangeSet(ctx, meta, apply) {
  const beforeTree = snapshot(ctx);
  apply();
  const afterTree = snapshot(ctx);
  const files = changedFiles(ctx, beforeTree, afterTree);
  git(ctx, ["update-ref", `refs/dms-ai/${meta.id}/before`, beforeTree]);
  git(ctx, ["update-ref", `refs/dms-ai/${meta.id}/after`, afterTree]);
  return {
    agent: "claude",
    scope: "safe",
    isAutoFix: false,
    overlapped: false,
    approvalsNeeded: 0,
    builderOps: 0,
    typecheck: "passed",
    state: "applied",
    ...meta,
    files,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
    beforeTree,
    afterTree,
  };
}

/**
 * Replaces everything the sidecar stored with these records and starts the assistant on them: the backend is
 * stopped, the sidecar's folder emptied, the files written, and the backend started again. `build` runs between,
 * with the shadow repository ready, to write real change sets.
 *
 * @param {Ctx} ctx The journey
 * @param {{ conversations?: Record<string, Row>, settings?: Row, build?: () => Row[] }} spec The stored records
 * @returns {Promise<void>}
 */
export async function seedStore(ctx, spec) {
  await stopBackend(ctx);
  rmSync(sidecarPath(ctx), { recursive: true, force: true });
  rmSync(join(ctx.state.home, ".claude"), { recursive: true, force: true });
  rmSync(join(shadow(ctx).root, "src", "notes"), { recursive: true, force: true });
  mkdirSync(sidecarPath(ctx), { recursive: true });
  const changeSets = spec.build ? (initShadow(ctx), spec.build()) : [];
  writeFileSync(sidecarPath(ctx, "state.json"), JSON.stringify({ conversations: spec.conversations ?? {} }));
  writeFileSync(sidecarPath(ctx, "change-sets.json"), JSON.stringify({ nextNumber: changeSets.length + 1, changeSets }));
  if (spec.settings) writeFileSync(sidecarPath(ctx, "settings.json"), JSON.stringify(spec.settings));
  await ctx.restartBackend();
  await statusIs(ctx, (status) => text(status, "status") === "ready", 90_000);
}

/**
 * Writes a file of the project the sidecar watches.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The path under the project
 * @param {string} body The text
 */
export function writeProjectFile(ctx, name, body) {
  const file = join(shadow(ctx).root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/**
 * The project's root, where the change sets' files live.
 *
 * @param {Ctx} ctx The journey
 * @returns {string} The folder
 */
export function projectRoot(ctx) {
  return shadow(ctx).root;
}
