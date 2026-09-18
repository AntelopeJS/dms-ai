import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { OPENAI_API_KEY_ENV_VAR } from "../../src/constants/codex.js";
import {
  PROVIDER_LABELS,
  PROVIDER_UNAVAILABLE_REASONS,
} from "../../src/constants/providers.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import { CLAUDE_FIXTURE } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  openIframe,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const TEST_TIMEOUT_MS = 30_000;
const WAIT_TIMEOUT_MS = 10_000;
const CONVERSATION = "conv-unavailable";

function isRunError(msg: WireMessage): boolean {
  return msg.type === "run_error";
}

/**
 * The provider is selected while it works, and stops working afterwards — a key
 * removed from the environment, a package uninstalled. What must not happen is
 * the conversation quietly continuing on the other backend.
 */
describe("a selected provider that cannot run", () => {
  let harness: WsHarness | undefined;
  let client: WebSocket | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env[OPENAI_API_KEY_ENV_VAR];
    delete process.env[OPENAI_API_KEY_ENV_VAR];
    CLAUDE_FIXTURE.use("simple");
  });

  afterEach(async () => {
    client?.close();
    client = undefined;
    await harness?.close();
    harness = undefined;
    CLAUDE_FIXTURE.reset();
    if (savedKey !== undefined) process.env[OPENAI_API_KEY_ENV_VAR] = savedKey;
  });

  it(
    "fails the turn with the reason instead of falling back to the default",
    async () => {
      harness = await startWsHarness({ provider: "claude" });
      client = await openIframe(harness.port);
      const collector = createCollector(client, WAIT_TIMEOUT_MS);
      sendHello(client, CONVERSATION);
      sendWire(client, {
        type: "set_settings",
        ...DEFAULT_SETTINGS,
        provider: "codex",
      });
      sendUserMessage(client, CONVERSATION, "build me a page");

      const failure = await collector.next(isRunError);
      expect(failure.error).toContain(PROVIDER_LABELS.codex);
      expect(failure.error).toContain(
        PROVIDER_UNAVAILABLE_REASONS.CODEX_API_KEY_MISSING,
      );
      // Nothing was answered by the other backend.
      expect(collector.events.some((e) => e.type === "assistant_text")).toBe(
        false,
      );
      expect(harness.conversationStore.get(CONVERSATION)?.provider).toBe(
        "codex",
      );
    },
    TEST_TIMEOUT_MS,
  );
});
