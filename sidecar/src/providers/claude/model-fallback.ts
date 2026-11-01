import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  CLAUDE_MODEL_REFUSAL_PATTERN,
  CLAUDE_SYNTHETIC_MODEL,
} from "../../constants/claude.js";

/**
 * The model one session runs on, as far as the sidecar knows. `refused` is the
 * configured model the API turned away: the session runs on the CLI's default
 * until the setting names another model.
 */
export interface ModelTrack {
  refused: string | null;
  /** The configured model whose refusal the next reply reports, once. */
  announceFrom: string | null;
  active: string | null;
}

export function createModelTrack(): ModelTrack {
  return { refused: null, announceFrom: null, active: null };
}

function textOf(message: SDKMessage): string {
  if (message.type === "result") {
    const reported =
      message.subtype === "success" ? [message.result] : (message.errors ?? []);
    return reported.join("\n");
  }
  if (message.type !== "assistant") return "";
  const { content } = message.message;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

/**
 * Whether a message is the CLI telling the user the requested model cannot be
 * used. Only a failed assistant reply or a failed result can be one.
 */
export function isModelRefusal(message: SDKMessage): boolean {
  if (message.type === "result") {
    if (!message.is_error) return false;
  } else if (message.type !== "assistant" || message.error === undefined) {
    return false;
  }
  return CLAUDE_MODEL_REFUSAL_PATTERN.test(textOf(message));
}

/** The model that produced a reply, or undefined for the CLI's own messages. */
export function repliedModel(message: SDKMessage): string | undefined {
  if (message.type !== "assistant") return undefined;
  const { model } = message.message;
  if (model === "") return undefined;
  return model === CLAUDE_SYNTHETIC_MODEL ? undefined : model;
}
