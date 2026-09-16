export interface BackoffState {
	index: number;
}

export function createBackoff(): BackoffState {
	return { index: 0 };
}

export function nextDelay(
	state: BackoffState,
	schedule: readonly number[],
): number {
	const cappedIndex = Math.min(state.index, schedule.length - 1);
	const delay = schedule[cappedIndex];
	state.index += 1;
	return delay;
}

export function resetBackoff(state: BackoffState): void {
	state.index = 0;
}
