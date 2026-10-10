import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import { relay } from "./sidecar-results";

const SETTINGS_PATH = "/settings";

/** Settings whose value is a number in the sidecar and text in the form's selects. */
const NUMERIC_SETTINGS = [
  "requestTimeoutMinutes",
  "checkpointRetentionDays",
] as const;

/** What the form reads but never writes: the sidecar's capabilities. */
const READ_ONLY_SETTINGS = [
  "builderAvailable",
  "providers",
  "alwaysAskDeletions",
] as const;

/** Deletions always ask: the form shows it as a locked switch. */
const ALWAYS_ASK_DELETIONS = true;

type SettingsBody = Record<string, unknown>;

function withNumbersAs(
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

/** The flat settings object the form reads, with the read-only capabilities. */
function formSettings(settings: SettingsBody): SettingsBody {
  return {
    ...withNumbersAs(settings, String),
    alwaysAskDeletions: ALWAYS_ASK_DELETIONS,
  };
}

/** The partial update the sidecar takes: writable keys, numbers as numbers. */
function sidecarUpdate(body: SettingsBody): SettingsBody {
  const update = withNumbersAs(body, Number);
  for (const key of READ_ONLY_SETTINGS) delete update[key];
  return update;
}

/**
 * The settings form's route. Reads answer the flat settings plus what this
 * install can do; writes forward the one field an instant save sends. A
 * refusal (400) or an unreachable sidecar (503) answers `{ message }`, so the
 * form keeps the confirmed value and says "Not saved".
 */
@AuthOwnerOnly()
export class AISettingsController extends Controller(ROUTE_PREFIX) {
  @Get(SETTINGS_PATH)
  getSettings(): Promise<unknown> {
    return relay(SETTINGS_PATH, formSettings);
  }

  @Put(SETTINGS_PATH)
  updateSettings(@JSONBody() body?: SettingsBody): Promise<unknown> {
    return relay(SETTINGS_PATH, formSettings, {
      method: "PUT",
      body: sidecarUpdate(body ?? {}),
    });
  }
}
