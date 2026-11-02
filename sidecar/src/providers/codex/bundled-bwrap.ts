import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { PLATFORM_LINUX } from "../../constants/native-binary.js";
import { chatGptConfigDir } from "./chatgpt/store.js";

const BUNDLED_BWRAP_PATH = ["..", "codex-resources", "bwrap"];
const COPY_DIRECTORY_NAME = "codex-bwrap";
const BWRAP_FILE_NAME = "bwrap";
const PROBE_TIMEOUT_MS = 2000;

const USER_NAMESPACE_PROBE = [
  "--unshare-user",
  "--unshare-net",
  "--ro-bind",
  "/",
  "/",
  "/bin/true",
];

const copies = new Map<string, string | undefined>();

function copyIfUsable(bundled: string): string | undefined {
  if (!existsSync(bundled)) return undefined;
  const directory = path.join(chatGptConfigDir(), COPY_DIRECTORY_NAME);
  const copy = path.join(directory, BWRAP_FILE_NAME);
  const staged = `${copy}.${process.pid}`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  copyFileSync(bundled, staged);
  renameSync(staged, copy);
  const probe = spawnSync(copy, USER_NAMESPACE_PROBE, {
    stdio: "ignore",
    timeout: PROBE_TIMEOUT_MS,
  });
  return probe.status === 0 ? directory : undefined;
}

/**
 * A directory to put first on the app-server's PATH, holding a copy of the
 * bubblewrap shipped beside the Codex binary at `binaryPath` in the user's
 * dms-ai config directory; undefined off Linux, without one, or when the copy
 * cannot create a user namespace here, so Codex keeps the host's own.
 *
 * Codex 0.154 prefers a `bwrap` on PATH over its bundled one, skipping any
 * under the command's directory, and masks every unreadable file through one
 * `/dev/null` descriptor that a stock bubblewrap closes after the first mask.
 * Fixed in Codex 0.162: https://github.com/openai/codex/pull/50059
 */
export function bundledBwrapDirectory(binaryPath: string): string | undefined {
  if (process.platform !== PLATFORM_LINUX) return undefined;
  if (!copies.has(binaryPath)) {
    const bundled = path.resolve(
      path.dirname(binaryPath),
      ...BUNDLED_BWRAP_PATH,
    );
    copies.set(binaryPath, copyIfUsable(bundled));
  }
  return copies.get(binaryPath);
}
