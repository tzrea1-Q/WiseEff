# Secrets Management

> Chinese: [Chinese](../zh-CN/security/secrets-management.md)

Secrets should be supplied by local `.env` files or the target environment's secret manager.

## Never Commit

- Real `DATABASE_URL` credentials.
- Real OIDC client secrets, admin recovery passwords, and target bearer tokens.
- Non-local `AUTH_TOKEN_HMAC_SECRET`; HMAC is local smoke/test only after M6.2.
- Object-store access keys.
- Redis credentials or queue connection URLs for target environments.
- S3 signed URLs or raw provider error payloads that include signed headers.
- Database URLs that include restore or backup passwords.
- Agent provider API keys.
- HDC lab credentials or customer device identifiers.
- Admin smoke tokens for real environments.

## Local Development

`.env.example` contains a local non-HDC staging profile. It intentionally leaves:

```text
AGENT_API_BASE_URL=
AGENT_MODEL=
AGENT_API_KEY=
```

blank. Fill `AGENT_MODEL` and `AGENT_API_KEY` only in `.env` for the default Pi-backed provider. Fill `AGENT_API_BASE_URL` only when using URL-backed `wiseeff` or `openai` live provider formats.

Pi Agent smoke and readiness evidence must redact `AGENT_API_KEY`, Authorization headers, raw prompts, raw provider payloads, and customer data. It is acceptable to record safe metadata such as provider format, Pi provider id, model id, prompt version, readiness status, token counts, estimated cost, latency, trace id, and approval id.

Local `.env.example` defaults to WiseEff local accounts and also includes a deterministic HMAC smoke token for explicit local non-HDC acceptance runs without Keycloak. Target self-hosted environments that require SSO/MFA should use `AUTH_PROVIDER=oidc` with operator-managed issuer/audience values and must keep real OIDC tokens out of committed evidence.

## Rotation

Rotate secrets when:

- a key is exposed in logs, chat, screenshots, or docs,
- a team member leaves the pilot,
- staging/prod environment ownership changes,
- provider or object-store policy changes,
- a security review requests rotation.

## Review Checklist

- `.env` and `.env.*` remain ignored.
- New docs do not include real secrets.
- Smoke tokens in committed docs are local examples only.
- Target OIDC access tokens, refresh tokens, client secrets, and JWKS override credentials are redacted.
- Target-environment evidence is redacted before commit.
- `npm run observability:check` passes after changing Prometheus config, alert rules, or Grafana dashboards.
- Metrics labels, dashboard links, and alert annotations do not contain bearer tokens, provider keys, object-store keys, raw uploaded logs, raw parameter values, or raw device payloads.
- `docs/generated/m6-backup-restore-evidence.*` contains summaries only; verify it has no object-store keys, signed URLs, bearer tokens, or database passwords before committing.
