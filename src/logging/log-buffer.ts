import logListener, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
import {
  LOG_BUFFER_CAP,
  LOG_QUERY_DEFAULT_LIMIT,
  LOG_QUERY_MAX_LIMIT,
} from "../constants/logs";
import type { BufferedLog, LogQuery } from "../types/logs";

function sanitizeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      JSON.stringify(arg);
      return arg;
    } catch {
      // A cycle, or a BigInt nested inside. `String(arg)` keeps a custom
      // `toString()`, and only degrades to "[object Object]" for a plain
      // object -- which is what the buffer showed before either way.
      return String(arg);
    }
  }
  return arg;
}

function toBuffered(log: Log): BufferedLog {
  return {
    time: log.time,
    channel: log.channel,
    levelId: log.levelId,
    args: Array.isArray(log.args) ? log.args.map(sanitizeArg) : [],
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

export interface LogBuffer {
  handler: (log: Log) => void;
  query(query: LogQuery): BufferedLog[];
}

export function createLogBuffer(cap: number = LOG_BUFFER_CAP): LogBuffer {
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
