import type { query as RealQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  MOCK_CLAUDE_FLAG_ENABLED,
  MOCK_CLAUDE_FLAG_ENV,
  MOCK_CLAUDE_SDK_RELATIVE,
} from "../../constants/claude.js";

export interface LoadedSdk {
  query: typeof RealQuery;
}

function isMockEnabled(): boolean {
  return process.env[MOCK_CLAUDE_FLAG_ENV] === MOCK_CLAUDE_FLAG_ENABLED;
}

export async function loadSdk(): Promise<LoadedSdk> {
  if (!isMockEnabled()) {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    return { query };
  }
  const opaque: string = MOCK_CLAUDE_SDK_RELATIVE;
  const mock: unknown = await import(opaque);
  // SAFETY: the mock-claude fixture lives outside this program's rootDir, so its computed import is untyped; it exports a `query` that takes the SDK's `prompt` and `options` and returns the SDK's `Query`, the only member read here.
  return { query: (mock as LoadedSdk).query };
}
