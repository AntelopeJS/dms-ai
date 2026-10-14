import type { IncomingMessage, ServerResponse } from "node:http";
import { CONTENT_TYPE } from "../constants/http.js";

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export function sendResponse(
  res: ServerResponse,
  status: number,
  contentType: string,
  payload: unknown,
): void {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  sendResponse(res, status, CONTENT_TYPE.JSON, payload);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        rejectBody(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", rejectBody);
  });
}
