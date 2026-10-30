import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TOOL_VERB_KEYS } from "../frontend-vue/app/chat/utils/tool-lexicon.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../frontend-vue");
const LOCALES = join(ROOT, "i18n/locales");
const SYNTAX_CHARACTER = /[@$]/;
const PANEL_NAMESPACES = ["panel", "tools", "common"];

/** Keys built at run time from a value, each with every value it can take. */
const PANEL_DYNAMIC_FAMILIES = {
  "dms_ai.panel.tool.state": [
    "done",
    "running",
    "waiting",
    "denied",
    "blocked",
    "failed",
    "stopped",
  ],
  "dms_ai.panel.change.status": ["added", "modified", "deleted"],
  "dms_ai.panel.change.typecheck": ["passed", "failed", "skipped"],
  "dms_ai.common.scope": ["safe", "vibe"],
  "dms_ai.common.agent": ["claude", "codex"],
  "dms_ai.panel.composer.scope_desc": ["safe", "vibe"],
  "dms_ai.panel.full_auto": [
    "duration_turn",
    "duration_30m",
    "duration_chat",
    "banner_turn",
    "banner_30m",
    "banner_chat",
  ],
  "dms_ai.panel.drawer": [
    "group_active",
    "group_today",
    "group_week",
    "group_older",
  ],
  "dms_ai.panel.empty": ["text_safe", "text_vibe"],
  "dms_ai.panel.approvals": [
    "why_deletes_data",
    "why_removes_code",
    "effect_adds_dependency",
    "effect_removes_dependency",
  ],
  "dms_ai.panel.rules": [
    "kind_file",
    "kind_directory",
    "kind_command",
    "kind_domain",
  ],
};

const VIEWS_DYNAMIC_FAMILIES = {
  "dms_ai.views.skills.source": ["module", "local"],
};

/**
 * @typedef {object} Surface
 * @property {string} name
 * @property {string} locale
 * @property {string[]} sources
 * @property {string[]} excluded
 * @property {RegExp} literalKey
 * @property {Record<string, string[]>} dynamicFamilies
 * @property {string[]} extraKeys
 * @property {string[] | undefined} namespaces
 */

/** @type {Surface[]} */
const SURFACES = [
  {
    name: "panel",
    locale: "dms-ai-panel",
    sources: [
      "app/chat",
      "app/runtime",
      "app/plugins",
      "app/components/ChatPanel.vue",
    ],
    excluded: [],
    literalKey:
      /["'`](dms_ai\.(?:panel|tools|common)\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g,
    dynamicFamilies: PANEL_DYNAMIC_FAMILIES,
    extraKeys: TOOL_VERB_KEYS.map((verb) => `dms_ai.tools.${verb}`),
    namespaces: PANEL_NAMESPACES,
  },
  {
    name: "views",
    locale: "dms-ai-views",
    sources: ["app/components", "app/views"],
    excluded: ["ChatPanel.vue"],
    literalKey: /["'`](dms_ai\.views\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g,
    dynamicFamilies: VIEWS_DYNAMIC_FAMILIES,
    extraKeys: [],
    namespaces: undefined,
  },
];

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function byName(left, right) {
  return left.localeCompare(right);
}

/**
 * @param {string} path
 * @param {string[]} excluded
 * @returns {string[]}
 */
function sourceFiles(path, excluded) {
  const full = join(ROOT, path);
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full)
    .filter((entry) => !excluded.includes(entry))
    .flatMap((entry) => sourceFiles(join(path, entry), excluded));
}

/**
 * @typedef {{ [key: string]: string | LocaleTree }} LocaleTree
 */

/** @type {z.ZodType<LocaleTree>} */
const LocaleTreeSchema = z.record(
  z.string(),
  z.union([z.string(), z.lazy(() => LocaleTreeSchema)]),
);

/**
 * @param {LocaleTree} tree
 * @param {string} prefix
 * @returns {string[]}
 */
function flatten(tree, prefix = "") {
  return Object.entries(tree).flatMap(([key, value]) =>
    value instanceof Object
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/**
 * @param {Surface} surface
 * @param {string} tag
 * @returns {LocaleTree}
 */
function readLocale(surface, tag) {
  const file = join(LOCALES, `${surface.locale}-${tag}.json`);
  return LocaleTreeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/**
 * @param {Surface} surface
 * @returns {string[]}
 */
function usedKeys(surface) {
  const source = surface.sources
    .flatMap((path) => sourceFiles(path, surface.excluded))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  return [
    ...new Set([...source.matchAll(surface.literalKey)].map((m) => m[1])),
  ];
}

/**
 * @param {Record<string, string[]>} families
 * @returns {string[]}
 */
function dynamicKeys(families) {
  return Object.entries(families).flatMap(([prefix, values]) =>
    values.map((value) => `${prefix}.${value}`),
  );
}

/**
 * @param {Surface} surface
 * @returns {string[]}
 */
function problems(surface) {
  const en = readLocale(surface, "en-GB");
  const fr = readLocale(surface, "fr-FR");
  const english = new Set(flatten(en));
  const french = new Set(flatten(fr));
  const found = [];
  for (const key of english) {
    if (!french.has(key))
      found.push(`${surface.name}: ${key} has no French string`);
  }
  for (const key of french) {
    if (!english.has(key))
      found.push(`${surface.name}: ${key} has no English string`);
  }
  const used = [
    ...usedKeys(surface),
    ...dynamicKeys(surface.dynamicFamilies),
    ...surface.extraKeys,
  ];
  if (used.length === 0) found.push(`${surface.name}: no key is used`);
  for (const key of used) {
    if (!english.has(key))
      found.push(`${surface.name}: ${key} is used but not translated`);
  }
  if (surface.namespaces !== undefined) {
    const owned = Object.keys(en.dms_ai).sort(byName).join();
    if (owned !== [...surface.namespaces].sort(byName).join()) {
      found.push(
        `${surface.name}: dms_ai holds ${owned}, not ${surface.namespaces.join()}`,
      );
    }
  }
  /** @type {[string, LocaleTree][]} */
  const locales = [
    ["en-GB", en],
    ["fr-FR", fr],
  ];
  for (const [tag, locale] of locales) {
    if (SYNTAX_CHARACTER.test(JSON.stringify(locale))) {
      found.push(
        `${surface.name} ${tag}: holds a character vue-i18n reads as syntax (@ or $)`,
      );
    }
  }
  return found;
}

const failures = SURFACES.flatMap(problems);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
}
