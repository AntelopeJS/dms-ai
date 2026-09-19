const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { request } = require("node:http");
const { spawn } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const sidecarEntry = path.join(root, "sidecar", "dist", "index.js");

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function waitForPort(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/DMS_AI_SIDECAR_PORT=(\d+)/);
      if (match) resolve(Number(match[1]));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      reject(new Error(`sidecar exited with code ${code}: ${output}`));
    });
  });
}

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/health" }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("playground installation builds the sidecar before startup", () => {
  assert.match(
    readText("playground/antelope.config.ts"),
    /installCommand: \["pnpm install", "pnpm build", "pnpm build:sidecar"\]/,
  );
  assert.match(readText(".agents/setup"), /pnpm build:sidecar/);
});

test("built sidecar starts and serves health", async () => {
  assert.equal(existsSync(sidecarEntry), true);
  const stateRoot = await mkdtemp(path.join(tmpdir(), "dms-ai-sidecar-"));
  const child = spawn(
    process.execPath,
    [sidecarEntry, "--port", "0", "--root", stateRoot],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    const port = await waitForPort(child);
    const response = await requestHealth(port);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body).ok, true);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(stateRoot, { recursive: true, force: true });
  }
});
