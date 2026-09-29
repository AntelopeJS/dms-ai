import {
	ACTIVITY_ELLIPSIS,
	ACTIVITY_LABELS,
	DEFAULT_ACTIVITY_LABEL,
	QUIET_NOTICE_AFTER_MS,
	STALL_AFTER_MS,
	TOOL_DETAIL_ACTIVITIES,
} from "../constants/run-status";
import type { RunProgress } from "../types/conversation";
import { toolLabel } from "./tool-summary";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_WIDTH = 2;
const DETAIL_SEPARATOR = " · ";

/** A duration as m:ss. */
export function formatClock(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / MS_PER_SECOND));
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = String(totalSeconds % SECONDS_PER_MINUTE).padStart(
		SECONDS_WIDTH,
		"0",
	);
	return `${minutes}:${seconds}`;
}

function describeDetail(progress: RunProgress): string {
	if (progress.detail === undefined || progress.detail === "") return "";
	const namesTool = TOOL_DETAIL_ACTIVITIES.includes(progress.activity);
	const detail = namesTool ? toolLabel(progress.detail) : progress.detail;
	return `${DETAIL_SEPARATOR}${detail}`;
}

/** The line a running turn shows: what the agent is doing, and on what. */
export function describeActivity(progress: RunProgress | null): string {
	if (progress === null) return `${DEFAULT_ACTIVITY_LABEL}${ACTIVITY_ELLIPSIS}`;
	const label = ACTIVITY_LABELS[progress.activity] ?? DEFAULT_ACTIVITY_LABEL;
	return `${label}${describeDetail(progress)}${ACTIVITY_ELLIPSIS}`;
}

function sinceReport(progress: RunProgress, nowMs: number): number {
	return Math.max(0, nowMs - progress.receivedAtMs);
}

/** Time since the turn started, counted on from the last report. */
export function runElapsedMs(
	progress: RunProgress | null,
	nowMs: number,
): number {
	if (progress === null) return 0;
	return progress.elapsedMs + sinceReport(progress, nowMs);
}

/** Time since the agent last did anything, counted on from the last report. */
export function agentQuietMs(
	progress: RunProgress | null,
	nowMs: number,
): number {
	if (progress === null) return 0;
	return progress.idleMs + sinceReport(progress, nowMs);
}

/** Whether the agent has been quiet long enough for the chat to say so. */
export function isAgentQuiet(
	progress: RunProgress | null,
	nowMs: number,
): boolean {
	return agentQuietMs(progress, nowMs) >= QUIET_NOTICE_AFTER_MS;
}

/**
 * Whether the sidecar has said nothing about a running turn, heartbeats
 * included, for so long that the chat can no longer vouch for it.
 */
export function isRunStalled(lastEventAtMs: number, nowMs: number): boolean {
	return nowMs - lastEventAtMs >= STALL_AFTER_MS;
}
