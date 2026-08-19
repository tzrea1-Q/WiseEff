# Local evaluation auth hardening

> Status: **Active**
> Date: 2026-08-19
> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-19-local-eval-auth-hardening.md`](../../zh-CN/exec-plans/active/2026-08-19-local-eval-auth-hardening.md)

## Goal

Harden WiseEff-owned local accounts for **internal evaluation / self-hosted trial** without building enterprise identity (email, invitations, MFA, OIDC evidence).

Ship four product gaps:

1. Self-service password change and Admin password reset, revoking other sessions.
2. A server-enforced self-registration switch; the auth screen hides Register when off.
3. Login/register rate limiting plus failed-login audit.
4. Auth-screen copy: evaluation-org join, username rules, role help, confirm password, and a bootstrap hint when no Admin exists.

## Non-goals

Email verification, invitation links (TD-119), MFA, target OIDC evidence (TD-020), HttpOnly cookie/CSRF/refresh rotation, mail-based forgot-password.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Commit on `cursor/local-eval-auth-hardening-5336` checked out from latest `main` |
| Parent agent | Review, verify, open/merge the PR |

One branch: `cursor/local-eval-auth-hardening-5336`.

## Architecture

- Keep `AUTH_PROVIDER=local` as the first-party provider. New env:
  - `AUTH_LOCAL_SELF_REGISTER` (default `true`)
  - `AUTH_LOCAL_AUTH_MAX_ATTEMPTS` (default `10`)
  - `AUTH_LOCAL_AUTH_WINDOW_MS` (default `60000`)
- Public unauthenticated `GET /api/v1/auth/local-config` tells the UI whether self-register is on, whether a local Admin exists, and the evaluation organization display name.
- `POST /api/v1/me/password` verifies the current password, updates the scrypt hash, revokes other sessions, keeps the current session.
- `POST /api/v1/users/:userId/password` requires `users:manage`, sets a new password, revokes every session for that user.
- In-process sliding-window limiter keyed by client IP + username (and IP-only for register). Multi-replica is accepted for eval (same limit as other in-process gates).
- Failed login writes `auth-event` / `login-failed` (actor may be null when the username is unknown; organization is the evaluation org when resolvable).
- New error code `RATE_LIMITED` → HTTP 429.

## Files

- Backend: `server/config/env.ts`, `server/shared/http/{errors,router,server}.ts`, `server/modules/auth/*`, `server/modules/users/*`, `server/app.ts`, `server/modules/contracts/*`
- Frontend: `src/infrastructure/http/{authClient,userGovernanceClient,presentError,userErrorMessage}.ts`, `src/app/appRuntime.ts`, `src/App.tsx`, `src/UserPermissionsPage.tsx`, `src/styles.css`, `src/domain/audit/auditSlugLabels.ts`
- Docs: authentication, FRONTEND, SECURITY, environment-variables, onboarding, self-hosted runbook, errors, coverage maps (EN + zh)

## Tasks

- [x] Plan + acceptance IDs
- [x] Backend: config, limiter, password change/reset, session revoke, failed-login audit, local-config
- [x] Frontend: auth screen, profile password change, Admin reset
- [x] Docs + OpenAPI
- [ ] Tests, `npm run build`, `npm run docs:check`

## Verification

- Targeted vitest: auth/users/env/App/UserPermissionsPage/presentError
- `npm run test:server` (narrow if the full suite is too slow: auth + users + env + contracts)
- `npm run build`, `npm run docs:check`, `npm run contract:check`
- playwright-cli viewports 1440×900 / 768×1024 / 390×844 on the auth screen and `/organization/members`

## UI interaction automation

New IDs (component-tested; browser e2e planned because shared acceptance still injects smoke HMAC, not the local login form):

| ID | Coverage |
| --- | --- |
| `AUTH-LOCAL-PASSWORD-001` | App.test + backend |
| `AUTH-LOCAL-ADMIN-RESET-001` | UserPermissionsPage.test + backend |
| `AUTH-LOCAL-SELF-REGISTER-001` | App.test + backend |
| `AUTH-LOCAL-BOOTSTRAP-HINT-001` | App.test |

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `ARCHITECTURE.md` + zh — no new top-level module |
| Planning | Update | This plan + zh; `docs/PLANS.md` + zh |
| Product specs | Update | `docs/product-specs/new-user-onboarding.md` + zh |
| Domain / glossary | No change | CONTEXT.md / ADR-0037 unchanged |
| Design docs | Review | organization-administration design — no department-as-tenant reopen |
| API | Update | `docs/api/authentication.md` + zh; `docs/api/errors.md` + zh; OpenAPI |
| Frontend | Update | `docs/FRONTEND.md` + zh |
| Security | Update | `docs/SECURITY.md` + zh |
| Reliability / runbooks | Update | `docs/runbooks/self-hosted-runtime.md` + zh |
| Developer env | Update | `docs/developer/environment-variables.md` + zh; `.env.example`; self-hosted env examples |
| Quality / acceptance | Update | coverage map + operation matrix EN/zh; `requirements.ts` |
| Generated artifacts | Update | `docs/generated/openapi.json` |
| References | No change | `docs/references/` |
| Tech debt | Review | TD-119 stays later; no new TD |

## Documentation Update Gate

This plan cannot move to `completed/` until every Update/Review row is updated or recorded unchanged, `npm run docs:check` passes, and the new IDs have component tests or an honest planned marker.
