import { SIDECAR_UNAVAILABLE_STATUS } from "./sidecar";

export const HTTP_STATUS = {
  OK: 200,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAVAILABLE: SIDECAR_UNAVAILABLE_STATUS,
} as const;

/** Said by every route that needs the sidecar while it cannot be reached. */
export const ASSISTANT_UNAVAILABLE_MESSAGE = "The assistant isn't running.";
/** Said when the sidecar refused without a message of its own. */
export const ASSISTANT_REFUSED_MESSAGE = "The assistant refused the request.";

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";
