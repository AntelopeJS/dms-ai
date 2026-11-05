import { randomBytes } from "node:crypto";
import type { RequestContext } from "@antelopejs/interface-api";
import { z } from "zod";
import { DATA_GRANT_BYTES } from "../constants/assistant";

/** Whom a grant reads data as: a user, in one tenant, for one session. */
export interface GrantIdentity {
  userId: string;
  tenantId: string;
  /** The sign-in session the user's own credential belongs to. */
  sessionId?: string;
}

const BEARER_SCHEME = /^Bearer\s+(\S+)$/i;
const JWT_PAYLOAD_INDEX = 1;
const SessionClaimSchema = z.object({ sessionId: z.string().min(1) });

const grants = new Map<string, GrantIdentity>();

/**
 * The session the request's bearer token claims. Read only from a request
 * whose token the route's auth decorator has already verified.
 */
export function requestSessionId(ctx: RequestContext): string | undefined {
  const header = ctx.rawRequest?.headers?.authorization;
  const token = header?.match(BEARER_SCHEME)?.[1];
  const payload = token?.split(".")[JWT_PAYLOAD_INDEX];
  if (payload === undefined) return undefined;
  try {
    const claims = SessionClaimSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return claims.success ? claims.data.sessionId : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Issues the grant a bridge hands its sidecar socket: an unguessable id the
 * sidecar sends back to read data as this user, valid until revoked.
 */
export function issueGrant(identity: GrantIdentity): string {
  const id = randomBytes(DATA_GRANT_BYTES).toString("hex");
  grants.set(id, identity);
  return id;
}

export function revokeGrant(id: string): void {
  grants.delete(id);
}

export function resolveGrant(id: string | undefined): GrantIdentity | null {
  if (id === undefined || id.length === 0) return null;
  return grants.get(id) ?? null;
}

export function revokeAllGrants(): void {
  grants.clear();
}
