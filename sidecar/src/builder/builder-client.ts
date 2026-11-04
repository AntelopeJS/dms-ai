import type {
  Operations,
  PreviewMapResources,
} from "@antelopejs/interface-dms-builder";
import {
  BUILDER_FETCH_TIMEOUT_MS,
  BUILDER_SLOW_OP_TIMEOUTS_MS,
  BUILDER_LOG_PREFIX,
  BUILDER_OP_PATH,
  BUILDER_UNKNOWN_OP,
} from "../constants/builder.js";
import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import { type JsonValue, JsonValueSchema } from "../protocol/json.js";
import { z } from "zod";

/** The operation map of the interface and `PreviewMapResources`, which the interface exports beside it. */
type BuilderOperations = typeof Operations & {
  PreviewMapResources: typeof PreviewMapResources;
};

/** The name of a Builder operation the backend route runs. */
export type BuilderOperationName = keyof BuilderOperations;

/** The parameters of one Builder operation, as the interface declares them. */
export type BuilderOpArgs<N extends BuilderOperationName> = Parameters<
  BuilderOperations[N]
>;

export interface BuilderClient {
  /** Runs one Builder operation; the backend route runs it with these arguments. */
  call<N extends BuilderOperationName>(
    op: N,
    args: BuilderOpArgs<N>,
  ): Promise<JsonValue>;
}

export interface BuilderClientOptions {
  backendBaseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

const REFUSAL_BODY = z.object({ error: z.string() });

/** The error name of a refused request: the route's `unknown_op` for an operation the installed interface lacks. */
async function refusalOf(response: Response): Promise<string | undefined> {
  return REFUSAL_BODY.safeParse(await response.json().catch(() => undefined))
    .data?.error;
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
          if ((await refusalOf(response)) === BUILDER_UNKNOWN_OP) {
            return {
              ok: false,
              error: { code: BUILDER_UNKNOWN_OP, detail: op },
            };
          }
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
