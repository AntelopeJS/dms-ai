# dms-ai v2 redesign: self-answered grill session

This is the decision log behind the v2 redesign of `@antelopejs/dms-ai`. It was written as a
"grill me" session where the same author asks the hard questions and answers each one with a
recommendation, then follows it. Read it next to the diff: every non-obvious choice in the pull
request should trace back to one answer below.

Inputs:

- `@antelopejs/dms` 0.6.0, `@antelopejs/interface-dms` 0.4.0 (the v2 design port, dms#119, and its
  breaking release, dms#166).
- `@antelopejs/dms-frontend` 0.5.0 (component prefixes, no private components, dms-frontend#103) and
  0.4.0 (opt-in auto-imports, dms-frontend#101).
- The v2 design mockup, `modules/ai/*` (Overview, Changes, Activity, Skills, Settings, and the
  assistant panel states), and its UX review of dms-ai, findings AI-01 to AI-19.

Each answer is tagged **Decision**. Where an answer narrows the mockup, it says so and why.

---

## 1. Scope

### Q1. Is this a reskin, or does it ship the features the mockup implies?

The mockup is not only visual: the UX review lists 19 findings, and the redesigned screens assume
new capabilities (change sets with undo, scoped approval rules, an audit log that says who allowed
what, per-chat approval mode, editable queue, skippable questions, token usage).

**Decision:** ship the features. A redesign that draws an Undo button with nothing behind it would
be worse than today. Each finding gets an implementation or an explicit, written reason it is
narrowed (see Q40).

### Q2. Which pages exist after the redesign, and in what order?

The mockup's module navigation: Overview, Changes, Activity, Skills, Settings. The "Assistant
panel" and "Design review" groups are design-only showcases of the panel, not pages.

**Decision:** five backend-declared pages in that order: `overview` (landing), `changes` (new),
`activity`, `skills`, `settings`. The panel stays an app overlay, not a page.

### Q3. The mockup shows a "2" badge on Changes. What does it count?

`navBadge` only works for table views backed by a data controller (`countFrom`). Our data lives in
the sidecar, not in a database.

**Decision:** no badge. A static badge would lie, and the counter has no honest source in the DMS
navigation contract today.

---

## 2. Dependencies and breaking changes

### Q4. Which ranges do we require?

**Decision:**

- `@antelopejs/interface-dms`: `>=0.4.0 <1.0.0` (Tone vocabulary, `card`/`actions` block options,
  `TableView.fromSource`, row drawers, form sections and instant save are 0.4-only).
- `frontend-vue` engines: `@antelopejs/dms-frontend` `>=0.5.0 <0.6.0` (component prefix contract).
- Playground: `@antelopejs/dms` `>=0.6.0 <1.0.0`, `@antelopejs/dms-frontend` `0.5.0`,
  `@antelopejs/dms-builder` latest, `@antelopejs/core` `>=1.13.4 <2`.
- `@antelopejs/interface-api`, `interface-core`, `interface-dms-builder`: latest published ranges.
- Since dms 0.7 (Q45 to Q48): `@antelopejs/interface-dms` `>=0.5.0 <1.0.0`, engines
  `@antelopejs/dms-frontend` `>=0.5.1 <0.6.0`, playground `@antelopejs/dms` `>=0.7.1 <1.0.0` and
  `@antelopejs/dms-frontend` `0.5.1`.

### Q5. How do component names change with dms-frontend 0.5?

Names no longer drop a leading `Dms`, and a module declares a `componentPrefix`.

**Decision:** `componentPrefix: "DmsAi"` in `dms.frontend.ts`, and `registerComponent(name)` with
the bare file name. The registered names stay `DmsAi<File>`, so the backend's
`CustomComponent("DmsAi…")` strings are unchanged. Components we render ourselves use the DMS's
public `Dms*` components by their full names.

### Q6. dms-frontend 0.4 made auto-imports opt-in. What breaks?

The plugin calls `useAuthFetch`, `useUserSession` and `useDmsDevReload` without importing them.
`useAuthFetch` and `useUserSession` are public DMS composables (the DMS declares its root
`composables/` as auto-imported). `useDmsDevReload` no longer exists: the DMS renamed its composables
to plain `use<Thing>` (`useDevReload`).

**Decision:** call `useDevReload`. Our own code imports by path (we keep no
`dms.frontend.build.ts`), so nothing of ours becomes global API.

### Q7. What replaces the hand-rolled header action and overlay registration?

The plugin writes `useDmsState("dms:header-actions")` and `useDmsState("dms-app-overlays")` with
private copies of the DMS's types. The DMS now exposes `registerHeaderAction`, `useAppOverlay` and
`useCommandPaletteSources` as public composables.

**Decision:** use the public composables. That drops two private copies of DMS internals.

### Q8. Which interface-dms 0.4 renames touch our backend pages?

Checked against the 0.3 to 0.4 migration guide: `KpiCard`, `ChartCard`, `TopListCard` and
`PeriodSelector` keep their options; tone names moved to `Tone`; `ModuleInfo.category` is
`catalogCategory`; `permission` vs `permissionId` on header buttons. We use none of the renamed
options today.

**Decision:** rebuild the pages on the 0.4 builders (Q15 to Q20) and let `tsc` catch the rest.

---

## 3. Permissions and i18n

### Q9. How do pages and components appear in the role editor?

Every page derives a permission from its id, every top-level component from its field key, every
`.child()` from its child id; `.meta({ name, icon, description })` titles them.

**Decision:** every component that the role editor lists carries `.meta()` with `$dms_ai.*` i18n
keys for `name` and `description`, and an icon: custom components and built-in blocks alike, so the
role editor never shows a raw field key.

### Q10. The module had no i18n at all. Do we translate everything?

The DMS ships `en` and `fr`, and every string in page metadata can be a `$` key.

**Decision:** yes, `en` and `fr`, under the `dms_ai` namespace, in
`frontend-vue/i18n/locales/dms-ai-{en-GB,fr-FR}.json`. Backend metadata uses `$dms_ai.…` keys; Vue
components use `useI18n().t("dms_ai.…")`. The agent's own output is not translated.

### Q11. Who can open the pages?

The routes are `@AuthOwnerOnly()`, the panel is owner-only. Page permissions alone would let an
admin grant a non-owner the Activity page, whose routes then answer 403.

**Decision:** keep `AuthOwnerOnly` on every route (the source of truth), and declare the pages with
normal permissions so they show in the role editor with readable names. A non-owner with the page
granted sees the DMS's own error state from the table or chart, not a crash.

---

## 4. The workspace pages

### Q12. Do we keep custom Vue views for the pages?

The user's rule: use the DMS blocks first, custom components only where no block fits. The 0.4
blocks cover most of the mockup: `KpiCard`, `ChartCard`, `TopListCard`, `StatGroup`, `Card`,
`KeyValueList`, `Banner`, `EmptyState`, `Section`, `FieldRow`, `Meter`, `TableView.fromSource`
with tabs, quick filters, a cards display drawn by `DmsRecordCard`, and row drawers with J/K.

**Decision:** pages are trees of blocks. Custom components remain only for what no block draws: the
status hero of the Overview, the diff viewer and change set list of Changes, the row detail drawer
of Activity, the skill detail drawer and the skill card, the duplicate-skill warning (dynamic), and
the Agent card of Settings.

### Q13. Why `TableView.fromSource` rather than a custom list?

Source tables give search, sort, tabs with counters, quick filters, paging, row drawers with J/K and
deep links, empty states, and the DMS look, for free. Their route answers `{ results, total }` and
applies `filter_<column>=is:<value>` parameters.

**Decision:** Activity, recent change sets (Overview) and Skills are source tables over owner-only
routes. The grouped-by-day display the mockup shows for Activity is not available on source tables,
so rows show a relative date column instead.

### Q14. How do translated labels reach table cells?

Plain string cells are not translated. Select columns map a value to an option label, and option
labels go through `processI18n`.

**Decision:** enumerations (tool, how it was allowed, result, scope, source) are `SelectType`
columns whose options are `$dms_ai.*` keys, drawn as status pills with a tone. The route answers the
raw value. Free text (the target, a conversation title) stays a string.

### Q15. Overview: what is on it?

Mockup: period selector, an assistant status hero with "Open assistant" and "Review N approvals",
four KPIs (Actions, Change sets applied, Approved by you, Undone), an activity chart with
comparison, "How actions were allowed", recent change sets with Undo, top tools.

**Decision:**

- `PeriodSelector` (24h, 7d, 30d, default 7d, compare with the previous period).
- `DmsAiStatusCard` (custom): live state of the sidecar, agent, default scope and approval mode,
  Builder presence, pending approvals, "Open assistant" and "Settings".
- `KpiCard` × 4 on `/ai/metrics/kpi/{actions,change-sets,approved,undone}`.
- `ChartCard` (area, datetime, comparison) on `/ai/metrics/series`.
- "How actions were allowed": `TopListCard` on `/ai/metrics/allowed` (one row per way, with a
  count); the "Deletions always asked: 2 of 2" line is its description.
- Recent change sets: `TableView.fromSource` on `/ai/changes`, 4 rows, row action "Undo" or "Redo"
  as an API call, link to Changes.
- Top tools: `TopListCard` on `/ai/metrics/top-tools` (renamed from "Top skills": it lists tools,
  finding AI-12).

### Q16. Changes: master-detail or table plus drawer?

The mockup is a master-detail: a change set list on the left, the selected set's diff on the right,
and Undo previews conflicts in a dialog.

**Decision:** one custom component, `DmsAiChangesView`, built on the DMS's public `DmsMasterDetail`,
`DmsEmptyState`, `DmsKeyValueList`, `DmsStatusPill`, `DmsConfirmModal`-style modal and Nuxt UI. The
list filters All / Safe / Code with `DmsSegmented`. A diff viewer (`DiffView`) is internal to the
module. `?set=<id>` deep-links a change set (the panel's "Review diff" opens it).

### Q17. Activity: what are the tabs and the "Allowed" column?

**Decision:** a source table on `/ai/activity` with tabs All, Changed files, Asked you, Denied or
blocked, Failed (each a filter on a `category` column), quick filters on tool, agent and
conversation, a "Hide read-only" toggle as a quick filter, columns Time, Action, Target, Allowed,
Result, Conversation, Duration, 25 rows a page with "Load more". The row detail opens
`DmsAiActivityDetail` in a drawer (named arguments, decision trail, diff produced, raw JSON
toggle, "Open conversation", "View change set"), with J/K and `?record=` deep links. "Export CSV"
is a header button calling `/ai/activity/export.csv`.

### Q18. Skills: table or cards?

**Decision:** a source table on `/ai/skills/catalog` with the cards display only, each card drawn by
`DmsAiSkillCard` on `DmsRecordCard` (source, tags, uses in 30 days, a "Shadowed" badge and dimming
for an ignored duplicate). Tabs All, Modules, Local. The detail opens `DmsAiSkillDetail` in a
drawer (source, uses, last use, SKILL.md rendered, Copy). The duplicate warning is
`DmsAiSkillConflicts`, a custom banner fed by the same route, because the `Banner` block is static.
A header button links to Settings › Skills.

### Q19. Settings: a custom view or a form?

The 0.4 `Form` has `sections` with a side navigation, `saveMode: "instant"` with the "Saved" state
the mockup draws, choice cards with descriptions and disabled options, segmented selects and
switches. The DMS's own docs use "Assistant settings" as the sections example.

**Decision:** one `Form` with `saveMode: "instant"` and sections Agent, Approvals, Scope, Skills,
History, on `GET/PUT /ai/settings`, which accepts partial bodies. The agent choice is a cards
select whose Codex option is disabled per request with the sidecar's reason (an `onFilter` on the
form). Full auto is not offered as a default (Q24). Usage (tokens over 14 days) is a `ChartCard`
plus a `KeyValueList` in a `Section` after the form.

### Q20. What does a failed instant save look like when the sidecar is down?

The proxy used to answer defaults on failure, so a failed save snapped the form back silently
(AI-11, AI-18).

**Decision:** the proxy answers `503` with a message when the sidecar is unreachable. The form's
instant save then shows "Not saved" with Retry and keeps the previous value, which is the DMS's own
behaviour. Read routes for charts keep answering empty payloads, but list routes (`/ai/skills`,
`/ai/activity`, `/ai/changes`) answer `503`, so tables show their error state ("Can't reach the
assistant") instead of an empty list.

---

## 5. Approvals

### Q21. Should Builder deletions ask?

Today every Builder tool is auto-allowed, including `BuilderDeletePage`, `BuilderRemoveField` and
`BuilderDeleteResource` (which clears the table by default). AI-01 is the most severe finding.

**Decision:** deletions always ask, in every mode, including Full auto, and never offer a "for this
chat" scope. The gate sits inside the Builder MCP tool handler, so Claude and Codex share it. The
destructive set: `BuilderDeletePage`, `BuilderDeleteResource`, `BuilderRemoveField`,
`BuilderDeleteCategory`, `BuilderRemoveQuery`. `BuilderDeleteResource` offers "Keep the data, remove
only the code" (it sets `keepData: true`) and requires typing the resource name to delete the data.
Row counts are not shown: the Builder does not report them.

### Q22. Which other operations always ask?

Mockup's Settings › "Always ask for": deletions (locked on), adding or removing dependencies,
removing or moving Builder blocks.

**Decision:** an `alwaysAsk` setting with two toggles, `dependencies` (default on) and
`blockRemoval` (default on). Dependencies are detected on shell commands (`pnpm|npm|yarn|bun`
followed by `add|remove|rm|install <pkg>|uninstall|i <pkg>`). Block removal covers
`BuilderRemoveBlock` and `BuilderMoveBlock`. These ask even in Full auto, like deletions.

### Q23. What do approval scopes cover?

"Approve session" granted a whole tool for the conversation (AI-04).

**Decision:** decisions become `allow_once`, `allow_rule` (with a rule), `deny`, `deny_all` (deny
every pending request of the chat and stop the turn). Rules are per conversation, in memory, end
with the conversation or a sidecar restart, and are of four kinds:

| Kind | Matches | Offered for |
| --- | --- | --- |
| `file` | edits to this exact file | Edit, Write, MultiEdit, Codex file changes |
| `directory` | edits under this directory | same, with the file's parent directory |
| `command` | shell commands starting with this prefix (first two words) | Bash, Codex commands |
| `domain` | web requests to this host | WebFetch |

Other tools offer "Only this time". The chat lists active rules under "Allowed in this chat" with
Revoke, and the audit log records "Allowed by a rule". The bulk "Allow all" is removed.

### Q24. Where does the approval mode live, and what about Full auto?

Today the mode is a global setting and "Auto" flips global auto-approval (AI-05).

**Decision:** Settings hold the default approval mode for new chats (`normal` "Ask first",
`acceptEdits`, `plan`) and the default scope. Each conversation holds its own mode and scope,
changed from the composer, persisted with the conversation. Full auto exists only per chat: the
composer asks for confirmation and a duration (this turn, 30 minutes, until the chat closes), shows
a red banner with "Turn off" while active, and still asks for deletions and the `alwaysAsk` set. A
stored global `auto` from an older version reads as `normal`.

"Until the chat closes" ends when the panel closes, another conversation opens, or the sidecar
restarts.

### Q25. What does the approval card show?

Today: a path and raw JSON (AI-03).

**Decision:** the sidecar attaches a `preview` to each permission request:

- `diff`: path, relative path, `+`/`−` counts and unified hunks with line numbers, computed from the
  file on disk and the tool's arguments (Edit, MultiEdit, Write, Codex file changes).
- `command`: the command, the working directory, and what it touches when known ("adds a
  dependency · package.json, pnpm-lock.yaml").
- `destructive`: the Builder operation, its target and consequence.
- `generic`: named arguments.

The chat renders a diff with line numbers and colours, offers the scopes of Q23, a "Suggest a
change" field (denies with the user's text as the reason the agent reads), and keyboard shortcuts.

### Q26. What happens to a request nobody answers?

Today: denied after 5 minutes, silently; the stale card stays (AI-07).

**Decision:** requests carry `expiresAtMs`. The tray shows a countdown. On expiry the sidecar sends
`permission_expired`, records an "expired" notice in the transcript, and the card turns into "Edit
request expired" with "Ask again", which sends a follow-up asking the agent to retry. The timeout is
a setting (`5`, `15`, `30` minutes). A "Notify me in the DMS" setting raises a toast when a request
arrives while the panel is closed. Questions keep their own 10-minute timeout, shown the same way.

---

## 6. Undo

### Q27. How is a change set captured?

Edits and Builder operations write straight to disk; nothing records what a turn changed (AI-02).
Shell commands in Code mode can change any file.

**Decision:** a shadow git repository in the sidecar state directory
(`node_modules/.cache/dms-ai/checkpoints.git`, work tree = project root, honouring the project's
`.gitignore` plus `node_modules`, `dist`, `.antelope` and `.git`). Before the first mutating tool of a
turn, the sidecar snapshots the work tree (`git add -A` into the shadow index, `write-tree`); at the
end of the turn it snapshots again. The change set is the tree diff, stored with its id, the
conversation, the request, the agent, the scope, who asked, the files with their line counts, the
typecheck outcome, and whether it is an auto-fix. A turn that changed nothing records nothing.

If `git` is not on `PATH`, change sets are off and the Changes page says why.

### Q28. Two chats working at once: whose changes are whose?

Snapshots are of the whole work tree, so a turn's diff can include another turn's writes.

**Decision:** snapshots are serialized behind one lock, and a change set whose window overlapped
another running turn is flagged `overlapped`; its card says "may include changes from another chat".
Exact attribution would need per-tool tracking that shell commands defeat.

### Q29. How does Undo work, and what about conflicts?

**Decision:** Undo restores each file of the set to its content in the "before" tree (deleting files
the set created), then the host hot-reloads. A later, still-applied change set touching the same
files is a conflict: the preview lists them and offers "Undo #a and #b together" (safe) or "Undo #a
only" (may not compile). Redo restores the "after" tree for those files. Undo and Redo are recorded
in the audit log and the set shows "undone at 09:58 by Camille". Checkpoints are kept 30 days by
default (setting: 7, 30, 90), pruned at startup.

### Q30. Can Undo restore deleted data?

**Decision:** no. Undo restores code only; the delete card says so and recommends "Keep the data".

---

## 7. The assistant panel

### Q31. What does the panel look like?

**Decision:** the mockup's docked panel (`cb`): a header with the conversation title and live
status ("Ready", "Working · 0:14", "Waiting for you", "Connecting…", "Offline"), history, new chat,
more and close; the stream; a dock for approvals and questions, then steps, then the queue; the
composer with the page chip, attachments, scope and approval mode next to Send, and a footer with
keyboard hints and the chat's token count. Accent is the DMS `secondary` (violet), the AI colour.

### Q32. Tool rows: which states?

**Decision:** `done`, `running`, `waiting` (with "1 of 2 · below", linked to its card), `denied`,
`blocked` (safe mode), `failed`, `stopped`. The sidecar sends the outcome on `tool_call_end`
(`outcome`), from the permission decision recorded for the call id and the safe-mode hook; a turn
cut short marks its open calls `stopped`, also after a reload.

### Q33. How are tools named?

**Decision:** a client-side lexicon maps every known tool (Claude built-ins, Codex items, our MCP
tools, every Builder tool) to a translated verb and a target extracted from its arguments ("Add
block · Top customers · TopListCard", "Run command · pnpm add jsvat"). Expanded calls show named
arguments; raw JSON is a toggle. The same lexicon drives the Activity table through its select
options (Q14), and an unknown tool falls back to a readable form of its name.

### Q34. What happens at the end of a turn that changed files?

**Decision:** a change card: "Applied · checkpoint N", files with `+`/`−`, typecheck result, Undo and
"Review diff" (opens Changes on that set). An undone set turns into "Undone · checkpoint N restored"
with Redo. A DMS toast offers Undo too when the panel is closed.

### Q35. Auto-fix turns?

Today they run as if the user had typed "Your last edits broke the build…" (AI-06).

**Decision:** the safety net's prompt is stored as a `notice` (`kind: "autofix"`, attempt, max,
errors), never as a user message. The chat shows "Auto-fix turn 1 of 2" with the errors and "Stop
auto-fix" (interrupts and skips the remaining attempts). Its edits form their own change set tagged
auto-fix.

### Q36. Errors and offline states?

**Decision:** run errors are stored as `error` entries and render as notices with "Retry turn"
(resends the last user message) and "Copy details". An agent that cannot run says so with
"Open settings"; there is no silent fallback (the existing provider rule). Calls left open by a cut
turn show "stopped". The unavailable panel shows the last error and "Restart assistant", which asks
the backend to restart the sidecar (`POST /ai/sidecar/restart`).

### Q37. Questions and the queue?

**Decision:** questions page through one at a time with numbered options (1-4), a suggested option
(the first, marked), "Other…" for free text, and "Skip, you decide" (answers the agent with an
explicit "decide yourself"). Answers stay in the transcript as an "answered" block. The queue can be
edited (`queue_update`), reordered (`queue_move`) and cleared (`queue_clear`).

### Q38. Conversation history?

**Decision:** the drawer pins an "Active" group (working, approvals waiting) above Today, This week
and Older, with search, and per chat: files changed, agent, tokens. Deleting is undoable for 8
seconds (the client delays the delete); deleting a running chat asks first and says the applied
changes stay. Switching chats keeps the other chat's events: the sidecar already holds the live
turn, and the drawer shows it as working.

### Q39. Keyboard?

**Decision:** ↵ allow, N deny, J/K move between requests, 1–4 pick an answer, Esc stops the turn or
closes the drawer, ⌘J opens history, ⌘⇧K toggles the panel (also from inside the panel). New
requests take focus as an `alertdialog`. Hints are drawn as kbd on the buttons and in the composer
footer.

### Q40. What is narrowed from the mockup, and why?

**Decision:**

- ~~The command palette's "assistant mode" (Tab inside ⌘K) belongs to the DMS's palette, which
  offers no hook for a second mode.~~ Lifted by dms 0.7 (Q46): the palette has an assistant mode
  dms-ai fills. The palette source stays for its commands ("Open the assistant", "New
  conversation", "Review approvals", "Open changes").
- ~~The panel is a fixed overlay over the page~~ (the DMS had no docked slot). Lifted by dms 0.7
  (Q45): the panel is docked and the page shrinks next to it.
- Row counts on destructive cards: the Builder does not report them.
- The model picker stays read-only ("model chosen by Claude Code"), as the review recommends.
- Grouped-by-day Activity rows: not available on source tables (Q13).
- The Changes nav badge (Q3).

---

## 8. Usage and metrics

### Q41. Where do tokens show?

**Decision:** the composer footer (this chat), each conversation in the drawer, and Settings ›
Usage: a 14-day chart of tokens per day with the biggest chat called out. The sidecar records each
turn's usage with its timestamp (`usage` entries per conversation) so per-day totals are exact.

### Q42. What feeds "How actions were allowed"?

**Decision:** every tool call is stored with `allowedBy`: `read_auto`, `builder_auto`, `approved`,
`rule`, `full_auto`, `blocked`, `denied`, `expired`. Deletions also record `alwaysAsk: true`, which
feeds "Deletions always asked: N of N". The KPIs and the breakdown read the same field, so Builder
operations now count.

### Q43. Who is "Asked by"?

**Decision:** the backend bridge knows the signed-in user; it sends an `actor` frame (user id and
display name) to the sidecar when it opens the socket, and refuses an `actor` frame coming from the
browser. Change sets and undo/redo record that actor.

---

## 9. Testing

### Q44. How is this tested?

**Decision:**

- Sidecar unit and integration tests for the new buses and stores: permission rules, always-ask,
  expiry, checkpoints and undo with conflicts, queue edit and reorder, question skip, audit fields.
- Frontend unit tests for the lexicon, the diff renderer, the panel state machines.
- Backend registration test for the pages and their permission metadata.
- A real run: the playground with MongoDB, `@antelopejs/dms` 0.6, `dms-builder`, the dms-ai sidecar
  driven by the repository's mock Claude, exercised in a browser (Playwright) on every page and panel
  state, in light and dark. Bugs found on the way are fixed in this pull request.

---

## 10. Follow-up after dms 0.7

Inputs: `@antelopejs/dms` 0.7.1 and `@antelopejs/interface-dms` 0.5.0 (docked side panels, dms#168;
the palette's assistant mode, dms#169; permission ancestors and member-open settings, dms#172),
0.6.1/0.6.2 and interface-dms 0.4.1/0.4.2 (route tokens in block data URLs, dms#170; composed block
texts, dms#173; cell sub-lines and `two_line`, dms#175), `@antelopejs/dms-frontend` 0.5.1. dms 0.7.0
on npm needs interface files that only shipped with interface-dms 0.5.0, so the playground asks for
0.7.1.

### Q45. How does the panel use the docked side panels?

**Decision:** the panel is a DMS side panel (`registerSidePanel`, id `dms-ai:assistant`, 460 px by
default, 360 to 820 px), registered from a universal plugin in development so a panel left open is
rendered docked on the first paint and survives reloads and layout switches. The DMS owns the open
state and the width (its `dms-side-panel` cookie); the plugin drives it through `useSidePanel`
(⌘⇧K, the toasts, the workspace views) and the header launcher only names it (`sidePanelId`), so the
DMS draws it engaged. The panel's own fixed positioning, resize handle, outside-click close and
localStorage preferences are gone. The DMS unmounts the panel's content when it closes: the chat
sends `leave_conversation` on unmount and picks its conversation up again (hello, snapshot, replay)
when it reopens. The assistant session is provided from the start as a ref, empty until the first
probe answers; a probe that finds no assistant withdraws the panel.

### Q46. What does the palette's assistant mode answer?

**Decision:** Tab in ⌘K offers the page's first prompts (the panel's empty-chat suggestions, read-only
ones first). A submitted prompt mounts `DmsAiPaletteAnswer`, which runs a read-only turn (Plan only,
Safe mode) in a new conversation through the panel's own transport and conversation logic, drawn by
the panel's message list. It offers "Continue in the assistant" (opens the panel on that
conversation; the turn goes on) and Close; closing the palette on a running answer stops its turn.
A question the agent asks, or a plan to approve, is answered in the panel. The conversation is
stored like any other and shows in the history.

### Q47. How does the palette's turn share the tab's one stream with the panel?

A sidecar socket follows one conversation: a second chat's `hello` would take the panel's away.

**Decision:** one protocol addition: `hello` with `follow: true` adds the socket to the
conversation's recipients without leaving the one it shows; opening another conversation keeps the
follow, closing the socket ends it (unit and integration tests in the sidecar). The palette holds
the stream open while it answers (`holdStream`), as an open panel or a busy chat do.

### Q48. Which other 0.6.1 to 0.7 changes apply?

**Decision:**

- Activity's "Action" column is a `two_line` cell: the tool's label and icon over its target, a
  per-row `CellSubline` the route writes in red for a destructive tool (dms#175).
- Settings › Usage composes the biggest conversation's token count (`ComposedText` with a `count`)
  rather than a bare number (dms#173).
- Permission ancestors (dms#172): the pages and blocks declare no permission list of their own (ids
  are derived, roles are saved through the role editor, which completes ancestors), the playground
  seeds no role, and the routes stay `@AuthOwnerOnly()` (Q11). Nothing to change; the interface's
  removals (`ResolveNavBadges`, `skipEmailValidation`, unseen notification counts) are unused here.
- Route tokens in block data URLs (dms#170): no page reads a URL parameter through a block.
- The panel, the palette answer and the Overview status card take `--dms-assistant-tint` and
  `--dms-assistant-line` where they meant the assistant's violet.

