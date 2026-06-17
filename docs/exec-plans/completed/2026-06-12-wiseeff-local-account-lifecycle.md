# WiseEff Local Account Lifecycle

## Goal

Fill the current product gaps for a first-party WiseEff account lifecycle while keeping the existing OIDC/HMAC identity boundary intact:

- Local registration without email verification for now.
- Local login and logout.
- Authenticated current-user lookup through the existing `/api/v1/me` shape.
- Current-user profile viewing and editing.
- Browser UI for login, registration, profile editing, and logout.
- Username-based login/registration with fixed organization choices and platform role selection.

## Assumptions

- Email verification is intentionally out of scope for this implementation.
- Target enterprise production can continue using OIDC. Local account sessions are a WiseEff-owned identity provider option, not a replacement for OIDC in hardened self-hosted deployments.
- Self-registration uses username instead of email as the login identifier, limits organization selection to localized hardware/software department values, and stores the selected platform role as the account's role binding.
- Local accounts do not store or return email addresses; username is the local login identifier.
- Passwords are stored only as salted `scrypt` hashes. Plaintext passwords, session tokens, and reset secrets are never persisted.

## Architecture

- Add `AUTH_PROVIDER=local` as a production-mode provider option.
- Add `user_password_credentials` and `auth_sessions` tables, including a unique local username credential.
- Resolve Bearer session tokens through WiseEff PostgreSQL when `AUTH_PROVIDER=local`.
- Add auth routes for register, login, logout, and current-user profile updates.
- Keep user-governance routes admin-scoped. Current-user profile updates belong under auth routes, not the admin governance API.
- Add frontend auth client methods and a local token store backed by `localStorage`.
- In API runtime, show an auth screen until `/api/v1/me` succeeds or a user logs in/registers.

## Files

- Backend: `server/modules/auth/*`, `server/app.ts`, `server/config/env.ts`, `server/migrations/*`
- Contracts: `server/modules/contracts/routeManifest.ts`, `server/modules/contracts/schemaRegistry.ts`
- Frontend: `src/infrastructure/http/authClient.ts`, `src/infrastructure/http/defaultApiClient.ts`, `src/App.tsx`, `src/styles.css`
- Docs: `docs/api/authentication.md`, `docs/zh-CN/api/authentication.md`, `docs/FRONTEND.md`, `docs/zh-CN/frontend.md`, `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md`, `docs/developer/environment-variables.md`, `docs/zh-CN/developer/environment-variables.md`

## Tasks

- [x] Add local account persistence, password hashing, session creation, and current-user profile service.
- [x] Register local auth API routes and token resolution while preserving OIDC/HMAC behavior.
- [x] Extend OpenAPI route metadata.
- [x] Add frontend login/register/profile/logout flow.
- [x] Add username-based login/registration, registration organization dropdown, and platform role dropdown.
- [x] Update English and Chinese docs.
- [x] Verify with focused tests, build, docs check, and browser checks.
- [x] Re-verify username/role/organization update with focused tests, build, docs check, contract check, and browser checks.
- [x] Remove local-account internal email compatibility fields and re-verify that local accounts store, return, and display username without synthetic email.
- [x] Block self-service Admin registration and require Admin approval before local accounts receive Hardware/Software Committer roles.

## Committer Registration Approval Increment

### Goal

Self-service registration must never create Admin accounts. Users may request Hardware/Software Committer roles during registration, but the backend grants only the matching base User role until an Admin approves the pending request from the user governance page.

### Architecture

- Add a durable `local_registration_role_requests` table for role-upgrade requests created by local registration.
- Keep registration responsive by creating an active local account with a safe assigned role:
  - `hardware-committer` request grants `hardware-user` immediately and records a pending `hardware-committer` request.
  - `software-committer` request grants `software-user` immediately and records a pending `software-committer` request.
  - `guest`, `hardware-user`, and `software-user` continue to register directly.
  - `admin` is rejected server-side and omitted from the registration UI.
