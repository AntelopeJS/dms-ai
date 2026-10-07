import { computed, type ComputedRef, type Ref } from "vue";
import { SCOPE_ICONS } from "../constants";
import type { AssistantStatus, ScopeId } from "../types";

/** One fact of the status hero: an icon, a label and its bold value. */
export interface StatusFact {
	id: string;
	icon: string;
	iconClass?: string;
	label: string;
	value: string;
}

export interface StatusFacts {
	title: ComputedRef<string>;
	facts: ComputedRef<StatusFact[]>;
}

const SCOPE_ICON_CLASSES: Record<ScopeId, string> = {
	safe: "text-success",
	vibe: "text-warning",
};

/** The status hero's headline and facts, worded from `GET /ai/status`. */
export function useStatusFacts(
	status: Readonly<Ref<AssistantStatus | null>>,
): StatusFacts {
	const { t } = useI18n();

	function headline(current: AssistantStatus): string {
		const waiting = current.pendingApprovals + current.pendingQuestions;
		const parts = [
			current.workingConversations > 0 &&
				t(
					"dms_ai.views.status.working_count",
					{ count: current.workingConversations },
					current.workingConversations,
				),
			waiting > 0 &&
				t("dms_ai.views.status.waiting_count", { count: waiting }, waiting),
		].filter((part): part is string => typeof part === "string");
		const state = t(`dms_ai.views.status.state.${current.status}`);
		return parts.length === 0 ? state : `${state} · ${parts.join(", ")}`;
	}

	function factsOf(current: AssistantStatus): StatusFact[] {
		return [
			{
				id: "agent",
				icon: "i-ph-robot",
				label: t("dms_ai.views.status.agent"),
				value: t(`dms_ai.views.agent.${current.provider}`),
			},
			{
				id: "scope",
				icon: SCOPE_ICONS[current.generationMode],
				iconClass: SCOPE_ICON_CLASSES[current.generationMode],
				label: t("dms_ai.views.status.default_scope"),
				value: t(`dms_ai.views.scope.${current.generationMode}`),
			},
			{
				id: "mode",
				icon: "i-ph-hand-palm",
				label: t("dms_ai.views.status.approvals"),
				value: t(`dms_ai.views.mode.${current.mode}`),
			},
			{
				id: "builder",
				icon: "i-ph-hammer",
				label: t("dms_ai.views.status.builder"),
				value: t(
					current.builderAvailable
						? "dms_ai.views.status.builder_connected"
						: "dms_ai.views.status.builder_missing",
				),
			},
			{
				id: "sidecar",
				icon: "i-ph-plugs-connected",
				label: t("dms_ai.views.status.sidecar"),
				value: `localhost:${current.port}`,
			},
		];
	}

	return {
		title: computed(() => (status.value ? headline(status.value) : "")),
		facts: computed(() => (status.value ? factsOf(status.value) : [])),
	};
}
