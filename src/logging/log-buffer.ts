import logListener, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
import {
  LOG_BUFFER_CAP,
  LOG_QUERY_DEFAULT_LIMIT,
  LOG_QUERY_MAX_LIMIT,
} from "../constants/logs";
import type { BufferedLog, LogQuery } from "../types/logs";

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** Whatever `toString()` the value carries: its own, or Object's. */
interface Stringable {
  toString(): string;
}

/** An Error as the buffer keeps it: the fields that survive serialisation. */
function summarizeError(
  error: Error,
): Pick<Error, "name" | "message" | "stack"> {
  return { name: error.name, message: error.message, stack: error.stack };
}

/**
 * Keeps an object the buffer can serialise as it is. One that cannot be
 * serialised (a cycle, or a BigInt nested inside) becomes `toString()`'s
 * result, which keeps a custom `toString()` and only degrades to
 * "[object Object]" for a plain object.
 */
function sanitizeObject(value: Stringable): Stringable | string {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return value.toString();
  }
}

function sanitizeArgs(args: Log["args"]): BufferedLog["args"] {
  const sanitized: BufferedLog["args"] = [];
  for (const arg of args) {
    if (arg instanceof Error) sanitized.push(summarizeError(arg));
    else if (isObject(arg)) sanitized.push(sanitizeObject(arg));
    else sanitized.push(arg);
  }
  return sanitized;
}

function toBuffered(log: Log): BufferedLog {
  return {
    time: log.time,
    channel: log.channel,
    levelId: log.levelId,
    args: Array.isArray(log.args) ? sanitizeArgs(log.args) : [],
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return LOG_QUERY_DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), LOG_QUERY_MAX_LIMIT);
}

function matches(entry: BufferedLog, query: LogQuery): boolean {
  if (query.since !== undefined && entry.time < query.since) return false;
  if (query.level !== undefined && entry.levelId < query.level) return false;
  if (query.channel !== undefined && entry.channel !== query.channel) {
    return false;
  }
  return true;
}

interface LogBuffer {
  handler: (log: Log) => void;
  query(query: LogQuery): BufferedLog[];
}

function createLogBuffer(cap: number = LOG_BUFFER_CAP): LogBuffer {
  const entries: BufferedLog[] = [];
  return {
    handler: (log) => {
      entries.push(toBuffered(log));
      if (entries.length > cap) entries.splice(0, entries.length - cap);
    },
    query: (query) => {
      const limit = clampLimit(query.limit);
      const filtered = entries.filter((e) => matches(e, query));
      return filtered.slice(-limit).reverse();
    },
  };
}

const buffer = createLogBuffer();
let registered = false;

export function startLogCapture(): void {
  if (registered) return;
  registered = true;
  logListener.register(buffer.handler);
}

export function queryLogs(query: LogQuery): BufferedLog[] {
  return buffer.query(query);
}
