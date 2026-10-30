import { describe, expect, it, vi } from "vitest";
import { createLogsClient } from "../../src/logs/logs-client.js";
import type { BufferedLog } from "../../src/logs/types.js";

const BASE_URL = "http://localhost:5010";

function jsonResponse(body: BufferedLog[], status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildLog(): BufferedLog {
  return { time: 1, channel: "loader.hot-reload", levelId: 40, args: ["boom"] };
}

describe("createLogsClient", () => {
  it("encodes query params into the request URL", async () => {
    let seenUrl: Parameters<typeof fetch>[0] = "";
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      seenUrl = url;
      return jsonResponse([buildLog()]);
    });
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      fetchImpl,
    });
    const logs = await client.getLogs({ since: 100, level: 40, limit: 5 });
    expect(logs).toHaveLength(1);
    expect(seenUrl).toContain("/ai/logs?");
    expect(seenUrl).toContain("since=100");
    expect(seenUrl).toContain("level=40");
    expect(seenUrl).toContain("limit=5");
  });

  it("returns [] (best-effort) when the backend is unreachable", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("boom");
    });
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      fetchImpl,
      logger: { warn: () => {} },
    });
    expect(await client.getLogs({})).toEqual([]);
  });

  it("sends the shared-secret auth header when a token is set", async () => {
    let seenHeaders: RequestInit["headers"];
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      seenHeaders = init?.headers;
      return jsonResponse([]);
    });
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      token: "secret-123",
      fetchImpl,
    });
    await client.getLogs({});
    expect(new Headers(seenHeaders).get("x-dms-ai-token")).toBe("secret-123");
  });

  it("returns [] on a non-ok response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([], 500));
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      fetchImpl,
      logger: { warn: () => {} },
    });
    expect(await client.getLogs({})).toEqual([]);
  });

  it("hands a log argument back as the backend sent it, an own __proto__ key included", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          '[{"time":1,"channel":"c","levelId":40,"args":[{"__proto__":{"x":1}},"text",1e999]}]',
        ),
    );
    const client = createLogsClient({ backendBaseUrl: BASE_URL, fetchImpl });
    const [log] = await client.getLogs({});
    expect(Object.getOwnPropertyNames(log?.args[0])).toEqual(["__proto__"]);
    expect(log?.args.slice(1)).toEqual(["text", Number.POSITIVE_INFINITY]);
  });
});
