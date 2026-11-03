const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { z } = require("zod");

/**
 * The lock file this stand-in for the sidecar's entry point claims in its
 * working directory. Like the real sidecar it answers /health, removes the lock
 * and exits gracefully on a shutdown signal. `FAKE_SIDECAR_MODE=crash` exits
 * with a failure before it claims the lock, as a sidecar whose build is
 * missing does; `silent` stays up and never claims it, leaving its pid in `silent.pid`
 * for the test to stop.
 */
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
const MODE = process.env.FAKE_SIDECAR_MODE;
const KEEP_ALIVE_MS = 60_000;
const SILENT_PID_PATH = path.join(process.cwd(), "silent.pid");

const LockSchema = z.object({ pid: z.number() });
const AddressSchema = z.object({ port: z.number() });

const buildIdIndex = process.argv.indexOf(BUILD_ID_FLAG);
const buildId = buildIdIndex === -1 ? "" : process.argv[buildIdIndex + 1];

function removeOwnLock() {
  try {
    const lock = LockSchema.parse(
      JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")),
    );
    if (lock.pid === process.pid) fs.rmSync(LOCK_PATH);
  } catch {
    return;
  }
}

function shutdown() {
  removeOwnLock();
  process.exit(0);
}

/** @param {number} port */
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
if (MODE === "crash") process.exit(1);
if (MODE === "silent") {
  fs.writeFileSync(SILENT_PID_PATH, String(process.pid));
  setInterval(() => undefined, KEEP_ALIVE_MS);
} else {
  server.listen(0, "127.0.0.1", () =>
    writeLock(AddressSchema.parse(server.address()).port),
  );
}

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, IGNORES_SHUTDOWN ? () => undefined : shutdown);
}
