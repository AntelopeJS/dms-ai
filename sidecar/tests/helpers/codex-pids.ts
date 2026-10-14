import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CODEX_PID_REGISTRY_FILE } from "../../src/constants/codex.js";

/** One entry of the pid registry, as the sidecar writes it. */
export interface RecordedPid {
  pid: number;
  home: string;
}

/** Every entry of the registry, an absent or unreadable one being empty. */
export async function readPidRecords(stateDir: string): Promise<RecordedPid[]> {
  try {
    const raw = await readFile(join(stateDir, CODEX_PID_REGISTRY_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecordedPid[]) : [];
  } catch {
    return [];
  }
}

/** The pids the registry holds. */
export async function readRecordedPids(stateDir: string): Promise<number[]> {
  const records = await readPidRecords(stateDir);
  return records.map((record) => record.pid);
}
