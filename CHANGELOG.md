# Changelog

## v0.1.5

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.1.4...v0.1.5)

### 🚀 Enhancements

- Make the chat a native component of the dashboard ([#37](https://github.com/AntelopeJS/dms-ai/pull/37))

### 🩹 Fixes

- Keep an unchanged sidecar and record turns cut by a restart ([#52](https://github.com/AntelopeJS/dms-ai/pull/52))
- **sidecar:** Release a failed codex start, reap orphan homes and refuse sessions on shutdown ([#53](https://github.com/AntelopeJS/dms-ai/pull/53))
- **sidecar:** Stop the codex app-server's whole process group on POSIX ([#54](https://github.com/AntelopeJS/dms-ai/pull/54))
- Send the page title and resolve the page file for the host context ([#56](https://github.com/AntelopeJS/dms-ai/pull/56))

### 💅 Refactors

- Call the chat `chat` and finish the cms-ai renames ([#55](https://github.com/AntelopeJS/dms-ai/pull/55))

### 🏡 Chore

- **playground:** Open module source ranges ([#51](https://github.com/AntelopeJS/dms-ai/pull/51))
- Deprecate the hostOrigin config option ([#57](https://github.com/AntelopeJS/dms-ai/pull/57))
- **frontend-vue:** Check formatting with Prettier in lint ([5700ed9](https://github.com/AntelopeJS/dms-ai/commit/5700ed9))

### 🎨 Styles

- **frontend-vue:** Format with Prettier ([23d04ae](https://github.com/AntelopeJS/dms-ai/commit/23d04ae))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))

## v0.1.4

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.1.3...v0.1.4)

### 🩹 Fixes

- **settings:** Drop the display-only Model field and the Claude-only wording ([#50](https://github.com/AntelopeJS/dms-ai/pull/50))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.3

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.1.2...v0.1.3)

### 🚀 Enhancements

- Reach the sidecar from any browser through the DMS ([#36](https://github.com/AntelopeJS/dms-ai/pull/36))
- **frontend-vue:** Declare the @antelopejs/dms-frontend releases the layer supports ([#47](https://github.com/AntelopeJS/dms-ai/pull/47))

### 🩹 Fixes

- **deps:** Accept compatible 0.x versions of the interface packages ([#28](https://github.com/AntelopeJS/dms-ai/pull/28))
- **sidecar:** Hold safe mode in every permission mode ([#35](https://github.com/AntelopeJS/dms-ai/pull/35))
- Never leave the chat spinning, and show what a long turn is doing ([#29](https://github.com/AntelopeJS/dms-ai/pull/29))
- **sidecar:** Make shutdown wait for codex app-servers to exit ([#42](https://github.com/AntelopeJS/dms-ai/pull/42))

### 🏡 Chore

- **playground:** Move to @antelopejs/dms-frontend 0.3.2 ([#27](https://github.com/AntelopeJS/dms-ai/pull/27))
- **lint:** Check @antelopejs/interface-* ranges ([#49](https://github.com/AntelopeJS/dms-ai/pull/49))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](http://github.com/alessaloisio))
- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.2

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.1.1...v0.1.2)

### 🩹 Fixes

- **sidecar:** Stop recognising the private package scope ([#23](https://github.com/AntelopeJS/dms-ai/pull/23))
- **deps:** Accept @antelopejs/interface-api 0.0.14 and later 0.x ([#25](https://github.com/AntelopeJS/dms-ai/pull/25))

### 💅 Refactors

- **build:** Merge tsconfig.build.json into tsconfig.json ([#20](https://github.com/AntelopeJS/dms-ai/pull/20))

### 📖 Documentation

- Summarise the 0.1.1 prerelease line in the stable entry ([#18](https://github.com/AntelopeJS/dms-ai/pull/18))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#21](https://github.com/AntelopeJS/dms-ai/pull/21))
- **release:** Reference the shared release workflows through v1 ([#22](https://github.com/AntelopeJS/dms-ai/pull/22))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.1.1-next.0...v0.1.1)

This release promotes the `0.1.1-next` line to stable. It carries everything published in `v0.1.1-next.0`, summarised here and listed in the section below.

### 🚀 Enhancements

- **config:** Let the project tell the sidecar where the backend is: `backendUrl` and `hostOrigin` become optional module config keys, and the launcher now passes them to the sidecar as `--backend-url` and `--host-origin`. The sidecar already parsed both flags but never received them, so it always fell back to `http://localhost:5010` whatever port the api actually bound. With the api module's published `${@api.API_LOCAL_BASE_URL}` as `backendUrl`, the sidecar follows the reserved port. Left unset, the sidecar keeps its standalone defaults, which now live in one place, and the frontend's unused `5010` probe constant is gone ([#16](https://github.com/AntelopeJS/dms-ai/pull/16))

### 🏡 Chore

- Unpin the AntelopeJS prereleases for the stable set ([#17](https://github.com/AntelopeJS/dms-ai/pull/17))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1-next.0

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.1.0...v0.1.1-next.0)

### 🚀 Enhancements

- **config:** Let the project tell the sidecar where the backend is ([#16](https://github.com/AntelopeJS/dms-ai/pull/16))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.0

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.0.6...v0.1.0)

### 🚀 Enhancements

- **ai:** ⚠️  Make the agent provider interchangeable and add Codex ([#14](https://github.com/AntelopeJS/dms-ai/pull/14))

### 🩹 Fixes

- **codex:** Close the follow-ups left by the provider seam ([#15](https://github.com/AntelopeJS/dms-ai/pull/15))

#### ⚠️ Breaking Changes

- **ai:** ⚠️  Make the agent provider interchangeable and add Codex ([#14](https://github.com/AntelopeJS/dms-ai/pull/14))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Glastis ([@Glastis](http://github.com/Glastis))

## v0.0.6

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.0.5...v0.0.6)

### 🩹 Fixes

- **playground:** Build sidecar before startup ([#11](https://github.com/AntelopeJS/dms-ai/pull/11))
- **playground:** Use dms frontend 0.2.1 ([#12](https://github.com/AntelopeJS/dms-ai/pull/12))
- **frontend:** Register the launcher after a client-side sign-in ([#13](https://github.com/AntelopeJS/dms-ai/pull/13))

### 🏡 Chore

- **playground:** Migrate to ajs dms CLI ([#9](https://github.com/AntelopeJS/dms-ai/pull/9))
- Add orb playground setup ([f235f4d](https://github.com/AntelopeJS/dms-ai/commit/f235f4d))
- Add orb playground setup" ([2ec27ff](https://github.com/AntelopeJS/dms-ai/commit/2ec27ff))
- Add orb playground setup ([#10](https://github.com/AntelopeJS/dms-ai/pull/10))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.5

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.0.4...v0.0.5)

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#8](https://github.com/AntelopeJS/dms-ai/pull/8))

### 🏡 Chore

- Require @antelopejs/core 1.7 ([#6](https://github.com/AntelopeJS/dms-ai/pull/6))
- Align community files with the organization defaults ([#7](https://github.com/AntelopeJS/dms-ai/pull/7))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.4

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.0.3...v0.0.4)

## v0.0.3

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.0.2...v0.0.3)

### 🩹 Fixes

- **deps:** Move to zod 4 to satisfy the agent SDK peer ([#3](https://github.com/AntelopeJS/dms-ai/pull/3))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.0.2

[compare changes](https://github.com/AntelopeJS/dms-ai/compare/v0.0.1...v0.0.2)

### 🏡 Chore

- Regenerate lockfiles against the published DMS packages ([#1](https://github.com/AntelopeJS/dms-ai/pull/1))
- **release:** Skip the npm auth pre-flight for trusted publishing ([#2](https://github.com/AntelopeJS/dms-ai/pull/2))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

