import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PermissionBus } from "../../src/agent/permission-bus.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import {
  CODEX_COMMAND_APPROVAL_METHOD,
  CODEX_FILE_CHANGE_APPROVAL_METHOD,
} from "../../src/constants/codex.js";
import {
  PERMISSION_DECISIONS,
  type PermissionDecision,
} from "../../src/constants/permissions.js";
import {
  DEFAULT_SETTINGS,
  SAFE_MODE_DENIED_MESSAGE,
} from "../../src/constants/settings.js";
import { buildDeveloperInstructions } from "../../src/providers/codex/config.js";
import { createCodexPermissionHandler } from "../../src/providers/codex/permissions.js";
import type { AppSettings } from "../../src/state/settings-types.js";

// Safe mode only means anything with the Builder loaded: without it the whole
// path degrades to vibe, which is a separate case covered in codex-config.
beforeAll(() => setBuilderAvailable(true));
afterAll(() => setBuilderAvailable(false));

const CONVERSATION = "conv-perm";
const ITEM_ID = "call_1";
const CHANGED_PATH = "/srv/app/src/page.ts";
const COMMAND = "rm -rf build";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, generationMode: "vibe", ...overrides };
}

function buildBus(decision: PermissionDecision) {
  const requestPermission = vi.fn(async () => decision);
  const bus = { requestPermission } as unknown as PermissionBus;
  return { bus, requestPermission };
}

function buildHandler(
  current: AppSettings,
  decision: PermissionDecision = PERMISSION_DECISIONS.ALLOW_ONCE,
) {
  const { bus, requestPermission } = buildBus(decision);
  const decisions: [string, PermissionDecision][] = [];
  const handler = createCodexPermissionHandler({
    conversationId: CONVERSATION,
    permissionBus: bus,
    getSettings: () => current,
    getChangedPaths: (itemId) => (itemId === ITEM_ID ? [CHANGED_PATH] : []),
    onPermissionDecision: (tool, taken) => decisions.push([tool, taken]),
  });
  return { handler, requestPermission, decisions };
}

const COMMAND_REQUEST = {
  id: 0,
  method: CODEX_COMMAND_APPROVAL_METHOD,
  params: { itemId: ITEM_ID, command: COMMAND },
};

const FILE_CHANGE_REQUEST = {
  id: 1,
  method: CODEX_FILE_CHANGE_APPROVAL_METHOD,
  params: { itemId: ITEM_ID },
};

describe("approval routing", () => {
  it("prompts for a command as a Bash request carrying the command", async () => {
    const { handler, requestPermission } = buildHandler(settings({}));
    const result = await handler.handle(COMMAND_REQUEST);
    expect(result).toEqual({ decision: "accept" });
    expect(requestPermission).toHaveBeenCalledWith({
      conversationId: CONVERSATION,
      toolName: "Bash",
      args: { command: COMMAND },
    });
  });

  it("prompts for a patch as an Edit carrying the path from the started item", async () => {
    const { handler, requestPermission } = buildHandler(settings({}));
    await handler.handle(FILE_CHANGE_REQUEST);
    expect(requestPermission).toHaveBeenCalledWith({
      conversationId: CONVERSATION,
      toolName: "Edit",
      args: { file_path: CHANGED_PATH },
    });
  });

  it("declines when the user denies", async () => {
    const { handler } = buildHandler(settings({}), PERMISSION_DECISIONS.DENY);
    expect(await handler.handle(COMMAND_REQUEST)).toEqual({
      decision: "decline",
    });
  });

  it("accepts a session-wide allowance", async () => {
    const { handler } = buildHandler(
      settings({}),
      PERMISSION_DECISIONS.ALLOW_SESSION,
    );
    expect(await handler.handle(COMMAND_REQUEST)).toEqual({
      decision: "accept",
    });
  });

  it("refuses an unknown server request rather than accepting it", async () => {
    const { handler } = buildHandler(settings({}));
    expect(
      await handler.handle({ id: 9, method: "item/unknown", params: {} }),
    ).toEqual({ decision: "decline" });
  });
});

describe("auto-decline modes", () => {
  it("declines in safe mode without ever prompting the user", async () => {
    const { handler, requestPermission } = buildHandler(
      settings({ generationMode: "safe" }),
    );
    expect(await handler.handle(COMMAND_REQUEST)).toEqual({
      decision: "decline",
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("declines in plan mode", async () => {
    const { handler, requestPermission } = buildHandler(
      settings({ mode: "plan" }),
    );
    expect(await handler.handle(FILE_CHANGE_REQUEST)).toEqual({
      decision: "decline",
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("reads the mode live, so a safe/vibe flip applies at once", async () => {
    const current = settings({ generationMode: "safe" });
    const { bus, requestPermission } = buildBus(
      PERMISSION_DECISIONS.ALLOW_ONCE,
    );
    const handler = createCodexPermissionHandler({
      conversationId: CONVERSATION,
      permissionBus: bus,
      getSettings: () => current,
      getChangedPaths: () => [CHANGED_PATH],
    });
    await handler.handle(COMMAND_REQUEST);
    expect(requestPermission).not.toHaveBeenCalled();

    current.generationMode = "vibe";
    await handler.handle(COMMAND_REQUEST);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("declines everything once the turn is cancelled", async () => {
    const { handler } = buildHandler(settings({}));
    handler.cancelPending();
    expect(await handler.handle(COMMAND_REQUEST)).toEqual({
      decision: "decline",
    });
  });
});

describe("consecutive denials", () => {
  it("counts refusals and resets on an approval", async () => {
    const current = settings({ generationMode: "safe" });
    const { handler } = buildHandler(current);
    await handler.handle(COMMAND_REQUEST);
    await handler.handle(COMMAND_REQUEST);
    expect(handler.consecutiveDenials()).toBe(2);

    current.generationMode = "vibe";
    await handler.handle(COMMAND_REQUEST);
    expect(handler.consecutiveDenials()).toBe(0);
  });

  it("reports each decision to the metrics hook", async () => {
    const { handler, decisions } = buildHandler(settings({}));
    await handler.handle(COMMAND_REQUEST);
    expect(decisions).toEqual([["Bash", PERMISSION_DECISIONS.ALLOW_ONCE]]);
  });
});

describe("developer instructions", () => {
  it("says nothing in vibe mode", () => {
    expect(buildDeveloperInstructions(settings({}), 0)).toBeUndefined();
  });

  it("carries the refusal reason up front in safe mode", () => {
    expect(
      buildDeveloperInstructions(settings({ generationMode: "safe" }), 0),
    ).toBe(SAFE_MODE_DENIED_MESSAGE);
  });

  it("escalates the reminder after repeated refusals", () => {
    const reminder = buildDeveloperInstructions(
      settings({ generationMode: "safe" }),
      3,
    );
    expect(reminder).toContain(SAFE_MODE_DENIED_MESSAGE);
    expect(reminder).toContain("refused 3 times in a row");
  });
});
