import { describe, expect, it } from "vitest";
import type { PermissionBus } from "../../src/agent/permission-bus.js";
import {
  CODEX_APPROVAL_DECISIONS,
  CODEX_COMMAND_APPROVAL_METHOD,
} from "../../src/constants/codex.js";
import {
  PERMISSION_DECISIONS,
  SDK_PERMISSION_BEHAVIOR,
} from "../../src/constants/permissions.js";
import type { PermissionDecisionValue } from "../../src/protocol/messages.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { BASH_COMMAND_ARG } from "../../src/constants/tool-lexicon.js";
import { bridgeCanUseTool } from "../../src/providers/claude/provider.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import type { ProviderName } from "../../src/state/types.js";
import { createTestBus, type TestBus } from "../helpers/permission-bus.js";

const CONVERSATION = "conv-parity";
const TOOL_NAME = "Bash";
const COMMAND = "rm -rf build";
const PROMPT_TIMEOUT_MS = 200;

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
      getChanges: () => [],
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

async function askAndAnswer(
  ask: AskThroughBinding,
  t: TestBus,
  decision: PermissionDecisionValue,
  rule?: { kind: "command"; value: string },
): Promise<boolean> {
  const count = t.prompts.length + 1;
  const pending = ask(t.bus);
  const prompts = await t.waitForPrompts(count);
  const requestId = prompts.at(-1)?.requestId as string;
  t.bus.resolvePermission({ requestId, decision, rule });
  return pending;
}

// One prompt, one verdict, one effect: whichever binding carries it.
describe.each(PROVIDERS)("permission parity on %s", (provider) => {
  const ask = BINDINGS[provider];

  it("prompts once and allows on allow_once", async () => {
    const t = createTestBus({ timeoutMs: PROMPT_TIMEOUT_MS });
    const allowed = await askAndAnswer(ask, t, PERMISSION_DECISIONS.ALLOW_ONCE);
    expect(t.prompts).toHaveLength(1);
    expect(t.prompts[0]?.toolName).toBe(TOOL_NAME);
    expect(t.prompts[0]?.args).toMatchObject({ [BASH_COMMAND_ARG]: COMMAND });
    expect(allowed).toBe(true);
  });

  it("refuses on deny", async () => {
    const t = createTestBus({ timeoutMs: PROMPT_TIMEOUT_MS });
    expect(await askAndAnswer(ask, t, PERMISSION_DECISIONS.DENY)).toBe(false);
  });

  it("stops prompting after a command rule", async () => {
    const t = createTestBus({ timeoutMs: PROMPT_TIMEOUT_MS });
    const first = await askAndAnswer(ask, t, PERMISSION_DECISIONS.ALLOW_RULE, {
      kind: "command",
      value: "rm -rf",
    });
    expect(first).toBe(true);
    expect(await ask(t.bus)).toBe(true);
    expect(t.prompts).toHaveLength(1);
  });

  it("refuses when the prompt times out unanswered", async () => {
    const t = createTestBus({ timeoutMs: PROMPT_TIMEOUT_MS });
    expect(await ask(t.bus)).toBe(false);
  });
});
