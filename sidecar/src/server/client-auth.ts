import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const BEARER_PREFIX = "Bearer ";
const PROTOCOL_PREFIX = "dms-ai.";

/** Accepts only explicit credentials, never ambient cookies or Origin alone. */
export function isClientAuthorized(
  req: IncomingMessage,
  expected: string,
): boolean {
  if (!expected) return false;
  const authorization = req.headers.authorization;
  const protocols = req.headers["sec-websocket-protocol"];
  const bearer = authorization?.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length)
    : undefined;
  const protocol =
    typeof protocols === "string"
      ? protocols
          .split(",")
          .map((value) => value.trim())
          .find((value) => value.startsWith(PROTOCOL_PREFIX))
      : undefined;
  const provided = bearer ?? protocol?.slice(PROTOCOL_PREFIX.length);
  if (!provided) return false;
  const actual = Buffer.from(provided);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
