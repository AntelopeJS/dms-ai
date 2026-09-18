import type { Readable, Writable } from "node:stream";
import {
  CODEX_REQUEST_TIMEOUT_MESSAGE,
  CODEX_TRANSPORT_CLOSED_MESSAGE,
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

export interface CodexRequestOptions {
  /**
   * Fails the request after this long with no answer. Reserved for the calls
   * that run outside a session's idle timer; a turn is never bounded here.
   */
  timeoutMs?: number;
}

export interface CodexClient {
  request<T>(
    method: string,
    params?: unknown,
    options?: CodexRequestOptions,
  ): Promise<T>;
  notify(method: string, params?: unknown): void;
  /**
   * Fails every in-flight request and every later one. Called on dispose, and
   * on the child's own death: the transport carries no other end-of-life
   * signal, so without it a request outlives the process answering it.
   */
  abort(reason: Error): void;
}

interface PendingRequest {
  reject: (reason: Error) => void;
  settle: (frame: JsonRpcFrame) => void;
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
  let aborted: Error | null = null;

  function write(payload: Record<string, unknown>): void {
    if (aborted !== null) return;
    stdin.write(
      `${JSON.stringify({ jsonrpc: JSONRPC_VERSION, ...payload })}${JSONRPC_LINE_SEPARATOR}`,
    );
  }

  function abort(reason: Error): void {
    if (aborted !== null) return;
    aborted = reason;
    const waiters = [...pending.values()];
    pending.clear();
    for (const waiter of waiters) waiter.reject(reason);
  }

  function settleResponse(frame: JsonRpcFrame): void {
    const id = Number(frame.id);
    const waiter = pending.get(id);
    if (waiter === undefined) return;
    pending.delete(id);
    waiter.settle(frame);
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

  function trackRequest<T>(
    id: number,
    options: CodexRequestOptions | undefined,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer =
        options?.timeoutMs === undefined
          ? null
          : setTimeout(() => {
              pending.delete(id);
              reject(new Error(CODEX_REQUEST_TIMEOUT_MESSAGE));
            }, options.timeoutMs);
      const clear = (): void => {
        if (timer !== null) clearTimeout(timer);
      };
      pending.set(id, {
        reject: (reason) => {
          clear();
          reject(reason);
        },
        settle: (frame) => {
          clear();
          if (frame.error !== undefined) {
            reject(new Error(frame.error.message));
            return;
          }
          resolve(frame.result as T);
        },
      });
    });
  }

  stdout.setEncoding("utf8");
  stdout.on("data", (chunk: string) => consume(chunk));
  // The only end-of-life the transport itself reports. The process watchdog
  // aborts with a better reason when it gets there first; this one covers a
  // stream that closes while the child lingers.
  stdout.on("close", () => abort(new Error(CODEX_TRANSPORT_CLOSED_MESSAGE)));

  return {
    request<T>(
      method: string,
      params?: unknown,
      options?: CodexRequestOptions,
    ): Promise<T> {
      if (aborted !== null) return Promise.reject(aborted);
      const id = nextId++;
      const settled = trackRequest<T>(id, options);
      write({ id, method, params: params ?? {} });
      return settled;
    },
    notify(method: string, params?: unknown): void {
      write({ method, params: params ?? {} });
    },
    abort,
  };
}
