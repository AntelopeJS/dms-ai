import type { RequestContext } from "@antelopejs/interface-api";
import {
  SSE_CONTENT_TYPE,
  SSE_HEADERS,
  SSE_KEEPALIVE_FRAME,
  SSE_KEEPALIVE_INTERVAL_MS,
  SSE_OK_STATUS,
} from "../constants/channels";

const LINE_BREAK = /\r\n|\r|\n/;

/** Where the frames of one long-lived response are written. */
export interface SseSink {
  write(chunk: string): boolean;
  end(): void;
  once(event: "drain", listener: () => void): unknown;
}

/** The response stream plus the signal that its client went away. */
export interface SseSource {
  sink: SseSink;
  onClientGone: (listener: () => void) => void;
}

export interface SseStream {
  /** Writes one event; false once the sink is full, until `onDrain` fires. */
  send: (eventName: string, data: string) => boolean;
  onDrain: (listener: () => void) => void;
  /** Runs once, whether the client left or `close` was called. */
  onClose: (listener: () => void) => void;
  close: () => void;
  isClosed: () => boolean;
}

function formatEvent(eventName: string, data: string): string {
  const lines = data.split(LINE_BREAK).map((line) => `data: ${line}`);
  return `event: ${eventName}\n${lines.join("\n")}\n\n`;
}

/** An event stream over any sink, with a keepalive comment. */
export function createSseStream(source: SseSource): SseStream {
  const closeListeners: Array<() => void> = [];
  let isClosed = false;
  const keepalive = setInterval(() => {
    source.sink.write(SSE_KEEPALIVE_FRAME);
  }, SSE_KEEPALIVE_INTERVAL_MS);
  keepalive.unref();
  const finish = (): void => {
    if (isClosed) return;
    isClosed = true;
    clearInterval(keepalive);
    for (const listener of closeListeners) listener();
  };
  source.onClientGone(finish);
  return {
    send: (eventName, data) =>
      !isClosed && source.sink.write(formatEvent(eventName, data)),
    onDrain: (listener) => source.sink.once("drain", listener),
    onClose: (listener) => {
      if (isClosed) listener();
      else closeListeners.push(listener);
    },
    close: () => {
      if (isClosed) return;
      finish();
      source.sink.end();
    },
    isClosed: () => isClosed,
  };
}

/**
 * Turns the request into an event stream. The response's own `close` tells
 * that the browser, or the frontend server relaying it, went away; a response
 * already closed never emits it again, so that case is answered at once.
 */
export function openSseStream(ctx: RequestContext): SseStream {
  for (const [name, value] of Object.entries(SSE_HEADERS)) {
    ctx.response.addHeader(name, value);
  }
  return createSseStream({
    sink: ctx.response.getWriteStream(SSE_CONTENT_TYPE, SSE_OK_STATUS),
    onClientGone: (listener) => {
      if (ctx.rawResponse.closed) listener();
      else ctx.rawResponse.once("close", listener);
    },
  });
}
