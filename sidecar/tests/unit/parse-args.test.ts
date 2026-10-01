import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/index.js";

const BACKEND_URL = "http://127.0.0.1:41234";

describe("parseArgs", () => {
  it("takes the backend origin the dms-ai module passes", () => {
    const args = parseArgs(["--backend-url", BACKEND_URL]);
    expect(args.backendUrl).toBe(BACKEND_URL);
  });

  it("falls back to the standalone default when run without it", () => {
    const args = parseArgs([]);
    expect(args.backendUrl).toBe("http://localhost:5010");
  });
});