- Add Admin-only user governance endpoints to list, approve, and reject pending registration role requests.
- Add an Admin page queue for pending registration role requests, wired to the API-mode user governance client while keeping mock mode stable.

### Files

- Create: `server/migrations/0015_local_registration_role_requests.sql`
- Modify: `server/modules/auth/localAuth.ts`, `server/modules/auth/routes.ts`, `server/modules/auth/localAuth.test.ts`, `server/modules/auth/routes.test.ts`
- Modify: `server/modules/users/repository.ts`, `server/modules/users/service.ts`, `server/modules/users/routes.ts`, `server/modules/users/types.ts`, `server/modules/users/schemas.ts`, `server/modules/users/service.test.ts`, `server/modules/users/routes.test.ts`
- Modify: `server/modules/contracts/routeManifest.ts`, `server/modules/contracts/schemaRegistry.ts`, `server/modules/contracts/openapi.test.ts`, `docs/generated/openapi.json`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `src/UserPermissionsPage.tsx`, `src/UserPermissionsPage.test.tsx`, `src/infrastructure/http/userGovernanceClient.ts`, `src/infrastructure/http/userGovernanceClient.test.ts`
- Modify docs as required by the Documentation Impact Matrix.

### Tasks

- [x] Write failing backend tests for Admin self-registration rejection and pending committer role requests.
- [x] Add the role-request migration and local auth implementation.
- [x] Write failing user-governance tests for listing, approving, and rejecting pending registration role requests.
- [x] Implement user-governance repository, service, and route endpoints with audit evidence.
- [x] Update route manifest, schema registry, and OpenAPI artifact.
- [x] Write failing frontend tests for no Admin registration option and the Admin approval queue.
- [x] Implement frontend role filtering, API client methods, and Admin page approval queue.
- [x] Update docs and generated artifacts.
- [x] Verify with targeted tests, build, contract, docs, diff check, and browser checks.

## Verification

