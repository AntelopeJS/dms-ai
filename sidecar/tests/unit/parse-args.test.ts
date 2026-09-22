import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/index.js";

const BACKEND_URL = "http://127.0.0.1:41234";
const HOST_ORIGIN = "http://localhost:4173";

describe("parseArgs", () => {
  it("takes the origins the dms-ai module passes", () => {
    const args = parseArgs([
      "--backend-url",
      BACKEND_URL,
      "--host-origin",
      HOST_ORIGIN,
    ]);
    expect(args.backendUrl).toBe(BACKEND_URL);
    expect(args.hostOrigin).toBe(HOST_ORIGIN);
  });

  it("falls back to the standalone defaults when run without them", () => {
    const args = parseArgs([]);
    expect(args.backendUrl).toBe("http://localhost:5010");
    expect(args.hostOrigin).toBe("http://localhost:3001");
  });
});
