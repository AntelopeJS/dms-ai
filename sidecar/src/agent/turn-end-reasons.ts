import {
  DURATION_TOKEN,
  TURN_IDLE_TIMEOUT_MESSAGE,
  TURN_TOOL_CAP_MESSAGE,
} from "../constants/agent.js";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MIN_WHOLE_SECONDS = 1;
const DURATION_UNITS = { SECOND: "second", MINUTE: "minute" } as const;
const PLURAL_SUFFIX = "s";

function countOf(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : PLURAL_SUFFIX}`;
}

/** A window in words: whole minutes from one minute up, whole seconds below. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(MIN_WHOLE_SECONDS, Math.round(ms / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) {
    return countOf(seconds, DURATION_UNITS.SECOND);
  }
  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  return countOf(minutes, DURATION_UNITS.MINUTE);
}

/** Why a turn stopped after `windowMs` without any activity from the agent. */
export function idleTimeoutReason(windowMs: number): string {
  return TURN_IDLE_TIMEOUT_MESSAGE.replace(
    DURATION_TOKEN,
    formatDuration(windowMs),
  );
}

/** Why a turn stopped after a single tool call held it for `windowMs`. */
export function toolCapReason(windowMs: number): string {
  return TURN_TOOL_CAP_MESSAGE.replace(
    DURATION_TOKEN,
    formatDuration(windowMs),
  );
}
