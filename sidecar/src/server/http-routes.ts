import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type ActivityRecord,
  buildActivityRecords,
} from "../audit/activity.js";
import {
  buildActivityDetail,
  diffFromArgs,
  queryActivity,
} from "../audit/activity-query.js";
import { getBuilderAvailable } from "../builder/capability.js";
import {
  CHANGE_SET_ERRORS,
  ChangeSetActionError,
  type ChangeSetErrorCode,
  toSummary,
} from "../checkpoints/checkpoints.js";
import { HTTP_STATUS } from "../constants/http.js";
import {
  buildAllowed,
  buildKpi,
  buildSeries,
  buildTopSkills,
  buildTopTools,
  buildUsage,
  type MetricSources,
} from "../metrics/aggregate.js";
import { KPI_METRICS, type KpiMetric } from "../metrics/types.js";
import { getProviderAvailability } from "../providers/registry.js";
import { buildSkillCatalog } from "../skills/build-catalog.js";
import { enrichSkills, skillConflicts } from "../skills/skill-usage.js";
import type { SkillSource } from "../skills/types.js";
import type { ConversationStore } from "../state/conversations.js";
import type { SettingsStore } from "../state/settings-store.js";
import { readSidecarVersion } from "../state/sidecar-version.js";
import type { ChangeSetRecord } from "../state/types.js";
import { handleChangeSetAction } from "./change-set-actions.js";
import type { SettingsApplier } from "./http.js";
import { readBody, sendJson } from "./http-io.js";
import {
  optionalParam,
  parseActivityQuery,
  parseCount,
  parseLimit,
  parseWindow,
} from "./http-params.js";
import type { SidecarServices } from "./services.js";

const DEFAULT_TOP_LIMIT = 5;
const DEFAULT_USAGE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export interface ApiDeps {
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  settingsApplier: SettingsApplier;
  getSkillSources: () => SkillSource[];
  services: () => SidecarServices | undefined;
  port: number;
}

export interface RouteMatch {
  params: string[];
  query: URLSearchParams;
  getSkillSources?: () => SkillSource[];
}

export interface ApiRoute {
  method: string;
  pattern: RegExp;
  // Served even without the conversation and settings stores.
  isStandalone?: boolean;
  handle: (
    req: IncomingMessage,
    res: ServerResponse,
    deps: ApiDeps,
    match: RouteMatch,
  ) => void | Promise<void>;
}

const STATUS_BY_ERROR: Record<ChangeSetErrorCode, number> = {
  [CHANGE_SET_ERRORS.NOT_FOUND]: HTTP_STATUS.NOT_FOUND,
  [CHANGE_SET_ERRORS.WRONG_STATE]: HTTP_STATUS.CONFLICT,
  [CHANGE_SET_ERRORS.UNAVAILABLE]: HTTP_STATUS.CONFLICT,
};

function changeSets(deps: ApiDeps): ChangeSetRecord[] {
  return deps.services()?.checkpoints.all() ?? [];
}

function activityRecords(deps: ApiDeps): ActivityRecord[] {
  const services = deps.services();
  const entries = deps.conversationStore.entries();
  return buildActivityRecords({
    entries,
    changeSets: changeSets(deps),
    pending: entries.flatMap(
      (e) => services?.permissionBus.getPendingForConversation(e.id) ?? [],
    ),
    running: new Set(services?.turns.runningIds() ?? []),
    hostProjectRoot: services?.hostProjectRoot ?? "",
  });
}

function metricSources(deps: ApiDeps): MetricSources {
  return {
    records: activityRecords(deps),
    changeSets: changeSets(deps),
    entries: deps.conversationStore.entries(),
  };
}

function statusOf(services: SidecarServices | undefined) {
  const pendingApprovals = services?.permissionBus.countPending() ?? 0;
  const pendingQuestions = services?.questionBus.countPending() ?? 0;
  const working = services?.turns.runningCount() ?? 0;
  if (pendingApprovals + pendingQuestions > 0) return "waiting";
  return working > 0 ? "working" : "ready";
}

async function statusRoute(res: ServerResponse, deps: ApiDeps) {
  const services = deps.services();
  const settings = deps.settingsStore.get();
  sendJson(res, HTTP_STATUS.OK, {
    status: statusOf(services),
    provider: settings.provider,
    providers: getProviderAvailability(),
    builderAvailable: getBuilderAvailable(),
    mode: settings.mode,
    generationMode: settings.generationMode,
    workingConversations: services?.turns.runningCount() ?? 0,
    pendingApprovals: services?.permissionBus.countPending() ?? 0,
    pendingQuestions: services?.questionBus.countPending() ?? 0,
    port: deps.port,
    version: await readSidecarVersion(),
    lastError: services?.turns.lastError(),
    checkpointsAvailable: services?.checkpoints.isAvailable() ?? false,
  });
}

