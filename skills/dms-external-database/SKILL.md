---
name: dms-external-database
description: Connects a DMS project to a client's existing database, runs the Builder's analysis of it, settles what the analysis could not decide from the catalog and aggregates, generates TableViews through the Builder, and adds stats pages over them. Use when the user wants pages over a database the project does not own ("plug in our client's Postgres", "generate the admin for this database", "finish the mapping the Builder proposed").
icon: i-ph-database
category: Builder
tags: [Database, Builder, Pages, DMS]
---

# Pages over a client's existing database

The Builder analyses the database by itself: from the catalog and the profiles, fixed rules
propose a mapping and name every choice's rule. Your work is what those rules cannot do: answer
the questions they left open, revisit the defaults the names and comments contradict, and make the
stats pages. You never start from scratch.

You work through the `Database*` and `Builder*` tools only. You never read rows of the client's
database: the catalog and aggregates are what you have, and they are enough. You never see or
write a credential: the database's URL is an environment variable the integrator sets.

The flow is **connect → analyse → settle → validate → apply → check**. Analysing and settling
read only, so they run in plan mode. Nothing is written before the integrator presses **Run** on
your plan.

## 1. Connect

Call `DatabaseConnections`.

- **A connection is listed** with an `engine`: use its id and go to 2.
- **An entry answers `error`**: say what it says (an owned instance, the catalog not enabled, a
  role that cannot read) and stop.
- **Nothing is listed**: the project is not connected yet. Propose one
  `BuilderConfigureProject` call with the steps in REFERENCE.md *Connecting*. Pick the names with
  the integrator, for example connection `erp`, provider module `postgres-erp`, generated module
  `erp-tables`, variable `ERP_DATABASE_URL`. Ask the integrator for the version of
  `@antelopejs/postgres` to install: you cannot look it up. The user approves the diff.
  - Then tell the integrator to put the URL in `.env` (`ERP_DATABASE_URL=postgres://…`), or in
    the Builder's *Database* workspace, which writes it there, and to restart the project. Every
    deployed environment needs the same variable, set where that environment keeps its secrets,
    never in git.
  - Recommend a role with SELECT only for the analysis.
  - Stop here: the connection exists only after the restart.

The Builder and you each have a connection to the database, under the same id: the Builder for
its analysis and mapping, you for your probing.

## 2. Analyse

`BuilderAnalyseDatabase` with the connection and the generated module.

- It answers the proposal, or, when profiling takes longer, the job's progress and `id`: call it
  again with `job` until the proposal is in.
- A `schemas` open item means the database is large: ask the integrator which schemas matter and
  analyse again with `schemas`.
- Relations the module mapped or excluded before are not proposed again. On a module mapped
  already, the proposal is what is left.

Read the proposal as REFERENCE.md *The proposal* explains: every choice has a `rule` and a `kind`.
A `fact` follows from the catalog; leave it. A `default` is a judgement; check it.

## 3. Settle

In plan mode, through the read-only tools. Probe lightly: a targeted `DatabaseProfile` of a few
columns, a `CheckReference` in `references`, a `DatabaseDescribe` of one relation. Never a
profile of the whole database again: the Builder did it.

- **Open items**, one by one:
  - `purpose`: what a relation holds. Decide from its name, comment, columns and profile:
    entities to list (a TableView), facts to count (stats only), or nothing to show (excluded).
    The item carries the relation as it would be mapped.
  - `label`: which column names a row. Prefer a name or title, then a code or number people
    recognise.
  - `reference`: a column found almost whole in another relation's key. Check it with
    `CheckReference` on the column; make it a relation column only at containment 1.
  - Where nothing tells you, say so and leave the item open: the integrator answers it in the
    Builder. Do not guess.
- **Defaults worth revisiting.** For example a table rule R8 calls a log whose name and comment
  say it holds entities, a label rule L1 chose that a comment contradicts, or a title taken from a
  cryptic name.
- **Editable.** Every TableView is proposed read-only. Make one editable only where the integrator
  wants it; show `writes` beside it, so a read-only role in this environment is visible.
- **Stats pages,** which the analysis does not make, one per area:
  - KPIs: row counts, and sums of the `measure` columns that add up (a total, a quantity; never
    a unit price or a rate);
  - one series over the main time axis by month, in the project's time zone;
  - top lists over `enum-like` columns.
- **Not possible yet:** breakdowns by a related entity's name, such as revenue per customer.
  Templates read one relation, so they would show ids. List them under *Not possible yet*,
  never as pages.

Write your plan (`ExitPlanMode`) in the format of REFERENCE.md *Plan*: what you change in the
proposal and why, the stats pages, the open items you leave, and what is not possible yet.

## 4. Validate

The integrator answers in chat or with "suggest a change". Revise the plan and present it
again. Write nothing before Run.

## 5. Apply

1. One `BuilderMapResources` with every relation of the settled proposal, TableViews and
   stats-only relations alike, and the relations decided against in `excluded`
   (REFERENCE.md *Mapping*).
   - Send the proposal's choices as they stand where you changed nothing.
   - On `invalid_config`, fix the choice it names and call again: a refused call writes nothing.
   - It answers each relation's `ref`, which queries name it by, `category`, the connection's
     category ref (`pages.<connection>`), and `leftOut`: carry those into your report.
2. Per stats page, `BuilderCreatePage` with `module` set to the generated module and `category`
   set to the `category` MapResources answered. Then `BuilderAddQuery` per query, and
   `BuilderAddBlock` per block with the query's route as its `fetchUrl`, as in the
   `dms-builder-safe` skill's *Queries*.
   - Queries read the mapped resources by their refs (`<connection>/<schema>/<relation>`).

To change a relation later, read its current choices with `BuilderMapping`, then call
`BuilderMapResources` with that relation alone, its included columns as they are and only your
change made: a mapped relation is rewritten from the choices sent, and its page follows.

## 6. Check

- Navigate only once every page is written. Pages register when the host reloads the generated
  module: under `ajs project dev` its watcher rebuilds the module after your writes.
- `NavigateToPage` to each page. If it answers `unknown_route`, the reload has not happened.
  - Read `QueryLogs` once, for a reload error.
  - Then tell the integrator the pages appear once the module reloads. Do not wait, retry or
    investigate further.
- `QueryLogs` for registration warnings (lossy fields, unserved indexes) and for the errors of
  the routes the pages called.

Then report:

- what the Builder mapped by its rules, and what you changed;
- the pages made;
- what was left out and why;
- the open items left, which the integrator finds in the Builder's *Database* workspace;
- the variable every deployment must set.

## Guardrails

- Never write a URL, password or token into a tool call, the config or a page.
- Never map into the project's own module: only into the module bound to the connection.
- `CreateResource`, `AddField` and table-side `ConfigureField` are refused in that module: its
  tables are the database's.
- `DeleteResource` there never deletes the client's rows.
