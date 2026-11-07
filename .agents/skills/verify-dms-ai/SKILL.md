---
name: verify-dms-ai
description: "Drive the AntelopeJS dms-ai module (the AI assistant: its sidecar, Overview, Changes, Activity, Skills and Settings pages, the Codex sign-in banner and the owner-only routes) the way the platform owner does, inside a DMS with free ports and its own MongoDB database, and post a verdict with evidence. Use to prove a change to AntelopeJS/dms-ai works before merge, or to verify a PR. A turn with Claude Code or Codex needs credentials a run never holds: that part is NOT VERIFIED, so a verdict is never a plain PASS."
---

# Verify dms-ai

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `journeys/<feature>.mjs`, describe it in its feature file, and run it.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of this repository. Run it with Node 24 after `pnpm install`:

```bash
C="pnpm exec dms-control"
$C                       # lists every command
```

Give `doors` and `--skill` absolute paths. `mongod` comes from `DMS_CONTROL_MONGOD` or `PATH`. A verifier that runs with a temporary `HOME` does not see `~/.cache/mongodb-binaries`: pass the binary in `DMS_CONTROL_MONGOD`.

## What this skill cannot verify

A run holds no `ANTHROPIC_API_KEY`, no Claude Code login and no ChatGPT sign-in, so no model turn runs. These are NOT VERIFIED in every verdict, never PASS: a turn with Claude Code or Codex (the chat, tool calls as they happen, approvals, questions, queued messages, auto-fix turns, token counts a turn reports), block previews, and the ChatGPT consent, token exchange and refresh. The chat panel is also out of reach: it exists in the development dashboard only (`import.meta.env.DEV`) and `dms-control up` builds a production one (AntelopeJS/dms#749). The best result of a verdict is therefore PASS+NOTES.

What a turn leaves behind is not out of reach. The Activity rows, the Overview figures, the change sets with their diffs and Undo and Redo, the skills use counts and the token usage are read from the sidecar's stored conversations, change sets and shadow repository. The journeys write those files (`seed.mjs`, `sample.mjs`), start the assistant on them and drive the pages and routes that read them, so those features are verified.

## Launch

```bash
RUN=$($C up --prepare --base origin/main --skill "$PWD/.agents/skills/verify-dms-ai")
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the builds of the module and of the sidecar, the install of the playground's own dependencies, `playwright-core` into this folder and the TypeScript build of the playground's fixture module. `up` reads the playground (`playground/` in this folder) and starts an isolated DMS:

- the checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied, so the run's build and `.antelope/` are its own;
- the API, the dashboard and the mail sink get free ports from the kernel, and `HOME` is `$RUN/home`;
- a `mongod` the run owns serves `verify_<run>` databases;
- the backend runs `ajs project start -e docs`, the dashboard `ajs dms start -e docs -b <api>`.

The module under verification is a `local` source at the checkout root, and `@antelopejs/dms` comes from the registry, pinned by the playground's lockfile. The fixture module (`playground/src`) serves a member with a role (`POST /verify-ai/member`) and registers a home page and a plain page; it writes the skills the Skills journeys read into `generated-skills/` when it is constructed (a committed `SKILL.md` would be read as a skill of this repository), among them a name shared by two folders and three `SKILL.md` the catalog must skip.

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --base origin/main   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" smoke
$C journey "$RUN" settings [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`) and its journeys; the journeys are in `journeys/<feature>.mjs`, with the helpers in `ai.mjs` (requests, checks, members, the sidecar's folder and lock) and `guard.mjs` (environment loss).
- A journey starts on an empty database with the administrator onboarded. A journey that needs stored records calls `seedStore(ctx, { conversations, settings, build })`: it stops the backend, empties the sidecar's folder, writes `state.json`, `change-sets.json` and `settings.json`, and starts the backend on them. `build` records real change sets through the sidecar's shadow repository (`recordChangeSet`), so Undo and Redo move bytes on disk. `sample.mjs` is the shared sample: 24 calls in the last seven days of every kind (read-only, Builder, approved, rule, Full auto, blocked, denied, expired, failed, stopped), 3 reads ten days ago (the last of them a Skill call) and 2 reads forty days ago, and three change sets. The sidecar keeps its settings in the playground's `node_modules/.cache/dms-ai`, so a journey that depends on them starts with `freshSidecar`, which clears that folder and the run's `~/.claude`. A checkout therefore holds one run at a time.
- `withEnv(ctx, { DMS_AI: "0" }, body)` restarts the backend with that environment and restarts it again without.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`, `sidecar/src/**`, `frontend-vue/**`, `skills/**` and the two `package.json`, tests and tool configs excluded (`verify.config.ts`). `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.** Known findings stay as failing journeys (see Gotchas): they fail a verdict only when the diff touches their feature.
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** None.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. Otherwise PASS+NOTES, with the Not driven list under `notVerified`: the verdict is never a plain PASS here.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>` and, from a thread that did not write the change, `$C publish "$RUN" --pr <n>`.

## Trust

The skill is not Trusted yet. It becomes Trusted when it passes a shadow run of 10 consecutive agent PRs, and its last maintain pass is newer than the last change to the repository or its `@antelopejs` dependencies and at most 30 days old.

## Gotchas

- Every dashboard page renders on the server and hydrates after `load`; `guard.mjs` waits for the sign-in form to hydrate, and `choose` and `clickUntil` click again until a radio, a switch or a dialog responds.
- A step whose check fails because the backend or the dashboard stopped answering ends the journey with a `NOT VERIFIED` error and no failing check.
- The sample holds one more record than every documented limit it drives (5 change sets for the 4 listed, 9 tools for the 5 listed, 29 log records for the 25 of a page, 10,005 for the 10,000 of an export, 61 skills for the 24 of a page, a usage entry on the first day of the 14 and one the day before), so that N and N+1 look different. Add the same when you add a limit.
- The 24 hour, 7 day and 30 day windows are driven with calls 3 hours, 10 days and 40 days old, not at the edge of each window.
- Text the dashboard uppercases (card and section titles) is matched without regard to case.
- Known findings, each a failing journey that fails a verdict only when the diff touches its feature:
  - `skills/two-skills-of-one-module-with-one-name-shadow-one-copy`: two skills of one module with one name are never marked Shadowed (dms-ai#168). A local skill named like a module skill is.
  - `package/the-docs-name-every-skill-the-module-ships`: the README and the Skills page list four skills, the package ships five (dms-ai#169).
  - `activity/the-export-stops-at-10000-rows`: the export holds 200 rows, not the documented 10,000 (draft `dms-ai-activity-export-capped-at-200`). `activity/the-export-holds-what-the-sidecar-lets-through` passes today and pins the 200, so a change of the route's own cap fails it.
  - `overview/the-approved-and-undone-cards-show-their-share`: the cards never show the share the docs promise (draft `dms-ai-overview-kpi-share-not-shown`).
- `an-idle-sidecar-exits-after-15-minutes-and-the-next-probe-starts-it` waits 14 minutes and takes about 17 in all: run it alone, nothing else may use the checkout while it runs.

## Not driven

List these under `notVerified` in the judgement of every verdict:

- every model turn (Claude Code, Codex): no credentials in a run. That covers the chat itself, tool calls as they happen, approvals as they are asked and their rules, Full auto, plan mode, questions, queued messages, auto-fix turns, a diff a turn produces, token counts a turn reports, and the Builder and database catalog tools the agent calls. (Their stored results are driven from seeded records.)
- the chat panel, launcher, shortcuts, palette assistant and block-preview dialog: development dashboard only; `dms-control up` has no mode for it (AntelopeJS/dms#749);
- block previews and custom sketches (`preview_blocks`, the 64 KB and depth limits, the sketch refusals): the agent's tool, reachable only through a turn;
- the ChatGPT consent page, the token exchange and refresh, `chatgpt-auth.json` with a token, the sign-out of a real session and the pinned `codex` CLI version gate: they need an OpenAI account and the optional peer;
- Safe mode and the Builder-backed rows (Builder Connected, Safe mode enabled): the playground does not load `@antelopejs/dms-builder`;
- the Overview banners "The assistant's last turn failed" with Open activity and "N requests are waiting for you": they read a live turn and live approvals;
- the Conversation link of the Changes page, the Open conversation button of the Activity detail, and the reload and toast after Undo: they belong to the chat session;
- `NODE_ENV=production`: the DMS itself changes with it, so the run cannot start the backend that way;
- remote access over a LAN, Tailscale, a tunnel or HTTP/2, and the six-connection browser limit (the refusal of a connection to the network address is driven);
- French strings of the pages (the locale files are checked by the repository's own `check-i18n`).
