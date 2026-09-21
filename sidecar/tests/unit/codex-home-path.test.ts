import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_HOME_DIR_NAME } from "../../src/constants/codex.js";
import { codexHomeFor } from "../../src/providers/codex/process.js";

const STATE_DIR = path.resolve("/var/lib/dms-ai");
const HOME_ROOT = path.join(STATE_DIR, CODEX_HOME_DIR_NAME);

// The isolated home is removed recursively when the session opens and again
// when it closes, so where it lands is not the client's to choose.
describe("codex home placement", () => {
  it.each([
    "conv-1",
    "../../../../etc",
    "..\\..\\Windows",
    "/absolute/elsewhere",
    "",
  ])("keeps the home of %j under the state dir", (conversationId) => {
    const home = path.resolve(codexHomeFor(STATE_DIR, conversationId));
    expect(home.startsWith(HOME_ROOT + path.sep)).toBe(true);
    expect(path.dirname(home)).toBe(HOME_ROOT);
  });

  it("gives two conversations two homes", () => {
    expect(codexHomeFor(STATE_DIR, "a/b")).not.toBe(
      codexHomeFor(STATE_DIR, "a_b"),
    );
  });
});