function isKpiMetric(value: string): value is KpiMetric {
  return (KPI_METRICS as readonly string[]).includes(value);
}

function kpiRoute(res: ServerResponse, deps: ApiDeps, match: RouteMatch) {
  const metric = match.params[0] ?? "";
  if (!isKpiMetric(metric)) {
    sendJson(res, HTTP_STATUS.NOT_FOUND, { message: "Unknown metric." });
    return;
  }
  sendJson(
    res,
    HTTP_STATUS.OK,
    buildKpi(metricSources(deps), metric, parseWindow(match.query)),
  );
}

function usageRoute(res: ServerResponse, deps: ApiDeps, match: RouteMatch) {
  const days = Math.max(1, parseCount(match.query, "days", DEFAULT_USAGE_DAYS));
  const toMs = Date.now();
  const startOfToday = Math.floor(toMs / MS_PER_DAY) * MS_PER_DAY;
  const fromMs = startOfToday - (days - 1) * MS_PER_DAY;
  sendJson(
    res,
    HTTP_STATUS.OK,
    buildUsage(metricSources(deps), { fromMs, toMs }),
  );
}

async function activityDetailRoute(
  res: ServerResponse,
  deps: ApiDeps,
  match: RouteMatch,
) {
  const record = activityRecords(deps).find((r) => r.id === match.params[0]);
  if (record === undefined) {
    sendJson(res, HTTP_STATUS.NOT_FOUND, { message: "Unknown activity." });
    return;
  }
  const diff =
    record.changeSetId === undefined
      ? diffFromArgs(record)
      : await changeSetDiff(deps, record);
  sendJson(res, HTTP_STATUS.OK, buildActivityDetail(record, diff));
}

async function changeSetDiff(deps: ApiDeps, record: ActivityRecord) {
  const checkpoints = deps.services()?.checkpoints;
  if (checkpoints === undefined || record.changeSetId === undefined)
    return undefined;
  const files = await checkpoints
    .fileDetails(record.changeSetId)
    .catch(() => []);
  const own = files.filter((file) => record.target.endsWith(file.path));
  const shown = own.length > 0 ? own : files;
  return shown.map((file) => ({ path: file.path, hunks: file.hunks }));
}

function listChangesRoute(
  res: ServerResponse,
  deps: ApiDeps,
  match: RouteMatch,
) {
  const scope = optionalParam(match.query, "scope");
  const state = optionalParam(match.query, "state");
  const matching = changeSets(deps)
    .filter((c) => scope === undefined || c.scope === scope)
    .filter((c) => state === undefined || c.state === state)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
  const offset = parseCount(match.query, "offset", 0);
  const limit = parseLimit(match.query);
  sendJson(res, HTTP_STATUS.OK, {
    results: matching.slice(offset, offset + limit).map(toSummary),
    total: matching.length,
  });
}

function sendActionError(res: ServerResponse, err: unknown): void {
  if (err instanceof ChangeSetActionError) {
    sendJson(res, STATUS_BY_ERROR[err.code], { message: err.message });
    return;
  }
  throw err;
}

async function changeDetailRoute(
  res: ServerResponse,
  deps: ApiDeps,
  match: RouteMatch,
) {
  const services = deps.services();
  const record = services?.checkpoints.get(match.params[0] ?? "") ?? null;
  if (services === undefined || record === null) {
    sendJson(res, HTTP_STATUS.NOT_FOUND, { message: "Unknown change set." });
    return;
  }
  const conversation = deps.conversationStore
    .entries()
    .find((e) => e.id === record.conversationId);
  sendJson(res, HTTP_STATUS.OK, {
    changeSet: toSummary(record),
    files: await services.checkpoints.fileDetails(record.id),
    conversationTitle: conversation?.title ?? record.title,
    pagePath: record.pagePath,
  });
}

function undoPreviewRoute(
  res: ServerResponse,
  deps: ApiDeps,
  match: RouteMatch,
) {
  const checkpoints = deps.services()?.checkpoints;
  try {
    if (checkpoints === undefined) {
      throw new ChangeSetActionError(
        CHANGE_SET_ERRORS.NOT_FOUND,
        "Unknown change set.",
      );
    }
    sendJson(
      res,
      HTTP_STATUS.OK,
      checkpoints.undoPreview(match.params[0] ?? ""),
    );
  } catch (err) {
    sendActionError(res, err);
  }
}

interface ActionBody {
  includeLater?: unknown;
  actor?: unknown;
}

