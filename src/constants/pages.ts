import { ROUTE_PREFIX } from "./module";

export const AI_MODULE_ICON = "i-ph-sparkle";
export const AI_MODULE_LANDING_PAGE = "overview";

/** Where the module's pages live in the dashboard. */
export const MODULE_PAGES_PATH = "/modules/ai";

export const PAGE_IDS = {
  OVERVIEW: "overview",
  CHANGES: "changes",
  ACTIVITY: "activity",
  SKILLS: "skills",
  SETTINGS: "settings",
} as const;

export const PAGE_ORDER = {
  OVERVIEW: 0,
  CHANGES: 1,
  ACTIVITY: 2,
  SKILLS: 3,
  SETTINGS: 4,
} as const;

/** The period selector of the Overview, which its cards follow. */
export const OVERVIEW_PERIOD_SCOPE = "ai-overview";

/** Rows of the Overview's recent change sets. */
export const RECENT_CHANGE_SETS = 4;
/** Rows of the Overview's top tools. */
export const TOP_TOOLS_LIMIT = 5;
/** Rows a page of the audit log holds, and each "Load more" adds. */
export const ACTIVITY_PAGE_SIZE = 25;
/** Days of the Settings › Usage chart. */
export const USAGE_DAYS = 14;

/** Field key of the settings form: part of its section anchors. */
export const SETTINGS_FORM_KEY = "settings";
export const SETTINGS_SKILLS_SECTION = "skills";

/** The routes the pages read, by what they serve. */
export const PAGE_ROUTES = {
  STATUS: `${ROUTE_PREFIX}/status`,
  KPI: `${ROUTE_PREFIX}/metrics/kpi`,
  SERIES: `${ROUTE_PREFIX}/metrics/series`,
  ALLOWED: `${ROUTE_PREFIX}/metrics/allowed`,
  TOP_TOOLS: `${ROUTE_PREFIX}/metrics/top-tools?limit=${TOP_TOOLS_LIMIT}`,
  USAGE: `${ROUTE_PREFIX}/metrics/usage?days=${USAGE_DAYS}`,
  USAGE_SUMMARY: `${ROUTE_PREFIX}/metrics/usage/summary?days=${USAGE_DAYS}`,
  CHANGES: `${ROUTE_PREFIX}/changes`,
  CHANGE_UNDO: `${ROUTE_PREFIX}/changes/{_id}/undo`,
  CHANGE_UNDO_CONFIRM: `${ROUTE_PREFIX}/changes/{id}/undo-confirm`,
  CHANGE_REDO: `${ROUTE_PREFIX}/changes/{_id}/redo`,
  ACTIVITY: `${ROUTE_PREFIX}/activity`,
  ACTIVITY_EXPORT: `${ROUTE_PREFIX}/activity/export.csv`,
  SKILLS_CATALOG: `${ROUTE_PREFIX}/skills/catalog`,
  SETTINGS: `${ROUTE_PREFIX}/settings`,
} as const;

/** Dashboard links between the pages. */
export const PAGE_LINKS = {
  CHANGES: `${MODULE_PAGES_PATH}/${PAGE_IDS.CHANGES}`,
  CHANGE_SET: `${MODULE_PAGES_PATH}/${PAGE_IDS.CHANGES}?set={_id}`,
  ACTIVITY: `${MODULE_PAGES_PATH}/${PAGE_IDS.ACTIVITY}`,
  SKILL_SETTINGS: `${MODULE_PAGES_PATH}/${PAGE_IDS.SETTINGS}#dms-form-${SETTINGS_FORM_KEY}-section-${SETTINGS_SKILLS_SECTION}`,
} as const;
