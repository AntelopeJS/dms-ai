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
}
