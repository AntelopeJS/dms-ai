import { HTTPResult } from "@antelopejs/interface-api";
import {
  ASSISTANT_REFUSED_MESSAGE,
  ASSISTANT_UNAVAILABLE_MESSAGE,
  HTTP_STATUS,
} from "../constants/http";
import {
  requestSidecar,
  type SidecarRequest,
  type SidecarResponse,
} from "../sidecar";

/** An error answer, as the DMS shows it under a field or in a toast. */
export interface ErrorBody {
  message: string;
}

/** Turns a sidecar body into the route's answer. */
export type BodyShaper<T> = (body: T) => unknown;

/** The 503 every list and settings route answers while the sidecar is down. */
export function assistantUnavailable(): HTTPResult {
  return new HTTPResult(HTTP_STATUS.UNAVAILABLE, {
    message: ASSISTANT_UNAVAILABLE_MESSAGE,
  } satisfies ErrorBody);
}

function messageOf(body: unknown): string {
  if (typeof body === "string" && body.length > 0) return body;
  if (body !== null && typeof body === "object" && "message" in body) {
    const { message } = body as ErrorBody;
    if (typeof message === "string") return message;
  }
  return ASSISTANT_REFUSED_MESSAGE;
}

function refused(response: SidecarResponse): HTTPResult {
  return new HTTPResult(response.status, {
    message: messageOf(response.body),
  } satisfies ErrorBody);
}

/**
 * Forwards a request to the sidecar and shapes its answer. A refusal keeps
 * its status with `{ message }`; an unreachable sidecar answers 503, so
 * tables show their error state and an instant save says "Not saved".
 */
export async function relay<T>(
  path: string,
  shape: BodyShaper<T>,
  request: SidecarRequest = {},
): Promise<unknown> {
  let response: SidecarResponse;
  try {
    response = await requestSidecar(path, request);
  } catch {
    return assistantUnavailable();
  }
  if (!response.isOk) return refused(response);
  return shape(response.body as T);
}

/** Forwards the sidecar's answer unchanged. */
export function asIs(body: unknown): unknown {
  return body;
}
