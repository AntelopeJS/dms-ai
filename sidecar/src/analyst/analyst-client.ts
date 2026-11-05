import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import {
  ANALYST_FETCH_TIMEOUT_MS,
  ANALYST_LOG_PREFIX,
  DATA_GRANT_HEADER,
} from "../constants/analyst.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";

/** The backend's Analyst routes: each answers as the user a grant names. */
export interface AnalystClient {
  get(path: string, query: URLSearchParams, grant: string): Promise<JsonValue>;
}

export interface AnalystClientOptions {
  backendBaseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

function headersFor(token: string | undefined, grant: string): Headers {
  const headers = new Headers({ [DATA_GRANT_HEADER]: grant });
  if (token !== undefined) headers.set(SIDECAR_AUTH_HEADER, token);
  return headers;
}

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

export function createAnalystClient(opts: AnalystClientOptions): AnalystClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger ?? console;
  const base = opts.backendBaseUrl.replace(/\/$/, "");
  return {
    get: async (path, query, grant) => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        ANALYST_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetchImpl(`${base}${path}?${query.toString()}`, {
          headers: headersFor(opts.token, grant),
          signal: controller.signal,
        });
        return response.ok
          ? JsonValueSchema.parse(await response.json())
          : await failure(response);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(`${ANALYST_LOG_PREFIX} ${path} failed (${reason})`);
        return { ok: false, error: { code: "request_failed", detail: reason } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
