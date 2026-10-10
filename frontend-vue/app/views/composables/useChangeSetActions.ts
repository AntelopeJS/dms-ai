import { ref, type Ref } from "vue";
import { AI_ROUTES } from "../constants";
import type { ChangeSetSummary, UndoPreview } from "../types";
import type { UndoPlan } from "../utils/undo";
import { classifyFailure, errorMessage } from "./useAiRequest";

export interface ChangeSetActions {
	isBusy: Ref<boolean>;
	/** What undoing the set would touch; `null` (and a toast) on failure. */
	preview: (changeSetId: string) => Promise<UndoPreview | null>;
	/** Rejects with the server's message, for the dialog to show it. */
	undo: (changeSet: ChangeSetSummary, plan: UndoPlan) => Promise<void>;
	redo: (changeSet: ChangeSetSummary) => Promise<void>;
}

const AI_COLOR = "secondary";

function changeSetPath(changeSetId: string, action: string): string {
	return `${AI_ROUTES.changes}/${encodeURIComponent(changeSetId)}/${action}`;
}

/**
 * Undo and redo of a change set, each confirmed by a toast; `onChanged` runs
 * once the sidecar has restored the files.
 */
export function useChangeSetActions(onChanged: () => void): ChangeSetActions {
	const { t } = useI18n();
	const toast = useToast();
	const { $authFetch } = useAuthFetch();
	const isBusy = ref(false);

	function failureToast(error: unknown): void {
		const failure = classifyFailure(error);
		toast.add({
			title: t(`dms_ai.views.${failure}.title`),
			description:
				failure === "error"
					? errorMessage(error)
					: t("dms_ai.views.unavailable.description"),
			color: "error",
			icon: "i-ph-warning-circle",
		});
	}

	async function preview(changeSetId: string): Promise<UndoPreview | null> {
		isBusy.value = true;
		try {
			return await $authFetch<UndoPreview>(
				changeSetPath(changeSetId, "undo-preview"),
			);
		} catch (error) {
			failureToast(error);
			return null;
		} finally {
			isBusy.value = false;
		}
	}

	async function redo(changeSet: ChangeSetSummary): Promise<void> {
		isBusy.value = true;
		try {
			await $authFetch(changeSetPath(changeSet.id, "redo"), {
				method: "POST",
				body: {},
			});
			toast.add({
				title: t("dms_ai.views.toast.redone", { number: changeSet.number }),
				color: AI_COLOR,
				icon: "i-ph-arrow-clockwise",
			});
			onChanged();
		} catch (error) {
			failureToast(error);
		} finally {
			isBusy.value = false;
		}
	}

	async function undo(
		changeSet: ChangeSetSummary,
		plan: UndoPlan,
	): Promise<void> {
		await $authFetch(changeSetPath(changeSet.id, "undo"), {
			method: "POST",
			body: { includeLater: plan.includeLater },
		});
		toast.add({
			title: t("dms_ai.views.toast.undone", { number: changeSet.number }),
			description: t(
				"dms_ai.views.toast.undone_description",
				{ count: plan.count },
				plan.count,
			),
			color: AI_COLOR,
			icon: "i-ph-arrow-counter-clockwise",
			actions: [
				{
					label: t("dms_ai.views.changes.redo"),
					icon: "i-ph-arrow-clockwise",
					color: "neutral",
					variant: "outline",
					onClick: () => void redo(changeSet),
				},
			],
		});
		onChanged();
	}

	return { isBusy, preview, undo, redo };
}
