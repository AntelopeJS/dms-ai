import { readFile } from "node:fs/promises";
import { SIDECAR_PACKAGE_JSON } from "../constants/paths.js";

const FALLBACK_VERSION = "0.0.0";

export async function readSidecarVersion(): Promise<string> {
  try {
    const raw = await readFile(SIDECAR_PACKAGE_JSON, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
