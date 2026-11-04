const http = require("node:http");
const path = require("node:path");
const { after, before } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const { z } = require("zod");
const { installRequireMocks } = require("./require-mocks.cjs");

const JsonSchema = z.json();
const TextSchema = z.string();
const AddressSchema = z.object({ port: z.number() });
const DIST_DIR = path.resolve(__dirname, "../../dist");
const OWNER = { _id: "user-1", name: "Camille Laurent", email: "c@acme.test" };
const CLIENT_TOKEN = "client-secret";

/**
 * @typedef {object} SidecarRequest
 * @property {string | undefined} method
 * @property {string} path
 * @property {string} rawPath
 * @property {Record<string, string>} query
 * @property {z.core.util.JSONType | undefined} body
 * @property {string | undefined} authorization
 */

/**
 * @typedef {object} SidecarAnswer
 * @property {number} status
 * @property {unknown} body
 */

/**
 * A stand-in sidecar: records each request, answers from `routes`.
 * @type {{
 *   port: number | null,
 *   requests: SidecarRequest[],
 *   routes: Map<string, SidecarAnswer>,
 *   isDown: boolean,
 * }}
 */
const sidecar = { port: null, requests: [], routes: new Map(), isDown: false };

/**
 * @param {string} method
 * @param {string} pathname
 * @param {number} status
 * @param {unknown} body
 */
function answer(method, pathname, status, body) {
  sidecar.routes.set(`${method} ${pathname}`, { status, body });
}

/** @returns {Promise<http.Server>} */
function startFakeSidecar() {
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const target = req.url ?? "";
      const url = new URL(target, "http://sidecar.test");
      sidecar.requests.push({
        method: req.method,
        path: url.pathname,
        rawPath: target.split("?")[0],
        query: Object.fromEntries(url.searchParams),
        body: raw ? JsonSchema.parse(JSON.parse(raw)) : undefined,
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
      sidecar.port = AddressSchema.parse(server.address()).port;
      resolve(server);
    });
  });
}

/** Loads the route controllers fresh, with the framework and the sidecar lifecycle mocked. */
function loadControllers() {
  const decorator = () => () => undefined;
  const api = {
    HTTPResult,
    /** @param {string} location */
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
  /** @type {Map<string, unknown>} */
  const mocks = new Map([
    ["@antelopejs/interface-api", api],
    [
      "@antelopejs/interface-dms/auth",
      { AuthOwnerOnly: decorator, AuthRawUser: decorator },
    ],
    [
      "../lifecycle/spawn-sidecar",
      {
        ensureSidecarRunning: async () => undefined,
        getSidecarPort: () => (sidecar.isDown ? null : sidecar.port),
        getSidecarClientToken: () => CLIENT_TOKEN,
        hasSidecarGivenUp: () => false,
        isSidecarDisabled: () => false,
        isSidecarRunning: () => !sidecar.isDown,
        restartSidecar: async () => undefined,
      },
    ],
  ]);
  const restoreRequire = installRequireMocks(mocks);
  try {
    for (const file of Object.keys(require.cache)) {
      if (file.startsWith(DIST_DIR)) delete require.cache[file];
    }
    return {
      ...require("../../dist/routes/activity.js"),
      ...require("../../dist/routes/changes.js"),
      ...require("../../dist/routes/codex-account.js"),
      ...require("../../dist/routes/metrics.js"),
      ...require("../../dist/routes/settings.js"),
      ...require("../../dist/routes/skills.js"),
      ...require("../../dist/routes/status.js"),
      ...require("../../dist/pages/settings/availability.js"),
    };
  } finally {
    restoreRequire();
  }
}

/**
 * @template {z.ZodType} Schema
 * @param {Schema} schema
 * @param {HTTPResult} result
 * @returns {z.output<Schema>}
 */
function bodyOf(schema, result) {
  return schema.parse(JSON.parse(TextSchema.parse(result.getBody())));
}

/** @param {HTTPResult} result */
function textOf(result) {
  return TextSchema.parse(result.getBody());
}

/** @param {string} query */
function context(query) {
  return { url: new URL(`http://backend.test/ai/x?${query}`) };
}

function reset() {
  sidecar.requests = [];
  sidecar.routes = new Map();
  sidecar.isDown = false;
}

/**
 * Starts the stand-in sidecar before the file's tests and loads the route
 * controllers against it.
 */
function useRouteHarness() {
  const routes = loadControllers();
  /** @type {http.Server} */
  let server;
  before(async () => {
    server = await startFakeSidecar();
  });
  after(() => new Promise((resolve) => server.close(resolve)));
  return { routes };
}

module.exports = {
  CLIENT_TOKEN,
  OWNER,
  answer,
  bodyOf,
  context,
  reset,
  sidecar,
  textOf,
  useRouteHarness,
};
