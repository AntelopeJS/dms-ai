import { afterEach, describe, expect, it, vi } from "vitest";
import { createBuilderClient } from "../../src/builder/builder-client.js";
import {
  BUILDER_FETCH_TIMEOUT_MS,
  BUILDER_SLOW_OP_TIMEOUTS_MS,
} from "../../src/constants/builder.js";

const BASE_URL = "http://localhost:5010";

function answerAfter(ms: number): typeof fetch {
  return (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify({ ok: true, data: null, changes: [] })),
          ),
        ms,
      );
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("The operation was aborted"));
      });
    });
}

describe("createBuilderClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives up on an ordinary operation after the default wait", async () => {
    vi.useFakeTimers();
    const client = createBuilderClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: answerAfter(BUILDER_FETCH_TIMEOUT_MS + 1_000),
      logger: { warn: () => {} },
    });
    const pending = client.call("ListPages", []);
    await vi.advanceTimersByTimeAsync(BUILDER_FETCH_TIMEOUT_MS + 1_000);
    expect(await pending).toMatchObject({ ok: false });
  });

  it("waits for MapResources, which writes and typechecks a whole batch, past the default wait", async () => {
    vi.useFakeTimers();
    const client = createBuilderClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: answerAfter(BUILDER_FETCH_TIMEOUT_MS * 8),
      logger: { warn: () => {} },
    });
    const pending = client.call("MapResources", [{}]);
    await vi.advanceTimersByTimeAsync(BUILDER_FETCH_TIMEOUT_MS * 8);
    expect(await pending).toMatchObject({ ok: true });
    expect(BUILDER_SLOW_OP_TIMEOUTS_MS.get("MapResources")).toBeGreaterThan(
      BUILDER_FETCH_TIMEOUT_MS * 8,
    );
  });

  it("names an operation the backend route does not know, instead of an opaque HTTP 400", async () => {
    const client = createBuilderClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "unknown_op", op: "X" }), {
          status: 400,
        }),
      logger: { warn: () => {} },
    });
    expect(await client.call("PreviewMapResources", [{}])).toEqual({
      ok: false,
      error: { code: "unknown_op", detail: "PreviewMapResources" },
    });
  });

  it("keeps the status for any other refusal", async () => {
    const client = createBuilderClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: async () => new Response("nope", { status: 400 }),
      logger: { warn: () => {} },
    });
    expect(await client.call("ListPages", [])).toEqual({
      ok: false,
      error: { code: "request_failed", detail: "HTTP 400" },
    });
  });
});
