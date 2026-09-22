export const REGISTRY_CACHE_TTL_MS = 30_000;
export const REGISTRY_PATH = "/ai/pages-registry";

export const SCAN_EXTENSIONS = [".vue", ".ts", ".js"] as const;
export const SCAN_IGNORE_DIRS = [
  "node_modules",
  "dist",
  ".nuxt",
  ".antelope",
  "build",
  ".output",
] as const;

export const IMPORT_REGEX_GLOBAL = /import\s+[^"']*?from\s+["']([^"']+)["']/g;

export const FIND_PAGES_TOOL_NAME = "FindPagesUsing";
export const FIND_PAGES_TOOL_DESCRIPTION =
  "Given a source filepath, returns the list of pages that import it (transitively via the local source tree).";

export const LIST_PAGES_TOOL_NAME = "ListPages";
export const LIST_PAGES_TOOL_DESCRIPTION =
  "Returns all registered DMS pages as {id, path, moduleId}, where `path` is the real route the page is served at. Use this to find a page's actual URL before navigating — never guess a route from a filename. Pass refresh:true after you create or edit a page so newly-registered pages appear.";
export const LIST_PAGES_EMPTY_MESSAGE =
  "No pages are currently registered (the backend may still be starting or reloading).";
export const LIST_PAGES_ERROR_MESSAGE =
  "Could not fetch the pages registry from the backend.";

export const MAX_BFS_DEPTH = 4;

export const REGISTRY_FETCH_TIMEOUT_MS = 5_000;

export const PAGES_LOG_PREFIX = "[pages]";
export const REGISTRY_STALE_FALLBACK_MESSAGE =
  "backend unreachable, serving stale registry cache";
