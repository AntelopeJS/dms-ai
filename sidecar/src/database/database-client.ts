import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";
import {
  DATABASE_FETCH_TIMEOUT_MS,
  DATABASE_LOG_PREFIX,
} from "../constants/database.js";

/** The backend's catalog routes, which reach the project's declared database connections. */
export interface DatabaseClient {
  get(path: string): Promise<JsonValue>;
  post(path: string, body: JsonValue): Promise<JsonValue>;
}

export interface DatabaseClientOptions {
  backendBaseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

const JSON_HEADERS = { "content-type": "application/json" };

function buildHeaders(token: string | undefined) {
  return token === undefined
    ? JSON_HEADERS
    : { ...JSON_HEADERS, [SIDECAR_AUTH_HEADER]: token };
}

/** A failed call as the tool answers it: the backend's own body when it sent one. */
async function failure(response: Response): Promise<JsonValue> {
  try {
    return {
      ok: false,
      status: response.status,
      error: JsonValueSchema.parse(await response.json()),
    };
  } catch {
    return { ok: false, status: response.status };
  }
}

export function createDatabaseClient(
  opts: DatabaseClientOptions,
): DatabaseClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger ?? console;
  const headers = buildHeaders(opts.token);
  const base = opts.backendBaseUrl.replace(/\/$/, "");
  const request = async (
    path: string,
    init: RequestInit,
  ): Promise<JsonValue> => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      DATABASE_FETCH_TIMEOUT_MS,
    );
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      return response.ok
        ? JsonValueSchema.parse(await response.json())
        : await failure(response);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.warn(`${DATABASE_LOG_PREFIX} ${path} failed (${reason})`);
      return { ok: false, error: { code: "request_failed", detail: reason } };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    get: (path) => request(path, { method: "GET" }),
    post: (path, body) =>
      request(path, { method: "POST", body: JSON.stringify(body) }),
  };
}
