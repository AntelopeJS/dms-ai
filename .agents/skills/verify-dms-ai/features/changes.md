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

Each turn that touched the project is a change set with a diff, Undo and Redo, driven from seeded stored records and a seeded shadow repository.

## Sub-features

- `no-change-set-yet-says-so`: No changes yet on the page, empty lists from the routes, 404 for a set that does not exist.
- `the-changes-say-when-the-assistant-is-down`: Can't reach the assistant, and 503 from the routes.
- `the-list-searches-filters-and-opens-a-set-with-its-diff`: three real change sets listed newest first, the scope filter, the search, a set's rows, the Auto-fix tag, the overlap warning and its diff.
- `undo-and-redo-restore-the-files-and-record-who-did-it`: the Undo dialog, the files back on disk, the name of the person, Redo, a refused second Undo, the audit log and the Undone figure.
- `an-owner-without-a-name-is-recorded-by-email`: with no name, Undo records the email on the set, the card and the audit row.
- `undoing-a-set-lists-the-later-sets-on-the-same-files`: the later set in the dialog, Undo together and Undo this one only.
- `undoing-a-set-that-deletes-a-file-brings-the-file-back`: Undo of a set that deleted a file puts it back, Redo deletes it again.
- `without-git-the-page-says-change-sets-are-off`: with no Git on the PATH the status says checkpoints are unavailable and the page says Change sets are off.
- `change-sets-older-than-the-retention-are-dropped-when-the-assistant-starts`: the 7, 30 and 90 day retentions at their boundaries.

## How to get to it (user POV)

- Modules › Assistant › Changes.

## Driving it with dms-control

```bash
dms-control journey "$RUN" changes
```

## Gotchas

- The change sets are real: the journeys write project files between two snapshots of the sidecar's shadow repository (`seed.mjs`), so Undo and Redo move bytes on disk.
- Not driven: the Conversation link (it exists only in the chat panel's session), the page reload after Undo and the Redo toast.
