import os from "node:os";
import type {
  AgentProvider,
  AgentProviderOptions,
  ProviderSession,
  ProviderSessionContext,
  TurnInput,
} from "../../agent/provider.js";
import { createAgentSession } from "../../agent/session.js";
import { TURN_IDLE_TIMEOUT_MS } from "../../constants/agent.js";
import {
  CODEX_CLIENT_NAME,
  CODEX_CLIENT_TITLE,
  CODEX_CLIENT_VERSION,
  CODEX_INITIALIZE_METHOD,
  CODEX_INITIALIZED_METHOD,
  CODEX_MAX_LIVE_SESSIONS,
  CODEX_MISSING_API_KEY_MESSAGE,
  CODEX_MISSING_CLI_MESSAGE,
  CODEX_SKILLS_CONFIG_WRITE_METHOD,
  CODEX_SKILLS_EXTRA_ROOTS_METHOD,
  CODEX_SKILLS_LIST_METHOD,
  CODEX_THREAD_START_METHOD,
  CODEX_TOKEN_USAGE_NOTIFICATION,
  CODEX_TURN_ABORTED_MESSAGE,
  CODEX_TURN_INTERRUPT_METHOD,
  CODEX_TURN_START_METHOD,
  CODEX_TURN_STARTED_NOTIFICATION,
  CODEX_VERSION_MISMATCH_MESSAGE,
} from "../../constants/codex.js";
import type { McpHttpRegistry } from "../../mcp/http-binding.js";
import type { AiMcpServerDeps } from "../../mcp/types.js";
import { resolveSkillSources } from "../../skills/resolve-sources.js";
import type { AppSettings } from "../../state/settings-types.js";
import { createCodexAdapter } from "./adapter.js";
import { buildCodexTurnInput } from "./attachments.js";
import type { CodexNotification } from "./client.js";
import {
  buildDeveloperInstructions,
  buildTurnOverrides,
  resolveModePolicy,
} from "./config.js";
import { createRunnerEventStream } from "./event-stream.js";
import { createCodexPermissionHandler } from "./permissions.js";
import { type CodexProcess, spawnCodexProcess } from "./process.js";
import type { v2 } from "./protocol/index.js";
import {
  isCodexInstallationUsable,
  resolveCodexInstallation,
} from "./resolve-binary.js";
import { buildSkillExtraRoots, selectSkillsToDisable } from "./skills.js";

/** Everything the Codex path needs from the sidecar's own runtime. */
export interface CodexRuntimeDeps {
  stateDir: string;
  mcpHttpRegistry: McpHttpRegistry;
  getMcpUrl: () => string;
  getApiKey: () => string | undefined;
}

export interface CodexProviderOptions
  extends AgentProviderOptions, CodexRuntimeDeps {
  createMcpDeps: (conversationId: string) => AiMcpServerDeps;
}

interface LiveSettings {
  settings: AppSettings;
}

interface CodexBackend {
  process: CodexProcess;
  threadId: string;
  turnId: string | null;
  live: LiveSettings;
  conversationId: string;
  hostProjectRoot: string;
  denials: () => number;
  resumeApprovals: () => void;
}

function clientInfo(): Record<string, unknown> {
  return {
    clientInfo: {
      name: CODEX_CLIENT_NAME,
      title: CODEX_CLIENT_TITLE,
      version: CODEX_CLIENT_VERSION,
    },
    capabilities: null,
  };
}

// Two passes, as the protocol requires: extra roots go in, the resulting index
// is read back, and everything that is not ours is switched off before the
// first turn.
async function configureSkills(
  process: CodexProcess,
  options: CodexProviderOptions,
  settings: AppSettings,
): Promise<void> {
  const sources = resolveSkillSources(
    options.skillDirs ?? [],
    settings.allowLocalSkills,
    os.homedir(),
  );
  const extraRoots = buildSkillExtraRoots(sources);
  if (extraRoots.length > 0) {
    await process.client.request(CODEX_SKILLS_EXTRA_ROOTS_METHOD, {
      extraRoots,
    });
  }
  const listed = await process.client.request<v2.SkillsListResponse>(
    CODEX_SKILLS_LIST_METHOD,
    {},
  );
  const disable = selectSkillsToDisable(listed.data, {
    extraRoots,
    allowLocalSkills: settings.allowLocalSkills,
  });
  for (const params of disable) {
    await process.client.request(CODEX_SKILLS_CONFIG_WRITE_METHOD, params);
  }
}

