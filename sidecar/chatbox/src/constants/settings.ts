import type { AppSettings, ChatboxMode } from "../types/settings";

export const DEFAULT_SETTINGS: AppSettings = {
	mode: "normal",
	thinking: "medium",
	generationMode: "safe",
	allowLocalSkills: false,
	builderAvailable: false,
};

export const OPEN_SETTINGS_LABEL = "Settings";
// Phosphor "light" icons to match the host DMS icon set (its app.config maps
// the same i-ph-*-light family).
export const OPEN_SETTINGS_ICON = "i-ph-gear-six-light";
export const CLOSE_PANEL_ICON = "i-ph-x-light";

export const MODE_SECTION_LABEL = "Mode";

export const MODE_OPTIONS: { value: ChatboxMode; label: string }[] = [
	{ value: "normal", label: "Normal" },
	{ value: "acceptEdits", label: "Accept edits" },
	{ value: "plan", label: "Plan" },
	{ value: "auto", label: "Auto" },
];

export const MODE_HINTS: Record<ChatboxMode, string> = {
	normal: "Ask before each tool action",
	acceptEdits: "Auto-accept file edits, ask for the rest",
	plan: "Plan only — propose without making changes",
	auto: "Auto-approve every tool action",
};
