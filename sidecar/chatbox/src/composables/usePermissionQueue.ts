import { type Ref, ref } from "vue";
import type { PermissionDecision } from "../constants/permissions";
import { CLIENT_MESSAGE_TYPES } from "../constants/ws";
import type { PermissionRequestData } from "../types/permission";

export interface UsePermissionQueueOptions {
	send: (msg: object) => void;
}

export interface UsePermissionQueueResult {
	queue: Ref<PermissionRequestData[]>;
	enqueue: (req: PermissionRequestData) => void;
	respond: (requestId: string, decision: PermissionDecision) => void;
	respondAll: (decision: PermissionDecision) => void;
	clear: () => void;
}

function buildResponseMessage(
	req: PermissionRequestData,
	decision: PermissionDecision,
): object {
	return {
		type: CLIENT_MESSAGE_TYPES.PERMISSION_RESPONSE,
		conversationId: req.conversationId,
		requestId: req.requestId,
		decision,
	};
}

export function usePermissionQueue(
	options: UsePermissionQueueOptions,
): UsePermissionQueueResult {
	const queue = ref<PermissionRequestData[]>([]);

	const enqueue = (req: PermissionRequestData): void => {
		if (queue.value.some((q) => q.requestId === req.requestId)) return;
		queue.value = [...queue.value, req];
	};

	const respond = (requestId: string, decision: PermissionDecision): void => {
		const target = queue.value.find((q) => q.requestId === requestId);
		if (target === undefined) return;
		options.send(buildResponseMessage(target, decision));
		queue.value = queue.value.filter((q) => q.requestId !== requestId);
	};

	const respondAll = (decision: PermissionDecision): void => {
		for (const req of queue.value) {
			options.send(buildResponseMessage(req, decision));
		}
		queue.value = [];
	};

	const clear = (): void => {
		queue.value = [];
	};

	return { queue, enqueue, respond, respondAll, clear };
}
