// GENERATED CODE! DO NOT MODIFY BY HAND!
// Pruned to the transitive closure of PROTOCOL_ROOTS and flattened by
// sidecar/scripts/generate-codex-types.mjs. Run `pnpm generate:codex-types`.

import type { AbsolutePathBuf, FunctionCallOutputBody, ImageDetail, ImageGenerationItem, LegacyAppPathString, MessagePhase, ReasoningEffort, SleepItem, SubAgentSource, WebSearchItem } from "./common.js";
import type { JsonValue } from "./serde_json.js";

export type AgentMessageDelivery = "async";

/**
 * Configures who approval requests are routed to for review. Examples
 * include sandbox escapes, blocked network access, MCP approval prompts, and
 * ARC escalations. Defaults to `user`. `auto_review` uses a carefully
 * prompted subagent to gather relevant context and apply a risk-based
 * decision framework before approving or denying the request.
 */
export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";

export type AskForApproval = "untrusted" | "on-request" | { "granular": { sandbox_approval: boolean, rules: boolean, skill_approval: boolean, request_permissions: boolean, mcp_elicitations: boolean, } } | "never";

export type AsyncUserInputQuestion = { title: string, options: Array<string> | null, };

export type ByteRange = { start: number, end: number, };

/**
 * This translation layer make sure that we expose codex error code in camel case.
 *
 * When an upstream HTTP status is available (for example, from the Responses API or a provider),
 * it is forwarded in `httpStatusCode` on the relevant `codexErrorInfo` variant.
 */
export type CodexErrorInfo = "contextWindowExceeded" | "sessionBudgetExceeded" | "usageLimitExceeded" | "rateLimitExceeded" | "serverOverloaded" | "cyberPolicy" | "misalignmentPolicyViolation" | { "httpConnectionFailed": { httpStatusCode: number | null, } } | { "responseStreamConnectionFailed": { httpStatusCode: number | null, } } | "internalServerError" | "unauthorized" | "badRequest" | "threadRollbackFailed" | "sandboxError" | { "responseStreamDisconnected": { httpStatusCode: number | null, } } | { "responseTooManyFailedAttempts": { httpStatusCode: number | null, } } | { "activeTurnNotSteerable": { turnKind: NonSteerableTurnKind, } } | "other";

export type CollabAgentState = { status: CollabAgentStatus, message: string | null, };

export type CollabAgentStatus = "pendingInit" | "running" | "interrupted" | "completed" | "errored" | "shutdown" | "notFound";

export type CollabAgentTool = "spawnAgent" | "sendInput" | "resumeAgent" | "wait" | "closeAgent" | "sendMessage" | "followupTask" | "interruptAgent" | "listAgents";

export type CollabAgentToolCallStatus = "inProgress" | "completed" | "failed" | "interrupted";

export type CommandAction = { "type": "read", command: string, name: string, path: LegacyAppPathString, } | { "type": "listFiles", command: string, path: string | null, } | { "type": "search", command: string, query: string | null, path: string | null, } | { "type": "unknown", command: string, };

export type CommandExecutionSource = "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";

export type CommandExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

export type DynamicToolCallOutputContentItem = { "type": "inputText", text: string, } | { "type": "inputImage", imageUrl: string, } | { "type": "inputAudio", audioUrl: string, };

export type DynamicToolCallStatus = "inProgress" | "completed" | "failed";

export type FileUpdateChange = { path: string, kind: PatchChangeKind, diff: string, };

export type GitInfo = { sha: string | null, branch: string | null, originUrl: string | null, };

export type HookPromptFragment = { text: string, hookRunId: string, };

export type McpToolCallAppContext = { connectorId: string, linkId: string | null, resourceUri: string | null, appName: string | null, actionName: string | null, };

export type McpToolCallError = { message: string, };

export type McpToolCallResult = { content: Array<JsonValue>, structuredContent: JsonValue | null, _meta: JsonValue | null, };

export type McpToolCallStatus = "inProgress" | "completed" | "failed";

export type MemoryCitation = { entries: Array<MemoryCitationEntry>, threadIds: Array<string>, };

export type MemoryCitationEntry = { path: string, lineStart: number, lineEnd: number, note: string, };

export type MisalignmentErrorDetails = {
/**
 * Open-ended classification; clients must accept categories added by Responses.
 */
errorType: string | null,
/**
 * A substantive localized explanation is required before offering continuation.
 */
detailedExplanation: string | null,
/**
 * Instruction to submit as the next turn's user input if continuation is confirmed.
 */
steer: MisalignmentSteer | null, };

export type MisalignmentSteer = { message: string, };

