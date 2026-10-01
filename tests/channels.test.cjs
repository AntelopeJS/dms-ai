const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const Module = require("node:module");
const { afterEach, test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  INTRUDER,
  OWNER,
  SIDECAR_SOCKET_PATH,
  byText,
  closeEverything,
  dist,
  fakeContext,
  openOn,
  parseEvents,
  post,
  startSidecar,
  waitFor,
} = require("./helpers/channels.cjs");

const { openBridge } = require(dist("channels/bridge.js"));
const { openChannel } = require(dist("channels/channel-service.js"));
const { closeAllBridges } = require(dist("channels/registry.js"));
const { createSseStream } = require(dist("channels/sse-stream.js"));

afterEach(closeEverything);

void test("streams every sidecar frame as a message event, after a ready event carrying the connection id", async () => {
  const sidecar = await startSidecar((socket) => {
    socket.send('{"type":"settings_update"}');
    socket.send('{"type":"host_command_navigate","path":"/x"}');
  });
  const opened = await openOn(sidecar);
  await waitFor(
    () => parseEvents(opened.output.text).length === 3,
    "relayed frames",
  );
  assert.deepEqual(parseEvents(opened.output.text).slice(1), [
    { name: "message", data: '{"type":"settings_update"}' },
    { name: "message", data: '{"type":"host_command_navigate","path":"/x"}' },
  ]);
  assert.equal(typeof opened.connectionId, "string");
  assert.deepEqual(sidecar.paths, [SIDECAR_SOCKET_PATH]);
});

void test("opens one sidecar socket per stream, for the dashboard and its chat together", async () => {
  const sidecar = await startSidecar();
  await openOn(sidecar);
  await openOn(sidecar);
  assert.deepEqual(sidecar.paths, [SIDECAR_SOCKET_PATH, SIDECAR_SOCKET_PATH]);
});

void test("posts the host's and the chat's messages to the same socket, in order", async () => {
  const sidecar = await startSidecar();
  const { connectionId } = await openOn(sidecar);
  const messages = [
    '{"type":"hello","role":"host"}',
    '{"type":"hello","role":"chat","conversationId":"c-1"}',
    '{"type":"host_state_update","currentPage":{"path":"/"}}',
  ];
  for (const message of messages) {
    assert.equal((await post(connectionId, message)).getStatus(), 204);
  }
  await waitFor(() => sidecar.received.length === 3, "posted frames");
  assert.deepEqual(sidecar.received, messages);
  assert.equal(sidecar.sockets.length, 1);
});

void test("answers 404 to another user's connection id and to an unknown one", async () => {
  const sidecar = await startSidecar();
  const { connectionId } = await openOn(sidecar);
  assert.equal((await post(connectionId, "{}", INTRUDER)).getStatus(), 404);
  assert.equal((await post("nope", "{}")).getStatus(), 404);
  assert.deepEqual(sidecar.received, []);
});

void test("closes the sidecar socket and forgets the stream when the browser leaves", async () => {
  const sidecar = await startSidecar();
  const opened = await openOn(sidecar);
  opened.leave();
  await waitFor(() => sidecar.closed === 1, "sidecar socket closes");
  assert.equal((await post(opened.connectionId, "{}")).getStatus(), 404);
});

void test("sends sidecar_down and ends the stream when the sidecar socket closes", async () => {
  const sidecar = await startSidecar();
  const opened = await openOn(sidecar);
  sidecar.sockets[0].close();
  await waitFor(() => opened.output.ended, "stream end");
  const names = parseEvents(opened.output.text).map((event) => event.name);
  assert.deepEqual(names, ["ready", "sidecar_down"]);
  assert.equal((await post(opened.connectionId, "{}")).getStatus(), 404);
});

void test("closeAllBridges ends every stream and closes every sidecar socket, as destroy() does", async () => {
  const sidecar = await startSidecar();
  const first = await openOn(sidecar);
  const second = await openOn(sidecar);
  closeAllBridges();
  await waitFor(() => first.output.ended && second.output.ended, "streams end");
  await waitFor(() => sidecar.closed === 2, "sidecar sockets close");
  for (const opened of [first, second]) {
    assert.equal((await post(opened.connectionId, "{}")).getStatus(), 404);
  }
  const reopened = await openOn(sidecar);
  const result = await post(reopened.connectionId, '{"after":"reload"}');
  assert.equal(result.getStatus(), 204);
});

