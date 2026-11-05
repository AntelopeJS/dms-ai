import type { z } from "zod";
import { generateAccessToken } from "@antelopejs/interface-dms/auth";
import { UserModel } from "@antelopejs/interface-dms/auth/db";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { GrantIdentity } from "../assistant/grants";
import { getConfig } from "../config";
import { DMS_LOCAL_BASE_URL } from "../constants/analyst";

/** A DMS route's answer to a request made as the user, parsed when it is a success. */
export type AsUserAnswer<T> =
  | { isOk: true; body: T }
  | { isOk: false; status: number };

export class GrantUserGoneError extends Error {}

const HTTP_BAD_REQUEST = 400;
const HTTP_BAD_GATEWAY = 502;

async function bearerFor(identity: GrantIdentity): Promise<string> {
  const user = await GetModel(UserModel).get(identity.userId);
  if (!user) throw new GrantUserGoneError(identity.userId);
  const { token } = await generateAccessToken(
    identity.tenantId,
    user,
    identity.sessionId,
  );
  return token;
}

function parseBody<T>(text: string, schema: z.ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Calls one of the DMS's own HTTP routes as the user a grant names, with an
 * access token minted for their tenant and bound to their session: the route
 * authenticates, authorizes and scopes the request exactly as it would the
 * user's browser, and a signed-out session stops it. The credential only ever
 * goes to the backend's own origin.
 */
export async function getAsUser<T>(
  identity: GrantIdentity,
  pathAndQuery: string,
  schema: z.ZodType<T>,
): Promise<AsUserAnswer<T>> {
  const base = new URL(getConfig().backendUrl ?? DMS_LOCAL_BASE_URL);
  const url = new URL(pathAndQuery, base);
  if (url.origin !== base.origin) {
    return { isOk: false, status: HTTP_BAD_REQUEST };
  }
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${await bearerFor(identity)}` },
  });
  if (!response.ok) return { isOk: false, status: response.status };
  const body = parseBody(await response.text(), schema);
  return body === null
    ? { isOk: false, status: HTTP_BAD_GATEWAY }
    : { isOk: true, body };
}