export type NetworkAccess = "restricted" | "enabled";

export type NonSteerableTurnKind = "review" | "compact";

export type PatchApplyStatus = "inProgress" | "completed" | "failed" | "declined";

export type PatchChangeKind = { "type": "add" } | { "type": "delete" } | { "type": "update", move_path: string | null, };

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type SandboxPolicy = { "type": "dangerFullAccess" } | { "type": "readOnly", networkAccess: boolean, } | { "type": "externalSandbox", networkAccess: NetworkAccess, } | { "type": "workspaceWrite", writableRoots: Array<AbsolutePathBuf>, networkAccess: boolean, excludeTmpdirEnvVar: boolean, excludeSlashTmp: boolean, };

export type SessionSource = "cli" | "vscode" | "exec" | "appServer" | { "custom": string } | { "subAgent": SubAgentSource } | "unknown";

export type SkillDependencies = { tools: Array<SkillToolDependency>, };

export type SkillErrorInfo = { path: string, message: string, };

export type SkillInterface = { displayName?: string, shortDescription?: string, iconSmall?: AbsolutePathBuf, iconLarge?: AbsolutePathBuf,
/**
 * Remote small icon URL from the plugin catalog.
 */
iconSmallUrl: string | null,
/**
 * Remote large icon URL from the plugin catalog.
 */
iconLargeUrl: string | null, brandColor?: string, defaultPrompt?: string, };

export type SkillMetadata = { name: string, description: string,
/**
 * Legacy short_description from SKILL.md. Prefer SKILL.json interface.short_description.
 */
shortDescription?: string, interface?: SkillInterface, dependencies?: SkillDependencies, path: AbsolutePathBuf, scope: SkillScope, enabled: boolean,
/**
 * Owning plugin ID, matching `PluginSummary.id`, when known.
 */
pluginId: string | null, };

export type SkillScope = "user" | "repo" | "system" | "admin";

export type SkillToolDependency = { type: string, value: string, description?: string, transport?: string, command?: string, url?: string, };

export type SkillsConfigWriteParams = {
/**
 * Path-based selector.
 */
path?: AbsolutePathBuf | null,
/**
 * Name-based selector.
 */
name?: string | null, enabled: boolean, };

export type SkillsListEntry = { cwd: string, skills: Array<SkillMetadata>, errors: Array<SkillErrorInfo>, };

export type SkillsListResponse = { data: Array<SkillsListEntry>, };

export type SubAgentActivityKind = "started" | "interacted" | "interrupted" | "completed";

export type TextElement = {
/**
 * Byte range in the parent `text` buffer that this element occupies.
 */
byteRange: ByteRange,
/**
 * Optional human-readable placeholder for the element, displayed in the UI.
 */
placeholder: string | null, };

export type Thread = {/**
 * Identifier for this thread. Codex-generated thread IDs are UUIDv7.
 */
id: string, /**
 * Session id shared by threads that belong to the same session tree.
 */
sessionId: string, /**
 * Source thread id when this thread was created by forking another thread.
 */
forkedFromId: string | null, /**
 * The ID of the parent thread. This will only be set if this thread is a subagent.
 */
parentThreadId: string | null, /**
 * Usually the first user message in the thread, if available.
 */
preview: string, /**
 * Whether the thread is ephemeral and should not be materialized on disk.
 */
ephemeral: boolean, /**
 * The independently persisted section selected for this thread, if any.
 */
section: ThreadSection | null, /**
 * Unix timestamp in seconds when the thread entered its current section.
 */
sectionEnteredAt: number | null, /**
 * Canonical project assignment owned by app-server, if any.
 */
projectId: string | null, /**
 * Persisted thread history contract selected when this thread was created.
 */
historyMode: ThreadHistoryMode, /**
 * Model provider used for this thread (for example, 'openai').
 */
modelProvider: string, /**
 * Current configured model when loaded, otherwise the latest persisted model.
 * Null when unavailable. This is not per-turn execution telemetry.
 */
model: string | null, /**
 * Current configured reasoning effort when loaded, otherwise the latest persisted effort.
 * Null when unset or unavailable. This is not per-turn execution telemetry.
 */
reasoningEffort: ReasoningEffort | null, /**
 * Unix timestamp (in seconds) when the thread was created.
 */
createdAt: number, /**
 * Unix timestamp (in seconds) when the thread was last updated.
 */
updatedAt: number, /**
 * Unix timestamp (in seconds) used for thread recency ordering.
 */
recencyAt: number | null, /**
 * Current runtime status for the thread.
 */
status: ThreadStatus, /**
 * [UNSTABLE] Path to the thread on disk.
 */
path: string | null, /**
 * Working directory captured for the thread.
 */
cwd: AbsolutePathBuf, /**
 * Version of the CLI that created the thread.
 */
cliVersion: string, /**
 * Originator recorded when the thread was created, independent of its current client or executor.
 * Null when the recorded originator is unavailable.
 */
originator: string | null, /**
 * Origin of the thread (CLI, VSCode, codex exec, codex app-server, etc.).
 */
source: SessionSource, /**
 * Optional analytics source classification for this thread.
 */
threadSource: ThreadSource | null, /**
 * Optional random unique nickname assigned to an AgentControl-spawned sub-agent.
 */
agentNickname: string | null, /**
 * Optional role (agent_role) assigned to an AgentControl-spawned sub-agent.
 */
agentRole: string | null, /**
 * Optional Git metadata captured when the thread was created.
 */
gitInfo: GitInfo | null, /**
 * Optional user-facing thread title.
 */
name: string | null, /**
 * Only populated on `thread/resume`, `thread/rollback`, `thread/fork`, and `thread/read`
 * (when `includeTurns` is true) responses.
 * For all other responses and notifications returning a Thread,
 * the turns field will be an empty list.
 */
turns: Array<Turn>};

