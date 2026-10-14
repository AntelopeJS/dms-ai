# @antelopejs/dms-ai

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

An AntelopeJS DMS development assistant. It adds an owner-only AI workspace to the dashboard: a
chat panel docked next to the page (`Ctrl` `Shift` `K`) and an **Assistant** module with its
Overview, Changes, Activity, Skills and Settings. A coding agent (Claude Code by default, or OpenAI's
Codex) runs in a local sidecar, reads the loaded modules and their skills, edits the project through
the Builder or in code, and saves every turn as a change set you can undo.

**Documentation:** [dms.antelopejs.com/docs/modules/ai](https://dms.antelopejs.com/docs/modules/ai)
(source in [`docs/`](./docs)).

## Installation

Add the module to a project that already uses `@antelopejs/dms` 0.9 (`@antelopejs/interface-dms` 0.7)
and `@antelopejs/dms-frontend` 0.6:

```bash
ajs project modules add @antelopejs/dms-ai
```

Set `backendUrl: "${@api.API_LOCAL_BASE_URL}"` in the module's config, and add
`@antelopejs/dms-builder` for Safe mode. The assistant is a development tool: the backend and the
sidecar refuse to run with `NODE_ENV=production`, and `DMS_AI=0` disables the sidecar. See the
[configuration](https://dms.antelopejs.com/docs/modules/ai/configuration) for agent providers,
Codex, safe mode and remote access.

The package ships Claude Code skills (`skills/dms-ai`, `dms-builder-safe`, `dms-builder-page`),
declared in `antelopeJs.skills` and loaded into the assistant's agent.

## Vue frontend

The module registers `frontend-vue` through `AddFrontendModule` with the Vue 3 renderer. The host DMS
supplies authentication, shared state, Nuxt UI and the icons. The chat panel, `DmsAiChatPanel`, is a
docked side panel of the dashboard (`registerSidePanel`): the DMS renders it once for the whole app,
so it lives through Inertia navigations, and keeps its open state and width in a cookie. The command
palette's assistant mode answers with `DmsAiPaletteAnswer` (`registerCommandPaletteAssistant`). The
chat's code is under `frontend-vue/app/chat`. The renderer bundles the icons it finds in
`.vue` files, so an icon name belongs in the component that shows it.

## Development

Install dependencies and run the backend, sidecar and dashboard checks from the repository root:

```bash
pnpm install
pnpm --dir frontend-vue install
pnpm build
pnpm build:sidecar
pnpm test
```

Build and typecheck the Vue source against a generated Inertia workspace that includes this module. Set `DMS_FRONTEND_WORKSPACE` to that workspace's absolute path, then run:

```bash
pnpm --dir frontend-vue build
pnpm --dir frontend-vue typecheck
```

`pnpm test:node` runs every backend suite below in one go, after a single build (`DMS_PREBUILT=1` skips the build when `dist/` is already fresh, as in CI). The sidecar's opt-in Codex acceptance suite runs on its own with `CODEX_ACCEPTANCE=1 pnpm --dir sidecar test:acceptance`.

`pnpm test:frontend-registration` checks backend registration and sidecar inputs with the sidecar launcher mocked, and that every page, block and child of the Assistant module is titled with `$dms_ai` keys present in both locales.
`pnpm test:routes` drives the `/ai/*` routes against a stand-in sidecar: query translation, `503` while it is down, settings conversions, Undo stamping and the CSV export.
`pnpm test:sidecar-lifecycle` starts a stand-in sidecar to check that a hot reload keeps it, a restart replaces it, a sidecar left by an earlier run is stopped, and Ctrl+C on the backend stops it.
