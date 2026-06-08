# Staging Deployment Runbook

Use this runbook when deploying WiseEff to a staging environment that is intended to resemble production.

## Prerequisites

- Staging `DATABASE_URL`.
- Production-mode auth values: `AUTH_MODE=production`, `AUTH_TOKEN_ISSUER`, `AUTH_TOKEN_HMAC_SECRET`.
- Object storage configuration. Use `OBJECT_STORE_MODE=s3` for production-like staging; local object storage is acceptable only for explicitly local validation.
- M6.3 self-hosted object storage profile with `OBJECT_STORAGE_TLS_POLICY`, `OBJECT_STORAGE_PATH_STYLE`, `OBJECT_STORAGE_HEALTH_PREFIX`, backup targets, and isolated restore targets.
- Worker process configured separately from the API process.
- Agent provider configuration if testing live provider behavior.
- HDC target values if collecting real device-lab evidence.
- Admin bearer token for `M5_SMOKE_AUTHORIZATION` or `WISEEFF_SMOKE_AUTHORIZATION`.

## Deploy Order

1. Confirm the target commit and migration list.
2. Take or verify a pre-deploy backup.
3. Run `npm ci`.
4. Run `npm run contract:check`.
5. Run database migrations against staging.
6. Start or deploy the API process.
7. Start or deploy the worker process.
8. Deploy the frontend with `VITE_WISEEFF_RUNTIME_MODE=api`.
9. Configure object storage, Agent provider, and device gateway.
10. Run restore target safety and backup/restore drill checks if this staging candidate is intended to produce target evidence.
11. Run smoke checks.

## Smoke Checks

```bash
npm run contract:check
npm run smoke:m5
```

For full staging acceptance, also run:

```bash
npm run restore:drill
npm run backup:drill
npm run backup:check
npm run test:e2e
```

The smoke must probe a live API unless the run is explicitly a local documentation run. Do not use `M5_SMOKE_ALLOW_NO_API=true` for staging evidence.

## Acceptance

Staging is acceptable only when:

- `/health/live` returns success.
- `/health/ready` reports configured dependencies as ready or gives actionable blocked reasons.
- `/api/v1/operations/pilot-readiness` is reachable by an admin token and returns an honest status.
- Object storage can write/read/delete through the configured seam.
- Backup/restore evidence names isolated restore targets and passes `npm run backup:check`.
- Worker jobs can progress to terminal states.
- Agent provider readiness is recorded if live provider is in scope.
- HDC evidence is recorded if real-device signoff is in scope.

## Evidence

Record:

- commit SHA,
- deployed environment,
- commands run,
- timestamps,
- pass/fail status,
- skipped checks and reasons,
- links or excerpts for logs and readiness JSON.
