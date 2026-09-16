import type { RawData } from "ws";

/**
 * A ws message as text.
 *
 * `data.toString()` is right for the Buffer ws delivers by default, and wrong
 * for the two other shapes its `binaryType` option can produce: an ArrayBuffer
 * stringifies to "[object ArrayBuffer]", and an array of Buffers joins its
 * chunks with commas. Neither is reachable here today -- `binaryType` is never
 * set, and ws concatenates a fragmented frame itself -- so this is a contract
 * the helper honours rather than a bug it fixes.
 *
 * Total by construction: the ws `message` listener has no try/catch, so a throw
 * here would leave the EventEmitter and take the process down. An unexpected
 * shape degrades to its own `toString()`, which is what the caller's own
 * parsing already refuses.
 */
export function rawDataToText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  try {
    return Buffer.from(data).toString("utf8");
  } catch {
    // A shape @types/ws does not model -- a Blob under `binaryType: "blob"`.
    return String(data);
  }
}
