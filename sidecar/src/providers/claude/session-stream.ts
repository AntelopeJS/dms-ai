import type {
  Query,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProviderSessionContext } from "../../agent/provider.js";
import type { RunnerEvent } from "../../agent/runner-events.js";
import type { AppSettings } from "../../state/settings-types.js";
import type { TokenUsage } from "../../state/types.js";
import { extractTokenUsage, messageToEvents } from "./adapter.js";
import type { InputQueue } from "./input-queue.js";
import {
  isModelRefusal,
  type ModelTrack,
  repliedModel,
} from "./model-fallback.js";

/**
 * Mutable settings cell shared by the session and the safe-mode hook, so a
 * safe/vibe flip is seen by the hook without rebuilding the SDK options.
 */
export interface LiveSettings {
  settings: AppSettings;
}

/** What the message stream of a session reads and drives. */
export interface StreamBackend {
  output: Query;
  queue: InputQueue;
  live: LiveSettings;
  /** The turn in flight, kept to send it again on the default model. */
  lastTurn: SDKUserMessage | null;
  model: ModelTrack;
}

/** What a session reports about the model it runs on. */
export interface ModelHooks {
  onModelUsed: ProviderSessionContext["onModelUsed"];
  onModelFallback: ProviderSessionContext["onModelFallback"];
  onTokenUsage: ((usage: TokenUsage) => void) | undefined;
}

/**
 * The API turned the configured model away. Puts the session on the CLI's
 * default model and sends the turn again; false when it already runs there.
 */
async function retryOnDefaultModel(backend: StreamBackend): Promise<boolean> {
  const { model, lastTurn, live } = backend;
  if (model.refused !== null || lastTurn === null) return false;
  try {
    await backend.output.setModel(undefined);
  } catch {
    return false;
  }
  model.refused = live.settings.claudeModel;
  model.announceFrom = model.refused;
  backend.queue.push(lastTurn);
  return true;
}

function observeModel(
  track: ModelTrack,
  message: SDKMessage,
  hooks: ModelHooks,
): void {
  const used = repliedModel(message);
  if (used === undefined) return;
  if (used !== track.active) {
    track.active = used;
    hooks.onModelUsed?.(used);
  }
  if (track.announceFrom === null) return;
  hooks.onModelFallback?.({ requested: track.announceFrom, used });
  track.announceFrom = null;
}

/**
 * Flattens the SDK's message stream into the neutral event vocabulary, so the
 * session lifecycle never sees an SDKMessage. A refusal of the configured model
 * never reaches the chat: the turn is sent again on the default model, and the
 * refusal is shown only when that cannot be done.
 */
export async function* toRunnerEvents(
  backend: StreamBackend,
  hooks: ModelHooks,
): AsyncGenerator<RunnerEvent, void> {
  let held: SDKMessage[] = [];
  while (true) {
    const result = await backend.output.next();
    if (result.done) return;
    const message = result.value;
    const usage = extractTokenUsage(message);
    if (usage !== null) hooks.onTokenUsage?.(usage);
    if (isModelRefusal(message)) {
      if (message.type === "assistant") {
        held.push(message);
        continue;
      }
      if (await retryOnDefaultModel(backend)) {
        held = [];
        continue;
      }
    }
    for (const earlier of held) yield* messageToEvents(earlier);
    held = [];
    observeModel(backend.model, message, hooks);
    yield* messageToEvents(message);
  }
}
