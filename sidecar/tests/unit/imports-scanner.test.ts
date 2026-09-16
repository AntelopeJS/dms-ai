import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createImportsScanner,
  scanImports,
} from "../../src/pages/imports-scanner.js";

const TMP_PREFIX = "dms-ai-scanner-";

interface Harness {
  dir: string;
}

async function makeHarness(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), TMP_PREFIX));
  return { dir };
}

async function writeNested(
  root: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const full = join(root, relativePath);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, content);
  return full;
}

async function buildSampleProject(root: string): Promise<{
  button: string;
  pageA: string;
  pageB: string;
  pageC: string;
}> {
  const button = await writeNested(
    root,
    "components/Button.vue",
    "<template><button/></template>",
  );
  const pageA = await writeNested(
    root,
    "pages/PageA.vue",
    `<script setup>\nimport Button from "../components/Button.vue";\n</script>`,
  );
  const pageB = await writeNested(
    root,
    "pages/PageB.vue",
    `<script setup>\nimport Button from "../components/Button.vue";\n</script>`,
  );
  const pageC = await writeNested(
    root,
    "pages/PageC.vue",
    `<script setup>\nimport Button from "../components/Button.vue";\n</script>`,
  );
  return { button, pageA, pageB, pageC };
}

describe("scanImports", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.dir, { recursive: true, force: true });
  });

  it("builds a reverse importers map for shared components", async () => {
    const { button, pageA, pageB, pageC } = await buildSampleProject(
      harness.dir,
    );
    const result = await scanImports(harness.dir);
    const importers = result.importersByFile.get(button) ?? [];
    expect(importers).toHaveLength(3);
    expect(importers).toEqual(expect.arrayContaining([pageA, pageB, pageC]));
  });

  it("ignores files inside node_modules and dist", async () => {
    await buildSampleProject(harness.dir);
    await writeNested(
      harness.dir,
      "node_modules/somepkg/index.js",
      `import "../../components/Button.vue";`,
    );
    await writeNested(
      harness.dir,
      "dist/page-bundle.js",
      `import "../components/Button.vue";`,
    );
    const result = await scanImports(harness.dir);
    const button = join(harness.dir, "components/Button.vue");
    const importers = result.importersByFile.get(button) ?? [];
    expect(importers).toHaveLength(3);
  });

  it("resolves directory imports via index files", async () => {
    const target = await writeNested(
      harness.dir,
      "lib/utils/index.ts",
      "export const x = 1;",
    );
    const importer = await writeNested(
      harness.dir,
      "pages/Home.vue",
      `<script setup>\nimport { x } from "../lib/utils";\n</script>`,
    );
    const result = await scanImports(harness.dir);
    const importers = result.importersByFile.get(target) ?? [];
    expect(importers).toContain(importer);
  });
});

describe("createImportsScanner", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await rm(harness.dir, { recursive: true, force: true });
  });

  it("caches results per root directory", async () => {
    await buildSampleProject(harness.dir);
    const scanner = createImportsScanner();
    const a = await scanner.scan(harness.dir);
    const b = await scanner.scan(harness.dir);
    expect(b).toBe(a);
  });

  it("invalidate forces a rescan", async () => {
    await buildSampleProject(harness.dir);
    const scanner = createImportsScanner();
    const a = await scanner.scan(harness.dir);
    scanner.invalidate();
    const b = await scanner.scan(harness.dir);
    expect(b).not.toBe(a);
  });
});
