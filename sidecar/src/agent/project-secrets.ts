import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import {
  AGENT_REQUIRED_ENV_NAMES,
  SECRET_FILE_NAME,
  SECRET_FILE_NAME_PREFIX,
  SECRET_FILE_TEMPLATE_NAMES,
} from "../constants/project-secrets.js";

type Environment = Record<string, string | undefined>;

const PATH_SEPARATOR = /[\\/]/;

/**
 * True when `filePath` is one of the project's secret files: `.env` or
 * `.env.<anything>`, except the committed templates. Only the file name counts.
 */
export function isSecretFile(filePath: string): boolean {
  const name = (filePath.split(PATH_SEPARATOR).at(-1) ?? "").toLowerCase();
  if (SECRET_FILE_TEMPLATE_NAMES.has(name)) return false;
  return name === SECRET_FILE_NAME || name.startsWith(SECRET_FILE_NAME_PREFIX);
}

function readSecretFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function listProjectRoot(projectRoot: string): string[] {
  try {
    return readdirSync(projectRoot);
  } catch {
    return [];
  }
}

function secretVariableNames(projectRoot: string): Set<string> {
  const names = new Set<string>();
  for (const entry of listProjectRoot(projectRoot)) {
    if (!isSecretFile(entry)) continue;
    const assigned = parseEnv(readSecretFile(join(projectRoot, entry)));
    for (const name of Object.keys(assigned)) names.add(name);
  }
  return names;
}

function isRequiredByAgent(name: string): boolean {
  return AGENT_REQUIRED_ENV_NAMES.has(name.toUpperCase());
}

function withoutSecrets(
  baseEnv: Environment,
  secretNames: ReadonlySet<string>,
) {
  return Object.fromEntries(
    Object.entries(baseEnv).filter(
      ([name]) => isRequiredByAgent(name) || !secretNames.has(name),
    ),
  );
}

/**
 * The environment an agent process starts with: the base one, minus the
 * variables the secret files directly in `projectRoot` assign. The variables
 * the agent needs to run stay.
 */
export function agentEnvironment(baseEnv: Environment, projectRoot: string) {
  return withoutSecrets(baseEnv, secretVariableNames(projectRoot));
}
