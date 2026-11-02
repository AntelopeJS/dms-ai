---
title: The AI assistant v2 redesign, a self-answered grill session (part 1)
description: Decision log of the AI assistant v2 redesign, sections 1 to 6. Scope, dependencies, permissions and i18n, the workspace pages, approvals and undo.
mode: explanation
---

This is the decision log behind the v2 redesign of `@antelopejs/dms-ai`. It was written as a "grill me" session where the same author asks the hard questions and answers each one with a recommendation, then follows it. Read it next to the diff. Every non-obvious choice in the pull request traces back to one answer below.

Inputs:

- The `dms` 0.6.0 and `interface-dms` 0.4.0 releases (the v2 design port, `dms#119`, and its breaking release, `dms#166`).
- The `dms-frontend` 0.5.0 release (component prefixes, no private components, `dms-frontend#103`) and the 0.4.0 release (opt-in auto-imports, `dms-frontend#101`).
- The v2 design mockup, `modules/ai/*` (Overview, Changes, Activity, Skills, Settings, and the assistant panel states), and its UX review of `dms-ai`, findings AI-01 to AI-19.

Each answer is tagged **Decision**. Where an answer narrows the mockup, it says so and why.

---

## 1. Scope

### Q1. Is this a reskin, or does it ship the features the mockup implies?

The mockup is not only visual. The UX review lists 19 findings, and the redesigned screens assume new capabilities: change sets with undo, scoped approval rules, an audit log that says who allowed what, a per-chat approval mode, an editable queue, skippable questions and token usage.

**Decision.** Ship the features. A redesign that draws an Undo button with nothing behind it would be worse than today. Each finding gets an implementation or an explicit, written reason it is narrowed (see Q40).

### Q2. Which pages exist after the redesign, and in what order?

The mockup's module navigation is Overview, Changes, Activity, Skills, Settings. The "Assistant panel" and "Design review" groups are design-only demos of the panel, not pages.

**Decision.** Five backend-declared pages in that order, `overview` (landing), `changes` (new), `activity`, `skills` and `settings`. The panel stays an app overlay, not a page.

### Q3. The mockup shows a "2" badge on Changes. What does it count?

`navBadge` only works for table views backed by a data controller (`countFrom`). Our data lives in the sidecar, not in a database.

**Decision.** No badge. A static badge would lie, and the counter has no honest source in the DMS navigation contract today.

---

## 2. Dependencies and breaking changes

### Q4. Which ranges do we require?

**Decision.** At the time of the redesign, the package required these ranges:

- `interface-dms` from 0.4.0. The Tone vocabulary, the `card` and `actions` block options, `TableView.fromSource`, row drawers, form sections and instant save were 0.4-only.
- `frontend-vue` engines, `dms-frontend` in the 0.5 release line (the component prefix contract).
- Playground, `dms` from 0.6.0, `dms-frontend` `0.5.0`, `dms-builder` latest, `core` from 1.13.4.
- `@antelopejs/interface-api`, `interface-core` and `interface-dms-builder`, their latest published ranges.
- After the `dms` 0.7 release line (Q45 to Q48), `interface-dms` from 0.5.0, engines `dms-frontend` in the 0.5 release line from 0.5.1, playground `dms` from 0.7.1 and `dms-frontend` `0.5.1`.

### Q5. How do component names change with `dms-frontend` 0.5?

Names no longer drop a leading `Dms`, and a module declares a `componentPrefix`.

**Decision.** `componentPrefix: "DmsAi"` in `dms.frontend.ts`, and `registerComponent(name)` with the bare file name. The registered names stay `DmsAi<File>`, so the backend's `CustomComponent("DmsAi…")` strings are unchanged. Components we render ourselves use the public `Dms*` components of the DMS by their full names.

### Q6. `dms-frontend` 0.4 made auto-imports opt-in. What breaks?

The plugin calls `useAuthFetch`, `useUserSession` and `useDmsDevReload` without importing them. `useAuthFetch` and `useUserSession` are public DMS composables, because the DMS declares its root `composables/` as auto-imported. `useDmsDevReload` no longer exists. The DMS renamed its composables to plain `use<Thing>` (`useDevReload`).

**Decision.** Call `useDevReload`. Our own code imports by path (we keep no `dms.frontend.build.ts`), so nothing of ours becomes global API.

### Q7. What replaces the hand-rolled header action and overlay registration?

The plugin writes `useDmsState("dms:header-actions")` and `useDmsState("dms-app-overlays")` with private copies of the DMS's types. The DMS now exposes `registerHeaderAction`, `useAppOverlay` and `useCommandPaletteSources` as public composables.

**Decision.** Use the public composables. That drops two private copies of DMS internals.

