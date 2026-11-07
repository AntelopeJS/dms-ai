---
covers:
  - src/routes/actor.ts
  - src/routes/index.ts
  - src/routes/sidecar-auth.ts
  - src/routes/mcp.ts
  - src/mcp-bridge.ts
  - sidecar/src/server/project-mcp-route.ts
  - src/constants/mcp.ts
  - src/lifecycle/project-mcp.ts
  - sidecar/src/mcp/project-endpoint.ts
  - sidecar/src/server/http.ts
  - src/routes/sidecar-answers.ts
  - src/routes/logs.ts
  - src/routes/pages-registry.ts
  - src/routes/builder.ts
  - src/routes/database.ts
  - src/pages-registry.ts
  - src/logging/**
  - src/builder/**
  - src/database/**
  - src/sidecar/**
  - sidecar/src/server/client-auth.ts
docs:
  - docs/5.extending.md
  - docs/3.configuration.md
---

# Access

Every route of the module answers the owner. The sidecar calls its own routes with a token only it holds, and the dashboard's server forwards `/ai/**` to the backend.

## Sub-features

- `every-owner-route-refuses-nobody-and-a-member`: 401 without a session, 403 to a member, the owner let in, nothing changed by the refusals.
- `the-sidecar-routes-answer-only-the-sidecar`: logs, pages registry, Builder and database routes refuse anyone but the holder of the sidecar's token; health needs no sign-in.
- `the-project-mcp-route-serves-only-a-local-caller-holding-the-start-credential`: `POST /ai/mcp`, the route an outside Claude Code session reaches the project's tools on. A request with a forwarding header (`X-Forwarded-For`, `Forwarded`, or relayed by the dashboard's origin) gets 403 even with the right bearer; no bearer, a wrong bearer (also of the right length), the token without `Bearer`, another scheme and the owner's session token get 401; the bearer published in the sidecar's `mcp.json` (mode 0600) gets the project's tools without the two that exist only in the dashboard chat, a notification gets 202 and a message that is not JSON-RPC gets 400. The sidecar's own `/mcp/project` takes only its client credential.
- `the-dashboard-origin-forwards-ai-with-the-session`: the dashboard's origin forwards `/ai/**` with the session.

## How to get to it (user POV)

- Any page of the Assistant; the routes are the ones the pages call.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- The sidecar's token is read from the lock file the sidecar publishes, as the backend does.
- The bridge's bearer is read from `mcp.json` in the sidecar's folder, as the bridge launcher does. The bridge process itself (`src/mcp-bridge.ts`) is run by an outside Claude Code session and is not driven; the journey sends the same request it would.
- `GET /ai/channel/events` is a stream: the owner sweep only reads its refusals and skips it for the owner.
