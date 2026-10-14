/** A file a change set touched. */
export interface ChangeSetFile {
  path: string;
  status: string;
  added: number;
  removed: number;
}

/** A change set, as the sidecar lists it. */
export interface ChangeSetSummary {
  id: string;
  number: number;
  conversationId: string;
  title: string;
  createdAtMs: number;
  agent: string;
  scope: string;
  isAutoFix: boolean;
  overlapped: boolean;
  files: ChangeSetFile[];
  added: number;
  removed: number;
  typecheck: string;
  state: string;
  stateChangedAtMs?: number;
  stateChangedBy?: string;
  askedBy?: string;
  approvalsNeeded: number;
  builderOps: number;
}

/** A change set as the Overview's table reads it. */
export interface ChangeSetTableRow extends ChangeSetSummary {
  _id: string;
  createdAt: string;
  filesCount: number;
  diffstat: string;
  stateDetail?: string;
}

/** A later change set touching the same files as the one being undone. */
export interface UndoConflict {
  changeSetId: string;
  number: number;
  title: string;
  files: string[];
}

/** What undoing a change set restores, and what it collides with. */
export interface UndoPreview {
  changeSetId: string;
  files: string[];
  conflicts: UndoConflict[];
}
