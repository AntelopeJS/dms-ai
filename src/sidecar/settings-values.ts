import type { JsonBody } from "./json-body";

/** The sidecar's settings, by key. */
export type SettingsBody = Record<string, JsonBody>;

/** Settings whose value is a number in the sidecar and text in the form's selects. */
const NUMERIC_SETTINGS = [
  "requestTimeoutMinutes",
  "checkpointRetentionDays",
] as const;

export function withNumbersAs(
  settings: SettingsBody,
  convert: (value: JsonBody) => JsonBody,
) {
  const converted = { ...settings };
  for (const key of NUMERIC_SETTINGS) {
    if (converted[key] !== undefined && converted[key] !== null) {
      converted[key] = convert(converted[key]);
    }
  }
  return converted;
}

const DEFAULT_MODE_FIELDS = {
  claude: "defaultModeClaude",
  codex: "defaultModeCodex",
} as const;

const DEFAULT_MODES_KEY = "defaultModes";

function isRecord(value: JsonBody | undefined): value is SettingsBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenDefaultModes(settings: SettingsBody) {
  const { [DEFAULT_MODES_KEY]: modes, ...flat } = settings;
  if (!isRecord(modes)) return flat;
  for (const [provider, field] of Object.entries(DEFAULT_MODE_FIELDS)) {
    const mode = Object.hasOwn(modes, provider) ? modes[provider] : undefined;
    if (mode !== undefined) flat[field] = mode;
  }
  return flat;
}

/** Settings as the settings form's fields hold them: numbers as text, one field per provider's default mode. */
export function asFormValues(settings: SettingsBody): SettingsBody {
  return withNumbersAs(flattenDefaultModes(settings), String);
}

export function nestDefaultModes(update: SettingsBody) {
  const nested = { ...update };
  const modes: SettingsBody = {};
  for (const [provider, field] of Object.entries(DEFAULT_MODE_FIELDS)) {
    if (Object.hasOwn(nested, field)) modes[provider] = nested[field];
    delete nested[field];
  }
  if (Object.keys(modes).length > 0) nested[DEFAULT_MODES_KEY] = modes;
  return nested;
}
