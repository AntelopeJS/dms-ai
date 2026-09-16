import { describe, expect, it } from "vitest";

import { rawDataToText } from "../../src/server/raw-data.js";

describe("rawDataToText", () => {
  it("reads the Buffer ws delivers by default", () => {
    expect(rawDataToText(Buffer.from("hello", "utf8"))).toBe("hello");
  });

  it("joins the chunks of a Buffer array rather than comma-separating them", () => {
    const chunks = [Buffer.from("he", "utf8"), Buffer.from("llo", "utf8")];
    expect(rawDataToText(chunks)).toBe("hello");
  });

  it("decodes an ArrayBuffer instead of stringifying the object", () => {
    const bytes = new TextEncoder().encode("hello");
    expect(rawDataToText(bytes.buffer as ArrayBuffer)).toBe("hello");
  });
});
