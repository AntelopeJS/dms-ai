import {
  ensureSidecarRunning,
  getSidecarClientToken,
  getSidecarPort,
} from "../lifecycle/spawn-sidecar";

const SIDECAR_HOST = "http://127.0.0.1";

export type QueryParams = Record<string, string | undefined>;

export function buildQuery(params: QueryParams): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") sp.set(key, value);
  }
  const serialized = sp.toString();
  return serialized ? `?${serialized}` : "";
}

async function sidecarFetch(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  await ensureSidecarRunning();
  const port = getSidecarPort();
  if (port === null) throw new Error("dms-ai sidecar is not running");
  const token = getSidecarClientToken();
  if (!token) throw new Error("dms-ai sidecar client credential is missing");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${SIDECAR_HOST}:${port}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) throw new Error(`dms-ai sidecar responded ${res.status}`);
  return res.json();
}

/**
 * GET a sidecar JSON endpoint, returning a safe fallback when the sidecar is
 * down or errors — so the dashboard renders empty rather than throwing.
 */
export async function sidecarGet<T>(path: string, fallback: T): Promise<T> {
  try {
    return (await sidecarFetch(path)) as T;
  } catch {
    return fallback;
  }
}

export async function sidecarPut<T>(
  path: string,
  body: unknown,
  fallback: T,
): Promise<T> {
  try {
    return (await sidecarFetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })) as T;
  } catch {
    return fallback;
  }
}
