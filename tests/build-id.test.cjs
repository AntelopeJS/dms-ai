const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { computeBuildId } = require(
  path.resolve(__dirname, "../dist/lifecycle/build-id.js"),
);

const BUILD_FILES = {
  "index.js": "console.log('sidecar');\n",
  "index.js.map": '{"version":3}',
  "agent/runner.js": "module.exports = {};\n",
};
const LATER_MTIME = new Date(Date.now() + 60_000);

function writeBuild(distDir, files) {
  fs.rmSync(distDir, { recursive: true, force: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(distDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function touchAll(distDir, files, mtime) {
  for (const relativePath of Object.keys(files)) {
    fs.utimesSync(path.join(distDir, relativePath), mtime, mtime);
  }
}

function withDist(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dms-ai-build-id-"));
  try {
    run(path.join(root, "dist"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

void test("a rebuild with identical content keeps the build id", () => {
  withDist((distDir) => {
    writeBuild(distDir, BUILD_FILES);
    const before = computeBuildId(distDir);
    writeBuild(distDir, BUILD_FILES);
    touchAll(distDir, BUILD_FILES, LATER_MTIME);
    assert.notEqual(before, "");
    assert.equal(computeBuildId(distDir), before);
  });
});

void test("a change of compiled code changes the build id", () => {
  withDist((distDir) => {
    writeBuild(distDir, BUILD_FILES);
    const before = computeBuildId(distDir);
    writeBuild(distDir, {
      ...BUILD_FILES,
      "agent/runner.js": "module.exports = { changed: true };\n",
    });
    assert.notEqual(computeBuildId(distDir), before);
  });
});

void test("a renamed compiled file changes the build id", () => {
  withDist((distDir) => {
    writeBuild(distDir, BUILD_FILES);
    const before = computeBuildId(distDir);
    const { "agent/runner.js": runner, ...rest } = BUILD_FILES;
    writeBuild(distDir, { ...rest, "agent/worker.js": runner });
    assert.notEqual(computeBuildId(distDir), before);
  });
});

void test("files other than compiled code do not affect the build id", () => {
  withDist((distDir) => {
    writeBuild(distDir, BUILD_FILES);
    const before = computeBuildId(distDir);
    writeBuild(distDir, { ...BUILD_FILES, "index.js.map": '{"version":4}' });
    assert.equal(computeBuildId(distDir), before);
  });
});

void test("a missing dist yields an empty build id", () => {
  withDist((distDir) => {
    assert.equal(computeBuildId(distDir), "");
  });
});
