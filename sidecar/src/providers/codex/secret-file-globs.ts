import {
  SECRET_FILE_NAME,
  SECRET_FILE_NAME_PREFIX,
  SECRET_FILE_TEMPLATE_NAMES,
} from "../../constants/project-secrets.js";

const TEMPLATE_SUFFIXES = [...SECRET_FILE_TEMPLATE_NAMES].map((name) =>
  name.slice(SECRET_FILE_NAME_PREFIX.length),
);

function caseless(text: string): string {
  return text
    .split("")
    .map((character) => {
      const lower = character.toLowerCase();
      const upper = character.toUpperCase();
      return lower === upper ? character : `[${lower}${upper}]`;
    })
    .join("");
}

function noneOf(characters: ReadonlySet<string>): string {
  const cases = [...characters].flatMap((character) => [
    character.toLowerCase(),
    character.toUpperCase(),
  ]);
  return `[!${[...new Set(cases)].join("")}]`;
}

function nextCharacters(stem: string): Set<string> {
  return new Set(
    TEMPLATE_SUFFIXES.filter(
      (suffix) => suffix.length > stem.length && suffix.startsWith(stem),
    ).map((suffix) => suffix.charAt(stem.length)),
  );
}

function suffixGlobs(stem: string): string[] {
  const head = caseless(SECRET_FILE_NAME_PREFIX + stem);
  const next = nextCharacters(stem);
  const exact = TEMPLATE_SUFFIXES.includes(stem) ? [] : [head];
  const longer = next.size === 0 ? `${head}?*` : `${head}${noneOf(next)}*`;
  return [
    ...exact,
    longer,
    ...[...next].flatMap((character) => suffixGlobs(stem + character)),
  ];
}

/**
 * File-name globs, in the git-style syntax of Codex permission profiles, that
 * together match exactly the project's secret files: `.env` and `.env.*`
 * except the committed templates, in any letter case. Codex globs only deny,
 * so the templates are left out by spelling the rest of `.env.*` out instead
 * of being allowed back.
 */
export const SECRET_FILE_GLOBS: readonly string[] = [
  caseless(SECRET_FILE_NAME),
  ...suffixGlobs(""),
];
