import type { Readable, Writable } from "node:stream";
import {
  JSONRPC_LINE_SEPARATOR,
  JSONRPC_VERSION,
} from "../../constants/codex.js";

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcFrame {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

export interface CodexNotification {
  method: string;
  params: unknown;
}

export interface CodexServerRequest {
  id: number | string;
  method: string;
  params: unknown;
}

export interface CodexClientHandlers {
  onNotification: (notification: CodexNotification) => void;
  /** Resolved value is sent back as the JSON-RPC result. */
  onServerRequest: (request: CodexServerRequest) => Promise<unknown>;
}

export interface CodexClient {
  request<T>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  /** Fails every in-flight request; the transport itself is closed elsewhere. */
  abort(reason: Error): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

// Inbound frames carry an id in two unrelated spaces: a reply to one of our
// requests, and a request the server originates. Only the presence of `method`
// separates them.
function isServerRequest(frame: JsonRpcFrame): boolean {
  return frame.id !== undefined && frame.method !== undefined;
}

function isResponse(frame: JsonRpcFrame): boolean {
  return frame.id !== undefined && frame.method === undefined;
}

function parseFrame(line: string): JsonRpcFrame | null {
  try {
    const parsed = JSON.parse(line) as JsonRpcFrame;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function createCodexClient(
  stdin: Writable,
  stdout: Readable,
  handlers: CodexClientHandlers,
): CodexClient {
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let buffer = "";

  function write(payload: Record<string, unknown>): void {
    stdin.write(
      `${JSON.stringify({ jsonrpc: JSONRPC_VERSION, ...payload })}${JSONRPC_LINE_SEPARATOR}`,
    );
  }

  function settleResponse(frame: JsonRpcFrame): void {
    const waiter = pending.get(Number(frame.id));
    if (waiter === undefined) return;
    pending.delete(Number(frame.id));
    if (frame.error !== undefined) {
      waiter.reject(new Error(frame.error.message));
      return;
    }
    waiter.resolve(frame.result);
  }

  function serveRequest(frame: JsonRpcFrame): void {
    const id = frame.id as number | string;
    handlers
      .onServerRequest({
        id,
        method: frame.method as string,
        params: frame.params,
      })
      .then((result) => write({ id, result }))
      .catch((error: Error) => {
        write({ id, error: { code: -32603, message: error.message } });
      });
  }

  function dispatch(frame: JsonRpcFrame): void {
    if (isServerRequest(frame)) {
      serveRequest(frame);
      return;
    }
    if (isResponse(frame)) {
      settleResponse(frame);
      return;
    }
    if (frame.method === undefined) return;
    handlers.onNotification({ method: frame.method, params: frame.params });
  }

  function consume(chunk: string): void {
    buffer += chunk;
    const lines = buffer.split(JSONRPC_LINE_SEPARATOR);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const frame = parseFrame(line);
      if (frame !== null) dispatch(frame);
    }
  }

  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => consume(chunk));

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        write({ id, method, params: params ?? {} });
      });
    },
    notify(method: string, params?: unknown): void {
      write({ method, params: params ?? {} });
    },
    abort(reason: Error): void {
      const waiters = [...pending.values()];
      pending.clear();
      for (const waiter of waiters) waiter.reject(reason);
    },
  };
}
