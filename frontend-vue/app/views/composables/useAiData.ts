import { computed, type ComputedRef } from "vue";
import type {
	ApiDataRequest,
	ApiDataResult,
	UseApiDataOptions,
} from "#dms-core/app/composables/auth/useApiData";
import { HTTP_SERVICE_UNAVAILABLE } from "../constants";

/** Why a request failed: the sidecar is down (503), or anything else. */
export type RequestFailure = "unavailable" | "error";

/** A view's read, and why it failed. */
export type AiData<T> = ApiDataResult<T> & {
	/** Why the last read failed; none while a retry is in flight. */
	failure: ComputedRef<RequestFailure | null>;
	/** The server's message for the failure. */
	message: ComputedRef<string>;
};

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
function errorStatus(error: unknown): number | undefined {
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
 * A view's read of the assistant's data, with the page (`useApiData`): a
 * server render reads it and hands it to the browser. Its failure says
 * whether the assistant isn't running (503) rather than an error.
 */
export function useAiData<T>(
	url: ApiDataRequest,
	options?: UseApiDataOptions<T>,
): AiData<T> {
	const result = useApiData<T>(url, options);
	const failure = computed(() =>
		result.error.value && result.status.value !== "pending"
			? classifyFailure(result.error.value)
			: null,
	);
	const message = computed(() =>
		result.error.value ? errorMessage(result.error.value) : "",
	);
	return Object.assign(result, { failure, message });
}
