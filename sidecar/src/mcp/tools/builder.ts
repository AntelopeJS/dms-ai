import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { BuilderClient } from "../../builder/builder-client.js";
import {
  BUILDER_ESCALATION_NOTE,
  BUILDER_EXPR_REFUSAL,
  BUILDER_REF_NOTE,
} from "../../prompts/builder.js";

export interface BuilderToolsDeps {
  builderClient: BuilderClient;
}

function content(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

function note(description: string): string {
  return `${description}\n\n${BUILDER_ESCALATION_NOTE}`;
}

function hasExprSentinel(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasExprSentinel);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.$expr === "string") {
      return true;
    }
    return Object.values(record).some(hasExprSentinel);
  }
  return false;
}

function exprRefusal(): { content: Array<{ type: "text"; text: string }> } {
  return content(
    JSON.stringify({
      ok: false,
      error: { code: "unsupported", detail: BUILDER_EXPR_REFUSAL },
    }),
  );
}

const CONFIG = z.record(z.string(), z.unknown());

// Every block path returned by BuilderPageStructure follows this shape; the
// separators are easy to guess wrong (`/` between blocks, not `.` or `#`).
const BLOCK_PATH_FORMAT =
  "A block path from BuilderPageStructure: `<pageRef>#<block>` for a top-level block, then `/<child>` per nesting level (e.g. `/dashboard#grid/row/kpi`). Separators: `#` after the page, `/` between blocks.";
const BLOCK_PATH = z.string().describe(BLOCK_PATH_FORMAT);
const PARENT_PATH = z
  .string()
  .describe(`Container block to nest under. ${BLOCK_PATH_FORMAT}`);

const FIELD_PATH_FORMAT =
  "A field path `<resourceRef>#<fieldName>` (the `ref` from BuilderListResources plus the field name).";
const FIELD_PATH = z.string().describe(FIELD_PATH_FORMAT);

const DATA_TYPE_VALUE = z.object({
  $dataType: z
    .string()
    .describe("A `dataTypes` id from BuilderCatalog, e.g. `string`, `select`."),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      `That DataType's own config, per BuilderCatalog. ${BUILDER_REF_NOTE}`,
    ),
});

const FIELD_ASPECTS = {
  dataType: DATA_TYPE_VALUE,
  label: z
    .string()
    .optional()
    .describe("Column header. Defaults to the field name."),
  listable: z
    .boolean()
    .optional()
    .describe("Show in list/table responses. Default true."),
  searchable: z.boolean().optional().describe("Include in free-text search."),
  sortable: z.boolean().optional().describe("Allow sorting by this field."),
  filterable: z.boolean().optional().describe("Allow filtering by this field."),
  access: z
    .enum(["read", "readwrite"])
    .optional()
    .describe("`read` makes it write-protected. Default `readwrite`."),
  required: z.boolean().optional().describe("Reject writes omitting it."),
  indexed: z.boolean().optional().describe("Add a database index."),
  order: z
    .number()
    .optional()
    .describe("Position among the resource's fields."),
};

const RESOURCE_LOCATION = z
  .union([
    z.string(),
    z.object({ category: z.string() }),
    z.object({ page: z.string() }),
  ])
  .describe(
    "Where the resource folder goes: a `dir` string relative to src root, `{ category: <CategoryRef> }` (mirrors page placement), or `{ page: <PageRef> }` (nests beside that page). Omit for `src/<name>/`.",
  );

const RESOURCE_ROUTE = z
  .enum([
    "list",
    "get",
    "create",
    "edit",
    "delete",
    "select",
    "archive",
    "export",
  ])
  .describe(
    "A DataAPI route: `list` (paginated listing), `get` (read one), `create`, `edit`, `delete`, `select` (relation-picker options), `archive` (soft delete + undo), `export` (CSV).",
  );

const FIELD_SPEC = z.object({
  name: z
    .string()
    .describe(
      "Field name. Must not be one of BuilderCatalog's `reservedFieldNames` (they collide with a generated route or Model member) — e.g. use `itemCount`, not `count`.",
    ),
  ...FIELD_ASPECTS,
});

