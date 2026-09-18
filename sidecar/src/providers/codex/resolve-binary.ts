import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODEX_BIN_DIR,
  CODEX_BINARY_NAME,
  CODEX_CLI_PACKAGE,
  CODEX_PLATFORM_PACKAGE_BY_TRIPLE,
  CODEX_TRIPLE_BY_HOST,
  CODEX_VENDOR_DIR,
  CODEX_VERSION_ARGUMENT,
  CODEX_VERSION_PATTERN,
  CODEX_WINDOWS_BINARY_NAME,
  MOCK_CODEX_BINARY_RELATIVE,
  MOCK_CODEX_FLAG_ENABLED,
  MOCK_CODEX_FLAG_ENV,
  MOCK_CODEX_VERSION,
  WINDOWS_PLATFORM,
} from "../../constants/codex.js";
import { CODEX_PROTOCOL_VERSION } from "./protocol/index.js";

export interface CodexInstallation {
  binaryPath: string;
  /** Version the shipped protocol types were generated from. */
  pinnedVersion: string;
}

function hostTriple(): string | undefined {
  return CODEX_TRIPLE_BY_HOST[`${process.platform}:${process.arch}`];
}

function binaryFileName(): string {
  return process.platform === WINDOWS_PLATFORM
    ? CODEX_WINDOWS_BINARY_NAME
    : CODEX_BINARY_NAME;
}

function computeInstallation(): CodexInstallation | undefined {
  const triple = hostTriple();
  if (triple === undefined) return undefined;
  try {
    // `@openai/codex` is an optional peer dependency: absent unless the
    // consumer opted in, so it is resolved by specifier and never imported.
    const launcher = createRequire(import.meta.url).resolve(
      `${CODEX_CLI_PACKAGE}/package.json`,
    );
    const platformManifest = createRequire(launcher).resolve(
      `${CODEX_PLATFORM_PACKAGE_BY_TRIPLE[triple]}/package.json`,
    );
    const binaryPath = path.join(
      path.dirname(platformManifest),
      CODEX_VENDOR_DIR,
      triple,
      CODEX_BIN_DIR,
      binaryFileName(),
    );
    if (!existsSync(binaryPath)) return undefined;
    return { binaryPath, pinnedVersion: CODEX_PROTOCOL_VERSION };
  } catch {
    return undefined;
  }
}

function mockInstallation(): CodexInstallation | undefined {
  if (process.env[MOCK_CODEX_FLAG_ENV] !== MOCK_CODEX_FLAG_ENABLED) {
    return undefined;
  }
  return {
    binaryPath: fileURLToPath(
      new URL(MOCK_CODEX_BINARY_RELATIVE, import.meta.url),
    ),
    pinnedVersion: MOCK_CODEX_VERSION,
  };
}

let cached: { value: CodexInstallation | undefined } | null = null;

/** The installed Codex extension, or undefined when it is not installed. */
export function resolveCodexInstallation(): CodexInstallation | undefined {
  // Deliberately outside the cache: tests turn the flag on and off between
  // cases, and the real resolution is the only part worth memoizing.
  const mock = mockInstallation();
  if (mock !== undefined) return mock;
  if (cached !== null) return cached.value;
  cached = { value: computeInstallation() };
  return cached.value;
}

export function readCodexBinaryVersion(binaryPath: string): string | undefined {
  try {
    const reported = execFileSync(binaryPath, [CODEX_VERSION_ARGUMENT], {
      encoding: "utf8",
    }).trim();
    return reported.match(CODEX_VERSION_PATTERN)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Whether the installed binary speaks the protocol the shipped types describe.
 * Codex versions the app-server protocol by binary and ships about ten releases
 * a month, so a mismatch is refused at spawn instead of degrading silently.
 */
export function isCodexInstallationUsable(
  installation: CodexInstallation,
): boolean {
  return (
    readCodexBinaryVersion(installation.binaryPath) ===
    installation.pinnedVersion
  );
}
