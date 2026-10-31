const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  answer,
  reset,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

/** A body the bundled sidecar never sends: the right JSON type is a number where a list belongs. */
const MALFORMED = { value: "many", sparkline: 5, series: "none", items: 7 };

void test("a metric the sidecar answers with the wrong shape reads as the empty one (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/metrics/kpi/actions", 200, MALFORMED);
  answer("GET", "/metrics/series", 200, MALFORMED);
  answer("GET", "/metrics/allowed", 200, MALFORMED);
  answer("GET", "/metrics/top-tools", 200, MALFORMED);
  answer("GET", "/metrics/usage", 200, { days: 3, totalTokens: "x" });
  const metrics = new harness.routes.AIMetricsController();

  assert.equal((await metrics.kpi("actions")).value, 0);
  assert.deepEqual((await metrics.series()).series, []);
  assert.deepEqual(await metrics.allowed(), { items: [] });
  assert.deepEqual(await metrics.topTools(), { items: [] });
  assert.equal((await metrics.usageSummary("14")).items.length, 2);
});

void test("a skills conflicts answer of the wrong shape shows no banner (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/skills/conflicts", 200, { conflicts: "several" });

  assert.equal(await new harness.routes.AISkillsController().conflicts(), null);
});
