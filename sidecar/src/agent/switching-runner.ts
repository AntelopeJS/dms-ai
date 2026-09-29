import {
  PROVIDER_LABEL_TOKEN,
  PROVIDER_LABELS,
  PROVIDER_SWITCH_LOG,
  PROVIDER_UNAVAILABLE_ERROR,
} from "../constants/providers.js";
import { providerUnavailableReason } from "../providers/registry.js";
import type { AppSettings } from "../state/settings-types.js";
import type { ProviderName } from "../state/types.js";
import { createDisposalTracker, type DisposalTracker } from "./disposals.js";
import type { AgentRunner } from "./runner.js";

export type ProviderRunnerFactory = (settings: AppSettings) => AgentRunner;

/** Why a provider cannot be driven here, or undefined when it can. */
export type UnavailableReason = (name: ProviderName) => string | undefined;

interface SwitchState {
  build: Record<ProviderName, ProviderRunnerFactory>;
  unavailableReason: UnavailableReason;
  settings: AppSettings;
  active: { name: ProviderName; runner: AgentRunner } | null;
  retiring: DisposalTracker;
}

function unavailableError(name: ProviderName, reason: string): Error {
  const prefix = PROVIDER_UNAVAILABLE_ERROR.replace(
    PROVIDER_LABEL_TOKEN,
    PROVIDER_LABELS[name],
  );
  return new Error(`${prefix} ${reason}`);
}

/**
 * Builds the selected backend, or refuses. A provider the install cannot drive
 * fails the turn with its own reason rather than handing the conversation to
 * another one: the choice is the user's, and so is the model their code reaches.
 */
function activate(state: SwitchState): AgentRunner {
  if (state.active !== null) return state.active.runner;
  const name = state.settings.provider;
  const reason = state.unavailableReason(name);
  if (reason !== undefined) throw unavailableError(name, reason);
  const runner = state.build[name](state.settings);
  state.active = { name, runner };
  return runner;
}

// Sessions belong to the backend that opened them: a process, a model
// connection and a tool loadout the other provider knows nothing about. So a
// provider change tears them down. Transcripts are untouched — only the live
// context of an open conversation is lost. The switch does not wait for that
// teardown; a later dispose does.
function switchProvider(state: SwitchState, next: ProviderName): void {
  const previous = state.active;
  state.active = null;
  if (previous === null) return;
  console.log(`${PROVIDER_SWITCH_LOG} ${previous.name} -> ${next}`);
  state.retiring.track(previous.runner.dispose());
}

function retireActive(state: SwitchState): Promise<void> {
  const previous = state.active;
  state.active = null;
  if (previous !== null) state.retiring.track(previous.runner.dispose());
  return state.retiring.settle();
}

function applySettings(state: SwitchState, settings: AppSettings): void {
  state.settings = settings;
  if (state.active !== null && state.active.name !== settings.provider) {
    switchProvider(state, settings.provider);
    return;
  }
  state.active?.runner.applySettings(settings);
}

// An unavailable provider throws from activate(), and a turn that never started
// has nothing to interrupt or dispose — so these two answer quietly rather than
// failing a teardown on a backend that was never built.
function withActive<Result>(
  state: SwitchState,
  act: (runner: AgentRunner) => Result,
  idle: Result,
): Result {
  if (state.active === null) return idle;
  return act(state.active.runner);
}

/**
 * One AgentRunner facade over every provider. The backend is built lazily on
 * first use and rebuilt when the `provider` setting changes, so a sidecar that
 * never leaves the default never spawns the other provider's machinery.
 */
export function createSwitchingRunner(
  build: Record<ProviderName, ProviderRunnerFactory>,
  settings: AppSettings,
  unavailableReason: UnavailableReason = providerUnavailableReason,
): AgentRunner {
  const state: SwitchState = {
    build,
    unavailableReason,
    settings,
    active: null,
    retiring: createDisposalTracker(),
  };
  return {
    start: (message, ctx) => activate(state).start(message, ctx),
    interruptSession: (conversationId) =>
      withActive(
        state,
        (runner) => runner.interruptSession(conversationId),
        undefined,
      ),
    disposeSession: (conversationId) =>
      withActive(
        state,
        (runner) => runner.disposeSession(conversationId),
        Promise.resolve(),
      ),
    applySettings: (next) => applySettings(state, next),
    dispose: () => retireActive(state),
  };
}
