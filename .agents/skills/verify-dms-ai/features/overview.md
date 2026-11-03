---
covers:
  - src/routes/metrics.ts
  - src/routes/metric-shapes.ts
  - src/pages/overview/kpis.ts
  - src/pages/overview/insights.ts
  - src/pages/overview/page.ts
  - src/types/metrics.ts
  - sidecar/src/metrics/**
docs:
  - docs/4.usage/2.overview.md
---

# Overview

The first page of the module: the assistant's status, four key figures, the activity chart, how each action was allowed, recent change sets and top tools over a period. Figures that count tool calls stay at zero without a model; their non-zero values, trends and the allowed-by breakdown are not driven.

## Sub-features

- `an-unused-assistant-reads-zero-everywhere`: the status rows, the four zero figures, the empty chart, recent changes and top tools, and the metric routes.
- `the-period-and-the-comparison-are-remembered-and-shared-with-activity`: 7D by default, the browser remembers the period and Activity opens on it.

## How to get to it (user POV)

- Modules › Assistant › Overview.

## Driving it with dms-control

```bash
dms-control journey "$RUN" overview
```

## Gotchas

- The status rows are drawn by the lifecycle feature's routes; this feature covers the figures.
