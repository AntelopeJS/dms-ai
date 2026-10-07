import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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

type FieldValidator = (value: unknown) => boolean;

function isOneOf(values: readonly unknown[]): FieldValidator {
  return (value) => values.includes(value);
}

function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

// One validator per stored field: anything else in the file (an unknown key, a
// value from an older or newer version) falls back to the default. A legacy
// `mode: "auto"` therefore reads as the default `normal` (Full auto is per
// conversation now, never a stored default).
const FIELD_VALIDATORS: Record<keyof AppSettings, FieldValidator> = {
  provider: isOneOf(PROVIDER_NAMES),
  mode: isOneOf(CHAT_MODES),
  thinking: isOneOf(THINKING_LEVELS),
  generationMode: isOneOf(GENERATION_MODES),
  allowLocalSkills: isBoolean,
  alwaysAskDependencies: isBoolean,
  alwaysAskBlockRemoval: isBoolean,
  requestTimeoutMinutes: isOneOf(REQUEST_TIMEOUT_MINUTES),
  notifyRequests: isBoolean,
  checkpointRetentionDays: isOneOf(CHECKPOINT_RETENTION_DAYS),
};

const SETTINGS_KEYS = Object.keys(FIELD_VALIDATORS) as Array<keyof AppSettings>;

/**
 * Merges a partial update over `current`, keeping a field from `current`
 * whenever the update leaves it out or carries a value it does not accept.
 */
export function mergeSettings(
  current: AppSettings,
  patch: Partial<Record<keyof AppSettings, unknown>>,
): AppSettings {
  const merged: AppSettings = { ...current };
  for (const key of SETTINGS_KEYS) {
    const value = patch[key];
    if (FIELD_VALIDATORS[key](value)) Object.assign(merged, { [key]: value });
  }
  return merged;
}

export function parseSettings(raw: string): AppSettings {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return DEFAULT_SETTINGS;
    return mergeSettings(
      DEFAULT_SETTINGS,
      parsed as Partial<Record<keyof AppSettings, unknown>>,
    );
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
      err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
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
