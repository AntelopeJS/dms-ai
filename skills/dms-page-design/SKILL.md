---
name: dms-page-design
description: Designs DMS pages that show data, through the Builder tools. Use when building or changing an analytics, stats or dashboard page, choosing a chart or a KPI for some data, picking a page's period, or deciding how a table's columns display (badges, prices, relation labels, status tabs).
icon: i-ph-chart-pie-slice
category: Builder
tags: [Pages, Charts, Dashboard, Tables, DMS]
---

# Designing data pages

A data page answers the questions its owner asks about the data. Each block answers one
question, and its title says which ("Revenue per month", "Top 10 countries by revenue").
Build every page from the questions, the shapes below and the checks at the end, in that
order, so that two runs over the same data produce the same page.

This skill decides **what** to build. The tools and their arguments are in `dms-builder-safe`
(safe mode) and `dms-pages` (code); `dms-best-practices` still holds.

## Pick the block from the data's shape

| The data | Block | Query |
| --- | --- | --- |
| A measure or a row count over time | `ChartCard` around `ChartArea`, full width | `series`, `groupBy` the time axis, `bucket`, `response: "card"`, `compare: true` |
| A second series over time (orders beside revenue) | `ChartCard` around `ChartColumn` or `ChartLine` | as above |
| A column with 2 to 6 values (status, segment, media type) | `ChartCard` around `ChartDonut` | `series`, `groupBy` the column, `response: "card"` |
| A column with 7 or more values, a top N | `ChartCard` around `ChartBar`, or `TopListCard` with `showBar` | `series`, `orderBy: "measure"`, `direction: "desc"`, `limit: 10`; `response: "card"` for the chart, `"items"` for the list |
| One figure with its trend (revenue, orders, customers) | `KpiCard` with `showDelta`, `showSparkline` | `series` by the time axis, `response: "value"`, `compare: true` |
| Numbers used as categories (a rating 1 to 5, a year) | `ChartCard` around `ChartColumn` with `xaxisType: "category"` | `series`, `groupBy` the column |
| A status column on a table | Tabs on the `TableView`, plus a donut on the analytics page | see *Tables* |

- Put a chart in a `ChartCard`: it adds the headline figure and the delta. In safe mode its
  `chart` is a nested block value, `{ "$block": { "type": "ChartArea", "config": {} } }`.
- The `response` must match the block: `card` for a `ChartCard`, `value` for a `KpiCard`,
  `items` for a `TopListCard`, `series` only for a bare chart. Any other pairing draws nothing.
- Sum a measure that adds up (a total, a quantity). Count rows for everything else. Never sum
  a unit price or a rate.
- Grouping by a foreign key shows ids. Group by the relation's own columns only; a breakdown by
  a related entity's name goes under *Not possible yet* in your report.

## Lay out an analytics page

Add the blocks in this order. Every analytics page has items 1 to 4.

1. A `PageToolbar` holding a `PeriodSelector`, first on the page (see *Period*).
2. One `GridRow` of 3 or 4 `KpiCard`s, each bound to the period.
3. The main series over time, a full-width `ChartCard`.
4. A `GridRow` of two breakdowns, each a different chart kind from the shape table.
5. A `TopListCard` or a bar chart for the largest category column, when one exists.

Use at least 3 different chart kinds on the page when the data has the shapes for them. Use
a second kind before you repeat one. A page of KPI cards alone is never done.

Every card binds the page's period: `periodScope: "page"` on the block, and on its query
`where` filters on the time axis bound to the request,
`{ "field": "<time axis>", "op": "ge", "value": { "$param": { "name": "from" } } }` and
`"le"` with `"to"`. A card over a relation with no time axis stays unbound.

## Period

The default period is computed from the data's real dates, never assumed. Read the time
axis's `range` from the analysis, or profile that column. Then take the first rule that holds,
counting from today:

1. The data reaches into the last 30 days and spans at least 90 days: `last-90-days`,
   compared with `previous-period`.
2. The current year holds at least 3 months of data: `ytd`, compared with `previous-year`.
3. Last calendar year holds data: `last-year`, compared with `previous-year` when the year
   before it holds data too, else `none`.
4. Otherwise bind nothing to a period, leave the selector out, and say so in your report.

Set it on the selector: `defaultPreset`, `defaultComparison`, `presets` (the default, any
other preset whose window holds data, and `custom`) and `comparisons`. Leave `all` out of
`presets`: it sends no `from` or `to`, and every bound query fails without them.

Pick the bucket from the default window: `month` over 90 days or more, `day` below. An axis
chart (area, line, column, bar) over time takes `xaxisType: "category"`, unless a preview's
`x` values are epoch milliseconds, which take `xaxisType: "datetime"`. A donut or pie takes
no axis option.

## Tables

The Builder's mapping proposes how each column displays. Keep its choices unless the
column's meaning says otherwise:

- A column with few values shows coloured badges, one tone per value.
- A money column shows a price.
- A relation column is titled by its target ("Customer") and shows the target's label.
- A status column with 2 to 6 values gives the table one tab per value, after "All".
- Raw id columns stay off the list.

Change a display through the relation's mapping (`BuilderMapping`, then `BuilderMapResources`
with that relation's choices), never by editing the generated page: a remap rewrites the page
from the mapping.

## Check every block before you report

1. Before each `BuilderAddQuery`, run `BuilderPreviewQuery` with the same query and the
   default period's `from` and `to` as `args`. An answer with no points, or only zeros and
   nulls, is an empty block: change the query (another measure, the whole history for a card
   that should not follow the period) or drop the block. Never add a block over an empty answer.
   When the preview answers `unsupported`, add the block and let step 2 check it.
2. After the last block, `NavigateToPage` to the page and read the blocks it reports as empty
   or failed. Fix or remove each one, then navigate again.
3. Your report names every block that still shows no data, and why.

The page is done when every block has data in the default period and the page meets the
layout above.
