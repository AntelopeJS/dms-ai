import { effectiveGenerationMode } from "../builder/capability.js";
import {
  HOST_CONTEXT_UNKNOWN_VALUE,
  RUNNER_CLOSED_MESSAGE,
} from "../constants/agent.js";
import { DEFAULT_SETTINGS } from "../constants/settings.js";
import type { AiMcpServer } from "../mcp/types.js";
import type { AttachmentType } from "../protocol/messages.js";
import type { CurrentPage } from "../state/host-state.js";
import type { AppSettings } from "../state/settings-types.js";
import type { TokenUsage } from "../state/types.js";
import { createDisposalTracker, type DisposalTracker } from "./disposals.js";
import { prependHostContext } from "./host-context.js";
import type { PermissionBus } from "./permission-bus.js";
import type {
  AgentProvider,
  ProviderSession,
  ToolCallHooks,
} from "./provider.js";
import type { RunnerError, RunnerEvent } from "./runner-events.js";

// What the agent is told about the page when the user removed the page chip:
// the mode line of the host context still matters, the page does not.
const WITHOUT_PAGE: CurrentPage = { path: HOST_CONTEXT_UNKNOWN_VALUE };

export interface RunnerContext extends ToolCallHooks {
  conversationId: string;
  hostProjectRoot: string;
  // Reads the host's displayed page live. Called at turn start to build the
  // per-turn host-context block, and at session creation for the initial prompt.
  getCurrentPage: () => CurrentPage;
  // Files the user attached to this turn. How they are carried to the agent is
  // the provider's business.
  attachments?: AttachmentType[];
  // False when the user removed the page chip from the composer.
  includePageContext?: boolean;
  permissionBus?: PermissionBus;
  // Built lazily: the server is consumed once, when the session opens, never
  // per turn. A provider that registers an HTTP endpoint would otherwise mint a
  // fresh binding on every turn.
  createMcpServer?: () => AiMcpServer;
  // Tokens one model call cost, so the connection layer can keep a running
  // total per conversation.
  onTokenUsage?: (usage: TokenUsage) => void;
}

export interface AgentRunner {
  start(message: string, ctx: RunnerContext): AsyncIterable<RunnerEvent>;
  interruptSession(conversationId: string): void;
  /** Resolves once the conversation's backend has released everything. */
  disposeSession(conversationId: string): Promise<void>;
  /**
   * Live sessions keep their context across a settings change: the new settings
   * reach every open session, and every subsequent turn carries them.
   */
  applySettings(settings: AppSettings): void;
  /**
   * Re-reads one conversation's settings (its mode or scope changed) and hands
   * them to its live session, if any.
   */
  refreshSession(conversationId: string): void;
  /**
   * Disposes every session, ending a running turn with `reason` when given, and
   * resolves once every backend has released everything and every running turn
   * has ended: the sessions that already tore themselves down, and those still
   * opening, included. The runner opens no session afterwards.
   */
  dispose(reason?: RunnerError): Promise<void>;
}

/** A conversation's settings: the global ones with its own mode and scope. */
export type ConversationSettingsResolver = (
  conversationId: string,
  settings: AppSettings,
) => AppSettings;

export interface AgentRunnerOptions {
  settings?: AppSettings;
  resolveSettings?: ConversationSettingsResolver;
}

interface SessionManager {
  provider: AgentProvider;
  sessions: Map<string, ProviderSession>;
  settings: AppSettings;
  resolveSettings: ConversationSettingsResolver;
  disposals: DisposalTracker;
  isClosed: boolean;
}

function settingsOf(manager: SessionManager, conversationId: string) {
  return manager.resolveSettings(conversationId, manager.settings);
}

function keepGlobalSettings(
  _conversationId: string,
  settings: AppSettings,
): AppSettings {
  return settings;
}

function createSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ProviderSession> {
  return manager.provider.createSession({
    conversationId: ctx.conversationId,
    hostProjectRoot: ctx.hostProjectRoot,
    getCurrentPage: ctx.getCurrentPage,
    settings: settingsOf(manager, ctx.conversationId),
    permissionBus: ctx.permissionBus,
    mcpServer: ctx.createMcpServer?.(),
    onToolDecision: ctx.onToolDecision,
    onToolAnnounced: ctx.onToolAnnounced,
    beforeMutation: ctx.beforeMutation,
    onTokenUsage: ctx.onTokenUsage,
    onDisposed: (disposal) => {
      manager.sessions.delete(ctx.conversationId);
      manager.disposals.track(disposal);
    },
  });
}

function ignoreOutcome(): void {}

async function openSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ProviderSession> {
  const session = await createSession(manager, ctx);
  if (manager.isClosed) {
    await session.dispose();
    throw new Error(RUNNER_CLOSED_MESSAGE);
  }
  manager.sessions.set(ctx.conversationId, session);
  return session;
}

function getOrCreateSession(
  manager: SessionManager,
  ctx: RunnerContext,
): Promise<ProviderSession> {
  const existing = manager.sessions.get(ctx.conversationId);
  if (existing !== undefined) return Promise.resolve(existing);
  if (manager.isClosed) return Promise.reject(new Error(RUNNER_CLOSED_MESSAGE));
  const opening = openSession(manager, ctx);
  manager.disposals.track(opening.then(ignoreOutcome, ignoreOutcome));
  return opening;
}

async function* startTurn(
  manager: SessionManager,
  message: string,
  ctx: RunnerContext,
): AsyncIterable<RunnerEvent> {
  const session = await getOrCreateSession(manager, ctx);
  const settings = settingsOf(manager, ctx.conversationId);
  const grounded = prependHostContext(
    message,
    ctx.includePageContext === false ? WITHOUT_PAGE : ctx.getCurrentPage(),
    effectiveGenerationMode(settings.generationMode),
  );
  yield* session.runTurn(
    { text: grounded, attachments: ctx.attachments ?? [] },
    settings,
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

function disposeSession(
  manager: SessionManager,
  conversationId: string,
): Promise<void> {
  const session = manager.sessions.get(conversationId);
  if (session === undefined) return Promise.resolve();
  manager.sessions.delete(conversationId);
  const disposal = session.dispose();
  manager.disposals.track(disposal);
  return disposal;
}

async function disposeAll(
  manager: SessionManager,
  reason?: RunnerError,
): Promise<void> {
  manager.isClosed = true;
  const sessions = [...manager.sessions.values()];
  manager.sessions.clear();
  for (const session of sessions) {
    manager.disposals.track(session.dispose(reason));
  }
  await manager.disposals.settle();
}

function applySettings(manager: SessionManager, settings: AppSettings): void {
  manager.settings = settings;
  for (const [conversationId, session] of manager.sessions) {
    session.applySettings?.(settingsOf(manager, conversationId));
  }
}

function refreshSession(manager: SessionManager, conversationId: string) {
  manager.sessions
    .get(conversationId)
    ?.applySettings?.(settingsOf(manager, conversationId));
}

export function createAgentRunner(
  provider: AgentProvider,
  options?: AgentRunnerOptions,
): AgentRunner {
  const manager: SessionManager = {
    provider,
    sessions: new Map(),
    settings: options?.settings ?? DEFAULT_SETTINGS,
    resolveSettings: options?.resolveSettings ?? keepGlobalSettings,
    disposals: createDisposalTracker(),
    isClosed: false,
  };
  return {
    start: (message, ctx) => startTurn(manager, message, ctx),
    interruptSession: (conversationId) =>
      interruptSession(manager, conversationId),
    disposeSession: (conversationId) => disposeSession(manager, conversationId),
    applySettings: (settings) => applySettings(manager, settings),
    refreshSession: (conversationId) => refreshSession(manager, conversationId),
    dispose: (reason) => disposeAll(manager, reason),
  };
}
