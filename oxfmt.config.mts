import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  ignorePatterns: [
    "frontend-vue/**",
    // Formatted by its own Biome setup, like the layer.
    "sidecar/**",
    "**/*.md",
    "**/*.vue",
  ],
});
