import { describe, expect, it, vi } from "vitest";
import { denialMessage } from "../../src/agent/permission-bus.js";
import {
  PERMISSION_DECISIONS,
  PERMISSION_EXPIRED_MESSAGE,
  PERMISSION_FEEDBACK_PREFIX,
} from "../../src/constants/permissions.js";
import { createTestBus } from "../helpers/permission-bus.js";

const CONVERSATION_ID = "conv-1";
const OTHER_CONVERSATION_ID = "conv-2";
const BASH = "Bash";
const TEST_COMMAND = { command: "pnpm test --run" };
const OTHER_TEST_COMMAND = { command: "pnpm test unit" };
const LINT_COMMAND = { command: "pnpm lint" };
const DEPENDENCY_COMMAND = { command: "pnpm add jsvat" };
const DELETE_PAGE = "mcp__dms-ai__BuilderDeletePage";
const REMOVE_BLOCK = "mcp__dms-ai__BuilderRemoveBlock";

function request(
  args: unknown,
  conversationId = CONVERSATION_ID,
  toolName = BASH,
) {
  return { conversationId, toolName, args, callId: `call-${Math.random()}` };
}

describe("permission bus", () => {
  it("allows once and records the call as approved by the user", async () => {
    const t = createTestBus();
    const pending = t.bus.requestPermission(request(TEST_COMMAND));
    const [prompt] = await t.waitForPrompts(1);
    expect(prompt?.kind).toBe("command");
    expect(prompt?.ruleOptions).toEqual([
      { kind: "command", value: "pnpm test" },
    ]);
    expect(prompt?.expiresAtMs).toBeGreaterThan(prompt?.createdAtMs ?? 0);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_ONCE,
      actor: "Camille",
    });
    await expect(pending).resolves.toMatchObject({
      isAllowed: true,
      allowedBy: "approved",
    });
    expect(t.decisions[0]?.prompt?.decidedBy).toBe("Camille");
  });

  it("an allow_rule decision lets later matching commands through as a rule", async () => {
    const t = createTestBus();
    const first = t.bus.requestPermission(request(TEST_COMMAND));
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_RULE,
      rule: { kind: "command", value: "pnpm test" },
    });
    await first;
    expect(t.bus.listRules(CONVERSATION_ID)).toHaveLength(1);
    await expect(
      t.bus.requestPermission(request(OTHER_TEST_COMMAND)),
    ).resolves.toMatchObject({
      isAllowed: true,
      allowedBy: "rule",
    });
    expect(t.prompts).toHaveLength(1);
    void t.bus.requestPermission(request(LINT_COMMAND));
    await t.waitForPrompts(2);
    void t.bus.requestPermission(
      request(OTHER_TEST_COMMAND, OTHER_CONVERSATION_ID),
    );
    await t.waitForPrompts(3);
  });

  it("never matches a compound command a rule does not cover", async () => {
    const t = createTestBus();
    const first = t.bus.requestPermission(request(TEST_COMMAND));
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_RULE,
      rule: { kind: "command", value: "pnpm test" },
    });
    await first;
    void t.bus.requestPermission(
      request({ command: "pnpm test && rm -rf src" }),
    );
    void t.bus.requestPermission(request({ command: "pnpm test > out.txt" }));
    await t.waitForPrompts(3);
  });

  it("ignores a rule the request did not offer", async () => {
    const t = createTestBus();
    const first = t.bus.requestPermission(request(TEST_COMMAND));
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_RULE,
      rule: { kind: "command", value: "rm" },
    });
    await expect(first).resolves.toMatchObject({ isAllowed: true });
    expect(t.bus.listRules(CONVERSATION_ID)).toEqual([]);
  });

  it("revokes a rule and forgets every rule with the conversation", async () => {
    const t = createTestBus();
    const first = t.bus.requestPermission(request(TEST_COMMAND));
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_RULE,
      rule: { kind: "command", value: "pnpm test" },
    });
    await first;
    const [rule] = t.bus.listRules(CONVERSATION_ID);
    expect(rule?.label).toContain("pnpm test");
    expect(t.bus.revokeRule(CONVERSATION_ID, rule?.id as string)).toBe(true);
    expect(t.bus.listRules(CONVERSATION_ID)).toEqual([]);
    expect(t.bus.revokeRule(CONVERSATION_ID, "unknown")).toBe(false);
  });

  it("hands the agent the user's own words when they suggest a change", async () => {
    const t = createTestBus();
    const pending = t.bus.requestPermission(request(TEST_COMMAND));
    const [prompt] = await t.waitForPrompts(1);
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.DENY,
      feedback: "run only the unit tests",
    });
    const outcome = await pending;
    expect(outcome).toMatchObject({ isAllowed: false, allowedBy: "denied" });
    expect(denialMessage(outcome)).toBe(
      `${PERMISSION_FEEDBACK_PREFIX}run only the unit tests`,
    );
  });

  it("expires an unanswered request and says so", async () => {
    const t = createTestBus();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await t.bus.requestPermission(request(TEST_COMMAND));
    warnSpy.mockRestore();
    expect(outcome.allowedBy).toBe("expired");
    expect(denialMessage(outcome)).toBe(PERMISSION_EXPIRED_MESSAGE);
    expect(t.decisions[0]?.prompt?.settledAs).toBe("expired");
  });

  it("deny_all refuses every pending request of the chat and stops the turn", async () => {
    const t = createTestBus();
    const first = t.bus.requestPermission(request(TEST_COMMAND));
    const second = t.bus.requestPermission(request(LINT_COMMAND));
    const other = t.bus.requestPermission(
      request(LINT_COMMAND, OTHER_CONVERSATION_ID),
    );
    const prompts = await t.waitForPrompts(3);
    const own = prompts.find((p) => p.conversationId === CONVERSATION_ID);
    t.bus.resolvePermission({
      requestId: own?.requestId as string,
      decision: PERMISSION_DECISIONS.DENY_ALL,
    });
    await expect(first).resolves.toMatchObject({
      isAllowed: false,
      shouldInterrupt: true,
    });
    await expect(second).resolves.toMatchObject({
      isAllowed: false,
      shouldInterrupt: true,
    });
    expect(t.denyAlls).toEqual([CONVERSATION_ID]);
    expect(t.bus.countPending(OTHER_CONVERSATION_ID)).toBe(1);
    t.bus.cancelConversation(OTHER_CONVERSATION_ID);
    await expect(other).resolves.toMatchObject({ isAllowed: false });
  });

  it("Full auto answers for the user, but never for the always-ask set", async () => {
    const t = createTestBus({ policy: { isFullAuto: true } });
    await expect(
      t.bus.requestPermission(request(TEST_COMMAND)),
    ).resolves.toMatchObject({
      isAllowed: true,
      allowedBy: "full_auto",
    });
    void t.bus.requestPermission(request(DEPENDENCY_COMMAND));
    void t.bus.requestPermission(
      request({ pageRef: "/dashboard" }, CONVERSATION_ID, DELETE_PAGE),
    );
    void t.bus.requestPermission(
      request({ path: "/p#a" }, CONVERSATION_ID, REMOVE_BLOCK),
    );
    const prompts = await t.waitForPrompts(3);
    expect(
      prompts.every((p) => p.alwaysAsk && p.ruleOptions.length === 0),
    ).toBe(true);
    const dependency = prompts.find((p) => p.toolName === BASH);
    expect(dependency?.preview).toMatchObject({
      type: "command",
      effect: "adds_dependency",
      touches: ["package.json", "pnpm-lock.yaml"],
    });
    const deletion = prompts.find((p) => p.toolName === DELETE_PAGE);
    expect(deletion?.kind).toBe("destructive");
    expect(deletion?.preview).toMatchObject({
      type: "destructive",
      target: "/dashboard",
    });
  });

  it("lets block removal through when its always-ask setting is off", async () => {
    const t = createTestBus({
      policy: { isFullAuto: true, alwaysAskBlockRemoval: false },
    });
    await expect(
      t.bus.requestPermission(
        request({ path: "/p#a" }, CONVERSATION_ID, REMOVE_BLOCK),
      ),
    ).resolves.toMatchObject({ isAllowed: true, allowedBy: "full_auto" });
  });

  it("forwards keepData for a resource deletion kept as data", async () => {
    const t = createTestBus();
    const pending = t.bus.requestPermission(
      request(
        { ref: "books" },
        CONVERSATION_ID,
        "mcp__dms-ai__BuilderDeleteResource",
      ),
    );
    const [prompt] = await t.waitForPrompts(1);
    expect(prompt?.preview).toMatchObject({
      type: "destructive",
      consequence: "deletes_data",
      canKeepData: true,
      confirmText: "books",
    });
    t.bus.resolvePermission({
      requestId: prompt?.requestId as string,
      decision: PERMISSION_DECISIONS.ALLOW_ONCE,
      keepData: true,
    });
    await expect(pending).resolves.toMatchObject({
      isAllowed: true,
      keepData: true,
    });
  });
});
