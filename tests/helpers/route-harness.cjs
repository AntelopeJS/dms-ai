const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const { after, before } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");

const dist = (file) => path.resolve(__dirname, "../../dist", file);
const OWNER = { _id: "user-1", name: "Camille Laurent", email: "c@acme.test" };
const CLIENT_TOKEN = "client-secret";

/** A stand-in sidecar: records each request, answers from `routes`. */
const sidecar = { port: null, requests: [], routes: new Map(), isDown: false };

function answer(method, pathname, status, body) {
  sidecar.routes.set(`${method} ${pathname}`, { status, body });
}

function startFakeSidecar() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const url = new URL(req.url, "http://sidecar.test");
      sidecar.requests.push({
        method: req.method,
        path: url.pathname,
        rawPath: req.url.split("?")[0],
        query: Object.fromEntries(url.searchParams),
        body: raw ? JSON.parse(raw) : undefined,
        authorization: req.headers.authorization,
      });
      const route = sidecar.routes.get(`${req.method} ${url.pathname}`) ?? {
        status: 404,
        body: { message: "no route" },
      };
      res.writeHead(route.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(route.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      sidecar.port = server.address().port;
      resolve(server);
    });
  });
}

function loadControllers(files) {
  const decorator = () => () => undefined;
  const api = {
    HTTPResult,
    Controller: (location) => {
      class Base {}
      Base.location = location;
      return Base;
    },
    Get: decorator,
    Post: decorator,
    Put: decorator,
    Context: decorator,
    Parameter: decorator,
    JSONBody: decorator,
    RawBody: decorator,
  };
  const mocks = {
    "@antelopejs/interface-api": api,
    "@antelopejs/interface-dms/auth": {
      AuthOwnerOnly: decorator,
      AuthRawUser: decorator,
    },
    "../lifecycle/spawn-sidecar": {
      ensureSidecarRunning: async () => undefined,
      getSidecarPort: () => (sidecar.isDown ? null : sidecar.port),
      getSidecarClientToken: () => CLIENT_TOKEN,
      hasSidecarGivenUp: () => false,
      isSidecarDisabled: () => false,
      isSidecarRunning: () => !sidecar.isDown,
      restartSidecar: async () => undefined,
    },
  };
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    mocks[request] ?? originalLoad(request, parent, isMain);
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.startsWith(dist(""))) delete require.cache[file];
    }
    return Object.assign({}, ...files.map((file) => require(dist(file))));
  } finally {
    Module._load = originalLoad;
  }
}

function context(query) {
  return { url: new URL(`http://backend.test/ai/x?${query}`) };
}

function reset() {
  sidecar.requests = [];
  sidecar.routes = new Map();
  sidecar.isDown = false;
}

const ROUTE_FILES = [
  "routes/activity.js",
  "routes/changes.js",
  "routes/metrics.js",
  "routes/settings.js",
  "routes/skills.js",
  "routes/status.js",
];

/**
 * Starts the stand-in sidecar before the file's tests and loads the route
 * controllers against it; `routes` is filled once the tests run.
 */
function useRouteHarness() {
  const harness = { routes: null };
  let server;
  before(async () => {
    server = await startFakeSidecar();
    harness.routes = loadControllers(ROUTE_FILES);
  });
  after(() => new Promise((resolve) => server.close(resolve)));
  return harness;
}

module.exports = {
  CLIENT_TOKEN,
  OWNER,
  answer,
  context,
  reset,
  sidecar,
  useRouteHarness,
};
