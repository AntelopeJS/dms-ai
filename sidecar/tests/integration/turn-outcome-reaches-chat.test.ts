import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { CLAUDE_TERMINAL_REASON_MESSAGES } from "../../src/constants/claude.js";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import {
  CLAUDE_FIXTURE,
  claudeScript,
  PROVIDER_FIXTURES,
} from "../helpers/provider-fixtures.js";
import {
  answerPermission,
  collectUntil,
  isTerminal,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-outcome-1";
const RUN_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

function isRunDone(msg: WireMessage): boolean {
  return msg.type === "run_done";
}

function isSnapshot(msg: WireMessage): boolean {
  return msg.type === "conversation_snapshot";
}

interface Session {
  harness: WsHarness;
  client: WebSocket;
}

async function runTurn(
  session: Session,
  until: (msg: WireMessage) => boolean,
): Promise<WireMessage[]> {
  const collected = collectUntil(session.client, {
    timeoutMs: RUN_TIMEOUT_MS,
    until,
    onMessage: (msg, socket) => {
      if (msg.type !== "permission_request") return;
      answerPermission(socket, msg, PERMISSION_DECISIONS.ALLOW_ONCE);
    },
  });
  sendHello(session.client, CONVERSATION_ID);
  sendUserMessage(session.client, CONVERSATION_ID, "reproduce the mockup");
  return collected;
}

async function reload(session: Session): Promise<WireMessage> {
  session.client.close();
  session.client = await openChat(session.harness.port);
  const collected = collectUntil(session.client, {
    timeoutMs: RUN_TIMEOUT_MS,
    until: isSnapshot,
  });
  sendHello(session.client, CONVERSATION_ID);
  const events = await collected;
  return events.find(isSnapshot) as WireMessage;
}

function snapshotErrors(snapshot: WireMessage): unknown[] {
  const messages = snapshot.messages as { role: string; content: string }[];
  return messages.filter((message) => message.role === "error");
}

describe.each(PROVIDER_FIXTURES)(
  "a failed turn reaches the chat on $name",
  (fixture) => {
    let session: Session | undefined;

    afterEach(async () => {
      session?.client.close();
      fixture.reset();
      await session?.harness.close();
      session = undefined;
    });

    it(
      "arrives as run_error, and is still there after a reload",
      async () => {
        fixture.use("failing");
        const harness = await startWsHarness({ provider: fixture.name });
        session = { harness, client: await openChat(harness.port) };
        const events = await runTurn(session, isTerminal);
        const failure = events.find((event) => event.type === "run_error");
        expect(failure?.error).toEqual(expect.any(String));
        const snapshot = await reload(session);
        expect(snapshotErrors(snapshot)).toEqual([
          expect.objectContaining({ role: "error", content: failure?.error }),
        ]);
      },
      TEST_TIMEOUT_MS,
    );
  },
);

describe("what the chat learns about a claude turn", () => {
  let session: Session | undefined;

  afterEach(async () => {
    session?.client.close();
    CLAUDE_FIXTURE.reset();
    await session?.harness.close();
    session = undefined;
  });

  async function start(script: string): Promise<Session> {
    CLAUDE_FIXTURE.use("plain");
    process.env.MOCK_CLAUDE_SCRIPT = claudeScript(script);
    const harness = await startWsHarness({ provider: "claude" });
    return { harness, client: await openChat(harness.port) };
  }

  it(
    "gets the reason when the prompt no longer fits in the context",
    async () => {
      session = await start("prompt-too-long.json");
      const events = await runTurn(session, isRunDone);
      expect(events.filter((event) => event.type === "run_error")).toEqual([
        expect.objectContaining({
          error: CLAUDE_TERMINAL_REASON_MESSAGES.prompt_too_long,
        }),
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "sees the agent composing a file while nothing else is streamed",
    async () => {
      session = await start("long-tool-input.json");
      const events = await runTurn(session, isRunDone);
      const progress = events.filter((event) => event.type === "run_progress");
      expect(progress).toContainEqual(
        expect.objectContaining({ activity: "writing", detail: "Write" }),
      );
      expect(events.some((event) => event.type === "run_error")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "is not told that a turn the user stopped failed",
    async () => {
      session = await start("stopped.json");
      const events = await runTurn(session, isRunDone);
      expect(events.some((event) => event.type === "run_error")).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
