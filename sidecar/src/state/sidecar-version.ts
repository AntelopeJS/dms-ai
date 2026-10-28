import { readFile } from "node:fs/promises";
import { z } from "zod";
import { SIDECAR_PACKAGE_JSON } from "../constants/paths.js";

const PackageJsonSchema = z.object({ version: z.string().optional() });

const FALLBACK_VERSION = "0.0.0";

export async function readSidecarVersion(): Promise<string> {
  try {
    const raw = await readFile(SIDECAR_PACKAGE_JSON, "utf8");
    const parsed = PackageJsonSchema.parse(JSON.parse(raw));
    return parsed.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}
