import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  COMPLETED_ITEM_STATUS,
  DEFAULT_DELAY_MS,
  DELAY_ENV_VAR,
  EMPTY_RESULT,
  EXIT_DIRECTIVE_METHOD,
  FAIL_METHOD_ENV_VAR,
  FAILED_ITEM_STATUS,
  FALLBACK_RESULTS,
  GRANDCHILD_ARGS,
  GRANDCHILD_COMMAND,
  GRANDCHILD_PID_FILE_ENV_VAR,
  INTERRUPTED_TURN_STATUS,
  ITEM_COMPLETED_METHOD,
  JSONRPC_VERSION,
  LINE_SEPARATOR,
  MCP_TOOL_CALL_ITEM,
  REFUSED_ERROR_CODE,
  REFUSED_MESSAGE_PREFIX,
  TRACE_ENV_VAR,
  TURN_COMPLETED_METHOD,
  TURN_INTERRUPT_METHOD,
  TURN_START_METHOD,
} from "./constants.mjs";
import { FrameSchema } from "./dump.mjs";
import { callMcpTool } from "./mcp.mjs";

/**
 * @typedef {import("./dump.mjs").Frame} Frame
 * @typedef {import("./dump.mjs").RequestFrame} RequestFrame
 * @typedef {import("./dump.mjs").LoadedDump} LoadedDump
 */

/**
 * @typedef {object} Transport
 * @property {(payload: Record<string, unknown>) => void} write
 * @property {(handler: (frame: Frame) => void) => void} onFrame
 */

/**
 * @typedef {object} State
 * @property {LoadedDump} dump
 * @property {number} turnIndex
 * @property {number} nextRequestId
 * @property {Map<number | string, (result: unknown) => void>} pending
 * @property {boolean} interrupted
 */

