import type { UndoPreview } from "../types";

/**
 * How a change set is undone when later sets touch the same files: with them
 * (`together`, safe) or alone (`only`, the later lines stay and may not
 * compile).
 */
export type UndoChoice = "together" | "only";

/** What an undo request does, and what its dialog says about it. */
export interface UndoPlan {
	includeLater: boolean;
	/** Change sets the request undoes. */
	count: number;
	/** Their numbers, the target first. */
	numbers: number[];
}

export function hasConflicts(preview: UndoPreview): boolean {
	return preview.conflicts.length > 0;
}

/** The safe answer: undo the later sets too when there are any. */
export function defaultUndoChoice(preview: UndoPreview): UndoChoice {
	return hasConflicts(preview) ? "together" : "only";
}

export function planUndo(
	preview: UndoPreview,
	targetNumber: number,
	choice: UndoChoice,
): UndoPlan {
	const includeLater = choice === "together" && hasConflicts(preview);
	const later = includeLater
		? preview.conflicts.map((conflict) => conflict.number)
		: [];
	const numbers = [targetNumber, ...later];
	return { includeLater, count: numbers.length, numbers };
}

/** The files the target shares with the later sets, once each. */
export function conflictingFiles(preview: UndoPreview): string[] {
	const files = preview.conflicts.flatMap((conflict) => conflict.files);
	return [...new Set(files)];
}

/** `#11`, `#11 and #14`, `#11, #13 and #14` in the reader's language. */
export function formatSetNumbers(numbers: number[], locale: string): string {
	const labels = numbers.map((number) => `#${number}`);
	return new Intl.ListFormat(locale, {
		style: "long",
		type: "conjunction",
	}).format(labels);
}
