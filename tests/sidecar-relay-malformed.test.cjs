const assert = require("node:assert/strict");
const { test } = require("node:test");
const { z } = require("zod");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  answer,
  bodyOf,
  context,
  reset,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();
const REFUSAL = z.looseObject({ message: z.string() });

/**
 * @param {unknown} result
 * @returns {void}
 */
function assertRefused(result) {
  assert.ok(result instanceof HTTPResult);
  assert.equal(result.getStatus(), 502);
  assert.deepEqual(bodyOf(REFUSAL, result), {
    message: "The assistant refused the request.",
  });
}

void test("an activity answer of the wrong shape is refused with 502 (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/activity", 200, { results: "none", total: 1 });
  answer("GET", "/activity/row-1", 200, { id: 5 });
  const activity = new harness.routes.AIActivityController();

  assertRefused(await activity.list(context("")));
  assertRefused(await activity.export(context("")));
  assertRefused(await activity.detail("row-1"));
});

void test("a change-set answer of the wrong shape is refused with 502 (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/changes", 200, { results: [{}], total: 1 });
  answer("GET", "/changes/set-1/undo-preview", 200, { files: "a.ts" });
  const changes = new harness.routes.AIChangesController();

  assertRefused(await changes.list(context("")));
  assertRefused(await changes.recent(context("")));
  assertRefused(await changes.undoConfirm("set-1"));
});

void test("a skills catalog answer of the wrong shape is refused with 502 (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/skills", 200, { items: 5 });

  assertRefused(
    await new harness.routes.AISkillsController().catalog(context("")),
  );
});

void test("a settings answer that is not an object is refused with 502 (AntelopeJS/dms-ai#111)", async () => {
  reset();
  answer("GET", "/settings", 200, [1, 2]);

  assertRefused(await new harness.routes.AISettingsController().getSettings());
});
