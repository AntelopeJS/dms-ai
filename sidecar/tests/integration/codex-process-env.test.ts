import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_HOME_ENV_VAR,
  CODEX_MCP_TOKEN_ENV_VAR,
} from "../../src/constants/codex.js";
import {
  type CodexProcess,
  spawnCodexProcess,
} from "../../src/providers/codex/process.js";
import { resolveCodexInstallation } from "../../src/providers/codex/resolve-binary.js";
import { readCodexEnvDump } from "../helpers/codex-env.js";
import { TEST_STOP_GRACES } from "../helpers/processes.js";
import {
  CODEX_FIXTURE,
  codexDumpEnvInto,
} from "../helpers/provider-fixtures.js";

const TMP_PREFIX = "dms-ai-codex-env-";
const CONVERSATION = "conv-codex-env";
const MCP_TOKEN = "0123456789abcdef";
const SECRET_NAME = "BUILDER_DB_SHOP_URL";
const KEPT_NAME = "DMS_AI_TEST_UNRELATED";
const REQUEST_BUDGET_MS = 10_000;
const TEST_TIMEOUT_MS = 30_000;

describe.skipIf(process.platform === "win32")(
  "the environment of the codex app-server",
  () => {
    let dir: string;
    let running: CodexProcess | undefined;
    const saved = new Map<string, string | undefined>();

    function setProcessEnv(name: string, value: string): void {
      if (!saved.has(name)) saved.set(name, process.env[name]);
      process.env[name] = value;
    }

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      await writeFile(
        join(dir, ".env"),
        `${SECRET_NAME}=postgres://shop:canary-password-7f3a@db.example/shop\n`,
      );
      CODEX_FIXTURE.use("simple");
      setProcessEnv(SECRET_NAME, "postgres://shop:canary-password-7f3a@db");
      setProcessEnv(KEPT_NAME, "kept");
    });

    afterEach(async () => {
      await running?.dispose();
      running = undefined;
      CODEX_FIXTURE.reset();
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      saved.clear();
      await rm(dir, { recursive: true, force: true });
    });

    async function childEnvironment(): Promise<Record<string, string>> {
      const installation = resolveCodexInstallation();
      if (installation === undefined) throw new Error("no mock binary");
      const envFile = join(dir, "child-env.json");
      codexDumpEnvInto(envFile);
      running = await spawnCodexProcess({
        conversationId: CONVERSATION,
        stateDir: dir,
        installation,
        mcpUrl: "http://127.0.0.1:1/mcp",
        mcpToken: MCP_TOKEN,
        hostProjectRoot: dir,
        moduleRoots: [],
        accessTokenUrl: "http://127.0.0.1:1/codex/access-token",
        handlers: {
          onNotification: () => {},
          onServerRequest: async () => ({}),
        },
        stopGraces: TEST_STOP_GRACES,
      });
      await running.client.request(
        "initialize",
        {},
        { timeoutMs: REQUEST_BUDGET_MS },
      );
      return readCodexEnvDump(envFile);
    }

    it(
      "leaves out what the project's .env assigns and passes the rest",
      async () => {
        const env = await childEnvironment();
        expect(env[SECRET_NAME]).toBeUndefined();
        expect(env[KEPT_NAME]).toBe("kept");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "still hands the app-server its home and the MCP token",
      async () => {
        const env = await childEnvironment();
        expect(env[CODEX_HOME_ENV_VAR]).toBe(running?.codexHome);
        expect(env[CODEX_MCP_TOKEN_ENV_VAR]).toBe(MCP_TOKEN);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
