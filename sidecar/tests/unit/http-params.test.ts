import { describe, expect, it } from "vitest";
import { decodeRouteParam } from "../../src/server/http-params.js";

const ACTIVITY_ID = "c1:toolu_01";

describe("decodeRouteParam", () => {
  it("decodes an id encoded once", () => {
    expect(decodeRouteParam(encodeURIComponent(ACTIVITY_ID))).toBe(ACTIVITY_ID);
  });

  it("decodes an id the backend relayed encoded twice", () => {
    const twice = encodeURIComponent(encodeURIComponent(ACTIVITY_ID));
    expect(decodeRouteParam(twice)).toBe(ACTIVITY_ID);
  });

  it("keeps a plain id as is", () => {
    expect(decodeRouteParam(ACTIVITY_ID)).toBe(ACTIVITY_ID);
  });

  it("refuses a malformed escape", () => {
    expect(decodeRouteParam("%E0%A4%A")).toBeNull();
  });
});
