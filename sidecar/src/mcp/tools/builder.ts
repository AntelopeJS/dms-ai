import { z } from "zod";
import type { BuilderClient } from "../../builder/builder-client.js";
import { BUILDER_REF_NOTE } from "../../prompts/builder.js";
import { defineTool } from "../define-tool.js";
import {
  type BuilderRun,
  exprRefusal,
  hasExprSentinel,
  note,
} from "./builder-expr.js";
import { buildQueryTools } from "./builder-queries.js";
import { buildTableViewTools } from "./builder-table-view.js";
import { type BuilderGate, gateBuilderTools } from "./builder-gate.js";
import {
  buildProjectTools,
  opResult,
  TARGET_MODULE,
} from "./builder-project.js";
import { type CatalogSelection, summarizeCatalog } from "./builder-catalog.js";

export interface BuilderToolsDeps {
  builderClient: BuilderClient;
  gate?: BuilderGate;
}

const CONFIG = z.record(z.string(), z.unknown());

/**
 * Every block path returned by BuilderPageStructure follows this shape; the
 * separators are easy to guess wrong (`/` between blocks, not `.` or `#`).
 */
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

const FIELD_ASPECTS_PATCH = z.object({
  ...FIELD_ASPECTS,
  dataType: DATA_TYPE_VALUE.optional(),
});

export function buildBuilderTools(deps: BuilderToolsDeps) {
  const tools = buildUngatedBuilderTools(deps);
  return deps.gate === undefined ? tools : gateBuilderTools(tools, deps.gate);
}

function buildUngatedBuilderTools(deps: BuilderToolsDeps) {
  const run: BuilderRun = async (op, args) =>
    opResult(await deps.builderClient.call(op, args));
  return [
    buildCatalogTool(deps.builderClient),
    ...buildPageTools(run),
    ...buildBlockTools(run),
    ...buildTableViewTools(run),
    ...buildResourceTools(run),
    ...buildQueryTools(run),
    ...buildProjectTools(deps.builderClient, deps.gate),
  ];
}

const CATALOG_NAMES = z.array(z.string()).optional();

function buildCatalogTool(builderClient: BuilderClient) {
  return defineTool(
    "BuilderCatalog",
    note(
      "The block types and DataTypes the page builder can emit. Without arguments it returns a compact index: each block type with a one-line description, its group, whether it is a `container` and whether it binds a resource (`controllerArg`); each DataType id with its config keys; and `reservedFieldNames`. Then pass `blocks` and/or `dataTypes` with the names you will use to get their full config schemas — always do so before adding or configuring a block of that type. For a config field whose schema is marked `x-dataType` (e.g. a Form field's `type`), pass a DataType value `{ $dataType: \"<id>\", config: {…} }` using an id and config from this catalog's `dataTypes` — never a raw `$expr`.",
    ),
    {
      blocks: CATALOG_NAMES.describe(
        "Block types (e.g. `TableView`, `Grid`) whose full config schema to return.",
      ),
      dataTypes: CATALOG_NAMES.describe(
        "DataType ids (e.g. `select`, `relation`) whose full config schema to return.",
      ),
    },
    async (selection: CatalogSelection) =>
      opResult(
        summarizeCatalog(await builderClient.call("GetCatalog", []), selection),
      ),
  );
}

