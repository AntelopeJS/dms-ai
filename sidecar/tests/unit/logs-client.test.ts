import { describe, expect, it, vi } from "vitest";
import { createLogsClient } from "../../src/logs/logs-client.js";
import type { BufferedLog } from "../../src/logs/types.js";

const BASE_URL = "http://localhost:5010";

function jsonResponse(body: unknown, status = 200): Response {
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
    let seenUrl = "";
    const fetchImpl = vi.fn(async (url: string) => {
      seenUrl = url;
      return jsonResponse([buildLog()]);
    });
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const logs = await client.getLogs({ since: 100, level: 40, limit: 5 });
    expect(logs).toHaveLength(1);
    expect(seenUrl).toContain("/ai/logs?");
    expect(seenUrl).toContain("since=100");
    expect(seenUrl).toContain("level=40");
    expect(seenUrl).toContain("limit=5");
  });

  it("returns [] (best-effort) when the backend is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn: () => {} },
    });
    expect(await client.getLogs({})).toEqual([]);
  });

  it("sends the shared-secret auth header when a token is set", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return jsonResponse([]);
    });
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      token: "secret-123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.getLogs({});
    expect(seenHeaders?.["x-dms-ai-token"]).toBe("secret-123");
  });

  it("returns [] on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([], 500));
    const client = createLogsClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: { warn: () => {} },
    });
    expect(await client.getLogs({})).toEqual([]);
  });
});
