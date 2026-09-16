import {
  BUILDER_FETCH_TIMEOUT_MS,
  BUILDER_LOG_PREFIX,
  BUILDER_OP_PATH,
} from "../constants/builder.js";
import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";

export interface BuilderClient {
  call(op: string, args: unknown[]): Promise<unknown>;
}

export interface BuilderClientOptions {
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

export function createBuilderClient(opts: BuilderClientOptions): BuilderClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger ?? console;
  const headers = buildHeaders(opts.token);
  const url = `${opts.backendBaseUrl.replace(/\/$/, "")}${BUILDER_OP_PATH}`;
  return {
    call: async (op, args) => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        BUILDER_FETCH_TIMEOUT_MS,
      );
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ op, args }),
          signal: controller.signal,
        });
        if (!response.ok) {
          return {
            ok: false,
            error: {
              code:
                response.status === 409
                  ? "builder_unavailable"
                  : "request_failed",
              detail: `HTTP ${response.status}`,
            },
          };
        }
        return await response.json();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(`${BUILDER_LOG_PREFIX} op "${op}" failed (${reason})`);
        return { ok: false, error: { code: "request_failed", detail: reason } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
