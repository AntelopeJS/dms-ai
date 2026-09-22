import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { getBuilderAvailable } from "../builder/capability.js";
import { CONTENT_TYPE, HTTP_STATUS, MIME_BY_EXT } from "../constants/http.js";
import { MCP_HTTP_PATH } from "../constants/mcp.js";
import { LOOPBACK_HOST } from "../constants/ports.js";
import type { McpHttpRegistry } from "../mcp/http-binding.js";
import {
  buildActivity,
  buildKpi,
  buildSeries,
  buildTopSkills,
} from "../metrics/aggregate.js";
import {
  KPI_METRICS,
  type KpiMetric,
  type MetricWindow,
} from "../metrics/types.js";
import { AppSettingsSchema } from "../protocol/events.js";
import { getProviderAvailability } from "../providers/registry.js";
import type { ProviderAvailabilityMap } from "../providers/types.js";
import { buildSkillCatalog } from "../skills/build-catalog.js";
import { isClientAuthorized } from "./client-auth.js";
import type { SkillSource } from "../skills/types.js";
import type { ConversationStore } from "../state/conversations.js";
import type { SettingsStore } from "../state/settings-store.js";
import type { AppSettings } from "../state/settings-types.js";
import { readSidecarVersion } from "../state/sidecar-version.js";

export interface SettingsApplier {
  apply: (next: AppSettings) => void;
}

// What both frontends read: the stored settings plus the read-only capabilities
// that gate them.
interface SettingsPayload extends AppSettings {
  builderAvailable: boolean;
  providers: ProviderAvailabilityMap;
}

interface CreateHttpServerOptions {
  clientToken: string;
  chatboxDistDir: string;
  port: number;
  buildId?: string;
  onHealthCheck?: () => void;
  conversationStore?: ConversationStore;
  settingsStore?: SettingsStore;
  settingsApplier?: SettingsApplier;
  // Recomputed per request so the `allowLocalSkills` toggle takes effect live.
  getSkillSources?: () => SkillSource[];
  mcpHttpRegistry?: McpHttpRegistry;
}

const DEFAULT_BUILD_ID = "";

interface CreateHttpServerResult {
  server: Server;
  port: number;
}

interface RouteContext {
  clientToken: string;
  chatboxDistDir: string;
  buildId: string;
  onHealthCheck?: () => void;
  conversationStore?: ConversationStore;
  settingsStore?: SettingsStore;
  settingsApplier?: SettingsApplier;
  getSkillSources?: () => SkillSource[];
  mcpHttpRegistry?: McpHttpRegistry;
}

interface HealthBody {
  ok: true;
  version: string;
  buildId: string;
}

type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
) => Promise<void> | void;

function sendResponse(
  res: ServerResponse,
  status: number,
  contentType: string,
  payload: unknown,
): void {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const healthHandler: RouteHandler = async (_req, res, ctx) => {
  ctx.onHealthCheck?.();
  const version = await readSidecarVersion();
  const body: HealthBody = { ok: true, version, buildId: ctx.buildId };
  sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, body);
};

const ROUTES: Record<string, RouteHandler> = {
  "GET /health": healthHandler,
};

const MS_PER_DAY = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_TOP_LIMIT = 5;
const DEFAULT_ACTIVITY_LIMIT = 50;
const MAX_METRIC_LIMIT = 200;
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

function parseTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseWindow(params: URLSearchParams): MetricWindow {
  const now = Date.now();
  const toMs = parseTimestamp(params.get("to")) ?? now;
  const fromMs =
    parseTimestamp(params.get("from")) ??
    toMs - DEFAULT_RANGE_DAYS * MS_PER_DAY;
  return {
    fromMs,
    toMs,
    compareFromMs: parseTimestamp(params.get("compareFrom")),
    compareToMs: parseTimestamp(params.get("compareTo")),
  };
}

function parseLimit(params: URLSearchParams, fallback: number): number {
  const raw = params.get("limit");
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, MAX_METRIC_LIMIT);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        rejectBody(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}

