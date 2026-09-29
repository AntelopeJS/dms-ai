import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  // Resolved from node_modules at runtime as an executable, never imported.
  ignoreDependencies: ["@anthropic-ai/claude-code"],
  // Nested package dependencies are checked from their own manifests.
  ignore: ["frontend-vue/**", "sidecar/tests/**"],
  // The sidecar is a sub-project sharing the root manifest, so its imports are
  // what justify several of the root's dependencies.
  entry: ["sidecar/src/**/*.ts"],
  project: ["sidecar/src/**/*.ts"],
});
