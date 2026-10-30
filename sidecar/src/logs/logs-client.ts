import { z } from "zod";
import { SIDECAR_AUTH_HEADER } from "../constants/daemon.js";
import {
  LOGS_FETCH_FAILED_MESSAGE,
  LOGS_FETCH_TIMEOUT_MS,
  LOGS_LOG_PREFIX,
  LOGS_PATH,
} from "../constants/logs.js";
import { isJsonValue } from "../protocol/json.js";
import type { BufferedLog, LogQuery } from "./types.js";

export interface LogsClient {
  getLogs(query: LogQuery): Promise<BufferedLog[]>;
}

export interface LogsClientOptions {
  backendBaseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "warn">;
}

function buildHeaders(token: string | undefined): Record<string, string> {
  return token === undefined ? {} : { [SIDECAR_AUTH_HEADER]: token };
}

function buildUrl(baseUrl: string, query: LogQuery): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (query.since !== undefined) params.set("since", String(query.since));
  if (query.level !== undefined) params.set("level", String(query.level));
  if (query.channel !== undefined) params.set("channel", query.channel);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  return `${trimmed}${LOGS_PATH}${qs.length > 0 ? `?${qs}` : ""}`;
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: typeof fetch,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGS_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

const BufferedLogSchema = z.object({
  time: z.number(),
  channel: z.string(),
  levelId: z.number(),
  args: z.array(z.unknown().refine(isJsonValue)),
});

const BufferedLogListSchema = z.array(z.unknown()).catch([]);

export function createLogsClient(opts: LogsClientOptions): LogsClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const logger = opts.logger ?? console;
  const headers = buildHeaders(opts.token);
  return {
    getLogs: async (query) => {
      try {
        const response = await fetchWithTimeout(
          buildUrl(opts.backendBaseUrl, query),
          fetchImpl,
          headers,
        );
        if (!response.ok) {
          throw new Error(`logs fetch failed: ${response.status}`);
        }
        return BufferedLogListSchema.parse(await response.json()).flatMap(
          (entry) => {
            const log = BufferedLogSchema.safeParse(entry);
            return log.success ? [log.data] : [];
          },
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(
          `${LOGS_LOG_PREFIX} ${LOGS_FETCH_FAILED_MESSAGE} (${reason})`,
        );
        return [];
      }
    },
  };
}
