import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

type QueueResolver = (result: IteratorResult<SDKUserMessage>) => void;

export interface InputQueue {
  stream: AsyncIterable<SDKUserMessage>;
  push: (message: SDKUserMessage) => void;
  close: () => void;
}

interface QueueState {
  buffer: SDKUserMessage[];
  pending: QueueResolver | null;
  closed: boolean;
}

function takeNext(state: QueueState): Promise<IteratorResult<SDKUserMessage>> {
  const next = state.buffer.shift();
  if (next !== undefined) return Promise.resolve({ value: next, done: false });
  if (state.closed) return Promise.resolve({ value: undefined, done: true });
  return new Promise((resolve) => {
    state.pending = resolve;
  });
}

function pushMessage(state: QueueState, message: SDKUserMessage): void {
  const resolver = state.pending;
  if (resolver === null) {
    state.buffer.push(message);
    return;
  }
  state.pending = null;
  resolver({ value: message, done: false });
}

function closeQueue(state: QueueState): void {
  state.closed = true;
  const resolver = state.pending;
  if (resolver === null) return;
  state.pending = null;
  resolver({ value: undefined, done: true });
}

export function createInputQueue(): InputQueue {
  const state: QueueState = { buffer: [], pending: null, closed: false };
  const stream: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({ next: () => takeNext(state) }),
  };
  return {
    stream,
    push: (message) => pushMessage(state, message),
    close: () => closeQueue(state),
  };
}
