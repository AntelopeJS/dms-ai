/**
 * Agent-facing prose for the Builder tools.
 *
 * Four surfaces carry guidance to the agent, and each owns a different kind of
 * fact. Put a fact in exactly one of them:
 *
 * 1. **A zod `.describe()`** — what one argument must contain. Travels with the
 *    parameter, so it is read exactly where a malformed call is being written.
 *    Anything shaped like "this field takes X" belongs there, not in prose here.
 * 2. **A tool description** — what the tool does, what it returns, and the one
 *    or two facts needed to call it correctly the first time. Always in context,
 *    so it is the expensive surface: keep it mechanical.
 * 3. **`skills/<name>/SKILL.md`** — concepts, workflow, worked examples, when to
 *    reach for a tool at all. Loaded on demand and written in markdown, so it is
 *    the cheap surface. Explanation belongs there by default.
 * 4. **The system prompt** (`prompts/agent.ts`) — decision points only: which
 *    mechanism suits which situation.
 *
 * Two corollaries, and they are what keeps this file small:
 *
 * - **A fact the agent can read at runtime does not belong in prose at all.**
 *   Reserved field names come from `BuilderCatalog.reservedFieldNames`; a query
 *   template's parameters come from `BuilderQueryTemplates`. Restating either
 *   here would be a copy that silently drifts. When prose is tempting because
 *   the data is uninformative, fix the data.
 * - **Prose lives here only if more than one tool needs it.** A note used by a
 *   single tool belongs inline in that tool's description.
 */

/** Appended to every Builder tool description by `note()`. */
export const BUILDER_ESCALATION_NOTE =
  "If the result is ok:false with error.code 'opaque_target' or 'unsupported', safe mode cannot make this change. Explain the limitation to the user and ask permission to switch to vibe mode (direct file edits) for this step.";

/** Returned in place of an op when a tool is handed a raw `$expr` value. */
export const BUILDER_EXPR_REFUSAL =
  'Refused: safe mode does not allow raw `$expr` values in builder config. For a Form field or Column DataType, use `{ $dataType: "<id>", config: {…} }` (see BuilderCatalog for ids). To reference a generated resource class (e.g. a RelationType\'s `dataApiController`), use a reference value `{ $ref: { resource: "<name>" } }` instead — it is validated and allowed in safe mode. Only escalate to vibe mode for genuinely arbitrary code.';

/**
 * The `$ref` shape. Describes a *value* the agent writes, so it rides on the
 * DataType config argument rather than on the description of every tool that
 * accepts one.
 */
export const BUILDER_REF_NOTE =
  'To reference a builder-generated resource class inside config (e.g. a RelationType DataType\'s `dataApiController`), pass `{ $ref: { resource: "<ref>", as?: "dataApi" | "table" | "model" } }` (default `as` = "dataApi", the DataAPI controller). The resource must already exist (BuilderListResources). Unlike `$expr`, `$ref` is allowed in safe mode.';
