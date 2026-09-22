import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { EDIT_TOOL_NAMES } from "../../src/agent/edit-tracker.js";
import { setBuilderAvailable } from "../../src/builder/capability.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  createCollector,
  interruptTurn,
  openIframe,
  sendHello,
  sendSettings,
  sendUserMessage,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-recipe-1";
const WAIT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 40_000;
const INTERRUPT_BUDGET_MS = 5_000;

function isTerminalEvent(msg: WireMessage): boolean {
  return msg.type === "run_done" || msg.type === "run_error";
}

function unpaired(events: WireMessage[]): string[] {
  const open = new Set<string>();
  for (const event of events) {
    if (event.type === "tool_call_start") open.add(String(event.callId));
    if (event.type === "tool_call_end") open.delete(String(event.callId));
  }
  return [...open];
}

// Scenarios 1 to 5, 8 and 9 of the acceptance recipe: everything that is about
// one turn's lifecycle, driven over the same WS protocol the chatbox speaks.
describe.each(PROVIDER_FIXTURES)(
  "recipe — turn lifecycle on $name",
  (fixture) => {
    let harness: WsHarness | undefined;
    let client: WebSocket | undefined;

    afterEach(async () => {
      client?.close();
      client = undefined;
      setBuilderAvailable(false);
      fixture.reset();
      await harness?.close();
      harness = undefined;
    });

    // The recipe answers prompts as a user would; a scenario that is not about
    // the verdict itself simply says yes to whatever comes.
    function approveEveryPrompt(collector: WireCollector): void {
      void collector
        .next((e) => e.type === "permission_request")
        .then((prompt) =>
          answerPermission(
            client as WebSocket,
            prompt,
            PERMISSION_DECISIONS.ALLOW_ONCE,
          ),
        )
        .catch(() => undefined);
    }

    // The chatbox echoes a queued follow-up, never an immediate message, so a
    // second turn is recognized by its own terminal event.
    function terminalCount(collector: WireCollector): number {
      return collector.events.filter(isTerminalEvent).length;
    }

    async function connect(): Promise<WireCollector> {
      harness = await startWsHarness({ provider: fixture.name });
      client = await openIframe(harness.port);
      const collector = createCollector(client, WAIT_TIMEOUT_MS);
      sendHello(client, CONVERSATION_ID);
      return collector;
    }

    it(
      "1 — a simple message streams text and ends on run_done",
      async () => {
        fixture.use("simple");
        const collector = await connect();
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "explain");
        const done = await collector.next(isTerminalEvent);
        expect(done.type).toBe("run_done");
        expect(
          collector.events.filter((e) => e.type === "assistant_message_chunk"),
        ).not.toHaveLength(0);
        expect(unpaired(collector.events)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "2 — a file edit surfaces as an Edit carrying the path the host animates",
      async () => {
        fixture.use("edit");
        const collector = await connect();
        sendUserMessage(
          client as WebSocket,
          CONVERSATION_ID,
          "update the page",
        );
        // An edit escalates on the Claude path in the default mode; this
        // scenario is about what the host sees once it is allowed.
        approveEveryPrompt(collector);
        await collector.next(isTerminalEvent);
        const edits = collector.events.filter(
          (e) =>
            e.type === "tool_call_start" &&
            EDIT_TOOL_NAMES.has(String(e.toolName)),
        );
        expect(edits).not.toHaveLength(0);
        for (const edit of edits) {
          expect((edit.args as { file_path?: string }).file_path).toBeTypeOf(
            "string",
          );
        }
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "3 — a write escalates, the denial lands, and the turn still ends cleanly",
      async () => {
        fixture.use("permission");
        const collector = await connect();
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "create a file");
        const prompt = await collector.next(
          (e) => e.type === "permission_request",
        );
        expect(["Bash", "Edit"]).toContain(prompt.toolName);
        answerPermission(
          client as WebSocket,
          prompt,
          PERMISSION_DECISIONS.DENY,
        );
        const done = await collector.next(isTerminalEvent);
        expect(done.type).toBe("run_done");
        expect(unpaired(collector.events)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "4 — allow_session spares the second occurrence a prompt",
      async () => {
        fixture.use("permission-twice");
        const collector = await connect();
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "first");
        const prompt = await collector.next(
          (e) => e.type === "permission_request",
        );
        answerPermission(
          client as WebSocket,
          prompt,
          PERMISSION_DECISIONS.ALLOW_SESSION,
        );
        await collector.next(isTerminalEvent);

        sendUserMessage(client as WebSocket, CONVERSATION_ID, "again");
        const second = await collector.next(
          (e) => isTerminalEvent(e) && terminalCount(collector) === 2,
        );
        expect(second.type).toBe("run_done");
        expect(
          collector.events.filter((e) => e.type === "permission_request"),
        ).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "5 — safe mode refuses a raw write without ever prompting the user",
      async () => {
        setBuilderAvailable(true);
        fixture.use("permission");
        harness = await startWsHarness({
          provider: fixture.name,
          settings: { generationMode: "safe" },
        });
        client = await openIframe(harness.port);
        const collector = createCollector(client, WAIT_TIMEOUT_MS);
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "create a file");
        const done = await collector.next(isTerminalEvent);
        expect(done.type).toBe("run_done");
        expect(
          collector.events.filter((e) => e.type === "permission_request"),
        ).toEqual([]);
        expect(unpaired(collector.events)).toEqual([]);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "8 — a stop mid-turn lands within budget and leaves nothing orphaned",
      async () => {
        fixture.use("simple");
        const collector = await connect();
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "count to 200");
        await collector.next((e) => e.type === "assistant_message_chunk");
        const startedAt = Date.now();
        interruptTurn(client as WebSocket, CONVERSATION_ID);
        const done = await collector.next(isTerminalEvent);
        expect(Date.now() - startedAt).toBeLessThan(INTERRUPT_BUDGET_MS);
        expect(done.type).toBe("run_done");
        expect(unpaired(collector.events)).toEqual([]);

        // The conversation stays usable: a second turn runs to completion.
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "again");
        const second = await collector.next(
          (e) => isTerminalEvent(e) && terminalCount(collector) === 2,
        );
        expect(second.type).toBe("run_done");
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "8b — a stop does not silence the prompts of the turns that follow",
      async () => {
        fixture.use("permission-twice");
        const collector = await connect();
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "first");
        await collector.next((e) => e.type === "permission_request");
        interruptTurn(client as WebSocket, CONVERSATION_ID);
        await collector.next(isTerminalEvent);

        sendUserMessage(client as WebSocket, CONVERSATION_ID, "again");
        const prompt = await collector.next(
          (e) =>
            e.type === "permission_request" &&
            collector.events.filter((x) => x.type === "permission_request")
              .length === 2,
        );
        expect(["Bash", "Edit"]).toContain(prompt.toolName);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      "9 — a settings change mid-conversation takes effect on the next turn",
      async () => {
        setBuilderAvailable(true);
        fixture.use("permission-twice");
        // Starts in vibe, where a write escalates to the user.
        harness = await startWsHarness({
          provider: fixture.name,
          settings: { generationMode: "vibe" },
        });
        client = await openIframe(harness.port);
        const collector = createCollector(client, WAIT_TIMEOUT_MS);
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, "first");
        const prompt = await collector.next(
          (e) => e.type === "permission_request",
        );
        answerPermission(
          client as WebSocket,
          prompt,
          PERMISSION_DECISIONS.ALLOW_ONCE,
        );
        await collector.next(isTerminalEvent);

        // Safe mode now declines escalations outright, so the same turn must no
        // longer reach the user as a prompt.
        sendSettings(client as WebSocket, { generationMode: "safe" });
        await collector.next(
          (e) =>
            e.type === "settings_update" &&
            (e.settings as { generationMode?: string }).generationMode ===
              "safe",
        );
        sendUserMessage(client as WebSocket, CONVERSATION_ID, "again");
        await collector.next(
          (e) => isTerminalEvent(e) && terminalCount(collector) === 2,
        );
        expect(
          collector.events.filter((e) => e.type === "permission_request"),
        ).toHaveLength(1);
      },
      TEST_TIMEOUT_MS,
    );
  },
);
