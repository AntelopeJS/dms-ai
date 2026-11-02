---
title: The AI assistant v2 redesign, a self-answered grill session (part 2)
description: Decision log of the AI assistant v2 redesign, sections 7 to 12. The assistant panel, usage and metrics, testing, and the follow-ups after later DMS releases.
mode: explanation
---

Sections 1 to 6 are in [part 1](./redesign-v2-grill.md).

## 7. The assistant panel

### Q31. What does the panel look like?

**Decision.** The mockup's docked panel (`cb`), with a header showing the conversation title and live status ("Ready", "Working · 0:14", "Waiting for you", "Connecting…", "Offline"), history, new chat, more and close. Below come the stream, a dock for approvals and questions, steps, and the queue. The composer has the page chip, attachments, scope and approval mode next to Send, and a footer with keyboard hints and the chat's token count. Its accent is the DMS `secondary` (violet), the AI colour.

### Q32. Tool rows, which states?

**Decision.** `done`, `running`, `waiting` (with "1 of 2 · below", linked to its card), `denied`, `blocked` (safe mode), `failed` and `stopped`. The sidecar sends the outcome on `tool_call_end` (`outcome`), from the permission decision recorded for the call id and the safe-mode hook. A turn cut short marks its open calls `stopped`, also after a reload.

### Q33. How are tools named?

**Decision.** A client-side lexicon maps every known tool (Claude built-ins, Codex items, our MCP tools, every Builder tool) to a translated verb and a target extracted from its arguments ("Add block · Top customers · TopListCard", "Run command · pnpm add jsvat"). Expanded calls show named arguments, and raw JSON is a toggle. The same lexicon drives the Activity table through its select options (Q14), and an unknown tool falls back to a readable form of its name.

### Q34. What happens at the end of a turn that changed files?

**Decision.** A change card, with "Applied · checkpoint N", the files with `+` and `−` counts, the typecheck result, Undo and "Review diff" (which opens Changes on that set). An undone set turns into "Undone · checkpoint N restored" with Redo. A DMS toast offers Undo too when the panel is closed.

### Q35. Auto-fix turns?

Today they run as if the user had typed "Your last edits broke the build…" (AI-06).

**Decision.** The safety net's prompt is stored as a `notice` (`kind: "autofix"`, attempt, max, errors), never as a user message. The chat shows "Auto-fix turn 1 of 2" with the errors and "Stop auto-fix", which interrupts and skips the remaining attempts. Its edits form their own change set tagged auto-fix.

### Q36. Errors and offline states?

**Decision.** Run errors are stored as `error` entries and render as notices with "Retry turn" (which resends the last user message) and "Copy details". An agent that cannot run says so with "Open settings". There is no silent fallback (the existing provider rule). Calls left open by a cut turn show "stopped". The unavailable panel shows the last error and "Restart assistant", which asks the backend to restart the sidecar (`POST /ai/sidecar/restart`).

### Q37. Questions and the queue?

**Decision.** Questions page through one at a time with numbered options (1 to 4), a suggested option (the first, marked), "Other…" for free text, and "Skip, you decide", which answers the agent with an explicit "decide yourself". Answers stay in the transcript as an "answered" block. The queue can be edited (`queue_update`), reordered (`queue_move`) and cleared (`queue_clear`).

### Q38. Conversation history?

**Decision.** The drawer pins an "Active" group (working, approvals waiting) above Today, This week and Older, with search. Each chat shows its files changed, agent and tokens. Deleting is undoable for 8 seconds, because the client delays the delete. Deleting a running chat asks first and says the applied changes stay. Switching chats keeps the other chat's events. The sidecar holds the live turn, and the drawer shows it as working.

### Q39. Keyboard?

**Decision.** ↵ allows, N denies, J and K move between requests, 1 to 4 pick an answer, and Esc stops the turn or closes the drawer. ⌘J opens history, and ⌘⇧K toggles the panel, also from inside the panel. New requests take focus as an `alertdialog`. Hints are drawn as kbd on the buttons and in the composer footer.

### Q40. What is narrowed from the mockup, and why?

**Decision.**

- ~~The command palette's "assistant mode" (Tab inside ⌘K) belongs to the DMS's palette, which offers no hook for a second mode.~~ Lifted by `dms` 0.7 (Q46). The palette has an assistant mode that `dms-ai` fills. The palette source stays for its commands ("Open the assistant", "New conversation", "Review approvals", "Open changes").
- ~~The panel is a fixed overlay over the page~~ (the DMS had no docked slot). Lifted by `dms` 0.7 (Q45). The panel is docked and the page shrinks next to it.
- Row counts on destructive cards. The Builder does not report them.
- The model picker stays read-only ("model chosen by Claude Code"), as the review recommends.
- Grouped-by-day Activity rows, which source tables do not offer (Q13).
- The Changes nav badge (Q3).

