import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProjectInfo } from "../../src/host/project-info.js";

const TMP_PREFIX = "dms-ai-pinfo-";
const PACKAGE_FILENAME = "package.json";
const NON_EXISTENT_PATH = "/this/path/does/not/exist/anywhere";
const FALLBACK_NAME = "unknown";
const FALLBACK_VERSION = "0.0.0";

const SAMPLE_PACKAGE = {
  name: "@antelopejs-private/sample-host",
  version: "1.2.3",
  dependencies: {
    "@antelopejs/api": "^1.0.0",
    "@antelopejs/database-postgres": "^1.0.0",
    zod: "^3.0.0",
  },
  devDependencies: {
    "@antelopejs/dms-ai": "^0.1.0",
    typescript: "^5.0.0",
  },
};

const EXPECTED_MODULES = [
  "@antelopejs/api",
  "@antelopejs/database-postgres",
  "@antelopejs/dms-ai",
];

interface Harness {
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  return { dir };
}

async function writePackage(dir: string, contents: unknown): Promise<void> {
  await writeFile(join(dir, PACKAGE_FILENAME), JSON.stringify(contents));
}

describe("readProjectInfo", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.dir, { recursive: true, force: true });
  });

  it("extracts name, version, and antelope modules from package.json", async () => {
    await writePackage(harness.dir, SAMPLE_PACKAGE);
    const info = await readProjectInfo(harness.dir);
    expect(info.name).toBe(SAMPLE_PACKAGE.name);
    expect(info.version).toBe(SAMPLE_PACKAGE.version);
    expect(info.antelopeModules).toEqual(EXPECTED_MODULES);
  });

  it("returns sentinel values when package.json does not exist", async () => {
    const info = await readProjectInfo(NON_EXISTENT_PATH);
    expect(info.name).toBe(FALLBACK_NAME);
    expect(info.version).toBe(FALLBACK_VERSION);
    expect(info.antelopeModules).toEqual([]);
  });

  it("returns sentinel values when package.json contains invalid JSON", async () => {
    await writeFile(join(harness.dir, PACKAGE_FILENAME), "{ not json");
    const info = await readProjectInfo(harness.dir);
    expect(info.name).toBe(FALLBACK_NAME);
    expect(info.version).toBe(FALLBACK_VERSION);
    expect(info.antelopeModules).toEqual([]);
  });

  it("returns empty antelope modules when none match prefixes", async () => {
    await writePackage(harness.dir, {
      name: "plain",
      version: "0.0.1",
      dependencies: { zod: "^3.0.0" },
    });
    const info = await readProjectInfo(harness.dir);
    expect(info.antelopeModules).toEqual([]);
  });
});
