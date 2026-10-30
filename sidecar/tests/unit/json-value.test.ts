import { describe, expect, it } from "vitest";
import { isJsonValue } from "../../src/protocol/json.js";

describe("isJsonValue", () => {
  it.each([
    "null",
    "true",
    "-0",
    "1e999",
    '"text"',
    "[]",
    '[1,[2,{"k":[null]}],"x"]',
    '{"__proto__":{"a":1},"b":2}',
  ])("accepts what JSON.parse yields for %s", (text) => {
    expect(isJsonValue(JSON.parse(text))).toBe(true);
  });

  it("accepts a body nested too deep for recursion", () => {
    const depth = 50_000;
    expect(isJsonValue(JSON.parse("[".repeat(depth) + "]".repeat(depth)))).toBe(
      true,
    );
  });

  it.each([
    ["undefined", undefined],
    ["a function", () => 1],
    ["a symbol", Symbol("s")],
    ["a bigint", 1n],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["an instance", new (class Box {})()],
    ["an object without prototype", Object.create(null)],
    ["an undefined member", { a: undefined }],
    ["an array holding undefined", [1, undefined]],
    ["a nested function", { a: [{ b: () => 1 }] }],
  ])("rejects %s", (_name, value) => {
    expect(isJsonValue(value)).toBe(false);
  });
});
