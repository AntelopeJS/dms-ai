---
name: dms-external-database
description: Connects a DMS project to a client's existing database, analyses it from its catalog and aggregates, proposes TableViews and stats pages over what is relevant, and generates them through the Builder once the integrator validates the proposal. Use when the user wants pages over a database the project does not own ("plug in our client's Postgres", "generate the admin for this database").
icon: i-ph-database
category: Builder
tags: [Database, Builder, Pages, DMS]
---

# Pages over a client's existing database

You work through the `Database*` and `Builder*` tools only. You never read rows of the client's
database: the catalog and aggregates are what you have, and they are enough. You never see or
write a credential: the database's URL is an environment variable the integrator sets.

The flow is **connect → discover → profile → propose → validate → generate → check**. Discover,
profile and propose read only, so they run in plan mode. Nothing is generated before the
integrator presses **Run** on your proposal.

## 1. Connect

Call `DatabaseConnections`.

- **A connection is listed** with an `engine`: use its id and go to 2.
- **An entry answers `error`**: say what it says (an owned instance, the catalog not enabled, a
  role that cannot read) and stop.
- **Nothing is listed**: the project is not connected yet. Propose one
  `BuilderConfigureProject` call with the four steps in REFERENCE.md *Connecting*. Pick the
  names with the integrator, for example connection `erp`, provider module `postgres-erp`,
  generated module `erp-tables`, variable `ERP_DATABASE_URL`. The user approves the diff.
  - Then tell the integrator to put the URL in `.env` (`ERP_DATABASE_URL=postgres://…`) and
    restart the project. Every deployed environment needs the same variable, set where that
    environment keeps its secrets, never in git.
  - Recommend a role with SELECT only for the analysis.
  - Stop here: the connection exists only after the restart.

## 2. Discover

`DatabaseRelations` on the connection.

- On more than 50 relations, ask which schemas or areas matter before describing them all.
- Set aside every relation with `unmappable`, and say why for each.
- `DatabaseDescribe` the rest, in batches of up to 20.

## 3. Profile

Run `DatabaseProfile` on the relations you are considering:

- every keyed table that is referenced, or that has rows and a `label-candidate` column;
- every relation with a `time-axis` and a `measure` column, for stats pages;
- through `references`, columns named like references with no foreign key (`*_id`, `*_ref`,
  `*_code`) against the likely target's key.

What you read is aggregates. A `timeout` measure is missing data, not a failure; carry on.
When neither names, comments nor profile tell you what a table holds, say so in the proposal
and ask the integrator. Do not guess.

## 4. Propose

Write the proposal as your plan (`ExitPlanMode`), in the format of REFERENCE.md *Proposal*,
every section present even when empty. Decide what is relevant from the catalog and profile:

- **TableView:** a keyed table that holds entities, meaning it has a `label-candidate`, has rows,
  and is either referenced by others or has 3 or more columns worth listing.
- **Not a TableView:**
  - join tables (two references and little else), shown instead as relation columns on their
    parents where single-valued;
  - logs (a time axis, no label, append-only shape);
  - empty tables;
  - relations without a key (views, materialized views, keyless tables), which can still feed
    stats pages.
- **Columns:**
  - list the label, the categories (`enum-like`) and the dates first;
  - make `enum-like` columns filterable, the label searchable and sortable, and the time axis
    sortable;
  - leave out technical columns (hashes, tokens, internal flags).
- **Relation columns:** a declared foreign key onto a single-column key. An implied one only
  where `CheckReference` found containment 1 against a key; mark it implied.
- **Declared types:** propose `accepts[0]`. Mention the choice only where the column offers
  another, for example `bigint`: `number` (lossy beyond 2^53) or `string`.
- **Editable:** the integrator decides. Show `writes` beside each table, so a read-only role in
  this environment is visible. Generated and key columns are never editable.
- **Stats pages,** one per area:
  - KPIs: row counts, and sums of `measure` columns;
  - one series over the main time axis by month, in the project's time zone;
  - top lists over `enum-like` columns.
- **Not possible yet:** breakdowns by a related entity's name, such as revenue per customer.
  Templates read one relation, so they would show ids. List them under *Not possible yet*,
  never as pages.

## 5. Validate

The integrator answers in chat or with "suggest a change". Revise the plan and present it
again. Generate nothing before Run.

## 6. Generate

1. One `BuilderMapResources` call for every relation in the proposal, TableViews and stats-only
   relations alike, with the module and connection of step 1 (REFERENCE.md *Mapping*).
   - It answers `leftOut`: carry those into your report.
   - On `invalid_config`, fix the choice it names and call again.
2. Per stats page, `BuilderCreatePage` with `module` set to the generated module, under the
   connection's category. Then `BuilderAddQuery` per query, and `BuilderAddBlock` per block with
   the query's route as its `fetchUrl`, as in the `dms-builder-safe` skill's *Queries*.
   - Queries read the mapped resources by their refs (`<connection>/<schema>/<relation>`).

## 7. Check

- `NavigateToPage` to each page.
- `QueryLogs` for registration warnings (lossy fields, unserved indexes) and for the errors of
  the routes the pages called.

Then report:

- the pages made;
- what was left out and why;
- the variable every deployment must set.

## Guardrails

- Never write a URL, password or token into a tool call, the config or a page.
- Never map into the project's own module: only into the module bound to the connection.
- `CreateResource`, `AddField` and table-side `ConfigureField` are refused in that module: its
  tables are the database's.
- `DeleteResource` there never deletes the client's rows.
