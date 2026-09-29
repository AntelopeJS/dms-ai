import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  // This sub-project keeps its sources in src/ and its suite in tests/.
  entry: ["src/index.ts", "tests/**/*.test.ts"],
  project: ["src/**/*.ts", "tests/**/*.ts"],
  ignore: ["src/providers/codex/protocol/**"],
  // Resolved from node_modules at runtime as an executable, never imported.
  // Resolved from node_modules at runtime as an executable, never imported.
  ignoreDependencies: ["@anthropic-ai/claude-code"],
});
