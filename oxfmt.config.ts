import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** The Vue layer keeps Prettier; the Codex protocol types are generated. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "frontend-vue/**",
    "**/*.md",
    "**/*.vue",
    "sidecar/src/providers/codex/protocol/**",
  ],
});