const McpToolCallItemSchema = z.looseObject({
  type: z.literal(MCP_TOOL_CALL_ITEM),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

const ExitParamsSchema = z.object({ code: z.number().optional() });

function delayMs() {
  const raw = Number.parseInt(process.env[DELAY_ENV_VAR] ?? "", 10);
  return Number.isNaN(raw) ? DEFAULT_DELAY_MS : raw;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Appends one entry to the trace file named by the environment, if any. A trace
 * that cannot be written must never take the server down with it, so a failed
 * write is swallowed.
 *
 * @param {Record<string, unknown>} entry
 */
function trace(entry) {
  const file = process.env[TRACE_ENV_VAR];
  if (file === undefined) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}${LINE_SEPARATOR}`);
  } catch {}
}

/**
 * @param {import("node:stream").Readable} stdin
 * @param {import("node:stream").Writable} stdout
 * @returns {Transport}
 */
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
      stdin.on("data", (/** @type {string} */ chunk) => {
        buffer += chunk;
        const lines = buffer.split(LINE_SEPARATOR);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.trim() === "") continue;
          handler(FrameSchema.parse(JSON.parse(line)));
        }
      });
    },
  };
}

/**
 * @param {LoadedDump} dump
 * @returns {State}
 */
function createState(dump) {
  return {
    dump,
    turnIndex: 0,
    nextRequestId: 0,
    pending: new Map(),
    interrupted: false,
  };
}

/**
 * @param {string} status
 */
function turnCompleted(status) {
  return {
    method: TURN_COMPLETED_METHOD,
    params: { turn: { id: "mock-turn", status } },
  };
}

/**
 * A replayed mcpToolCall is executed for real against the sidecar's MCP
 * binding, then its completion carries whatever came back.
 *
 * @param {Frame} frame
 * @param {z.infer<typeof McpToolCallItemSchema>} item
 * @returns {Promise<Frame>}
 */
async function completeMcpToolCall(frame, item) {
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

/**
 * @param {Frame} frame
 * @returns {Promise<Frame>}
 */
async function resolveFrame(frame) {
  if (frame.method !== ITEM_COMPLETED_METHOD) return frame;
  const item = McpToolCallItemSchema.safeParse(frame.params?.item);
  if (!item.success) return frame;
  return completeMcpToolCall(frame, item.data);
}

/**
 * @param {Frame} frame
 * @returns {frame is RequestFrame}
 */
function isServerRequest(frame) {
  return frame.id !== undefined && frame.method !== undefined;
}

/**
 * @param {State} state
 * @param {Transport} transport
 * @param {RequestFrame} frame
 * @returns {Promise<unknown>}
 */
function sendServerRequest(state, transport, frame) {
  const id = state.nextRequestId++;
  return new Promise((resolve) => {
    state.pending.set(id, resolve);
    transport.write({ id, method: frame.method, params: frame.params });
  });
}

/**
 * @param {State} state
 * @param {Transport} transport
 * @param {Frame} frame
 */
async function replayFrame(state, transport, frame) {
  if (frame.method === EXIT_DIRECTIVE_METHOD) {
    process.exit(ExitParamsSchema.parse(frame.params ?? {}).code ?? 1);
  }
  if (isServerRequest(frame)) {
    const decision = await sendServerRequest(state, transport, frame);
    trace({ kind: "decision", method: frame.method, decision });
    return;
  }
  transport.write(await resolveFrame(frame));
}

/**
 * Replays the next recorded turn. A dump always ends its turn itself; a
 * hand-built script need not, so a turn-completed frame is appended when the
 * last frame is not one.
 *
 * @param {State} state
 * @param {Transport} transport
 */
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
  const last = frames.at(-1);
  if (last?.method !== TURN_COMPLETED_METHOD) {
    transport.write(turnCompleted(COMPLETED_ITEM_STATUS));
  }
}

/**
 * @param {State} state
 * @param {string} method
 * @returns {unknown}
 */
function resultFor(state, method) {
  return (
    state.dump.responses.get(method) ?? FALLBACK_RESULTS[method] ?? EMPTY_RESULT
  );
}

/**
 * @param {Transport} transport
 * @param {RequestFrame} frame
 */
function refuse(transport, frame) {
  transport.write({
    id: frame.id,
    error: {
      code: REFUSED_ERROR_CODE,
      message: `${REFUSED_MESSAGE_PREFIX} ${frame.method} (pid ${process.pid})`,
    },
  });
}

function startGrandchild() {
  const pidFile = process.env[GRANDCHILD_PID_FILE_ENV_VAR];
  if (pidFile === undefined) return;
  const grandchild = spawn(GRANDCHILD_COMMAND, GRANDCHILD_ARGS, {
    stdio: "ignore",
  });
  writeFileSync(pidFile, String(grandchild.pid));
}

/**
 * @param {State} state
 * @param {Transport} transport
 * @param {RequestFrame} frame
 */
function handleClientRequest(state, transport, frame) {
  if (frame.method === process.env[FAIL_METHOD_ENV_VAR]) {
    refuse(transport, frame);
    return;
  }
  transport.write({ id: frame.id, result: resultFor(state, frame.method) });
  if (frame.method === TURN_INTERRUPT_METHOD) {
    state.interrupted = true;
    return;
  }
  if (frame.method !== TURN_START_METHOD) return;
  startGrandchild();
  void replayTurn(state, transport);
}

/**
 * @param {State} state
 * @param {Transport} transport
 * @param {Frame} frame
 */
function handleFrame(state, transport, frame) {
  if (frame.method === undefined) {
    if (frame.id === undefined) return;
    const waiter = state.pending.get(frame.id);
    if (waiter === undefined) return;
    state.pending.delete(frame.id);
    waiter(frame.result);
    return;
  }
  trace({ kind: "request", method: frame.method, params: frame.params });
  if (!isServerRequest(frame)) return;
  handleClientRequest(state, transport, frame);
}

/**
 * @param {LoadedDump} dump
 * @param {import("node:stream").Readable} stdin
 * @param {import("node:stream").Writable} stdout
 */
export function runAppServer(dump, stdin, stdout) {
  const state = createState(dump);
  const transport = createTransport(stdin, stdout);
  transport.onFrame((frame) => handleFrame(state, transport, frame));
}
