# dms-ai

An AntelopeJS DMS development assistant: an owner-only AI workspace in the
dashboard, backed by a local sidecar supporting Claude Code and optional Codex.
The Codex CLI must match the exact `@openai/codex` pin in `package.json`:
the sidecar ships that version's app-server protocol types. See
`sidecar/src/constants/providers.ts` for availability requirements; an unavailable
provider reports an error rather than silently falling back to another provider.

## Code conventions

- Write code, identifiers, and comments in English.
- Use pnpm for package management and repository scripts.
- Follow the repository's lint and formatting configuration.
- Prefer the smallest change that solves the task; generalize for an existing need.
- Keep functions focused. Extract helpers when they clarify a responsibility, not just to meet a line count.
- Explain non-obvious constraints and decisions in comments; avoid restating the code. Document public contracts with TSDoc.
- Use objects, maps, or arrays instead of `switch/case`.
- Use named interfaces or types instead of anonymous object types.
- Give non-obvious values named constants.
- Prefer early returns to deeply nested branches, and reuse existing logic rather than duplicating it.
- Name identifiers for their role; use boolean names such as `isActive` or `shouldRefresh`.
- In index files, prefer `export * from './module'` over named re-exports.
