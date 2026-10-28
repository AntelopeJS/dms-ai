import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CODEX_PID_REGISTRY_FILE } from "../../src/constants/codex.js";

const RECORDED_PID = z.object({ pid: z.number(), home: z.string() });

/** One entry of the pid registry, as the sidecar writes it. */
export type RecordedPid = z.infer<typeof RECORDED_PID>;

const RECORDED_PIDS = z.array(RECORDED_PID);

/** Every entry of the registry, an absent or unreadable one being empty. */
export async function readPidRecords(stateDir: string): Promise<RecordedPid[]> {
  try {
    const raw = await readFile(join(stateDir, CODEX_PID_REGISTRY_FILE), "utf8");
    const parsed = RECORDED_PIDS.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** The pids the registry holds. */
export async function readRecordedPids(stateDir: string): Promise<number[]> {
  const records = await readPidRecords(stateDir);
  return records.map((record) => record.pid);
}

/** The first pid the registry holds, failing when it holds none. */
export async function readFirstPid(stateDir: string): Promise<number> {
  const [pid] = await readRecordedPids(stateDir);
  if (pid === undefined) throw new Error("no pid recorded");
  return pid;
}
