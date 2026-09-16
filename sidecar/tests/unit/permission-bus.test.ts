import { describe, expect, it, vi } from "vitest";
import {
  createPermissionBus,
  type PendingRequest,
} from "../../src/agent/permission-bus.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";

const CONVERSATION_ID = "conv-1";
const OTHER_CONVERSATION_ID = "conv-2";
const TOOL_NAME = "Bash";
const TOOL_ARGS = { command: "ls -la" };
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

function buildRequest(conversationId = CONVERSATION_ID) {
  return { conversationId, toolName: TOOL_NAME, args: TOOL_ARGS };
}

async function settleNextTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("permission bus", () => {
  it("resolves with allow_once when the iframe approves once", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const promise = bus.requestPermission(buildRequest());
    await settleNextTick();
    expect(capture.prompts).toHaveLength(1);
    const requestId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(requestId, PERMISSION_DECISIONS.ALLOW_ONCE);
    await expect(promise).resolves.toBe(PERMISSION_DECISIONS.ALLOW_ONCE);
  });

  it("auto-resolves identical requests after allow_session without prompting", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const first = bus.requestPermission(buildRequest());
    await settleNextTick();
    const requestId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(requestId, PERMISSION_DECISIONS.ALLOW_SESSION);
    await expect(first).resolves.toBe(PERMISSION_DECISIONS.ALLOW_SESSION);

    const second = bus.requestPermission(buildRequest());
    await expect(second).resolves.toBe(PERMISSION_DECISIONS.ALLOW_ONCE);
    expect(capture.prompts).toHaveLength(1);
  });

  it("auto-denies when no response arrives before the timeout", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const decision = await bus.requestPermission(buildRequest());
    expect(decision).toBe(PERMISSION_DECISIONS.DENY);
    warnSpy.mockRestore();
  });

  it("does not remember session memory after a deny decision", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const first = bus.requestPermission(buildRequest());
    await settleNextTick();
    const firstId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(firstId, PERMISSION_DECISIONS.DENY);
    await expect(first).resolves.toBe(PERMISSION_DECISIONS.DENY);

    const second = bus.requestPermission(buildRequest());
    await settleNextTick();
    expect(capture.prompts).toHaveLength(2);
    const secondId = capture.prompts[1]?.requestId as string;
    bus.resolvePermission(secondId, PERMISSION_DECISIONS.ALLOW_ONCE);
    await expect(second).resolves.toBe(PERMISSION_DECISIONS.ALLOW_ONCE);
  });

  it("clears session memory when forgetConversation is called", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const first = bus.requestPermission(buildRequest());
    await settleNextTick();
    const firstId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(firstId, PERMISSION_DECISIONS.ALLOW_SESSION);
    await first;
    expect(bus.hasSessionAllowed(CONVERSATION_ID, TOOL_NAME)).toBe(true);

    bus.forgetConversation(CONVERSATION_ID);
    expect(bus.hasSessionAllowed(CONVERSATION_ID, TOOL_NAME)).toBe(false);

    const second = bus.requestPermission(buildRequest());
    await settleNextTick();
    expect(capture.prompts).toHaveLength(2);
    const secondId = capture.prompts[1]?.requestId as string;
    bus.resolvePermission(secondId, PERMISSION_DECISIONS.ALLOW_ONCE);
    await second;
  });

  it("scopes an allow_session grant to the exact tool", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const first = bus.requestPermission(buildRequest());
    await settleNextTick();
    const firstId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(firstId, PERMISSION_DECISIONS.ALLOW_SESSION);
    await first;
    expect(bus.hasSessionAllowed(CONVERSATION_ID, TOOL_NAME)).toBe(true);
    expect(bus.hasSessionAllowed(CONVERSATION_ID, "OtherTool")).toBe(false);
  });

  it("keeps session memory scoped to a single conversation", async () => {
    const capture = makeCapture();
    const bus = makeBus(capture);
    const first = bus.requestPermission(buildRequest(CONVERSATION_ID));
    await settleNextTick();
    const firstId = capture.prompts[0]?.requestId as string;
    bus.resolvePermission(firstId, PERMISSION_DECISIONS.ALLOW_SESSION);
    await first;

    const otherConv = bus.requestPermission(
      buildRequest(OTHER_CONVERSATION_ID),
    );
    await settleNextTick();
    expect(capture.prompts).toHaveLength(2);
    const otherId = capture.prompts[1]?.requestId as string;
    bus.resolvePermission(otherId, PERMISSION_DECISIONS.DENY);
    await expect(otherConv).resolves.toBe(PERMISSION_DECISIONS.DENY);
  });
});
