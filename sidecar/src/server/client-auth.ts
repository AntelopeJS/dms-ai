import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const BEARER_PREFIX = "Bearer ";

/**
 * Accepts only the client credential as a Bearer header, which the DMS backend
 * sends: never ambient cookies, an Origin, or a WebSocket subprotocol.
 */
export function isClientAuthorized(
  req: IncomingMessage,
  expected: string,
): boolean {
  if (!expected) return false;
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith(BEARER_PREFIX)) return false;
  const actual = Buffer.from(authorization.slice(BEARER_PREFIX.length));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
