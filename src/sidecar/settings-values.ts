/** The sidecar's settings, by key. */
export type SettingsBody = Record<string, unknown>;

/** Settings whose value is a number in the sidecar and text in the form's selects. */
const NUMERIC_SETTINGS = [
  "requestTimeoutMinutes",
  "checkpointRetentionDays",
] as const;

export function withNumbersAs(
  settings: SettingsBody,
  convert: (value: unknown) => unknown,
): SettingsBody {
  const converted = { ...settings };
  for (const key of NUMERIC_SETTINGS) {
    if (converted[key] !== undefined && converted[key] !== null) {
      converted[key] = convert(converted[key]);
    }
  }
  return converted;
}

/** Settings as the settings form's fields hold them: numbers as text. */
export function asFormValues(settings: SettingsBody): SettingsBody {
  return withNumbersAs(settings, String);
}
