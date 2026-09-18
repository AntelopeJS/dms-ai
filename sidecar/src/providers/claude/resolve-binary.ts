import { createRequire } from "node:module";
import { REAL_SDK_PACKAGE } from "../../constants/claude.js";
import {
  CLAUDE_BINARY_SUBPATH,
  PLATFORM_LINUX,
  SDK_NATIVE_LINUX_PREFIX,
  SDK_NATIVE_MUSL_SUFFIX,
} from "../../constants/native-binary.js";

interface NodeReport {
  header?: { glibcVersionRuntime?: string };
}

function isGnuLibc(): boolean {
  const report = process.report?.getReport() as NodeReport | undefined;
  if (typeof report !== "object" || report === null) return false;
  return report.header?.glibcVersionRuntime !== undefined;
}

function nativePackageOrder(arch: string): string[] {
  const base = `${SDK_NATIVE_LINUX_PREFIX}${arch}`;
  const musl = `${base}${SDK_NATIVE_MUSL_SUFFIX}`;
  return isGnuLibc() ? [base, musl] : [musl, base];
}

function resolveFromSdk(packageName: string): string | undefined {
  try {
    const requireFromHere = createRequire(import.meta.url);
    const sdkEntry = requireFromHere.resolve(REAL_SDK_PACKAGE);
    const requireFromSdk = createRequire(sdkEntry);
    return requireFromSdk.resolve(`${packageName}${CLAUDE_BINARY_SUBPATH}`);
  } catch {
    return undefined;
  }
}

function computeClaudeBinary(): string | undefined {
  if (process.platform !== PLATFORM_LINUX) return undefined;
  for (const packageName of nativePackageOrder(process.arch)) {
    const resolved = resolveFromSdk(packageName);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

let cached: { value: string | undefined } | null = null;

export function resolveClaudeBinary(): string | undefined {
  if (cached !== null) return cached.value;
  cached = { value: computeClaudeBinary() };
  return cached.value;
}
