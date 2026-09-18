import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  CODEX_REQUEST_TIMEOUT_MESSAGE,
  CODEX_TRANSPORT_CLOSED_MESSAGE,
} from "../../src/constants/codex.js";
import {
  type CodexClient,
  createCodexClient,
} from "../../src/providers/codex/client.js";

const ABORT_REASON = "gone";
const SHORT_TIMEOUT_MS = 20;
const SETTLE_BUDGET_MS = 500;

interface Harness {
  client: CodexClient;
  stdout: PassThrough;
  /** Frames the client wrote, as parsed objects. */
  sent: () => Record<string, unknown>[];
}

function harness(): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: Record<string, unknown>[] = [];
  stdin.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim() === "") continue;
      written.push(JSON.parse(line) as Record<string, unknown>);
    }
  });
  const client = createCodexClient(stdin, stdout, {
    onNotification: () => {},
    onServerRequest: async () => ({}),
  });
  return { client, stdout, sent: () => written };
}

function settles<T>(promise: Promise<T>): Promise<string> {
  return Promise.race([
    promise.then(() => "resolved").catch((err: Error) => err.message),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve("still pending"), SETTLE_BUDGET_MS),
    ),
  ]);
}

describe("codex client end-of-life", () => {
  it("fails an in-flight request when the transport closes", async () => {
    const { client, stdout } = harness();
    const inFlight = client.request("initialize", {});
    stdout.end();
    await expect(settles(inFlight)).resolves.toBe(
      CODEX_TRANSPORT_CLOSED_MESSAGE,
    );
  });

  it("fails every request made after an abort, without writing it out", async () => {
    const { client, sent } = harness();
    client.abort(new Error(ABORT_REASON));
    await expect(settles(client.request("thread/start", {}))).resolves.toBe(
      ABORT_REASON,
    );
    expect(sent()).toEqual([]);
  });

  it("keeps the first reason when the child dies twice over", async () => {
    const { client, stdout } = harness();
    const inFlight = client.request("initialize", {});
    client.abort(new Error(ABORT_REASON));
    stdout.end();
    await expect(settles(inFlight)).resolves.toBe(ABORT_REASON);
  });
});

describe("codex client request timeout", () => {
  it("fails a bounded request the server never answers", async () => {
    const { client } = harness();
    const inFlight = client.request(
      "skills/list",
      {},
      {
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    );
    await expect(settles(inFlight)).resolves.toBe(
      CODEX_REQUEST_TIMEOUT_MESSAGE,
    );
  });

  it("leaves an unbounded request pending, so a long turn is never cut here", async () => {
    const { client } = harness();
    await expect(settles(client.request("turn/start", {}))).resolves.toBe(
      "still pending",
    );
  });

  it("does not fire the timeout once the answer has landed", async () => {
    const { client, stdout } = harness();
    const inFlight = client.request(
      "skills/list",
      {},
      {
        timeoutMs: SHORT_TIMEOUT_MS,
      },
    );
    stdout.write(`${JSON.stringify({ id: 1, result: { data: [] } })}\n`);
    await expect(settles(inFlight)).resolves.toBe("resolved");
  });
});
