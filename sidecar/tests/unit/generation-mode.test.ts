import { afterEach, describe, expect, it } from "vitest";
import {
  effectiveGenerationMode,
  setBuilderAvailable,
} from "../../src/builder/capability.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";

afterEach(() => {
  setBuilderAvailable(false);
});

describe("effective generation mode", () => {
  it("defaults to safe", () => {
    expect(DEFAULT_SETTINGS.generationMode).toBe("safe");
  });

  it("keeps a stored safe preference when the builder is present", () => {
    setBuilderAvailable(true);
    expect(effectiveGenerationMode("safe")).toBe("safe");
  });

  it("falls back to vibe when the builder is absent", () => {
    setBuilderAvailable(false);
    expect(effectiveGenerationMode("safe")).toBe("vibe");
  });

  it("leaves an explicit vibe preference alone either way", () => {
    setBuilderAvailable(true);
    expect(effectiveGenerationMode("vibe")).toBe("vibe");
    setBuilderAvailable(false);
    expect(effectiveGenerationMode("vibe")).toBe("vibe");
  });

  // The fallback is read-time only: the caller's stored preference is never
  // rewritten, so safe re-engages by itself once dms-builder is loaded.
  it("re-engages safe once the builder appears", () => {
    const stored = DEFAULT_SETTINGS.generationMode;
    setBuilderAvailable(false);
    expect(effectiveGenerationMode(stored)).toBe("vibe");
    setBuilderAvailable(true);
    expect(effectiveGenerationMode(stored)).toBe("safe");
  });
});
