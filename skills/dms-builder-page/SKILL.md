---
name: dms-builder-page
description: Builds or modifies an AntelopeJS DMS admin page (dashboard screen). Use when the user wants to add, edit, or compose an admin page, dashboard, table, form, or chart in a dms-* module.
icon: i-ph-layout
category: Builder
tags: [Pages, Dashboard, DMS]
---

# Building an AntelopeJS DMS admin page

Use this when adding or reshaping an admin page (a dashboard screen) in a DMS
module. A page is a `@RegisterPage()` controller composed of DMS components bound
to backend routes.

## Workflow

1. **Locate the module.** Pages belong to a module registered with
   `RegisterModule({ id, title, description, icon, landingPage })`. Find the existing
   `pages/module.ts` and the `pages/all.ts` barrel — every page file must be
   re-exported from `all.ts` or it will not load.

2. **Declare the page.** Create `pages/<name>/page.ts`:
   ```ts
   @RegisterPage()
   export class MyPage extends PageController(
     "<slug>",
     { displayName, description, icon, module: "<moduleId>", order: <n> },
     DefaultLayout({ fullWidth: true }),
   ) {
     static content = /* components */;
   }
   ```
   `order` controls sidebar position. Keep one page per file.

3. **Compose with shared components, not raw HTML.** Build the screen from the
   dms-base components (`KpiCard`, `ChartCard`, `TopListCard`, `TableView`,
   `Form`, `PeriodSelector`, `Grid`/`GridRow`). Lay them out with
   `Grid({ gap }).child(...)`.

4. **Bind to data via `fetchUrl`.** Components fetch from backend routes
   (e.g. `fetchUrl: "/<module>/metrics/kpi/actions"`). Each route is a
   `Controller` method that returns the payload shape the component expects —
   a `KpiCard` reads `{ value: number }`. Add the route alongside the existing
   ones and register it in the routes barrel.
   To make cards period-aware, declare one `PeriodSelector({ id })` and give each
   card `periodScope: <that id>`; the components then append `from`/`to`/
   `compareFrom`/`compareTo` query params to `fetchUrl`.

   An aggregate route can live **on the page controller itself**, which is
   simpler than a separate controller and inherits the page's auth gate for free:
   a `@Get("/stats/…")` method taking `@Model(XModel)` and returning
   `{ value: await model.someCount() }`. If the data comes from a builder-managed
   resource, prefer generating it — `BuilderAddQuery` emits exactly that shape and
   keeps the AQL chain typechecked. The Builder recognizes a query by its shape
   alone (a scalar route over a resource model calling a `this.table…` chain), so
   a hand-written route matching that grammar is picked up and editable just like
   a generated one — there is no marker. To keep a hand-written aggregate off the
   Builder's radar, write it **outside** the chain grammar (compute via an
   intermediate variable or a helper), and it reads back as `opaque`.

5. **Read before you write.** Model new components on the closest existing page
   in the same module and copy its option shape exactly — the component option
   contracts live in `node_modules/@antelopejs/interface-dms`.

6. **Typecheck before declaring done.** Run the `Typecheck` tool on the module
   after every source edit and fix every error — a non-compiling edit makes the
   host reload fail and the page 404. Use `FindPagesUsing` to map each file you
   edit to the pages that render it, and `QueryLogs` if the page still looks
   wrong after the reload.

## Guardrails

- Re-export every new page from `pages/all.ts`.
- A page's `module` must match an `id` passed to `RegisterModule`.
- Prefer adding fields to an existing route payload over inventing new routes.
- Before editing a page, make sure the host is displaying it (`NavigateToPage` —
  look the route up via `ListPages`, never derive it from the filename) so the
  live overlay hot-reloads onto your change while the user watches; for a
  brand-new page, register the empty page and navigate to it before composing
  content.
