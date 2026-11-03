---
covers:
  - src/routes/activity.ts
  - src/routes/activity-csv.ts
  - src/pages/activity/**
  - src/types/activity.ts
  - sidecar/src/audit/**
  - sidecar/src/constants/audit.ts
docs:
  - docs/4.usage/4.activity.md
---

# Activity

The audit log of every tool the assistant used. Without a model no tool runs, so the log is empty here; its rows, filters, details and export of rows are not driven.

## Sub-features

- `an-empty-log-says-so-and-exports-its-header`: No activity yet, the tabs, the periods, the export button, the CSV header alone, an unknown record answers 404.
- `the-log-says-when-the-assistant-is-down`: Can't reach the assistant, not an empty log.

## How to get to it (user POV)

- Modules › Assistant › Activity.

## Driving it with dms-control

```bash
dms-control journey "$RUN" activity
```

## Gotchas

- Rows exist only after a tool call; see the skill's Not driven list.
