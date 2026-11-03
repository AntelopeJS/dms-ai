---
covers:
  - src/routes/settings.ts
  - src/sidecar/settings-values.ts
  - src/pages/settings/**
  - sidecar/src/state/settings-store.ts
  - sidecar/src/state/settings-types.ts
  - sidecar/src/constants/settings.ts
docs:
  - docs/4.usage/6.settings.md
---

# Settings

The Settings page holds the defaults of new conversations. Each change saves as it is made and survives a restart.

## Sub-features

- `the-defaults-are-the-documented-ones`: a new install answers the documented defaults and says what the install can do.
- `every-setting-saves-alone-and-survives-a-restart`: each field saves on its own and survives a sidecar restart and a backend restart.
- `a-value-outside-the-options-is-refused-and-changes-nothing`: a value outside the options answers 400, nothing changes, an unknown field is ignored and the deletions switch cannot be turned off.
- `the-page-saves-each-change-as-you-make-it`: a choice, a switch and a menu save at once and a reload shows them kept.
- `the-page-disables-what-this-machine-cannot-do`: Codex, Full auto and Safe mode are disabled with their reason, and deletions are locked on.
- `usage-counts-nothing-before-a-conversation`: the Usage section counts zero before any turn ran.

## How to get to it (user POV)

- Modules › Assistant › Settings.

## Driving it with dms-control

```bash
dms-control journey "$RUN" settings
```

## Gotchas

- The settings live in the sidecar's folder, not in the database, so each journey starts by clearing that folder (`freshSidecar`).
