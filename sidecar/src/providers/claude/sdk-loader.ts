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

async function importDynamic(specifier: string): Promise<unknown> {
  const opaque: string = specifier;
  return import(opaque);
}

export async function loadSdk(): Promise<LoadedSdk> {
  const specifier = isMockEnabled()
    ? MOCK_CLAUDE_SDK_RELATIVE
    : REAL_SDK_PACKAGE;
  const mod = (await importDynamic(specifier)) as LoadedSdk;
  return { query: mod.query };
}