---

## 8. Usage and metrics

### Q41. Where do tokens show?

**Decision.** In the composer footer (this chat), on each conversation in the drawer, and in Settings › Usage, a 14-day chart of tokens per day with the biggest chat called out. The sidecar records each turn's usage with its timestamp (`usage` entries per conversation), so per-day totals are exact.

### Q42. What feeds "How actions were allowed"?

**Decision.** Every tool call is stored with `allowedBy`, one of `read_auto`, `builder_auto`, `approved`, `rule`, `full_auto`, `blocked`, `denied` and `expired`. Deletions also record `alwaysAsk: true`, which feeds "Deletions always asked: N of N". The KPIs and the breakdown read the same field, so Builder operations now count.

### Q43. Who is "Asked by"?

**Decision.** The backend bridge knows the signed-in user. It sends an `actor` frame (user id and display name) to the sidecar when it opens the socket, and refuses an `actor` frame coming from the browser. Change sets, Undo and Redo record that actor.

---

## 9. Testing

### Q44. How is this tested?

**Decision.**

- Sidecar unit and integration tests for the new buses and stores. They cover permission rules, always-ask, expiry, checkpoints and undo with conflicts, queue edit and reorder, question skip, and audit fields.
- Frontend unit tests for the lexicon, the diff renderer and the panel state machines.
- A backend registration test for the pages and their permission metadata.
- A real run of the playground with MongoDB, `dms` 0.6, `dms-builder`, and the `dms-ai` sidecar driven by the repository's mock Claude, exercised in a browser (Playwright) on every page and panel state, in light and dark. Bugs found on the way are fixed in this pull request.

---

## 10. Follow-up after `dms` 0.7

Inputs:

- `dms` 0.7.1 and `interface-dms` 0.5.0. Docked side panels (`dms#168`), the palette's assistant mode (`dms#169`), permission ancestors and member-open settings (`dms#172`).
- `dms` 0.6.1 and 0.6.2, `interface-dms` 0.4.1 and 0.4.2. Route tokens in block data URLs (`dms#170`), composed block texts (`dms#173`), cell sub-lines and `two_line` (`dms#175`).
- `dms-frontend` 0.5.1.

The `dms` 0.7.0 release on npm needed interface files that only shipped with `interface-dms` 0.5.0, so the playground asked for 0.7.1.

### Q45. How does the panel use the docked side panels?

**Decision.** The panel is a DMS side panel (`registerSidePanel`, id `dms-ai:assistant`, 460 px by default, 360 to 820 px). A universal plugin registers it in development, so a panel left open renders docked on the first paint and survives reloads and layout switches. The DMS owns the open state and the width (its `dms-side-panel` cookie). The plugin drives it through `useSidePanel` (⌘⇧K, the toasts, the workspace views), and the header launcher only names it (`sidePanelId`), so the DMS draws it engaged. The panel's own fixed positioning, resize handle, outside-click close and localStorage preferences are gone. The DMS unmounts the panel's content when it closes. The chat sends `leave_conversation` on unmount and picks its conversation up again (hello, snapshot, replay) when it reopens. The assistant session is a ref provided from the start, empty until the first probe answers. A probe that finds no assistant withdraws the panel.

### Q46. What does the palette's assistant mode answer?

**Decision.** Tab in ⌘K offers the page's first prompts (the panel's empty-chat suggestions, read-only ones first). A submitted prompt mounts `DmsAiPaletteAnswer`. It runs a read-only turn (Plan only, Safe mode) in a new conversation through the panel's own transport and conversation logic, drawn by the panel's message list. It offers "Continue in the assistant", which opens the panel on that conversation while the turn goes on, and Close. Closing the palette on a running answer stops the turn. A question the agent asks, or a plan to approve, is answered in the panel. The conversation is stored like any other and shows in the history.

### Q47. How does the palette's turn share the tab's one stream with the panel?

A sidecar socket follows one conversation. A second chat's `hello` would take the panel's conversation away.

**Decision.** One protocol addition. `hello` with `follow: true` adds the socket to the conversation's recipients without leaving the one it shows. Opening another conversation keeps the follow, and closing the socket ends it (unit and integration tests in the sidecar). The palette holds the stream open while it answers (`holdStream`), as an open panel or a busy chat do.

### Q48. Which other 0.6.1 to 0.7 changes apply?

**Decision.**

