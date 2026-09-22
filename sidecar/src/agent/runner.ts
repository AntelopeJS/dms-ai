import { effectiveGenerationMode } from "../builder/capability.js";
import type { PermissionDecision } from "../constants/permissions.js";
import { DEFAULT_SETTINGS } from "../constants/settings.js";
import type { AiMcpServer } from "../mcp/types.js";
import type { AttachmentType } from "../protocol/messages.js";
import type { CurrentPage } from "../state/host-state.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TokenUsage } from "../state/types.js";
import { prependHostContext } from "./host-context.js";
import type { PermissionBus } from "./permission-bus.js";
import type { AgentProvider, ProviderSession } from "./provider.js";
import type { RunnerEvent } from "./runner-events.js";

export interface RunnerContext {
  conversationId: string;
  hostProjectRoot: string;
  // Reads the host's displayed page live. Called at turn start to build the
  // per-turn host-context block, and at session creation for the initial prompt.
  getCurrentPage: () => CurrentPage;
  // Files the user attached to this turn. How they are carried to the agent is
  // the provider's business.
  attachments?: AttachmentType[];
  permissionBus?: PermissionBus;
  // Built lazily: the server is consumed once, when the session opens, never
  // per turn. A provider that registers an HTTP endpoint would otherwise mint a
  // fresh binding on every turn.
  createMcpServer?: () => AiMcpServer;
  // Invoked for every tool that actually went through a permission decision
  // (auto-allowed reads/first-party MCP never reach here). Lets the connection
  // layer persist the approve/deny outcome for the activity metrics.
  onPermissionDecision?: (
    toolName: string,
    decision: PermissionDecision,
  ) => void;
  // Tokens one model call cost, so the connection layer can keep a running
  // total per conversation.
  onTokenUsage?: (usage: TokenUsage) => void;
}

export interface AgentRunner {
  start(message: string, ctx: RunnerContext): AsyncIterable<RunnerEvent>;
  interruptSession(conversationId: string): void;
  disposeSession(conversationId: string): void;
  /**
   * Live sessions keep their context across a settings change: the new settings
   * reach every open session, and every subsequent turn carries them.
   */
  applySettings(settings: AppSettings): void;
  dispose(): void;
}

export interface AgentRunnerOptions {
  settings?: AppSettings;
}

interface SessionManager {
  provider: AgentProvider;
  sessions: Map<string, ProviderSession>;
  settings: AppSettings;
}

function createSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ProviderSession> {
  return manager.provider.createSession({
    conversationId: ctx.conversationId,
    hostProjectRoot: ctx.hostProjectRoot,
    getCurrentPage: ctx.getCurrentPage,
    settings: manager.settings,
    permissionBus: ctx.permissionBus,
    mcpServer: ctx.createMcpServer?.(),
    onPermissionDecision: ctx.onPermissionDecision,
    onTokenUsage: ctx.onTokenUsage,
    onDisposed: () => {
      manager.sessions.delete(ctx.conversationId);
    },
  });
}

async function getOrCreateSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ProviderSession> {
  const existing = manager.sessions.get(ctx.conversationId);
  if (existing !== undefined) return existing;
  const session = await createSession(manager, ctx);
  manager.sessions.set(ctx.conversationId, session);
  return session;
}

async function* startTurn(
  manager: SessionManager,
  message: string,
  ctx: RunnerContext,
): AsyncIterable<RunnerEvent> {
  const session = await getOrCreateSession(manager, ctx);
  const grounded = prependHostContext(
    message,
    ctx.getCurrentPage(),
    effectiveGenerationMode(manager.settings.generationMode),
  );
  yield* session.runTurn(
    { text: grounded, attachments: ctx.attachments ?? [] },
    manager.settings,
  );
}

function interruptSession(
  manager: SessionManager,
  conversationId: string,
): void {
  const session = manager.sessions.get(conversationId);
  if (session === undefined) return;
  session.interrupt();
}

function disposeSession(manager: SessionManager, conversationId: string): void {
  const session = manager.sessions.get(conversationId);
  if (session === undefined) return;
  manager.sessions.delete(conversationId);
  session.dispose();
}

function disposeAll(manager: SessionManager): void {
  const sessions = [...manager.sessions.values()];
  manager.sessions.clear();
  for (const session of sessions) session.dispose();
}

function applySettings(manager: SessionManager, settings: AppSettings): void {
  manager.settings = settings;
  for (const session of manager.sessions.values()) {
    session.applySettings?.(settings);
  }
}

export function createAgentRunner(
  provider: AgentProvider,
  options?: AgentRunnerOptions,
): AgentRunner {
  const manager: SessionManager = {
    provider,
    sessions: new Map(),
    settings: options?.settings ?? DEFAULT_SETTINGS,
  };
  return {
    start: (message, ctx) => startTurn(manager, message, ctx),
    interruptSession: (conversationId) =>
      interruptSession(manager, conversationId),
    disposeSession: (conversationId) => disposeSession(manager, conversationId),
    applySettings: (settings) => applySettings(manager, settings),
    dispose: () => disposeAll(manager),
  };
}
