---
name: dms-ai
description: Sets up and troubleshoots @antelopejs/dms-ai, the AI development assistant of the AntelopeJS DMS (chat panel, sidecar running Claude Code or Codex, change sets with undo, audit log and skills pages under /modules/ai). Use when installing or configuring dms-ai (backendUrl, DMS_AI, providers, Codex), when the assistant is offline, or when a module must ship skills to it through antelopeJs.skills.
icon: i-lucide-sparkles
category: ai
tags: [ai, assistant, sidecar, claude-code, codex, skills]
---

# dms-ai

An owner-only development assistant. The backend starts a sidecar (child process, `127.0.0.1` only) that runs the agent in the project folder; the browser reaches it only through the DMS frontend server. User docs: https://dms.antelopejs.com/docs/modules/ai (source: `docs/` of this package).

## Setup

- `ajs project modules add @antelopejs/dms-ai`; config `backendUrl: "${@api.API_LOCAL_BASE_URL}"`.
- Version 0.3+ needs `@antelopejs/dms` 0.9 (`interface-dms` 0.7) and `@antelopejs/dms-frontend` 0.6; 0.2 is the DMS 0.8 line. The frontend server proxies `/ai/**` to the backend with the session (`backendProxies`).
- Load `@antelopejs/dms-builder` too: chats then default to Safe mode (Builder tools only, typechecked writes). Code mode allows file edits and commands under the approval mode.
- Claude Code is the default provider. Codex needs `@openai/codex` at the exact version in `peerDependencies` and `OPENAI_API_KEY`; a provider that cannot run fails the turn, never falls back.

## Skills

The sidecar loads every directory a loaded module declares in `package.json` `antelopeJs.skills` (and `~/.claude/skills` when Settings allow it). Ship a module's skill as `skills/<name>/SKILL.md` with `name`, `description`, `icon`, `category`, `tags: [a, b]` frontmatter, add `skills` to `files`. Two skills with one name: one is Shadowed.

## Gotchas

- Refuses to run with `NODE_ENV=production`; `DMS_AI=0` starts the backend without the sidecar.
- Offline assistant: Restart on the Overview; lists and settings answer `503` while the sidecar is down.
- Remote over plain HTTP: start the frontend with `DMS_COOKIE_SECURE=false`.
- Deleting pages, tables, fields or queries asks in every mode, Full auto included.
- Undo is limited to the checkpoint retention (7, 30 or 90 days).
