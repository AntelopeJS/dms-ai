import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

export default defineConfig({
  extends: [
    antelopePreset({
      // Turned on repository-wide with the import-sorting pass.
      importSorting: false,
    }),
  ],
  // The chatbox is a Vue app with its own toolchain, as it was under Biome.
  ignorePatterns: [...ANTELOPE_IGNORE_PATTERNS, "chatbox/**"],
  options: {
    typeAware: true,
    // Ceiling on what oxlint still reports. Most of the drop came from the
    // preset -- 0.0.4 leaves eight anti-slop rules off -- not from repair, so
    // this is a "nothing new" gate rather than a measure of remaining debt. It
    // never goes up. Here rather than in the lint script so a direct oxlint run
    // is held to it too; `lint:fix` opts out with its own `--max-warnings`,
    // since a fix pass is not a gate.
    maxWarnings: 4,
  },
  overrides: [
    {
      files: ["tests/**"],
      rules: {
        // A `describe` block is not a function anyone splits, and an integration
        // suite's length is its coverage. These ceilings are about code someone has
        // to hold in their head at once, which is not what a test file asks of a
        // reader.
        "eslint/max-lines-per-function": "off",
        // Twenty-two chained assertions across the suite, of three kinds: a
        // partial double reaching a type it does not structurally satisfy
        // (`{ send: vi.fn() } as unknown as WebSocket`), a vi.fn() reaching
        // `typeof fetch`, and a real tool handler widened to the local
        // ToolHandlerLike the cases assert against. The first two cannot be a
        // single assertion; the third could, by typing ToolHandlerLike from
        // the handler rather than beside it, which is worth doing and is not
        // this change.
        "anti-slop/no-chained-type-assertions": "off",
      },
    },
  ],
});
