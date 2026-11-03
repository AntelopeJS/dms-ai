---
covers:
  - src/routes/changes.ts
  - src/routes/undo-confirm.ts
  - src/pages/changes/**
  - src/pages/overview/recent-changes.ts
  - src/types/changes.ts
  - sidecar/src/checkpoints/**
  - sidecar/src/state/change-sets.ts
  - sidecar/src/server/change-set-actions.ts
  - frontend-vue/app/views/**
docs:
  - docs/4.usage/3.changes.md
---

# Changes

Each turn that touched the project is a change set with a diff, Undo and Redo. A change set exists only after a model's turn edited files, so the list is empty here; diffs, Undo with its conflict preview and Redo are not driven.

## Sub-features

- `no-change-set-yet-says-so`: No changes yet on the page, empty lists from the routes, 404 for a set that does not exist.
- `the-changes-say-when-the-assistant-is-down`: Can't reach the assistant, and 503 from the routes.

## How to get to it (user POV)

- Modules › Assistant › Changes.

## Driving it with dms-control

```bash
dms-control journey "$RUN" changes
```

## Gotchas

- A turn needs Claude Code credentials or a Codex sign-in; neither exists in a run.
