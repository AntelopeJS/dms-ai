const assert = require("node:assert/strict");
const { HTTPResult } = require("@antelopejs/interface-api");
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

void test("a skills conflicts answer of the wrong shape answers no content (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/skills/conflicts", 200, { conflicts: "several" });

  const banner = await new harness.routes.AISkillsController().conflicts();

  assert.ok(banner instanceof HTTPResult);
  assert.equal(banner.getStatus(), 204);
});

void test("a settings answer of the wrong shape locks and defaults nothing on the form (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/settings", 200, {
    providers: { codex: "down" },
    builderAvailable: "no",
    defaults: "none",
  });

  const options = await harness.routes.applySidecarSettings(new Set(), {
    fields: [
      {
        id: "provider",
        type: "select",
        component: {
          type: "select",
          options: { items: [{ value: "claude" }, { value: "codex" }] },
        },
      },
    ],
  });

  const [provider] = options.fields;
  assert.deepEqual(provider.component.options.items, [
    { value: "claude" },
    { value: "codex" },
  ]);
  assert.equal(provider.offersDefault, undefined);
});
