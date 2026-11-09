---
covers:
  - src/routes/activity.ts
  - src/routes/activity-csv.ts
  - src/pages/activity/**
  - src/types/activity.ts
  - sidecar/src/audit/**
  - sidecar/src/constants/audit.ts
  - sidecar/src/state/legacy-tool-names.ts
  - sidecar/src/state/store.ts
  - sidecar/src/state/conversations.ts
  - sidecar/src/agent/tool-kinds.ts
  - sidecar/src/constants/tool-kinds.ts
docs:
  - docs/4.usage/4.activity.md
---

# Activity

The audit log of every tool the assistant used, driven from seeded stored records.

## Sub-features

- `an-empty-log-says-so-and-exports-its-header`: No activity yet, the tabs, the periods, the CSV header alone, an unknown record answers 404.
- `the-log-says-when-the-assistant-is-down`: Can't reach the assistant, not an empty log.
- `the-log-lists-every-call-with-its-tabs-filters-and-pages`: 29 seeded records, newest first, 25 a page, each tab, the tool, agent and read-only filters, the search and the periods give exactly their rows.
- `the-page-shows-the-log-its-tabs-periods-and-more-rows`: tab counts, 25 of 29 with Load more, the Allowed and Result labels of every kind of call, a tab, a period and a search.
- `a-row-opens-its-detail-with-the-arguments-trail-output-and-diff`: the Action detail panel, J and K, a deep link, the decision trail, the diff and Show raw JSON.
- `the-export-holds-every-row-whatever-the-tab-and-the-period`: one CSV line per record, quoting and the formula guard.
- `the-export-stops-at-10000-rows`: 10,005 records export 10,000 data lines, the newest first.
- `a-call-recorded-under-a-legacy-tool-name-reads-under-the-current-one`: a stored conversation naming `BuilderAddBlock` and `mcp__dms-ai__BuilderAddBlock` shows two `builder_add_block` rows allowed as Builder operations in the log, and the Overview's top tools count them as one Builder tool.
- `a-list-page-holds-200-rows-however-many-are-asked`: the same 10,005 records list 25 rows a page, 200 at most in one list, 50 after Load more.

## How to get to it (user POV)

- Modules › Assistant › Activity.

## Driving it with dms-control

```bash
dms-control journey "$RUN" activity
```

## Gotchas

- The audit log is built from the sidecar's stored conversations and change sets, so the journeys write those files (`seed.mjs`, `sample.mjs`) and start the assistant on them. No model runs.
