/** The DMS permission a user needs to chat with the assistant. */
export const ASSISTANT_PERMISSION_ID = "ai.assistant";
export const ASSISTANT_PERMISSION_ICON = "i-ph-sparkle";

/**
 * Builder edits the project and reads the database catalog; Analyst answers
 * questions about the data, reading it as the user who asks.
 */
export const ASSISTANT_MODES = ["builder", "analyst"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

/** Header a sidecar request names the user it reads data for with. */
export const DATA_GRANT_HEADER = "x-dms-ai-grant";
export const DATA_GRANT_BYTES = 32;

export const HTTP_FORBIDDEN = 403;
