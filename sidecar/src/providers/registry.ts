import { PROVIDER_NAMES, type ProviderName } from "../state/types.js";
import { claudeModule } from "./claude/module.js";
import { codexModule } from "./codex/module.js";
import type { ProviderAvailabilityMap, ProviderModule } from "./types.js";

/** Every backend the sidecar can drive, each declaring its own wiring. */
export const PROVIDER_MODULES: Record<ProviderName, ProviderModule> = {
  claude: claudeModule,
  codex: codexModule,
};

/** Per-provider verdict, as exposed next to `builderAvailable` in GET /settings. */
export function getProviderAvailability(): ProviderAvailabilityMap {
  const entries = PROVIDER_NAMES.map((name) => [
    name,
    PROVIDER_MODULES[name].checkAvailability(),
  ]);
  return Object.fromEntries(entries) as ProviderAvailabilityMap;
}

export function isProviderAvailable(name: ProviderName): boolean {
  return PROVIDER_MODULES[name].checkAvailability().available;
}

/** Why the provider cannot be driven, or undefined when it can. */
export function providerUnavailableReason(
  name: ProviderName,
): string | undefined {
  return PROVIDER_MODULES[name].checkAvailability().reason;
}

/**
 * Clears whatever a previous sidecar left running, for every backend that has
 * something to clear. Runs before anything new starts.
 */
export async function reapOrphanProviders(stateDir: string): Promise<void> {
  const reaping: Promise<void>[] = [];
  for (const name of PROVIDER_NAMES) {
    const module = PROVIDER_MODULES[name];
    if (module.reapOrphans === undefined) continue;
    reaping.push(module.reapOrphans(stateDir));
  }
  await Promise.all(reaping);
}
