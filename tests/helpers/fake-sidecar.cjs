// Stands in for the sidecar's entry point: it answers /health, claims the lock
// file in its working directory and, like the real one, removes it and exits
// gracefully on a shutdown signal.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const LOCK_PATH = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "dms-ai",
  "sidecar.lock",
);
const BUILD_ID_FLAG = "--build-id";
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
const VERSION = "0.0.0";
const IGNORES_SHUTDOWN = process.env.FAKE_SIDECAR_IGNORE_SHUTDOWN === "1";

const buildIdIndex = process.argv.indexOf(BUILD_ID_FLAG);
const buildId = buildIdIndex === -1 ? "" : process.argv[buildIdIndex + 1];

function removeOwnLock() {
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
    if (lock.pid === process.pid) fs.rmSync(LOCK_PATH);
  } catch {
    return;
  }
}

function shutdown() {
  removeOwnLock();
  process.exit(0);
}

function writeLock(port) {
  const lock = {
    port,
    pid: process.pid,
    version: VERSION,
    buildId,
    startedAt: Date.now(),
  };
  const tempPath = `${LOCK_PATH}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(lock));
  fs.renameSync(tempPath, LOCK_PATH);
}

const server = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, version: VERSION, buildId }));
});
server.listen(0, "127.0.0.1", () => writeLock(server.address().port));

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, IGNORES_SHUTDOWN ? () => undefined : shutdown);
}
