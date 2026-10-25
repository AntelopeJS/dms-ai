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

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