- Activity's "Action" column is a `two_line` cell. The tool's label and icon sit over its target, a per-row `CellSubline` the route writes in red for a destructive tool (`dms#175`).
- Settings › Usage composes the biggest conversation's token count (`ComposedText` with a `count`) rather than a bare number (`dms#173`).
- Permission ancestors (`dms#172`). The pages and blocks declare no permission list of their own (ids are derived, and the role editor completes ancestors when it saves a role). The playground seeds no role, and the routes stay `@AuthOwnerOnly()` (Q11). Nothing changes. The interface's removals (`ResolveNavBadges`, `skipEmailValidation`, unseen notification counts) are unused here.
- Route tokens in block data URLs (`dms#170`). No page reads a URL parameter through a block.
- The panel, the palette answer and the Overview status card take `--dms-assistant-tint` and `--dms-assistant-line` where they meant the assistant's violet.

---

## 11. Follow-up after `dms` 0.7.2

Inputs are `dms` 0.7.2, `interface-dms` 0.5.1 and `dms-frontend` 0.5.2, with banners read from a route (`dms#186`), drawers from a chosen edge (`dms#188`), `DmsMasterDetail` laid out from its own width (`dms#183`), the `CodeBlock` block and `DmsCodeSnippet` (`dms#182`), tone pills per row (`dms#181`), copy buttons on `KeyValueList` rows (`dms#180`), composed texts in more blocks (`dms#179`), period scope and realtime topics on list blocks (`dms#184`), `TableView` reloads (`dms#185`) and route tokens in `TableView.fromSource` (`dms#178`). The user's rule still holds. A DMS block comes before a custom component, with no glue.

### Q49. What replaces the duplicate-skill warning?

`DmsAiSkillConflicts` existed because the `Banner` block was static (Q18).

**Decision.** A `Banner` block with `fetchUrl: /ai/skills/conflicts`. The route reads the sidecar's duplicate names and answers one `BannerContent` for all of them. It has a warning tone, a composed title "2 skill names are shared by several skills", the names in a composed description, and a link to Settings › Skills. The route answers 204 when no name is shared or the sidecar is down, so the block draws nothing. An ignored copy's card keeps saying "Shadowed" and its drawer names the copy used, so the banner no longer spells out each winner. The component, its types, its route constant and its `dms_ai.views.conflicts` texts are gone.

### Q50. What replaces the Overview's status card?

**Decision.** Two DMS blocks fed by two routes drawn from `GET /ai/status`:

- A `Banner` on `/ai/status/banner`, which answers the most pressing state only. Offline is an error, with a "Restart assistant" button running `POST /ai/sidecar/restart`, and no button when the sidecar is disabled. A failed last turn is an error with its message and a link to Activity. Waiting requests are a warning with a composed count. Otherwise it answers 204.
- A `Card` "Assistant" with a Settings link, holding a three-column `KeyValueList` on `/ai/status/facts` with the state as a status pill (with "2 waiting for you" or "1 conversation working" composed beside it), the agent, the default scope as a pill (green Safe, amber Code), the approval mode, the Builder as a pill, and the sidecar's address with a copy button (`dms#180`). Offline, it shows only the state and a stopped sidecar.

`DmsAiStatusCard`, `useStatusFacts`, the 10-second poll and the `dms_ai.views.status` texts are gone. Two accepted losses go with them. The "Open assistant" and "Review N approvals" buttons go, because the header launcher and ⌘⇧K open the panel, where approvals are answered, and a link cannot open a side panel. The live poll goes too. The blocks read their routes on load and on every page refresh. The backend publishes no realtime topic for the status, and polling the sidecar to publish one would be glue.

### Q51. Can the skill cards be the `TableView`'s own card?

The built-in card of the cards display (`card.fields`, `labelKey`) draws the label, the row id and each field through its column's data type formatter.

**Decision.** No, `DmsAiSkillCard` stays, plugged into the `TableView` as its `card.component`. The built-in card does not apply a column's `display` and does not hand the row to the formatter (`CardsDisplay` calls `formatter.default(value, locale, options)` on the column's own type). The tone pills of `dms#181` (`StatusPillDisplay` with `toneField`, `PillsDisplay` items) only reach table cells. On a card the source would be a bare label, the tags an unrendered list, and a shadowed skill would look like the copy used. It also cannot dim an ignored copy or show the description. Revisit when the cards display renders fields through the column renderer. While the custom cards load, their placeholders hold `card.skeletonHeight: "250px"` (`dms#354`), the height of a real card at 1440 px, so the footer does not move on a client navigation.

### Q52. How do the row drawers open, and what do they draw with?

