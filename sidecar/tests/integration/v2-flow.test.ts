import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { PERMISSION_DECISIONS } from "../../src/constants/permissions.js";
import {
  answerPermission,
  callApi,
  createCollector,
  isTerminal,
  openChat,
  sendHello,
  sendUserMessage,
  sendWire,
  startWsHarness,
  type WireCollector,
  type WireMessage,
  type WsHarness,
} from "../helpers/ws-harness.js";

const SCRIPTS = resolve(import.meta.dirname, "../fixtures/mock-claude/scripts");
const CONVERSATION_ID = "conv-v2";
const WAIT_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;
const EDITED_FILE = "src/pages/home.vue";

function useScript(name: string): void {
  process.env.MOCK_CLAUDE = "1";
  process.env.MOCK_CLAUDE_SCRIPT = join(SCRIPTS, name);
}

interface Session {
  harness: WsHarness;
  client: WebSocket;
  collector: WireCollector;
}

const terminalCount = (collector: WireCollector) =>
  collector.events.filter(isTerminal).length;

async function open(withProject = true): Promise<Session> {
  const harness = await startWsHarness({
    provider: "claude",
    withProject,
    settings: { generationMode: "vibe" },
  });
  const client = await openChat(harness.port);
  const collector = createCollector(client, WAIT_TIMEOUT_MS);
  sendWire(client, { type: "actor", userId: "u1", name: "Camille" });
  sendHello(client, CONVERSATION_ID);
  return { harness, client, collector };
}

async function waitTurns(session: Session, count: number) {
  return session.collector.next(
    (e) => isTerminal(e) && terminalCount(session.collector) >= count,
  );
}

async function json<T>(response: Response): Promise<T> {
  expect(response.ok).toBe(true);
  return (await response.json()) as T;
}

