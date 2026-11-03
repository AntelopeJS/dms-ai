---
covers:
  - src/index.ts
  - src/config.ts
  - src/frontend-module.ts
  - src/constants/**
  - src/types/**
  - src/vocabulary/**
docs:
  - docs/1.introduction.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: the introduction's first look at the Overview and a default changed.

## Sub-features

- `smoke`: an owner opens the Assistant Overview, reads Ready and Claude Code, changes Thinking to High and sees it kept after a reload.

## How to get to it (user POV)

- Modules › Assistant › Overview, then Settings › Thinking.

## Driving it with dms-control

```bash
dms-control journey "$RUN" smoke
```

## Gotchas

- The chat launcher is not part of the smoke: the dashboard `dms-control` starts is a production build, which never shows it.