function isKpiMetric(value: string): value is KpiMetric {
  return (KPI_METRICS as readonly string[]).includes(value);
}

interface MetricRouteDeps {
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  settingsApplier: SettingsApplier;
}

type MetricRoute = (
  req: IncomingMessage,
  res: ServerResponse,
  deps: MetricRouteDeps,
  params: URLSearchParams,
) => Promise<void> | void;

const seriesRoute: MetricRoute = (_req, res, deps, params) => {
  const payload = buildSeries(
    deps.conversationStore.entries(),
    parseWindow(params),
  );
  sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, payload);
};

const topSkillsRoute: MetricRoute = (_req, res, deps, params) => {
  const payload = buildTopSkills(
    deps.conversationStore.entries(),
    parseWindow(params),
    parseLimit(params, DEFAULT_TOP_LIMIT),
  );
  sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, payload);
};

const activityRoute: MetricRoute = (_req, res, deps, params) => {
  const payload = buildActivity(
    deps.conversationStore.entries(),
    parseWindow(params),
    parseLimit(params, DEFAULT_ACTIVITY_LIMIT),
  );
  sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, payload);
};

function buildSettingsPayload(settings: AppSettings): SettingsPayload {
  return {
    ...settings,
    builderAvailable: getBuilderAvailable(),
    providers: getProviderAvailability(),
  };
}

const getSettingsRoute: MetricRoute = (_req, res, deps) => {
  sendResponse(
    res,
    HTTP_STATUS.OK,
    CONTENT_TYPE.JSON,
    buildSettingsPayload(deps.settingsStore.get()),
  );
};

const putSettingsRoute: MetricRoute = async (req, res, deps) => {
  const body = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const result = AppSettingsSchema.safeParse(parsed);
  if (!result.success) {
    sendResponse(res, HTTP_STATUS.BAD_REQUEST, CONTENT_TYPE.JSON, {
      error: "invalid settings",
    });
    return;
  }
  const next: AppSettings = {
    ...result.data,
    // Absent from an older client: keep what is stored rather than reset it.
    provider: result.data.provider ?? deps.settingsStore.get().provider,
  };
  deps.settingsApplier.apply(next);
  sendResponse(
    res,
    HTTP_STATUS.OK,
    CONTENT_TYPE.JSON,
    buildSettingsPayload(next),
  );
};

const METRIC_ROUTES: Record<string, MetricRoute> = {
  "GET /metrics/series": seriesRoute,
  "GET /metrics/top-skills": topSkillsRoute,
  "GET /activity": activityRoute,
  "GET /settings": getSettingsRoute,
  "PUT /settings": putSettingsRoute,
};

function handleKpiRoute(
  res: ServerResponse,
  path: string,
  params: URLSearchParams,
  deps: MetricRouteDeps,
): void {
  const metric = path.slice("/metrics/kpi/".length);
  if (!isKpiMetric(metric)) {
    sendResponse(res, HTTP_STATUS.NOT_FOUND, CONTENT_TYPE.JSON, {
      error: "unknown metric",
    });
    return;
  }
  const payload = buildKpi(
    deps.conversationStore.entries(),
    metric,
    parseWindow(params),
  );
  sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, payload);
}

