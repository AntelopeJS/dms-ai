import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

/**
 * Knip config for the sidecar sub-project, which keeps its sources in src/ and
 * its suite in tests/. `@anthropic-ai/claude-code` is resolved from
 * node_modules at runtime as an executable and never imported.
 */
export default antelopeKnipConfig({
  entry: ["src/index.ts", "tests/**/*.test.ts"],
  project: ["src/**/*.ts", "tests/**/*.ts"],
  ignore: ["src/providers/codex/protocol/**"],
  ignoreDependencies: ["@anthropic-ai/claude-code"],
});
