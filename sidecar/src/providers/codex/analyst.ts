import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  CODEX_ANALYST_CATALOG_DIR,
  CODEX_ANALYST_CATALOG_HOME_PREFIX,
  CODEX_ANALYST_FORBIDDEN_ITEM_MESSAGE,
  CODEX_ANALYST_FORBIDDEN_ITEM_TYPES,
  CODEX_BUNDLED_CATALOG_FLAG,
  CODEX_CATALOG_FORCED_TOOL_KEYS,
  CODEX_CATALOG_MAX_BYTES,
  CODEX_DEBUG_COMMAND,
  CODEX_DEBUG_MODELS_COMMAND,
  CODEX_HOME_ENV_VAR,
} from "../../constants/codex.js";
import { JsonValueSchema } from "../../protocol/json.js";
import type { CodexNotification } from "./client.js";
import type { RunnerError } from "../../agent/runner-events.js";
import {
  type CodexInstallation,
  readCodexBinaryVersion,
} from "./resolve-binary.js";

const runFile = promisify(execFile);

const catalogSchema = z.object({
  models: z.array(z.record(z.string(), JsonValueSchema)),
});

type CatalogModel = z.infer<typeof catalogSchema>["models"][number];

function withoutBuiltInTools(model: CatalogModel) {
  const kept = Object.entries(model).filter(
    ([key]) => !CODEX_CATALOG_FORCED_TOOL_KEYS.has(key),
  );
  return {
    ...Object.fromEntries(kept),
    experimental_supported_tools: [],
    supports_search_tool: false,
  };
}

/**
 * The Analyst copy of a `codex debug models` catalog: every model keeps its
 * own settings but loses the keys that force a built-in tool on, and offers no
 * experimental tool and no tool search.
 */
export function buildAnalystCatalog(catalogJson: string): string {
  const catalog = catalogSchema.parse(JSON.parse(catalogJson));
  return JSON.stringify({ models: catalog.models.map(withoutBuiltInTools) });
}

/**
 * The bundled catalog, read with a home of its own so nothing of the user's
 * Codex configuration or cache reaches it, and without touching the network.
 */
async function readBundledCatalog(
  installation: CodexInstallation,
): Promise<string> {
  const home = await mkdtemp(
    path.join(os.tmpdir(), CODEX_ANALYST_CATALOG_HOME_PREFIX),
  );
  try {
    const { stdout } = await runFile(
      installation.binaryPath,
      [
        ...installation.launchArgs,
        CODEX_DEBUG_COMMAND,
        CODEX_DEBUG_MODELS_COMMAND,
        CODEX_BUNDLED_CATALOG_FLAG,
      ],
      {
        env: { ...process.env, [CODEX_HOME_ENV_VAR]: home },
        encoding: "utf8",
        maxBuffer: CODEX_CATALOG_MAX_BYTES,
        windowsHide: true,
      },
    );
    return stdout;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

async function isPresent(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeCatalog(
  file: string,
  installation: CodexInstallation,
): Promise<void> {
  const catalog = buildAnalystCatalog(await readBundledCatalog(installation));
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, catalog);
  await rename(partial, file);
}

const catalogs = new Map<string, Promise<string>>();

/**
 * The path of the Analyst catalog for this binary, generated on first use and
 * kept under the state directory per Codex version, so a sidecar generates it
 * once and an upgrade gets its own. A failed generation is forgotten, so the
 * next Analyst session tries again.
 */
export function ensureAnalystCatalog(
  stateDir: string,
  installation: CodexInstallation,
): Promise<string> {
  const version =
    readCodexBinaryVersion(installation) ?? installation.pinnedVersion;
  const file = path.join(
    stateDir,
    CODEX_ANALYST_CATALOG_DIR,
    `${version}.json`,
  );
  const known = catalogs.get(file);
  if (known !== undefined) return known;
  const pending = (async () => {
    if (!(await isPresent(file))) await writeCatalog(file, installation);
    return file;
  })();
  catalogs.set(file, pending);
  pending.catch(() => catalogs.delete(file));
  return pending;
}

const itemNotificationSchema = z.object({
  item: z.object({ type: z.string() }),
});

const ITEM_NOTIFICATIONS: ReadonlySet<string> = new Set([
  "item/started",
  "item/completed",
]);

function forbiddenItemType(
  notification: CodexNotification,
): string | undefined {
  if (!ITEM_NOTIFICATIONS.has(notification.method)) return undefined;
  const parsed = itemNotificationSchema.safeParse(notification.params);
  if (!parsed.success) return undefined;
  const { type } = parsed.data.item;
  return CODEX_ANALYST_FORBIDDEN_ITEM_TYPES.has(type) ? type : undefined;
}

export interface AnalystItemGuard {
  /**
   * Whether the notification is withheld from the turn: an item only a
   * built-in tool produces. The first one ends the session.
   */
  intercepts(notification: CodexNotification): boolean;
}

/**
 * The second layer behind the Analyst configuration: should Codex still run a
 * built-in tool, its items never reach the chat and `stop` ends the session
 * with an error naming the item. Ending the session, not only the turn, drops
 * the thread that holds what the tool produced, so no later turn reads it.
 */
export function createAnalystItemGuard(
  stop: (reason: RunnerError) => void,
): AnalystItemGuard {
  let hasViolated = false;
  return {
    intercepts(notification) {
      const type = forbiddenItemType(notification);
      if (type === undefined) return false;
      if (!hasViolated) {
        hasViolated = true;
        stop({
          type: "error",
          message: `${CODEX_ANALYST_FORBIDDEN_ITEM_MESSAGE} ${type}`,
        });
      }
      return true;
    },
  };
}
