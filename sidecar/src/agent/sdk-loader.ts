import type { query as RealQuery } from "@anthropic-ai/claude-agent-sdk";
import {
  MOCK_FLAG_ENABLED,
  MOCK_FLAG_ENV,
  MOCK_SDK_RELATIVE,
  REAL_SDK_PACKAGE,
} from "../constants/agent.js";

export interface LoadedSdk {
  query: typeof RealQuery;
}

function isMockEnabled(): boolean {
  return process.env[MOCK_FLAG_ENV] === MOCK_FLAG_ENABLED;
}

async function importDynamic(specifier: string): Promise<unknown> {
  const opaque: string = specifier;
  return import(opaque);
}

export async function loadSdk(): Promise<LoadedSdk> {
  const specifier = isMockEnabled() ? MOCK_SDK_RELATIVE : REAL_SDK_PACKAGE;
  const mod = (await importDynamic(specifier)) as LoadedSdk;
  return { query: mod.query };
}
