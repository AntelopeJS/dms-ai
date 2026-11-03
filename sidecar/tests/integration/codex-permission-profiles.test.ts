import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_CLIENT_CAPABILITIES,
  CODEX_CLIENT_NAME,
} from "../../src/constants/codex.js";
import { CODEX_READ_ONLY_PROFILE } from "../../src/providers/codex/permission-profiles.js";
import {
  type CodexProcess,
  spawnCodexProcess,
} from "../../src/providers/codex/process.js";
import { resolveCodexInstallation } from "../../src/providers/codex/resolve-binary.js";

const installation = resolveCodexInstallation();
const SPAWN_TIMEOUT_MS = 60_000;

interface ThreadStarted {
  activePermissionProfile: { id: string } | null;
}

describe.skipIf(installation === undefined)(
  "permission profile on the pinned Codex",
  () => {
    let stateDir: string | undefined;
    let running: CodexProcess | undefined;

    afterEach(async () => {
      await running?.dispose();
      running = undefined;
      if (stateDir !== undefined)
        await rm(stateDir, { recursive: true, force: true });
      stateDir = undefined;
    });

    it(
      "accepts the config and starts a thread under the read-only profile, named or not",
      async () => {
        stateDir = await mkdtemp(join(tmpdir(), "dms-ai-codex-profiles-"));
        const project = join(stateDir, "project");
        const moduleRoot = join(stateDir, "module");
        mkdirSync(join(project, ".husky"), { recursive: true });
        mkdirSync(moduleRoot);
        writeFileSync(join(project, "package.json"), "{}\n");
        writeFileSync(join(project, ".env"), "DB_URL=secret\n");
        writeFileSync(join(moduleRoot, "package.json"), "{}\n");
        if (installation === undefined) throw new Error("skipped above");
        running = await spawnCodexProcess({
          conversationId: "conv-profiles",
          stateDir,
          installation,
          mcpUrl: "http://127.0.0.1:1/mcp",
          mcpToken: "0123456789abcdef",
          hostProjectRoot: project,
          moduleRoots: [moduleRoot],
          accessTokenUrl: "http://127.0.0.1:1/codex/access-token",
          handlers: {
            onNotification: () => {},
            onServerRequest: async () => ({}),
          },
        });
        const client = running.client;
        await client.request("initialize", {
          clientInfo: {
            name: CODEX_CLIENT_NAME,
            title: "dms-ai",
            version: "0",
          },
          capabilities: CODEX_CLIENT_CAPABILITIES,
        });
        client.notify("initialized", {});

        const inProject = { cwd: project, ephemeral: true };
        const started = [
          await client.request<ThreadStarted>("thread/start", inProject),
          await client.request<ThreadStarted>("thread/start", {
            ...inProject,
            permissions: CODEX_READ_ONLY_PROFILE,
          }),
        ];

        expect(
          started.map((thread) => thread.activePermissionProfile?.id),
        ).toEqual([CODEX_READ_ONLY_PROFILE, CODEX_READ_ONLY_PROFILE]);
      },
      SPAWN_TIMEOUT_MS,
    );
  },
);
