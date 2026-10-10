import type { CallAudit } from "../audit/call-audit.js";
import type { CallLedger } from "../agent/call-ledger.js";
import type { ConversationModes } from "../agent/conversation-modes.js";
import type { EditTracker } from "../agent/edit-tracker.js";
import type { PermissionBus } from "../agent/permission-bus.js";
import type { QuestionBus } from "../agent/question-bus.js";
import type { AgentRunner } from "../agent/runner.js";
import type { Checkpoints } from "../checkpoints/checkpoints.js";
import type { LogsClient } from "../logs/logs-client.js";
import type { AiMcpServer } from "../mcp/types.js";
import type { ConversationStore } from "../state/conversations.js";
import type { HostState } from "../state/host-state.js";
import type { SettingsStore } from "../state/settings-store.js";
import type { ChatSocketRegistry } from "./chat-socket-registry.js";
import type { HostSocketRegistry } from "./host-socket-registry.js";
import type { IdleShutdownController } from "./idle-shutdown.js";
import type { LiveTurnStore } from "./live-turns.js";
import type { NavigationCompleter } from "./navigation-completer.js";
import type { PendingQueueStore } from "./pending-queue.js";
import type { TurnRegistry } from "./turn-registry.js";

/** Who drives a connection, as the backend bridge announced it. */
export interface Actor {
  userId: string;
  name: string;
}

/** Everything the sidecar shares across connections. */
export interface SidecarServices {
  hostProjectRoot: string;
  runner: AgentRunner;
  conversationStore: ConversationStore;
  permissionBus: PermissionBus;
  questionBus: QuestionBus;
  createMcpServer: (conversationId: string) => AiMcpServer;
  editTracker: EditTracker;
  logsClient: LogsClient;
  moduleRoots: string[];
  hostState: HostState;
  hostSocketRegistry: HostSocketRegistry;
  chatSocketRegistry: ChatSocketRegistry;
  navigationCompleter: NavigationCompleter;
  liveTurns: LiveTurnStore;
  pendingQueue: PendingQueueStore;
  settingsStore: SettingsStore;
  conversationModes: ConversationModes;
  checkpoints: Checkpoints;
  callAudit: CallAudit;
  callLedger: CallLedger;
  turns: TurnRegistry;
  // Who asked for each conversation's latest request (from the actor frame).
  askers: Map<string, string>;
}

export interface RoutingConfig extends SidecarServices {
  idleController: IdleShutdownController;
}

/** One socket's view: the shared services plus who drives it. */
export interface ConnectionContext extends SidecarServices {
  actor: Actor | null;
}
