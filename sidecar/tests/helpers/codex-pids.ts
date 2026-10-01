import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_PID_REGISTRY_FILE } from "../../src/constants/codex.js";

/** One entry of the pid registry, as the sidecar writes it. */
export interface RecordedPid {
  pid: number;
  home?: string;
}

function toRecordedPid(entry: unknown): RecordedPid {
  return typeof entry === "number" ? { pid: entry } : (entry as RecordedPid);
}

/** Every entry of the registry, an absent or unreadable one being empty. */
export async function readPidRecords(stateDir: string): Promise<RecordedPid[]> {
  try {
    const raw = await readFile(join(stateDir, CODEX_PID_REGISTRY_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(toRecordedPid) : [];
  } catch {
    return [];
  }
}

/** The pids the registry holds, whatever format it was written in. */
export async function readRecordedPids(stateDir: string): Promise<number[]> {
  const records = await readPidRecords(stateDir);
  return records.map((record) => record.pid);
}

/** Overwrites the registry with raw entries, as a previous sidecar left it. */
export async function writePidRegistry(
  stateDir: string,
  entries: readonly unknown[],
): Promise<void> {
  await writeFile(
    join(stateDir, CODEX_PID_REGISTRY_FILE),
    JSON.stringify(entries),
  );
}
