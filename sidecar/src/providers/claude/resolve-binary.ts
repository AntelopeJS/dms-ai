import { createRequire } from "node:module";
import { z } from "zod";
import {
  CLAUDE_BINARY_SUBPATH,
  CLAUDE_CODE_NATIVE_PREFIX,
  CLAUDE_CODE_PACKAGE,
  CLAUDE_WINDOWS_BINARY_SUBPATH,
  NATIVE_MUSL_SUFFIX,
  PLATFORM_LINUX,
  PLATFORM_WINDOWS,
} from "../../constants/native-binary.js";

const nodeReportSchema = z.object({
  header: z.object({ glibcVersionRuntime: z.string().optional() }).optional(),
});

function isGnuLibc(): boolean {
  const report = nodeReportSchema.safeParse(process.report?.getReport());
  return report.data?.header?.glibcVersionRuntime !== undefined;
}

/** The native package names of this platform, most fitting first. */
function nativePackageOrder(platform: string, arch: string): string[] {
  const base = `${CLAUDE_CODE_NATIVE_PREFIX}${platform}-${arch}`;
  if (platform !== PLATFORM_LINUX) return [base];
  const musl = `${base}${NATIVE_MUSL_SUFFIX}`;
  return isGnuLibc() ? [base, musl] : [musl, base];
}

function binarySubpath(platform: string): string {
  return platform === PLATFORM_WINDOWS
    ? CLAUDE_WINDOWS_BINARY_SUBPATH
    : CLAUDE_BINARY_SUBPATH;
}

/**
 * Resolves a native package through `@anthropic-ai/claude-code`, the package
 * that owns it, so the binary found is the one the installed claude-code
 * version pins.
 */
function resolveFromClaudeCode(
  packageName: string,
  platform: string,
): string | undefined {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const claudeCodeEntry = requireFromHere.resolve(
      `${CLAUDE_CODE_PACKAGE}/package.json`,
    );
    const requireFromClaudeCode = createRequire(claudeCodeEntry);
    return requireFromClaudeCode.resolve(
      `${packageName}${binarySubpath(platform)}`,
    );
  } catch {
    return undefined;
  }
}

function computeClaudeBinary(): string | undefined {
  const { platform, arch } = process;
  for (const packageName of nativePackageOrder(platform, arch)) {
    const resolved = resolveFromClaudeCode(packageName, platform);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

let cached: { value: string | undefined } | null = null;

/**
 * The CLI the Agent SDK must spawn: the `@anthropic-ai/claude-code`
 * dependency's native binary, so bumping that one package is what updates the
 * CLI. Undefined when it is not installed; the SDK then runs its bundled one.
 */
export function resolveClaudeBinary(): string | undefined {
  if (cached !== null) return cached.value;
  cached = { value: computeClaudeBinary() };
  return cached.value;
}
