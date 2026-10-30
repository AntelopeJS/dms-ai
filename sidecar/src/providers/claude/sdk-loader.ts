import type { query as RealQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  MOCK_CLAUDE_FLAG_ENABLED,
  MOCK_CLAUDE_FLAG_ENV,
  MOCK_CLAUDE_SDK_RELATIVE,
  REAL_SDK_PACKAGE,
} from "../../constants/claude.js";

export interface LoadedSdk {
  query: typeof RealQuery;
}

function isMockEnabled(): boolean {
  return process.env[MOCK_CLAUDE_FLAG_ENV] === MOCK_CLAUDE_FLAG_ENABLED;
}

export async function loadSdk(): Promise<LoadedSdk> {
  const specifier = isMockEnabled()
    ? MOCK_CLAUDE_SDK_RELATIVE
    : REAL_SDK_PACKAGE;
  const opaque: string = specifier;
  const mod: unknown = await import(opaque);
  return { query: (mod as LoadedSdk).query };
}
