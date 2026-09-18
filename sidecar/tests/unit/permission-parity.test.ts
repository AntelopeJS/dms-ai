import { describe, expect, it } from "vitest";
import {
  createPermissionBus,
  type PendingRequest,
  type PermissionBus,
} from "../../src/agent/permission-bus.js";
import {
  CODEX_APPROVAL_DECISIONS,
  CODEX_COMMAND_APPROVAL_METHOD,
} from "../../src/constants/codex.js";
import {
  PERMISSION_DECISIONS,
  type PermissionDecision,
  SDK_PERMISSION_BEHAVIOR,
} from "../../src/constants/permissions.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { BASH_COMMAND_ARG } from "../../src/constants/tool-lexicon.js";
import { bridgeCanUseTool } from "../../src/providers/claude/provider.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import type { ProviderName } from "../../src/state/types.js";

const CONVERSATION = "conv-parity";
const TOOL_NAME = "Bash";
const COMMAND = "rm -rf build";
const PROMPT_TIMEOUT_MS = 200;

interface Capture {
  prompts: PendingRequest[];
}

function buildBus(capture: Capture): PermissionBus {
  return createPermissionBus({
    onPromptIframe: (event) => capture.prompts.push(event),
    timeoutMs: PROMPT_TIMEOUT_MS,
  });
}

/** Asks the provider's own permission binding, and says whether it allowed. */
type AskThroughBinding = (bus: PermissionBus) => Promise<boolean>;

const BINDINGS: Record<ProviderName, AskThroughBinding> = {
  claude: async (bus) => {
    const result = await bridgeCanUseTool(bus, CONVERSATION, TOOL_NAME, {
      command: COMMAND,
    });
    return result.behavior === SDK_PERMISSION_BEHAVIOR.ALLOW;
  },
  codex: async (bus) => {
    const handler = createCodexPermissionHandler({
      conversationId: CONVERSATION,
      permissionBus: bus,
      getSettings: () => ({ ...DEFAULT_SETTINGS, generationMode: "vibe" }),
      getChangedPaths: () => [],
    });
    const answer = await handler.handle({
      id: 0,
      method: CODEX_COMMAND_APPROVAL_METHOD,
      params: { command: COMMAND },
    });
    return answer.decision === CODEX_APPROVAL_DECISIONS.ACCEPT;
  },
};

const PROVIDERS = Object.keys(BINDINGS) as ProviderName[];

async function settle(): Promise<void> {
  await new Promise((done) => setImmediate(done));
}

async function askAndAnswer(
  ask: AskThroughBinding,
  bus: PermissionBus,
  capture: Capture,
  decision: PermissionDecision,
): Promise<boolean> {
  const pending = ask(bus);
  await settle();
  const requestId = capture.prompts.at(-1)?.requestId as string;
  bus.resolvePermission(requestId, decision);
  return pending;
}

// One prompt, one verdict, one effect: whichever binding carries it.
describe.each(PROVIDERS)("permission parity on %s", (provider) => {
  const ask = BINDINGS[provider];

  it("prompts once and allows on allow_once", async () => {
    const capture: Capture = { prompts: [] };
    const bus = buildBus(capture);
    const allowed = await askAndAnswer(
      ask,
      bus,
      capture,
      PERMISSION_DECISIONS.ALLOW_ONCE,
    );
    expect(capture.prompts).toHaveLength(1);
    expect(capture.prompts[0]?.toolName).toBe(TOOL_NAME);
    expect(capture.prompts[0]?.args).toMatchObject({
      [BASH_COMMAND_ARG]: COMMAND,
    });
    expect(allowed).toBe(true);
  });

  it("refuses on deny", async () => {
    const capture: Capture = { prompts: [] };
    const bus = buildBus(capture);
    const allowed = await askAndAnswer(
      ask,
      bus,
      capture,
      PERMISSION_DECISIONS.DENY,
    );
    expect(allowed).toBe(false);
  });

  it("stops prompting after allow_session", async () => {
    const capture: Capture = { prompts: [] };
    const bus = buildBus(capture);
    const first = await askAndAnswer(
      ask,
      bus,
      capture,
      PERMISSION_DECISIONS.ALLOW_SESSION,
    );
    expect(first).toBe(true);
    const second = await ask(bus);
    expect(second).toBe(true);
    expect(capture.prompts).toHaveLength(1);
  });

  it("refuses when the prompt times out unanswered", async () => {
    const capture: Capture = { prompts: [] };
    const bus = buildBus(capture);
    expect(await ask(bus)).toBe(false);
  });
});
