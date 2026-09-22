import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  PROCESS_QUERY_BY_PLATFORM,
  WINDOWS_TREE_KILL,
} from "../../src/constants/codex.js";
import {
  isCodexProcess,
  readProcessCommand,
} from "../../src/providers/codex/process.js";

const PROCFS_PLATFORMS = ["linux"];
const SUPPORTED_PLATFORMS = ["linux", "darwin", "win32"];

// A pid recorded by a previous sidecar is only worth a signal if it is still a
// codex process, and answering that question is what makes orphan reaping work
// at all. Reading /proc answers it on Linux only, so the other hosts have to be
// covered too — an unreapable orphan holds a model connection and writes to
// disk.
describe("process identification", () => {
  it("covers every platform the codex binary ships for", () => {
    const covered = [
      ...PROCFS_PLATFORMS,
      ...Object.keys(PROCESS_QUERY_BY_PLATFORM),
    ];
    expect(new Set(covered)).toEqual(new Set(SUPPORTED_PLATFORMS));
  });

  it("reads the command line of a live process on this host", () => {
    expect(readProcessCommand(process.pid)).toBeDefined();
  });

  it("does not mistake this process for a codex one", () => {
    expect(isCodexProcess(process.pid)).toBe(false);
  });

  it("answers for a pid that has exited instead of throwing", () => {
    const dead = spawnAndReap();
    expect(isCodexProcess(dead)).toBe(false);
  });

  it("kills the whole tree on Windows, where a parent's death spares it", () => {
    expect(WINDOWS_TREE_KILL).toContain("/T");
  });
});

const EXIT_COMMAND_BY_PLATFORM: Record<string, readonly string[]> = {
  win32: ["cmd", "/c", "exit"],
};
const EXIT_COMMAND = ["node", "-e", ""] as const;

// A pid that certainly belonged to a process and certainly does not any more.
function spawnAndReap(): number {
  const [command, ...args] =
    EXIT_COMMAND_BY_PLATFORM[process.platform] ?? EXIT_COMMAND;
  const { pid } = spawnSync(command, args, {
    windowsHide: true,
    stdio: "ignore",
  });
  if (pid === undefined) throw new Error("could not spawn a throwaway process");
  return pid;
}