const QUERY_REF = z
  .string()
  .describe(
    "A query ref `<pageRef>@<queryName>` (e.g. `/catalog/books@inStockCount`), as reported in BuilderPageStructure's `queries`.",
  );

const QUERY_ENDPOINT = z
  .string()
  .describe(
    'Route path relative to the page\'s slug, e.g. `/stats/in-stock`. Must start with `/` and not collide with another route the page serves. Omit for `/stats/<kebab-name>`. A `$param` bound with `in: "param"` reads a path segment, so include a matching `:name` (e.g. `/stats/by-author/:author`).',
  );

const QUERY_PARAMS = z
  .record(z.string(), z.unknown())
  .describe(
    "The template's parameters, keyed exactly as the `params` schema BuilderQueryTemplates reports for it — that schema documents every key and value shape, and an unrecognised key is rejected.",
  );

const FIELD_ASPECTS_PATCH = z.object({
  ...FIELD_ASPECTS,
  dataType: DATA_TYPE_VALUE.optional(),
});

export function buildBuilderTools(deps: BuilderToolsDeps) {
  const run = async (op: string, args: unknown[]) =>
    content(JSON.stringify(await deps.builderClient.call(op, args)));

  return [
    tool(
      "BuilderCatalog",
      note(
        "Lists every block type and DataType the page builder can emit, with their config schemas. Call this before adding blocks so you use valid types and options. For a config field whose schema is marked `x-dataType` (e.g. a Form field's `type`), pass a DataType value `{ $dataType: \"<id>\", config: {…} }` using an id and config from this catalog's `dataTypes` — never a raw `$expr`.",
      ),
      {},
      () => run("GetCatalog", []),
    ),
    tool(
      "BuilderListPages",
      note("Lists all builder-editable pages (route, id, category, file)."),
      {},
      () => run("ListPages", []),
    ),
    tool(
      "BuilderPageStructure",
      note(
        `Returns a page's block tree (each block's path, type, editability, config) plus a version hash for optimistic concurrency. ${BLOCK_PATH_FORMAT}`,
      ),
      { pageRef: z.string() },
      ({ pageRef }: { pageRef: string }) => run("GetPageStructure", [pageRef]),
    ),
    tool(
      "BuilderCreatePage",
      note(
        "Creates a new page under an existing category and wires it into the barrel so it registers.",
      ),
      {
        name: z.string(),
        displayName: z.string(),
        category: z.string(),
        icon: z.string().optional(),
        order: z.number().optional(),
        description: z.string().optional(),
      },
      (input: Record<string, unknown>) => run("CreatePage", [input]),
    ),
    tool(
      "BuilderConfigurePage",
      note(
        "Updates a page's metadata (displayName, icon, order, description).",
      ),
      { pageRef: z.string(), patch: CONFIG },
      async ({ pageRef, patch }: { pageRef: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigurePage", [pageRef, patch]),
    ),
    tool(
      "BuilderDeletePage",
      note("Deletes a page file and removes its barrel import."),
      { pageRef: z.string() },
      ({ pageRef }: { pageRef: string }) => run("DeletePage", [pageRef]),
    ),
    tool(
      "BuilderAddBlock",
      note(
        "Adds a block. Omit `parent` for a top-level block, or pass a container block's path to nest. `type` and `config` must match the catalog. Block types the catalog marks `controllerArg: true` (e.g. `TableView`) bind to a data resource: pass `controller` = the resource `ref` from BuilderListResources (its DataAPI class becomes the block's leading argument) and put the display options in `config`.",
      ),
      {
        page: z.string(),
        parent: PARENT_PATH.optional(),
        slot: z.string().optional(),
        index: z.number().optional(),
        name: z.string(),
        type: z.string(),
        config: CONFIG,
        controller: z
          .string()
          .optional()
          .describe(
            "Resource ref (from BuilderListResources) for a controller-leading block such as TableView. Required for those types; rejected for others.",
          ),
      },
      async (input: Record<string, unknown>) =>
        hasExprSentinel(input.config)
          ? exprRefusal()
          : run("AddBlock", [input]),
    ),
    tool(
      "BuilderConfigureBlock",
      note(
        "Merges (or replaces, with replace:true) options into a block's config. Children are managed with Add/Move/Remove, not here.",
      ),
      { path: BLOCK_PATH, patch: CONFIG, replace: z.boolean().optional() },
      async ({
        path,
        patch,
        replace,
      }: {
        path: string;
        patch: unknown;
        replace?: boolean;
      }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigureBlock", [path, patch, { replace }]),
    ),
    tool(
      "BuilderMoveBlock",
      note("Moves a child block to a new position within a container."),
      {
        path: BLOCK_PATH,
        parent: PARENT_PATH,
        slot: z.string().optional(),
        index: z.number(),
      },
      ({
        path,
        parent,
        slot,
        index,
      }: {
        path: string;
        parent: string;
        slot?: string;
        index: number;
      }) => run("MoveBlock", [path, { parent, slot, index }]),
    ),
    tool(
      "BuilderRemoveBlock",
      note("Removes a block and its whole subtree."),
      { path: BLOCK_PATH },
      ({ path }: { path: string }) => run("RemoveBlock", [path]),
    ),
    tool(
      "BuilderCreateCategory",
      note(
        "Creates a navigation category (optionally under a parent category).",
      ),
      {
        name: z.string(),
        displayName: z.string(),
        parent: z.string().optional(),
        icon: z.string().optional(),
        order: z.number().optional(),
      },
      (input: Record<string, unknown>) => run("CreateCategory", [input]),
    ),
    tool(
      "BuilderConfigureCategory",
      note("Updates a category's metadata (displayName, icon, order)."),
      { ref: z.string(), patch: CONFIG },
      async ({ ref, patch }: { ref: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigureCategory", [ref, patch]),
    ),
    tool(
      "BuilderDeleteCategory",
      note(
        "Deletes a category. Refused with referential_integrity if any page still references it.",
      ),
      { ref: z.string() },
      ({ ref }: { ref: string }) => run("DeleteCategory", [ref]),
    ),
    tool(
      "BuilderRefresh",
      note(
        "Reconciles the builder's source index with disk after out-of-band edits (e.g. a vibe-mode excursion).",
      ),
      { pageRef: z.string().optional() },
      ({ pageRef }: { pageRef?: string }) =>
        run("RefreshSourceIndex", pageRef ? [{ page: pageRef }] : []),
    ),
    tool(
      "BuilderListResources",
      note(
        "Lists every data resource (its ref, class/table names, /api route, field count, files). A resource is a Database Table+Model paired with a DataAPI controller.",
      ),
      {},
      () => run("ListResources", []),
    ),
    tool(
      "BuilderResourceStructure",
      note(
        "Returns a resource's fields with their semantic aspects, its `routes` (absent when it serves the full set), and a version hash for optimistic concurrency. Hand-edited or relation fields come back marked `opaque` — safe mode cannot reconfigure those.",
      ),
      { ref: z.string() },
      ({ ref }: { ref: string }) => run("GetResourceStructure", [ref]),
    ),
    tool(
      "BuilderCreateResource",
      note(
        "Creates a data resource — a Database Table+Model plus a matching DataAPI controller at /api/<name> — as a folder wired into the nearest barrel. Every resource auto-manages its own `_id`. When you limit `routes`, keep the view in sync: drop the TableView rowActions whose routes you left out, or bind a Form instead.",
      ),
      {
        name: z.string(),
        displayName: z.string().optional(),
        schema: z.string().optional(),
        fields: z.array(FIELD_SPEC),
        seeds: z.array(z.record(z.string(), z.unknown())).optional(),
        location: RESOURCE_LOCATION.optional(),
        routes: z.array(RESOURCE_ROUTE).min(1).optional(),
      },
      async (input: Record<string, unknown>) =>
        hasExprSentinel(input) ? exprRefusal() : run("CreateResource", [input]),
    ),
    tool(
      "BuilderDeleteResource",
      note(
        "Deletes a resource: removes its database.ts/data-api.ts/index.ts files, unwires the barrel export, and (by default) clears the resource's database table so a later resource reusing the name re-seeds cleanly instead of inheriting stale rows. Pass keepData: true to leave the table data in place. Does not detect pages whose TableView references its /api route.",
      ),
      { ref: z.string(), keepData: z.boolean().optional() },
      ({ ref, keepData }: { ref: string; keepData?: boolean }) =>
        run(
          "DeleteResource",
          keepData === undefined ? [ref] : [ref, { keepData }],
        ),
    ),
    tool(
      "BuilderAddField",
      note(
        "Adds a field to a resource, editing the Table and DataAPI classes together in one atomic op.",
      ),
      { ref: z.string(), field: FIELD_SPEC },
      async ({ ref, field }: { ref: string; field: unknown }) =>
        hasExprSentinel(field) ? exprRefusal() : run("AddField", [ref, field]),
    ),
    tool(
      "BuilderConfigureField",
      note(
        "Reconfigures a field by merging the patch over its current aspects and re-deriving the whole decorator stack on both classes (no drift). Field name is immutable — rename via BuilderRemoveField + BuilderAddField.",
      ),
      { path: FIELD_PATH, patch: FIELD_ASPECTS_PATCH },
      async ({ path, patch }: { path: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigureField", [path, patch]),
    ),
    tool(
      "BuilderRemoveField",
      note(
        "Removes a field from a resource's Table and DataAPI classes in one atomic op. Leaves seed rows untouched.",
      ),
      { path: FIELD_PATH },
      ({ path }: { path: string }) => run("RemoveField", [path]),
    ),
    tool(
      "BuilderQueryTemplates",
      note(
        "Lists the query templates BuilderAddQuery can compile, each with its id, what it computes, its `output` kind, and the JSON Schema for its `params`. Call this before adding a query — the schema is the reference for every parameter and value shape.",
      ),
      {
        resourceType: z
          .string()
          .optional()
          .describe(
            "Filter to templates for one resource type (v1 has only `database-table`). Omit for all.",
          ),
      },
      ({ resourceType }: { resourceType?: string }) =>
        run("ListQueryTemplates", resourceType ? [resourceType] : []),
    ),
    tool(
      "BuilderAddQuery",
      note(
        "Adds a query — a page-hosted GET route serving one computed number that the DataAPI cannot give you. Compiles the template into a method on the resource's model and a route on the page, atomically. Returns `{ query, route }`; `route` is the full URL to pass as a KpiCard's `fetchUrl`, and it serves `{ \"value\": <number> }`.",
      ),
      {
        page: z
          .string()
          .describe(
            "PageRef the query is served from — the page that displays it, not the resource's page.",
          ),
        name: z
          .string()
          .describe(
            "camelCase identifier, unique among the page's members. Names the route; the model method it compiles into may differ, since queries wanting the identical chain share one.",
          ),
        resource: z
          .string()
          .describe("Resource ref to read, from BuilderListResources."),
        template: z
          .string()
          .describe("A template id from BuilderQueryTemplates."),
        params: QUERY_PARAMS.optional(),
        endpoint: QUERY_ENDPOINT.optional(),
      },
      async ({ page, ...input }: { page: string } & Record<string, unknown>) =>
        hasExprSentinel(input) ? exprRefusal() : run("AddQuery", [page, input]),
    ),
    tool(
      "BuilderConfigureQuery",
      note(
        "Recompiles a query, replacing both its route and its chain. Only the keys you pass change; the rest are re-read from the query. A query BuilderPageStructure reports as `opaque` is refused with opaque_target, leaving the hand-edit intact. Renaming is not supported — remove and re-add. Never affects another page's query, even one sharing the same model method.",
      ),
      {
        query: QUERY_REF,
        patch: z.object({
          resource: z.string().optional(),
          template: z.string().optional(),
          params: QUERY_PARAMS.optional(),
          endpoint: QUERY_ENDPOINT.optional(),
        }),
      },
      async ({ query, patch }: { query: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigureQuery", [query, patch]),
    ),
    tool(
      "BuilderRemoveQuery",
      note(
        "Removes a query's route from the page, and its model method too once no route on any page still calls it. Works on an opaque query as well — the builder can always remove what it cannot edit. Does not detect blocks whose fetchUrl points at the removed route: fix those in the same turn.",
      ),
      { query: QUERY_REF },
      ({ query }: { query: string }) => run("RemoveQuery", [query]),
    ),
  ];
}
