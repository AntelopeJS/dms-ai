import type { AssistantMode } from "../state/assistant-mode.js";
import type { AppSettings } from "../state/settings-types.js";
import type { AgentRunner } from "./runner.js";
import type { RunnerError } from "./runner-events.js";

export interface AssistantRunnerDeps {
  runners: Record<AssistantMode, AgentRunner>;
  /** The mode a conversation's next turn runs in. */
  modeOf: (conversationId: string) => AssistantMode;
}

const MODES: readonly AssistantMode[] = ["builder", "analyst"];

/**
 * One runner facade over Builder and Analyst. A conversation's session lives
 * on the runner of its mode; when the mode changes, the session it had on the
 * other runner is closed before the next turn, so no Builder context or tool
 * ever reaches an Analyst turn.
 */
export function createAssistantRunner(deps: AssistantRunnerDeps): AgentRunner {
  const { runners } = deps;
  const holders = new Map<string, AssistantMode>();
  const each = (act: (runner: AgentRunner) => void): void => {
    for (const mode of MODES) act(runners[mode]);
  };
  const forget = async (conversationId: string): Promise<void> => {
    holders.delete(conversationId);
    await Promise.all(
      MODES.map((mode) => runners[mode].disposeSession(conversationId)),
    );
  };
  async function* start(
    message: string,
    ctx: Parameters<AgentRunner["start"]>[1],
  ) {
    const mode = deps.modeOf(ctx.conversationId);
    const holder = holders.get(ctx.conversationId);
    if (holder !== undefined && holder !== mode) {
      await runners[holder].disposeSession(ctx.conversationId);
    }
    holders.set(ctx.conversationId, mode);
    yield* runners[mode].start(message, ctx);
  }
  return {
    start,
    interruptSession: (conversationId) =>
      each((runner) => runner.interruptSession(conversationId)),
    disposeSession: forget,
    applySettings: (settings: AppSettings) =>
      each((runner) => runner.applySettings(settings)),
    refreshSession: (conversationId) =>
      each((runner) => runner.refreshSession(conversationId)),
    dispose: async (reason?: RunnerError) => {
      holders.clear();
      await Promise.all(MODES.map((mode) => runners[mode].dispose(reason)));
    },
  };
}
