import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { HTTP_SERVICE_UNAVAILABLE } from "../constants";

/** Why a request failed: the sidecar is down (503), or anything else. */
export type RequestFailure = "unavailable" | "error";

export interface AiRequest<T> {
	data: ShallowRef<T | null>;
	isLoading: Ref<boolean>;
	failure: Ref<RequestFailure | null>;
	message: Ref<string>;
	/**
	 * Runs `fetcher`, keeping the previous data while it loads; a run that a
	 * later one overtook is dropped.
	 */
	run: (fetcher: () => Promise<T>) => Promise<T | null>;
}

interface FetchErrorResponse {
	status?: number;
}

interface FetchErrorBody {
	message?: unknown;
}

interface FetchErrorLike {
	status?: number;
	statusCode?: number;
	response?: FetchErrorResponse;
	data?: FetchErrorBody;
	message?: string;
}

/** The HTTP status of a `$authFetch` rejection, if it got an answer. */
export function errorStatus(error: unknown): number | undefined {
	const candidate = error as FetchErrorLike | null;
	return (
		candidate?.status ?? candidate?.statusCode ?? candidate?.response?.status
	);
}

/** The server's `{ message }`, else the error's own text. */
export function errorMessage(error: unknown): string {
	const candidate = error as FetchErrorLike | null;
	const serverMessage = candidate?.data?.message;
	if (typeof serverMessage === "string") return serverMessage;
	return candidate?.message ?? String(error);
}

export function classifyFailure(error: unknown): RequestFailure {
	return errorStatus(error) === HTTP_SERVICE_UNAVAILABLE
		? "unavailable"
		: "error";
}

/**
 * One request's state for a view: its data, whether it loads, and whether a
 * failure means "the assistant isn't running" (503) rather than an error.
 */
export function useAiRequest<T>(): AiRequest<T> {
	const data = shallowRef<T | null>(null);
	const isLoading = ref(false);
	const failure = ref<RequestFailure | null>(null);
	const message = ref("");
	let latestRun = 0;

	async function run(fetcher: () => Promise<T>): Promise<T | null> {
		latestRun += 1;
		const runId = latestRun;
		isLoading.value = true;
		try {
			const result = await fetcher();
			if (runId !== latestRun) return null;
			data.value = result;
			failure.value = null;
			return result;
		} catch (error) {
			if (runId !== latestRun) return null;
			failure.value = classifyFailure(error);
			message.value = errorMessage(error);
			return null;
		} finally {
			if (runId === latestRun) isLoading.value = false;
		}
	}

	return { data, isLoading, failure, message, run };
}
