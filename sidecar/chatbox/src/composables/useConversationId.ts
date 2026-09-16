import { STORAGE_CONVERSATION_ID_KEY } from "../constants/conversation";

function readPersisted(): string | null {
	try {
		return window.localStorage.getItem(STORAGE_CONVERSATION_ID_KEY);
	} catch {
		return null;
	}
}

function persist(id: string): void {
	try {
		window.localStorage.setItem(STORAGE_CONVERSATION_ID_KEY, id);
	} catch {
		return;
	}
}

export function resolveConversationId(): string {
	const existing = readPersisted();
	if (existing !== null && existing.length > 0) return existing;
	const next = crypto.randomUUID();
	persist(next);
	return next;
}

export function persistConversationId(id: string): void {
	persist(id);
}

export function newConversationId(): string {
	return crypto.randomUUID();
}
