import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import {
  DATABASE_FETCH_TIMEOUT_MS,
  DATABASE_LOG_PREFIX,
} from "../constants/database.js";

/** The backend's catalog routes, which reach the project's declared database connections. */
export interface DatabaseClient {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
}

export interface DatabaseClientOptions {
  backendBaseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

function buildHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) {
    headers[SIDECAR_AUTH_HEADER] = token;
  }
  return headers;
}

/** A failed call as the tool answers it: the backend's own body when it sent one. */
async function failure(response: Response): Promise<unknown> {
  try {
    return { ok: false, status: response.status, error: await response.json() };
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
  const request = async (path: string, init: RequestInit): Promise<unknown> => {
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
      return response.ok ? await response.json() : await failure(response);
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
