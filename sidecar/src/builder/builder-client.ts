import {
  BUILDER_FETCH_TIMEOUT_MS,
  BUILDER_SLOW_OP_TIMEOUTS_MS,
  BUILDER_LOG_PREFIX,
  BUILDER_OP_PATH,
} from "../constants/builder.js";
import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";

export interface BuilderClient {
  call(op: string, args: unknown[]): Promise<JsonValue>;
}

export interface BuilderClientOptions {
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
        BUILDER_SLOW_OP_TIMEOUTS_MS.get(op) ?? BUILDER_FETCH_TIMEOUT_MS,
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
        return JsonValueSchema.parse(await response.json());
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
