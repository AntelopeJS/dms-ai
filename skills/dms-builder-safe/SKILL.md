---
name: dms-builder-safe
description: Builds or modifies AntelopeJS DMS admin pages through the Builder MCP tools instead of raw code edits. Use when the generation mode is "safe", or when the user wants predictable, typechecked page edits (add/configure/move/remove blocks, create pages and categories).
icon: i-ph-shield-check
category: Builder
tags: [Pages, Builder, SafeMode, DMS]
---

# Building DMS pages through the Builder (safe mode)

In safe mode you act **only through the `Builder*` MCP tools** — raw file edits
(`Write`/`Edit`/`Bash`) are blocked. Every op is **atomic and typecheck-gated**: on
success it returns the file changes; on `typecheck_failed` **nothing is written**.

## Addressing

- **PageRef** = the page's route, e.g. `/charts/revenue`.
- **BlockPath** = `<pageRef>#<name>[/<childId>...]`: `#<name>` is a top-level block;
  each `/<childId>` descends into a container's child.
- **CategoryRef** = a dotted id, e.g. `pages.charts` (top-level pages under `pages.*`;
  module pages under `modules.<id>.*`). Get exact refs from `BuilderListPages`, never guess.
- **ResourceRef** = a data resource's id — its `/api/<name>` route segment.
  **FieldPath** = `<resourceRef>#<fieldName>` (flat). Get refs from `BuilderListResources`.
- **QueryRef** = `<pageRef>@<queryName>`, e.g. `/catalog/books@inStockCount`. The page is
  where the route lives; the resource it reads is recorded in the query. Get refs from
  `BuilderPageStructure`'s `queries`.

## DataType, component, and reference values

- Wherever the catalog marks a config field `x-dataType` (a Form field's `type`, a
  TableView `Column` `type`, a resource field's `dataType`), pass a **DataType value**
  `{ $dataType: "<id>", config: {…} }` — an id from `BuilderCatalog`'s `dataTypes`.
  Never pass a raw `$expr`; safe mode refuses it.
- Config fields the catalog marks `x-component` hold a nested component (e.g. a
  ChartCard's `chart`), which safe mode cannot construct — there is no `$expr` escape
  hatch. Treat them like `opaque_target`: explain and ask to switch to Vibe mode.
- To name a builder-generated resource class inside config — e.g. a relation column's
  `dataApiController` — pass a **reference value**
  `{ $ref: { resource: "<ref>", as?: "dataApi" | "table" | "model" } }` (default `as`
  = `dataApi`). The resource must already exist. Unlike `$expr`, `$ref` is validated
  and **allowed in safe mode**, so relation columns work in safe mode.

## Workflow

1. **Discover the catalog first.** `BuilderCatalog` lists the valid block `type`s
   (Grid, GridRow, KpiCard, Form, Tab, Tree, ChartCard, TableView, …), their config
   schemas, and the DataTypes. Only use types it lists.
2. **Read before you write.** `BuilderListPages` to find a page/category;
   `BuilderPageStructure <pageRef>` for the block tree, `editable` flags, and
   `version` hash. Model new blocks on an existing page.
3. **Create a page** with `BuilderCreatePage` (pass a real `CategoryRef`); it returns
   `{ ref, filepath }`. Immediately `NavigateToPage` to the new (empty) page — before
   adding any blocks — so the user watches it fill in block by block.
4. **Add blocks** with `BuilderAddBlock`: omit `parent` for a top-level block or pass
   a container's BlockPath to nest; `name` unique among siblings; `type` + `config`
   from the catalog. **Controller-leading blocks** (catalog `controllerArg: true`,
   e.g. `TableView`) bind to a data resource: pass `controller` = the resource `ref`
   (its DataAPI class becomes the leading argument) and display options in `config`.
   Required for those types; rejected for others.
5. **Configure / rearrange**: `BuilderConfigureBlock` merges options (`replace: true`
   to overwrite). Children are managed only via `BuilderAddBlock` /
   `BuilderMoveBlock` / `BuilderRemoveBlock` (removes the whole subtree).
6. **Pages & categories**: `BuilderConfigurePage` edits page metadata (displayName,
   icon, order, description); `BuilderDeletePage` removes a page and its barrel
   import; `BuilderCreateCategory` / `BuilderConfigureCategory` /
   `BuilderDeleteCategory` manage categories. Category delete is refused with
   `referential_integrity` while any page still references it — `BuilderDeletePage`
   those pages first.
7. **Verify at runtime.** A typecheck-clean edit can still be wrong at runtime (a
   bad `fetchUrl` 404s): `NavigateToPage` to load the page and `QueryLogs` to check
   the host's actual reload/runtime output.

## Data resources (Table + DataAPI)

A **resource** is the data layer a table/form displays: a Database `Table`+`Model`
and a matching `DataAPI` controller at `/api/<name>`, generated as decorator classes
kept in sync — never hand-write them. Displaying one on a page is a safe-mode step:
create and populate the resource, then `BuilderAddBlock` a `TableView` with
`controller` = the resource `ref`. See [REFERENCE.md](REFERENCE.md) for the full
resource workflow (`BuilderListResources` / `BuilderCreateResource` with `location`
and `routes` / field ops / `BuilderDeleteResource`), field semantics and reserved
names, and the engine-support caveat for resource ops.

## Queries (computed numbers a DataAPI can't serve)

A **query** is a derived-data endpoint on a *page*: a GET route returning one computed
number — a count, a sum, an average — backed by a generated method on a resource's model.
The DataAPI serves rows; a query serves an aggregate over them, and a **KpiCard** is the
usual consumer. Add one with `BuilderAddQuery` on the page that will display it (not the
resource's page), wire the returned `route` as the card's `fetchUrl`, and read it back
through `BuilderPageStructure`'s `queries`. See [REFERENCE.md](REFERENCE.md) for the
template catalog, route-bound params, opaque read-back, and the full query workflow.

## Errors & escalation

- `typecheck_failed` → the emitted code didn't compile; read `diagnostics`, fix the
  `config`/`type`, retry. Nothing was written.
- `invalid_config` / `duplicate_name` / `not_found` → fix the input.
- `builder_unavailable` / `request_failed` → the host's builder engine is unreachable
  or doesn't implement the op (`request_failed` with `HTTP 400` = the host answered
  `unknown_op`). Explain the limitation; don't retry.
- `opaque_target` / `unsupported` → **safe mode cannot do this**. Explain the
  limitation and ask permission to switch to **Vibe mode** for that one step; do not
  force it. After any vibe-mode excursion, call `BuilderRefresh` (optionally scoped
  to the page) so the builder's source index reconciles with disk before further
  safe-mode ops.
- `stale` → the page changed under you; re-read with `BuilderPageStructure`, retry.

## Guardrails

- Always `BuilderCatalog` before adding blocks; use only listed types + config keys.
  Likewise `BuilderQueryTemplates` before adding a query.
- Block/child names are mandatory and unique among siblings.
- A card showing an aggregate needs a query behind it — don't point a `fetchUrl` at a
  DataAPI route and hope it returns a number.
- After a structural change, navigate to the page and check logs before declaring done.
  A query is the case where this matters most: it typechecks against the field names but
  the number it returns is only visible at runtime.
