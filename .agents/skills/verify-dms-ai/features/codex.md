---
covers:
  - src/routes/codex-account.ts
  - sidecar/src/providers/codex/**
  - sidecar/src/constants/chatgpt.ts
  - sidecar/src/constants/codex.ts
  - sidecar/src/constants/native-binary.ts
docs:
  - docs/3.configuration.md
  - docs/4.usage/6.settings.md
---

# Codex account

Codex runs on a ChatGPT sign-in. OpenAI's consent page and a Codex turn need an account, so only the signed-out half is driven: the banner, the sign-in address, the paste and the sign-out.

## Sub-features

- `signed-out-the-banner-offers-the-sign-in-and-the-paste`: Sign in with ChatGPT toward OpenAI with this sidecar as the return address, Paste the return address, a new attempt per sidecar.
- `a-pasted-address-is-checked-before-anything-is-stored`: a bad or foreign address is refused, and the account stays signed out.

## How to get to it (user POV)

- Modules › Assistant › Settings, the banner at the top.

## Driving it with dms-control

```bash
dms-control journey "$RUN" codex
```

## Gotchas

- Not driven, NOT VERIFIED: consent at OpenAI, the token exchange and refresh, `chatgpt-auth.json` with mode 0600, a Codex turn, the pinned CLI version gate.
