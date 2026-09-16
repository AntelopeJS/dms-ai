import { describe, expect, it } from "vitest";
import { isKnownRoute, normalizeRoute } from "../../src/pages/route-match.js";

describe("normalizeRoute", () => {
  it("ensures a single leading slash and no trailing slash", () => {
    expect(normalizeRoute("/form/form-simple")).toBe("/form/form-simple");
    expect(normalizeRoute("form/form-simple/")).toBe("/form/form-simple");
    expect(normalizeRoute("//form//")).toBe("/form");
  });

  it("strips query and hash fragments", () => {
    expect(normalizeRoute("/pages?")).toBe("/pages");
    expect(normalizeRoute("/form/simple?tab=2")).toBe("/form/simple");
    expect(normalizeRoute("/form#top")).toBe("/form");
  });
});

describe("isKnownRoute", () => {
  const routes = ["/form/form-simple", "/examples/overview"];

  it("matches a known route regardless of trailing slash", () => {
    expect(isKnownRoute("/form/form-simple", routes)).toBe(true);
    expect(isKnownRoute("/form/form-simple/", routes)).toBe(true);
  });

  it("rejects an unknown or guessed route", () => {
    expect(isKnownRoute("/pages?", routes)).toBe(false);
    expect(isKnownRoute("/form", routes)).toBe(false);
  });
});
