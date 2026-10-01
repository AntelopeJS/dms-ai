import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type WebSocket from "ws";
import { TURN_RESTARTED_MESSAGE } from "../../src/constants/agent.js";
import { createConversationStore } from "../../src/state/conversations.js";
import { createStore } from "../../src/state/store.js";
import type { StoredMessage } from "../../src/state/types.js";
import { PROVIDER_FIXTURES } from "../helpers/provider-fixtures.js";
import {
  createCollector,
  STATE_FILE,
  openChat,
  sendHello,
  sendUserMessage,
  startWsHarness,
  type WsHarness,
} from "../helpers/ws-harness.js";

const CONVERSATION_ID = "conv-cut-by-shutdown";
const QUESTION = "Count from 1 to 40";
const WAIT_TIMEOUT_MS = 20_000;
const TEST_TIMEOUT_MS = 30_000;

async function readPersisted(tmpDir: string): Promise<StoredMessage[]> {
  const store = createConversationStore({
    store: createStore({ filePath: join(tmpDir, STATE_FILE) }),
  });
  await store.loadFromDisk();
  return store.get(CONVERSATION_ID)?.messages ?? [];
}

function visibleTranscript(messages: StoredMessage[]): StoredMessage[] {
  return messages.filter((message) => message.role !== "permission");
}

describe.each(PROVIDER_FIXTURES)(
  "a turn cut short by a shutdown on $name",
  (fixture) => {
    let harness: WsHarness | undefined;
    let client: WebSocket | undefined;

    afterEach(async () => {
      client?.close();
      client = undefined;
      fixture.reset();
      await harness?.close();
      harness = undefined;
    });

    it(
      "leaves a retryable reason after the question once the stores are flushed",
      async () => {
        fixture.use("permission");
        harness = await startWsHarness({ provider: fixture.name });
        client = await openChat(harness.port);
        const events = createCollector(client, WAIT_TIMEOUT_MS);
        sendHello(client, CONVERSATION_ID);
        sendUserMessage(client, CONVERSATION_ID, QUESTION);
        await events.next((event) => event.type === "permission_request");

        const stopping = harness.shutdown();
        client.close();
        await stopping;

        const transcript = visibleTranscript(
          await readPersisted(harness.tmpDir),
        );
        expect(transcript[0]).toMatchObject({
          role: "user",
          content: QUESTION,
        });
        expect(transcript.at(-1)).toMatchObject({
          role: "error",
          content: TURN_RESTARTED_MESSAGE,
          isRetryable: true,
        });
      },
      TEST_TIMEOUT_MS,
    );
  },
);
