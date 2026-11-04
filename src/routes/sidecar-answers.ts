import { z } from "zod";
import { isJsonBody, type JsonBody } from "../sidecar";
import type {
  ActivityRow,
  ChangeSetSummary,
  SidecarList,
  SidecarSkillCatalog,
  UndoPreview,
} from "../types";

/** Objects keep the members the routes do not name, so a well-formed answer reaches them as the sidecar sent it. */
function listOf<T>(item: z.ZodType<T>): z.ZodType<SidecarList<T>> {
  return z.looseObject({ results: z.array(item), total: z.number() });
}

/** An answer a route forwards as it is: any JSON, or nothing. */
export const ANY_ANSWER: z.ZodType<JsonBody | undefined> = z.custom<
  JsonBody | undefined
>((value) => value === undefined || isJsonBody(value));

const ACTIVITY_ROW: z.ZodType<ActivityRow> = z.looseObject({
  id: z.string(),
  timestampMs: z.number(),
  tool: z.string(),
  target: z.string(),
  agent: z.string(),
  allowedBy: z.string(),
  result: z.string(),
  resultDetail: z.string().optional(),
  changeSetId: z.string().optional(),
  changeSetNumber: z.number().optional(),
  conversationId: z.string(),
  conversationTitle: z.string(),
  durationMs: z.number().optional(),
  isReadOnly: z.boolean(),
  isAutoFix: z.boolean(),
  category: z.array(z.string()),
  added: z.number().optional(),
  removed: z.number().optional(),
  expiresAtMs: z.number().optional(),
});

export const ACTIVITY_ROW_ANSWER = ACTIVITY_ROW;
export const ACTIVITY_PAGE_ANSWER = listOf(ACTIVITY_ROW);

const CHANGE_SET: z.ZodType<ChangeSetSummary> = z.looseObject({
  id: z.string(),
  number: z.number(),
  conversationId: z.string(),
  title: z.string(),
  createdAtMs: z.number(),
  agent: z.string(),
  scope: z.string(),
  isAutoFix: z.boolean(),
  overlapped: z.boolean(),
  files: z.array(
    z.looseObject({
      path: z.string(),
      status: z.string(),
      added: z.number(),
      removed: z.number(),
    }),
  ),
  added: z.number(),
  removed: z.number(),
  typecheck: z.string(),
  state: z.string(),
  stateChangedAtMs: z.number().optional(),
  stateChangedBy: z.string().optional(),
  askedBy: z.string().optional(),
  approvalsNeeded: z.number(),
  builderOps: z.number(),
});

export const CHANGE_SET_PAGE_ANSWER = listOf(CHANGE_SET);

export const UNDO_PREVIEW_ANSWER: z.ZodType<UndoPreview> = z.looseObject({
  changeSetId: z.string(),
  files: z.array(z.string()),
  conflicts: z.array(
    z.looseObject({
      changeSetId: z.string(),
      number: z.number(),
      title: z.string(),
      files: z.array(z.string()),
    }),
  ),
});

export const SKILL_CATALOG_ANSWER: z.ZodType<SidecarSkillCatalog> =
  z.looseObject({
    items: z.array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        icon: z.string().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()),
        provenance: z.string(),
        body: z.string(),
        source: z.string().optional(),
        origin: z.string().optional(),
        uses30d: z.number().optional(),
        lastUsedAtMs: z.number().optional(),
        lastConversationId: z.string().optional(),
        isShadowed: z.boolean().optional(),
        shadowedBy: z.string().optional(),
      }),
    ),
  });

export const SETTINGS_ANSWER: z.ZodType<Record<string, JsonBody>> = z.record(
  z.string(),
  z.custom<JsonBody>(isJsonBody),
);
