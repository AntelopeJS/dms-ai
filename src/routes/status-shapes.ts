import type {
  BannerAction,
  BannerContent,
  KeyValueListItem,
} from "@antelopejs/interface-dms/base";
import type { BlockText, Tone } from "@antelopejs/interface-dms/base/types";
import { I18N_SECTIONS } from "../constants/i18n";
import { PAGE_LINKS, PAGE_ROUTES } from "../constants/pages";
import type { AssistantStatus } from "../types";
import { i18nKey } from "../vocabulary";

/** The status `/ai/status` reports when the sidecar does not answer. */
export const OFFLINE_STATUS = "offline";

const SIDECAR_HOST = "localhost";
const STATE_TONES: Readonly<Record<string, Tone>> = {
  ready: "success",
  working: "info",
  waiting: "warning",
  [OFFLINE_STATUS]: "error",
};
const SCOPE_TONES: Readonly<Record<string, Tone>> = {
  safe: "success",
  vibe: "warning",
};

/** The banner of one state, or nothing when the status is not in it. */
type BannerRule = (status: AssistantStatus) => BannerContent | null;

function text(...segments: string[]): string {
  return i18nKey(I18N_SECTIONS.STATUS, ...segments);
}

function counted(key: string, count: number): BlockText {
  return { key, params: { count: { type: "count", value: count } } };
}

function waitingCount(status: AssistantStatus): number {
  return (status.pendingApprovals ?? 0) + (status.pendingQuestions ?? 0);
}

function isOffline(status: AssistantStatus): boolean {
  return status.status === OFFLINE_STATUS;
}

/** "2 waiting for you", else "1 conversation working", else nothing. */
function activityDetail(status: AssistantStatus): BlockText | undefined {
  const waiting = waitingCount(status);
  if (waiting > 0) return counted(text("facts", "waiting_count"), waiting);
  const working = status.workingConversations ?? 0;
  if (working > 0) return counted(text("facts", "working_count"), working);
  return undefined;
}

function stateFact(status: AssistantStatus): KeyValueListItem {
  return {
    id: "state",
    label: text("facts", "state"),
    value: text("state", status.status),
    type: "status",
    tone: STATE_TONES[status.status] ?? "neutral",
    detail: activityDetail(status),
  };
}

function sidecarFact(status: AssistantStatus): KeyValueListItem {
  const label = text("facts", "sidecar");
  if (isOffline(status) || status.port === undefined) {
    return {
      id: "sidecar",
      label,
      value: text("facts", "sidecar_stopped"),
      tone: "error",
    };
  }
  return {
    id: "sidecar",
    label,
    value: `${SIDECAR_HOST}:${status.port}`,
    type: "mono",
    copy: true,
  };
}

/** What the sidecar tells only while it runs: agent, scope, approvals, Builder. */
function settingsFacts(status: AssistantStatus): KeyValueListItem[] {
  if (isOffline(status)) return [];
  const scope = status.generationMode ?? "";
  return [
    {
      id: "agent",
      label: text("facts", "agent"),
      value: text("agent", status.provider ?? ""),
    },
    {
      id: "scope",
      label: text("facts", "default_scope"),
      value: text("scope", scope),
      type: "status",
      tone: SCOPE_TONES[scope] ?? "neutral",
    },
    {
      id: "mode",
      label: text("facts", "approvals"),
      value: text("mode", status.mode ?? ""),
    },
    {
      id: "builder",
      label: text("facts", "builder"),
      value: text(
        "facts",
        status.builderAvailable ? "builder_connected" : "builder_missing",
      ),
      type: "status",
      tone: status.builderAvailable ? "success" : "neutral",
    },
  ];
}

/** The Overview's status rows: state, agent, scope, approvals, Builder, sidecar. */
export function statusFacts(status: AssistantStatus): KeyValueListItem[] {
  return [stateFact(status), ...settingsFacts(status), sidecarFact(status)];
}

function restartAction(): BannerAction {
  return {
    label: text("banner", "offline", "restart"),
    icon: "i-ph-arrows-clockwise",
    color: "error",
    target: {
      type: "api",
      url: PAGE_ROUTES.SIDECAR_RESTART,
      method: "POST",
      successMessage: text("banner", "offline", "restarted"),
    },
  };
}

const offlineBanner: BannerRule = (status) => {
  if (!isOffline(status)) return null;
  const reason = status.disabled ? "disabled" : "description";
  return {
    tone: "error",
    icon: "i-ph-plugs",
    title: text("banner", "offline", "title"),
    description: text("banner", "offline", reason),
    actions: status.disabled ? [] : [restartAction()],
  };
};

const lastErrorBanner: BannerRule = (status) => {
  if (!status.lastError) return null;
  return {
    tone: "error",
    icon: "i-ph-warning-octagon",
    title: text("banner", "last_error", "title"),
    description: {
      key: text("banner", "last_error", "description"),
      params: { error: status.lastError },
    },
    actions: [
      {
        label: text("banner", "last_error", "action"),
        to: PAGE_LINKS.ACTIVITY,
        icon: "i-ph-clock-counter-clockwise",
      },
    ],
  };
};

const waitingBanner: BannerRule = (status) => {
  const waiting = waitingCount(status);
  if (waiting === 0) return null;
  return {
    tone: "warning",
    icon: "i-ph-hand-palm",
    title: counted(text("banner", "waiting", "title"), waiting),
    description: text("banner", "waiting", "description"),
  };
};

/** The most pressing first: offline, then a failed turn, then requests waiting. */
const BANNER_RULES: readonly BannerRule[] = [
  offlineBanner,
  lastErrorBanner,
  waitingBanner,
];

/** The Overview's status banner, or nothing when all is well. */
export function statusBanner(status: AssistantStatus): BannerContent | null {
  return (
    BANNER_RULES.map((rule) => rule(status)).find((content) => content) ?? null
  );
}
