const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { afterEach, test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  INTRUDER,
  OWNER,
  closeEverything,
  delay,
  dist,
  fakeContext,
  openOn,
  startSidecar,
} = require("./helpers/channels.cjs");

const { openBridges } = require(dist("channels/bridge.js"));
const { openChannel } = require(dist("channels/channel-service.js"));
const { reserveMessageBytes } = require(dist("channels/message-budget.js"));
const {
  CHANNEL_MAX_SOCKETS_PER_USER,
  CHANNEL_MESSAGE_MAX_BYTES,
  CHANNEL_PENDING_MESSAGES_MAX_BYTES,
} = require(dist("constants/channels.js"));

afterEach(closeEverything);

void test("refuses a user more sidecar sockets than the cap, not another user", async () => {
  const sidecar = await startSidecar();
  const streamsAllowed = CHANNEL_MAX_SOCKETS_PER_USER / 2;
  for (let i = 0; i < streamsAllowed; i += 1)
    await openOn(sidecar, "host,chat");
  const refused = await openChannel(
    fakeContext().ctx,
    "host,chat",
    OWNER,
    sidecar.connect,
  );
  assert.ok(refused instanceof HTTPResult);
  assert.equal(refused.getStatus(), 429);
  assert.equal(sidecar.paths.length, CHANNEL_MAX_SOCKETS_PER_USER);
  await openOn(sidecar, "chat", INTRUDER);
});

function messageContext(contentLength) {
  const headers =
    contentLength === undefined
      ? {}
      : { "content-length": String(contentLength) };
  const rawResponse = new EventEmitter();
  return { rawRequest: { headers }, rawResponse };
}

void test("refuses a posted message once the memory budget is spent, until one ends", () => {
  const fullMessages =
    CHANNEL_PENDING_MESSAGES_MAX_BYTES / CHANNEL_MESSAGE_MAX_BYTES;
  const held = Array.from({ length: fullMessages }, () => messageContext());
  for (const context of held) reserveMessageBytes(context);
  assert.throws(
    () => reserveMessageBytes(messageContext(1)),
    (error) => error instanceof HTTPResult && error.getStatus() === 429,
  );
  held[0].rawResponse.emit("close");
  const next = messageContext(1);
  reserveMessageBytes(next);
  for (const context of [...held.slice(1), next])
    context.rawResponse.emit("close");
});

void test("pauses a sidecar socket once per full sink, however many frames arrive", async () => {
  const sidecar = await startSidecar();
  const socket = await sidecar.connect("/ws/iframe");
  const drains = [];
  const stream = {
    send: (name) => name === "ready",
    onDrain: (listener) => drains.push(listener),
    onClose: () => undefined,
    close: () => undefined,
    isClosed: () => false,
  };
  openBridges({
    userId: OWNER,
    sockets: [{ channel: "chat", socket }],
    stream,
    onOpened: () => undefined,
    onClosed: () => undefined,
  });
  for (const client of sidecar.sockets) {
    for (let i = 0; i < 5; i += 1) client.send(`{"n":${i}}`);
  }
  await delay(50);
  assert.equal(drains.length, 1);
  socket.terminate();
});
