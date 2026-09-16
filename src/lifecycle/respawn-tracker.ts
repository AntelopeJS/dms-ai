import {
  SIDECAR_RESPAWN_MAX,
  SIDECAR_RESPAWN_WINDOW_MS,
} from "../constants/sidecar";

export interface RespawnTracker {
  recordAttempt(now: number): void;
  hasBudget(now: number): boolean;
}

export function createRespawnTracker(): RespawnTracker {
  let timestamps: number[] = [];

  function prune(now: number): void {
    const cutoff = now - SIDECAR_RESPAWN_WINDOW_MS;
    timestamps = timestamps.filter((t) => t >= cutoff);
  }

  function hasBudget(now: number): boolean {
    prune(now);
    return timestamps.length < SIDECAR_RESPAWN_MAX;
  }

  function recordAttempt(now: number): void {
    timestamps.push(now);
  }

  return { recordAttempt, hasBudget };
}