async function startThread(
  process: CodexProcess,
  ctx: ProviderSessionContext,
  denials: number,
): Promise<string> {
  const policy = resolveModePolicy(ctx.settings);
  const started = await process.client.request<v2.ThreadStartResponse>(
    CODEX_THREAD_START_METHOD,
    {
      cwd: ctx.hostProjectRoot,
      sandbox: policy.sandbox,
      approvalPolicy: policy.approvalPolicy,
      developerInstructions: buildDeveloperInstructions(ctx.settings, denials),
      // Nothing of this conversation is meant to outlive it on disk.
      ephemeral: true,
    },
  );
  return started.thread.id;
}

async function submitTurn(
  backend: CodexBackend,
  options: CodexProviderOptions,
  input: TurnInput,
): Promise<void> {
  // An interrupted turn left the approval handler refusing everything; a new
  // turn is a new mandate.
  backend.resumeApprovals();
  const overrides = buildTurnOverrides(backend.live.settings, {
    hostProjectRoot: backend.hostProjectRoot,
    moduleRoots: options.moduleRoots ?? [],
  });
  const payload = await buildCodexTurnInput(input.text, input.attachments, {
    hostProjectRoot: backend.hostProjectRoot,
    conversationId: backend.conversationId,
  });
  await backend.process.client.request(CODEX_TURN_START_METHOD, {
    threadId: backend.threadId,
    input: payload,
    ...overrides,
  });
}

function interruptTurn(backend: CodexBackend): void {
  // A request, not a notification: sent as a notification it is dropped and the
  // turn runs to completion. It also rejects a call without turnId, so the id
  // of the running turn is tracked from turn/started.
  if (backend.turnId === null) return;
  void backend.process.client
    .request(CODEX_TURN_INTERRUPT_METHOD, {
      threadId: backend.threadId,
      turnId: backend.turnId,
    })
    .catch(() => {
      // The turn may have finished on its own between the stop and this call.
    });
}

function trackTurnId(
  backendRef: { current: CodexBackend | null },
  notification: CodexNotification,
): void {
  if (notification.method !== CODEX_TURN_STARTED_NOTIFICATION) return;
  const params = notification.params as v2.TurnStartedNotification;
  if (backendRef.current === null) return;
  backendRef.current.turnId = params.turn.id;
}

// `last` rather than `total`: the connection layer accumulates, and the thread
// total would be counted again on every notification.
function reportTokenUsage(
  ctx: ProviderSessionContext,
  notification: CodexNotification,
): void {
  if (notification.method !== CODEX_TOKEN_USAGE_NOTIFICATION) return;
  if (ctx.onTokenUsage === undefined) return;
  const params = notification.params as v2.ThreadTokenUsageUpdatedNotification;
  const last = params.tokenUsage.last;
  ctx.onTokenUsage({
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    totalTokens: last.totalTokens,
  });
}

// Same idle window as the Claude path, and the same meaning: the turn is cut
// only after this long with no event at all, never as a cap on its duration.
function resolveTimeoutMs(options: CodexProviderOptions): number {
  return options.timeoutMs ?? TURN_IDLE_TIMEOUT_MS;
}

function assertUsableInstallation() {
  const installation = resolveCodexInstallation();
  if (installation === undefined) {
    throw new Error(CODEX_MISSING_CLI_MESSAGE);
  }
  if (!isCodexInstallationUsable(installation)) {
    throw new Error(CODEX_VERSION_MISMATCH_MESSAGE);
  }
  return installation;
}