export type ThreadActiveFlag = "waitingOnApproval" | "waitingOnUserInput";

export type ThreadHistoryMode = "legacy" | "paginated";

export type ThreadItem = { "type": "userMessage", id: string, clientId: string | null, content: Array<UserInput>, } | { "type": "hookPrompt", id: string, fragments: Array<HookPromptFragment>, } | { "type": "agentMessage", id: string, text: string, phase: MessagePhase | null, memoryCitation: MemoryCitation | null, delivery: AgentMessageDelivery | null, questions: Array<AsyncUserInputQuestion> | null, } | { "type": "functionCallOutput", id: string, name: string, namespace: string | null, output: FunctionCallOutputBody, } | { "type": "plan", id: string, text: string, } | { "type": "reasoning", id: string, summary: Array<string>, content: Array<string>, } | { "type": "commandExecution", id: string,
/**
 * Trusted first-party plugin id when this command resolves to one plugin script.
 */
pluginId: string | null,
/**
 * Safe plugin-relative path when this command resolves to one plugin script.
 */
scriptPath: string | null,
/**
 * The command to be executed.
 */
command: string,
/**
 * The command's working directory.
 */
cwd: LegacyAppPathString,
/**
 * Identifier for the underlying PTY process (when available).
 */
processId: string | null, source: CommandExecutionSource, status: CommandExecutionStatus,
/**
 * A best-effort parsing of the command to understand the action(s) it will perform.
 * This returns a list of CommandAction objects because a single shell command may
 * be composed of many commands piped together.
 */
commandActions: Array<CommandAction>,
/**
 * The command's output, aggregated from stdout and stderr.
 */
aggregatedOutput: string | null,
/**
 * The command's exit code.
 */
exitCode: number | null,
/**
 * The duration of the command execution in milliseconds.
 */
durationMs: number | null, } | { "type": "fileChange", id: string, changes: Array<FileUpdateChange>, status: PatchApplyStatus, } | { "type": "mcpToolCall", id: string, server: string, tool: string, status: McpToolCallStatus, arguments: JsonValue, appContext: McpToolCallAppContext | null,
/**
 * Deprecated: use `appContext.resourceUri` instead.
 */
mcpAppResourceUri?: string, pluginId: string | null, readOnlyHint: boolean | null, result: McpToolCallResult | null, error: McpToolCallError | null,
/**
 * The duration of the MCP tool call in milliseconds.
 */
durationMs: number | null, } | { "type": "dynamicToolCall", id: string, namespace: string | null, tool: string, arguments: JsonValue, status: DynamicToolCallStatus, contentItems: Array<DynamicToolCallOutputContentItem> | null, success: boolean | null,
/**
 * The duration of the dynamic tool call in milliseconds.
 */
durationMs: number | null, } | { "type": "collabAgentToolCall",
/**
 * Unique identifier for this collab tool call.
 */
id: string,
/**
 * Name of the collab tool that was invoked.
 */
tool: CollabAgentTool,
/**
 * Current status of the collab tool call.
 */
status: CollabAgentToolCallStatus,
/**
 * Thread ID of the agent issuing the collab request.
 */
senderThreadId: string,
/**
 * Thread ID of the receiving agent, when applicable. In case of spawn operation,
 * this corresponds to the newly spawned agent.
 */
receiverThreadIds: Array<string>,
/**
 * Prompt text sent as part of the collab tool call, when available.
 */
prompt: string | null,
/**
 * Model requested for the spawned agent, when applicable.
 */
model: string | null,
/**
 * Reasoning effort requested for the spawned agent, when applicable.
 */
reasoningEffort: ReasoningEffort | null,
/**
 * Last known status of the target agents, when available.
 */
agentsStates: { [key in string]?: CollabAgentState }, } | { "type": "subAgentActivity", id: string, kind: SubAgentActivityKind, agentThreadId: string, agentPath: string, } | { "type": "webSearch" } & WebSearchItem | { "type": "imageView", id: string, path: LegacyAppPathString, } | { "type": "sleep" } & SleepItem | { "type": "imageGeneration" } & ImageGenerationItem | { "type": "enteredReviewMode", id: string, review: string, } | { "type": "exitedReviewMode", id: string, review: string, } | { "type": "contextCompaction", id: string, };

