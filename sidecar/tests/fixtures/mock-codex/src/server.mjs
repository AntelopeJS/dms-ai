import { appendFileSync } from "node:fs";
import {
  COMPLETED_ITEM_STATUS,
  DEFAULT_DELAY_MS,
  DELAY_ENV_VAR,
  EMPTY_RESULT,
  FAILED_ITEM_STATUS,
  FALLBACK_RESULTS,
  INTERRUPTED_TURN_STATUS,
  ITEM_COMPLETED_METHOD,
  JSONRPC_VERSION,
  LINE_SEPARATOR,
  MCP_TOOL_CALL_ITEM,
  TRACE_ENV_VAR,
  TURN_COMPLETED_METHOD,
  TURN_INTERRUPT_METHOD,
  TURN_START_METHOD,
} from "./constants.mjs";
import { callMcpTool } from "./mcp.mjs";

function delayMs() {
  const raw = Number.parseInt(process.env[DELAY_ENV_VAR] ?? "", 10);
  return Number.isNaN(raw) ? DEFAULT_DELAY_MS : raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trace(entry) {
  const file = process.env[TRACE_ENV_VAR];
  if (file === undefined) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}${LINE_SEPARATOR}`);
  } catch {
    // A trace that cannot be written must never take the server down with it.
  }
}

function createTransport(stdin, stdout) {
  let buffer = "";
  return {
    write(payload) {
      stdout.write(
        `${JSON.stringify({ jsonrpc: JSONRPC_VERSION, ...payload })}${LINE_SEPARATOR}`,
      );
    },
    onFrame(handler) {
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(LINE_SEPARATOR);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          handler(JSON.parse(line));
        }
      });
    },
  };
}

function createState(dump) {
  return {
    dump,
    turnIndex: 0,
    nextRequestId: 0,
    pending: new Map(),
    interrupted: false,
  };
}

function turnCompleted(status) {
  return {
    method: TURN_COMPLETED_METHOD,
    params: { turn: { id: "mock-turn", status } },
  };
}

function itemOf(frame) {
  return frame.params?.item;
}

// A replayed mcpToolCall is executed for real against the sidecar's MCP
// binding, then its completion carries whatever came back.
async function completeMcpToolCall(frame) {
  const item = itemOf(frame);
  const { result, error } = await callMcpTool(item.tool, item.arguments);
  return {
    ...frame,
    params: {
      ...frame.params,
      item: {
        ...item,
        status:
          error === undefined ? COMPLETED_ITEM_STATUS : FAILED_ITEM_STATUS,
        result: result ?? null,
        error: error ?? null,
      },
    },
  };
}

async function resolveFrame(frame) {
  if (frame.method !== ITEM_COMPLETED_METHOD) return frame;
  if (itemOf(frame)?.type !== MCP_TOOL_CALL_ITEM) return frame;
  return completeMcpToolCall(frame);
}

function isServerRequest(frame) {
  return frame.id !== undefined && frame.method !== undefined;
}

function sendServerRequest(state, transport, frame) {
  const id = state.nextRequestId++;
  return new Promise((resolve) => {
    state.pending.set(id, resolve);
    transport.write({ id, method: frame.method, params: frame.params });
  });
}

async function replayFrame(state, transport, frame) {
  if (isServerRequest(frame)) {
    const decision = await sendServerRequest(state, transport, frame);
    trace({ kind: "decision", method: frame.method, decision });
    return;
  }
  transport.write(await resolveFrame(frame));
}

async function replayTurn(state, transport) {
  const frames = state.dump.turns[state.turnIndex] ?? [];
  state.turnIndex += 1;
  state.interrupted = false;
  for (const frame of frames) {
    if (state.interrupted) {
      transport.write(turnCompleted(INTERRUPTED_TURN_STATUS));
      return;
    }
    await sleep(delayMs());
    await replayFrame(state, transport, frame);
  }
  // A dump always ends its turn itself; a hand-built script need not.
  const last = frames.at(-1);
  if (last?.method !== TURN_COMPLETED_METHOD) {
    transport.write(turnCompleted(COMPLETED_ITEM_STATUS));
  }
}

function resultFor(state, method) {
  return (
    state.dump.responses.get(method) ?? FALLBACK_RESULTS[method] ?? EMPTY_RESULT
  );
}

function handleClientRequest(state, transport, frame) {
  transport.write({ id: frame.id, result: resultFor(state, frame.method) });
  if (frame.method === TURN_INTERRUPT_METHOD) {
    state.interrupted = true;
    return;
  }
  if (frame.method !== TURN_START_METHOD) return;
  void replayTurn(state, transport);
}

function handleFrame(state, transport, frame) {
  if (frame.method === undefined) {
    const waiter = state.pending.get(frame.id);
    if (waiter === undefined) return;
    state.pending.delete(frame.id);
    waiter(frame.result);
    return;
  }
  trace({ kind: "request", method: frame.method, params: frame.params });
  if (frame.id === undefined) return;
  handleClientRequest(state, transport, frame);
}

export function runAppServer(dump, stdin, stdout) {
  const state = createState(dump);
  const transport = createTransport(stdin, stdout);
  transport.onFrame((frame) => handleFrame(state, transport, frame));
}
