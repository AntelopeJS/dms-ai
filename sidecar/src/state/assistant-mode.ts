/**
 * Builder edits the project and reads the database catalog; Analyst answers
 * questions about the data, reading it only as the user who asks.
 */
export const ASSISTANT_MODES = ["builder", "analyst"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

/** Who a conversation belongs to: the user who started it, in their tenant. */
export interface ConversationOwner {
  userId: string;
  tenantId: string;
}
