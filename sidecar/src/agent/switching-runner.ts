import { PROVIDER_SWITCH_LOG } from "../constants/providers.js";
import { effectiveProvider } from "../providers/availability.js";
import type { AppSettings } from "../state/settings-types.js";
import type { ProviderName } from "../state/types.js";
import type { AgentRunner } from "./runner.js";

export type ProviderRunnerFactory = (settings: AppSettings) => AgentRunner;

/** Maps a selected provider to the one that will actually run. */
export type ProviderResolver = (name: ProviderName) => ProviderName;

interface SwitchState {
  build: Record<ProviderName, ProviderRunnerFactory>;
  resolve: ProviderResolver;
  settings: AppSettings;
  active: { name: ProviderName; runner: AgentRunner } | null;
}

function activate(state: SwitchState): AgentRunner {
  if (state.active !== null) return state.active.runner;
  const name = state.resolve(state.settings.provider);
  const runner = state.build[name](state.settings);
  state.active = { name, runner };
  return runner;
}

// Sessions belong to the backend that opened them: a process, a model
// connection and a tool loadout the other provider knows nothing about. So a
// provider change tears them down. Transcripts are untouched — only the live
// context of an open conversation is lost.
function switchProvider(state: SwitchState, next: ProviderName): void {
  const previous = state.active;
  state.active = null;
  if (previous === null) return;
  console.log(`${PROVIDER_SWITCH_LOG} ${previous.name} -> ${next}`);
  previous.runner.dispose();
}

function applySettings(state: SwitchState, settings: AppSettings): void {
  state.settings = settings;
  const next = state.resolve(settings.provider);
  if (state.active !== null && state.active.name !== next) {
    switchProvider(state, next);
    return;
  }
  state.active?.runner.applySettings(settings);
}

/**
 * One AgentRunner facade over every provider. The backend is built lazily on
 * first use and rebuilt when the `provider` setting changes, so a sidecar that
 * never leaves the default never spawns the other provider's machinery.
 */
export function createSwitchingRunner(
  build: Record<ProviderName, ProviderRunnerFactory>,
  settings: AppSettings,
  resolve: ProviderResolver = effectiveProvider,
): AgentRunner {
  const state: SwitchState = { build, resolve, settings, active: null };
  return {
    start: (message, ctx) => activate(state).start(message, ctx),
    interruptSession: (conversationId) =>
      activate(state).interruptSession(conversationId),
    disposeSession: (conversationId) =>
      activate(state).disposeSession(conversationId),
    applySettings: (next) => applySettings(state, next),
    dispose: () => {
      const previous = state.active;
      state.active = null;
      previous?.runner.dispose();
    },
  };
}

/** Provider actually driving new sessions, as recorded on a conversation. */
export function activeProviderName(settings: AppSettings): ProviderName {
  return effectiveProvider(settings.provider);
}
