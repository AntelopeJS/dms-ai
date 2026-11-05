/** What the composer's placeholder depends on. */
export interface ComposerPlaceholderState {
	isConnected: boolean;
	hasQuestion: boolean;
	isRunning: boolean;
	isBuilder: boolean;
}

/** The key of the composer's placeholder: what the user can do next. */
export function composerPlaceholderKey(
	state: ComposerPlaceholderState,
): string {
	if (!state.isConnected) return "dms_ai.panel.composer.placeholder_offline";
	if (state.hasQuestion) return "dms_ai.panel.composer.placeholder_question";
	if (state.isRunning) return "dms_ai.panel.composer.placeholder_running";
	return state.isBuilder
		? "dms_ai.panel.composer.placeholder_idle"
		: "dms_ai.panel.composer.placeholder_idle_analyst";
}
