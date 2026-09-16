import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensurePluginWrapper } from "../../src/skills/plugin-wrapper.js";

const FIXTURE_SKILLS = path.resolve(__dirname, "../fixtures/skills/dms-ai");

describe("ensurePluginWrapper", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "dms-ai-wrapper-"));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("writes a plugin manifest named after the module", async () => {
    const wrapper = await ensurePluginWrapper(
      { module: "dms-ai", dir: FIXTURE_SKILLS },
      base,
    );
    expect(wrapper.pluginName).toBe("dms-ai");
    const manifestRaw = await readFile(
      path.join(wrapper.pluginPath, ".claude-plugin", "plugin.json"),
      "utf8",
    );
    expect(JSON.parse(manifestRaw).name).toBe("dms-ai");
  });

  it("links the source skills under <wrapper>/skills", async () => {
    const wrapper = await ensurePluginWrapper(
      { module: "dms-ai", dir: FIXTURE_SKILLS },
      base,
    );
    const linked = await realpath(path.join(wrapper.pluginPath, "skills"));
    expect(linked).toBe(await realpath(FIXTURE_SKILLS));
  });

  it("is idempotent across repeated calls", async () => {
    const src = { module: "dms-ai", dir: FIXTURE_SKILLS };
    await ensurePluginWrapper(src, base);
    const wrapper = await ensurePluginWrapper(src, base);
    const linked = await realpath(path.join(wrapper.pluginPath, "skills"));
    expect(linked).toBe(await realpath(FIXTURE_SKILLS));
  });
});