function buildPageTools(run: BuilderRun) {
  return [
    defineTool(
      "BuilderListPages",
      note("Lists all builder-editable pages (route, id, category, file)."),
      {},
      () => run("ListPages", []),
    ),
    defineTool(
      "BuilderPageStructure",
      note(
        `Returns a page's block tree (each block's path, type, editability, config) plus a version hash for optimistic concurrency. ${BLOCK_PATH_FORMAT}`,
      ),
      { pageRef: z.string() },
      ({ pageRef }: { pageRef: string }) => run("GetPageStructure", [pageRef]),
    ),
    defineTool(
      "BuilderCreatePage",
      note(
        "Creates a new page under an existing category and wires it into the barrel so it registers.",
      ),
      {
        name: z.string(),
        displayName: z.string(),
        category: z.string(),
        icon: z
          .string()
          .optional()
          .describe("An icon name such as `i-ph-chart-line`."),
        order: z
          .number()
          .optional()
          .describe(
            "Sorts the page among its category's pages, lowest first, then by title. Pages the Connect mapping writes take 100, so a dashboard takes 0 to come first in the menu.",
          ),
        description: z
          .string()
          .optional()
          .describe("What the page is for, in a sentence."),
        module: TARGET_MODULE,
      },
      (input) => run("CreatePage", [input]),
    ),
    defineTool(
      "BuilderConfigurePage",
      note(
        "Updates a page's metadata: displayName, icon, order (lowest first, then by title; a dashboard takes 0, mapped table pages 100), description. Works on pages BuilderMapResources wrote too.",
      ),
      { pageRef: z.string(), patch: CONFIG },
      async ({ pageRef, patch }: { pageRef: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigurePage", [pageRef, patch]),
    ),
    defineTool(
      "BuilderDeletePage",
      note("Deletes a page file and removes its barrel import."),
      { pageRef: z.string() },
      ({ pageRef }: { pageRef: string }) => run("DeletePage", [pageRef]),
    ),
  ];
}

function buildBlockTools(run: BuilderRun) {
  return [
    defineTool(
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
      async (input) =>
        hasExprSentinel(input.config)
          ? exprRefusal()
          : run("AddBlock", [input]),
    ),
    defineTool(
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
    defineTool(
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
    defineTool(
      "BuilderRemoveBlock",
      note("Removes a block and its whole subtree."),
      { path: BLOCK_PATH },
      ({ path }: { path: string }) => run("RemoveBlock", [path]),
    ),
    defineTool(
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
        module: TARGET_MODULE,
      },
      (input) => run("CreateCategory", [input]),
    ),
    defineTool(
      "BuilderConfigureCategory",
      note("Updates a category's metadata (displayName, icon, order)."),
      { ref: z.string(), patch: CONFIG },
      async ({ ref, patch }: { ref: string; patch: unknown }) =>
        hasExprSentinel(patch)
          ? exprRefusal()
          : run("ConfigureCategory", [ref, patch]),
    ),
    defineTool(
      "BuilderDeleteCategory",
      note(
        "Deletes a category. Refused with referential_integrity if any page still references it.",
      ),
      { ref: z.string() },
      ({ ref }: { ref: string }) => run("DeleteCategory", [ref]),
    ),
    defineTool(
      "BuilderRefresh",
      note(
        "Reconciles the builder's source index with disk after out-of-band edits (e.g. a Code mode excursion).",
      ),
      { pageRef: z.string().optional() },
      ({ pageRef }: { pageRef?: string }) =>
        run("RefreshSourceIndex", pageRef ? [{ page: pageRef }] : []),
    ),
  ];
}

function buildResourceTools(run: BuilderRun) {
  return [
    defineTool(
      "BuilderListResources",
      note(
        "Lists every data resource (its ref, class/table names, /api route, field count, files). A resource is a Database Table+Model paired with a DataAPI controller.",
      ),
      {},
      () => run("ListResources", []),
    ),
    defineTool(
      "BuilderResourceStructure",
      note(
        "Returns a resource's fields with their semantic aspects, its `routes` (absent when it serves the full set), and a version hash for optimistic concurrency. Hand-edited or relation fields come back marked `opaque` — safe mode cannot reconfigure those.",
      ),
      { ref: z.string() },
      ({ ref }: { ref: string }) => run("GetResourceStructure", [ref]),
    ),
    defineTool(
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
        module: TARGET_MODULE,
      },
      async (input) =>
        hasExprSentinel(input) ? exprRefusal() : run("CreateResource", [input]),
    ),
    defineTool(
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
    defineTool(
      "BuilderAddField",
      note(
        "Adds a field to a resource, editing the Table and DataAPI classes together in one atomic op.",
      ),
      { ref: z.string(), field: FIELD_SPEC },
      async ({ ref, field }: { ref: string; field: unknown }) =>
        hasExprSentinel(field) ? exprRefusal() : run("AddField", [ref, field]),
    ),
    defineTool(
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
    defineTool(
      "BuilderRemoveField",
      note(
        "Removes a field from a resource's Table and DataAPI classes in one atomic op. Leaves seed rows untouched.",
      ),
      { path: FIELD_PATH },
      ({ path }: { path: string }) => run("RemoveField", [path]),
    ),
  ];
}
