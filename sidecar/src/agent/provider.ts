import type { PermissionDecision } from "../constants/permissions.js";
import type { AiMcpServer } from "../mcp/types.js";
import type { AttachmentType } from "../protocol/messages.js";
import type { SkillSource } from "../skills/types.js";
import type { CurrentPage } from "../state/host-state.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TokenUsage } from "../state/types.js";
import type { PermissionBus } from "./permission-bus.js";
import type { RunnerEvent } from "./runner-events.js";

/**
 * A user turn before any provider-specific rendering. `text` is already grounded
 * with the host-context block; attachments are raw and each provider decides how
 * to carry them (inline blocks, files on disk, …).
 */
export interface TurnInput {
  text: string;
  attachments: readonly AttachmentType[];
}

/** Everything a provider needs to open a session for one conversation. */
export interface ProviderSessionContext {
  conversationId: string;
  hostProjectRoot: string;
  /** Reads the host's displayed page live, for the session's initial prompt. */
  getCurrentPage: () => CurrentPage;
  /** Settings in force when the session is created. */
  settings: AppSettings;
  permissionBus?: PermissionBus;
  mcpServer?: AiMcpServer;
  /**
   * Invoked for every tool that actually went through a permission decision
   * (auto-allowed reads and first-party MCP tools never reach here).
   */
  onPermissionDecision?: (
    toolName: string,
    decision: PermissionDecision,
  ) => void;
  /**
   * Tokens one model call cost, as a delta the connection layer accumulates.
   * Providers that do not report usage never call it.
   */
  onTokenUsage?: (usage: TokenUsage) => void;
  /** Called when the session tears itself down, so the runner can drop it. */
  onDisposed: () => void;
}

/**
 * One live conversation on a provider. Settings travel with every turn, so a
 * provider that cannot change them in place stays correct without `applySettings`.
 */
export interface ProviderSession {
  runTurn(input: TurnInput, settings: AppSettings): AsyncIterable<RunnerEvent>;
  interrupt(): void;
  dispose(): void;
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
