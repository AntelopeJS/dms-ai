/** What a running turn shows while the agent works, by reported activity. */
export const ACTIVITY_LABELS: Record<string, string> = {
	thinking: "Thinking",
	responding: "Writing the answer",
	writing: "Preparing",
	tool: "Running",
	compacting: "Compacting the conversation",
	retrying: "The model is busy, retrying",
};

/** Activities whose detail names a tool, shown with the tool's own label. */
export const TOOL_DETAIL_ACTIVITIES = ["writing", "tool"];

export const DEFAULT_ACTIVITY_LABEL = "Thinking";
export const ACTIVITY_ELLIPSIS = "…";

/**
 * How long a running turn may go without any word from the sidecar, heartbeats
 * included, before the chat says it lost track of it. The sidecar beats every
 * 5 seconds, so this is several missed beats, never a slow step.
 */
export const STALL_AFTER_MS = 20_000;

/** From how long without agent activity the chat says so next to the label. */
export const QUIET_NOTICE_AFTER_MS = 60_000;

export const RUN_CLOCK_TICK_MS = 1_000;

export const STALLED_LABEL = "No news from the assistant for";
export const QUIET_LABEL = "no activity for";
export const RECONNECT_LABEL = "Reconnect";
export const STOP_LABEL = "Stop";