// API routes (consumed by the DMS backend proxy). Returns true when the request
// was handled here, false to fall through to static serving.
async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const params = url.searchParams;

  const isApiPath =
    path === "/skills" ||
    path.startsWith("/metrics/kpi/") ||
    Object.hasOwn(METRIC_ROUTES, `${method} ${path}`);
  if (isApiPath && !isClientAuthorized(req, ctx.clientToken)) {
    res.writeHead(HTTP_STATUS.UNAUTHORIZED, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  // Skill catalog: served independently of the conversation/settings stores so
  // the route works even in minimal boots. Sources recomputed per request.
  if (method === "GET" && path === "/skills" && ctx.getSkillSources) {
    const payload = await buildSkillCatalog(ctx.getSkillSources());
    sendResponse(res, HTTP_STATUS.OK, CONTENT_TYPE.JSON, payload);
    return true;
  }

  const { conversationStore, settingsStore, settingsApplier } = ctx;
  if (!conversationStore || !settingsStore || !settingsApplier) return false;
  const deps: MetricRouteDeps = {
    conversationStore,
    settingsStore,
    settingsApplier,
  };

  if (method === "GET" && path.startsWith("/metrics/kpi/")) {
    handleKpiRoute(res, path, params, deps);
    return true;
  }

  const route = METRIC_ROUTES[`${method} ${path}`];
  if (route === undefined) return false;
  await route(req, res, deps, params);
  return true;
}

function resolveSafePath(dir: string, urlPath: string): string | null {
  const cleaned = urlPath.split("?")[0]?.split("#")[0] ?? "/";
  const decoded = decodeURIComponent(cleaned);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const target = normalize(join(dir, relative));
  const root = resolve(dir);
  const isInside = target === root || target.startsWith(root + sep);
  if (!isInside) return null;
  return target;
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  dir: string,
): Promise<void> {
  const url = req.url ?? "/";
  const filePath = resolveSafePath(dir, url);
  if (filePath === null) {
    sendResponse(res, HTTP_STATUS.NOT_FOUND, CONTENT_TYPE.TEXT, "Not Found");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendResponse(res, HTTP_STATUS.NOT_FOUND, CONTENT_TYPE.TEXT, "Not Found");
      return;
    }
    const mime =
      MIME_BY_EXT[extname(filePath).toLowerCase()] ?? CONTENT_TYPE.OCTET;
    const data = await readFile(filePath);
    res.writeHead(HTTP_STATUS.OK, {
      "Content-Type": mime,
      "Content-Length": data.byteLength.toString(),
    });
    res.end(data);
  } catch {
    sendResponse(res, HTTP_STATUS.NOT_FOUND, CONTENT_TYPE.TEXT, "Not Found");
  }
}

function buildRoutePath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  return url.split("?")[0] ?? "/";
}

function buildRouteKey(req: IncomingMessage): string {
  const method = req.method ?? "GET";
  return `${method} ${buildRoutePath(req)}`;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  if (ctx.mcpHttpRegistry && buildRoutePath(req) === MCP_HTTP_PATH) {
    await ctx.mcpHttpRegistry.handleRequest(req, res);
    return;
  }
  const key = buildRouteKey(req);
  const handler = ROUTES[key];
  if (handler !== undefined) {
    await handler(req, res, ctx);
    return;
  }
  if (await handleApiRoute(req, res, ctx)) {
    return;
  }
  if ((req.method ?? "GET") === "GET") {
    await serveStatic(req, res, ctx.chatboxDistDir);
    return;
  }
  sendResponse(res, HTTP_STATUS.NOT_FOUND, CONTENT_TYPE.TEXT, "Not Found");
}

export function createHttpServer(
  options: CreateHttpServerOptions,
): Promise<CreateHttpServerResult> {
  const ctx: RouteContext = {
    clientToken: options.clientToken,
    chatboxDistDir: options.chatboxDistDir,
    buildId: options.buildId ?? DEFAULT_BUILD_ID,
    onHealthCheck: options.onHealthCheck,
    conversationStore: options.conversationStore,
    settingsStore: options.settingsStore,
    settingsApplier: options.settingsApplier,
    getSkillSources: options.getSkillSources,
    mcpHttpRegistry: options.mcpHttpRegistry,
  };
  const server = createServer((req, res) => {
    handleRequest(req, res, ctx).catch(() =>
      sendResponse(
        res,
        HTTP_STATUS.SERVER_ERROR,
        CONTENT_TYPE.TEXT,
        "Server Error",
      ),
    );
  });
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, LOOPBACK_HOST, () => {
      server.removeListener("error", rejectListen);
      const address = server.address();
      if (address === null || typeof address === "string") {
        rejectListen(new Error("Failed to determine listening port"));
        return;
      }
      resolveListen({ server, port: address.port });
    });
  });
}
