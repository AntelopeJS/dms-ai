import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import {
  DEFAULT_SETTINGS,
  SETTINGS_LOG_PREFIX,
} from "../constants/settings.js";
import { STATE_FILE_ENCODING, STATE_JSON_INDENT } from "../constants/state.js";
import {
  type AppSettings,
  CHAT_MODES,
  CHECKPOINT_RETENTION_DAYS,
  GENERATION_MODES,
  REQUEST_TIMEOUT_MINUTES,
  THINKING_LEVELS,
} from "./settings-types.js";
import { PROVIDER_NAMES } from "./types.js";

export interface CreateSettingsStoreOptions {
  filePath: string;
}

export interface SettingsStore {
  get(): AppSettings;
  set(next: AppSettings): void;
  load(): Promise<void>;
  flush(): Promise<void>;
}

interface SettingsState {
  filePath: string;
  current: AppSettings;
  inflight: Promise<void> | null;
}

/**
 * One lenient schema per stored field: anything else in the file (an unknown
 * key, a value it does not accept) is ignored and the field keeps its current
 * value (the default when parsing a stored file).
 */
function lenient<T extends z.ZodType>(schema: T) {
  return z.unknown().pipe(schema).optional().catch(undefined);
}

const StoredSettingsSchema = z.object({
  provider: lenient(z.enum(PROVIDER_NAMES)),
  mode: lenient(z.enum(CHAT_MODES)),
  thinking: lenient(z.enum(THINKING_LEVELS)),
  generationMode: lenient(z.enum(GENERATION_MODES)),
  allowLocalSkills: lenient(z.boolean()),
  alwaysAskDependencies: lenient(z.boolean()),
  alwaysAskBlockRemoval: lenient(z.boolean()),
  requestTimeoutMinutes: lenient(z.literal(REQUEST_TIMEOUT_MINUTES)),
  notifyRequests: lenient(z.boolean()),
  checkpointRetentionDays: lenient(z.literal(CHECKPOINT_RETENTION_DAYS)),
});

type SettingsPatchInput = z.input<typeof StoredSettingsSchema>;

const SETTINGS_KEYS = StoredSettingsSchema.keyof().options;

/**
 * Merges a partial update over `current`, keeping a field from `current`
 * whenever the update leaves it out or carries a value it does not accept.
 */
export function mergeSettings(
  current: AppSettings,
  patch: SettingsPatchInput,
): AppSettings {
  const accepted = StoredSettingsSchema.parse(patch);
  const merged: AppSettings = { ...current };
  for (const key of SETTINGS_KEYS) {
    const value = accepted[key];
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

export function parseSettings(raw: string): AppSettings {
  try {
    const parsed = StoredSettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_SETTINGS;
    return mergeSettings(DEFAULT_SETTINGS, parsed.data);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function readSettings(filePath: string): Promise<AppSettings> {
  try {
    const raw = await readFile(filePath, STATE_FILE_ENCODING);
    return parseSettings(raw);
  } catch (err) {
    const isMissing =
      err instanceof Error && "code" in err && err.code === "ENOENT";
    if (isMissing) return DEFAULT_SETTINGS;
    console.warn(`${SETTINGS_LOG_PREFIX} read failed: ${String(err)}`);
    return DEFAULT_SETTINGS;
  }
}

async function persistSettings(
  filePath: string,
  settings: AppSettings,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const json = JSON.stringify(settings, null, STATE_JSON_INDENT);
  await writeFile(filePath, json, STATE_FILE_ENCODING);
}

function writeSettings(state: SettingsState): void {
  state.inflight = persistSettings(state.filePath, state.current).catch(
    (err) => {
      console.warn(`${SETTINGS_LOG_PREFIX} write failed: ${String(err)}`);
    },
  );
}

export function createSettingsStore(
  options: CreateSettingsStoreOptions,
): SettingsStore {
  const state: SettingsState = {
    filePath: options.filePath,
    current: DEFAULT_SETTINGS,
    inflight: null,
  };
  return {
    get: () => state.current,
    set: (next) => {
      state.current = next;
      writeSettings(state);
    },
    load: async () => {
      state.current = await readSettings(state.filePath);
    },
    flush: async () => {
      if (state.inflight !== null) await state.inflight;
    },
  };
}
