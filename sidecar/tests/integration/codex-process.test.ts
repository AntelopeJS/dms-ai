import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_CLIENT_NAME,
  CODEX_CONFIG_FILE_NAME,
  CODEX_OWNED_SKILL_SCOPES,
  CODEX_SPAWN_FAILED_MESSAGE,
} from "../../src/constants/codex.js";
import {
  type CodexProcess,
  spawnCodexProcess,
} from "../../src/providers/codex/process.js";
import type { v2 } from "../../src/providers/codex/protocol/index.js";
import {
  type CodexInstallation,
  isCodexInstallationUsable,
  resolveCodexInstallation,
} from "../../src/providers/codex/resolve-binary.js";
import { selectSkillsToDisable } from "../../src/providers/codex/skills.js";
import { isRunning } from "../helpers/processes.js";
import {
  CODEX_FIXTURE,
  type CodexSigtermBehaviour,
  codexOnSigterm,
} from "../helpers/provider-fixtures.js";
import { readRecordedPids } from "../helpers/codex-pids.js";

const installation = resolveCodexInstallation();
const TMP_PREFIX = "dms-ai-codex-";
const FAKE_API_KEY = "sk-not-a-real-key";
const MCP_URL = "http://127.0.0.1:1/mcp";
const FAKE_TOKEN = "0123456789abcdef";
const CONVERSATION = "conv-codex-proc";
const SPAWN_TIMEOUT_MS = 60_000;

// Never throws inside the suite: it is skipped when the extension is absent.
function requireInstallation(): CodexInstallation {
  if (installation === undefined)
    throw new Error("codex extension not installed");
  return installation;
}

interface InitializeResult {
  userAgent: string;
  codexHome: string;
}

interface SkillsListResult {
  data: v2.SkillsListEntry[];
}

