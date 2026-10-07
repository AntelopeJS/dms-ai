import { randomUUID } from "node:crypto";
import type { RuleKind } from "../constants/audit.js";
import type { ActiveRuleType } from "../protocol/events.js";
import type { PermissionRuleType } from "../protocol/messages.js";
import { isCommandCovered } from "./command-analysis.js";
import {
  editTargetPaths,
  isWithinDirectory,
  resolveInProject,
} from "./edit-targets.js";
import { hostOf } from "./permission-preview.js";
import { isCommandTool, isEditTool, isWebTool } from "./tool-kinds.js";

const RULE_LABELS: Record<RuleKind, (value: string) => string> = {
  file: (value) => `Edits to ${value}`,
  directory: (value) => `Edits under ${value === "." ? "the project" : value}`,
  command: (value) => `Commands starting with "${value}"`,
  domain: (value) => `Requests to ${value}`,
};

export interface RuleSubject {
  toolName: string;
  args: unknown;
  hostProjectRoot: string;
}

/** The standing "allow" rules of every conversation, kept in memory only. */
export interface PermissionRuleStore {
  add(conversationId: string, rule: PermissionRuleType): ActiveRuleType;
  revoke(conversationId: string, ruleId: string): boolean;
  list(conversationId: string): ActiveRuleType[];
  matches(conversationId: string, subject: RuleSubject): boolean;
  forget(conversationId: string): void;
}

function argString(args: unknown, key: string): string {
  if (args === null || typeof args !== "object") return "";
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function resolvedTargets(subject: RuleSubject): string[] {
  return editTargetPaths(subject.args).map((target) =>
    resolveInProject(subject.hostProjectRoot, target),
  );
}

function coversEveryTarget(
  subject: RuleSubject,
  covers: (target: string) => boolean,
): boolean {
  if (!isEditTool(subject.toolName)) return false;
  const targets = resolvedTargets(subject);
  return targets.length > 0 && targets.every(covers);
}

type RuleMatcher = (rules: ActiveRuleType[], subject: RuleSubject) => boolean;

function valuesOf(rules: ActiveRuleType[], kind: RuleKind): string[] {
  return rules.filter((rule) => rule.kind === kind).map((rule) => rule.value);
}

function matchesEditRules(
  rules: ActiveRuleType[],
  subject: RuleSubject,
): boolean {
  const resolveValue = (value: string): string =>
    resolveInProject(subject.hostProjectRoot, value);
  const files = valuesOf(rules, "file").map(resolveValue);
  const directories = valuesOf(rules, "directory").map(resolveValue);
  return coversEveryTarget(
    subject,
    (target) =>
      files.includes(target) ||
      directories.some((directory) => isWithinDirectory(directory, target)),
  );
}

function matchesCommandRules(
  rules: ActiveRuleType[],
  subject: RuleSubject,
): boolean {
  if (!isCommandTool(subject.toolName)) return false;
  return isCommandCovered(
    argString(subject.args, "command"),
    valuesOf(rules, "command"),
  );
}

function matchesDomainRules(
  rules: ActiveRuleType[],
  subject: RuleSubject,
): boolean {
  if (!isWebTool(subject.toolName)) return false;
  const host = hostOf(argString(subject.args, "url"));
  return host !== null && valuesOf(rules, "domain").includes(host);
}

const RULE_MATCHERS: readonly RuleMatcher[] = [
  matchesEditRules,
  matchesCommandRules,
  matchesDomainRules,
];

export function ruleLabel(rule: PermissionRuleType): string {
  return RULE_LABELS[rule.kind](rule.value);
}

export function isSameRule(a: PermissionRuleType, b: PermissionRuleType) {
  return a.kind === b.kind && a.value === b.value;
}

export function createPermissionRuleStore(): PermissionRuleStore {
  const byConversation = new Map<string, ActiveRuleType[]>();
  const rulesOf = (conversationId: string): ActiveRuleType[] =>
    byConversation.get(conversationId) ?? [];
  return {
    add(conversationId, rule) {
      const existing = rulesOf(conversationId).find((r) => isSameRule(r, rule));
      if (existing !== undefined) return existing;
      const active: ActiveRuleType = {
        id: randomUUID(),
        kind: rule.kind,
        value: rule.value,
        label: ruleLabel(rule),
        createdAtMs: Date.now(),
      };
      byConversation.set(conversationId, [...rulesOf(conversationId), active]);
      return active;
    },
    revoke(conversationId, ruleId) {
      const rules = rulesOf(conversationId);
      const next = rules.filter((rule) => rule.id !== ruleId);
      byConversation.set(conversationId, next);
      return next.length !== rules.length;
    },
    list: (conversationId) => [...rulesOf(conversationId)],
    matches(conversationId, subject) {
      const rules = rulesOf(conversationId);
      if (rules.length === 0) return false;
      return RULE_MATCHERS.some((matcher) => matcher(rules, subject));
    },
    forget(conversationId) {
      byConversation.delete(conversationId);
    },
  };
}
