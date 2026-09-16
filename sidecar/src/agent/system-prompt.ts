import {
  SYSTEM_PROMPT_MODULES_NONE,
  SYSTEM_PROMPT_MODULES_SEPARATOR,
  SYSTEM_PROMPT_PLACEHOLDER_UNKNOWN,
  SYSTEM_PROMPT_TOKEN_HOST_ROOT,
  SYSTEM_PROMPT_TOKEN_MODULES,
  SYSTEM_PROMPT_TOKEN_NAME,
} from "../constants/agent.js";
import { SYSTEM_PROMPT_TEMPLATE } from "../prompts/agent.js";

export interface SystemPromptOptions {
  name?: string;
  hostProjectRoot: string;
  antelopeModules?: string[];
}

type Resolver = (opts: SystemPromptOptions) => string;

function resolveOptional(value: string | undefined): string {
  if (value === undefined) return SYSTEM_PROMPT_PLACEHOLDER_UNKNOWN;
  if (value.length === 0) return SYSTEM_PROMPT_PLACEHOLDER_UNKNOWN;
  return value;
}

function resolveModules(modules: string[] | undefined): string {
  if (modules === undefined) return SYSTEM_PROMPT_MODULES_NONE;
  if (modules.length === 0) return SYSTEM_PROMPT_MODULES_NONE;
  return modules.join(SYSTEM_PROMPT_MODULES_SEPARATOR);
}

const RESOLVERS: Record<string, Resolver> = {
  [SYSTEM_PROMPT_TOKEN_NAME]: (o) => resolveOptional(o.name),
  [SYSTEM_PROMPT_TOKEN_HOST_ROOT]: (o) => o.hostProjectRoot,
  [SYSTEM_PROMPT_TOKEN_MODULES]: (o) => resolveModules(o.antelopeModules),
};

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  let out = SYSTEM_PROMPT_TEMPLATE;
  for (const [token, resolve] of Object.entries(RESOLVERS)) {
    out = out.split(token).join(resolve(opts));
  }
  return out;
}
