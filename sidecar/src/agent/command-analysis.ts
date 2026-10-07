// Shell control operators: a command made of several of these is judged
// segment by segment, never by its first words alone.
const SEGMENT_SEPARATORS = /&&|\|\||;|\||\n/;
// Constructs whose effect a prefix cannot vouch for: command substitution,
// backticks and redirections. A command holding one never matches a rule.
const UNRULABLE_CONSTRUCTS = /`|\$\(|>|</;
const WHITESPACE = /\s+/;
const FLAG_PREFIX = "-";
// Words of a command a "command" rule keeps: `pnpm test`, `git status`.
export const COMMAND_RULE_WORDS = 2;

const PACKAGE_MANAGERS: readonly string[] = ["pnpm", "npm", "yarn", "bun"];
const ADD_VERBS: readonly string[] = ["add"];
// `install` / `i` add a dependency only when they name a package.
const INSTALL_VERBS: readonly string[] = ["install", "i"];
const REMOVE_VERBS: readonly string[] = ["remove", "rm", "uninstall", "un"];
// Flags that take the next word as their value, so it is not the verb.
const VALUE_FLAGS: readonly string[] = [
  "--filter",
  "-F",
  "--dir",
  "-C",
  "--prefix",
  "--cwd",
];

const LOCKFILE_BY_MANAGER: Record<string, string> = {
  pnpm: "pnpm-lock.yaml",
  npm: "package-lock.json",
  yarn: "yarn.lock",
  bun: "bun.lock",
};
const PACKAGE_MANIFEST = "package.json";

export type DependencyEffect = "adds_dependency" | "removes_dependency";

export interface DependencyChange {
  effect: DependencyEffect;
  touches: string[];
}

interface VerbAt {
  verb: string;
  rest: string[];
}

export function splitSegments(command: string): string[] {
  return command
    .split(SEGMENT_SEPARATORS)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function words(segment: string): string[] {
  return segment.split(WHITESPACE).filter((word) => word.length > 0);
}

function findVerb(args: string[]): VerbAt | null {
  for (let i = 0; i < args.length; i++) {
    const word = args[i] as string;
    if (VALUE_FLAGS.includes(word)) {
      i++;
      continue;
    }
    if (word.startsWith(FLAG_PREFIX)) continue;
    return { verb: word, rest: args.slice(i + 1) };
  }
  return null;
}

function namesPackage(rest: string[]): boolean {
  return rest.some((word) => !word.startsWith(FLAG_PREFIX));
}

function effectOfVerb(at: VerbAt): DependencyEffect | null {
  if (ADD_VERBS.includes(at.verb)) return "adds_dependency";
  if (REMOVE_VERBS.includes(at.verb)) return "removes_dependency";
  if (INSTALL_VERBS.includes(at.verb) && namesPackage(at.rest)) {
    return "adds_dependency";
  }
  return null;
}

function segmentChange(segment: string): DependencyChange | null {
  const [manager, ...args] = words(segment);
  if (manager === undefined || !PACKAGE_MANAGERS.includes(manager)) {
    return null;
  }
  const at = findVerb(args);
  const effect = at === null ? null : effectOfVerb(at);
  if (effect === null) return null;
  const lockfile = LOCKFILE_BY_MANAGER[manager] as string;
  return { effect, touches: [PACKAGE_MANIFEST, lockfile] };
}

/** Whether a shell command adds or removes a dependency, and what it edits. */
export function detectDependencyChange(
  command: string,
): DependencyChange | null {
  for (const segment of splitSegments(command)) {
    const change = segmentChange(segment);
    if (change !== null) return change;
  }
  return null;
}

/** The prefix a "command" rule for this command would allow, if any. */
export function commandRulePrefix(command: string): string | null {
  if (UNRULABLE_CONSTRUCTS.test(command)) return null;
  const segments = splitSegments(command);
  if (segments.length !== 1) return null;
  const prefix = words(segments[0] as string)
    .slice(0, COMMAND_RULE_WORDS)
    .join(" ");
  return prefix.length > 0 ? prefix : null;
}

function startsWithWords(segment: string, prefix: string): boolean {
  const normalized = words(segment).join(" ");
  return normalized === prefix || normalized.startsWith(`${prefix} `);
}

/**
 * Whether every segment of `command` starts with one of the allowed prefixes.
 * Substitutions and redirections never match: their effect is not in the prefix.
 */
export function isCommandCovered(
  command: string,
  prefixes: readonly string[],
): boolean {
  if (prefixes.length === 0 || UNRULABLE_CONSTRUCTS.test(command)) {
    return false;
  }
  const segments = splitSegments(command);
  if (segments.length === 0) return false;
  return segments.every((segment) =>
    prefixes.some((prefix) => startsWithWords(segment, prefix)),
  );
}
