import path from "node:path";
import { SECRET_FILE_GLOBS } from "./secret-file-globs.js";

export const CODEX_READ_ONLY_PROFILE = "dms-ai-read-only";

export interface CodexPermissionProfile {
  extraWorkspaceRoots: readonly string[];
  unreadableGlobs: readonly string[];
}

export interface CodexPermissionInput {
  hostProjectRoot: string;
  moduleRoots: readonly string[];
}

const UNREADABLE_GLOBS = SECRET_FILE_GLOBS.map((glob) => `**/${glob}`);

function extraWorkspaceRoots(input: CodexPermissionInput): string[] {
  const host = path.resolve(input.hostProjectRoot);
  const roots = input.moduleRoots.map((root) => path.resolve(root));
  return [...new Set(roots)].filter((root) => root !== host);
}

/**
 * The one profile every mode runs under: read-only, network closed, secret
 * files unreadable in the project and the module roots. A writable profile
 * cannot guard the dependency and git hook files: Codex fails to write an
 * approved patch to a file such a profile keeps read-only.
 */
export function buildPermissionProfile(
  input: CodexPermissionInput,
): CodexPermissionProfile {
  return {
    extraWorkspaceRoots: extraWorkspaceRoots(input),
    unreadableGlobs: UNREADABLE_GLOBS,
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Codex expands the unreadable globs again before each sandboxed command, so
 * a secret file created mid-session is denied too.
 */
export function buildPermissionProfileToml(
  input: CodexPermissionInput,
): string[] {
  const id = CODEX_READ_ONLY_PROFILE;
  const profile = buildPermissionProfile(input);
  return [
    `[permissions.${id}]`,
    'extends = ":read-only"',
    "",
    `[permissions.${id}.workspace_roots]`,
    ...profile.extraWorkspaceRoots.map((root) => `${tomlString(root)} = true`),
    "",
    `[permissions.${id}.filesystem.":workspace_roots"]`,
    ...profile.unreadableGlobs.map((glob) => `${tomlString(glob)} = "deny"`),
    "",
    `[permissions.${id}.network]`,
    "enabled = false",
    "",
  ];
}
