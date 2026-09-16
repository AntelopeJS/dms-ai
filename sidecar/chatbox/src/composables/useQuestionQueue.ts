import { type Ref, ref } from "vue";
import { CLIENT_MESSAGE_TYPES } from "../constants/ws";
import type { QuestionRequestData } from "../types/question";

export interface UseQuestionQueueOptions {
	send: (msg: object) => void;
}

export interface UseQuestionQueueResult {
	queue: Ref<QuestionRequestData[]>;
	enqueue: (req: QuestionRequestData) => void;
	respond: (requestId: string, answers: string[]) => void;
	clear: () => void;
}

function buildResponseMessage(
	req: QuestionRequestData,
	answers: string[],
): object {
	return {
		type: CLIENT_MESSAGE_TYPES.QUESTION_RESPONSE,
		conversationId: req.conversationId,
		requestId: req.requestId,
		answers,
	};
}

export function useQuestionQueue(
	options: UseQuestionQueueOptions,
): UseQuestionQueueResult {
	const queue = ref<QuestionRequestData[]>([]);

	const enqueue = (req: QuestionRequestData): void => {
		if (queue.value.some((q) => q.requestId === req.requestId)) return;
		queue.value = [...queue.value, req];
	};

	const respond = (requestId: string, answers: string[]): void => {
		const target = queue.value.find((q) => q.requestId === requestId);
		if (target === undefined) return;
		options.send(buildResponseMessage(target, answers));
		queue.value = queue.value.filter((q) => q.requestId !== requestId);
	};

	const clear = (): void => {
		queue.value = [];
	};

	return { queue, enqueue, respond, clear };
}
