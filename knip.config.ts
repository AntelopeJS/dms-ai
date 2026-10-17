import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default {
  workspaces: {
    ".": antelopeKnipConfig({
      ignoreDependencies: [
        // Resolved from node_modules at runtime as an executable, never imported.
        "@anthropic-ai/claude-code",
        // The published sidecar uses the root's runtime dependencies. Knip now
        // assigns its imports to the sidecar workspace, checked separately.
        "@anthropic-ai/claude-agent-sdk",
        "@modelcontextprotocol/sdk",
        "zod",
      ],
      // Nested package dependencies are checked from their own manifests.
      ignore: ["frontend-vue/**", "sidecar/tests/**"],
    }),
  },
  // Keep the existing separate checks for nested development manifests.
  ignoreWorkspaces: ["frontend-vue", "sidecar"],
};
