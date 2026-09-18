import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PermissionBus,
  PermissionRequest,
} from "../../src/agent/permission-bus.js";
import type { ProviderSession } from "../../src/agent/provider.js";
import type { RunnerEvent } from "../../src/agent/runner-events.js";
import { CODEX_PID_REGISTRY_FILE } from "../../src/constants/codex.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import {
  PERMISSION_DECISIONS,
  type PermissionDecision,
} from "../../src/constants/permissions.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import {
  createMcpHttpRegistry,
  type McpHttpRegistry,
} from "../../src/mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../src/mcp/types.js";
import { createCodexProvider } from "../../src/providers/codex/provider.js";
import { resolveCodexInstallation } from "../../src/providers/codex/resolve-binary.js";
import { createHttpServer } from "../../src/server/http.js";
import { createNavigationCompleter } from "../../src/server/navigation-completer.js";
import type { AppSettings } from "../../src/state/settings-types.js";

// Real model turns cost money, so this suite is opt-in.
const ENABLED =
  process.env.CODEX_ACCEPTANCE === "1" &&
  process.env.OPENAI_API_KEY !== undefined &&
  resolveCodexInstallation() !== undefined;

const TMP_PREFIX = "dms-ai-acceptance-";
const CONVERSATION = "conv-acceptance";
const TURN_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 240_000;
const INTERRUPT_BUDGET_MS = 5_000;
const DISPOSE_BUDGET_MS = 15_000;
const POLL_INTERVAL_MS = 200;

function buildMcpDeps(conversationId: string): AiMcpServerDeps {
  return {
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    registry: {
      getRegistry: async () => [],
      getStaleSinceMs: () => null,
      invalidate: () => {},
    },
    scanner: {
      scan: async () => ({ importersByFile: new Map() }),
      invalidate: () => {},
    },
    hostProjectRoot: "/tmp",
    moduleRoots: [],
    logsClient: { getLogs: async () => [] },
    builderClient: { call: async () => undefined },
    builderEnabled: false,
    sendToHost: () => {},
    navigationCompleter: createNavigationCompleter(),
    conversationId,
    requestQuestion: async () => null,
    getLastEditedFile: () => undefined,
  };
}

interface Harness {
  root: string;
  stateDir: string;
  server: Server;
  registry: McpHttpRegistry;
  port: number;
  prompted: PermissionRequest[];
  bus: PermissionBus;
  dispose: () => Promise<void>;
}

