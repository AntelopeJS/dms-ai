import type { GenerationMode } from "../state/settings-types.js";

// Whether the dms-builder interface is present this run (passed by the host via
// --builder-enabled). Read by the settings endpoints so both frontends can gate
// the safe-mode toggle. Fixed for the lifetime of the sidecar process.
let available = false;

export function setBuilderAvailable(value: boolean): void {
  available = value;
}

export function getBuilderAvailable(): boolean {
  return available;
}

export function effectiveGenerationMode(mode: GenerationMode): GenerationMode {
  return mode === "safe" && available ? "safe" : "vibe";
}
