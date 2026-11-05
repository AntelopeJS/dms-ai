const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { after, before, test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { z } = require("zod");
const { installRequireMocks } = require("./helpers/require-mocks.cjs");

const DIST_DIR = path.resolve(__dirname, "../dist");
const CLIENT_TOKEN = "client-secret";
const CACHE = ["node_modules", ".cache", "dms-ai"];
const AddressSchema = z.object({ port: z.number() });
const BridgeConfigSchema = z.object({ url: z.string(), token: z.string() });
const McpJsonSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()),
});
const ReplySchema = z.looseObject({ jsonrpc: z.literal("2.0") });

/** What the stand-in sidecar received and answers. */
const sidecar = {
  /** @type {number | null} */
  port: null,
  /** @type {{ path: string | undefined, authorization: string | undefined, body: unknown }[]} */
  requests: [],
  /** @type {{ status: number, body: string }} */
  answer: { status: 200, body: "{}" },
};

/**
 * @param {http.RequestListener} listener
 * @returns {Promise<http.Server>}
 */
function listen(listener) {
  const server = http.createServer(listener);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
  });
}

function loadModules() {
  const decorator = () => () => undefined;
  const api = {
    HTTPResult,
    /** @param {string} location */
    Controller: (location) => {
      class Base {}
      Base.location = location;
      return Base;
    },
    Post: decorator,
    Context: decorator,
    Parameter: decorator,
    JSONBody: decorator,
  };
  const restore = installRequireMocks(
    new Map([
      ["@antelopejs/interface-api", api],
      [
        "@antelopejs/interface-core/logging",
        { Logging: { Warn: () => undefined, Error: () => undefined } },
      ],
      [
        "../lifecycle/spawn-sidecar",
        {
          ensureSidecarRunning: async () => undefined,
          getSidecarPort: () => sidecar.port,
          getSidecarClientToken: () => CLIENT_TOKEN,
          isSidecarDisabled: () => false,
        },
      ],
    ]),
  );
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.startsWith(DIST_DIR)) delete require.cache[file];
    }
    return {
      ...require("../dist/lifecycle/project-mcp.js"),
      ...require("../dist/routes/mcp.js"),
    };
  } finally {
    restore();
  }
}

const ModulesSchema = z.object({
  publishProjectMcp: z.function(),
  AIMcpController: z.function(),
});
const ResultSchema = z.instanceof(HTTPResult);
const TextSchema = z.string();
const modules = loadModules();
ModulesSchema.parse(modules);

/**
 * @param {object} ctx
 * @param {string | undefined} authorization
 * @param {unknown} body
 */
async function relay(ctx, authorization, body) {
  const route = new modules.AIMcpController();
  return ResultSchema.parse(await route.relay(ctx, authorization, body));
}

/** @type {http.Server[]} */
const servers = [];
let backendUrl = "";

before(async () => {
  const fakeSidecar = await listen(async (req, res) => {
    const raw = await readBody(req);
    sidecar.requests.push({
      path: req.url,
      authorization: req.headers.authorization,
      body: z.json().parse(JSON.parse(raw)),
    });
    res.writeHead(sidecar.answer.status, {
      "Content-Type": "application/json",
    });
    res.end(sidecar.answer.body);
  });
  sidecar.port = AddressSchema.parse(fakeSidecar.address()).port;
  const backend = await listen(async (req, res) => {
    const raw = await readBody(req);
    const result = await relay(
      { rawRequest: req },
      req.headers.authorization,
      raw.length > 0 ? z.json().parse(JSON.parse(raw)) : undefined,
    );
    const text = TextSchema.safeParse(result.getBody());
    res.writeHead(result.getStatus());
    res.end(text.success ? text.data : JSON.stringify(result.getBody() ?? ""));
  });
  backendUrl = `http://127.0.0.1:${AddressSchema.parse(backend.address()).port}`;
  servers.push(fakeSidecar, backend);
});

after(() =>
  Promise.all(servers.map((s) => new Promise((done) => s.close(done)))),
);

async function tempProject() {
  return mkdtemp(path.join(os.tmpdir(), "dms-ai-mcp-"));
}

/** @param {string} root */
async function readBridgeConfig(root) {
  const raw = await readFile(path.join(root, ...CACHE, "mcp.json"), "utf8");
  return BridgeConfigSchema.parse(JSON.parse(raw));
}

/** @param {string} root */
async function readMcpJson(root) {
  const raw = await readFile(path.join(root, ".mcp.json"), "utf8");
  return McpJsonSchema.parse(JSON.parse(raw));
}

/**
 * Starts the server `.mcp.json` names the way Claude Code does: its command
 * and args, run from the project root, speaking JSON-RPC lines on stdio.
 * @param {string} root
 */
async function startBridge(root) {
  const entry = z
    .object({ command: z.string(), args: z.array(z.string()) })
    .parse((await readMcpJson(root)).mcpServers["dms-ai"]);
  const child = spawn(entry.command, entry.args, { cwd: root });
  const lines = readline.createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  return {
    /** @param {object} message */
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    next: async () =>
      ReplySchema.parse(JSON.parse((await iterator.next()).value)),
    stop: () => child.kill(),
  };
}

