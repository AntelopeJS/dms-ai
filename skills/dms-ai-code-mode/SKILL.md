---
name: dms-ai-code-mode
description: Runs the dms-ai Code-mode loop for changing a DMS page in code while the user watches it in the dashboard overlay, with the ListPages, NavigateToPage, FindPagesUsing, Typecheck and QueryLogs host tools. Use when the dms-ai generation mode is Code and a change touches a rendered page, or when the user allows Code mode after a Builder tool answered opaque_target or unsupported.
icon: i-ph-code
category: Builder
tags: [Pages, CodeMode, DMS]
---

# Code mode in dms-ai

What a page is made of and how to write it belongs to the core skills: **dms-best-practices**
(blocks described backend-side, custom only for the missing block, `.meta()` on it, design
fidelity) and **dms-pages** (`PageController`, blocks, the routes that feed them). This skill adds
what dms-ai changes: its host tools and the live overlay the user is watching. Without the
`NavigateToPage` tool you are not inside dms-ai, and this skill does not apply.

## The loop, one page at a time

1. **Map the edit.** Call `FindPagesUsing` on every file you intend to edit to get the pages that
   render it, and group your edits by page.
2. **Show the page.** Look its route up with `ListPages` (the `path` field: routes come from the
   category chain and the `/modules` prefix, never from the file name) and call `NavigateToPage`
   with it. Prefer the page the user is on, reported each turn in the host-context block. For a new
   page, register the empty `PageController`, call `ListPages` with `refresh: true`, navigate to
   it, and only then add blocks, so the user watches it fill in.
3. **Edit.** The overlay hot-reloads the page and highlights the nodes that changed.
4. **Typecheck.** Run `Typecheck` on the module after every source edit and fix every error: a
   non-compiling edit makes the host reload fail and the page 404.
5. **Verify.** If the page still looks wrong after the reload, read `QueryLogs`. Then take the
   next page from step 2.

The change is done when every impacted page shows it and `Typecheck` reports no error.

## Builder tools in Code mode

When `@antelopejs/dms-builder` is loaded, the `Builder*` tools stay available in Code mode.
Prefer them for what they cover: every operation is atomic and typecheck-gated. For a computed number over a builder-managed resource (a `KpiCard` count or sum),
`BuilderQueryTemplates` then `BuilderAddQuery` generate the route to pass as `fetchUrl`.

The Builder recognizes a query by its shape alone: a scalar route over a resource model calling a
`this.table…` chain. A hand-written route in that shape becomes editable by the Builder like a
generated one. To keep a hand-written aggregate out of its reach, compute it outside the chain
(an intermediate variable or a helper) and it reads back as `opaque`.

## Leave the servers running

dms-ai runs inside the DMS backend, so stopping or restarting the dev servers stops the
assistant. Rely on hot reload; when a change needs a full restart (a new module or dependency, a
config edit), ask the user to run it.
