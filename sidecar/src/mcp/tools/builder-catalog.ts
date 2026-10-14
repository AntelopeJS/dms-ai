import {
  BUILDER_CATALOG_DETAIL_HINT,
  BUILDER_CATALOG_SECTIONS,
  type BuilderCatalogSection,
} from "../../constants/builder.js";

type CatalogEntry = Record<string, unknown>;
type CatalogSummary = Record<string, unknown>;

/** The entries whose full schema the agent asked for, by section. */
export type CatalogSelection = Partial<
  Record<BuilderCatalogSection, string[] | undefined>
>;

interface SectionShape {
  // The key naming an entry (a block's `type`, a DataType's `id`).
  nameKey: string;
  summarize: (entry: CatalogEntry) => CatalogSummary;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function configKeysOf(entry: CatalogEntry): string[] {
  const config = entry.config;
  if (config === null || typeof config !== "object") return [];
  return Object.keys(config);
}

function summarizeBlock(entry: CatalogEntry): CatalogSummary {
  return {
    type: entry.type,
    description: textOf(entry.description) ?? textOf(entry.label) ?? "",
    group: entry.group,
    container: entry.container === true,
    controllerArg: entry.controllerArg === true ? true : undefined,
  };
}

function summarizeDataType(entry: CatalogEntry): CatalogSummary {
  return {
    id: entry.id,
    description: textOf(entry.description),
    configKeys: configKeysOf(entry),
  };
}

const SECTION_SHAPES: Record<BuilderCatalogSection, SectionShape> = {
  blocks: { nameKey: "type", summarize: summarizeBlock },
  dataTypes: { nameKey: "id", summarize: summarizeDataType },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entriesOf(
  catalog: Record<string, unknown>,
  section: BuilderCatalogSection,
): CatalogEntry[] {
  const entries = catalog[section];
  return Array.isArray(entries) ? entries.filter(isRecord) : [];
}

function isCatalog(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return BUILDER_CATALOG_SECTIONS.every((s) => Array.isArray(value[s]));
}

function isSection(key: string): key is BuilderCatalogSection {
  return (BUILDER_CATALOG_SECTIONS as readonly string[]).includes(key);
}

function buildIndex(catalog: Record<string, unknown>): CatalogSummary {
  const index: CatalogSummary = {};
  for (const [key, value] of Object.entries(catalog)) {
    if (!isSection(key)) {
      index[key] = value;
      continue;
    }
    index[key] = entriesOf(catalog, key).map(SECTION_SHAPES[key].summarize);
  }
  return { ...index, detail: BUILDER_CATALOG_DETAIL_HINT };
}

function unknownKeyOf(section: BuilderCatalogSection): string {
  return `unknown${section.charAt(0).toUpperCase()}${section.slice(1)}`;
}

function selectSection(
  catalog: Record<string, unknown>,
  section: BuilderCatalogSection,
  names: string[],
): CatalogSummary {
  const { nameKey } = SECTION_SHAPES[section];
  const entries = entriesOf(catalog, section);
  const selected = entries.filter((e) => names.includes(String(e[nameKey])));
  const found = new Set(selected.map((e) => String(e[nameKey])));
  const unknown = names.filter((name) => !found.has(name));
  const detail: CatalogSummary = { [section]: selected };
  if (unknown.length > 0) detail[unknownKeyOf(section)] = unknown;
  return detail;
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
export function shapeCatalog(
  catalog: unknown,
  selection: CatalogSelection,
): unknown {
  if (!isCatalog(catalog)) return catalog;
  if (!hasSelection(selection)) return buildIndex(catalog);
  return BUILDER_CATALOG_SECTIONS.reduce<CatalogSummary>((detail, section) => {
    const names = selection[section];
    if (names === undefined || names.length === 0) return detail;
    return { ...detail, ...selectSection(catalog, section, names) };
  }, {});
}
