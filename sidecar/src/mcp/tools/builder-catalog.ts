import { z } from "zod";
import { type JsonValue, JsonValueSchema } from "../../protocol/json.js";
import {
  BUILDER_CATALOG_DETAIL_HINT,
  BUILDER_CATALOG_SECTIONS,
  type BuilderCatalogSection,
} from "../../constants/builder.js";

const CATALOG_ENTRY = z.record(z.string(), JsonValueSchema);
const CATALOG = CATALOG_ENTRY.refine((catalog) =>
  BUILDER_CATALOG_SECTIONS.every((section) => Array.isArray(catalog[section])),
);
const TEXT = z.string().min(1);
const ENTRY_NAME = z.string();
const CONFIG_CONTAINER = z.union([z.array(JsonValueSchema), CATALOG_ENTRY]);

type CatalogEntry = z.infer<typeof CATALOG_ENTRY>;
type CatalogSummary = {
  [key: string]: JsonValue | CatalogSummary | CatalogSummary[] | undefined;
};

/** The entries whose full schema the agent asked for, by section. */
export type CatalogSelection = Partial<
  Record<BuilderCatalogSection, string[] | undefined>
>;

interface SectionSummarizer {
  /** The key naming an entry (a block's `type`, a DataType's `id`). */
  nameKey: string;
  summarize: (entry: CatalogEntry) => CatalogSummary;
}

function textOf(value: JsonValue | undefined): string | undefined {
  return TEXT.safeParse(value).data;
}

function configKeysOf(entry: CatalogEntry): string[] {
  const config = CONFIG_CONTAINER.safeParse(entry.config);
  return config.success ? Object.keys(config.data) : [];
}

function summarizeBlock(entry: CatalogEntry) {
  return {
    type: entry.type,
    description: textOf(entry.description) ?? textOf(entry.label) ?? "",
    group: entry.group,
    container: entry.container === true,
    controllerArg: entry.controllerArg === true ? true : undefined,
  };
}

function summarizeDataType(entry: CatalogEntry) {
  return {
    id: entry.id,
    description: textOf(entry.description),
    configKeys: configKeysOf(entry),
  };
}

const SECTION_SUMMARIZERS: Record<BuilderCatalogSection, SectionSummarizer> = {
  blocks: { nameKey: "type", summarize: summarizeBlock },
  dataTypes: { nameKey: "id", summarize: summarizeDataType },
};

function isEntry(value: JsonValue): value is CatalogEntry {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entriesOf(
  catalog: CatalogEntry,
  section: BuilderCatalogSection,
): CatalogEntry[] {
  const entries = catalog[section];
  return Array.isArray(entries) ? entries.filter(isEntry) : [];
}

function isSection(key: string): key is BuilderCatalogSection {
  return BUILDER_CATALOG_SECTIONS.some((section) => section === key);
}

function buildIndex(catalog: CatalogEntry) {
  const index: CatalogSummary = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (!isSection(key)) {
      index[key] = value;
      continue;
    }
    index[key] = entriesOf(catalog, key).map(
      SECTION_SUMMARIZERS[key].summarize,
    );
  }
  return { ...index, detail: BUILDER_CATALOG_DETAIL_HINT };
}

function unknownKeyOf(section: BuilderCatalogSection): string {
  return `unknown${section.charAt(0).toUpperCase()}${section.slice(1)}`;
}

function nameOf(entry: CatalogEntry, nameKey: string): string | undefined {
  return ENTRY_NAME.safeParse(entry[nameKey]).data;
}

function selectSection(
  catalog: CatalogEntry,
  section: BuilderCatalogSection,
  names: string[],
) {
  const { nameKey } = SECTION_SUMMARIZERS[section];
  const entries = entriesOf(catalog, section);
  const selected = entries.filter((e) => {
    const name = nameOf(e, nameKey);
    return name !== undefined && names.includes(name);
  });
  const found = new Set(selected.map((e) => nameOf(e, nameKey)));
  const unknown = names.filter((name) => !found.has(name));
  const detail = { [section]: selected };
  if (unknown.length === 0) return detail;
  return { ...detail, [unknownKeyOf(section)]: unknown };
}

function hasSelection(selection: CatalogSelection): boolean {
  return BUILDER_CATALOG_SECTIONS.some((s) => (selection[s]?.length ?? 0) > 0);
}

/**
 * What BuilderCatalog answers: the full catalog is far too large for one tool
 * result, so it is a compact index unless the agent names the block types and
 * DataTypes whose full schemas it needs. Anything that is not a catalog (an
 * `{ ok: false }` from the builder) passes through untouched.
 */
export function summarizeCatalog<Answer>(
  answer: Answer,
  selection: CatalogSelection,
): Answer | CatalogSummary {
  const parsed = CATALOG.safeParse(answer);
  if (!parsed.success) return answer;
  const catalog = parsed.data;
  if (!hasSelection(selection)) return buildIndex(catalog);
  return BUILDER_CATALOG_SECTIONS.reduce<CatalogSummary>((detail, section) => {
    const names = selection[section];
    if (names === undefined || names.length === 0) return detail;
    return { ...detail, ...selectSection(catalog, section, names) };
  }, {});
}
