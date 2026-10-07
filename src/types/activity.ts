/** One audit log entry, as the sidecar lists it. */
export interface ActivityRow {
  id: string;
  timestampMs: number;
  tool: string;
  target: string;
  agent: string;
  allowedBy: string;
  result: string;
  resultDetail?: string;
  changeSetId?: string;
  changeSetNumber?: number;
  conversationId: string;
  conversationTitle: string;
  durationMs?: number;
  isReadOnly: boolean;
  isAutoFix: boolean;
  category: string[];
  added?: number;
  removed?: number;
  expiresAtMs?: number;
}

/** A page of a sidecar list. */
export interface SidecarList<T> {
  results: T[];
  total: number;
}

/** An audit log entry as the table reads it: its id and an ISO time. */
export interface ActivityTableRow extends ActivityRow {
  _id: string;
  timestamp: string;
}
