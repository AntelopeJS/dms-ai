import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  SIDECAR_BUILD_ID_HASH_ALGORITHM,
  SIDECAR_DIST_EXTENSION,
} from "../constants/sidecar";

function listBuildFiles(distDir: string): string[] {
  const entries = readdirSync(distDir, { recursive: true }) as string[];
  return entries
    .filter((entry) => entry.endsWith(SIDECAR_DIST_EXTENSION))
    .map((entry) => entry.split(path.sep).join(path.posix.sep))
    .sort();
}

/**
 * Identifies a sidecar build by the content of its compiled files, so a
 * rebuild that emits the same code keeps the same id whatever its mtimes.
 *
 * @param distDir - Directory holding the compiled sidecar.
 * @returns A hex digest of the sorted relative paths and their bytes, or an
 * empty string when the directory cannot be read.
 */
export function computeBuildId(distDir: string): string {
  try {
    const hash = createHash(SIDECAR_BUILD_ID_HASH_ALGORITHM);
    for (const relativePath of listBuildFiles(distDir)) {
      const content = readFileSync(path.join(distDir, relativePath));
      hash.update(`${relativePath}\0${content.length}\0`);
      hash.update(content);
    }
    return hash.digest("hex");
  } catch {
    return "";
  }
}
