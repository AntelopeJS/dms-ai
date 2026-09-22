import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProviderSession } from "../../src/agent/provider.js";
import { CODEX_PID_REGISTRY_FILE } from "../../src/constants/codex.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { reapOrphanCodexProcesses } from "../../src/providers/codex/process.js";
import {
  type CodexProviderOptions,
  createCodexProvider,
} from "../../src/providers/codex/provider.js";
import { CODEX_FIXTURE } from "../helpers/provider-fixtures.js";

const TEST_TIMEOUT_MS = 30_000;
const SETTLE_MS = 400;
// One process per conversation, capped: opening past the cap disposes the
// oldest rather than piling up model connections.
const LIVE_SESSION_CAP = 4;

function isAlive(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}

async function settle(): Promise<void> {
  await new Promise((done) => setTimeout(done, SETTLE_MS));
}

describe("codex process lifecycle", () => {
  let dir: string;
  let stateDir: string;
  let registry: McpHttpRegistry | undefined;
  const opened: ProviderSession[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dms-ai-life-"));
    stateDir = join(dir, ".state");
    CODEX_FIXTURE.use("plain");
  });

  afterEach(async () => {
    for (const session of opened.splice(0)) session.dispose();
    await registry?.dispose();
    registry = undefined;
    CODEX_FIXTURE.reset();
    await settle();
    await rm(dir, { recursive: true, force: true });
  });

  function buildProvider() {
    registry = createMcpHttpRegistry();
    const options: CodexProviderOptions = {
      settings: DEFAULT_SETTINGS,
      stateDir,
      mcpHttpRegistry: registry,
      createMcpDeps: () => ({}) as unknown as AiMcpServerDeps,
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
      onDisposed: () => {},
    });
    opened.push(session);
    return session;
  }

  async function readPids(): Promise<number[]> {
    try {
      const raw = await readFile(
        join(stateDir, CODEX_PID_REGISTRY_FILE),
        "utf8",
      );
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }

  it(
    "kills the app-server and drops its home when a conversation is disposed",
    async () => {
      const session = await open(buildProvider(), "conv-life-1");
      const [pid] = await readPids();
      expect(pid).toBeDefined();
      expect(isAlive(pid as number)).toBe(true);

      session.dispose();
      await settle();
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

      for (const session of opened.splice(0)) session.dispose();
      await settle();
      expect(await readPids()).toEqual([]);
      for (const pid of pids) expect(isAlive(pid)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reaps a process a previous sidecar left behind",
    async () => {
      const session = await open(buildProvider(), "conv-life-orphan");
      const [pid] = await readPids();
      // The session object is dropped without disposing, exactly as a SIGKILL
      // on the sidecar would leave it: the process stays, the registry too.
      opened.splice(opened.indexOf(session), 1);
      expect(isAlive(pid as number)).toBe(true);

      const reaped = await reapOrphanCodexProcesses(stateDir);
      await settle();
      expect(reaped).toContain(pid);
      expect(isAlive(pid as number)).toBe(false);
      expect(await readPids()).toEqual([]);
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
      await settle();
      expect(await readPids()).toHaveLength(LIVE_SESSION_CAP);
    },
    TEST_TIMEOUT_MS,
  );
});
