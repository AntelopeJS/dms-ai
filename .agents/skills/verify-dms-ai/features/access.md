---
covers:
  - src/routes/actor.ts
  - src/routes/index.ts
  - src/routes/sidecar-auth.ts
  - src/routes/mcp.ts
  - sidecar/src/server/project-mcp-route.ts
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
- `the-dashboard-origin-forwards-ai-with-the-session`: the dashboard's origin forwards `/ai/**` with the session.

## How to get to it (user POV)

- Any page of the Assistant; the routes are the ones the pages call.

## Driving it with dms-control

```bash
dms-control journey "$RUN" access
```

## Gotchas

- The sidecar's token is read from the lock file the sidecar publishes, as the backend does.
- `GET /ai/channel/events` is a stream: the owner sweep only reads its refusals and skips it for the owner.
