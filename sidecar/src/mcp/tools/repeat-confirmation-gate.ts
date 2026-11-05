import { z } from "zod";
import { asksBeforeBuilderCall } from "../../agent/tool-kinds.js";
import { type JsonValue, JsonValueSchema } from "../../protocol/json.js";
import type { BuilderGate } from "./builder-gate.js";

/** How long a refused call stays confirmable by an identical second call. */
export const REPEAT_CONFIRMATION_WINDOW_MS = 10 * 60_000;

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

function sortKeys(_key: string, inner: JsonValue): JsonValue {
  if (Array.isArray(inner)) return inner;
  const object = JsonObjectSchema.safeParse(inner);
  if (!object.success) return inner;
  return Object.fromEntries(
    Object.entries(object.data).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/** The JSON text of a value with every object's keys sorted, so two equal calls compare equal. */
function canonical(value: JsonValue): string {
  return JSON.stringify(value, sortKeys);
}

function describe(toolName: string, details: string): string {
  return [
    `${toolName} was not run. Outside the dashboard chat no one has confirmed it yet.`,
    `Its arguments, with the changes the Builder previewed: ${details}`,
    "Show this to the integrator and ask them. Only if they confirm, call the tool again with exactly the same arguments within 10 minutes; that call runs it.",
  ].join("\n");
}

/**
 * The Builder gate for agent sessions outside the chat, which have no
 * confirmation card. A call the chat would hold for the person (a deletion, a
 * project configuration change, a mapping that removes pages) is refused once
 * with what it would do, and runs when the agent repeats it unchanged. The
 * gate sees the previewed pages and planned changes, so a repeat whose
 * preview differs is a new call and is refused again with the new list.
 */
export function createRepeatConfirmationGate(
  now: () => number = Date.now,
): BuilderGate {
  const pending = new Map<string, number>();
  return async (toolName, args) => {
    if (!asksBeforeBuilderCall(toolName, args)) return { isAllowed: true };
    const parsed = JsonValueSchema.safeParse(args);
    const text = parsed.success ? canonical(parsed.data) : null;
    if (text === null) {
      return {
        isAllowed: false,
        message: describe(toolName, "an unreadable change"),
      };
    }
    const key = `${toolName}\u0000${text}`;
    for (const [stale, until] of pending) {
      if (until < now() && stale !== key) pending.delete(stale);
    }
    const expiresAt = pending.get(key);
    pending.delete(key);
    if (expiresAt !== undefined && expiresAt >= now()) {
      return { isAllowed: true };
    }
    pending.set(key, now() + REPEAT_CONFIRMATION_WINDOW_MS);
    return { isAllowed: false, message: describe(toolName, text) };
  };
}