- `npm test -- server/shared/http/router.test.ts server/app.test.ts server/modules/auth server/config/env.test.ts server/config/envExample.test.ts server/modules/contracts/openapi.test.ts src/infrastructure/http/authClient.test.ts src/App.test.tsx` passed on 2026-06-12.
- `npm run build` passed on 2026-06-12.
- `npm run contract:openapi && npm run contract:check` passed on 2026-06-12 after regenerating `docs/generated/openapi.json`.
- `npm run docs:check` passed on 2026-06-12.
- Browser verification passed on 2026-06-12 with local API `AUTH_PROVIDER=local` at `http://127.0.0.1:8788` and frontend `http://127.0.0.1:5174/parameter-home`.
- Username/organization/role increment: `npm test -- server/modules/auth src/infrastructure/http/authClient.test.ts src/App.test.tsx` passed on 2026-06-12.
- Username/organization/role increment: `npm test -- server/shared/http/router.test.ts server/app.test.ts server/modules/auth server/config/env.test.ts server/config/envExample.test.ts server/modules/contracts/openapi.test.ts src/infrastructure/http/authClient.test.ts src/App.test.tsx` passed on 2026-06-12.
- Username/organization/role increment: `npm run build` passed on 2026-06-12.
- Username/organization/role increment: `npm run contract:openapi && npm run contract:check` passed on 2026-06-12.
- Username/organization/role increment: `npm run docs:check` passed on 2026-06-12.
- Username/organization/role browser verification passed on 2026-06-12 with local API `AUTH_PROVIDER=local` at `http://127.0.0.1:8788` and frontend `http://127.0.0.1:5174/parameter-home`. Checked desktop `1440x900`, tablet `768x1024`, and mobile `390x844`; screenshots saved under `work/ui-checks/auth-*-username-*.png`.
- Clean local-account email removal: `DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff npm run db:migrate` applied `0014_local_accounts_remove_internal_email.sql` on 2026-06-12.
- Clean local-account email removal: database check returned `localAccountsWithEmail: 0` and `emailShapedUsernames: 0` on 2026-06-12.
- Clean local-account email removal: `npm test -- server/shared/http/router.test.ts server/app.test.ts server/modules/auth server/modules/users server/config/env.test.ts server/config/envExample.test.ts server/modules/contracts/openapi.test.ts src/infrastructure/http/authClient.test.ts src/infrastructure/http/userGovernanceClient.test.ts src/App.test.tsx src/UserPermissionsPage.test.tsx src/reducer.userPermissions.test.ts src/appReducer.parameterAdmin.test.ts` passed on 2026-06-12.
- Clean local-account email removal: `npm run build`, `npm run contract:openapi && npm run contract:check`, `npm run docs:check`, and `git diff --check` passed on 2026-06-12.
- Clean local-account email removal browser verification passed on 2026-06-12 with local API `AUTH_PROVIDER=local` at `http://127.0.0.1:8788` and frontend `http://127.0.0.1:5174/parameter-home`. Verified login request body was `{"username":"clean.user.862444","password":"strong-password"}`, `/api/v1/me` returned `username` without `email`, profile/menu displayed `clean.user.862444`, and screenshots were saved under `work/ui-checks/auth-clean-email-*.png`.
- Committer registration approval: `DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff npm run db:migrate` applied `0016_stable_local_registration_organizations.sql` on 2026-06-12.
- Committer registration approval: focused backend tests passed on 2026-06-12 for Admin self-registration rejection, pending Committer role-request creation, Admin-wide request listing, approval/rejection audit, stable local registration organization ids, and organization-wide local role debug-project access.
- Committer registration approval: browser QA found and fixed a post-registration debug API 403 caused by organization-wide non-admin role bindings being treated as no project access.
- Committer registration approval: browser QA found and fixed tablet/mobile approval queue wrapping where role labels became vertical and decision buttons overflowed.
- Committer registration approval browser verification passed on 2026-06-12 with local API `AUTH_PROVIDER=local` at `http://127.0.0.1:8788` and frontend `http://127.0.0.1:5174`. Checked desktop `1440x900`, tablet `768x1024`, and mobile `390x844`; screenshots saved under `work/ui-checks/registration-approval-*.png`.

## Documentation Impact Matrix

| Area | Status | Files |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md` |
| Planning docs | Update | `docs/PLANS.md`, this plan |
| Product specs | Updated | `docs/product-specs/new-user-onboarding.md`, `docs/zh-CN/product-specs/new-user-onboarding.md` |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` |
| API docs | Updated | `docs/api/authentication.md`, `docs/zh-CN/api/authentication.md` |
| Security/governance docs | Updated | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md` |
| Frontend/design docs | Updated | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/README.md` |
| Quality/testing docs | Review | `docs/developer/verification-matrix.md` |
| Generated artifacts | Updated | `docs/generated/` |
| References | Review | `docs/references/` |

## Documentation Update Gate

- [x] English and Chinese API authentication docs updated.
- [x] English and Chinese frontend docs updated.
- [x] English and Chinese security docs updated.
- [x] Environment-variable docs updated if new env options are introduced.
- [x] `npm run docs:check` passes or any blocker is recorded.

## UI Interaction Coverage

- Affected behavior: unauthenticated API-mode entry, login form, register form, profile edit modal, logout.
- Existing requirement coverage: `AUTH-RUNTIME-001` covers API-mode auth parity but not local account forms.
- Action: focused component tests and browser verification cover unauthenticated API-mode auth screen, login, registration, profile update, and logout. Acceptance matrix updates may be deferred only if recorded as follow-up.

## Completion Status

Completion decision, 2026-06-17: all tasks, documentation gates, and recorded verification passed on 2026-06-12. Move this plan to `docs/exec-plans/completed/`; deferred acceptance-matrix expansion for local-account forms remains acceptable because component tests and browser verification cover the changed UI behavior.
