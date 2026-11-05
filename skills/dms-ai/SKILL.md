---
name: dms-ai
description: Sets up and troubleshoots @antelopejs/dms-ai, the AI assistant of the AntelopeJS DMS (Builder and Analyst modes, chat panel, sidecar running Claude Code or Codex, change sets with undo, audit log and skills pages under /modules/ai). Use when installing or configuring dms-ai (backendUrl, DMS_AI, providers, Codex), when the assistant is offline, or when a module must ship skills to it through antelopeJs.skills.
icon: i-lucide-sparkles
category: ai
tags: [ai, assistant, sidecar, claude-code, codex, skills]
---

# dms-ai

An AI assistant with two modes per conversation: Builder (owners, development only) edits the project; Analyst (any user holding the `ai.assistant` permission, development and production) answers questions about the data, reading it only through the DMS's own table routes as that user. The backend starts a sidecar (child process, `127.0.0.1` only) that runs the agent in the project folder; the browser reaches it only through the DMS frontend server. User docs: https://dms.antelopejs.com/docs/modules/ai (source: `docs/` of this package).

## Setup

- `ajs project modules add @antelopejs/dms-ai`; config `backendUrl: "${@api.API_LOCAL_BASE_URL}"`.
- The frontend server proxies `/ai/**` to the backend with the session (`backendProxies`). See the package README for requirements.
- Load `@antelopejs/dms-builder` too: chats then default to Safe mode (Builder tools only, typechecked writes). Code mode allows file edits and commands under the approval mode.
- Claude Code is the default provider. Codex needs `@openai/codex` at the exact version in `peerDependencies` and a ChatGPT sign-in (Assistant › Settings; on a remote DMS the 127.0.0.1 return page fails to load and its address is pasted with **Paste the return address**; stored per user in `~/.config/dms-ai/chatgpt-auth.json`, `OPENAI_API_KEY` is ignored); a provider that cannot run fails the turn, never falls back.

## Skills

The sidecar loads every directory a loaded module declares in `package.json` `antelopeJs.skills` (and `~/.claude/skills` when Settings allow it). Ship a module's skill as `skills/<name>/SKILL.md` with `name`, `description`, `icon`, `category`, `tags: [a, b]` frontmatter, add `skills` to `files`. Two skills with one name: one is Shadowed.

## Gotchas

- In production (a built project) only Analyst runs and the sidecar refuses Builder; `DMS_AI=0` starts the backend without the sidecar.
- Overview and Activity open with the DMS `PageToolbar` (period only, no live: "updated" + refresh); their selectors share `rememberKey: "ai"`. The Overview offers previous period / previous year / none in a menu (`comparisonControl: "menu"`); its KPI, series, allowed and top-tools routes forward `compareFrom` / `compareTo` (absent under none); the top lists carry a per-row `delta`. `/ai/activity` filters on the `from` / `to` the table sends; the CSV export ignores them.
- Offline assistant: Restart on the Overview; lists and settings answer `503` while the sidecar is down.
- Remote over plain HTTP: start the frontend with `DMS_COOKIE_SECURE=false`.
- Deleting pages, tables, fields or queries asks in every mode, Auto review included. So does a database mapping that would remove a page, and so does every edit of a git hook file (anything inside a `.git` directory, `.husky/*`, a lefthook config file, `.pre-commit-config.yaml`), whatever the dependencies toggle says. With Codex, the sandbox is read-only in every mode, so every write asks, and the card for such a file offers no rule.
- Claude Code defaults to Auto review (a safety check approves routine file edits and web access); every shell command, scheduled task and tool it does not know still asks the person, and so does every edit of `package.json`, a lockfile, `pnpm-workspace.yaml`, `.npmrc`, `.pnpmfile.cjs`, `.yarnrc`, `.yarnrc.yml` or `bunfig.toml` unless the person turned off the dependency approval. Codex defaults to Ask first and has no Auto review. Ask first asks before every command, read-only ones included, and before any change outside the Builder. Accept edits applies file edits unasked, except dependency and git hook files, and asks before every command; with Codex it works as Ask first, asking before every file edit and any command that writes.
- Undo is limited to the checkpoint retention (7, 30 or 90 days).
