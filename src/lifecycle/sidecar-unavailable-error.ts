/** Raised when no sidecar can be reached, so the caller answers 503. */
export class SidecarUnavailableError extends Error {
  constructor() {
    super("dms-ai sidecar is not reachable");
  }
}
