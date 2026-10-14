/** What `GET /ai/status` answers: the sidecar's status and its process state. */
export interface AssistantStatus {
  status: string;
  provider?: string;
  builderAvailable?: boolean;
  mode?: string;
  generationMode?: string;
  workingConversations?: number;
  pendingApprovals?: number;
  pendingQuestions?: number;
  port?: number;
  version?: string;
  lastError?: string;
  isRunning: boolean;
  hasGivenUp: boolean;
  disabled: boolean;
}
