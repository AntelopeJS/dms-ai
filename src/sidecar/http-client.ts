import type { z } from "zod";
import { SIDECAR_LOOPBACK_HOST } from "../constants/sidecar";
import {
  ensureSidecarRunning,
  getSidecarClientToken,
  getSidecarPort,
} from "../lifecycle/spawn-sidecar";
import { SidecarUnavailableError } from "../lifecycle/sidecar-unavailable-error";
import { isJsonBody, type JsonBody } from "./json-body";

const JSON_CONTENT_TYPE = "application/json";

/** What the sidecar answered: its status and its JSON body, when it sent one. */
export interface SidecarResponse {
  status: number;
  body: JsonBody | undefined;
  isOk: boolean;
}

/** A request to the sidecar's HTTP API, its body sent as JSON. */
export interface SidecarRequest {
  method?: string;
  body?: unknown;
}

async function readJson(response: Response): Promise<JsonBody | undefined> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonBody(parsed) ? parsed : text;
  } catch {
    return text;
  }
}

function requestInit(token: string, request: SidecarRequest): RequestInit {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (request.body === undefined) return { method: request.method, headers };
  headers.set("Content-Type", JSON_CONTENT_TYPE);
  return {
    method: request.method,
    headers,
    body: JSON.stringify(request.body),
  };
}

/**
 * Calls the sidecar over loopback with the client credential, reviving it
 * first like every other entry point. Throws `SidecarUnavailableError` when
 * no sidecar answers; any answer, error statuses included, is returned.
 */
export async function requestSidecar(
  path: string,
  request: SidecarRequest = {},
): Promise<SidecarResponse> {
  await ensureSidecarRunning();
  const port = getSidecarPort();
  const token = getSidecarClientToken();
  if (port === null || !token) throw new SidecarUnavailableError();
  let response: Response;
  try {
    response = await fetch(
      `http://${SIDECAR_LOOPBACK_HOST}:${port}${path}`,
      requestInit(token, request),
    );
  } catch {
    throw new SidecarUnavailableError();
  }
  return {
    status: response.status,
    body: await readJson(response),
    isOk: response.ok,
  };
}

/**
 * GETs a sidecar JSON endpoint and reads its body with `schema`, or `fallback`
 * when the sidecar is down, refuses or answers a body of another shape: for
 * the dashboard's charts, which render empty rather than fail.
 */
export async function readSidecar<T>(
  path: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    const response = await requestSidecar(path);
    if (!response.isOk) return fallback;
    const parsed = schema.safeParse(response.body);
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}
