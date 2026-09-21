import type { AppSettings, ChatboxMode, ProviderName } from "../types/settings";

export const DEFAULT_SETTINGS: AppSettings = {
	provider: "claude",
	mode: "normal",
	thinking: "medium",
	generationMode: "safe",
	allowLocalSkills: false,
	builderAvailable: false,
	providers: {
		claude: { available: true },
		codex: { available: false },
	},
};

export const OPEN_SETTINGS_LABEL = "Settings";
// Phosphor "light" icons to match the host DMS icon set (its app.config maps
// the same i-ph-*-light family).
export const OPEN_SETTINGS_ICON = "i-ph-gear-six-light";
export const CLOSE_PANEL_ICON = "i-ph-x-light";

export const MODE_SECTION_LABEL = "Mode";
export const PROVIDER_SECTION_LABEL = "Agent";

export const PROVIDER_OPTIONS: { value: ProviderName; label: string }[] = [
	{ value: "claude", label: "Claude" },
	{ value: "codex", label: "Codex" },
];

// Shown in place of the hint when the sidecar reports the provider as
// unavailable, so the reason travels with the greyed-out option.
export const PROVIDER_UNAVAILABLE_PREFIX = "Unavailable: ";

// Sessions belong to the backend that opened them, so a switch tears them down.
// The transcript survives; what the agent remembers of it does not — and that
// is not something to discover after the fact.
export const PROVIDER_SWITCH_WARNING =
	"Switching agent starts a new session: open conversations lose what the agent remembers of them. Transcripts are kept.";
export const PROVIDER_SWITCH_CONFIRM = `${PROVIDER_SWITCH_WARNING}\n\nSwitch now?`;
export const PROVIDER_BUSY_HINT =
	"Stop the current turn before switching agent.";

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
