import { appendFileSync } from "node:fs";
import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { MOCK_TRACE_ENV_VAR } from "./constants.js";

export type DecidingLayer =
  | "hook"
  | "readOnly"
  | "mode"
  | "classifier"
  | "canUseTool"
  | "none";

interface TraceEntry {
  kind: string;
  name?: string;
  model?: string;
  decidedBy?: DecidingLayer;
  isAllowed?: boolean;
  permissionMode?: PermissionMode;
  plugins?: Options["plugins"];
  skills?: Options["skills"];
  mcpServers?: string[];
}

/**
 * Appends one entry to the trace file named by the environment, if any. A trace
 * that cannot be written is swallowed: tracing is never worth failing a session
 * for, same as in the Codex mock.
 */
export function appendTrace(entry: TraceEntry): void {
  const file = process.env[MOCK_TRACE_ENV_VAR];
  if (file === undefined) return;
  try {
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {}
}

export function traceOptions(options: Options | undefined): void {
  if (options === undefined) return;
  appendTrace({
    kind: "session",
    permissionMode: options.permissionMode,
    plugins: options.plugins,
    skills: options.skills,
    mcpServers: Object.keys(options.mcpServers ?? {}),
  });
}