void test("leaves nothing open when the browser left during the sidecar handshake", async () => {
  const sidecar = await startSidecar();
  const context = fakeContext();
  const slowConnect = async () => {
    const socket = await sidecar.connect();
    context.leave();
    return socket;
  };
  await openChannel(context.ctx, OWNER, slowConnect);
  await waitFor(() => sidecar.closed === 1, "sidecar socket closes");
});

void test("answers 503 without streaming when the sidecar cannot be reached", async () => {
  const context = fakeContext();
  const result = await openChannel(context.ctx, OWNER, async () => {
    throw new Error("down");
  });
  assert.equal(result.getStatus(), 503);
  assert.equal(context.ctx.response.isStream(), false);
});

void test("pauses the sidecar socket while the stream is full and resumes it on drain", async () => {
  const sidecar = await startSidecar();
  const socket = await sidecar.connect();
  let drain = () => undefined;
  let isFull = false;
  const stream = {
    send: (name) => name === "ready" || !isFull,
    onDrain: (listener) => {
      drain = listener;
    },
    onClose: () => undefined,
    close: () => undefined,
    isClosed: () => false,
  };
  openBridge({
    userId: OWNER,
    socket,
    stream,
    onOpened: () => undefined,
    onClosed: () => undefined,
  });
  isFull = true;
  sidecar.sockets[0].send("{}");
  await waitFor(() => socket.isPaused, "paused socket");
  isFull = false;
  drain();
  assert.equal(socket.isPaused, false);
  socket.close();
});

void test("writes multi-line data as one data line per line", () => {
  const writes = [];
  const sink = {
    write: (chunk) => writes.push(chunk) > 0,
    end: () => undefined,
    once: () => undefined,
  };
  const stream = createSseStream({ sink, onClientGone: () => undefined });
  stream.send("message", "first\nsecond");
  stream.close();
  assert.deepEqual(writes, ["event: message\ndata: first\ndata: second\n\n"]);
});

function loadRoutes(files) {
  const owned = new Set();
  const routes = [];
  const record = (method, location) => (target, key) => {
    routes.push({
      method,
      location: `${target.constructor.location}/${location}`.replace(
        /\/+/g,
        "/",
      ),
      owner: target.constructor,
      key,
    });
  };
  const decorator = () => () => undefined;
  const api = {
    HTTPResult,
    Controller: (location) => {
      class Base {}
      Base.location = location;
      return Base;
    },
    Get: (location) => record("GET", location),
    Post: (location) => record("POST", location),
    Put: (location) => record("PUT", location),
    Context: decorator,
    Parameter: decorator,
    RawBody: decorator,
    JSONBody: decorator,
    SetParameterProvider: () => undefined,
  };
  const auth = {
    AuthOwnerOnly: () => (target) => {
      owned.add(target);
    },
    AuthRawUser: decorator,
  };
  const spawn = {
    ensureSidecarRunning: async () => undefined,
    hasSidecarGivenUp: () => false,
    isSidecarDisabled: () => false,
    isSidecarRunning: () => true,
    getSidecarPort: () => 4242,
    getSidecarClientToken: () => "secret",
  };
  const mocks = {
    "@antelopejs/interface-api": api,
    "@antelopejs/interface-dms/auth": auth,
    "../lifecycle/spawn-sidecar": spawn,
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    mocks[request] ?? originalLoad(request, parent, isMain);
  try {
    const exports = files.map((file) => {
      delete require.cache[dist(file)];
      return require(dist(file));
    });
    return { owned, routes, exports };
  } finally {
    Module._load = originalLoad;
    for (const file of files) delete require.cache[dist(file)];
  }
}

void test("serves the channel routes to owners only", () => {
  const { owned, routes } = loadRoutes(["routes/channels.js"]);
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.location}`).sort(byText),
    ["GET /ai/channel/events", "POST /ai/channel/:connectionId/messages"],
  );
  for (const route of routes) assert.ok(owned.has(route.owner));
});

void test("serves no chat document: the chat is a dashboard component", () => {
  const routeModules = readdirSync(dist("routes")).filter((file) =>
    file.endsWith(".js"),
  );
  for (const file of routeModules) {
    const source = readFileSync(dist(`routes/${file}`), "utf8");
    assert.doesNotMatch(source, /chatbox/i, file);
  }
});

void test("keeps the sidecar port and client credential out of /ai/sidecar-info", async () => {
  const { exports } = loadRoutes(["routes/sidecar-info.js"]);
  const controller = new exports[0].AISidecarInfoController();
  const result = await controller.sidecarInfo();
  assert.deepEqual(Object.keys(JSON.parse(result.getBody())).sort(byText), [
    "disabled",
    "hasGivenUp",
    "isRunning",
  ]);
});
