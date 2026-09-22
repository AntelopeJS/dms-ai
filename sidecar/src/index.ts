#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilderClient } from "./builder/builder-client.js";
import { setBuilderAvailable } from "./builder/capability.js";
import { SIDECAR_BUILDER_FLAG } from "./constants/builder.js";
import {
  GRACEFUL_EXIT_CODE,
  IDLE_SHUTDOWN_MS,
  SIDECAR_BUILD_ID_FLAG,
  SIDECAR_TOKEN_BYTES,
} from "./constants/daemon.js";
import {
  PRODUCTION_GUARD_EXIT_CODE,
  PRODUCTION_GUARD_MESSAGE,
  PRODUCTION_NODE_ENV,
} from "./constants/env.js";
import { DEFAULT_BACKEND_BASE_URL } from "./constants/pages.js";
import { MCP_HTTP_PORT_TOKEN, MCP_HTTP_URL_TEMPLATE } from "./constants/mcp.js";
import { CHATBOX_DIST_DIR, STATE_DIR_SEGMENTS } from "./constants/paths.js";
import { DEFAULT_HOST_ORIGIN, RANDOM_PORT } from "./constants/ports.js";
import { SETTINGS_FILE_NAME } from "./constants/settings.js";
import { SKILL_NAME_COLLISION_WARNING } from "./constants/skills.js";
import { STATE_FILE_NAME } from "./constants/state.js";
import { createLogsClient } from "./logs/logs-client.js";
import type { McpHttpRegistry } from "./mcp/http-binding.js";
import { createMcpHttpRegistry } from "./mcp/http-binding.js";
import { createImportsScanner } from "./pages/imports-scanner.js";
import { createRegistryClient } from "./pages/registry-client.js";
import { reapOrphanProviders } from "./providers/registry.js";
import { createHostSocketRegistry } from "./server/host-socket-registry.js";
import { createHttpServer, type SettingsApplier } from "./server/http.js";
import {
  createIdleShutdownController,
  type IdleShutdownController,
} from "./server/idle-shutdown.js";
import { createNavigationCompleter } from "./server/navigation-completer.js";
import { attachWsServer } from "./server/ws.js";
import { buildSkillCatalog } from "./skills/build-catalog.js";
import { resolveSkillSources } from "./skills/resolve-sources.js";
import type { SkillSource } from "./skills/types.js";
import {
  type ConversationStore,
  createConversationStore,
} from "./state/conversations.js";
import { createHostState } from "./state/host-state.js";
import { removeLock, writeLock } from "./state/lock.js";
import {
  createSettingsStore,
  type SettingsStore,
} from "./state/settings-store.js";
import { readSidecarVersion } from "./state/sidecar-version.js";
import { createStore } from "./state/store.js";

function enforceProductionGuard(): void {
  if (process.env.NODE_ENV !== PRODUCTION_NODE_ENV) return;
  console.error(PRODUCTION_GUARD_MESSAGE);
  process.exit(PRODUCTION_GUARD_EXIT_CODE);
}

enforceProductionGuard();

interface ParsedArgs {
  port: number;
  root: string;
  hostOrigin: string;
  backendUrl: string;
  buildId: string;
  moduleRoots: string[];
  skillDirs: SkillSource[];
  builderEnabled: boolean;
}

type ArgParser = (value: string, acc: ParsedArgs) => void;

// The parent passes the on-disk roots of every loaded module (from
// interface-core) as a JSON array; malformed input degrades to no extra roots.
function parseModuleRoots(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

// The parent passes a JSON array of `{ module, dir }` skill sources (one per
// directory declared in a loaded module's `antelopeJs.skills`, so a module may
// contribute several entries); malformed entries are dropped and invalid JSON
// degrades to no skill sources.
export function parseSkillDirs(value: string): SkillSource[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is SkillSource =>
        e !== null &&
        typeof e === "object" &&
        typeof (e as SkillSource).module === "string" &&
        typeof (e as SkillSource).dir === "string",
    );
  } catch {
    return [];
  }
}

