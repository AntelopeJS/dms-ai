import type { AppSettings } from "../state/settings-types.js";
import { DEFAULT_PROVIDER_NAME } from "../state/types.js";

export const SETTINGS_FILE_NAME = "settings.json";
export const SETTINGS_LOG_PREFIX = "[dms-ai sidecar settings]";

export const DEFAULT_SETTINGS: AppSettings = {
  provider: DEFAULT_PROVIDER_NAME,
  mode: "normal",
  thinking: "medium",
  generationMode: "safe",
  allowLocalSkills: false,
};

// In safe mode the agent may act ONLY through the Builder (MCP) tools and
// read-only inspection; these raw-mutation tools are blocked so it cannot write
// bespoke code. Enforced live by the permission callback (not baked per session),
// so a mode flip takes effect immediately without discarding the conversation.
export const SAFE_MODE_DISALLOWED_TOOLS = [
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
];

export const SAFE_MODE_DENIED_MESSAGE =
  'Safe generation mode is active: raw file edits are blocked. Use the Builder ("Builder…") MCP tools instead. If the change genuinely can\'t be done through the Builder, ask the user to switch to Vibe mode for this step.';
