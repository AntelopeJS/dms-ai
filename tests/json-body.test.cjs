const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");

const { isJsonBody } = require(
  path.resolve(__dirname, "../dist/sidecar/json-body.js"),
);

const PARSED = [
  "null",
  "true",
  "-0",
  "1e999",
  '"text"',
  "[]",
  '[1,[2,{"k":[null]}],"x"]',
  '{"__proto__":{"a":1},"b":2}',
];
const NOT_JSON = [
  undefined,
  () => 1,
  Symbol("s"),
  1n,
  new Date(0),
  new Map(),
  new (class Box {})(),
  Object.create(null),
  { a: undefined },
  [1, undefined],
  { a: [{ b: () => 1 }] },
];

void test("accepts what JSON.parse yields", () => {
  for (const text of PARSED)
    assert.equal(isJsonBody(JSON.parse(text)), true, text);
});

void test("accepts a body nested too deep for recursion", () => {
  const depth = 50_000;
  assert.equal(
    isJsonBody(JSON.parse("[".repeat(depth) + "]".repeat(depth))),
    true,
  );
});

void test("rejects values JSON.parse cannot yield", () => {
  for (const value of NOT_JSON) assert.equal(isJsonBody(value), false);
});
