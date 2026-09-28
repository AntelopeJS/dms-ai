const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const { afterEach, test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { WebSocket, WebSocketServer } = require("ws");

const dist = (file) => path.resolve(__dirname, "../dist", file);
const { openBridges } = require(dist("channels/bridge.js"));
const { openChannel, postChannelMessage } = require(
  dist("channels/channel-service.js"),
);
const { closeAllBridges } = require(dist("channels/registry.js"));
const { createSseStream } = require(dist("channels/sse-stream.js"));
const { relayChatboxFile } = require(dist("chatbox/passthrough.js"));
const { CHATBOX_CONTENT_SECURITY_POLICY } = require(
  dist("constants/chatbox.js"),
);

const OWNER = "owner-1";
const INTRUDER = "owner-2";
const WAIT_TIMEOUT_MS = 2_000;
const WAIT_STEP_MS = 10;
const byText = (a, b) => a.localeCompare(b);

const sidecars = [];

afterEach(async () => {
  closeAllBridges();
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.close()));
});

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

function connectTo(port, socketPath) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${socketPath}`);
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
    byPath: {},
    paths: [],
    sockets: [],
    closed: 0,
    connect: (socketPath) => connectTo(server.address().port, socketPath),
    close: () => {
      for (const client of server.clients) client.terminate();
      return new Promise((resolve) => server.close(resolve));
    },
  };
  server.on("connection", (socket, request) => {
    sidecar.sockets.push(socket);
    sidecar.paths.push(request.url);
    sidecar.byPath[request.url] = socket;
    socket.on("message", (data) =>
      sidecar.received.push({
        path: request.url,
        text: Buffer.concat([data].flat()).toString("utf8"),
      }),
    );
    socket.on("close", () => {
      sidecar.closed += 1;
    });
    onConnection(socket, request.url);
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

async function openOn(sidecar, channels = "chat", userId = OWNER) {
  const context = fakeContext();
  const result = await openChannel(
    context.ctx,
    channels,
    userId,
    sidecar.connect,
  );
  assert.equal(result, undefined);
  context.capture();
  await waitFor(() => parseEvents(context.output.text).length > 0, "ready");
  const ready = parseEvents(context.output.text)[0];
  assert.equal(ready.name, "ready");
  const { connections } = JSON.parse(ready.data);
  return { ...context, connections };
}

function post(connectionId, body, userId = OWNER) {
  return postChannelMessage(connectionId, userId, Buffer.from(body));
}

void test("streams every sidecar frame, named after its channel, after a ready event", async () => {
  const sidecar = await startSidecar((socket) => {
    socket.send('{"type":"settings_update"}');
    socket.send('{"type":"conversation_list"}');
  });
  const opened = await openOn(sidecar);
  await waitFor(
    () => parseEvents(opened.output.text).length === 3,
    "relayed frames",
  );
  assert.deepEqual(parseEvents(opened.output.text).slice(1), [
    { name: "chat", data: '{"type":"settings_update"}' },
    { name: "chat", data: '{"type":"conversation_list"}' },
  ]);
  assert.deepEqual(Object.keys(opened.connections), ["chat"]);
  assert.deepEqual(sidecar.paths, ["/ws/iframe"]);
});

void test("carries the host and chat channels on one stream", async () => {
  const sidecar = await startSidecar((socket, socketPath) =>
    socket.send(`{"from":"${socketPath}"}`),
  );
  const opened = await openOn(sidecar, "host,chat");
  assert.deepEqual(Object.keys(opened.connections), ["host", "chat"]);
  assert.deepEqual([...sidecar.paths].sort(byText), ["/ws/host", "/ws/iframe"]);
  await waitFor(
    () => parseEvents(opened.output.text).length === 3,
    "frames of both channels",
  );
  const frames = parseEvents(opened.output.text).slice(1);
  assert.deepEqual(
    frames.map((frame) => `${frame.name} ${frame.data}`).sort(byText),
    ['chat {"from":"/ws/iframe"}', 'host {"from":"/ws/host"}'],
  );
});

void test("posts each message to its own channel's socket, in order on each", async () => {
  const sidecar = await startSidecar();
  const { connections } = await openOn(sidecar, "host,chat");
  for (const [channel, n] of [
    ["chat", 1],
    ["host", 2],
    ["chat", 3],
  ]) {
    const result = await post(connections[channel], `{"n":${n}}`);
    assert.equal(result.getStatus(), 204);
  }
  await waitFor(() => sidecar.received.length === 3, "posted frames");
  const onPath = (socketPath) =>
    sidecar.received
      .filter((frame) => frame.path === socketPath)
      .map((frame) => frame.text);
  assert.deepEqual(onPath("/ws/iframe"), ['{"n":1}', '{"n":3}']);
  assert.deepEqual(onPath("/ws/host"), ['{"n":2}']);
});

void test("answers 404 to another user's connection id and to an unknown one", async () => {
  const sidecar = await startSidecar();
  const { connections } = await openOn(sidecar);
  assert.equal((await post(connections.chat, "{}", INTRUDER)).getStatus(), 404);
  assert.equal((await post("nope", "{}")).getStatus(), 404);
  assert.deepEqual(sidecar.received, []);
});

void test("closes every sidecar socket and forgets the stream when the browser leaves", async () => {
  const sidecar = await startSidecar();
  const opened = await openOn(sidecar, "host,chat");
  opened.leave();
  await waitFor(() => sidecar.closed === 2, "sidecar sockets close");
  for (const connectionId of Object.values(opened.connections)) {
    assert.equal((await post(connectionId, "{}")).getStatus(), 404);
  }
});

void test("sends sidecar_down and ends the whole stream when one socket closes", async () => {
  const sidecar = await startSidecar();
  const opened = await openOn(sidecar, "host,chat");
  sidecar.byPath["/ws/host"].close();
  await waitFor(() => opened.output.ended, "stream end");
  await waitFor(() => sidecar.closed === 2, "both sockets closed");
  const names = parseEvents(opened.output.text).map((event) => event.name);
  assert.deepEqual(names, ["ready", "sidecar_down"]);
  for (const connectionId of Object.values(opened.connections)) {
    assert.equal((await post(connectionId, "{}")).getStatus(), 404);
  }
});

void test("closeAllBridges ends every stream and closes every sidecar socket, as destroy() does", async () => {
  const sidecar = await startSidecar();
  const first = await openOn(sidecar, "host,chat");
  const second = await openOn(sidecar, "chat");
  closeAllBridges();
  await waitFor(() => first.output.ended && second.output.ended, "streams end");
  await waitFor(() => sidecar.closed === 3, "sidecar sockets close");
  for (const opened of [first, second]) {
    for (const connectionId of Object.values(opened.connections)) {
      assert.equal((await post(connectionId, "{}")).getStatus(), 404);
    }
  }
  const reopened = await openOn(sidecar, "host,chat");
  const result = await post(reopened.connections.chat, '{"after":"reload"}');
  assert.equal(result.getStatus(), 204);
});

void test("leaves nothing open when the browser left during the sidecar handshake", async () => {
  const sidecar = await startSidecar();
  const context = fakeContext();
  const slowConnect = async (socketPath) => {
    const socket = await sidecar.connect(socketPath);
    context.leave();
    return socket;
  };
  await openChannel(context.ctx, "host,chat", OWNER, slowConnect);
  await waitFor(() => sidecar.closed === 2, "sidecar sockets close");
});

void test("closes the sockets it opened when another channel cannot connect", async () => {
  const sidecar = await startSidecar();
  const context = fakeContext();
  const halfDown = (socketPath) =>
    socketPath === "/ws/host"
      ? sidecar.connect(socketPath)
      : Promise.reject(new Error("down"));
  const result = await openChannel(context.ctx, "host,chat", OWNER, halfDown);
  assert.equal(result.getStatus(), 503);
  assert.equal(context.ctx.response.isStream(), false);
  await waitFor(() => sidecar.closed === 1, "opened socket closed");
});

void test("answers 503 without streaming when the sidecar cannot be reached", async () => {
  const context = fakeContext();
  const result = await openChannel(context.ctx, "chat", OWNER, async () => {
    throw new Error("down");
  });
  assert.equal(result.getStatus(), 503);
  assert.equal(context.ctx.response.isStream(), false);
});

void test("answers 404 to an unknown or repeated channel", async () => {
  const neverConnect = async () => {
    throw new Error("must not connect");
  };
  for (const channels of ["shell", "host,shell", "chat,chat"]) {
    const context = fakeContext();
    const result = await openChannel(
      context.ctx,
      channels,
      OWNER,
      neverConnect,
    );
    assert.equal(result.getStatus(), 404);
  }
});

void test("pauses a sidecar socket while the stream is full and resumes it on drain", async () => {
  const sidecar = await startSidecar();
  const socket = await sidecar.connect("/ws/iframe");
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
  openBridges({
    userId: OWNER,
    sockets: [{ channel: "chat", socket }],
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
  stream.send("chat", "first\nsecond");
  stream.close();
  assert.deepEqual(writes, ["event: chat\ndata: first\ndata: second\n\n"]);
});

void test("relays the chatbox document with its status, type and length, under the CSP", async () => {
  const context = fakeContext();
  const html = "<!doctype html><title>chat</title>";
  const load = async (filePath) => {
    assert.equal(filePath, "/");
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(html.length),
      },
    });
  };
  assert.equal(await relayChatboxFile(context.ctx, "/", load), undefined);
  context.capture();
  await waitFor(() => context.output.ended, "document body");
  assert.equal(context.output.text, html);
  assert.equal(context.ctx.response.getStatus(), 200);
  assert.equal(
    context.ctx.response.getContentType(),
    "text/html; charset=utf-8",
  );
  const headers = context.ctx.response.getHeaders();
  assert.equal(
    headers["Content-Security-Policy"],
    CHATBOX_CONTENT_SECURITY_POLICY,
  );
  assert.equal(headers["content-length"], String(html.length));
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});

void test("keeps scripts to the bundle and nothing loaded from outside the origin", () => {
  const directives = Object.fromEntries(
    CHATBOX_CONTENT_SECURITY_POLICY.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources];
    }),
  );
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.deepEqual(directives["img-src"], ["'self'", "data:", "blob:"]);
  assert.deepEqual(directives["frame-ancestors"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
});

void test("relays a missing asset with the sidecar's own status", async () => {
  const context = fakeContext();
  const load = async () =>
    new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  await relayChatboxFile(context.ctx, "/assets/missing.js", load);
  assert.equal(context.ctx.response.getStatus(), 404);
});

void test("answers 503 when the chatbox cannot be loaded", async () => {
  const context = fakeContext();
  const result = await relayChatboxFile(context.ctx, "/", async () => {
    throw new Error("down");
  });
  assert.equal(result.getStatus(), 503);
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

void test("serves the three new routes to owners only", () => {
  const { owned, routes } = loadRoutes([
    "routes/channels.js",
    "routes/chatbox.js",
  ]);
  assert.deepEqual(
    routes.map((route) => `${route.method} ${route.location}`).sort(byText),
    [
      "GET /ai/channels/:channels/events",
      "GET /api/ai/chatbox/",
      "GET /api/ai/chatbox/::path",
      "POST /ai/channels/:connectionId/messages",
    ],
  );
  for (const route of routes) assert.ok(owned.has(route.owner));
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
