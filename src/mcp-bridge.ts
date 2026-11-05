import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import {
  BRIDGE_REFUSALS,
  BRIDGE_UNREACHABLE,
  HTTP_ACCEPTED,
  JSON_RPC_INTERNAL_ERROR,
} from "./constants/mcp";

/** What the module publishes for the bridge: the route and its credential. */
const BridgeConfigSchema = z.object({ url: z.string(), token: z.string() });

type BridgeConfig = z.infer<typeof BridgeConfigSchema>;

/** A request's id, so a failure can answer it. A notification has none. */
const RequestIdSchema = z.object({
  method: z.string(),
  id: z.union([z.string(), z.number()]),
});

interface RelayAnswer {
  status: number;
  text: string;
}

async function readConfig(configPath: string): Promise<BridgeConfig> {
  return BridgeConfigSchema.parse(
    JSON.parse(await readFile(configPath, "utf8")),
  );
}

/** No timeout: a mapping of many tables runs for minutes before it answers. */
function post(config: BridgeConfig, body: string): Promise<RelayAnswer> {
  const url = new URL(config.url);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function requestIdOf(line: string): string | number | undefined {
  try {
    return RequestIdSchema.safeParse(JSON.parse(line)).data?.id;
  } catch {
    return undefined;
  }
}

function failure(id: string | number, message: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: JSON_RPC_INTERNAL_ERROR, message },
  });
}

/** What a refusal of the backend means for the person running the session. */
function refusalMessage(status: number): string {
  return (
    BRIDGE_REFUSALS.get(status) ?? `${BRIDGE_UNREACHABLE} (HTTP ${status})`
  );
}

async function relay(
  configPath: string,
  line: string,
  write: (message: string) => void,
): Promise<void> {
  const id = requestIdOf(line);
  let answer: { status: number; text: string };
  try {
    answer = await post(await readConfig(configPath), line);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (id !== undefined)
      write(failure(id, `${BRIDGE_UNREACHABLE} (${reason})`));
    return;
  }
  if (answer.status === HTTP_ACCEPTED) return;
  if (answer.status >= 200 && answer.status < 300) {
    write(answer.text);
    return;
  }
  if (id !== undefined) write(failure(id, refusalMessage(answer.status)));
}

/**
 * Calls `onLine` with each `\n`-terminated line of the stream. MCP's stdio
 * framing is `\n` alone: `readline` would also split at U+2028 and U+2029,
 * which `JSON.stringify` leaves raw inside strings.
 */
function onLines(input: Readable, onLine: (line: string) => void): void {
  let pending = "";
  input.setEncoding("utf8");
  input.on("data", (chunk: string) => {
    const parts = `${pending}${chunk}`.split("\n");
    pending = parts.pop() ?? "";
    for (const part of parts) onLine(part);
  });
}

/**
 * The stdio MCP server Claude Code launches from the project's `.mcp.json`. It
 * relays each JSON-RPC line to the DMS backend, which revives the sidecar when
 * needed and answers with the project's tools. The config is read per message,
 * so a restarted backend (new credential) is picked up without a reconnect.
 * Messages are relayed concurrently: a long tool call does not hold a ping.
 */
export function runBridge(
  configPath: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): void {
  const write = (message: string) => output.write(`${message}\n`);
  onLines(input, (line) => {
    if (line.trim().length === 0) return;
    void relay(configPath, line, write);
  });
}