describe("v2 assistant flow over the socket", () => {
  let session: Session | undefined;

  afterEach(async () => {
    session?.client.close();
    await session?.harness.close();
    session = undefined;
    delete process.env.MOCK_CLAUDE;
    delete process.env.MOCK_CLAUDE_SCRIPT;
  });

  it(
    "records an approved edit as a change set that can be undone",
    async () => {
      useScript("edit-file.json");
      session = await open();
      const { harness, client, collector } = session;
      const file = join(harness.projectRoot, EDITED_FILE);
      await mkdir(join(harness.projectRoot, "src", "pages"), {
        recursive: true,
      });
      await writeFile(file, "<p>Hello</p>\n");
      sendUserMessage(client, CONVERSATION_ID, "Say hello to the world");
      const prompt = await collector.next(
        (e) => e.type === "permission_request",
      );
      expect(prompt).toMatchObject({ kind: "edit", alwaysAsk: false });
      expect((prompt.ruleOptions as WireMessage[]).map((r) => r.kind)).toEqual([
        "file",
        "directory",
      ]);
      await writeFile(file, "<p>Hello world</p>\n");
      answerPermission(client, prompt, PERMISSION_DECISIONS.ALLOW_ONCE);
      const end = await collector.next((e) => e.type === "tool_call_end");
      expect(end).toMatchObject({ outcome: "done", allowedBy: "approved" });
      const changeSetEvent = await collector.next(
        (e) => e.type === "change_set",
      );
      const changeSet = changeSetEvent.changeSet as WireMessage;
      expect(changeSet).toMatchObject({
        number: 1,
        title: "Say hello to the world",
        askedBy: "Camille",
        approvalsNeeded: 1,
        agent: "claude",
        scope: "vibe",
        state: "applied",
      });
      await collector.next((e) => e.type === "usage");

      const activity = await json<{ results: WireMessage[]; total: number }>(
        await callApi(harness.port, "/activity?category=changed"),
      );
      expect(activity.results[0]).toMatchObject({
        tool: "Edit",
        allowedBy: "approved",
        result: "done",
        changeSetId: changeSet.id,
        changeSetNumber: 1,
      });
      expect(activity.results[0]?.category).toEqual(["changed", "asked"]);
      const detail = await json<WireMessage>(
        await callApi(
          harness.port,
          `/activity/${encodeURIComponent(activity.results[0]?.id as string)}`,
        ),
      );
      expect(
        (detail.decisionTrail as WireMessage[]).map((s) => s.label),
      ).toContain("Asked you");
      expect(detail.diff).toHaveLength(1);
      const relayedId = encodeURIComponent(
        encodeURIComponent(activity.results[0]?.id as string),
      );
      const relayed = await callApi(harness.port, `/activity/${relayedId}`);
      expect(relayed.status).toBe(200);
      const malformed = await callApi(harness.port, "/activity/%E0%A4%A");
      expect(malformed.status).toBe(400);

      const preview = await json<WireMessage>(
        await callApi(
          harness.port,
          `/changes/${changeSet.id as string}/undo-preview`,
        ),
      );
      expect(preview).toMatchObject({ files: [EDITED_FILE], conflicts: [] });
      const undone = await json<WireMessage>(
        await callApi(harness.port, `/changes/${changeSet.id as string}/undo`, {
          method: "POST",
          body: JSON.stringify({ actor: "Camille" }),
        }),
      );
      expect(undone.undone).toEqual([changeSet.id]);
      expect(await readFile(file, "utf8")).toBe("<p>Hello</p>\n");
      const again = await callApi(
        harness.port,
        `/changes/${changeSet.id as string}/undo`,
        {
          method: "POST",
        },
      );
      expect(again.status).toBe(409);
      const changes = await json<{ results: WireMessage[] }>(
        await callApi(harness.port, "/changes?scope=vibe"),
      );
      expect(changes.results[0]).toMatchObject({
        state: "undone",
        stateChangedBy: "Camille",
      });
      const approved = await json<WireMessage>(
        await callApi(harness.port, "/metrics/kpi/approved"),
      );
      expect(approved).toMatchObject({ value: 1, total: 1 });
      const status = await json<WireMessage>(
        await callApi(harness.port, "/status"),
      );
      expect(status).toMatchObject({
        status: "ready",
        checkpointsAvailable: true,
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Full auto for one turn answers for the user, then ends with a notice",
    async () => {
      useScript("permission-required.json");
      session = await open(false);
      const { client, collector } = session;
      sendWire(client, {
        type: "set_conversation_mode",
        conversationId: CONVERSATION_ID,
        fullAuto: { duration: "turn" },
      });
      await collector.next(
        (e) => e.type === "conversation_mode" && e.fullAuto !== null,
      );
      sendUserMessage(client, CONVERSATION_ID, "run it");
      const end = await collector.next((e) => e.type === "tool_call_end");
      expect(end).toMatchObject({ outcome: "done", allowedBy: "full_auto" });
      await waitTurns(session, 1);
      const notice = await collector.next((e) => e.type === "notice");
      expect(notice.notice).toMatchObject({ kind: "full_auto_ended" });
      expect(
        collector.events.some((e) => e.type === "permission_request"),
      ).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "still asks for a dependency in Full auto, and deny_all stops the turn",
    async () => {
      useScript("add-dependency.json");
      session = await open(false);
      const { client, collector } = session;
      sendWire(client, {
        type: "set_conversation_mode",
        conversationId: CONVERSATION_ID,
        fullAuto: { duration: "chat" },
      });
      sendUserMessage(client, CONVERSATION_ID, "add jsvat");
      const prompt = await collector.next(
        (e) => e.type === "permission_request",
      );
      expect(prompt).toMatchObject({ alwaysAsk: true, ruleOptions: [] });
      expect(prompt.preview).toMatchObject({ effect: "adds_dependency" });
      answerPermission(client, prompt, PERMISSION_DECISIONS.DENY_ALL);
      await collector.next((e) => e.type === "permission_resolved");
      await waitTurns(session, 1);
      const activity = await json<{ results: WireMessage[] }>(
        await callApi(session.harness.port, "/activity?category=denied"),
      );
      expect(activity.results[0]).toMatchObject({
        tool: "Bash",
        allowedBy: "denied",
      });
      sendWire(client, {
        type: "leave_conversation",
        conversationId: CONVERSATION_ID,
      });
      await collector.next(
        (e) => e.type === "conversation_mode" && e.fullAuto === null,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps a command rule for the chat and lets the user revoke it",
    async () => {
      useScript("permission-required.json");
      session = await open(false);
      const { client, collector } = session;
      sendUserMessage(client, CONVERSATION_ID, "first");
      const prompt = await collector.next(
        (e) => e.type === "permission_request",
      );
      answerPermission(
        client,
        prompt,
        PERMISSION_DECISIONS.ALLOW_RULE,
        (prompt.ruleOptions as unknown[])[0],
      );
      const state = await collector.next(
        (e) => e.type === "rules_state" && (e.rules as unknown[]).length === 1,
      );
      await waitTurns(session, 1);
      sendUserMessage(client, CONVERSATION_ID, "again");
      await waitTurns(session, 2);
      const ends = collector.events.filter((e) => e.type === "tool_call_end");
      expect(ends.map((e) => e.allowedBy)).toEqual(["approved", "rule"]);
      const [rule] = state.rules as WireMessage[];
      sendWire(client, {
        type: "revoke_rule",
        conversationId: CONVERSATION_ID,
        ruleId: rule?.id,
      });
      await collector.next(
        (e) => e.type === "rules_state" && (e.rules as unknown[]).length === 0,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "passes the user's suggestion to the agent and retries the last request",
    async () => {
      useScript("permission-required.json");
      session = await open(false);
      const { harness, client, collector } = session;
      sendUserMessage(client, CONVERSATION_ID, "run it");
      const prompt = await collector.next(
        (e) => e.type === "permission_request",
      );
      sendWire(client, {
        type: "permission_response",
        conversationId: CONVERSATION_ID,
        requestId: prompt.requestId,
        decision: "deny",
        feedback: "use pnpm instead",
      });
      await waitTurns(session, 1);
      sendWire(client, { type: "retry_turn", conversationId: CONVERSATION_ID });
      await collector.next(
        (e) =>
          e.type === "permission_request" && e.requestId !== prompt.requestId,
      );
      const users = harness.conversationStore
        .get(CONVERSATION_ID)
        ?.messages.filter((m) => m.role === "user");
      expect(users).toHaveLength(1);
      const permission = harness.conversationStore
        .get(CONVERSATION_ID)
        ?.messages.find((m) => m.role === "permission");
      expect(permission).toMatchObject({
        feedback: "use pnpm instead",
        allowedBy: "denied",
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "edits, reorders and clears queued follow-ups",
    async () => {
      useScript("permission-required.json");
      session = await open(false);
      const { client, collector } = session;
      sendUserMessage(client, CONVERSATION_ID, "run it");
      const prompt = await collector.next(
        (e) => e.type === "permission_request",
      );
      for (const id of ["a", "b", "c"]) {
        sendWire(client, {
          type: "queue_enqueue",
          conversationId: CONVERSATION_ID,
          item: { id, content: id },
        });
      }
      const queueOf = (e: WireMessage) =>
        (e.items as WireMessage[]).map((i) => i.content).join("");
      await collector.next(
        (e) => e.type === "queue_state" && queueOf(e) === "abc",
      );
      sendWire(client, {
        type: "queue_update",
        conversationId: CONVERSATION_ID,
        id: "b",
        content: "B",
      });
      await collector.next(
        (e) => e.type === "queue_state" && queueOf(e) === "aBc",
      );
      sendWire(client, {
        type: "queue_move",
        conversationId: CONVERSATION_ID,
        id: "c",
        toIndex: 0,
      });
      await collector.next(
        (e) => e.type === "queue_state" && queueOf(e) === "caB",
      );
      sendWire(client, {
        type: "queue_clear",
        conversationId: CONVERSATION_ID,
      });
      await collector.next(
        (e) => e.type === "queue_state" && queueOf(e) === "",
      );
      answerPermission(client, prompt, PERMISSION_DECISIONS.DENY);
      await waitTurns(session, 1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "lists the chat as running with its pending approval, and snapshots its mode",
    async () => {
      useScript("permission-required.json");
      session = await open(false);
      const { client, collector } = session;
      sendUserMessage(client, CONVERSATION_ID, "run it");
      const prompt = await collector.next(
        (e) => e.type === "permission_request",
      );
      const list = await collector.next(
        (e) =>
          e.type === "conversation_list" &&
          (e.conversations as WireMessage[]).some(
            (c) => c.pendingApprovals === 1,
          ),
      );
      expect((list.conversations as WireMessage[])[0]).toMatchObject({
        id: CONVERSATION_ID,
        isRunning: true,
        provider: "claude",
        generationMode: "vibe",
      });
      answerPermission(client, prompt, PERMISSION_DECISIONS.ALLOW_ONCE);
      await waitTurns(session, 1);
      const reloaded = await openChat(session.harness.port);
      const snapshots = createCollector(reloaded, WAIT_TIMEOUT_MS);
      sendHello(reloaded, CONVERSATION_ID);
      const snapshot = await snapshots.next(
        (e) => e.type === "conversation_snapshot",
      );
      expect(snapshot.mode).toMatchObject({
        mode: "normal",
        generationMode: "vibe",
        fullAuto: null,
      });
      const roles = (snapshot.messages as WireMessage[]).map((m) => m.role);
      expect(roles).not.toContain("permission");
      const result = (snapshot.messages as WireMessage[]).find(
        (m) => m.role === "tool_result",
      );
      expect(result).toMatchObject({ outcome: "done", allowedBy: "approved" });
      reloaded.close();
    },
    TEST_TIMEOUT_MS,
  );
});