/** @param {string} root @param {boolean} writeMcpJson */
function publish(root, writeMcpJson = true) {
  return modules.publishProjectMcp({
    hostProjectRoot: root,
    backendUrl,
    writeMcpJson,
  });
}

void test("a Claude Code session launched from .mcp.json reaches the sidecar's project tools", async () => {
  const root = await tempProject();
  sidecar.requests = [];
  sidecar.answer = {
    status: 200,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
  };
  await publish(root);
  const bridge = await startBridge(root);
  try {
    bridge.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assert.deepEqual(await bridge.next(), {
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
    assert.deepEqual(sidecar.requests, [
      {
        path: "/mcp/project",
        authorization: `Bearer ${CLIENT_TOKEN}`,
        body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      },
    ]);
  } finally {
    bridge.stop();
    await rm(root, { recursive: true, force: true });
  }
});

void test("a request the backend cannot answer gets a JSON-RPC error naming the fix", async () => {
  const root = await tempProject();
  await publish(root);
  const configPath = path.join(root, ...CACHE, "mcp.json");
  const config = await readBridgeConfig(root);
  await writeFile(
    configPath,
    JSON.stringify({ ...config, url: "http://127.0.0.1:1/ai/mcp" }),
  );
  const bridge = await startBridge(root);
  try {
    bridge.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    bridge.send({ jsonrpc: "2.0", id: "a", method: "tools/list" });
    const reply = await bridge.next();
    assert.equal(reply.id, "a");
    assert.match(
      z.object({ message: z.string() }).parse(reply.error).message,
      /ajs project dev/,
    );
  } finally {
    bridge.stop();
    await rm(root, { recursive: true, force: true });
  }
});

void test("the credential file is readable by the project's user only", async () => {
  const root = await tempProject();
  await publish(root);
  const { mode } = await stat(path.join(root, ...CACHE, "mcp.json"));
  assert.equal(mode & 0o777, 0o600);
  assert.match((await readBridgeConfig(root)).url, /\/ai\/mcp$/);
  await rm(root, { recursive: true, force: true });
});

void test("the route refuses a caller without this start's credential", async () => {
  const root = await tempProject();
  await publish(root);
  const stale = (await readBridgeConfig(root)).token;
  await publish(root);
  const loopback = {
    rawRequest: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
  };
  const refused = await relay(loopback, `Bearer ${stale}`, {});
  assert.equal(refused.getStatus(), 401);
  assert.equal((await relay(loopback, undefined, {})).getStatus(), 401);
  await rm(root, { recursive: true, force: true });
});

void test("the route refuses a caller on another machine or behind the frontend proxy, even with the credential", async () => {
  const root = await tempProject();
  await publish(root);
  const { token } = await readBridgeConfig(root);
  const remote = {
    rawRequest: { headers: {}, socket: { remoteAddress: "192.168.1.20" } },
  };
  assert.equal((await relay(remote, `Bearer ${token}`, {})).getStatus(), 403);
  const proxied = {
    rawRequest: {
      headers: { "x-forwarded-for": "203.0.113.9" },
      socket: { remoteAddress: "127.0.0.1" },
    },
  };
  assert.equal((await relay(proxied, `Bearer ${token}`, {})).getStatus(), 403);
  await rm(root, { recursive: true, force: true });
});

void test(".mcp.json gains the dms-ai server and keeps the others", async () => {
  const root = await tempProject();
  await writeFile(
    path.join(root, ".mcp.json"),
    JSON.stringify({ mcpServers: { other: { command: "other" } } }),
  );
  await publish(root);
  const { mcpServers } = await readMcpJson(root);
  assert.deepEqual(Object.keys(mcpServers).sort(), ["dms-ai", "other"]);
  assert.deepEqual(mcpServers.other, { command: "other" });
  await rm(root, { recursive: true, force: true });
});

void test("a dms-ai entry the integrator wrote is left as written", async () => {
  const root = await tempProject();
  const own = { mcpServers: { "dms-ai": { command: "custom" } } };
  await writeFile(path.join(root, ".mcp.json"), JSON.stringify(own));
  await publish(root);
  assert.deepEqual(await readMcpJson(root), own);
  await rm(root, { recursive: true, force: true });
});

void test("a .mcp.json that is not a JSON object is not touched", async () => {
  const root = await tempProject();
  await writeFile(path.join(root, ".mcp.json"), "{ not json");
  await publish(root);
  const raw = await readFile(path.join(root, ".mcp.json"), "utf8");
  assert.equal(raw, "{ not json");
  await rm(root, { recursive: true, force: true });
});

void test("mcpJson: false leaves the project without a .mcp.json", async () => {
  const root = await tempProject();
  await publish(root, false);
  await assert.rejects(stat(path.join(root, ".mcp.json")), { code: "ENOENT" });
  await rm(root, { recursive: true, force: true });
});