### Q8. Which `interface-dms` 0.4 renames touch our backend pages?

Checked against the 0.3 to 0.4 migration guide. `KpiCard`, `ChartCard`, `TopListCard` and `PeriodSelector` keep their options. Tone names moved to `Tone`. `ModuleInfo.category` is `catalogCategory`. Header buttons take `permission` or `permissionId`. We use none of the renamed options today.

**Decision.** Rebuild the pages on the 0.4 builders (Q15 to Q20) and let `tsc` catch the rest.

---

## 3. Permissions and i18n

### Q9. How do pages and components appear in the role editor?

Every page derives a permission from its id, every top-level component from its field key, and every `.child()` from its child id. `.meta({ name, icon, description })` titles them.

**Decision.** Every component that the role editor lists carries `.meta()` with `$dms_ai.*` i18n keys for `name` and `description`, and an icon. Custom components and built-in blocks alike carry it, so the role editor never shows a raw field key.

### Q10. The module had no i18n at all. Do we translate everything?

The DMS ships `en` and `fr`, and every string in page metadata can be a `$` key.

**Decision.** Yes, `en` and `fr`, under the `dms_ai` namespace, in `frontend-vue/i18n/locales/dms-ai-{en-GB,fr-FR}.json`. Backend metadata uses `$dms_ai.…` keys. Vue components use `useI18n().t("dms_ai.…")`. The agent's own output is not translated.

### Q11. Who can open the pages?

The routes are `@AuthOwnerOnly()`, and the panel is owner-only. Page permissions alone would let an admin grant a non-owner the Activity page, whose routes then answer 403.

**Decision.** Keep `AuthOwnerOnly` on every route (the source of truth), and declare the pages with normal permissions so they show in the role editor with readable names. A non-owner with the page granted sees the DMS's own error state from the table or chart, not a crash.

---

## 4. The workspace pages

### Q12. Do we keep custom Vue views for the pages?

The user's rule is to use the DMS blocks first, and custom components only where no block fits. The 0.4 blocks cover most of the mockup. They are `KpiCard`, `ChartCard`, `TopListCard`, `StatGroup`, `Card`, `KeyValueList`, `Banner`, `EmptyState`, `Section`, `FieldRow`, `Meter`, and `TableView.fromSource` with tabs, quick filters, a cards display drawn by `DmsRecordCard`, and row drawers with J and K.

**Decision.** Pages are trees of blocks. Custom components remain only for what no block draws. These are the status hero of the Overview, the diff viewer and change set list of Changes, the row detail drawer of Activity, the skill detail drawer and the skill card, the duplicate-skill warning (dynamic), and the Agent card of Settings.

### Q13. Why `TableView.fromSource` rather than a custom list?

Source tables give search, sort, tabs with counters, quick filters, paging, row drawers with J and K and deep links, empty states, and the DMS look, for free. Their route answers `{ results, total }` and applies `filter_<column>=is:<value>` parameters.

**Decision.** Activity, recent change sets (Overview) and Skills are source tables over owner-only routes. The grouped-by-day display the mockup shows for Activity is not available on source tables, so rows show a relative date column instead.

### Q14. How do translated labels reach table cells?

Plain string cells are not translated. Select columns map a value to an option label, and option labels go through `processI18n`.

**Decision.** Enumerations (tool, how it was allowed, result, scope, source) are `SelectType` columns whose options are `$dms_ai.*` keys, drawn as status pills with a tone. The route answers the raw value. Free text (the target, a conversation title) stays a string.

### Q15. Overview, what is on it?

The mockup has a period selector, an assistant status hero with "Open assistant" and "Review N approvals", four KPIs (Actions, Change sets applied, Approved by you, Undone), an activity chart with comparison, "How actions were allowed", recent change sets with Undo, and top tools.

**Decision.**

- `PeriodSelector` (24h, 7d, 30d, default 7d, compare with the previous period).
- `DmsAiStatusCard` (custom), with the live state of the sidecar, the agent, the default scope and approval mode, Builder presence, pending approvals, "Open assistant" and "Settings".
- Four `KpiCard` blocks on `/ai/metrics/kpi/{actions,change-sets,approved,undone}`.
- `ChartCard` (area, datetime, comparison) on `/ai/metrics/series`.
- "How actions were allowed", a `TopListCard` on `/ai/metrics/allowed` (one row per way, with a count). The "Deletions always asked: 2 of 2" line is its description.
- Recent change sets, a `TableView.fromSource` on `/ai/changes`, 4 rows, the row action "Undo" or "Redo" as an API call, and a link to Changes.
- Top tools, a `TopListCard` on `/ai/metrics/top-tools`. It was renamed from "Top skills" because it lists tools (finding AI-12).

