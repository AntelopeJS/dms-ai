import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import {
  CHATBOX_DEFAULT_CONTENT_TYPE,
  CHATBOX_RELAYED_HEADERS,
  CHATBOX_RESPONSE_HEADERS,
  CHATBOX_UNAVAILABLE_STATUS,
} from "../constants/chatbox";
import { SIDECAR_LOOPBACK_HOST } from "../constants/sidecar";
import { SidecarUnavailableError } from "../lifecycle/sidecar-socket";
import {
  ensureSidecarRunning,
  getSidecarPort,
} from "../lifecycle/spawn-sidecar";

/** Loads one file from the sidecar's static server; injectable for tests. */
export type ChatboxLoader = (path: string) => Promise<Response>;

const UNAVAILABLE_BODY = { error: "sidecar_unavailable" };

/**
 * The chatbox files are public on loopback, so no credential is sent: the
 * passthrough cannot be turned into a way to the sidecar's protected routes.
 */
async function loadFromSidecar(path: string): Promise<Response> {
  await ensureSidecarRunning();
  const port = getSidecarPort();
  if (port === null) throw new SidecarUnavailableError();
  return fetch(`http://${SIDECAR_LOOPBACK_HOST}:${port}${path}`);
}

async function tryLoad(
  load: ChatboxLoader,
  path: string,
): Promise<Response | null> {
  try {
    return await load(path);
  } catch {
    return null;
  }
}

function applyHeaders(ctx: RequestContext, upstream: Response): void {
  for (const [name, value] of Object.entries(CHATBOX_RESPONSE_HEADERS)) {
    ctx.response.addHeader(name, value);
  }
  for (const name of CHATBOX_RELAYED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) ctx.response.addHeader(name, value);
  }
}

/**
 * Streams one chatbox file from the sidecar to the browser, status and body
 * untouched, under the chat's Content-Security-Policy. The copy runs after the
 * handler returns: the response stream only drains once the API sends it.
 */
export async function relayChatboxFile(
  ctx: RequestContext,
  path: string,
  load: ChatboxLoader = loadFromSidecar,
): Promise<HTTPResult | undefined> {
  const upstream = await tryLoad(load, path);
  if (upstream === null) {
    return new HTTPResult(CHATBOX_UNAVAILABLE_STATUS, UNAVAILABLE_BODY);
  }
  applyHeaders(ctx, upstream);
  const contentType =
    upstream.headers.get("content-type") ?? CHATBOX_DEFAULT_CONTENT_TYPE;
  const sink = ctx.response.getWriteStream(contentType, upstream.status);
  if (upstream.body === null) {
    sink.end();
    return undefined;
  }
  const body = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
  void pipeline(body, sink).catch(() => sink.destroy());
  return undefined;
}
