const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const EXPECTED_RELEASE_COMMANDS = [
  "pnpm --dir frontend-vue install --frozen-lockfile",
  "pnpm --dir sidecar install --frozen-lockfile",
  "pnpm --dir sidecar/chatbox install --frozen-lockfile",
  "release-it",
];

test("installs non-workspace projects before reaching release-it", () => {
  const packagePath = path.resolve(__dirname, "../package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.deepEqual(
    packageJson.scripts.release.split(" && "),
    EXPECTED_RELEASE_COMMANDS,
  );
});
