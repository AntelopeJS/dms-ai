import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "../../src/server/http.js";
import type { SkillCatalog } from "../../src/skills/build-catalog.js";
import type { SkillSource } from "../../src/skills/types.js";

const FIXTURE_DIR = resolve(__dirname, "../fixtures/skills/dms-ai");
const ARBITRARY_PORT = 0;
const CLIENT_TOKEN = "skills-test-credential";
const WS_HOST = "127.0.0.1";

interface Handle {
  port: number;
  close: () => Promise<void>;
}

async function startServer(sources: SkillSource[]): Promise<Handle> {
  const { server, port } = await createHttpServer({
    clientToken: CLIENT_TOKEN,
    chatboxDistDir: process.cwd(),
    port: ARBITRARY_PORT,
    getSkillSources: () => sources,
  });
  return {
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}

describe("GET /skills", () => {
  let handle: Handle;

  afterEach(async () => {
    await handle.close();
  });

  it("returns the catalog for the configured skill dirs", async () => {
    handle = await startServer([{ module: "dms-ai", dir: FIXTURE_DIR }]);
    const res = await fetch(`http://${WS_HOST}:${handle.port}/skills`, {
      headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
    });
    expect(res.ok).toBe(true);
    const payload = (await res.json()) as SkillCatalog;
    const pb = payload.items.find((i) => i.name === "page-builder");
    expect(pb).toBeDefined();
    expect(pb?.id).toBe("dms-ai:page-builder");
    expect(pb?.provenance).toBe("dms-ai");
  });

  it("returns an empty catalog when no sources resolve", async () => {
    handle = await startServer([{ module: "ghost", dir: "/does/not/exist" }]);
    const res = await fetch(`http://${WS_HOST}:${handle.port}/skills`, {
      headers: { Authorization: `Bearer ${CLIENT_TOKEN}` },
    });
    expect(res.ok).toBe(true);
    const payload = (await res.json()) as SkillCatalog;
    expect(payload.items).toEqual([]);
  });
});
