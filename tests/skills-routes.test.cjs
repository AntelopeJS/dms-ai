const assert = require("node:assert/strict");
const { test } = require("node:test");
const { HTTPResult } = require("@antelopejs/interface-api");
const {
  answer,
  context,
  reset,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

void test("lists the skills as table rows, filtered by source for the tabs", async () => {
  reset();
  answer("GET", "/skills", 200, {
    items: [
      {
        id: "m:a",
        name: "a",
        description: "",
        tags: [],
        provenance: "@x/m",
        body: "",
      },
      {
        id: "local:b",
        name: "b",
        description: "",
        tags: [],
        provenance: "local",
        body: "",
      },
    ],
  });
  const skills = new harness.routes.AISkillsController();
  const all = await skills.catalog(context(""));
  const local = await skills.catalog(context("filter_source=is:local"));
  assert.ok(!(all instanceof HTTPResult));
  assert.ok(!(local instanceof HTTPResult));
  assert.deepEqual(
    all.results.map((row) => [row._id, row.source, row.origin]),
    [
      ["m:a", "module", "@x/m"],
      ["local:b", "local", "~/.claude/skills"],
    ],
  );
  assert.deepEqual(
    local.results.map((row) => row._id),
    ["local:b"],
  );
  assert.equal(local.total, 1);
});

void test("searches the skills by module and by tag, words their name and description lack", async () => {
  reset();
  /** @param {string} id @param {string} origin @param {string[]} tags */
  const skill = (id, origin, tags) => ({
    id,
    name: id,
    description: "",
    tags,
    provenance: origin,
    body: "",
  });
  answer("GET", "/skills", 200, {
    items: [skill("a", "@x/notes", []), skill("b", "@x/other", ["Inkwell"])],
  });
  const skills = new harness.routes.AISkillsController();
  /** @param {string} query @returns {Promise<string[]>} the ids the search keeps */
  const ids = async (query) => {
    const page = await skills.catalog(context(query));
    assert.ok(!(page instanceof HTTPResult));
    return page.results.map((row) => row._id);
  };
  assert.deepEqual(await ids("search=x%2Fnotes"), ["a"]);
  assert.deepEqual(await ids("search=inkwell"), ["b"]);
  assert.deepEqual(await ids("search=nothing"), []);
});
