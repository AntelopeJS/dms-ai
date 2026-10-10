import type { PermissionBus } from "../../agent/permission-bus.js";
import {
  CODEX_CHANGE_DIFF_ARG,
  CODEX_CHANGE_KIND_ARG,
} from "../../agent/permission-preview.js";
import type { ToolDecision } from "../../agent/provider.js";
import {
  CODEX_APPROVAL_DECISIONS,
  CODEX_COMMAND_APPROVAL_METHOD,
  CODEX_FILE_CHANGE_APPROVAL_METHOD,
  CODEX_LOG_PREFIX,
  CODEX_UNKNOWN_APPROVAL_METHOD,
} from "../../constants/codex.js";
import {
  BASH_COMMAND_ARG,
  EDIT_FILE_PATH_ARG,
  TOOL_LEXICON,
} from "../../constants/tool-lexicon.js";
import { EDIT_PATHS_KEY } from "../../agent/edit-targets.js";
import type { AppSettings } from "../../state/settings-types.js";
import type { CodexFileChange } from "./adapter.js";
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
  getChanges: (itemId: string) => CodexFileChange[];
  onToolDecision?: (decision: ToolDecision) => void;
  /** Awaited before an approved change runs (the turn's checkpoint). */
  beforeMutation?: () => Promise<void>;
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
  callId?: string;
}

interface CommandApprovalParams {
  command?: string | null;
  itemId?: string;
}

interface FileChangeApprovalParams {
  itemId?: string;
}

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
    const { command, itemId } = params as CommandApprovalParams;
    return {
      toolName: TOOL_LEXICON.BASH,
      args: { [BASH_COMMAND_ARG]: command ?? "" },
      callId: itemId,
    };
  }

  // The request itself carries no paths, only the item they belong to. The
  // first file's diff feeds the card; every path feeds the rule check, so a
  // rule for one file never approves a patch that also touches another.
  function describeFileChange(params: unknown): ApprovalSubject {
    const { itemId } = params as FileChangeApprovalParams;
    const changes = itemId === undefined ? [] : deps.getChanges(itemId);
    const [first] = changes;
    return {
      toolName: TOOL_LEXICON.EDIT,
      args: {
        [EDIT_FILE_PATH_ARG]: first?.path ?? "",
        [EDIT_PATHS_KEY]: changes.map((change) => change.path),
        [CODEX_CHANGE_KIND_ARG]: first?.kind ?? "",
        [CODEX_CHANGE_DIFF_ARG]: first?.diff ?? "",
      },
      callId: itemId,
    };
  }

  const SUBJECT_BY_METHOD: Record<
    string,
    (params: unknown) => ApprovalSubject
  > = {
    [CODEX_COMMAND_APPROVAL_METHOD]: describeCommand,
    [CODEX_FILE_CHANGE_APPROVAL_METHOD]: describeFileChange,
  };

  function countDenial(isAllowed: boolean): void {
    denials = isAllowed ? 0 : denials + 1;
  }

  async function ask(
    subject: ApprovalSubject,
  ): Promise<CodexApprovalDecisionResponse> {
    if (deps.permissionBus === undefined) return decline();
    const outcome = await deps.permissionBus.requestPermission({
      conversationId: deps.conversationId,
      toolName: subject.toolName,
      args: subject.args,
      callId: subject.callId,
    });
    countDenial(outcome.isAllowed);
    if (!outcome.isAllowed) return decline();
    await deps.beforeMutation?.();
    return accept();
  }

  // Safe and plan modes refuse without asking: the mode blocked the call.
  function block(subject: ApprovalSubject): CodexApprovalDecisionResponse {
    deps.onToolDecision?.({
      callId: subject.callId,
      toolName: subject.toolName,
      allowedBy: "blocked",
    });
    countDenial(false);
    return decline();
  }

  return {
    async handle(request) {
      const describe = SUBJECT_BY_METHOD[request.method];
      // Any other server request that expects a decision is refused rather
      // than blindly accepted. It is also said out loud: a decision method
      // added by a later Codex release would otherwise turn into a silent
      // refusal loop with nothing pointing at it.
      if (describe === undefined) {
        console.warn(
          `${CODEX_LOG_PREFIX} ${CODEX_UNKNOWN_APPROVAL_METHOD} ${request.method}`,
        );
        return decline();
      }
      if (cancelled) return decline();
      const subject = describe(request.params);
      // Safe and plan modes decline every escalation, evaluated here rather
      // than baked into the session, so the switch is immediate.
      if (resolveModePolicy(deps.getSettings()).autoDeclineEscalations) {
        return block(subject);
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
