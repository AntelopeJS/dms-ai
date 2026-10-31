/** The members of a change set the sidecar always sends, beside the ones a test is about. */
const CHANGE_SET_BASE = {
  conversationId: "c-1",
  agent: "claude",
  scope: "safe",
  isAutoFix: false,
  overlapped: false,
  typecheck: "passed",
  approvalsNeeded: 0,
  builderOps: 0,
};

/** One audit log entry, as the sidecar lists it. */
const ROW = {
  id: "c-1:call-1",
  timestampMs: Date.UTC(2026, 9, 7, 14, 2),
  tool: "BuilderAddBlock",
  target: "sales/overview",
  agent: "claude",
  allowedBy: "builder_auto",
  result: "done",
  conversationId: "c-1",
  conversationTitle: "Top customers",
  isReadOnly: false,
  isAutoFix: false,
  category: ["changed"],
};

module.exports = { CHANGE_SET_BASE, ROW };
