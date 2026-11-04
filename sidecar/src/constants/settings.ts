import type { AppSettings } from "../state/settings-types.js";
import { DEFAULT_PROVIDER_NAME } from "../state/types.js";

export const SETTINGS_FILE_NAME = "settings.json";
export const SETTINGS_LOG_PREFIX = "[dms-ai sidecar settings]";

export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

export const DEFAULT_SETTINGS: AppSettings = {
  provider: DEFAULT_PROVIDER_NAME,
  defaultModes: { claude: "auto", codex: "normal" },
  thinking: "medium",
  claudeModel: DEFAULT_CLAUDE_MODEL,
  generationMode: "safe",
  allowLocalSkills: false,
  alwaysAskDependencies: true,
  alwaysAskBlockRemoval: true,
  requestTimeoutMinutes: 5,
  notifyRequests: true,
  checkpointRetentionDays: 30,
};

export const MS_PER_MINUTE = 60_000;

export const SAFE_MODE_DENIED_MESSAGE =
  'Safe mode is active: shell commands, raw file edits and tools that act outside this chat are blocked. Make the change with the Builder ("Builder…") MCP tools instead. If it genuinely cannot be done through the Builder, ask the user to switch to Code mode for this step.';