**Decision.** The Activity and Skill drawers open from the right (`direction: "right"`, a 440 px side sheet, `dms#188`), like the mockup's slideover. The direction is one constant of the pages. The Skill drawer reads a SKILL.md as a document, so it opens at the `3xl` size (768 px, capped to the window, the whole screen on a phone), its running text kept to 76ch. In `DmsAiActivityDetail` the output and the raw JSON are `DmsCodeSnippet`s (text, wrapped, 14 lines, and JSON, 20 lines) with their language label and copy button. The "Allowed" and "Result" facts are a `DmsKeyValueList` with its value slot, and each argument row copies the whole value (`copyValue`) while showing it cut short. The Skill drawer uses the DMS row header (`rowTitle: "{name}"`, "Skill 8 of 35", previous and next), so its body draws no title or stepper of its own. `DmsAiSkillDetail` lists the source (a pill), the full name and origin (copy), the uses and the last use as `DmsFieldRow`s in the form layout. Values are left-aligned like a record drawer's fields (a label column from a 560 px drawer, the label above the value on a phone). The change set panel of Changes shows its four facts in a two-column `DmsKeyValueList` too, so the module's own `FactStrip` is gone. The diff view and the rendered SKILL.md stay custom, because no DMS component draws a diff or Markdown.

### Q53. Is the Changes page still cramped next to the docked panel?

**Decision.** No. `DmsMasterDetail` now lays out from its own width (`dms#183`). With the assistant docked, the list stacks above the selected change set instead of squeezing both side by side. Nothing changes in the module.

### Q54. What stays custom, and why?

**Decision.** On the pages, four components stay, each where no block draws the screen:

- `DmsAiChangesView`, the change set list, the diff and the Undo preview with conflicts, on `DmsMasterDetail` (Q16).
- `DmsAiActivityDetail` and `DmsAiSkillDetail`, the content of the DMS row drawers (decision trail, diff, rendered SKILL.md).
- `DmsAiSkillCard`, the card of the Skills `TableView` (Q51).

The panel (`DmsAiChatPanel`, a DMS side panel) and the palette's answer (`DmsAiPaletteAnswer`) are the assistant itself. The backend registration test pins this list.

---

## 12. Follow-up after `dms` 0.7.21

Inputs are `dms` 0.7.21, `interface-dms` 0.5.13 and `dms-frontend` 0.5.5, with `download` action targets (`dms#246`), table views without the built-in grid (`dms#255`), `useConfirmFrom` (`dms#232`), header buttons hidden by availability (`dms#237`), visible query param filters (`dms#228`), `showRow` in row containers (`dms#252`) and public endpoints (`dms#230`).

### Q55. Which of them replace module code?

**Decision.**

- Activity's "Export CSV" is a `download` target. The file is fetched with the user's session, so the owner-only `/ai/activity/export.csv` answers it, rather than a link the browser opens without one.
- Skills offers the cards display only (`tableDisplay: false`), as Q18 decided. The grid and the display switcher are gone.
- Undo on the Changes page asks the dialog that `/ai/changes/{id}/undo-confirm` words, through `useConfirmFrom`. That is the dialog the Overview's Undo already asks. It undoes from inside, with its "Also undo the later change sets" field. The module's `UndoDialog`, its undo plan helpers, their test and the `dms_ai.views.undo` texts are gone.

The others fit nothing here. No link opens Activity on a filter. The row drawers link to no other row of their table (the Skills drawer names the copy a shadowed skill yields to, which is not a link). No header button depends on the request. The sidecar reaches the backend directly, not through the frontend server's proxy.

### Q56. Does the playground still load `dms-builder`?

**Decision.** No. At the time, `dms-builder` 0.2.6, its latest release, accepted `@antelopejs/dms-frontend` below 0.4.0 only, so the dashboard could not build with it. The Builder is optional to `dms-ai` (`@antelopejs/interface-dms-builder` is an optional dependency, and every Builder feature is gated on its presence), so the playground runs without it until a release supports `dms-frontend` 0.5.

### Q57. What happens to the code kept for older installs?

Nothing has shipped on the redesign, and every store is reset with it.

**Decision.** It goes:

- The deprecated `hostOrigin` config key and its warning.
- The sidecar's pre-v2 `/metrics/top-skills` route.
- The pid-only codex registry format, and the pid fallback for an app-server that does not lead its group.
- The `allowedBy` read off an old permission record.
- The settings defaults for clients that omitted a field.
- In the chat, the defaults for a permission request or question missing redesign fields, the tool row state read from a bare `status`, and the stored `auto` mode.

The sidecar and the chat ship in one package, so the chat reads the sidecar's events as they are.
