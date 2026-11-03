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
  type ChatMode,
  CHECKPOINT_RETENTION_DAYS,
  CODEX_CHAT_MODES,
  type CodexChatMode,
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

const FlatSettingsSchema = z.object({
  provider: lenient(z.enum(PROVIDER_NAMES)),
  thinking: lenient(z.enum(THINKING_LEVELS)),
  claudeModel: lenient(z.string().trim().min(1)),
  generationMode: lenient(z.enum(GENERATION_MODES)),
  allowLocalSkills: lenient(z.boolean()),
  alwaysAskDependencies: lenient(z.boolean()),
  alwaysAskBlockRemoval: lenient(z.boolean()),
  requestTimeoutMinutes: lenient(z.literal(REQUEST_TIMEOUT_MINUTES)),
  notifyRequests: lenient(z.boolean()),
  checkpointRetentionDays: lenient(z.literal(CHECKPOINT_RETENTION_DAYS)),
});

const StoredSettingsSchema = FlatSettingsSchema.extend({
  defaultModes: lenient(
    z.object({
      claude: lenient(z.enum(CHAT_MODES)),
      codex: lenient(z.enum(CODEX_CHAT_MODES)),
    }),
  ),
});

type SettingsPatchInput = z.input<typeof StoredSettingsSchema>;

const FLAT_SETTINGS_KEYS = FlatSettingsSchema.keyof().options;

const LegacySettingsSchema = z.object({ mode: lenient(z.enum(CHAT_MODES)) });

const LEGACY_MODE_SEEDS: Record<ChatMode, CodexChatMode> = {
  normal: "normal",
  auto: "normal",
  acceptEdits: "acceptEdits",
  plan: "plan",
};

/**
 * Merges a partial update over `current`, keeping a field, or one provider's
 * default mode, from `current` whenever the update leaves it out or carries a
 * value it does not accept.
 */
export function mergeSettings(
  current: AppSettings,
  patch: SettingsPatchInput,
): AppSettings {
  const accepted = StoredSettingsSchema.parse(patch);
  const merged: AppSettings = {
    ...current,
    defaultModes: {
      claude: accepted.defaultModes?.claude ?? current.defaultModes.claude,
      codex: accepted.defaultModes?.codex ?? current.defaultModes.codex,
    },
  };
  for (const key of FLAT_SETTINGS_KEYS) {
    const value = accepted[key];
    if (value !== undefined) Object.assign(merged, { [key]: value });
  }
  return merged;
}

function storedDefaults(legacy: ChatMode | undefined): AppSettings {
  if (legacy === undefined) return DEFAULT_SETTINGS;
  const seed = LEGACY_MODE_SEEDS[legacy];
  return { ...DEFAULT_SETTINGS, defaultModes: { claude: seed, codex: seed } };
}

export function parseSettings(raw: string): AppSettings {
  try {
    const stored: unknown = JSON.parse(raw);
    const parsed = StoredSettingsSchema.safeParse(stored);
    if (!parsed.success) return DEFAULT_SETTINGS;
    const legacy = LegacySettingsSchema.safeParse(stored).data?.mode;
    return mergeSettings(storedDefaults(legacy), parsed.data);
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
