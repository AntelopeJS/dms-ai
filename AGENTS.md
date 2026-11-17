# dms-ai

An AntelopeJS DMS development assistant: an owner-only AI workspace in the dashboard, backed by a local sidecar supporting Claude Code and optional Codex. It is published as `@antelopejs/dms-ai`.

## Layout

| Path           | What it is                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `src`          | The DMS module (CommonJS, built to `dist`)                                                              |
| `sidecar`      | The local agent process, an ESM workspace package with its own lockfile and tsconfig; ships as `sidecar/dist` |
| `frontend-vue` | The dashboard layer. ESLint and Prettier own it, not oxlint and oxfmt                                   |
| `playground`   | A DMS project that loads the module; its own lockfile, outside the pnpm workspace                       |
| `skills`       | Agent skills shipped in the npm package through `antelopeJs.skills`                                     |

The root `package.json` is the published CommonJS package, so it has no `"type": "module"`. Node therefore warns that it reparses `oxlint.config.ts` as ESM; the warning is harmless.

## Versioning

- The Codex CLI must match the exact `@openai/codex` pin in `package.json`: the sidecar ships that version's app-server protocol types, generated into `sidecar/src/providers/codex/protocol` by `pnpm --dir sidecar generate:codex-types`.
- `frontend-vue/package.json` pins the supported `@antelopejs/dms-frontend` minor in `engines`.
- See `sidecar/src/constants/providers.ts` for provider availability. An unavailable provider reports an error rather than falling back to another provider.

## Tests

`pnpm test`, and so `pnpm run checks`, runs `pnpm test:node`: it builds `dist` once and runs every `tests/*.test.cjs` suite except `sidecar-build.test.cjs` against it. Run the tests on the Node version in `.nvmrc`: under Node 26, 51 frontend-vue tests fail.

`checks` does not run:

- The Vitest suites, which run in their own CI job: `pnpm --dir sidecar test` and `pnpm --dir frontend-vue test`.
- `pnpm test:sidecar-smoke`, which builds the sidecar and checks its output.
- The Codex acceptance suite: `CODEX_ACCEPTANCE=1 pnpm --dir sidecar test:acceptance`.
- The full frontend-vue typecheck, which needs a generated DMS frontend workspace: `DMS_FRONTEND_WORKSPACE=<path> pnpm --dir frontend-vue typecheck`. `checks` typechecks only the chat (`typecheck:chat`).

## CI

Branch protection requires the `ubuntu` check. In `.github/workflows/ci.yml` it is the job that fails when `checks` (the shared `ci-node.yml`) or the `vitest` matrix fails, so keep its name.

## Releases

The release commit writes `CHANGELOG.md`. Upgrade notes for that version follow in a separate `docs(changelog)` pull request.

## Orb

`.agents/setup` belongs to the guardrail pack. The AntelopeJS CLI and MongoDB install and the playground build live in `.agents/playground`, which the `dms-backend` service runs before it starts.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, run only the fast check for what you touched:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- One test file, not the suite. In a module that tests with `ajs module test`: `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`.

Prove a change works with the verification skill in [`.agents/skills/verify-dms-ai/SKILL.md`](.agents/skills/verify-dms-ai/SKILL.md) before you call it done.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
