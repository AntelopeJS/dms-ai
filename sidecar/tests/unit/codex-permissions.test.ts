import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  PermissionBus,
  PermissionOutcome,
} from "../../src/agent/permission-bus.js";
import type { ToolDecision } from "../../src/agent/provider.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import {
  CODEX_COMMAND_APPROVAL_METHOD,
  CODEX_FILE_CHANGE_APPROVAL_METHOD,
} from "../../src/constants/codex.js";
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
const UNKNOWN_METHOD = "item/unknown/requestApproval";

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, generationMode: "vibe", ...overrides };
}

const APPROVED: PermissionOutcome = { isAllowed: true, allowedBy: "approved" };
const DENIED: PermissionOutcome = { isAllowed: false, allowedBy: "denied" };
const PATCH_DIFF = "@@ -1 +1 @@\n-a\n+b\n";

function buildBus(outcome: PermissionOutcome) {
  const requestPermission = vi.fn(async () => outcome);
  const bus = { requestPermission } as unknown as PermissionBus;
  return { bus, requestPermission };
}

function changesOf(itemId: string) {
  if (itemId !== ITEM_ID) return [];
  return [{ path: CHANGED_PATH, kind: "update", diff: PATCH_DIFF }];
}

function buildHandler(current: AppSettings, outcome = APPROVED) {
  const { bus, requestPermission } = buildBus(outcome);
  const decisions: ToolDecision[] = [];
  const handler = createCodexPermissionHandler({
    conversationId: CONVERSATION,
    permissionBus: bus,
    getSettings: () => current,
    getChanges: changesOf,
    onToolDecision: (decision) => decisions.push(decision),
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
      callId: ITEM_ID,
    });
  });

  it("prompts for a patch as an Edit carrying the path from the started item", async () => {
    const { handler, requestPermission } = buildHandler(settings({}));
    await handler.handle(FILE_CHANGE_REQUEST);
    expect(requestPermission).toHaveBeenCalledWith({
      conversationId: CONVERSATION,
      toolName: "Edit",
      args: {
        file_path: CHANGED_PATH,
        file_paths: [CHANGED_PATH],
        change_kind: "update",
        diff: PATCH_DIFF,
      },
      callId: ITEM_ID,
    });
  });

  it("declines when the user denies", async () => {
    const { handler } = buildHandler(settings({}), DENIED);
    expect(await handler.handle(COMMAND_REQUEST)).toEqual({
      decision: "decline",
    });
  });

  it("accepts a call a rule allowed", async () => {
    const { handler } = buildHandler(settings({}), {
      isAllowed: true,
      allowedBy: "rule",
    });
    expect(await handler.handle(COMMAND_REQUEST)).toEqual({
      decision: "accept",
    });
  });

  // A later Codex release adding a decision method would otherwise become a
  // refusal loop with nothing in the logs pointing at it.
  it("refuses an unknown server request, and says which one", async () => {
    const { handler } = buildHandler(settings({}));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(
        await handler.handle({ id: 9, method: UNKNOWN_METHOD, params: {} }),
      ).toEqual({ decision: "decline" });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(UNKNOWN_METHOD),
      );
    } finally {
      warn.mockRestore();
    }
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
    const { bus, requestPermission } = buildBus(APPROVED);
    const handler = createCodexPermissionHandler({
      conversationId: CONVERSATION,
      permissionBus: bus,
      getSettings: () => current,
      getChanges: changesOf,
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

  it("records a mode refusal as blocked, by the item's id", async () => {
    const { handler, decisions } = buildHandler(
      settings({ generationMode: "safe" }),
    );
    await handler.handle(COMMAND_REQUEST);
    expect(decisions).toEqual([
      { callId: ITEM_ID, toolName: "Bash", allowedBy: "blocked" },
    ]);
  });
});

describe("developer instructions", () => {
  it("says nothing in vibe mode", () => {
    expect(buildDeveloperInstructions(settings({}))).toBeUndefined();
  });

  it("carries the refusal reason up front in safe mode", () => {
    expect(
      buildDeveloperInstructions(settings({ generationMode: "safe" })),
    ).toBe(SAFE_MODE_DENIED_MESSAGE);
  });

  // The escalation itself rides on the turn text, not on these instructions:
  // see codex-config (shape) and codex-lifecycle (wiring).
});
