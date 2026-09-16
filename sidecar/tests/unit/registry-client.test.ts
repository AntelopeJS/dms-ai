import { describe, expect, it, vi } from "vitest";
import { createRegistryClient } from "../../src/pages/registry-client.js";
import type { PagesRegistryEntry } from "../../src/pages/types.js";

const BASE_URL = "http://localhost:5010";

function buildEntries(): PagesRegistryEntry[] {
  return [{ id: "x", path: "/x", moduleId: "dms" }];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createRegistryClient", () => {
  it("fetches and caches the registry within TTL", async () => {
    const entries = buildEntries();
    const fetchImpl = vi.fn(async () => jsonResponse(entries));
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000,
      ttlMs: 30_000,
    });
    const a = await client.getRegistry();
    const b = await client.getRegistry();
    expect(a).toEqual(entries);
    expect(b).toEqual(entries);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refreshes after TTL expires", async () => {
    let nowMs = 0;
    const entries = buildEntries();
    const fetchImpl = vi.fn(async () => jsonResponse(entries));
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => nowMs,
      ttlMs: 30_000,
    });
    await client.getRegistry();
    nowMs = 31_000;
    await client.getRegistry();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to cache on fetch failure", async () => {
    const entries = buildEntries();
    let mustFail = false;
    const fetchImpl = vi.fn(async () => {
      if (mustFail) throw new Error("boom");
      return jsonResponse(entries);
    });
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
      ttlMs: 0,
      logger: { warn: () => {} },
    });
    const a = await client.getRegistry();
    mustFail = true;
    const b = await client.getRegistry();
    expect(b).toEqual(a);
  });

  it("tracks staleSinceMs and warns once on stale fallback", async () => {
    const entries = buildEntries();
    let mustFail = false;
    let nowMs = 1000;
    const fetchImpl = vi.fn(async () => {
      if (mustFail) throw new Error("boom");
      return jsonResponse(entries);
    });
    const warn = vi.fn();
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => nowMs,
      ttlMs: 0,
      logger: { warn },
    });
    await client.getRegistry();
    expect(client.getStaleSinceMs()).toBeNull();
    mustFail = true;
    nowMs = 2000;
    await client.getRegistry();
    expect(client.getStaleSinceMs()).toBe(2000);
    nowMs = 3000;
    await client.getRegistry();
    expect(client.getStaleSinceMs()).toBe(2000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("backend unreachable");
  });

  it("clears staleSinceMs and re-arms warn after recovery", async () => {
    const entries = buildEntries();
    let mustFail = false;
    let nowMs = 1000;
    const fetchImpl = vi.fn(async () => {
      if (mustFail) throw new Error("boom");
      return jsonResponse(entries);
    });
    const warn = vi.fn();
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => nowMs,
      ttlMs: 0,
      logger: { warn },
    });
    await client.getRegistry();
    mustFail = true;
    nowMs = 2000;
    await client.getRegistry();
    expect(client.getStaleSinceMs()).toBe(2000);
    mustFail = false;
    nowMs = 3000;
    await client.getRegistry();
    expect(client.getStaleSinceMs()).toBeNull();
    mustFail = true;
    nowMs = 4000;
    await client.getRegistry();
    expect(client.getStaleSinceMs()).toBe(4000);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("throws when fetch fails and no cache exists", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getRegistry()).rejects.toThrow("boom");
  });

  it("invalidate forces a refetch", async () => {
    const entries = buildEntries();
    const fetchImpl = vi.fn(async () => jsonResponse(entries));
    const client = createRegistryClient({
      backendBaseUrl: BASE_URL,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
      ttlMs: 30_000,
    });
    await client.getRegistry();
    client.invalidate();
    await client.getRegistry();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
