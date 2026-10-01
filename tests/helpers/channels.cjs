const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { HTTPResult } = require("@antelopejs/interface-api");
const { WebSocket, WebSocketServer } = require("ws");

const dist = (file) => path.resolve(__dirname, "../../dist", file);
const { openChannel, postChannelMessage } = require(
  dist("channels/channel-service.js"),
);
const { closeAllBridges } = require(dist("channels/registry.js"));

const OWNER = "owner-1";
const INTRUDER = "owner-2";
/** Pinned here rather than read from the build: it is the sidecar's contract too. */
const SIDECAR_SOCKET_PATH = "/ws";
const WAIT_TIMEOUT_MS = 2_000;
const WAIT_STEP_MS = 10;
const byText = (a, b) => a.localeCompare(b);

const sidecars = [];

async function closeEverything() {
  closeAllBridges();
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.close()));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, label) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(WAIT_STEP_MS);
  }
  assert.fail(`timed out waiting for ${label}`);
}

function connectTo(port) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}${SIDECAR_SOCKET_PATH}`,
    );
    socket.once("open", () => {
      socket.pause();
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

async function startSidecar(onConnection = () => undefined) {
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const sidecar = {
    received: [],
    paths: [],
    sockets: [],
    closed: 0,
    connect: () => connectTo(server.address().port),
    close: () => {
      for (const client of server.clients) client.terminate();
      return new Promise((resolve) => server.close(resolve));
    },
  };
  server.on("connection", (socket, request) => {
    sidecar.sockets.push(socket);
    sidecar.paths.push(request.url);
    socket.on("message", (data) =>
      sidecar.received.push(Buffer.concat([data].flat()).toString("utf8")),
    );
    socket.on("close", () => {
      sidecar.closed += 1;
    });
    onConnection(socket);
  });
  sidecars.push(sidecar);
  return sidecar;
}

function fakeContext() {
  const rawResponse = Object.assign(new EventEmitter(), { closed: false });
  const ctx = {
    response: new HTTPResult(),
    rawRequest: new EventEmitter(),
    rawResponse,
    url: new URL("http://frontend.test/"),
    routeParameters: {},
  };
  const output = { text: "", ended: false };
  const capture = () => {
    const stream = ctx.response.getWriteStream(
      ctx.response.getContentType(),
      ctx.response.getStatus(),
    );
    stream.on("data", (chunk) => {
      output.text += chunk.toString();
    });
    stream.on("end", () => {
      output.ended = true;
    });
  };
  const leave = () => {
    rawResponse.closed = true;
    rawResponse.emit("close");
  };
  return { ctx, output, capture, leave };
}

function parseEvents(text) {
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("event:"))
    .map((block) => {
      const lines = block.split("\n");
      const name = lines[0].slice("event: ".length);
      const data = lines
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice("data: ".length))
        .join("\n");
      return { name, data };
    });
}

async function openOn(sidecar, userId = OWNER) {
  const context = fakeContext();
  const result = await openChannel(context.ctx, userId, sidecar.connect);
  assert.equal(result, undefined);
  context.capture();
  await waitFor(() => parseEvents(context.output.text).length > 0, "ready");
  const ready = parseEvents(context.output.text)[0];
  assert.equal(ready.name, "ready");
  const { connectionId } = JSON.parse(ready.data);
  return { ...context, connectionId };
}

function post(connectionId, body, userId = OWNER) {
  return postChannelMessage(connectionId, userId, Buffer.from(body));
}

module.exports = {
  OWNER,
  INTRUDER,
  SIDECAR_SOCKET_PATH,
  byText,
  closeEverything,
  delay,
  dist,
  fakeContext,
  openOn,
  parseEvents,
  post,
  startSidecar,
  waitFor,
};
