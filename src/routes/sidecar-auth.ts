import { timingSafeEqual } from "node:crypto";
import { HTTPResult } from "@antelopejs/interface-api";
import { getSidecarToken } from "../lifecycle/spawn-sidecar";

const FORBIDDEN_STATUS = 403;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isSidecarRequest(token: string | undefined): boolean {
  if (token === undefined || token.length === 0) return false;
  const expected = getSidecarToken();
  if (expected === null) return false;
  return safeEqual(token, expected);
}

export function sidecarForbidden(): HTTPResult {
  return new HTTPResult(FORBIDDEN_STATUS, { error: "forbidden" });
}
