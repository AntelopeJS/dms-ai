import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  DEFAULT_SETTINGS,
  SETTINGS_LOG_PREFIX,
} from "../constants/settings.js";
import { STATE_FILE_ENCODING, STATE_JSON_INDENT } from "../constants/state.js";
import {
  type AppSettings,
  CHATBOX_MODES,
  type ChatboxMode,
  GENERATION_MODES,
  type GenerationMode,
  THINKING_LEVELS,
  type ThinkingLevel,
} from "./settings-types.js";

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

function isMode(value: unknown): value is ChatboxMode {
  return CHATBOX_MODES.includes(value as ChatboxMode);
}

function isThinking(value: unknown): value is ThinkingLevel {
  return THINKING_LEVELS.includes(value as ThinkingLevel);
}

function isGenerationMode(value: unknown): value is GenerationMode {
  return GENERATION_MODES.includes(value as GenerationMode);
}

export function parseSettings(raw: string): AppSettings {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return DEFAULT_SETTINGS;
    const candidate = parsed as Partial<AppSettings>;
    return {
      mode: isMode(candidate.mode) ? candidate.mode : DEFAULT_SETTINGS.mode,
      thinking: isThinking(candidate.thinking)
        ? candidate.thinking
        : DEFAULT_SETTINGS.thinking,
      generationMode: isGenerationMode(candidate.generationMode)
        ? candidate.generationMode
        : DEFAULT_SETTINGS.generationMode,
      allowLocalSkills:
        typeof candidate.allowLocalSkills === "boolean"
          ? candidate.allowLocalSkills
          : DEFAULT_SETTINGS.allowLocalSkills,
    };
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
