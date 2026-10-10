export interface QuestionOptionData {
	label: string;
	description: string;
	preview?: string;
}

export interface QuestionData {
	question: string;
	header: string;
	options: QuestionOptionData[];
}

export interface QuestionRequestData {
	requestId: string;
	conversationId: string;
	questions: QuestionData[];
	createdAtMs: number;
	/** Null when the sidecar gave no deadline. */
	expiresAtMs: number | null;
}

/** One question's answer: an option label, the user's own words, or skipped. */
export interface QuestionReply {
	answer: string;
	isCustom: boolean;
	skipped: boolean;
}