/**
 * An independently persisted, user-visible thread section.
 */
export type ThreadSection = {
/**
 * Opaque UUIDv7 identity that remains stable when the section is renamed.
 */
id: string,
/**
 * The current user-visible section name.
 */
name: string,
/**
 * Optional appearance synchronized across clients.
 */
appearance: ThreadSectionAppearance | null, };

/**
 * Extensible visual presentation for a custom thread section.
 */
export type ThreadSectionAppearance = { icon: string | null, color: string | null, };

export type ThreadSource = string;

export type ThreadStartResponse = {thread: Thread, model: string, modelProvider: string, serviceTier: string | null, cwd: AbsolutePathBuf, /**
 * Environment-native paths to instruction source files currently loaded for this thread.
 */
instructionSources: Array<LegacyAppPathString>, approvalPolicy: AskForApproval, /**
 * Reviewer currently used for approval requests on this thread.
 */
approvalsReviewer: ApprovalsReviewer, /**
 * Legacy sandbox policy retained for compatibility. Experimental clients
 * should prefer `activePermissionProfile` for profile provenance.
 */
sandbox: SandboxPolicy, reasoningEffort: ReasoningEffort | null};

export type ThreadStatus = { "type": "notLoaded" } | { "type": "idle" } | { "type": "systemError" } | { "type": "active", activeFlags: Array<ThreadActiveFlag>, };

export type ThreadTokenUsage = { total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow: number | null, };

export type ThreadTokenUsageUpdatedNotification = { threadId: string, turnId: string, tokenUsage: ThreadTokenUsage, };

export type TokenUsageBreakdown = { totalTokens: number, inputTokens: number, cachedInputTokens: number, cacheWriteInputTokens: number, outputTokens: number, reasoningOutputTokens: number, };

export type Turn = {
/**
 * Identifier for this turn. Codex-generated turn IDs are UUIDv7.
 */
id: string,
/**
 * Thread items currently included in this turn payload.
 */
items: Array<ThreadItem>,
/**
 * Describes how much of `items` has been loaded for this turn.
 */
itemsView: TurnItemsView, status: TurnStatus,
/**
 * Only populated when the Turn's status is failed.
 */
error: TurnError | null,
/**
 * Unix timestamp (in seconds) when the turn started.
 */
startedAt: number | null,
/**
 * Unix timestamp (in seconds) when the turn completed.
 */
completedAt: number | null,
/**
 * Duration between turn start and completion in milliseconds, if known.
 */
durationMs: number | null, };

export type TurnError = { message: string, codexErrorInfo: CodexErrorInfo | null, additionalDetails: string | null,
/**
 * Optional public explanation and continuation instruction for a misalignment block.
 */
misalignment: MisalignmentErrorDetails | null, };

export type TurnItemsView = "notLoaded" | "summary" | "full";

export type TurnPlanStep = { step: string, status: TurnPlanStepStatus, };

export type TurnPlanStepStatus = "pending" | "inProgress" | "completed";

export type TurnStartedNotification = { threadId: string, turn: Turn, };

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export type UserInput = { "type": "text", text: string,
/**
 * UI-defined spans within `text` used to render or persist special elements.
 */
text_elements: Array<TextElement>, } | { "type": "image", detail?: ImageDetail, url: string, } | { "type": "localImage", detail?: ImageDetail, path: string, } | { "type": "audio", url: string, } | { "type": "localAudio", path: string, } | { "type": "skill", name: string, path: string, } | { "type": "mention", name: string, path: string, };

export type WebSearchAction = { "type": "search", query: string | null, queries: Array<string> | null, } | { "type": "openPage", url: string | null, } | { "type": "findInPage", url: string | null, pattern: string | null, } | { "type": "other" };