describe.skipIf(installation === undefined)("codex app-server process", () => {
  let stateDir: string | undefined;
  let running: CodexProcess | undefined;

  afterEach(async () => {
    await running?.dispose();
    running = undefined;
    if (stateDir !== undefined)
      await rm(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  });

  it("ships a binary whose version matches the generated types", () => {
    expect(isCodexInstallationUsable(requireInstallation())).toBe(true);
  });

  it(
    "starts, handshakes, and tears its isolated home down",
    async () => {
      stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      running = await spawnCodexProcess({
        conversationId: CONVERSATION,
        stateDir,
        installation: requireInstallation(),
        mcpUrl: MCP_URL,
        mcpToken: FAKE_TOKEN,
        hostProjectRoot: stateDir,
        apiKey: FAKE_API_KEY,
        handlers: {
          onNotification: () => {},
          onServerRequest: async () => ({}),
        },
      });

      // A --strict-config spawn fails outright on an unknown config key, so
      // reaching a handshake also proves the generated config.toml is valid.
      const initialized = await running.client.request<InitializeResult>(
        "initialize",
        {
          clientInfo: {
            name: CODEX_CLIENT_NAME,
            title: "dms-ai",
            version: "0.0.1",
          },
          capabilities: null,
        },
      );
      expect(initialized.userAgent).toContain(CODEX_CLIENT_NAME);
      expect(initialized.codexHome).toBe(running.codexHome);

      running.client.notify("initialized", {});
      const home = running.codexHome;
      expect(existsSync(home)).toBe(true);

      await running.dispose();
      running = undefined;
      expect(existsSync(home)).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "seeds system skills into a fresh home, and we switch them off",
    async () => {
      stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      running = await spawnCodexProcess({
        conversationId: CONVERSATION,
        stateDir,
        installation: requireInstallation(),
        mcpUrl: MCP_URL,
        mcpToken: FAKE_TOKEN,
        hostProjectRoot: stateDir,
        apiKey: FAKE_API_KEY,
        handlers: {
          onNotification: () => {},
          onServerRequest: async () => ({}),
        },
      });
      await running.client.request("initialize", {
        clientInfo: {
          name: CODEX_CLIENT_NAME,
          title: "dms-ai",
          version: "0.0.1",
        },
        capabilities: null,
      });
      running.client.notify("initialized", {});

      const listed = await running.client.request<SkillsListResult>(
        "skills/list",
        {},
      );
      const seeded = listed.data.flatMap((entry) => entry.skills);
      const owned = seeded.filter((skill) =>
        CODEX_OWNED_SKILL_SCOPES.includes(skill.scope),
      );
      expect(owned.length).toBeGreaterThan(0);

      // Scoped rather than counted: Codex also indexes the developer's own
      // skills, which `allowLocalSkills` is entitled to keep, and asserting on
      // the total made the suite depend on what happens to sit in ~/.agents.
      const disabled = selectSkillsToDisable(listed.data, {
        extraRoots: [],
        allowLocalSkills: true,
      });
      expect(new Set(disabled.map((entry) => entry.path))).toEqual(
        new Set(owned.map((skill) => skill.path)),
      );

      const withoutLocals = selectSkillsToDisable(listed.data, {
        extraRoots: [],
        allowLocalSkills: false,
      });
      expect(withoutLocals.length).toBe(seeded.length);
    },
    SPAWN_TIMEOUT_MS,
  );
});

// Not gated on the extension: the point is a binary that is *not* there.
describe("codex app-server spawn failure", () => {
  const MISSING_BINARY = "/nonexistent/codex";
  const REQUEST_BUDGET_MS = 5_000;

  it(
    "turns an unspawnable binary into a failed request, not a dead sidecar",
    async () => {
      const stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      const uncaught: Error[] = [];
      const onUncaught = (err: Error): void => {
        uncaught.push(err);
      };
      process.on("uncaughtException", onUncaught);
      try {
        const spawned = await spawnCodexProcess({
          conversationId: CONVERSATION,
          stateDir,
          installation: {
            binaryPath: MISSING_BINARY,
            launchArgs: [],
            pinnedVersion: "0.0.0",
          },
          mcpUrl: MCP_URL,
          mcpToken: FAKE_TOKEN,
          hostProjectRoot: stateDir,
          apiKey: FAKE_API_KEY,
          handlers: {
            onNotification: () => {},
            onServerRequest: async () => ({}),
          },
        });
        await expect(
          spawned.client.request(
            "initialize",
            {},
            {
              timeoutMs: REQUEST_BUDGET_MS,
            },
          ),
        ).rejects.toThrow(CODEX_SPAWN_FAILED_MESSAGE);
        await spawned.dispose();
        expect(uncaught).toEqual([]);
      } finally {
        process.off("uncaughtException", onUncaught);
        await rm(stateDir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

interface SigtermCase {
  behaviour: CodexSigtermBehaviour;
  story: string;
}

const SIGTERM_CASES: SigtermCase[] = [
  { behaviour: "linger", story: "keeps writing into its home after SIGTERM" },
  { behaviour: "ignore", story: "ignores SIGTERM until it is killed" },
];

// Not gated on the extension: the mock stands in for an app-server that is
// still writing into its home when it is told to stop, which the real one does
// too briefly to be caught on purpose.
describe("codex app-server teardown", () => {
  const HANDSHAKE_BUDGET_MS = 10_000;
  let stateDir: string | undefined;
  let running: CodexProcess | undefined;

  afterEach(async () => {
    await running?.dispose();
    running = undefined;
    CODEX_FIXTURE.reset();
    if (stateDir !== undefined)
      await rm(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  });

  async function spawnMock(dir: string): Promise<CodexProcess> {
    const mock = resolveCodexInstallation();
    if (mock === undefined) throw new Error("the mock binary did not resolve");
    const spawned = await spawnCodexProcess({
      conversationId: CONVERSATION,
      stateDir: dir,
      installation: mock,
      mcpUrl: MCP_URL,
      mcpToken: FAKE_TOKEN,
      hostProjectRoot: dir,
      apiKey: FAKE_API_KEY,
      handlers: {
        onNotification: () => {},
        onServerRequest: async () => ({}),
      },
    });
    // Answered only once the mock runs, so its SIGTERM handler is in place.
    await spawned.client.request(
      "initialize",
      {},
      { timeoutMs: HANDSHAKE_BUDGET_MS },
    );
    return spawned;
  }

  it.each(SIGTERM_CASES)(
    "resolves dispose only once an app-server that $story is gone, then removes its home",
    async ({ behaviour }) => {
      CODEX_FIXTURE.use("simple");
      codexOnSigterm(behaviour);
      stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      running = await spawnMock(stateDir);
      const { pid, codexHome } = running;
      expect(isRunning(pid)).toBe(true);

      await running.dispose();
      expect(isRunning(pid)).toBe(false);
      expect(existsSync(codexHome)).toBe(false);
      expect(await readRecordedPids(stateDir)).toEqual([]);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "hands every caller the same teardown",
    async () => {
      CODEX_FIXTURE.use("simple");
      codexOnSigterm("linger");
      stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      running = await spawnMock(stateDir);
      const { pid } = running;

      const first = running.dispose();
      await running.dispose();
      expect(isRunning(pid)).toBe(false);
      await first;
    },
    SPAWN_TIMEOUT_MS,
  );

  // Same conversation, same home path: the previous teardown, still waiting for
  // its process, must not remove the home the reopened one was just given.
  it(
    "prepares a reopened conversation's home only once the previous app-server let go of it",
    async () => {
      CODEX_FIXTURE.use("simple");
      codexOnSigterm("ignore");
      stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      const previous = await spawnMock(stateDir);
      const released = previous.dispose();
      codexOnSigterm("die");
      running = await spawnMock(stateDir);
      await released;

      expect(running.codexHome).toBe(previous.codexHome);
      expect(existsSync(join(running.codexHome, CODEX_CONFIG_FILE_NAME))).toBe(
        true,
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
