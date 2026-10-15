# Reference: external database

## Connecting

One `BuilderConfigureProject` call. Replace the names, and the version with the postgres module
version the project uses:

```json
{ "steps": [
  { "op": "AddModule", "id": "postgres-erp", "entry": {
      "source": { "type": "package", "package": "@antelopejs/postgres", "version": "^0.1.4" },
      "config": { "mode": "external", "statementTimeoutMs": 30000 },
      "env": { "url": "ERP_DATABASE_URL" } } },
  { "op": "CreateLocalModule", "id": "erp-tables", "path": "modules/erp-tables", "entry": {
      "importOverrides": [{ "interface": "@antelopejs/interface-database", "source": "postgres-erp" }] } },
  { "op": "ConfigureModule", "id": "mongodb", "entry": {
      "exportPriority": { "@antelopejs/interface-database": 1 } } },
  { "op": "ConfigureModule", "id": "dms-ai", "entry": {
      "importOverrides": [{ "interface": "@antelopejs/interface-database-catalog", "source": "postgres-erp", "id": "erp" }] } }
] }
```

- **Step 1** is the client's database as an external postgres instance. Its URL comes from the
  variable.
- **Step 2** is the module the tables are generated into. It is bound to that instance.
- **Step 3** keeps the DMS and its modules on the project's own database. Leave it out if the
  project already pins them.
- **Step 4** gives you the connection `erp`.

## Proposal

```markdown
## Database
erp · postgresql 17.5 · role erp_reader (read only) · 42 relations, 31 mappable, 9 proposed

## Pages
### Customers (sales.customers, 12 400 rows) · editable (role: read only here)
- Columns: Name (label, search, sort) · Segment (filter) · Email · Created (sort)
- Relations: —
### Orders (sales.orders, 210 000 rows) · read only
- Columns: Status (filter) · Ordered (sort) · Total (generated, read only)
- Relations: Customer → sales.customers (shows Name) · Invoice → billing.invoices (implied, 100 %)

## Stats pages
### Sales
- KPI: orders (count) · KPI: revenue (sum of total)
- Chart: orders per month over ordered_at, Europe/Paris
- Top list: orders by status

## Declared types
- sales.orders.legacy_id: number (lossy beyond 2^53) or string — proposed: number

## Left out
- sales.audit_log: a log (time axis, no label) — stats only
- sales.v_monthly: a view, no key — stats only
- sales.people: SELECT granted on some columns only
- sales.products.count: named like a controller member — on the table, not the TableView

## Not possible yet
- Revenue per customer name: needs the customer's name beside each order
```

## Mapping

```json
{ "module": "erp-tables", "connection": "erp", "resources": [
  { "relation": "sales.customers", "label": "name", "tableView": true, "writable": true,
    "fields": [ { "column": "name", "searchable": true, "sortable": true },
                { "column": "segment", "filterable": true },
                { "column": "email" }, { "column": "created_at", "sortable": true } ] },
  { "relation": "sales.orders", "tableView": true, "writable": false,
    "fields": [ { "column": "status", "filterable": true },
                { "column": "ordered_at", "sortable": true }, { "column": "total" },
                { "column": "customer_code", "relation": "sales.customers", "label": "Customer" } ] },
  { "relation": "sales.audit_log", "tableView": false, "writable": false,
    "fields": [ { "column": "at" }, { "column": "action" } ] }
] }
```

- `declared` defaults to the column's `accepts[0]`. Set it only to take another accepted
  declaration.
- Key columns are added for you.
- A relation column's target must be in the same call, with a `label`.
- Two spellings, never mixed:
  - a relation is `schema.name` (`erp.audit_log`) in `relation` fields;
  - a resource ref is `<connection>/<schema>/<relation>` in kebab case (`erp/erp/audit-log`) in
    `BuilderAddQuery`'s `resource`.

  Every mapped relation has a ref, `tableView: false` ones included. MapResources answers each
  one's ref.
