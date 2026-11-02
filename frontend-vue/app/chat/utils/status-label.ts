import type { Translate } from "../composables/useChatI18n";
import { formatClock } from "./format";

export type StatusKind =
	| "ready"
	| "working"
	| "waiting"
	| "connecting"
	| "offline";

export interface StatusFacts {
	kind: StatusKind;
	elapsedMs: number;
	pendingCount: number;
	agentName: string;
	/** The model that answered last; null until a reply names it. */
	model: string | null;
}

const PART_SEPARATOR = " · ";

function stateLabel(facts: StatusFacts, t: Translate): string {
	const labels: Record<StatusKind, () => string> = {
		ready: () => t("dms_ai.panel.status.ready"),
		working: () =>
			t("dms_ai.panel.status.working", { time: formatClock(facts.elapsedMs) }),
		waiting: () =>
			t(
				"dms_ai.panel.status.waiting",
				{ count: facts.pendingCount },
				facts.pendingCount,
			),
		connecting: () => t("dms_ai.panel.status.connecting"),
		offline: () => t("dms_ai.panel.status.offline"),
	};
	return labels[facts.kind]();
}

/**
 * The panel's status line: the state, then the agent, then the model that
 * answered last ("Ready · Claude Code · claude-opus-5-5"). Offline has no
 * agent to name.
 */
export function describeStatus(facts: StatusFacts, t: Translate): string {
	const label = stateLabel(facts, t);
	if (facts.kind === "offline") return label;
	const parts = [label, facts.agentName];
	if (facts.model !== null) parts.push(facts.model);
	return parts.join(PART_SEPARATOR);
}
