import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import { z } from "zod";
import {
  BACKEND_DOWN_MESSAGE,
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

function failure(id: string | number, reason: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: JSON_RPC_INTERNAL_ERROR,
      message: `${BACKEND_DOWN_MESSAGE} (${reason})`,
    },
  });
}

async function relay(
  configPath: string,
  line: string,
  write: (message: string) => void,
): Promise<void> {
  try {
    const answer = await post(await readConfig(configPath), line);
    if (answer.status === HTTP_ACCEPTED) return;
    if (answer.status < 200 || answer.status >= 300) {
      throw new Error(`HTTP ${answer.status}`);
    }
    write(answer.text);
  } catch (err) {
    const id = requestIdOf(line);
    if (id === undefined) return;
    write(failure(id, err instanceof Error ? err.message : String(err)));
  }
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
  const lines = readline.createInterface({ input });
  lines.on("line", (line) => {
    if (line.trim().length === 0) return;
    void relay(configPath, line, write);
  });
}