function changeActionRoute(
  action: "undo" | "redo",
  resultKey: string,
): ApiRoute["handle"] {
  return async (req, res, deps, match) => {
    const services = deps.services();
    const raw = await readBody(req);
    try {
      const body = (raw === "" ? {} : (JSON.parse(raw) ?? {})) as ActionBody;
      if (services === undefined) {
        throw new ChangeSetActionError(
          CHANGE_SET_ERRORS.NOT_FOUND,
          "Unknown change set.",
        );
      }
      const ids = await handleChangeSetAction(
        services,
        {
          changeSetId: match.params[0] ?? "",
          action,
          includeLater: body.includeLater === true,
        },
        typeof body.actor === "string" ? body.actor : undefined,
      );
      sendJson(res, HTTP_STATUS.OK, { [resultKey]: ids });
    } catch (err) {
      if (err instanceof SyntaxError) {
        sendJson(res, HTTP_STATUS.BAD_REQUEST, { message: "Invalid body." });
        return;
      }
      sendActionError(res, err);
    }
  };
}

async function skillsRoute(
  res: ServerResponse,
  deps: ApiDeps | undefined,
  match: RouteMatch,
) {
  const sources = match.getSkillSources?.() ?? [];
  const catalog = await buildSkillCatalog(sources);
  const entries = deps?.conversationStore.entries() ?? [];
  sendJson(res, HTTP_STATUS.OK, {
    ...catalog,
    items: enrichSkills(catalog, entries, Date.now()),
  });
}

async function conflictsRoute(res: ServerResponse, match: RouteMatch) {
  const catalog = await buildSkillCatalog(match.getSkillSources?.() ?? []);
  sendJson(res, HTTP_STATUS.OK, { conflicts: skillConflicts(catalog) });
}

function json<T>(
  build: (deps: ApiDeps, match: RouteMatch) => T,
): ApiRoute["handle"] {
  return (_req, res, deps, match) =>
    sendJson(res, HTTP_STATUS.OK, build(deps, match));
}

export const API_ROUTES: readonly ApiRoute[] = [
  {
    method: "GET",
    pattern: /^\/status$/,
    handle: (_q, res, deps) => statusRoute(res, deps),
  },
  {
    method: "GET",
    pattern: /^\/metrics\/kpi\/([^/]+)$/,
    handle: (_q, res, deps, m) => kpiRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/metrics\/series$/,
    handle: json((d, m) => buildSeries(metricSources(d), parseWindow(m.query))),
  },
  {
    method: "GET",
    pattern: /^\/metrics\/top-skills$/,
    handle: json((d, m) =>
      buildTopSkills(
        metricSources(d),
        parseWindow(m.query),
        parseLimit(m.query, DEFAULT_TOP_LIMIT),
      ),
    ),
  },
  {
    method: "GET",
    pattern: /^\/metrics\/top-tools$/,
    handle: json((d, m) =>
      buildTopTools(
        metricSources(d),
        parseWindow(m.query),
        parseLimit(m.query, DEFAULT_TOP_LIMIT),
      ),
    ),
  },
  {
    method: "GET",
    pattern: /^\/metrics\/allowed$/,
    handle: json((d, m) =>
      buildAllowed(metricSources(d), parseWindow(m.query)),
    ),
  },
  {
    method: "GET",
    pattern: /^\/metrics\/usage$/,
    handle: (_q, res, deps, m) => usageRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/activity$/,
    handle: json((d, m) =>
      queryActivity(activityRecords(d), parseActivityQuery(m.query)),
    ),
  },
  {
    method: "GET",
    pattern: /^\/activity\/([^/]+)$/,
    handle: (_q, res, deps, m) => activityDetailRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/changes$/,
    handle: (_q, res, deps, m) => listChangesRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/changes\/([^/]+)$/,
    handle: (_q, res, deps, m) => changeDetailRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/changes\/([^/]+)\/undo-preview$/,
    handle: (_q, res, deps, m) => undoPreviewRoute(res, deps, m),
  },
  {
    method: "POST",
    pattern: /^\/changes\/([^/]+)\/undo$/,
    handle: changeActionRoute("undo", "undone"),
  },
  {
    method: "POST",
    pattern: /^\/changes\/([^/]+)\/redo$/,
    handle: changeActionRoute("redo", "redone"),
  },
  {
    method: "GET",
    pattern: /^\/skills$/,
    isStandalone: true,
    handle: (_q, res, deps, m) => skillsRoute(res, deps, m),
  },
  {
    method: "GET",
    pattern: /^\/skills\/conflicts$/,
    isStandalone: true,
    handle: (_q, res, _d, m) => conflictsRoute(res, m),
  },
];
