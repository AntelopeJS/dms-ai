---
covers:
  - src/routes/metrics.ts
  - src/routes/metric-shapes.ts
  - src/pages/overview/kpis.ts
  - src/pages/overview/insights.ts
  - src/pages/overview/page.ts
  - src/pages/overview/recent-changes.ts
  - src/types/metrics.ts
  - sidecar/src/metrics/**
docs:
  - docs/4.usage/2.overview.md
---

# Overview

The first page of the module: status, four key figures, the chart, the ways actions were allowed, recent change sets and top tools over a period, driven from seeded stored records.

## Sub-features

- `an-unused-assistant-reads-zero-everywhere`: the status rows, the four zero figures, the empty chart, recent changes and top tools, and the section titles.
- `the-figures-count-the-seeded-log-exactly`: the key figures, the chart, the ways actions were allowed, the deletions line and the top five tools, in 24 hours, 7 days and 30 days, with the trend against the period before.
- `a-rise-in-undone-sets-reads-as-bad-news`: a rise of Undone is drawn in another colour than a rise of Actions and of Change sets.
- `the-approved-and-undone-cards-show-their-share`: the share on the Approved by you card. Known finding: the page never shows it.
- `a-click-on-a-recent-set-opens-it-on-the-changes-page`: one click on a row of Recent change sets opens the Changes page on that set (`?set=<id>`) with its diff, as the docs promise. A double-click alone is not enough.
- `each-recent-set-offers-undo-or-redo-by-its-state`: Undo on applied rows and Redo on undone ones, with one undone row then two.
- `the-assistant-card-follows-the-saved-defaults`: the Agent, Default scope and Approvals rows under each saved default.
- `the-comparison-menu-offers-three-choices-and-no-comparison-hides-the-deltas`: the comparison menu and what each choice does, remembered after a reload.
- `the-period-and-the-comparison-are-remembered-and-shared-with-activity`: 7D by default, the period picked carries to Activity.

## How to get to it (user POV)

- Modules › Assistant › Overview.

## Driving it with dms-control

```bash
dms-control journey "$RUN" overview
```

## Gotchas

- The figures come from seeded conversations and change sets; the window of each route is sent explicitly (`periodQuery`), the page's own windows are checked through the page.
- Known finding: `the-approved-and-undone-cards-show-their-share` fails (issue draft `dms-ai-overview-kpi-share-not-shown`).
- Text the page uppercases (card titles, section titles) is matched without regard to case.
