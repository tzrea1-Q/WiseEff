# Self-Hosted IP Lab Profile

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-18-self-hosted-ip-lab-profile.md)

**Goal:** Let an operator deploy WiseEff on a basic Ubuntu host that has an IP address and no DNS name, without hand-editing a 100-line ACME env file or guessing how to make seed data visible.

**Architecture:** Add an additive `ip-lab` profile beside the existing M6 DNS/ACME compose stack. Reuse postgres, redis, minio, api, worker, web, and proxy. Select the Caddyfile through `WISEEFF_CADDYFILE`. Generate URL-safe expanded secrets. Default HTTP; optional Caddy `tls internal`. Provision seeds M0–M3 and places the lab admin in `org-chargelab`. Deterministic LLM flags keep `/health/ready` from failing when live keys are absent.

**Tech stack:** Docker Compose, Caddy, bash deploy script (no Node on the server), TypeScript init/preflight/provision helpers and Vitest coverage.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `cursor/selfhost-ip-lab-profile-24de` checked out from latest `main` |
| Implementation agent | Must not push `main`, merge, or rewrite published history |
| Parent / cloud session | Review, open/update the GitHub PR, merge when approved |

Branch: `cursor/selfhost-ip-lab-profile-24de`. One plan → one branch.

## Scope

In scope:

- HTTP-only Caddyfile and optional `tls internal` Caddyfile.
- `.env` generator with expanded `DATABASE_URL` / object-store secrets.
- Preflight checks for the lab profile.
- One-command `deploy-ip-lab.sh` plus Node helpers for machines that already have `npm ci`.
- Seed + attach lab admin to ChargeLab with `admin` and `platform-admin`.
- Operator docs (EN + ZH) and metadata gates.

Out of scope:

- Docker installer for bare Ubuntu.
- Let's Encrypt / public DNS.
- OIDC / Keycloak.
- Backup drill mounts, observability compose services, or pilot-ready claims.
- Seeding the shared `WiseEff-Dev!` demo password on `NODE_ENV=production`.

## Success Criteria

- `./scripts/deploy-ip-lab.sh --ip <addr>` is the documented server path.
- Preflight fails on interpolated secrets, ACME Caddyfile, missing deterministic LLM flags, or `AUTH_PROVIDER!=local`.
- Provision can create a ChargeLab admin after M0 seed already created another admin.
- `npm run selfhost:check` and IP lab unit tests pass.
- Existing DNS/ACME `.env.example` + `Caddyfile.example` path still works.

## Implementation Tasks

- [x] IP lab profile helpers and preflight tests.
- [x] Caddyfiles, env example, compose `WISEEFF_CADDYFILE` mount.
- [x] Provision attach/create ChargeLab admin.
- [x] `deploy-ip-lab.sh`.
- [x] Metadata gate + package scripts.
- [x] Bilingual operator and routing docs.

## Verification

```bash
npm run test:scripts -- ops/self-hosted/scripts/ip-lab-profile.test.ts ops/self-hosted/scripts/check-self-hosted-config.test.ts ops/self-hosted/scripts/provision-ip-lab.test.ts
npm run selfhost:check
npm run docs:check
```

Target Ubuntu evidence is optional and is not required to land the profile.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `README.md`, `docs/README.md` (review), `docs/runbooks/README.md`, `AGENTS.md` (review) | Point IP-only hosts at the lab profile. |
| Planning docs | Update | this plan, `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md` | Active plan + index. |
| Product specs | No change | `docs/product-specs/` | No product workflow change. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/deployment-operations.md` | Record the lab environment. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/developer/environment-variables.md` | New commands and env keys. |
| Reliability/runbooks | Update | `docs/RELIABILITY.md`, `docs/runbooks/self-hosted-runtime.md` | Lab start path. |
| Security/governance docs | Review | `docs/SECURITY.md` | Local accounts already allowed; no new authz model. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | Existing origin fallback still applies. |
| Generated artifacts | No change | | |
| References | No change | | |
| Self-hosted ops | Update | `ops/self-hosted/README.md`, `ops/self-hosted/ip-lab.md` | Operator entry. |
| Chinese developer docs | Update | matching `docs/zh-CN/**` and `*.zh-CN.md` companions | Required bilingual pairs. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan moves to `completed/`.
- Every Update/Review row above is updated in this branch or recorded as unchanged here: `docs/SECURITY.md` and `docs/FRONTEND.md` unchanged because authz and UI behavior did not change; `AGENTS.md` unchanged because routing already points at `ops/self-hosted/`; `docs/README.md` unchanged because the runbook index already covers self-hosted runtime.
- Deferred: real-target Ubuntu smoke evidence (existing TD-022). Docker install automation remains out of scope.

## UI Interaction Automation Review

No user-facing interaction behavior changes. Login, seed visibility, and API origin resolution stay on existing local-account and production origin-fallback paths. No new acceptance requirement or operation IDs.
