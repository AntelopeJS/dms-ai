import { z } from "zod";
import {
  ROUTE_PARAM_MARK,
  TABLE_VIEW_COMPONENT_NAME,
} from "../constants/analyst";

const SitePageSchema = z.object({
  displayName: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  fullSlug: z.string(),
  layoutUrl: z.string(),
  hasAccess: z.boolean().optional().catch(undefined),
  hidden: z.boolean().optional().catch(undefined),
});

export const SiteLayoutSchema = z.object({
  siteLayout: z.object({
    pages: z.record(z.string(), z.unknown()),
  }),
});

/** A page the user may open, as the site layout served to them lists it. */
export interface AnalystPage {
  path: string;
  title?: string;
  description?: string;
  layoutUrl: string;
}

/**
 * The pages of the site layout served to the user that they may open and
 * that show without a record: hidden pages (forms, sign-in) and paths with a
 * parameter are left out.
 */
export function readablePages(siteLayout: z.infer<typeof SiteLayoutSchema>) {
  const pages: AnalystPage[] = [];
  for (const entry of Object.values(siteLayout.siteLayout.pages)) {
    const page = SitePageSchema.safeParse(entry);
    if (!page.success) continue;
    const { fullSlug, hasAccess, hidden } = page.data;
    if (hasAccess !== true || hidden === true) continue;
    if (fullSlug.includes(ROUTE_PARAM_MARK)) continue;
    pages.push({
      path: fullSlug,
      title: page.data.displayName,
      description: page.data.description,
      layoutUrl: page.data.layoutUrl,
    });
  }
  return pages;
}

const ColumnSchema = z.object({
  id: z.string(),
  accessorKey: z.string().optional().catch(undefined),
  header: z.string().optional().catch(undefined),
  listable: z.boolean().optional().catch(undefined),
  enableSorting: z.boolean().optional().catch(undefined),
  enableColumnFilter: z.boolean().optional().catch(undefined),
  type: z
    .object({
      id: z.string().optional().catch(undefined),
      compareModes: z.array(z.string()).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const SourceCapabilitiesSchema = z.object({
  search: z.boolean().optional().catch(undefined),
  sort: z.boolean().optional().catch(undefined),
  paginate: z.boolean().optional().catch(undefined),
  filter: z.boolean().optional().catch(undefined),
});

const SourceSchema = z.object({
  fetchUrl: z.string(),
  capabilities: SourceCapabilitiesSchema.optional().catch(undefined),
  periodScope: z.string().optional().catch(undefined),
});

const TableViewOptionsSchema = z.object({
  location: z.string(),
  columns: z.array(z.unknown()),
  searchable: z.boolean().optional().catch(undefined),
  archiveMode: z.boolean().optional().catch(undefined),
  rowActions: z
    .object({ showArchived: z.boolean().optional().catch(undefined) })
    .optional()
    .catch(undefined),
  source: SourceSchema.optional(),
});

interface SerializedComponent {
  componentName?: unknown;
  options?: unknown;
  children?: unknown;
}

const ChildSchema = z.object({ id: z.string(), component: z.unknown() });
const ComponentSchema = z.looseObject({
  componentName: z.unknown(),
  options: z.unknown(),
  children: z.unknown(),
});

export const PageLayoutSchema = z.object({
  components: z.record(z.string(), z.unknown()),
});

/** A column of a table view, as the table view served to the user lists it. */
export interface AnalystColumn {
  field: string;
  header?: string;
  type?: string;
  sortable: boolean;
  filterModes: string[];
}

/**
 * The route a `TableView.fromSource` table reads its rows from, and what that
 * route does itself with the list query: the browser does the rest.
 */
export interface AnalystSource {
  fetchUrl: string;
  search: boolean;
  sort: boolean;
  paginate: boolean;
  filter: boolean;
  /** The `PeriodSelector` the rows follow; Analyst sends no period. */
  periodScope?: string;
}

/**
 * A table view of a page, with the list route its rows come from. `archive`
 * is set for a table in archive mode, `source` for a table over a module's
 * own route.
 */
export interface AnalystTable {
  id: string;
  location: string;
  searchable: boolean;
  columns: AnalystColumn[];
  archive?: { canView: boolean };
  source?: AnalystSource;
}

function sourceOf(source: z.infer<typeof SourceSchema>): AnalystSource {
  const capabilities = source.capabilities ?? {};
  return {
    fetchUrl: source.fetchUrl,
    search: capabilities.search === true,
    sort: capabilities.sort === true,
    paginate: capabilities.paginate === true,
    filter: capabilities.filter === true,
    periodScope: source.periodScope,
  };
}

function listedColumns(columns: unknown[]): AnalystColumn[] {
  const listed: AnalystColumn[] = [];
  for (const entry of columns) {
    const column = ColumnSchema.safeParse(entry);
    if (!column.success || column.data.listable === false) continue;
    const { data } = column;
    listed.push({
      field: data.accessorKey ?? data.id,
      header: data.header,
      type: data.type?.id,
      sortable: data.enableSorting === true,
      filterModes:
        data.enableColumnFilter === false
          ? []
          : (data.type?.compareModes ?? []),
    });
  }
  return listed;
}

function tableOf(
  id: string,
  options: z.infer<typeof TableViewOptionsSchema>,
): AnalystTable {
  const columns = listedColumns(options.columns);
  if (options.source !== undefined) {
    const source = sourceOf(options.source);
    return {
      id,
      location: options.location,
      searchable: source.search,
      columns: columns.map((column) => ({
        ...column,
        sortable: column.sortable && source.sort,
      })),
      source,
    };
  }
  return {
    id,
    location: options.location,
    searchable: options.searchable === true,
    columns,
    archive:
      options.archiveMode === true
        ? { canView: options.rowActions?.showArchived === true }
        : undefined,
  };
}

function collectTables(
  id: string,
  component: SerializedComponent,
  tables: AnalystTable[],
): void {
  if (component.componentName === TABLE_VIEW_COMPONENT_NAME) {
    const options = TableViewOptionsSchema.safeParse(component.options);
    if (options.success) tables.push(tableOf(id, options.data));
  }
  const children = z.array(ChildSchema).safeParse(component.children);
  if (!children.success) return;
  for (const child of children.data) {
    const nested = ComponentSchema.safeParse(child.component);
    if (nested.success) collectTables(`${id}.${child.id}`, nested.data, tables);
  }
}

/**
 * The table views of a page layout served to the user. The layout route has
 * already left out every component the user may not see.
 */
export function servedTables(
  layout: z.infer<typeof PageLayoutSchema>,
): AnalystTable[] {
  const tables: AnalystTable[] = [];
  for (const [id, entry] of Object.entries(layout.components)) {
    const component = ComponentSchema.safeParse(entry);
    if (component.success) collectTables(id, component.data, tables);
  }
  return tables;
}
