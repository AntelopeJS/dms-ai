import { z } from "zod";
import { HTTPResult } from "@antelopejs/interface-api";
import {
  ASSISTANT_REFUSED_MESSAGE,
  ASSISTANT_UNAVAILABLE_MESSAGE,
  HTTP_STATUS,
} from "../constants/http";
import {
  type JsonBody,
  requestSidecar,
  type SidecarRequest,
  type SidecarResponse,
} from "../sidecar";

/** An error answer, as the DMS shows it under a field or in a toast. */
interface ErrorBody {
  message: string;
}

/** Turns a sidecar body into the route's answer. */
export type BodyToAnswer<T, Answer> = (body: T) => Answer;

/** The 503 every list and settings route answers while the sidecar is down. */
export function assistantUnavailable(): HTTPResult {
  return new HTTPResult(HTTP_STATUS.UNAVAILABLE, {
    message: ASSISTANT_UNAVAILABLE_MESSAGE,
  } satisfies ErrorBody);
}

const REFUSAL_TEXT = z.string().min(1);
const REFUSAL_BODY = z.object({ message: z.string() });

function messageOf(body: unknown): string {
  const text = REFUSAL_TEXT.safeParse(body);
  if (text.success) return text.data;
  const refusal = REFUSAL_BODY.safeParse(body);
  return refusal.success ? refusal.data.message : ASSISTANT_REFUSED_MESSAGE;
}

function refused(response: SidecarResponse): HTTPResult {
  return new HTTPResult(response.status, {
    message: messageOf(response.body),
  } satisfies ErrorBody);
}

/**
 * Forwards a request to the sidecar and turns its answer into the route's. A refusal keeps
 * its status with `{ message }`; an unreachable sidecar answers 503, so
 * tables show their error state and an instant save says "Not saved".
 */
export async function relay<T, Answer>(
  path: string,
  toAnswer: BodyToAnswer<T, Answer>,
  request: SidecarRequest = {},
): Promise<Answer | HTTPResult> {
  let response: SidecarResponse;
  try {
    response = await requestSidecar(path, request);
  } catch {
    return assistantUnavailable();
  }
  if (!response.isOk) return refused(response);
  return toAnswer(response.body as T);
}

/** Forwards the sidecar's answer unchanged. */
export function asIs(body: JsonBody | undefined): JsonBody | undefined {
  return body;
}
