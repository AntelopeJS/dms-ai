import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  ignorePatterns: [
    "chatbox/**",
    "**/*.md",
    "**/*.vue",
    "src/providers/codex/protocol/**",
  ],
});
