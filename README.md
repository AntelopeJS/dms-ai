# @antelopejs/dms-ai

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

An AntelopeJS DMS development assistant. It adds an owner-only AI workspace to the dashboard and
runs a coding agent in a local sidecar that can inspect the loaded modules and their declared skills,
edit the host project, and stream activity back to the dashboard. Claude Code drives it by default;
OpenAI's Codex is selectable once its CLI is installed.

## Installation

Add the module to a project that already uses `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-ai
```

The module starts its bundled sidecar with the project as its working directory. In development,
set `DMS_AI=0` before starting the backend to disable the sidecar. If
`@antelopejs/dms-builder` is installed, the assistant also exposes its builder integration.

## Configuration

Both keys are optional. Left out, the sidecar keeps the defaults it uses when run standalone
(`http://localhost:5010` and `http://localhost:3001`), which is the behaviour every existing project
already has.

| Key          | What it is                                                                     |
| ------------ | ------------------------------------------------------------------------------ |
| `backendUrl` | Origin the sidecar calls the DMS backend on — its pages registry, logs and builder clients. |
| `hostOrigin` | Origin the DMS frontend is served from.                                        |

The api module publishes the origin it actually reserved, so `backendUrl` should reference it rather
than repeat a port that may already be taken:

```typescript [antelope.config.ts]
export default defineConfig({
  modules: {
    "dms-ai": {
      source: { type: "package", package: "@antelopejs/dms-ai" },
      config: {
        backendUrl: "${@api.API_LOCAL_BASE_URL}",
        hostOrigin: "http://localhost:3001",
      },
    },
  },
});
```

`hostOrigin` is the *frontend* origin, which the api module cannot publish: write it out, using the
same value as `dms`'s `clientBaseUrl`.

## Agent providers

The assistant runs on either Claude Code or Codex, picked in the AI settings page. Both go through
the same seam, so the chat, the tool calls, the permission prompts and the file-change animation
behave the same either way. `GET /settings` reports which ones this install can actually drive:

```json
{ "provider": "claude", "providers": { "claude": { "available": true }, "codex": { "available": false, "reason": "Install @openai/codex, at the exact version dms-ai pins, to enable this provider." } } }
```

`claude` is the default *choice*, not a fallback. A provider that this install cannot drive — its
package uninstalled, its API key gone from the environment — fails the turn with that reason in the
chat, and the conversation is never quietly handed to the other backend: someone who picked OpenAI
may have picked it precisely so their code does not reach Anthropic.

Switching provider disposes the live sessions of the previous one — an open conversation loses its
in-agent context, its transcript is kept.

### Enabling Codex

1. **Install the `codex` CLI.** It is an *optional* peer dependency, so it is never installed for
   you: the platform packages weigh ~324 MB unpacked, and only the installs that want Codex should
   pay for them. Use the exact version this module pins, in `peerDependencies["@openai/codex"]`:

   ```bash
   pnpm add @openai/codex@0.154.0
   ```

   The app-server protocol is versioned by binary and OpenAI publishes roughly ten versions a
   month. The sidecar ships protocol types generated from the pinned version and checks
   `codex --version` against it at spawn, refusing to start on a mismatch rather than speaking a
   protocol its types do not describe. The refusal names both versions, so an upgrade says what to
   pin back to. To run a newer binary anyway — at the risk of a protocol its types do not
   describe — set `DMS_AI_CODEX_ALLOW_VERSION_MISMATCH=1`; the drift is then logged once, at startup, instead of
   blocking the provider.

2. **Provide an API key.** Export `OPENAI_API_KEY` in the host process environment. The binary does
   not read that variable itself: the sidecar writes it into an `auth.json` (mode `0600`) inside a
   `CODEX_HOME` dedicated to the conversation. On Windows that mode is not enforced by the
   filesystem, so the file is only as private as the directory it sits in. ChatGPT login is not
   supported here — it shares a token refresh with the user's own `codex` install.

3. **Restart the sidecar**, then pick *OpenAI (Codex)* in the AI settings page.

Linux, macOS and Windows are all supported. One app-server process runs per conversation, and the
sidecar records its pid so a previous run's orphans are killed at startup — through procfs on
Linux, `ps` on macOS and `taskkill /T` on Windows, which is also what takes the sandboxed children
of the app-server with it.

## Vue frontend

The module registers `frontend-vue` through `AddFrontendModule` with the Vue 3 renderer. The host DMS supplies authentication and shared state.

## Development

Install dependencies and run the backend and sidecar checks from the repository root:

```bash
pnpm install
pnpm build
pnpm build:sidecar
pnpm test
```

Build and typecheck the Vue source against a generated Inertia workspace that includes this module. Set `DMS_FRONTEND_WORKSPACE` to that workspace's absolute path, then run:

```bash
pnpm --dir frontend-vue build
pnpm --dir frontend-vue typecheck
```

`pnpm test:frontend-registration` checks backend registration and sidecar inputs with the sidecar launcher mocked.
