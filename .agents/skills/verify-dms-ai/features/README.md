# Feature map

One file per feature. `covers:` lists the source globs it owns, `docs:` the pages a verdict judges, `journeys/<feature>.mjs` its journeys and `seeded-breaks/<feature>.patch` the break its journeys must catch. `dms-control map` checks that every user-facing file is covered and that every feature has its journeys, its seeded break and existing docs pages.

| Feature | What the user does | Journeys |
|---|---|---|
| [smoke](smoke.md) | The fixed journey every verdict runs: open the Overview, read the status, change a default. | smoke |
| [lifecycle](lifecycle.md) | The backend starts the sidecar, reports its status, restarts it, gives up after repeated crashes, and starts none with `DMS_AI=0`. | the-status-reads-ready-and-names-the-sidecar, a-restart-gives-a-new-sidecar-and-keeps-what-you-set, a-sidecar-that-keeps-dying-gives-up-and-the-banner-offers-a-restart, dms-ai-0-starts-the-backend-without-a-sidecar, a-backend-that-crashed-leaves-no-sidecar-for-long |
| [access](access.md) | Every route answers the owner; the sidecar calls its own routes with its own token; the dashboard forwards `/ai/**`. | every-owner-route-refuses-nobody-and-a-member, the-sidecar-routes-answer-only-the-sidecar, the-dashboard-origin-forwards-ai-with-the-session |
| [settings](settings.md) | The defaults of new conversations, saved as they are made. | the-defaults-are-the-documented-ones, every-setting-saves-alone-and-survives-a-restart, a-stored-settings-file-is-read-back-by-the-next-start, a-value-outside-the-options-is-refused-and-changes-nothing, the-page-saves-each-change-as-you-make-it, the-page-disables-what-this-machine-cannot-do, usage-counts-nothing-before-a-conversation |
| [skills](skills.md) | The skills loaded into the agent, where each comes from and which names clash. | the-catalog-lists-what-modules-ship, a-module-skill-shadows-a-local-skill-of-the-same-name, two-skills-of-one-module-with-one-name-shadow-one-copy, machine-local-skills-need-their-switch, the-page-shows-cards-tabs-search-and-the-reading-panel |
| [overview](overview.md) | The status, four key figures, the chart, recent change sets and top tools over a period. | an-unused-assistant-reads-zero-everywhere, the-period-and-the-comparison-are-remembered-and-shared-with-activity |
| [activity](activity.md) | The audit log of every tool call, its tabs, periods and export. | an-empty-log-says-so-and-exports-its-header, the-log-says-when-the-assistant-is-down |
| [changes](changes.md) | Change sets with their diff, Undo and Redo. | no-change-set-yet-says-so, the-changes-say-when-the-assistant-is-down |
| [codex](codex.md) | The ChatGPT sign-in that Codex runs on. | signed-out-the-banner-offers-the-sign-in-and-the-paste, a-pasted-address-is-checked-before-anything-is-stored |
| [chat](chat.md) | The chat panel, the agent and its tools; a production dashboard shows none of it. | a-production-dashboard-shows-no-assistant |
| [package](package.md) | What a project installs, and the skills the module declares. | the-tarball-holds-what-the-manifest-names, the-docs-name-every-skill-the-module-ships |

The smoke journey runs on every verdict.
