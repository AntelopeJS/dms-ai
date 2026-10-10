import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { getBuilderAvailable } from "../builder/capability.js";
import { CONTENT_TYPE, HTTP_STATUS } from "../constants/http.js";
import { MCP_HTTP_PATH } from "../constants/mcp.js";
import { LOOPBACK_HOST } from "../constants/ports.js";
import type { McpHttpRegistry } from "../mcp/http-binding.js";
import { SettingsPatchSchema } from "../protocol/messages.js";
import { getProviderAvailability } from "../providers/registry.js";
import type { ProviderAvailabilityMap } from "../providers/types.js";
import { isClientAuthorized } from "./client-auth.js";
import type { SkillSource } from "../skills/types.js";
import type { ConversationStore } from "../state/conversations.js";
import { mergeSettings, type SettingsStore } from "../state/settings-store.js";
import type { AppSettings } from "../state/settings-types.js";
import { readSidecarVersion } from "../state/sidecar-version.js";
import { API_ROUTES, type ApiDeps, type ApiRoute } from "./http-routes.js";
import { readBody, sendJson, sendResponse } from "./http-io.js";
import { decodeRouteParam } from "./http-params.js";
import type { SidecarServices } from "./services.js";

export interface SettingsApplier {
  apply: (next: AppSettings) => void;
}

/** Filled by the WebSocket stack with the live services the routes read. */
export interface SidecarBridge {
  services?: SidecarServices;
}

// What both frontends read: the stored settings plus the read-only capabilities
// that gate them.
export interface SettingsPayload extends AppSettings {
  builderAvailable: boolean;
  providers: ProviderAvailabilityMap;
}

interface CreateHttpServerOptions {
  clientToken: string;
  port: number;
  buildId?: string;
  onHealthCheck?: () => void;
  conversationStore?: ConversationStore;
  settingsStore?: SettingsStore;
  settingsApplier?: SettingsApplier;
  // Recomputed per request so the `allowLocalSkills` toggle takes effect live.
  getSkillSources?: () => SkillSource[];
  mcpHttpRegistry?: McpHttpRegistry;
  bridge?: SidecarBridge;
}

const DEFAULT_BUILD_ID = "";
const PUBLIC_PATHS: readonly string[] = ["/health"];

interface CreateHttpServerResult {
  server: Server;
  port: number;
}

interface RouteContext extends CreateHttpServerOptions {
  buildId: string;
  listeningPort: number;
}

interface HealthBody {
  ok: true;
  version: string;
  buildId: string;
}

async function healthHandler(res: ServerResponse, ctx: RouteContext) {
  ctx.onHealthCheck?.();
  const version = await readSidecarVersion();
  const body: HealthBody = { ok: true, version, buildId: ctx.buildId };
  sendJson(res, HTTP_STATUS.OK, body);
}

export function buildSettingsPayload(settings: AppSettings): SettingsPayload {
  return {
    ...settings,
    builderAvailable: getBuilderAvailable(),
    providers: getProviderAvailability(),
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** PUT /settings: a partial body merged over the stored settings. */
async function putSettings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ApiDeps,
): Promise<void> {
  const result = SettingsPatchSchema.safeParse(parseJson(await readBody(req)));
  if (!result.success) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, {
      message: result.error.issues[0]?.message ?? "Invalid settings.",
    });
    return;
  }
  const next = mergeSettings(deps.settingsStore.get(), result.data);
  deps.settingsApplier.apply(next);
  sendJson(res, HTTP_STATUS.OK, buildSettingsPayload(next));
}

const SETTINGS_ROUTES: readonly ApiRoute[] = [
  {
    method: "GET",
    pattern: /^\/settings$/,
    handle: (_req, res, deps) =>
      sendJson(
        res,
        HTTP_STATUS.OK,
        buildSettingsPayload(deps.settingsStore.get()),
      ),
  },
  { method: "PUT", pattern: /^\/settings$/, handle: putSettings },
];

function buildDeps(ctx: RouteContext): ApiDeps | null {
  const { conversationStore, settingsStore, settingsApplier } = ctx;
  if (!conversationStore || !settingsStore || !settingsApplier) return null;
  return {
    conversationStore,
    settingsStore,
    settingsApplier,
    getSkillSources: ctx.getSkillSources ?? (() => []),
    services: () => ctx.bridge?.services,
    port: ctx.listeningPort,
  };
}

interface MatchedRoute {
  route: ApiRoute;
  // `null` when a parameter is malformed.
  params: string[] | null;
}

function decodeParams(raw: string[]): string[] | null {
  const params = raw.map(decodeRouteParam);
  return params.includes(null) ? null : (params as string[]);
}

function matchRoute(method: string, path: string): MatchedRoute | null {
  for (const route of [...SETTINGS_ROUTES, ...API_ROUTES]) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (match !== null) return { route, params: decodeParams(match.slice(1)) };
  }
  return null;
}

async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  if (!isClientAuthorized(req, ctx.clientToken)) {
    res.writeHead(HTTP_STATUS.UNAUTHORIZED, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const matched = matchRoute(req.method ?? "GET", url.pathname);
  const deps = buildDeps(ctx);
  if (matched === null || (deps === null && !matched.route.isStandalone)) {
    sendResponse(res, HTTP_STATUS.NOT_FOUND, CONTENT_TYPE.TEXT, "Not Found");
    return;
  }
  if (matched.params === null) {
    sendJson(res, HTTP_STATUS.BAD_REQUEST, { error: "malformed path" });
    return;
  }
  await matched.route.handle(req, res, deps as ApiDeps, {
    params: matched.params,
    query: url.searchParams,
    getSkillSources: ctx.getSkillSources,
  });
}

function buildRoutePath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  return url.split("?")[0] ?? "/";
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: RouteContext,
): Promise<void> {
  const path = buildRoutePath(req);
  if (ctx.mcpHttpRegistry && path === MCP_HTTP_PATH) {
    await ctx.mcpHttpRegistry.handleRequest(req, res);
    return;
  }
  if (req.method === "GET" && PUBLIC_PATHS.includes(path)) {
    await healthHandler(res, ctx);
    return;
  }
  await handleApiRoute(req, res, ctx);
}

export function createHttpServer(
  options: CreateHttpServerOptions,
): Promise<CreateHttpServerResult> {
  const ctx: RouteContext = {
    ...options,
    buildId: options.buildId ?? DEFAULT_BUILD_ID,
    listeningPort: options.port,
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
      ctx.listeningPort = address.port;
      resolveListen({ server, port: address.port });
    });
  });
}
