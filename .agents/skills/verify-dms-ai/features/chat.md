---
covers:
  - frontend-vue/dms.frontend.ts
  - frontend-vue/app/plugins/**
  - frontend-vue/app/runtime/**
  - frontend-vue/app/chat/**
  - frontend-vue/app/components/**
  - frontend-vue/i18n/**
  - src/channels/**
  - src/routes/channels.ts
  - src/routes/sidecar-info.ts
  - sidecar/src/agent/**
  - sidecar/src/mcp/**
  - sidecar/src/prompts/**
  - sidecar/src/providers/claude/**
  - sidecar/src/providers/registry.ts
  - sidecar/src/providers/types.ts
  - sidecar/src/protocol/**
  - sidecar/src/server/chat-events.ts
  - sidecar/src/server/chat-socket-registry.ts
  - sidecar/src/server/conversation-runs.ts
  - sidecar/src/server/host-command-router.ts
  - sidecar/src/server/host-socket-registry.ts
  - sidecar/src/server/live-turns.ts
  - sidecar/src/server/navigation-completer.ts
  - sidecar/src/server/pending-queue.ts
  - sidecar/src/server/permission-events.ts
  - sidecar/src/server/raw-data.ts
  - sidecar/src/server/safety-net.ts
  - sidecar/src/server/tool-calls.ts
  - sidecar/src/server/turn-progress.ts
  - sidecar/src/server/turn-registry.ts
  - sidecar/src/server/turns.ts
  - sidecar/src/server/ws.ts
  - sidecar/src/state/conversations.ts
  - sidecar/src/state/host-state.ts
  - sidecar/src/state/store.ts
  - sidecar/src/state/types.ts
  - sidecar/src/state/safe-segment.ts
  - sidecar/src/builder/**
  - sidecar/src/database/**
  - sidecar/src/pages/**
  - sidecar/src/logs/**
  - sidecar/src/host/**
  - sidecar/src/constants/**
docs:
  - docs/4.usage/1.chat.md
  - docs/7.preview-constraints.md
  - docs/1.introduction.md
---

# Chat

The chat panel, the agent loop, the tools, approvals, change-set cards, block previews and the command palette. All of it needs a development dashboard (`import.meta.env.DEV`) and a model; `dms-control` runs a production dashboard and no run holds credentials. The one thing driven is the documented absence: a production dashboard shows no assistant.

## Sub-features

- `a-production-dashboard-shows-no-assistant`: no launcher, no panel, no starters, no palette assistant on a production build.

## How to get to it (user POV)

- The sparkle Assistant button of the header or `Ctrl` `Shift` `K`, in the development dashboard only.

## Driving it with dms-control

```bash
dms-control journey "$RUN" chat
```

## Gotchas

- Issue draft `dms-control-dev-frontend`: `dms-control up` has no development-frontend mode, so the panel cannot be opened.
- Everything else in this feature is under the skill's Not driven list.
