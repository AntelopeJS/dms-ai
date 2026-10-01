import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import {
  codexHomeFor,
  reapOrphanCodexProcesses,
} from "../../src/providers/codex/process.js";
import {
  type CodexProviderOptions,
  createCodexProvider,
} from "../../src/providers/codex/provider.js";
import { isRunning } from "../helpers/processes.js";
import {
  CODEX_FIXTURE,
  codexFailOn,
  codexOnSigterm,
} from "../helpers/provider-fixtures.js";
import {
  readPidRecords,
  readRecordedPids,
  writePidRegistry,
} from "../helpers/codex-pids.js";

const TEST_TIMEOUT_MS = 30_000;
// One process per conversation, capped: opening past the cap disposes the
// oldest rather than piling up model connections.
const LIVE_SESSION_CAP = 4;
const SETTLE_MS = 400;
const STRAY_HOME = "conv-life-stray";
const REFUSED_PID_PATTERN = /\(pid (\d+)\)/;

function refusedPid(error: unknown): number {
  const match = REFUSED_PID_PATTERN.exec(String(error));
  if (match?.[1] === undefined) throw new Error(`no pid in ${String(error)}`);
  return Number(match[1]);
}

async function settle(): Promise<void> {
  await new Promise((done) => setTimeout(done, SETTLE_MS));
}

function killIfRunning(pid: number): void {
  if (isRunning(pid)) process.kill(pid, "SIGKILL");
}

function isAlive(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}

