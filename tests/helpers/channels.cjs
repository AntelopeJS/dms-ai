const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const { HTTPResult } = require("@antelopejs/interface-api");
const { WebSocket, WebSocketServer } = require("ws");
const { z } = require("zod");
const {
  openChannel,
  postChannelMessage,
} = require("../../dist/channels/channel-service.js");
const { closeAllBridges } = require("../../dist/channels/registry.js");

/**
 * @param {string} file
 * @returns {string}
 */
const dist = (file) => path.resolve(__dirname, "../../dist", file);

const OWNER = "owner-1";
const INTRUDER = "owner-2";
/** Pinned here rather than read from the build: it is the sidecar's contract too. */
const SIDECAR_SOCKET_PATH = "/ws";
const WAIT_TIMEOUT_MS = 2_000;
const WAIT_STEP_MS = 10;
const ACTOR_FRAME_TYPE = "actor";
const ActorFrameSchema = z.looseObject({ type: z.literal(ACTOR_FRAME_TYPE) });
const ListeningAddressSchema = z.object({ port: z.number() });
const ReadyDataSchema = z.object({ connectionId: z.string() });

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const byText = (a, b) => a.localeCompare(b);

/**
 * The signed-in user a stream is opened for, as the channel route passes it.
 * @param {string} userId
 */
function actorOf(userId) {
  return { userId, name: `Name of ${userId}` };
}

/**
 * The frame when `text` is the actor frame, which the bridge sends first.
 * @param {string} text
 */
function parseActorFrame(text) {
  try {
    const frame = ActorFrameSchema.safeParse(JSON.parse(text));
    return frame.success ? frame.data : null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} FakeSidecar
 * @property {string[]} received Frames the browser side posted.
 * @property {Array<z.infer<typeof ActorFrameSchema>>} actors Actor frames received.
 * @property {Array<string | undefined>} paths URL path of each connection.
 * @property {import("ws").WebSocket[]} sockets Server-side sockets, in connection order.
 * @property {number} closed Connections closed so far.
 * @property {() => Promise<import("ws").WebSocket>} connect Opens a paused client socket.
 * @property {() => Promise<void>} close Terminates every connection and stops listening.
 */

/** @type {FakeSidecar[]} */
const sidecars = [];

async function closeEverything() {
  closeAllBridges();
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.close()));
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {() => boolean} check
 * @param {string} label
 */
async function waitFor(check, label) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(WAIT_STEP_MS);
  }
  assert.fail(`timed out waiting for ${label}`);
}

/**
 * @param {number} port
 * @returns {Promise<import("ws").WebSocket>}
 */
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

/**
 * @param {import("ws").WebSocketServer} server
 * @returns {number}
 */
function portOf(server) {
  return ListeningAddressSchema.parse(server.address()).port;
}

/**
 * @param {(socket: import("ws").WebSocket) => void} [onConnection]
 * @returns {Promise<FakeSidecar>}
 */
async function startSidecar(onConnection = () => undefined) {
  const server = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  /** @type {FakeSidecar} */
  const sidecar = {
    received: [],
    actors: [],
    paths: [],
    sockets: [],
    closed: 0,
    connect: () => connectTo(portOf(server)),
    close: () => {
      for (const client of server.clients) client.terminate();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
  server.on("connection", (socket, request) => {
    sidecar.sockets.push(socket);
    sidecar.paths.push(request.url);
    socket.on("message", (data) => {
      const text = Buffer.concat([data].flat()).toString("utf8");
      const actor = parseActorFrame(text);
      if (actor) sidecar.actors.push(actor);
      else sidecar.received.push(text);
    });
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

/**
 * @param {string} text
 * @returns {Array<{ name: string; data: string }>}
 */
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

/**
 * @param {FakeSidecar} sidecar
 * @param {string} [userId]
 */
async function openOn(sidecar, userId = OWNER) {
  const context = fakeContext();
  const result = await openChannel(
    context.ctx,
    actorOf(userId),
    sidecar.connect,
  );
  assert.equal(result, undefined);
  context.capture();
  await waitFor(() => parseEvents(context.output.text).length > 0, "ready");
  const ready = parseEvents(context.output.text)[0];
  assert.equal(ready.name, "ready");
  const { connectionId } = ReadyDataSchema.parse(JSON.parse(ready.data));
  return { ...context, connectionId };
}

/**
 * @param {string} connectionId
 * @param {string} body
 * @param {string} [userId]
 */
function post(connectionId, body, userId = OWNER) {
  return postChannelMessage(connectionId, userId, Buffer.from(body));
}

module.exports = {
  OWNER,
  INTRUDER,
  SIDECAR_SOCKET_PATH,
  actorOf,
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
