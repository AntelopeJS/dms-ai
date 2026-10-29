import type { PendingRequest } from "../agent/permission-bus.js";
import type { PendingQuestion } from "../agent/question-bus.js";
import { getBuilderAvailable } from "../builder/capability.js";
import { PREVIEW_IMAGE_MIME_PREFIX } from "../constants/preview.js";
import {
  type AskQuestionEventType,
  type ConversationListEventType,
  type ConversationSnapshotEventType,
  type ConversationSummaryType,
  EVENT_TYPES,
  type PermissionRequestEventType,
  type SettingsUpdateEventType,
} from "../protocol/events.js";
import type { BlockPreviewType } from "../protocol/preview.js";
import { getProviderAvailability } from "../providers/registry.js";
import type {
  Notice,
  StoredConversationSummary,
  StoredMessage,
} from "../state/types.js";
import type { SidecarServices } from "./services.js";

/** Audit-only records: they drive the activity log, not the visible transcript. */
const HIDDEN_ROLES: readonly StoredMessage["role"][] = ["permission"];
/** Fields of a stored message the chat never reads back. */
const AUDIT_ONLY_FIELDS: ReadonlyArray<keyof StoredMessage> = [
  "requestId",
  "kind",
  "alwaysAsk",
  "summary",
  "args",
  "requestedAtMs",
  "expiresAtMs",
  "feedback",
  "decidedBy",
  "decision",
];

function toSnapshotMessage(message: StoredMessage): StoredMessage {
  const copy = { ...message };
  for (const field of AUDIT_ONLY_FIELDS) delete copy[field];
  return copy;
}

export function buildSnapshotEvent(
  services: SidecarServices,
  conversationId: string,
): ConversationSnapshotEventType | null {
  const conversation = services.conversationStore.get(conversationId);
  if (conversation === null) return null;
  return {
    type: EVENT_TYPES.CONVERSATION_SNAPSHOT,
    conversationId,
    messages: conversation.messages
      .filter((m) => !HIDDEN_ROLES.includes(m.role))
      .map(toSnapshotMessage),
    changeSets: services.checkpoints.forConversation(conversationId),
    mode: services.conversationModes.describe(conversationId),
    totalTokens: conversation.tokenUsage?.totalTokens ?? 0,
  };
}

/**
 * The files the conversation's change sets still change, and those only its
 * undone sets touched: a chat whose every change was undone reads so in the
 * history rather than "no changes".
 */
function fileCounts(services: SidecarServices, conversationId: string) {
  const applied = new Set<string>();
  const undone = new Set<string>();
  for (const changeSet of services.checkpoints.forConversation(
    conversationId,
  )) {
    const paths = changeSet.state === "applied" ? applied : undone;
    for (const file of changeSet.files) paths.add(file.path);
  }
  for (const path of applied) undone.delete(path);
  return { filesChanged: applied.size, filesUndone: undone.size };
}

function enrichSummary(
  services: SidecarServices,
  summary: StoredConversationSummary,
): ConversationSummaryType {
  const { id } = summary;
  return {
    ...summary,
    ...fileCounts(services, id),
    isRunning: services.turns.isRunning(id),
    pendingApprovals: services.permissionBus.countPending(id),
    pendingQuestions: services.questionBus.countPending(id),
    generationMode: services.conversationModes.describe(id).generationMode,
  };
}

export function listConversations(
  services: SidecarServices,
): ConversationSummaryType[] {
  return services.conversationStore
    .list()
    .map((summary) => enrichSummary(services, summary));
}

export function buildConversationListEvent(
  services: SidecarServices,
): ConversationListEventType {
  return {
    type: EVENT_TYPES.CONVERSATION_LIST,
    conversations: listConversations(services),
  };
}

/** Keeps every open drawer's "Active" group live. */
export function broadcastConversationList(services: SidecarServices): void {
  services.chatSocketRegistry.broadcast(buildConversationListEvent(services));
}

export function sendConversationMode(
  services: SidecarServices,
  conversationId: string,
): void {
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.CONVERSATION_MODE,
    ...services.conversationModes.describe(conversationId),
  });
}

export function sendRulesState(
  services: SidecarServices,
  conversationId: string,
): void {
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.RULES_STATE,
    conversationId,
    rules: services.permissionBus.listRules(conversationId),
  });
}

/** Stores a notice in the transcript and shows it live. */
export function emitNotice(
  services: SidecarServices,
  conversationId: string,
  notice: Notice,
): void {
  services.conversationStore.appendMessage(conversationId, {
    role: "notice",
    content: "",
    notice,
    timestampMs: notice.timestampMs,
  });
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.NOTICE,
    conversationId,
    notice,
  });
}

/** Stores a block preview in the transcript and shows it live. */
export function emitBlockPreview(
  services: SidecarServices,
  conversationId: string,
  preview: BlockPreviewType,
): void {
  services.conversationStore.appendMessage(conversationId, {
    role: "block_preview",
    content: "",
    preview,
    timestampMs: preview.timestampMs,
  });
  services.chatSocketRegistry.send(conversationId, {
    type: EVENT_TYPES.BLOCK_PREVIEW,
    conversationId,
    preview,
  });
}

/** Names of the images the user attached in the conversation, oldest first. */
export function listAttachedImages(
  services: SidecarServices,
  conversationId: string,
): string[] {
  const messages =
    services.conversationStore.get(conversationId)?.messages ?? [];
  return messages
    .flatMap((message) => message.attachments ?? [])
    .filter((attachment) =>
      attachment.mimeType.startsWith(PREVIEW_IMAGE_MIME_PREFIX),
    )
    .map((attachment) => attachment.name);
}

export function buildPermissionRequestEvent(
  request: PendingRequest,
): PermissionRequestEventType {
  return { type: EVENT_TYPES.PERMISSION_REQUEST, ...request };
}

export function buildAskQuestionEvent(
  question: PendingQuestion,
): AskQuestionEventType {
  return { type: EVENT_TYPES.ASK_QUESTION, ...question };
}

export function buildSettingsUpdateEvent(
  services: Pick<SidecarServices, "settingsStore">,
): SettingsUpdateEventType {
  return {
    type: EVENT_TYPES.SETTINGS_UPDATE,
    settings: services.settingsStore.get(),
    builderAvailable: getBuilderAvailable(),
    providers: getProviderAvailability(),
  };
}
