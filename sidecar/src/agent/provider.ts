import type { AllowedBy } from "../constants/audit.js";
import type { AiMcpServer } from "../mcp/types.js";
import type { AttachmentType } from "../protocol/messages.js";
import type { SkillSource } from "../skills/types.js";
import type { CurrentPage } from "../state/host-state.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TokenUsage } from "../state/types.js";
import type { PermissionBus } from "./permission-bus.js";
import type { RunnerError, RunnerEvent } from "./runner-events.js";

/**
 * A user turn before any provider-specific rendering. `text` is already grounded
 * with the host-context block; attachments are raw and each provider decides how
 * to carry them (inline blocks, files on disk, …).
 */
export interface TurnInput {
  text: string;
  attachments: readonly AttachmentType[];
}

/** How a call was let through (or refused) without the permission bus. */
export interface ToolDecision {
  callId?: string;
  toolName: string;
  allowedBy: AllowedBy;
}

/** The hooks a provider reports its tool calls through. */
export interface ToolCallHooks {
  /**
   * A call decided without the permission bus: auto-allowed reads, safe-mode
   * refusals. The bus reports its own decisions.
   */
  onToolDecision?: (decision: ToolDecision) => void;
  /** A call the provider is about to run, with its id (see CallLedger). */
  onToolAnnounced?: (callId: string, toolName: string, args: unknown) => void;
  /** Awaited before a mutating tool runs: the turn's checkpoint is taken. */
  beforeMutation?: () => Promise<void>;
}

/** Everything a provider needs to open a session for one conversation. */
export interface ProviderSessionContext extends ToolCallHooks {
  conversationId: string;
  hostProjectRoot: string;
  /** Reads the host's displayed page live, for the session's initial prompt. */
  getCurrentPage: () => CurrentPage;
  /** Settings in force when the session is created. */
  settings: AppSettings;
  permissionBus?: PermissionBus;
  mcpServer?: AiMcpServer;
  /**
   * Tokens one model call cost, as a delta the connection layer accumulates.
   * Providers that do not report usage never call it.
   */
  onTokenUsage?: (usage: TokenUsage) => void;
  /**
   * Called when the session tears itself down, so the runner can drop it, with
   * the teardown so the runner can still wait for it.
   */
  onDisposed: (disposal: Promise<void>) => void;
}

/**
 * One live conversation on a provider. Settings travel with every turn, so a
 * provider that cannot change them in place stays correct without `applySettings`.
 */
export interface ProviderSession {
  runTurn(input: TurnInput, settings: AppSettings): AsyncIterable<RunnerEvent>;
  interrupt(): void;
  /**
   * Resolves once the backend has released everything and a turn still running
   * has ended, with `reason` when given. Never rejects.
   */
  dispose(reason?: RunnerError): Promise<void>;
  /**
   * Optional in-place settings update. Takes effect at the latest on the next
   * turn; providers that only read settings per turn may omit it.
   */
  applySettings?(settings: AppSettings): void;
}

/** The single seam every agent backend implements. */
export interface AgentProvider {
  createSession(ctx: ProviderSessionContext): Promise<ProviderSession>;
}

export interface AgentProviderOptions {
  timeoutMs?: number;
  settings?: AppSettings;
  /**
   * On-disk roots of loaded modules (from interface-core), auto-allowed for
   * read-only tools alongside the host project.
   */
  moduleRoots?: string[];
  /**
   * Module-contributed skill sources (from `antelopeJs.skills`), loaded into the
   * agent and added to the readable roots.
   */
  skillDirs?: SkillSource[];
}

export type AgentProviderFactory = (
  options?: AgentProviderOptions,
) => AgentProvider;
