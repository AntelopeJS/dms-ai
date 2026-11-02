import type { ApprovalMode, ProviderName } from "../types/protocol";

export const MODES_BY_PROVIDER: Record<ProviderName, readonly ApprovalMode[]> =
	{
		claude: ["normal", "auto", "acceptEdits", "plan"],
		codex: ["normal", "acceptEdits", "plan"],
	};

/** The mode as the provider has it: one it lacks reads as Ask first. */
export function modeFor(
	provider: ProviderName,
	mode: ApprovalMode,
): ApprovalMode {
	return MODES_BY_PROVIDER[provider].includes(mode) ? mode : "normal";
}
