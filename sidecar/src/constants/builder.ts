export const SIDECAR_BUILDER_FLAG = "--builder-enabled";
export const BUILDER_OP_PATH = "/ai/builder/op";
export const BUILDER_FETCH_TIMEOUT_MS = 15_000;
export const BUILDER_LOG_PREFIX = "[builder]";

// The names of every Builder MCP tool (must match the `tool("…")` names in
// mcp/tools/builder.ts). They are typecheck-gated, atomic, and non-destructive by
// design (a failed op writes nothing), so they are auto-allowed without a prompt.
export const BUILDER_TOOL_NAMES = [
  "BuilderCatalog",
  "BuilderListPages",
  "BuilderPageStructure",
  "BuilderCreatePage",
  "BuilderConfigurePage",
  "BuilderDeletePage",
  "BuilderAddBlock",
  "BuilderConfigureBlock",
  "BuilderMoveBlock",
  "BuilderRemoveBlock",
  "BuilderCreateCategory",
  "BuilderConfigureCategory",
  "BuilderDeleteCategory",
  "BuilderRefresh",
  "BuilderCreateResource",
  "BuilderDeleteResource",
  "BuilderListResources",
  "BuilderResourceStructure",
  "BuilderAddField",
  "BuilderConfigureField",
  "BuilderRemoveField",
  "BuilderQueryTemplates",
  "BuilderAddQuery",
  "BuilderConfigureQuery",
  "BuilderRemoveQuery",
] as const;
