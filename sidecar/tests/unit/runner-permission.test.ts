import { describe, expect, it } from "vitest";
import {
  createPermissionBus,
  type PendingRequest,
} from "../../src/agent/permission-bus.js";
import {
  PERMISSION_DECISIONS,
  PERMISSION_DENIED_MESSAGE,
  SDK_PERMISSION_BEHAVIOR,
} from "../../src/constants/permissions.js";
import { bridgeCanUseTool } from "../../src/providers/claude/provider.js";

const CONVERSATION_ID = "conv-bridge-1";
const TOOL_NAME = "Bash";
const TOOL_INPUT = { command: "ls" } satisfies Record<string, unknown>;
const FAST_TIMEOUT_MS = 50;

interface Capture {
  prompts: PendingRequest[];
}

function makeCapture(): Capture {
  return { prompts: [] };
}

function makeBus(capture: Capture, timeoutMs = FAST_TIMEOUT_MS) {
  return createPermissionBus({
    onPromptIframe: (event) => {
      capture.prompts.push(event);
    },
    timeoutMs,
  });
}

async function settleNextTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("bridgeCanUseTool", () => {
  it("maps allow_once to an SDK allow result with original input", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const pending = bridgeCanUseTool(
      bus,
      CONVERSATION_ID,
      TOOL_NAME,
      TOOL_INPUT,
    );
    await settleNextTick();
    expect(capture.prompts).toHaveLength(1);
    const requestId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(requestId, PERMISSION_DECISIONS.ALLOW_ONCE);
    const result = await pending;
    expect(result.behavior).toBe(SDK_PERMISSION_BEHAVIOR.ALLOW);
    if (result.behavior === SDK_PERMISSION_BEHAVIOR.ALLOW) {
      expect(result.updatedInput).toEqual(TOOL_INPUT);
    }
  });

  it("maps deny to an SDK deny result with the canned message", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const pending = bridgeCanUseTool(
      bus,
      CONVERSATION_ID,
      TOOL_NAME,
      TOOL_INPUT,
    );
    await settleNextTick();
    const requestId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(requestId, PERMISSION_DECISIONS.DENY);
    const result = await pending;
    expect(result.behavior).toBe(SDK_PERMISSION_BEHAVIOR.DENY);
    if (result.behavior === SDK_PERMISSION_BEHAVIOR.DENY) {
      expect(result.message).toBe(PERMISSION_DENIED_MESSAGE);
    }
  });

  it("auto-allows after a session decision without re-prompting the iframe", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const first = bridgeCanUseTool(bus, CONVERSATION_ID, TOOL_NAME, TOOL_INPUT);
    await settleNextTick();
    const requestId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(requestId, PERMISSION_DECISIONS.ALLOW_SESSION);
    const firstResult = await first;
    expect(firstResult.behavior).toBe(SDK_PERMISSION_BEHAVIOR.ALLOW);

    const second = await bridgeCanUseTool(
      bus,
      CONVERSATION_ID,
      TOOL_NAME,
      TOOL_INPUT,
    );
    expect(second.behavior).toBe(SDK_PERMISSION_BEHAVIOR.ALLOW);
    expect(capture.prompts).toHaveLength(1);
  });
});