const ARG_PARSERS: Record<string, ArgParser> = {
  "--module-roots": (v, a) => {
    a.moduleRoots = parseModuleRoots(v);
  },
  "--skill-dirs": (v, a) => {
    a.skillDirs = parseSkillDirs(v);
  },
  "--port": (v, a) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      throw new Error(`Invalid --port value: ${v}`);
    }
    a.port = n;
  },
  "--root": (v, a) => {
    a.root = v;
  },
  "--host-origin": (v, a) => {
    a.hostOrigin = v;
  },
  "--backend-url": (v, a) => {
    a.backendUrl = v;
  },
  [SIDECAR_BUILD_ID_FLAG]: (v, a) => {
    a.buildId = v;
  },
  [SIDECAR_BUILDER_FLAG]: (v, a) => {
    a.builderEnabled = v === "1";
  },
};

function buildDefaults(): ParsedArgs {
  return {
    port: RANDOM_PORT,
    root: process.cwd(),
    hostOrigin: DEFAULT_HOST_ORIGIN,
    backendUrl: DEFAULT_BACKEND_BASE_URL,
    buildId: "",
    moduleRoots: [],
    skillDirs: [],
    builderEnabled: false,
  };
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const acc = buildDefaults();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === undefined) continue;
    const parser = ARG_PARSERS[flag];
    if (parser === undefined) {
      console.error(`[dms-ai] unknown arg: ${flag}`);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) {
      throw new Error(`[dms-ai] missing value for: ${flag}`);
    }
    parser(next, acc);
    i++;
  }
  return acc;
}

const SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

interface ShutdownDeps {
  server: import("node:http").Server;
  ws: { close: () => Promise<void> };
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  root: string;
}

interface ShutdownGuard {
  done: boolean;
}

interface ShutdownHolder {
  run: () => void;
}

async function gracefulShutdown(
  deps: ShutdownDeps,
  guard: ShutdownGuard,
): Promise<void> {
  if (guard.done) return;
  guard.done = true;
  await deps.ws.close().catch(() => undefined);
  await deps.conversationStore.flush().catch(() => undefined);
  await deps.settingsStore.flush().catch(() => undefined);
  await removeLock(deps.root);
  deps.server.close(() => process.exit(GRACEFUL_EXIT_CODE));
}

function installSignalShutdown(run: () => void): void {
  for (const sig of SHUTDOWN_SIGNALS) {
    process.on(sig, run);
  }
}

function stateDirFor(root: string): string {
  return path.join(root, ...STATE_DIR_SEGMENTS);
}

function buildStateFilePath(root: string): string {
  return path.join(stateDirFor(root), STATE_FILE_NAME);
}

function buildSettingsFilePath(root: string): string {
  return path.join(stateDirFor(root), SETTINGS_FILE_NAME);
}

async function buildConversationStore(
  root: string,
): Promise<ConversationStore> {
  const filePath = buildStateFilePath(root);
  const store = createStore({ filePath });
  const conversationStore = createConversationStore({ store });
  await conversationStore.loadFromDisk();
  return conversationStore;
}

async function buildSettingsStore(root: string): Promise<SettingsStore> {
  const settingsStore = createSettingsStore({
    filePath: buildSettingsFilePath(root),
  });
  await settingsStore.load();
  return settingsStore;
}

function logStartup(args: ParsedArgs, port: number): void {
  console.log(`DMS_AI_SIDECAR_PORT=${port}`);
  console.log(`DMS_AI_SIDECAR_ROOT=${args.root}`);
  console.log(`DMS_AI_SIDECAR_HOST_ORIGIN=${args.hostOrigin}`);
  console.log(`DMS_AI_SIDECAR_BACKEND_URL=${args.backendUrl}`);
}

/** Everything the WebSocket stack is wired from. */
interface WsStackDeps {
  args: ParsedArgs;
  server: import("node:http").Server;
  conversationStore: ConversationStore;
  settingsStore: SettingsStore;
  idleController: IdleShutdownController;
  settingsApplier: SettingsApplier;
  backendToken: string;
  clientToken: string;
  mcpHttpRegistry: McpHttpRegistry;
  port: number;
}

