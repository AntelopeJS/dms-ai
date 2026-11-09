import { z } from "zod";
import {
  ALLOWED_BY_VALUES,
  CHANGE_FILE_STATUSES,
  CHANGE_SET_STATES,
  PERMISSION_KINDS,
  TOOL_OUTCOMES,
  TYPECHECK_OUTCOMES,
} from "../constants/audit.js";
import { BlockPreviewSchema } from "../protocol/preview.js";
import { CHAT_MODES, GENERATION_MODES } from "./settings-types.js";
import {
  type ChangeSetRecord,
  type Notice,
  PROVIDER_NAMES,
  STORED_MESSAGE_ROLES,
  STORED_MESSAGE_STATUSES,
  STORED_PERMISSION_DECISIONS,
  type StoredConversation,
} from "./types.js";

const NoticeSchema: z.ZodType<Notice> = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("autofix"),
    attempt: z.number(),
    maxAttempts: z.number(),
    errors: z.array(z.string()),
    timestampMs: z.number(),
  }),
  z.looseObject({
    kind: z.literal("permission_expired"),
    toolName: z.string(),
    summary: z.string(),
    timestampMs: z.number(),
  }),
  z.looseObject({
    kind: z.literal("question_skipped"),
    header: z.string(),
    timestampMs: z.number(),
  }),
  z.looseObject({
    kind: z.literal("full_auto_ended"),
    timestampMs: z.number(),
  }),
  z.looseObject({
    kind: z.literal("model_fallback"),
    requestedModel: z.string(),
    usedModel: z.string(),
    timestampMs: z.number(),
  }),
  z.looseObject({
    kind: z.literal("auto_unavailable"),
    model: z.string(),
    timestampMs: z.number(),
  }),
]);

const StoredMessageSchema = z.looseObject({
  role: z.enum(STORED_MESSAGE_ROLES),
  content: z.string(),
  toolName: z.string().optional(),
  callId: z.string().optional(),
  status: z.enum(STORED_MESSAGE_STATUSES).optional(),
  decision: z.enum(STORED_PERMISSION_DECISIONS).optional(),
  attachments: z
    .array(
      z.looseObject({
        name: z.string(),
        mimeType: z.string(),
        size: z.number(),
      }),
    )
    .optional(),
  isRetryable: z.boolean().optional(),
  timestampMs: z.number(),
  outcome: z.enum(TOOL_OUTCOMES).optional(),
  allowedBy: z.enum(ALLOWED_BY_VALUES).optional(),
  changeSetId: z.string().optional(),
  notice: NoticeSchema.optional(),
  answers: z
    .array(
      z.looseObject({
        header: z.string(),
        question: z.string(),
        answer: z.string().nullable(),
        skipped: z.boolean(),
        isCustom: z.boolean(),
      }),
    )
    .optional(),
  preview: BlockPreviewSchema.optional(),
  isAutoFix: z.boolean().optional(),
  requestId: z.string().optional(),
  kind: z.enum(PERMISSION_KINDS).optional(),
  alwaysAsk: z.boolean().optional(),
  summary: z.string().optional(),
  args: z.unknown().optional(),
  requestedAtMs: z.number().optional(),
  expiresAtMs: z.number().optional(),
  feedback: z.string().optional(),
  decidedBy: z.string().optional(),
});

const TOKEN_COUNTS = {
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
};

/** A conversation as `state.json` holds it; keys it does not name are kept. */
export const StoredConversationSchema: z.ZodType<StoredConversation> =
  z.looseObject({
    messages: z.array(StoredMessageSchema),
    createdAtMs: z.number(),
    updatedAtMs: z.number(),
    provider: z.enum(PROVIDER_NAMES).optional(),
    tokenUsage: z.looseObject(TOKEN_COUNTS).optional(),
    model: z.string().optional(),
    usageLog: z
      .array(z.looseObject({ ...TOKEN_COUNTS, timestampMs: z.number() }))
      .optional(),
    mode: z.enum(CHAT_MODES).optional(),
    generationMode: z.enum(GENERATION_MODES).optional(),
  });

/** A change set as `change-sets.json` holds it; keys it does not name are kept. */
export const ChangeSetRecordSchema: z.ZodType<ChangeSetRecord> = z.looseObject({
  id: z.string(),
  number: z.number(),
  conversationId: z.string(),
  title: z.string(),
  createdAtMs: z.number(),
  agent: z.enum(PROVIDER_NAMES),
  scope: z.enum(GENERATION_MODES),
  isAutoFix: z.boolean(),
  overlapped: z.boolean(),
  files: z.array(
    z.looseObject({
      path: z.string(),
      status: z.enum(CHANGE_FILE_STATUSES),
      added: z.number(),
      removed: z.number(),
    }),
  ),
  added: z.number(),
  removed: z.number(),
  typecheck: z.enum(TYPECHECK_OUTCOMES),
  state: z.enum(CHANGE_SET_STATES),
  stateChangedAtMs: z.number().optional(),
  stateChangedBy: z.string().optional(),
  askedBy: z.string().optional(),
  approvalsNeeded: z.number(),
  builderOps: z.number(),
  beforeTree: z.string(),
  afterTree: z.string(),
  pagePath: z.string().optional(),
  stateLog: z
    .array(
      z.looseObject({
        state: z.enum(CHANGE_SET_STATES),
        atMs: z.number(),
        by: z.string().optional(),
      }),
    )
    .optional(),
});
