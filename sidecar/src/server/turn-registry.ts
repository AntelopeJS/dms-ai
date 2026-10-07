import type { TypecheckOutcome } from "../constants/audit.js";
import type { TurnCheckpoint } from "../checkpoints/checkpoints.js";
import { EMPTY_TOKEN_USAGE, type TokenUsage } from "../state/types.js";

/** A tool call of the running turn that has not ended yet. */
export interface OpenCall {
  toolName: string;
  startedAtMs: number;
}

/** What the sidecar tracks about one running turn. */
export interface ActiveTurn {
  conversationId: string;
  // The user's request, shortened into the change set title.
  request: string;
  isAutoFix: boolean;
  askedBy?: string;
  pagePath?: string;
  checkpoint: TurnCheckpoint;
  openCalls: Map<string, OpenCall>;
  // Calls that may have changed files, stamped with the change set at the end.
  mutatingCallIds: string[];
  approvalsNeeded: number;
  builderOps: number;
  typecheck: TypecheckOutcome;
  usage: TokenUsage;
}

export interface BeginTurnOptions {
  conversationId: string;
  request: string;
  isAutoFix: boolean;
  askedBy?: string;
  pagePath?: string;
  checkpoint: TurnCheckpoint;
}

/** The running turn of each conversation, and the auto-fix stop switches. */
export interface TurnRegistry {
  begin(options: BeginTurnOptions): ActiveTurn;
  get(conversationId: string): ActiveTurn | undefined;
  end(conversationId: string): void;
  isRunning(conversationId: string): boolean;
  runningCount(): number;
  runningIds(): string[];
  /** stop_autofix: the remaining auto-fix attempts of the chat are skipped. */
  stopAutoFix(conversationId: string): void;
  isAutoFixStopped(conversationId: string): boolean;
  resetAutoFix(conversationId: string): void;
  lastError(): string | undefined;
  recordError(message: string): void;
}

export function createTurnRegistry(): TurnRegistry {
  const turns = new Map<string, ActiveTurn>();
  const autoFixStopped = new Set<string>();
  let lastError: string | undefined;
  return {
    begin(options) {
      const turn: ActiveTurn = {
        ...options,
        openCalls: new Map(),
        mutatingCallIds: [],
        approvalsNeeded: 0,
        builderOps: 0,
        typecheck: "skipped",
        usage: EMPTY_TOKEN_USAGE,
      };
      turns.set(options.conversationId, turn);
      return turn;
    },
    get: (conversationId) => turns.get(conversationId),
    end: (conversationId) => {
      turns.delete(conversationId);
    },
    isRunning: (conversationId) => turns.has(conversationId),
    runningCount: () => turns.size,
    runningIds: () => [...turns.keys()],
    stopAutoFix: (conversationId) => {
      autoFixStopped.add(conversationId);
    },
    isAutoFixStopped: (conversationId) => autoFixStopped.has(conversationId),
    resetAutoFix: (conversationId) => {
      autoFixStopped.delete(conversationId);
    },
    lastError: () => lastError,
    recordError: (message) => {
      lastError = message;
    },
  };
}
