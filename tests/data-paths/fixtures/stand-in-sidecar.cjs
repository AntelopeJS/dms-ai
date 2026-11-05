const { randomBytes } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const { z } = require("zod");

/**
 * The sidecar the data-path suite boots the module with: it claims the lock
 * file the backend polls, answers /health, accepts the backend's WebSocket on
 * /ws with the client token, and keeps every actor frame it receives for the
 * tests to read on GET /actors with the backend token.
 */
const LOCK_PATH = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "dms-ai",
  "sidecar.lock",
);
const SOCKET_PATH = "/ws";
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"];
const TOKEN_BYTES = 24;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;

const token = randomBytes(TOKEN_BYTES).toString("hex");
const clientToken = randomBytes(TOKEN_BYTES).toString("hex");
const OwnLockSchema = z.object({ pid: z.number() });
const AddressSchema = z.object({ port: z.number() });
const FrameSchema = z.looseObject({ type: z.string() });

/** @type {Array<z.infer<typeof FrameSchema>>} */
const actors = [];

function removeOwnLock() {
  try {
    const lock = OwnLockSchema.parse(
      JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")),
    );
    if (lock.pid === process.pid) fs.rmSync(LOCK_PATH);
  } catch {
    return;
  }
}

/** @param {number} port */
function writeLock(port) {
  const lock = {
    port,
    pid: process.pid,
    token,
    clientToken,
    startedAt: Date.now(),
  };
  const tempPath = `${LOCK_PATH}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(lock));
  fs.renameSync(tempPath, LOCK_PATH);
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {object} body
 */
function answer(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") return answer(res, 200, { ok: true });
  if (req.url === "/actors") {
    if (req.headers["x-dms-ai-token"] !== token) {
      return answer(res, HTTP_UNAUTHORIZED, { error: "forbidden" });
    }
    return answer(res, 200, { actors });
  }
  return answer(res, HTTP_NOT_FOUND, { error: "not_found" });
});

const sockets = new WebSocketServer({ noServer: true });
sockets.on("connection", (socket) => {
  socket.on("message", (data) => {
    try {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.from(data);
      const frame = FrameSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (frame.type === "actor") actors.push(frame);
    } catch {
      return;
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  if (
    req.url !== SOCKET_PATH ||
    req.headers.authorization !== `Bearer ${clientToken}`
  ) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  sockets.handleUpgrade(req, socket, head, (ws) =>
    sockets.emit("connection", ws, req),
  );
});

server.listen(0, "127.0.0.1", () =>
  writeLock(AddressSchema.parse(server.address()).port),
);

for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, () => {
    removeOwnLock();
    process.exit(0);
  });
}
