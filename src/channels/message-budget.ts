import type { IncomingMessage } from "node:http";
import {
  HTTPResult,
  type RequestContext,
  SetParameterProvider,
} from "@antelopejs/interface-api";
import { MakeParameterDecorator } from "@antelopejs/interface-core/decorators";
import {
  CHANNEL_MESSAGE_MAX_BYTES,
  CHANNEL_PENDING_MESSAGES_MAX_BYTES,
  CHANNEL_STATUS,
} from "../constants/channels";

const CONTENT_LENGTH_HEADER = "content-length";
const TOO_MANY_MESSAGES = { error: "too_many_messages" };

let pendingBytes = 0;

function declaredBytes(request: IncomingMessage): number {
  const declared = Number(request.headers[CONTENT_LENGTH_HEADER]);
  if (!Number.isFinite(declared) || declared < 0) {
    return CHANNEL_MESSAGE_MAX_BYTES;
  }
  return Math.min(declared, CHANNEL_MESSAGE_MAX_BYTES);
}

/**
 * Counts a posted message against the shared budget until its response is
 * over, or refuses it with 429 before a byte of its body is read.
 */
export function reserveMessageBytes(context: RequestContext): void {
  const bytes = declaredBytes(context.rawRequest);
  if (pendingBytes + bytes > CHANNEL_PENDING_MESSAGES_MAX_BYTES) {
    throw new HTTPResult(CHANNEL_STATUS.TOO_MANY_REQUESTS, TOO_MANY_MESSAGES);
  }
  pendingBytes += bytes;
  context.rawResponse.once("close", () => {
    pendingBytes -= bytes;
  });
}

/**
 * Parameter that reserves the message budget. Parameters resolve in order, so
 * it must come before the body parameter for a refusal to spare the read.
 */
export const MessageBudget = MakeParameterDecorator((target, key, param) =>
  SetParameterProvider(target, key, param, reserveMessageBytes),
);
