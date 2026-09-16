# @antelopejs/dms-ai

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

An AntelopeJS DMS development assistant. It adds an owner-only AI workspace to the dashboard and
runs Claude Code in a local sidecar that can inspect the loaded modules and their declared skills,
edit the host project, and stream activity back to the dashboard.

## Installation

Add the module to a project that already uses `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-ai
```

The module starts its bundled sidecar with the project as its working directory. In development,
set `DMS_AI=0` before starting the backend to disable the sidecar. If
`@antelopejs/dms-builder` is installed, the assistant also exposes its builder integration.

## Vue frontend

The module registers `frontend-vue` through `AddFrontendModule` with the Vue 3 renderer. The host DMS supplies authentication and shared state.

## Development

Install dependencies and run the backend and sidecar checks from the repository root:

```bash
pnpm install
pnpm build
pnpm test
```

Build and typecheck the Vue source against a generated Inertia workspace that includes this module. Set `DMS_FRONTEND_WORKSPACE` to that workspace's absolute path, then run:

```bash
pnpm --dir frontend-vue build
pnpm --dir frontend-vue typecheck
```

`pnpm test:frontend-registration` checks backend registration and sidecar inputs with the sidecar launcher mocked.
