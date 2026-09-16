// Built-in tools that only ever read the filesystem, mapped to the argument
// that carries their target path. Reads of in-workspace files through these are
// auto-allowed (no permission prompt); everything mutating (Write/Edit/Bash) or
// networked (WebFetch/WebSearch) still prompts. A path-less Glob/Grep defaults
// to the project cwd, which is in-scope.
export const READ_ONLY_TOOL_PATH_KEYS: Record<string, string> = {
  Read: "file_path",
  LS: "path",
  Glob: "path",
  Grep: "path",
  NotebookRead: "notebook_path",
};