async function createProviderSession(
  options: CodexProviderOptions,
  ctx: ProviderSessionContext,
  live: Map<string, ProviderSession>,
): Promise<ProviderSession> {
  const installation = assertUsableInstallation();
  const apiKey = options.getApiKey();
  if (apiKey === undefined) throw new Error(CODEX_MISSING_API_KEY_MESSAGE);

  const stream = createRunnerEventStream();
  const adapter = createCodexAdapter();
  const backendRef: { current: CodexBackend | null } = { current: null };
  const permissions = createCodexPermissionHandler({
    conversationId: ctx.conversationId,
    permissionBus: ctx.permissionBus,
    getSettings: () => backendRef.current?.live.settings ?? ctx.settings,
    getChangedPaths: (itemId) => adapter.getChangedPaths(itemId),
    onPermissionDecision: ctx.onPermissionDecision,
  });

  const mcpToken = await options.mcpHttpRegistry.register(
    options.createMcpDeps(ctx.conversationId),
  );
  const codexProcess = await spawnCodexProcess({
    conversationId: ctx.conversationId,
    stateDir: options.stateDir,
    installation,
    mcpUrl: options.getMcpUrl(),
    mcpToken,
    hostProjectRoot: ctx.hostProjectRoot,
    apiKey,
    handlers: {
      onNotification: (notification) => {
        trackTurnId(backendRef, notification);
        reportTokenUsage(ctx, notification);
        for (const event of adapter.handle(notification)) stream.push(event);
      },
      onServerRequest: (request) => permissions.handle(request),
    },
  });

  await codexProcess.client.request(CODEX_INITIALIZE_METHOD, clientInfo());
  codexProcess.client.notify(CODEX_INITIALIZED_METHOD, {});
  await configureSkills(codexProcess, options, ctx.settings);
  const threadId = await startThread(codexProcess, ctx, 0);

  const backend: CodexBackend = {
    process: codexProcess,
    threadId,
    turnId: null,
    live: { settings: ctx.settings },
    conversationId: ctx.conversationId,
    hostProjectRoot: ctx.hostProjectRoot,
    denials: () => permissions.consecutiveDenials(),
    resumeApprovals: () => permissions.resume(),
  };
  backendRef.current = backend;

  const abortController = new AbortController();
  // Nothing else listens to this signal on the Codex path: the app-server keeps
  // streaming regardless. Failing the event stream is what turns an abort — the
  // idle timeout, or the fallback behind an ignored interrupt — into a terminal
  // error instead of a turn that never ends.
  abortController.signal.addEventListener("abort", () => {
    stream.fail(new Error(CODEX_TURN_ABORTED_MESSAGE));
  });
  const session = createAgentSession({
    events: stream.iterator,
    controls: {
      submitTurn: (input) => submitTurn(backend, options, input),
      interrupt: () => {
        permissions.cancelPending();
        interruptTurn(backend);
      },
      close: () => {
        stream.end();
        void options.mcpHttpRegistry.release(ctx.conversationId);
        void codexProcess.dispose();
      },
    },
    abortController,
    onDisposed: () => {
      live.delete(ctx.conversationId);
      ctx.onDisposed();
    },
  });

  const providerSession: ProviderSession = {
    runTurn: (input, settings) => {
      backend.live.settings = settings;
      return session.sendTurn(input, resolveTimeoutMs(options));
    },
    interrupt: () => session.interrupt(),
    dispose: () => session.dispose(),
    applySettings: (settings) => {
      backend.live.settings = settings;
    },
  };
  return providerSession;
}

// Oldest-first eviction: each live conversation holds its own app-server process.
function evictOverflow(live: Map<string, ProviderSession>): void {
  while (live.size >= CODEX_MAX_LIVE_SESSIONS) {
    const oldest = live.keys().next();
    if (oldest.done === true) return;
    const session = live.get(oldest.value);
    live.delete(oldest.value);
    session?.dispose();
  }
}

export function createCodexProvider(
  options: CodexProviderOptions,
): AgentProvider {
  const live = new Map<string, ProviderSession>();
  return {
    createSession: async (ctx) => {
      evictOverflow(live);
      const session = await createProviderSession(options, ctx, live);
      live.set(ctx.conversationId, session);
      return session;
    },
  };
}
