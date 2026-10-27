# Reference: external database

## Connecting

One `BuilderConfigureProject` call. Replace the names, and `<version>` with the range the
integrator gave you:

```json
{ "steps": [
  { "op": "AddModule", "id": "postgres-erp", "entry": {
      "source": { "type": "package", "package": "@antelopejs/postgres", "version": "<version>" },
      "config": { "mode": "external", "statementTimeoutMs": 30000 },
      "env": { "url": "ERP_DATABASE_URL" } } },
  { "op": "CreateLocalModule", "id": "erp-tables", "path": "modules/erp-tables", "entry": {
      "importOverrides": [{ "interface": "@antelopejs/interface-database", "source": "postgres-erp" }] } },
  { "op": "ConfigureModule", "id": "mongodb", "entry": {
      "exportPriority": { "@antelopejs/interface-database": 1 } } },
  { "op": "ConfigureModule", "id": "dms-builder", "entry": {
      "importOverrides": [{ "interface": "@antelopejs/interface-database-catalog", "source": "postgres-erp", "id": "erp" }] } },
  { "op": "ConfigureModule", "id": "dms-ai", "entry": {
      "importOverrides": [{ "interface": "@antelopejs/interface-database-catalog", "source": "postgres-erp", "id": "erp" }] } }
] }
```

- **Step 1** is the client's database as an external instance of its engine's module. Its URL
  comes from the variable.
- **Step 2** is the module the tables are generated into. It is bound to that instance.
- **Step 3** keeps the DMS and its modules on the project's own database. Leave it out if the
  project already pins them.
- **Steps 4 and 5** give the Builder and you the connection `erp`, the same id for both.

For MongoDB and RethinkDB, step 1 changes, and the other steps name its id in place of
`postgres-erp`. The `disabledExports` entry keeps the external instance from ever serving the raw
client other modules ask for:

```json
{ "op": "AddModule", "id": "mongodb-erp", "entry": {
    "source": { "type": "package", "package": "@antelopejs/mongodb", "version": "<version>" },
    "config": { "mode": "external", "statementTimeoutMs": 30000 },
    "env": { "url": "ERP_DATABASE_URL", "database": "ERP_DATABASE_NAME" },
    "disabledExports": ["@antelopejs/interface-mongodb"] } }
```

```json
{ "op": "AddModule", "id": "rethinkdb-erp", "entry": {
    "source": { "type": "package", "package": "@antelopejs/rethinkdb", "version": "<version>" },
    "config": { "mode": "external", "statementTimeoutMs": 30000 },
    "env": { "url": "ERP_DATABASE_URL" },
    "disabledExports": ["@antelopejs/interface-rethinkdb"] } }
```

The RethinkDB URL holds the database as its path: `rethinkdb://user:password@host:28015/erp`.

## The proposal

`BuilderAnalyseDatabase` answers it once the job is done:

```json
{ "connection": "erp", "module": "erp-tables",
  "database": { "engine": "postgresql 17.5", "role": "erp_reader", "writes": "none" },
  "resources": [
    { "relation": "sales.customers",
      "tableView": { "value": true, "rule": "R6", "kind": "default" },
      "writable": { "value": false, "rule": "W1", "kind": "default" },
      "label": { "value": "name", "rule": "L1", "kind": "default" },
      "title": { "value": "Customers", "rule": "L2", "kind": "default" },
      "fields": [
        { "column": "segment", "native": "sales.segment", "accepts": ["string"],
          "declared": { "value": "string", "rule": "F3", "kind": "fact" },
          "filterable": { "value": true, "rule": "FL", "kind": "default" },
          "profile": { "traits": ["enum-like"], "distinct": 4 } } ],
      "leftOut": [ { "column": "password_hash", "reason": "named like a secret", "rule": "F2" } ],
      "writes": { "insert": false, "update": false, "delete": false } } ],
  "excluded": [ { "relation": "sales.people", "reason": "SELECT is granted on some columns only", "rule": "R1" } ],
  "open": [
    { "id": "purpose:legacy.t_cst", "kind": "purpose", "relation": "legacy.t_cst",
      "question": "What does legacy.t_cst hold?", "options": ["…"], "proposed": null,
      "resource": { "relation": "legacy.t_cst", "…": "…" },
      "open": [ { "id": "reference:legacy.t_cst.c05", "kind": "reference", "…": "…" } ] } ] }
```

The rules, in the order they apply to a relation:

| Rule | When | Then |
|---|---|---|
| R1 | the catalog says unmappable | excluded |
| R4 | a framework's or a migration tool's table | excluded |
| R3 | no rows | excluded |
| R2 | no key | stats only |
| R5 | keyed by its two references | stats only: a link table |
| R6 | keyed, with a label candidate | TableView |
| R7 | keyed, no label, referenced | TableView labelled by its key, and a `label` item |
| R8 | keyed, no label, not referenced, with a time axis | stats only: events or a log |
| R9 | anything else | a `purpose` item |

For columns: F1 and F2 leave out a column no type reads and one named like a secret, F3 proposes
the first accepted declaration, F4 makes a reference the database declares a relation column
(PostgreSQL only), F5 one found whole by `CheckReference`. L1 chooses labels, L2 titles, FL the four flags, W1 read-only.

## Plan

```markdown
## Database
erp · postgresql 17.5 · role erp_reader (read only) · 42 relations: 9 TableViews, 6 stats only, 18 excluded, 3 open

## Changes to the Builder's proposal
- legacy.t_cst (purpose) → TableView "Customers": its comment says "clients"; label `c02`, a short unique text
- sales.events (R8, stats only) → TableView: named and commented as calendar events people edit
- sales.orders: editable, as asked; the role here writes nothing

## Stats pages
### Sales
- KPI: orders (count) · KPI: revenue (sum of total)
- Chart: orders per month over ordered_at, Europe/Paris
- Top list: orders by status

## Left open
- label:legacy.t_ord — no column names an order; the integrator picks one in the Builder

## Not possible yet
- Revenue per customer name: needs the customer's name beside each order
```

## Mapping

The proposal's values, without their rules, plus what you changed:

```json
{ "module": "erp-tables", "connection": "erp", "resources": [
  { "relation": "sales.customers", "label": "name", "title": "Customers", "tableView": true, "writable": true,
    "fields": [ { "column": "name", "searchable": true, "sortable": true },
                { "column": "segment", "filterable": true },
                { "column": "email" }, { "column": "created_at", "sortable": true } ] },
  { "relation": "sales.orders", "tableView": true, "writable": false,
    "fields": [ { "column": "status", "filterable": true },
                { "column": "ordered_at", "sortable": true }, { "column": "total" },
                { "column": "customer_code", "relation": "sales.customers", "label": "Customer" } ] },
  { "relation": "sales.audit_log", "tableView": false, "writable": false,
    "fields": [ { "column": "at" }, { "column": "action" } ] }
],
  "excluded": [ { "relation": "sales.people", "reason": "SELECT is granted on some columns only" } ] }
```

- `declared` defaults to the column's `accepts[0]`. Set it only to take another accepted
  declaration, and always for a column a `field-type` item asked about: give the answer as its
  `declared`.
- Key columns are added for you.
- A relation column's target must be in the same call, with a `label`, or mapped in the module
  before.
- Two spellings, never mixed:
  - a relation is `schema.name` (`erp.audit_log`) in `relation` fields;
  - a resource ref is `<connection>/<schema>/<relation>` in kebab case (`erp/erp/audit-log`) in
    `BuilderAddQuery`'s `resource`.

  Every mapped relation has a ref, `tableView: false` ones included. MapResources answers each
  one's ref.
