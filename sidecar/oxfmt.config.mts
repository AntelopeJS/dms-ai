import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  ignorePatterns: ["**/*.md", "**/*.vue", "src/providers/codex/protocol/**"],
});