describe("codex process lifecycle", () => {
  let dir: string;
  let stateDir: string;
  let registry: McpHttpRegistry | undefined;
  const opened: ProviderSession[] = [];
  const teardowns: Promise<void>[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-life-"));
    stateDir = join(dir, ".state");
    CODEX_FIXTURE.use("plain");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(opened.splice(0).map((session) => session.dispose()));
    await Promise.all(teardowns.splice(0));
    await registry?.dispose();
    registry = undefined;
    CODEX_FIXTURE.reset();
    await rm(dir, { recursive: true, force: true });
  });

  function buildProvider() {
    registry = createMcpHttpRegistry();
    const options: CodexProviderOptions = {
      settings: DEFAULT_SETTINGS,
      stateDir,
      mcpHttpRegistry: registry,
      createMcpDeps: (conversationId) =>
        ({ conversationId }) as unknown as AiMcpServerDeps,
      getMcpUrl: () => "http://127.0.0.1:1/mcp",
      getApiKey: () => "sk-mock",
    };
    return createCodexProvider(options);
  }

  async function open(
    provider: ReturnType<typeof buildProvider>,
    conversationId: string,
  ): Promise<ProviderSession> {
    const session = await provider.createSession({
      conversationId,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
      settings: DEFAULT_SETTINGS,
      onDisposed: (disposal) => teardowns.push(disposal),
    });
    opened.push(session);
    return session;
  }

  async function runTurn(
    runner: AgentRunner,
    conversationId: string,
  ): Promise<void> {
    for await (const _ of runner.start("hello", {
      conversationId,
      hostProjectRoot: dir,
      getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    })) {
      // Draining is what opens the session and runs its turn.
    }
  }

  function readPids(): Promise<number[]> {
    return readRecordedPids(stateDir);
  }

  it(
    "kills the app-server and drops its home when a conversation is disposed",
    async () => {
      const session = await open(buildProvider(), "conv-life-1");
      const [pid] = await readPids();
      expect(pid).toBeDefined();
      expect(isAlive(pid as number)).toBe(true);

      await session.dispose();
      expect(await readPids()).toEqual([]);
      expect(isAlive(pid as number)).toBe(false);
      expect(existsSync(join(stateDir, "codex-home", "conv-life-1"))).toBe(
        false,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "leaves nothing running once every session is disposed",
    async () => {
      const provider = buildProvider();
      await open(provider, "conv-life-a");
      await open(provider, "conv-life-b");
      const pids = await readPids();
      expect(pids).toHaveLength(2);

      await Promise.all(opened.splice(0).map((session) => session.dispose()));
      expect(await readPids()).toEqual([]);
      for (const pid of pids) expect(isAlive(pid)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  async function leaveOrphan(conversationId: string): Promise<number> {
    const session = await open(buildProvider(), conversationId);
    const [pid] = await readPids();
    opened.splice(opened.indexOf(session), 1);
    if (pid === undefined) throw new Error("no pid recorded");
    return pid;
  }

  async function leaveStrayHome(): Promise<string> {
    const home = codexHomeFor(stateDir, STRAY_HOME);
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "auth.json"), "{}");
    return home;
  }

  it(
    "reaps a process a previous sidecar left behind, and every home left on disk",
    async () => {
      const pid = await leaveOrphan("conv-life-orphan");
      const home = codexHomeFor(stateDir, "conv-life-orphan");
      const stray = await leaveStrayHome();
      expect(isAlive(pid)).toBe(true);
      expect(existsSync(home)).toBe(true);

      const reaped = await reapOrphanCodexProcesses(stateDir);
      await settle();
      expect(reaped).toContain(pid);
      expect(isAlive(pid)).toBe(false);
      expect(await readPids()).toEqual([]);
      expect(existsSync(home)).toBe(false);
      expect(existsSync(stray)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reaps an orphan recorded in the registry's former, pid-only format",
    async () => {
      const pid = await leaveOrphan("conv-life-legacy");
      await writePidRegistry(stateDir, [pid]);

      expect(await reapOrphanCodexProcesses(stateDir)).toEqual([pid]);
      await settle();
      expect(isAlive(pid)).toBe(false);
      expect(await readPids()).toEqual([]);
      expect(existsSync(codexHomeFor(stateDir, "conv-life-legacy"))).toBe(
        false,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps the home, and the record, of an orphan that outlives its termination",
    async () => {
      const pid = await leaveOrphan("conv-life-survivor");
      const home = codexHomeFor(stateDir, "conv-life-survivor");
      const stray = await leaveStrayHome();
      vi.spyOn(process, "kill").mockImplementation(() => true);
      try {
        await reapOrphanCodexProcesses(stateDir);
        expect(isAlive(pid)).toBe(true);
        expect(existsSync(home)).toBe(true);
        expect(existsSync(stray)).toBe(false);
        expect(await readPidRecords(stateDir)).toEqual([{ pid, home }]);
      } finally {
        vi.restoreAllMocks();
        killIfRunning(pid);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "releases the app-server, its home and its MCP binding when the session fails to start",
    async () => {
      codexFailOn("thread/start");
      const provider = buildProvider();
      const release = vi.spyOn(registry as McpHttpRegistry, "release");
      const failure = await open(provider, "conv-life-failed").catch(
        (error: unknown) => error,
      );
      const pid = refusedPid(failure);

      expect(isRunning(pid)).toBe(false);
      expect(existsSync(codexHomeFor(stateDir, "conv-life-failed"))).toBe(
        false,
      );
      expect(await readPids()).toEqual([]);
      expect(release).toHaveBeenLastCalledWith("conv-life-failed");
      expect(release).toHaveBeenCalledTimes(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "caps live conversations, disposing the oldest first",
    async () => {
      const provider = buildProvider();
      for (let i = 0; i < LIVE_SESSION_CAP; i++) {
        await open(provider, `conv-life-cap-${i}`);
      }
      expect(await readPids()).toHaveLength(LIVE_SESSION_CAP);

      await open(provider, "conv-life-cap-extra");
      await Promise.all(teardowns);
      expect(await readPids()).toHaveLength(LIVE_SESSION_CAP);
    },
    TEST_TIMEOUT_MS,
  );

  // The evicted app-server ignores SIGTERM, so it is still stopping when the
  // runner is disposed, and nothing holds its session any more. Whether it has
  // already been killed by then is left unasserted: that only depends on how
  // fast the last turn ran, and the runner's own tests pin the bookkeeping.
  it(
    "waits, on the runner's dispose, for an evicted app-server that is still stopping",
    async () => {
      CODEX_FIXTURE.use("simple");
      const runner = createAgentRunner(buildProvider(), {
        settings: DEFAULT_SETTINGS,
      });
      codexOnSigterm("ignore");
      await runTurn(runner, "conv-life-run-0");
      const [stubborn] = await readPids();
      codexOnSigterm("die");
      for (let i = 1; i <= LIVE_SESSION_CAP; i++) {
        await runTurn(runner, `conv-life-run-${i}`);
      }

      await runner.dispose();
      expect(isRunning(stubborn)).toBe(false);
      expect(await readPids()).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
