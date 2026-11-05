import {
  newQuickJSWASMModule,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  RELEASE_SYNC,
  shouldInterruptAfterDeadline,
} from "quickjs-emscripten";
import { z } from "zod";
import {
  ANALYST_COMPUTE_MEMORY_BYTES,
  ANALYST_COMPUTE_RESULT_CHARS,
  ANALYST_COMPUTE_STACK_BYTES,
  ANALYST_COMPUTE_TIMEOUT_MS,
} from "../constants/analyst.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";
import type { AnalystRow } from "./datasets.js";

/** What a script run gives back: its JSON result, or why it has none. */
export type SandboxOutcome =
  | { ok: true; value: JsonValue }
  | { ok: false; error: string };

const DATA_GLOBAL = "__dmsAiData";
const CODE_GLOBAL = "__dmsAiCode";

const SETUP = `(() => {
  "use strict";
  const data = JSON.parse(globalThis.${DATA_GLOBAL});
  delete globalThis.${DATA_GLOBAL};
  globalThis.datasets = data;
  for (const name of Object.keys(data)) {
    if (!(name in globalThis)) globalThis[name] = data[name];
  }
})()`;

const NO_RESULT = "The script returned nothing: end it with `return <value>`.";

const RUN = `(() => {
  "use strict";
  const stringify = JSON.stringify;
  const code = globalThis.${CODE_GLOBAL};
  delete globalThis.${CODE_GLOBAL};
  const AsyncFunction = (async () => {}).constructor;
  const script = new AsyncFunction(code);
  return script().then((value) =>
    value === undefined
      ? stringify({ ok: false, error: ${JSON.stringify(NO_RESULT)} })
      : stringify({ ok: true, value }),
  );
})()`;

const EnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: JsonValueSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

const TIME_LIMIT_ERROR = `The script ran longer than ${ANALYST_COMPUTE_TIMEOUT_MS / 1000} s: compute less, or load fewer rows.`;
const MEMORY_LIMIT_ERROR = `The script used more than ${ANALYST_COMPUTE_MEMORY_BYTES / 1024 / 1024} MB: compute less, or load fewer rows.`;
const RESULT_SIZE_ERROR = `The result is longer than ${ANALYST_COMPUTE_RESULT_CHARS} characters of JSON: aggregate further and return only what the answer needs.`;
const PENDING_ERROR =
  "The script awaited something that never settles: compute synchronously.";

function readString(vm: QuickJSContext, handle: QuickJSHandle) {
  return vm.typeof(handle) === "string" ? vm.getString(handle) : undefined;
}

function stringProp(vm: QuickJSContext, handle: QuickJSHandle, key: string) {
  const prop = vm.getProp(handle, key);
  try {
    return readString(vm, prop);
  } finally {
    prop.dispose();
  }
}

function describeError(
  vm: QuickJSContext,
  handle: QuickJSHandle,
  deadline: number,
): string {
  const message = stringProp(vm, handle, "message") ?? readString(vm, handle);
  if (Date.now() >= deadline && message === "interrupted") {
    return TIME_LIMIT_ERROR;
  }
  if (message === "out of memory") return MEMORY_LIMIT_ERROR;
  const name = stringProp(vm, handle, "name");
  const text = message ?? "The script failed.";
  return name === undefined ? text : `${name}: ${text}`;
}

function fail(
  vm: QuickJSContext,
  handle: QuickJSHandle,
  deadline: number,
): SandboxOutcome {
  try {
    return { ok: false, error: describeError(vm, handle, deadline) };
  } finally {
    handle.dispose();
  }
}

function readEnvelope(vm: QuickJSContext, handle: QuickJSHandle) {
  const length = vm.getProp(handle, "length");
  const tooLong = vm.getNumber(length) > ANALYST_COMPUTE_RESULT_CHARS * 2;
  length.dispose();
  if (tooLong) return { ok: false, error: RESULT_SIZE_ERROR } as const;
  const text = readString(vm, handle);
  if (text === undefined) return { ok: false, error: NO_RESULT } as const;
  const envelope = EnvelopeSchema.parse(JSON.parse(text));
  if (!envelope.ok) return envelope;
  return JSON.stringify(envelope.value).length > ANALYST_COMPUTE_RESULT_CHARS
    ? ({ ok: false, error: RESULT_SIZE_ERROR } as const)
    : envelope;
}

function settle(
  runtime: QuickJSRuntime,
  vm: QuickJSContext,
  promise: QuickJSHandle,
  deadline: number,
): SandboxOutcome {
  const jobs = runtime.executePendingJobs();
  if (jobs.error !== undefined) return fail(vm, jobs.error, deadline);
  const state = vm.getPromiseState(promise);
  if (state.type === "pending") return { ok: false, error: PENDING_ERROR };
  if (state.type === "rejected") return fail(vm, state.error, deadline);
  try {
    return readEnvelope(vm, state.value);
  } finally {
    state.value.dispose();
  }
}

function setGlobal(vm: QuickJSContext, name: string, value: string): void {
  const handle = vm.newString(value);
  vm.setProp(vm.global, name, handle);
  handle.dispose();
}

function evaluate(
  runtime: QuickJSRuntime,
  vm: QuickJSContext,
  datasets: ReadonlyMap<string, readonly AnalystRow[]>,
  code: string,
): SandboxOutcome {
  setGlobal(vm, DATA_GLOBAL, JSON.stringify(Object.fromEntries(datasets)));
  const setup = vm.evalCode(SETUP);
  if (setup.error !== undefined) {
    return fail(vm, setup.error, Number.POSITIVE_INFINITY);
  }
  setup.value.dispose();
  setGlobal(vm, CODE_GLOBAL, code);
  const deadline = Date.now() + ANALYST_COMPUTE_TIMEOUT_MS;
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const run = vm.evalCode(RUN);
  if (run.error !== undefined) return fail(vm, run.error, deadline);
  try {
    return settle(runtime, vm, run.value, deadline);
  } finally {
    run.value.dispose();
  }
}

/**
 * Runs `code`, the body of an async function, over a fresh copy of the
 * datasets in a QuickJS interpreter of its own: a new WebAssembly instance
 * with no host function, module loader, timer or I/O, under the time, memory
 * and stack limits. Every dataset is a global array under its name, and
 * `datasets` maps the names to them. The function's return value comes back
 * as JSON.
 */
export async function runAnalystScript(
  datasets: ReadonlyMap<string, readonly AnalystRow[]>,
  code: string,
): Promise<SandboxOutcome> {
  const quickJs = await newQuickJSWASMModule(RELEASE_SYNC);
  const runtime = quickJs.newRuntime();
  runtime.setMemoryLimit(ANALYST_COMPUTE_MEMORY_BYTES);
  runtime.setMaxStackSize(ANALYST_COMPUTE_STACK_BYTES);
  const vm = runtime.newContext();
  try {
    return evaluate(runtime, vm, datasets, code);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `The sandbox failed: ${reason}` };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
