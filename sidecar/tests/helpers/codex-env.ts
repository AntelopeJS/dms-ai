import { readFile } from "node:fs/promises";
import { z } from "zod";

const ENVIRONMENT = z.record(z.string(), z.string());

export async function readCodexEnvDump(
  file: string,
): Promise<Record<string, string>> {
  return ENVIRONMENT.parse(JSON.parse(await readFile(file, "utf8")));
}