function buildWsStack({
  args,
  server,
  conversationStore,
  settingsStore,
  idleController,
  settingsApplier,
  backendToken,
  clientToken,
  mcpHttpRegistry,
  port,
}: WsStackDeps): { close: () => Promise<void> } {
  const hostState = createHostState();
  const registry = createRegistryClient({
    backendBaseUrl: args.backendUrl,
    token: backendToken,
  });
  const logsClient = createLogsClient({
    backendBaseUrl: args.backendUrl,
    token: backendToken,
  });
  const builderClient = createBuilderClient({
    backendBaseUrl: args.backendUrl,
    token: backendToken,
  });
  const scanner = createImportsScanner();
  const hostSocketRegistry = createHostSocketRegistry();
  const navigationCompleter = createNavigationCompleter();
  return attachWsServer(server, {
    clientToken,
    hostProjectRoot: args.root,
    moduleRoots: args.moduleRoots,
    skillDirs: args.skillDirs,
    conversationStore,
    settingsStore,
    // Static MCP deps; the per-conversation server (and its conversation-bound
    // AskUser tool) is built inside attachWsServer.
    mcpDeps: {
      getCurrentPage: () => hostState.getCurrentPage(),
      registry,
      scanner,
      hostProjectRoot: args.root,
      moduleRoots: args.moduleRoots,
      logsClient,
      builderClient,
      builderEnabled: args.builderEnabled,
      sendToHost: hostSocketRegistry.send,
      navigationCompleter,
    },
    hostState,
    hostSocketRegistry,
    navigationCompleter,
    idleController,
    settingsApplier,
    providerRuntime: {
      stateDir: stateDirFor(args.root),
      mcpHttpRegistry,
      getMcpUrl: () =>
        MCP_HTTP_URL_TEMPLATE.replace(MCP_HTTP_PORT_TOKEN, String(port)),
    },
  });
}

async function warnOnDuplicateSkillNames(
  sources: SkillSource[],
): Promise<void> {
  const { duplicateNames } = await buildSkillCatalog(sources);
  if (duplicateNames.length === 0) return;
  console.warn(`${SKILL_NAME_COLLISION_WARNING} ${duplicateNames.join(", ")}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  setBuilderAvailable(args.builderEnabled);
  const conversationStore = await buildConversationStore(args.root);
  const settingsStore = await buildSettingsStore(args.root);
  // Default applier just persists; buildWsStack rebinds it to also apply the
  // change to the live runner/permission bus and broadcast to open chatboxes.
  const settingsApplier: SettingsApplier = {
    apply: (next) => settingsStore.set(next),
  };
  const backendToken = randomBytes(SIDECAR_TOKEN_BYTES).toString("hex");
  const clientToken = randomBytes(SIDECAR_TOKEN_BYTES).toString("hex");
  const holder: ShutdownHolder = { run: () => {} };
  const idleController = createIdleShutdownController({
    idleMs: IDLE_SHUTDOWN_MS,
    onIdle: () => holder.run(),
  });
  await warnOnDuplicateSkillNames(
    resolveSkillSources(
      args.skillDirs,
      settingsStore.get().allowLocalSkills,
      os.homedir(),
    ),
  );
  // A sidecar killed outright can leave backend children holding a model
  // connection and writing to disk; each provider clears its own before
  // anything new starts.
  await reapOrphanProviders(stateDirFor(args.root));
  const mcpHttpRegistry = createMcpHttpRegistry();
  const { server, port } = await createHttpServer({
    clientToken,
    mcpHttpRegistry,
    chatboxDistDir: CHATBOX_DIST_DIR,
    port: args.port,
    buildId: args.buildId,
    onHealthCheck: idleController.touch,
    conversationStore,
    settingsStore,
    settingsApplier,
    // Recompute per request so the live `allowLocalSkills` toggle is honored
    // without restarting the sidecar.
    getSkillSources: () =>
      resolveSkillSources(
        args.skillDirs,
        settingsStore.get().allowLocalSkills,
        os.homedir(),
      ),
  });
  const ws = buildWsStack({
    args,
    server,
    conversationStore,
    settingsStore,
    idleController,
    settingsApplier,
    backendToken,
    clientToken,
    mcpHttpRegistry,
    port,
  });
  const guard: ShutdownGuard = { done: false };
  const deps: ShutdownDeps = {
    server,
    ws,
    conversationStore,
    settingsStore,
    root: args.root,
  };
  holder.run = () => void gracefulShutdown(deps, guard);
  installSignalShutdown(holder.run);
  const version = await readSidecarVersion();
  await writeLock(args.root, {
    port,
    pid: process.pid,
    version,
    buildId: args.buildId,
    startedAt: Date.now(),
    token: backendToken,
    clientToken,
  });
  logStartup(args, port);
}

// Only boot when invoked as the real entry point (the spawned bin), so the
// module's pure exports (parseSkillDirs, …) can be imported by tests without
// starting a server.
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
