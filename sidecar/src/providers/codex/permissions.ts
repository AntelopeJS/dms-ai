import type { PermissionBus } from "../../agent/permission-bus.js";
import {
  CODEX_APPROVAL_DECISIONS,
  CODEX_COMMAND_APPROVAL_METHOD,
  CODEX_FILE_CHANGE_APPROVAL_METHOD,
} from "../../constants/codex.js";
import {
  PERMISSION_DECISIONS,
  type PermissionDecision,
} from "../../constants/permissions.js";
import {
  BASH_COMMAND_ARG,
  EDIT_FILE_PATH_ARG,
  TOOL_LEXICON,
} from "../../constants/tool-lexicon.js";
import type { AppSettings } from "../../state/settings-types.js";
import type { CodexServerRequest } from "./client.js";
import { resolveModePolicy } from "./config.js";

export interface CodexApprovalDecisionResponse {
  decision: string;
}

export interface CodexPermissionDeps {
  conversationId: string;
  permissionBus?: PermissionBus;
  /** Read live, so a safe/vibe flip takes effect without a new session. */
  getSettings: () => AppSettings;
  getChangedPaths: (itemId: string) => string[];
  onPermissionDecision?: (
    toolName: string,
    decision: PermissionDecision,
  ) => void;
}

export interface CodexPermissionHandler {
  handle(request: CodexServerRequest): Promise<CodexApprovalDecisionResponse>;
  /** Declines everything still pending, used when a turn is interrupted. */
  cancelPending(): void;
  /** Lifts that refusal for the next turn, which the user is entitled to. */
  resume(): void;
  consecutiveDenials(): number;
}

interface ApprovalSubject {
  toolName: string;
  args: Record<string, unknown>;
}

interface CommandApprovalParams {
  command?: string | null;
  itemId?: string;
}

interface FileChangeApprovalParams {
  itemId?: string;
}

const ACCEPTING_DECISIONS: PermissionDecision[] = [
  PERMISSION_DECISIONS.ALLOW_ONCE,
  PERMISSION_DECISIONS.ALLOW_SESSION,
];

function accept(): CodexApprovalDecisionResponse {
  return { decision: CODEX_APPROVAL_DECISIONS.ACCEPT };
}

function decline(): CodexApprovalDecisionResponse {
  return { decision: CODEX_APPROVAL_DECISIONS.DECLINE };
}

export function createCodexPermissionHandler(
  deps: CodexPermissionDeps,
): CodexPermissionHandler {
  let denials = 0;
  let cancelled = false;

  function describeCommand(params: unknown): ApprovalSubject {
    const { command } = params as CommandApprovalParams;
    return {
      toolName: TOOL_LEXICON.BASH,
      args: { [BASH_COMMAND_ARG]: command ?? "" },
    };
  }

  // The request itself carries no paths, only the item they belong to.
  function describeFileChange(params: unknown): ApprovalSubject {
    const { itemId } = params as FileChangeApprovalParams;
    const paths = itemId === undefined ? [] : deps.getChangedPaths(itemId);
    return {
      toolName: TOOL_LEXICON.EDIT,
      args: { [EDIT_FILE_PATH_ARG]: paths[0] ?? "" },
    };
  }

  const SUBJECT_BY_METHOD: Record<
    string,
    (params: unknown) => ApprovalSubject
  > = {
    [CODEX_COMMAND_APPROVAL_METHOD]: describeCommand,
    [CODEX_FILE_CHANGE_APPROVAL_METHOD]: describeFileChange,
  };

  function record(
    subject: ApprovalSubject,
    decision: PermissionDecision,
  ): void {
    deps.onPermissionDecision?.(subject.toolName, decision);
    denials = decision === PERMISSION_DECISIONS.DENY ? denials + 1 : 0;
  }

  async function ask(
    subject: ApprovalSubject,
  ): Promise<CodexApprovalDecisionResponse> {
    if (deps.permissionBus === undefined) return decline();
    const decision = await deps.permissionBus.requestPermission({
      conversationId: deps.conversationId,
      toolName: subject.toolName,
      args: subject.args,
    });
    record(subject, decision);
    return ACCEPTING_DECISIONS.includes(decision) ? accept() : decline();
  }

  return {
    async handle(request) {
      const describe = SUBJECT_BY_METHOD[request.method];
      // Any other server request that expects a decision is refused rather
      // than blindly accepted.
      if (describe === undefined) return decline();
      if (cancelled) return decline();
      const subject = describe(request.params);
      // Safe and plan modes decline every escalation, evaluated here rather
      // than baked into the session, so the switch is immediate.
      if (resolveModePolicy(deps.getSettings()).autoDeclineEscalations) {
        record(subject, PERMISSION_DECISIONS.DENY);
        return decline();
      }
      return ask(subject);
    },
    cancelPending: () => {
      cancelled = true;
    },
    resume: () => {
      cancelled = false;
    },
    consecutiveDenials: () => denials,
  };
}
