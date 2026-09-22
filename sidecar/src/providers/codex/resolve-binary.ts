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
  CODEX_VERSION_WAIVER_ENABLED,
  CODEX_VERSION_WAIVER_ENV,
  CODEX_WINDOWS_BINARY_NAME,
  MOCK_CODEX_BINARY_RELATIVE,
  MOCK_CODEX_FLAG_ENABLED,
  MOCK_CODEX_FLAG_ENV,
  MOCK_CODEX_VERSION,
  WINDOWS_PLATFORM,
} from "../../constants/codex.js";
import {
  PROVIDER_INSTALLED_VERSION_TOKEN,
  PROVIDER_PINNED_VERSION_TOKEN,
  PROVIDER_UNAVAILABLE_REASONS,
  PROVIDER_UNKNOWN_VERSION,
} from "../../constants/providers.js";
import { CODEX_PROTOCOL_VERSION } from "./protocol/index.js";

export interface CodexInstallation {
  binaryPath: string;
  /**
   * Arguments that come before Codex's own, empty for the real binary. The mock
   * is a script, and Windows spawns no shebang, so it is launched through the
   * current node executable instead of being executed in place.
   */
  launchArgs: readonly string[];
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
    return {
      binaryPath,
      launchArgs: [],
      pinnedVersion: CODEX_PROTOCOL_VERSION,
    };
  } catch {
    return undefined;
  }
}

function mockInstallation(): CodexInstallation | undefined {
  if (process.env[MOCK_CODEX_FLAG_ENV] !== MOCK_CODEX_FLAG_ENABLED) {
    return undefined;
  }
  return {
    binaryPath: process.execPath,
    launchArgs: [
      fileURLToPath(new URL(MOCK_CODEX_BINARY_RELATIVE, import.meta.url)),
    ],
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

export function readCodexBinaryVersion(
  installation: CodexInstallation,
): string | undefined {
  try {
    const reported = execFileSync(
      installation.binaryPath,
      [...installation.launchArgs, CODEX_VERSION_ARGUMENT],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    return reported.match(CODEX_VERSION_PATTERN)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Lets an operator run a Codex release the shipped types were not generated
 * from. Codex ships about ten releases a month, so somebody tracking the latest
 * one needs a way through that does not involve waiting for a dms-ai release —
 * and it stays an explicit, logged opt-in rather than the default.
 */
export function isVersionGateWaived(): boolean {
  return process.env[CODEX_VERSION_WAIVER_ENV] === CODEX_VERSION_WAIVER_ENABLED;
}

/**
 * Whether the installed binary speaks the protocol the shipped types describe.
 * Codex versions the app-server protocol by binary, so a mismatch is refused at
 * spawn instead of degrading silently.
 */
export function isCodexInstallationUsable(
  installation: CodexInstallation,
): boolean {
  if (isVersionGateWaived()) return true;
  return readCodexBinaryVersion(installation) === installation.pinnedVersion;
}

/** Which versions disagree, and what to install to make them agree. */
export function describeVersionMismatch(
  installation: CodexInstallation,
): string {
  const installed =
    readCodexBinaryVersion(installation) ?? PROVIDER_UNKNOWN_VERSION;
  return PROVIDER_UNAVAILABLE_REASONS.CODEX_VERSION_MISMATCH.replaceAll(
    PROVIDER_PINNED_VERSION_TOKEN,
    installation.pinnedVersion,
  ).replace(PROVIDER_INSTALLED_VERSION_TOKEN, installed);
}
