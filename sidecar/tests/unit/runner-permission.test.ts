import { describe, expect, it } from "vitest";
import {
  PERMISSION_DECISIONS,
  PERMISSION_DENIED_MESSAGE,
  PERMISSION_DENY_ALL_MESSAGE,
  SDK_PERMISSION_BEHAVIOR,
} from "../../src/constants/permissions.js";
import { bridgeCanUseTool } from "../../src/providers/claude/provider.js";
import { createTestBus } from "../helpers/permission-bus.js";

const CONVERSATION_ID = "conv-bridge-1";
const TOOL_NAME = "Bash";
const TOOL_INPUT = { command: "ls" } satisfies Record<string, unknown>;
const CALL_ID = "toolu_1";

describe("bridgeCanUseTool", () => {
  it("maps allow_once to an SDK allow result with original input", async () => {
    const t = createTestBus();
    const pending = bridgeCanUseTool(
      t.bus,
      CONVERSATION_ID,
      TOOL_NAME,
      TOOL_INPUT,
      CALL_ID,
    );
    const [prompt] = await t.waitForPrompts(1);
    expect(prompt?.callId).toBe(CALL_ID);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_ONCE,
    });
    const result = await pending;
    expect(result.behavior).toBe(SDK_PERMISSION_BEHAVIOR.ALLOW);
    if (result.behavior === SDK_PERMISSION_BEHAVIOR.ALLOW) {
      expect(result.updatedInput).toEqual(TOOL_INPUT);
    }
  });

  it("maps deny to an SDK deny result with the canned message", async () => {
    const t = createTestBus();
    const pending = bridgeCanUseTool(
      t.bus,
      CONVERSATION_ID,
      TOOL_NAME,
      TOOL_INPUT,
    );
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.DENY,
    });
    const result = await pending;
    expect(result.behavior).toBe(SDK_PERMISSION_BEHAVIOR.DENY);
    if (result.behavior === SDK_PERMISSION_BEHAVIOR.DENY) {
      expect(result.message).toBe(PERMISSION_DENIED_MESSAGE);
    }
  });

  it("asks the SDK to stop the turn on deny_all", async () => {
    const t = createTestBus();
    const pending = bridgeCanUseTool(
      t.bus,
      CONVERSATION_ID,
      TOOL_NAME,
      TOOL_INPUT,
    );
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.DENY_ALL,
    });
    const result = await pending;
    expect(result).toMatchObject({
      behavior: SDK_PERMISSION_BEHAVIOR.DENY,
      message: PERMISSION_DENY_ALL_MESSAGE,
      interrupt: true,
    });
  });
});
