const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { afterEach, test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  INTRUDER,
  OWNER,
  actorOf,
  closeEverything,
  delay,
  dist,
  fakeContext,
  openOn,
  startSidecar,
} = require("./helpers/channels.cjs");

const { openBridge } = require(dist("channels/bridge.js"));
const { openChannel } = require(dist("channels/channel-service.js"));
const { reserveMessageBytes } = require(dist("channels/message-budget.js"));
const {
  CHANNEL_MAX_SOCKETS_PER_USER,
  CHANNEL_MESSAGE_MAX_BYTES,
  CHANNEL_PENDING_MESSAGES_MAX_BYTES,
} = require(dist("constants/channels.js"));
const { SIDECAR_UNAVAILABLE_BODY } = require(dist("constants/sidecar.js"));

afterEach(closeEverything);

void test("refuses a user more sidecar sockets than the cap, not another user", async () => {
  const sidecar = await startSidecar();
  for (let i = 0; i < CHANNEL_MAX_SOCKETS_PER_USER; i += 1)
    await openOn(sidecar);
  const refused = await openChannel(
    fakeContext().ctx,
    actorOf(OWNER),
    sidecar.connect,
  );
  assert.ok(refused instanceof HTTPResult);
  assert.equal(refused.getStatus(), 429);
  assert.equal(sidecar.paths.length, CHANNEL_MAX_SOCKETS_PER_USER);
  await openOn(sidecar, INTRUDER);
});

void test("counts a stream still connecting against the cap", async () => {
  const sidecar = await startSidecar();
  for (let i = 0; i < CHANNEL_MAX_SOCKETS_PER_USER - 1; i += 1)
    await openOn(sidecar);
  let release = () => undefined;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const slowConnect = async () => {
    await held;
    return sidecar.connect();
  };
  const pending = openChannel(fakeContext().ctx, actorOf(OWNER), slowConnect);
  const refused = await openChannel(
    fakeContext().ctx,
    actorOf(OWNER),
    sidecar.connect,
  );
  assert.equal(refused.getStatus(), 429);
  release();
  assert.equal(await pending, undefined);
});

void test("answers 503 with the shared sidecar_unavailable body", async () => {
  const result = await openChannel(
    fakeContext().ctx,
    actorOf(OWNER),
    async () => {
      throw new Error("down");
    },
  );
  assert.equal(result.getStatus(), 503);
  assert.deepEqual(result.getBody(), JSON.stringify(SIDECAR_UNAVAILABLE_BODY));
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
  const socket = await sidecar.connect();
  const drains = [];
  const stream = {
    send: (name) => name === "ready",
    onDrain: (listener) => drains.push(listener),
    onClose: () => undefined,
    close: () => undefined,
    isClosed: () => false,
  };
  openBridge({
    actor: actorOf(OWNER),
    socket,
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
