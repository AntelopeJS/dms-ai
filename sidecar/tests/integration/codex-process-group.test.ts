import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type CodexProcess,
  reapOrphanCodexProcesses,
  spawnCodexProcess,
} from "../../src/providers/codex/process.js";
import { resolveCodexInstallation } from "../../src/providers/codex/resolve-binary.js";
import { isRunning } from "../helpers/processes.js";
import {
  CODEX_FIXTURE,
  codexScript,
  codexStartGrandchildInto,
} from "../helpers/provider-fixtures.js";

const TMP_PREFIX = "dms-ai-pgroup-";
const CONVERSATION = "conv-codex-pgroup";
const GRANDCHILD_PID_FILE = "grandchild.pid";
const REQUEST_BUDGET_MS = 10_000;
const POLL_MS = 25;
const GONE_BUDGET_MS = 2_000;
const TEST_TIMEOUT_MS = 30_000;

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function readGrandchildPid(pidFile: string): Promise<number> {
  const deadline = Date.now() + REQUEST_BUDGET_MS;
  while (Date.now() < deadline) {
    const raw = await readFile(pidFile, "utf8").catch(() => "");
    if (raw !== "") return Number(raw);
    await pause(POLL_MS);
  }
  throw new Error("the app-server started no grandchild");
}

async function isGoneWithin(pid: number): Promise<boolean> {
  const deadline = Date.now() + GONE_BUDGET_MS;
  while (isRunning(pid)) {
    if (Date.now() >= deadline) return false;
    await pause(POLL_MS);
  }
  return true;
}

function killIfRunning(pid: number | undefined): void {
  if (pid !== undefined && isRunning(pid)) process.kill(pid, "SIGKILL");
}

describe.skipIf(process.platform === "win32")(
  "codex app-server process group",
  () => {
    let stateDir: string | undefined;
    let running: CodexProcess | undefined;
    let grandchild: number | undefined;

    afterEach(async () => {
      await running?.dispose();
      running = undefined;
      killIfRunning(grandchild);
      grandchild = undefined;
      CODEX_FIXTURE.reset();
      if (stateDir !== undefined)
        await rm(stateDir, { recursive: true, force: true });
      stateDir = undefined;
    });

    async function spawnMock(dir: string): Promise<CodexProcess> {
      const mock = resolveCodexInstallation();
      if (mock === undefined)
        throw new Error("the mock binary did not resolve");
      return spawnCodexProcess({
        conversationId: CONVERSATION,
        stateDir: dir,
        installation: mock,
        mcpUrl: "http://127.0.0.1:1/mcp",
        mcpToken: "0123456789abcdef",
        hostProjectRoot: dir,
        apiKey: "sk-not-a-real-key",
        handlers: {
          onNotification: () => {},
          onServerRequest: async () => ({}),
        },
      });
    }

    async function startTurnLeavingGrandchild(): Promise<CodexProcess> {
      stateDir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
      const pidFile = join(stateDir, GRANDCHILD_PID_FILE);
      codexStartGrandchildInto(pidFile);
      const spawned = await spawnMock(stateDir);
      const budget = { timeoutMs: REQUEST_BUDGET_MS };
      await spawned.client.request("initialize", {}, budget);
      await spawned.client.request("turn/start", {}, budget);
      grandchild = await readGrandchildPid(pidFile);
      return spawned;
    }

    it(
      "takes down what a turn left running when the app-server is stopped",
      async () => {
        CODEX_FIXTURE.use("simple");
        running = await startTurnLeavingGrandchild();
        expect(isRunning(grandchild)).toBe(true);

        await running.dispose();
        expect(await isGoneWithin(grandchild as number)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "takes down what an orphan's turn left running when it is reaped",
      async () => {
        CODEX_FIXTURE.use("simple");
        const orphan = await startTurnLeavingGrandchild();
        expect(isRunning(grandchild)).toBe(true);

        await reapOrphanCodexProcesses(stateDir as string);
        expect(await isGoneWithin(orphan.pid as number)).toBe(true);
        expect(await isGoneWithin(grandchild as number)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "takes down what a turn left running when the app-server crashes",
      async () => {
        CODEX_FIXTURE.use("simple");
        process.env.MOCK_CODEX_SCRIPT = codexScript("app-server-crash.jsonl");
        running = await startTurnLeavingGrandchild();

        expect(await isGoneWithin(running.pid as number)).toBe(true);
        expect(await isGoneWithin(grandchild as number)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
