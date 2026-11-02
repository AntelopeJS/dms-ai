import path from "node:path";
import type { AlwaysAskPaths } from "../../agent/always-ask-files.js";
import { SECRET_FILE_GLOBS } from "./secret-file-globs.js";

export const CODEX_PERMISSION_PROFILES = {
  READ_ONLY: "dms-ai-read-only",
  EDIT_EXCEPT_HOOKS_AND_DEPENDENCIES:
    "dms-ai-edit-except-hooks-and-dependencies",
  EDIT_EXCEPT_HOOKS: "dms-ai-edit-except-hooks",
} as const;

export type CodexPermissionProfileId =
  (typeof CODEX_PERMISSION_PROFILES)[keyof typeof CODEX_PERMISSION_PROFILES];

export interface CodexPermissionProfile {
  base: ":read-only" | ":workspace";
  extraWorkspaceRoots: readonly string[];
  readOnlyPaths: readonly string[];
  unreadableGlobs: readonly string[];
  networkEnabled: boolean;
}

export interface CodexPermissionInput {
  hostProjectRoot: string;
  moduleRoots: readonly string[];
  alwaysAskPaths: AlwaysAskPaths;
}

const UNREADABLE_GLOBS = SECRET_FILE_GLOBS.map((glob) => `**/${glob}`);

function extraWorkspaceRoots(input: CodexPermissionInput): string[] {
  const host = path.resolve(input.hostProjectRoot);
  const roots = input.moduleRoots.map((root) => path.resolve(root));
  return [...new Set(roots)].filter((root) => root !== host);
}

export function buildPermissionProfiles(
  input: CodexPermissionInput,
): Record<CodexPermissionProfileId, CodexPermissionProfile> {
  const shared = {
    extraWorkspaceRoots: extraWorkspaceRoots(input),
    unreadableGlobs: UNREADABLE_GLOBS,
    networkEnabled: false,
  };
  const { gitHooks, dependencies } = input.alwaysAskPaths;
  return {
    [CODEX_PERMISSION_PROFILES.READ_ONLY]: {
      ...shared,
      base: ":read-only",
      readOnlyPaths: [],
    },
    [CODEX_PERMISSION_PROFILES.EDIT_EXCEPT_HOOKS_AND_DEPENDENCIES]: {
      ...shared,
      base: ":workspace",
      readOnlyPaths: [...gitHooks, ...dependencies],
    },
    [CODEX_PERMISSION_PROFILES.EDIT_EXCEPT_HOOKS]: {
      ...shared,
      base: ":workspace",
      readOnlyPaths: gitHooks,
    },
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function profileToml(id: string, profile: CodexPermissionProfile): string[] {
  return [
    `[permissions.${id}]`,
    `extends = ${tomlString(profile.base)}`,
    "",
    `[permissions.${id}.workspace_roots]`,
    ...profile.extraWorkspaceRoots.map((root) => `${tomlString(root)} = true`),
    "",
    `[permissions.${id}.filesystem]`,
    ...profile.readOnlyPaths.map((file) => `${tomlString(file)} = "read"`),
    "",
    `[permissions.${id}.filesystem.":workspace_roots"]`,
    ...profile.unreadableGlobs.map((glob) => `${tomlString(glob)} = "deny"`),
    "",
    `[permissions.${id}.network]`,
    `enabled = ${String(profile.networkEnabled)}`,
    "",
  ];
}

/**
 * Codex expands the unreadable globs again before each sandboxed command, so
 * a secret file created mid-session is denied too; the read-only paths are
 * the files found when the session started.
 */
export function buildPermissionProfilesToml(
  input: CodexPermissionInput,
): string[] {
  return Object.entries(buildPermissionProfiles(input)).flatMap(
    ([id, profile]) => profileToml(id, profile),
  );
}
