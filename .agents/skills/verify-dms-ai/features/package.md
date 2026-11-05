---
covers:
  - package.json
  - sidecar/package.json
  - skills/**
  - frontend-vue/package.json
  - frontend-vue/dms.frontend.build.ts
  - frontend-vue/build/**
docs:
  - docs/5.extending.md
  - docs/2.installation.md
---

# Package

What a project installs: the module with its build, dashboard layer, sidecar and skills, and the skills it declares to the assistant.

## Sub-features

- `the-tarball-holds-what-the-manifest-names`: the packed files, the declared entry points, the skills and the Codex pin.
- `the-docs-name-every-skill-the-module-ships`: the README and the Skills page name every skill folder the package ships. Known finding, see Gotchas.

## How to get to it (user POV)

- `ajs project modules add @antelopejs/dms-ai`.

## Driving it with dms-control

```bash
dms-control journey "$RUN" package
```

## Gotchas

- Known finding: `the-docs-name-every-skill-the-module-ships` fails. `skills/` holds `dms-page-design`, which the README and the Skills page do not name; draft `dms-ai-docs-miss-dms-page-design`.
