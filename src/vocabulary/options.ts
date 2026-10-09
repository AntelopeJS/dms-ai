import type { Tone } from "@antelopejs/interface-dms/base/types";
import { i18nKey } from "./keys";
import { LOGGED_TOOLS } from "./tools";
import type { Vocabulary, VocabularyOption } from "./types";

/** The label key of one value of an enumeration. */
export function vocabularyLabel(
  section: string,
  group: string,
  value: string,
): string {
  return i18nKey(section, group, value);
}

/** Select options of an enumeration, labelled under `<section>.<group>`. */
export function vocabularyOptions(
  section: string,
  group: string,
  vocabulary: Vocabulary,
): VocabularyOption[] {
  return Object.entries(vocabulary).map(([value, entry]) => ({
    value,
    label: vocabularyLabel(section, group, value),
    icon: entry.icon,
  }));
}

/** The pill tone of every value of an enumeration. */
export function vocabularyTones(vocabulary: Vocabulary): Record<string, Tone> {
  return Object.fromEntries(
    Object.entries(vocabulary).map(([value, entry]) => [value, entry.tone]),
  );
}

/** The label key of a known tool, by its bare name. */
export function toolLabel(section: string, name: string): string {
  return i18nKey(section, "tools", name);
}

/** Select options of every known tool, by the name the log stores. */
export function toolOptions(section: string): VocabularyOption[] {
  return LOGGED_TOOLS.map((tool) => ({
    value: tool.name,
    label: toolLabel(section, tool.name),
    icon: tool.icon,
  }));
}
