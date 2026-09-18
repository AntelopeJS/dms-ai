import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODEX_CLIENT_NAME } from "../../src/constants/codex.js";
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
      expect(seeded.length).toBeGreaterThan(0);

      const disabled = selectSkillsToDisable(listed.data, {
        extraRoots: [],
        allowLocalSkills: true,
      });
      expect(disabled.length).toBe(seeded.length);
    },
    SPAWN_TIMEOUT_MS,
  );
});