async function startHarness(answer: PermissionDecision): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  const registry = createMcpHttpRegistry();
  const { server, port } = await createHttpServer({
    clientToken: "integration-test-credential",
    chatboxDistDir: root,
    port: 0,
    mcpHttpRegistry: registry,
  });
  const prompted: PermissionRequest[] = [];
  const bus = {
    requestPermission: async (req: PermissionRequest) => {
      prompted.push(req);
      return answer;
    },
  } as unknown as PermissionBus;
  return {
    root,
    stateDir: join(root, ".state"),
    server,
    registry,
    port,
    prompted,
    bus,
    dispose: async () => {
      await registry.dispose();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

function settingsFor(overrides: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    thinking: "off",
    generationMode: "vibe",
    ...overrides,
  };
}

async function openSession(
  harness: Harness,
  settings: AppSettings,
): Promise<ProviderSession> {
  const provider = createCodexProvider({
    timeoutMs: TURN_TIMEOUT_MS,
    moduleRoots: [],
    skillDirs: [],
    stateDir: harness.stateDir,
    mcpHttpRegistry: harness.registry,
    createMcpDeps: buildMcpDeps,
    getMcpUrl: () => `http://127.0.0.1:${harness.port}/mcp`,
    getApiKey: () => process.env.OPENAI_API_KEY,
  });
  return provider.createSession({
    conversationId: CONVERSATION,
    hostProjectRoot: harness.root,
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
    settings,
    permissionBus: harness.bus,
    onDisposed: () => {},
  });
}

async function collect(
  session: ProviderSession,
  text: string,
  settings: AppSettings,
): Promise<RunnerEvent[]> {
  const events: RunnerEvent[] = [];
  for await (const event of session.runTurn(
    { text, attachments: [] },
    settings,
  )) {
    events.push(event);
  }
  return events;
}

async function readPidRegistry(stateDir: string): Promise<number[]> {
  try {
    const raw = await readFile(join(stateDir, CODEX_PID_REGISTRY_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

function isProcessAlive(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + DISPOSE_BUDGET_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("condition not met before the dispose budget elapsed");
}

function unpaired(events: RunnerEvent[]): string[] {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "tool_use") open.add(event.callId);
    if (event.type === "tool_result") open.delete(event.callId);
  }
  return [...open];
}

describe.skipIf(!ENABLED)("Codex acceptance", () => {
  let harness: Harness | undefined;
  let session: ProviderSession | undefined;

  afterEach(async () => {
    session?.dispose();
    session = undefined;
    await harness?.dispose();
    harness = undefined;
  });

  it(
    "1 — a simple message streams deltas and ends with a final text",
    async () => {
      harness = await startHarness(PERMISSION_DECISIONS.ALLOW_ONCE);
      const settings = settingsFor({});
      session = await openSession(harness, settings);
      const events = await collect(session, "Reply with just: ready", settings);
      expect(events.some((e) => e.type === "assistant_text_delta")).toBe(true);
      expect(events.some((e) => e.type === "assistant_text")).toBe(true);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(unpaired(events)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "3 — a write escalates, the denial reaches the agent, the turn still ends",
    async () => {
      harness = await startHarness(PERMISSION_DECISIONS.DENY);
      const settings = settingsFor({});
      session = await openSession(harness, settings);
      const events = await collect(
        session,
        "Create a file named note.txt containing the word alpha.",
        settings,
      );
      expect(harness.prompted.length).toBeGreaterThan(0);
      expect(["Bash", "Edit"]).toContain(harness.prompted[0]?.toolName);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(unpaired(events)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "5 — safe mode refuses raw writes without ever prompting the user",
    async () => {
      harness = await startHarness(PERMISSION_DECISIONS.ALLOW_ONCE);
      const settings = settingsFor({ generationMode: "safe" });
      session = await openSession(harness, settings);
      const events = await collect(
        session,
        "Create a file named unsafe.txt containing the word beta.",
        settings,
      );
      expect(harness.prompted).toEqual([]);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(unpaired(events)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "8 — a stop mid-turn interrupts within budget, leaving nothing orphaned",
    async () => {
      harness = await startHarness(PERMISSION_DECISIONS.ALLOW_ONCE);
      const settings = settingsFor({});
      session = await openSession(harness, settings);
      const events: RunnerEvent[] = [];
      let interruptedAt = 0;
      const stream = session.runTurn(
        {
          text: "Count from 1 to 200, one number per line, with a short comment on each.",
          attachments: [],
        },
        settings,
      );
      for await (const event of stream) {
        events.push(event);
        if (interruptedAt === 0 && event.type === "assistant_text_delta") {
          interruptedAt = Date.now();
          session.interrupt();
        }
      }
      const stoppedAfterMs = Date.now() - interruptedAt;
      expect(interruptedAt).toBeGreaterThan(0);
      expect(events.at(-1)?.type).toBe("done");
      expect(unpaired(events)).toEqual([]);
      expect(stoppedAfterMs).toBeLessThan(INTERRUPT_BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "9 — a settings change mid-conversation applies on the next turn",
    async () => {
      harness = await startHarness(PERMISSION_DECISIONS.ALLOW_ONCE);
      const vibe = settingsFor({});
      session = await openSession(harness, vibe);
      await collect(session, "Reply with just: one", vibe);

      // Safe mode now declines escalations; the same request must no longer
      // reach the user as a prompt.
      const safe = settingsFor({ generationMode: "safe" });
      session.applySettings?.(safe);
      const events = await collect(
        session,
        "Create a file named later.txt containing the word gamma.",
        safe,
      );
      expect(harness.prompted).toEqual([]);
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(unpaired(events)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "12 — disposing a conversation leaves no app-server process behind",
    async () => {
      harness = await startHarness(PERMISSION_DECISIONS.ALLOW_ONCE);
      const settings = settingsFor({});
      const opened = await openSession(harness, settings);
      const before = await readPidRegistry(harness.stateDir);
      expect(before.length).toBe(1);

      opened.dispose();
      await waitFor(async () => {
        const after = await readPidRegistry(harness?.stateDir ?? "");
        return after.length === 0;
      });
      for (const pid of before) {
        expect(isProcessAlive(pid)).toBe(false);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
