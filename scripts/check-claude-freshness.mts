import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Compares the Claude Code and Agent SDK versions the lockfiles install with
 * npm's latest. Silent when fresh. Exit 1 prints what is behind; any other
 * failure (registry down, lockfile unreadable) exits 2, so it is never mistaken
 * for a stale install.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCKFILES = ["pnpm-lock.yaml", "sidecar/pnpm-lock.yaml"] as const;
const SDK = "@anthropic-ai/claude-agent-sdk";
const CLI = "@anthropic-ai/claude-code";
const PACKAGES = [SDK, CLI] as const;
const MAX_AGE_DAYS = 7;
const MAX_MINOR_DISTANCE = 1;
const MS_PER_DAY = 86_400_000;
const REGISTRY = "https://registry.npmjs.org";
const EXIT_FRESH = 0;
const EXIT_STALE = 1;
const EXIT_ERROR = 2;

type PackageName = (typeof PACKAGES)[number];
type Lockfile = (typeof LOCKFILES)[number];

const RegistryEntrySchema = z.object({
  "dist-tags": z.object({ latest: z.string() }),
  time: z.record(z.string(), z.string()),
  versions: z.record(
    z.string(),
    z.object({ claudeCodeVersion: z.string().optional() }),
  ),
});
type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

function installedVersion(lockfile: Lockfile, name: PackageName): string {
  const escaped = name.replaceAll("/", "\\/");
  const pattern = new RegExp(
    `'?${escaped}'?:\\s*\\n\\s*specifier:[^\\n]*\\n\\s*version:\\s*([0-9][^\\s(]*)`,
  );
  const match = pattern.exec(readFileSync(join(ROOT, lockfile), "utf8"));
  const version = match?.[1];
  if (version === undefined) throw new Error(`${name} is not in ${lockfile}`);
  return version;
}

function numbers(version: string): number[] {
  return version.split(".").map(Number);
}

/** Minors apart, counting a different major as infinitely far. */
function minorDistance(installed: string, latest: string): number {
  const [installedMajor = 0, installedMinor = 0] = numbers(installed);
  const [latestMajor = 0, latestMinor = 0] = numbers(latest);
  if (installedMajor !== latestMajor) return Number.POSITIVE_INFINITY;
  return latestMinor - installedMinor;
}

async function registryEntry(name: PackageName): Promise<RegistryEntry> {
  const response = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`);
  if (!response.ok) {
    throw new Error(`${name}: registry answered ${response.status}`);
  }
  return RegistryEntrySchema.parse(await response.json());
}

function staleness(
  name: PackageName,
  lockfile: Lockfile,
  installed: string,
  entry: RegistryEntry,
): string[] {
  const latest = entry["dist-tags"].latest;
  if (installed === latest) return [];
  const publishedAt = Date.parse(entry.time[latest] ?? "");
  const ageDays = (Date.now() - publishedAt) / MS_PER_DAY;
  const isRecent = ageDays <= MAX_AGE_DAYS;
  if (isRecent && minorDistance(installed, latest) <= MAX_MINOR_DISTANCE) {
    return [];
  }
  return [
    `${name} in ${lockfile} is ${installed}; npm latest is ${latest} (published ${Math.floor(ageDays)} days ago).`,
  ];
}

function lockstep(
  lockfile: Lockfile,
  sdkEntry: RegistryEntry,
  versions: Record<PackageName, string>,
): string[] {
  const builtFor = sdkEntry.versions[versions[SDK]]?.claudeCodeVersion;
  if (builtFor === undefined || builtFor === versions[CLI]) return [];
  return [
    `${lockfile} installs Agent SDK ${versions[SDK]}, built for Claude Code ${builtFor}, next to Claude Code ${versions[CLI]}.`,
  ];
}

async function main(): Promise<number> {
  const entries: Record<PackageName, RegistryEntry> = {
    [SDK]: await registryEntry(SDK),
    [CLI]: await registryEntry(CLI),
  };
  const report = LOCKFILES.flatMap((lockfile) => {
    const versions: Record<PackageName, string> = {
      [SDK]: installedVersion(lockfile, SDK),
      [CLI]: installedVersion(lockfile, CLI),
    };
    return [
      ...PACKAGES.flatMap((name) =>
        staleness(name, lockfile, versions[name], entries[name]),
      ),
      ...lockstep(lockfile, entries[SDK], versions),
    ];
  });
  if (report.length === 0) return EXIT_FRESH;
  console.log(report.map((line) => `- ${line}`).join("\n"));
  return EXIT_STALE;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(EXIT_ERROR);
  },
);