### Q16. Changes, master-detail or table plus drawer?

The mockup is a master-detail. A change set list sits on the left, the selected set's diff on the right, and Undo previews conflicts in a dialog.

**Decision.** One custom component, `DmsAiChangesView`, built on the public `DmsMasterDetail`, `DmsEmptyState`, `DmsKeyValueList` and `DmsStatusPill` of the DMS, a `DmsConfirmModal`-style modal and Nuxt UI. The list filters All, Safe or Code with `DmsSegmented`. A diff viewer (`DiffView`) is internal to the module. `?set=<id>` deep-links a change set (the panel's "Review diff" opens it).

### Q17. Activity, what are the tabs and the "Allowed" column?

**Decision.** A source table on `/ai/activity`. Its tabs are All, Changed files, Asked you, Denied or blocked, and Failed, each a filter on a `category` column. It has quick filters on tool, agent and conversation, and a "Hide read-only" toggle as a quick filter. Its columns are Time, Action, Target, Allowed, Result, Conversation and Duration, with 25 rows a page and "Load more". The row detail opens `DmsAiActivityDetail` in a drawer (named arguments, decision trail, diff produced, raw JSON toggle, "Open conversation", "View change set"), with J and K and `?record=` deep links. "Export CSV" is a header button calling `/ai/activity/export.csv`.

### Q18. Skills, table or cards?

**Decision.** A source table on `/ai/skills/catalog` with the cards display only. `DmsAiSkillCard` draws each card on `DmsRecordCard`, with the source, the tags, the uses in 30 days, and a "Shadowed" badge and dimming for an ignored duplicate. The tabs are All, Modules and Local. The detail opens `DmsAiSkillDetail` in a drawer (source, uses, last use, SKILL.md rendered, Copy). The duplicate warning is `DmsAiSkillConflicts`, a custom banner fed by the same route, because the `Banner` block is static. A header button links to Settings › Skills.

### Q19. Settings, a custom view or a form?

The 0.4 `Form` has `sections` with a side navigation, `saveMode: "instant"` with the "Saved" state the mockup draws, choice cards with descriptions and disabled options, segmented selects and switches. The DMS's own docs use "Assistant settings" as the sections example.

**Decision.** One `Form` with `saveMode: "instant"` and the sections Agent, Approvals, Scope, Skills and History, on `GET/PUT /ai/settings`, which accepts partial bodies. The agent choice is a cards select whose Codex option is disabled per request with the sidecar's reason (an `onFilter` on the form). Full auto is not offered as a default (Q24). Usage (tokens over 14 days) is a `ChartCard` plus a `KeyValueList` in a `Section` after the form.

### Q20. What does a failed instant save look like when the sidecar is down?

The proxy used to answer defaults on failure, so a failed save snapped the form back silently (AI-11, AI-18).

**Decision.** The proxy answers `503` with a message when the sidecar is unreachable. The form's instant save then shows "Not saved" with Retry and keeps the previous value, which is the DMS's own behaviour. Read routes for charts keep answering empty payloads. List routes (`/ai/skills`, `/ai/activity`, `/ai/changes`) answer `503`, so tables show their error state ("Can't reach the assistant") instead of an empty list.

---

## 5. Approvals

### Q21. Should Builder deletions ask?

Today every Builder tool is auto-allowed, including `BuilderDeletePage`, `BuilderRemoveField` and `BuilderDeleteResource` (which clears the table by default). AI-01 is the most severe finding.

**Decision.** Deletions always ask, in every mode, including Full auto, and never offer a "for this chat" scope. The gate sits inside the Builder MCP tool handler, so Claude and Codex share it. The destructive set is `BuilderDeletePage`, `BuilderDeleteResource`, `BuilderRemoveField`, `BuilderDeleteCategory` and `BuilderRemoveQuery`. `BuilderDeleteResource` offers "Keep the data, remove only the code" (it sets `keepData: true`) and requires typing the resource name to delete the data. Row counts are not shown, because the Builder does not report them.

### Q22. Which other operations always ask?

The mockup's Settings › "Always ask for" lists deletions (locked on), adding or removing dependencies, and removing or moving Builder blocks.

**Decision.** An `alwaysAsk` setting with two toggles, `dependencies` (default on) and `blockRemoval` (default on). Dependencies are detected on shell commands (`pnpm|npm|yarn|bun` followed by `add|remove|rm|install <pkg>|uninstall|i <pkg>`). Block removal covers `BuilderRemoveBlock` and `BuilderMoveBlock`. These ask even in Full auto, like deletions.

### Q23. What do approval scopes cover?

"Approve session" granted a whole tool for the conversation (AI-04).

**Decision.** Decisions become `allow_once`, `allow_rule` (with a rule), `deny`, and `deny_all`, which denies every pending request of the chat and stops the turn. Rules are per conversation and in memory. They end with the conversation or a sidecar restart, and are of four kinds:

| Kind | Matches | Offered for |
| --- | --- | --- |
| `file` | edits to this exact file | Edit, Write, MultiEdit, Codex file changes |
| `directory` | edits under this directory | same, with the file's parent directory |
| `command` | shell commands starting with this prefix (first two words) | Bash, Codex commands |
| `domain` | web requests to this host | WebFetch |

Other tools offer "Only this time". The chat lists active rules under "Allowed in this chat" with Revoke, and the audit log records "Allowed by a rule". The bulk "Allow all" is removed.

### Q24. Where does the approval mode live, and what about Full auto?

Today the mode is a global setting and "Auto" flips global auto-approval (AI-05).

**Decision.** Settings hold the default approval mode for new chats (`normal` "Ask first", `acceptEdits`, `plan`) and the default scope. Each conversation holds its own mode and scope, changed from the composer and persisted with the conversation. Full auto exists only per chat. The composer asks for confirmation and a duration (this turn, 30 minutes, until the chat closes), shows a red banner with "Turn off" while it is active, and still asks for deletions and the `alwaysAsk` set. A stored global `auto` from an older version reads as `normal`.

"Until the chat closes" ends when the panel closes, another conversation opens, or the sidecar restarts.

### Q25. What does the approval card show?

Today it shows a path and raw JSON (AI-03).

**Decision.** The sidecar attaches a `preview` to each permission request:

- `diff`, the path, the relative path, the `+` and `−` counts, and unified hunks with line numbers, computed from the file on disk and the tool's arguments (Edit, MultiEdit, Write, Codex file changes).
- `command`, the command, the working directory, and what it touches when known ("adds a dependency · package.json, pnpm-lock.yaml").
- `destructive`, the Builder operation, its target and its consequence.
- `generic`, the named arguments.

The chat renders a diff with line numbers and colours, offers the scopes of Q23, a "Suggest a change" field (it denies with the user's text as the reason the agent reads), and keyboard shortcuts.

### Q26. What happens to a request nobody answers?

Today it is denied after 5 minutes, silently, and the stale card stays (AI-07).

**Decision.** Requests carry `expiresAtMs`. The tray shows a countdown. On expiry the sidecar sends `permission_expired` and records an "expired" notice in the transcript. The card turns into "Edit request expired" with "Ask again", which sends a follow-up asking the agent to retry. The timeout is a setting (`5`, `15`, `30` minutes). A "Notify me in the DMS" setting raises a toast when a request arrives while the panel is closed. Questions keep their own 10-minute timeout, shown the same way.

---

## 6. Undo

### Q27. How is a change set captured?

Edits and Builder operations write straight to disk, and nothing records what a turn changed (AI-02). Shell commands in Code mode can change any file.

**Decision.** A shadow git repository in the sidecar state directory (`node_modules/.cache/dms-ai/checkpoints.git`). Its work tree is the project root, and it honours the project's `.gitignore` plus `node_modules`, `dist`, `.antelope` and `.git`. Before the first mutating tool of a turn, the sidecar snapshots the work tree (`git add -A` into the shadow index, then `write-tree`). At the end of the turn it snapshots again. The change set is the tree diff. It is stored with its id, the conversation, the request, the agent, the scope, who asked, the files with their line counts, the typecheck outcome, and whether it is an auto-fix. A turn that changed nothing records nothing.

If `git` is not on `PATH`, change sets are off and the Changes page says why.

### Q28. Two chats working at once, whose changes are whose?

Snapshots are of the whole work tree, so a turn's diff can include another turn's writes.

**Decision.** Snapshots are serialized behind one lock. A change set whose window overlapped another running turn is flagged `overlapped`, and its card says "may include changes from another chat". Exact attribution would need per-tool tracking that shell commands defeat.

### Q29. How does Undo work, and what about conflicts?

**Decision.** Undo restores each file of the set to its content in the "before" tree (it deletes the files the set created), then the host hot-reloads. A later, still-applied change set touching the same files is a conflict. The preview lists them and offers "Undo #a and #b together" (safe) or "Undo #a only" (may not compile). Redo restores the "after" tree for those files. Undo and Redo are recorded in the audit log, and the set shows "undone at 09:58 by Camille". Checkpoints are kept 30 days by default (setting 7, 30 or 90), pruned at startup.

### Q30. Can Undo restore deleted data?

**Decision.** No. Undo restores code only. The delete card says so and recommends "Keep the data".

Sections 7 to 12 continue in [part 2](./redesign-v2-grill-2.md).
