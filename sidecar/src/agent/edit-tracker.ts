export const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
]);

export function extractEditedFilePath(args: unknown): string | undefined {
  if (args === null || typeof args !== "object") return undefined;
  const value = (args as { file_path?: unknown }).file_path;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface EditTracker {
  record(conversationId: string, filePath: string): void;
  getEditedFiles(conversationId: string): string[];
  getLastEditedFile(conversationId: string): string | undefined;
  clear(conversationId: string): void;
}

export function createEditTracker(): EditTracker {
  const byConversation = new Map<string, string[]>();
  return {
    record: (conversationId, filePath) => {
      const list = byConversation.get(conversationId) ?? [];
      list.push(filePath);
      byConversation.set(conversationId, list);
    },
    getEditedFiles: (conversationId) => [
      ...(byConversation.get(conversationId) ?? []),
    ],
    getLastEditedFile: (conversationId) => {
      const list = byConversation.get(conversationId);
      if (list === undefined || list.length === 0) return undefined;
      return list[list.length - 1];
    },
    clear: (conversationId) => {
      byConversation.delete(conversationId);
    },
  };
}
