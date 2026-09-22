/**
 * Display vocabulary shared by every provider adapter.
 *
 * These names are Claude's, and they stay Claude's on purpose. They are what
 * the chatbox renders and what the edit tracker, the tool summaries and the
 * permission prompts key off. The Codex adapter normalizes its own typed items
 * into this vocabulary so that the whole display layer — the file-change
 * animation included — works on both providers without a line of its own.
 *
 * This is a display lexicon, not an execution contract: nothing here decides
 * what an agent may run.
 */
export const TOOL_LEXICON = {
  BASH: "Bash",
  EDIT: "Edit",
  TODO_WRITE: "TodoWrite",
} as const;

/** Argument key `extractEditedFilePath` reads to drive the change animation. */
export const EDIT_FILE_PATH_ARG = "file_path";
export const BASH_COMMAND_ARG = "command";
