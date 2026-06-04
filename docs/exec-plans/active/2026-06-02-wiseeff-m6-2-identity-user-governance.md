# WiseEff M6.2 Identity And User Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development`: write the failing test first, verify it fails, implement the smallest change, then verify green.

**Goal:** Replace the pilot HMAC production-auth boundary with self-hosted OIDC identity and durable backend user/role governance.

**Architecture:** Keycloak or another OIDC-compliant self-hosted identity provider becomes the production identity issuer while local development keeps deterministic auth paths for tests. WiseEff validates JWTs through OIDC discovery/JWKS, then resolves the effective `AuthContext` from WiseEff PostgreSQL user and role tables so backend user-governance changes control active state and authorization. User/role mutations move from prototype-local state to backend APIs with authorization, validation, transactions, and audit evidence.

**Tech Stack:** Keycloak/OIDC, JWT/JWKS validation, TypeScript API auth module, PostgreSQL migrations, React auth provider, Playwright acceptance, Vitest, WiseEff audit and policy modules.

---

## Reference Basis

- Keycloak OIDC securing-apps docs: https://www.keycloak.org/securing-apps/oidc-layers
- Keycloak server administration docs: https://www.keycloak.org/docs/latest/server_admin/

## Scope Boundary

M6.2 includes:

- Self-hosted OIDC configuration guidance, with Keycloak as the default reference provider.
- Production JWT verification through issuer, audience, expiration, signature, and identity claim validation; effective authorization remains database-backed in WiseEff.
- Backend user and role management APIs with project/organization scoping.
- Audit events for user creation, activation/deactivation, role assignment, role removal, and self-lockout prevention.
- Frontend API-mode login/logout/token refresh wiring or documented reverse-proxy/session handoff if the final flow uses an OIDC sidecar.
- Browser acceptance updates for login/runtime auth and Admin user governance.
- TD-020 and TD-021 closure only after target-environment evidence proves the new identity path.

M6.2 excludes:

- Multi-IdP federation beyond one OIDC provider.
- SCIM lifecycle automation.
- Customer-specific HR directory synchronization.
- Fine-grained policy-as-code engines outside the existing WiseEff role model.
- Redis durable queue and object-store backup work.

## Role And Permission Rules

The implementation must preserve the documented WiseEff roles:

- `Guest`
- `Hardware User`
- `Software User`
- `Hardware Committer`
- `Software Committer`
- `Admin`

Role inclusion rules must remain enforced in both UI visibility and API authorization:

- `Hardware Committer` includes all `Hardware User` permissions.
- `Software Committer` includes all `Hardware User` permissions.
- `Software User` includes all `Hardware User` permissions.
- Users without eligible permissions must be hidden from affected frontend selection controls and rejected at the API boundary.

## Dependencies And Ordering

- M6.1 should provide the self-hosted runtime baseline first.
- M6.2 may add Keycloak to the self-hosted profile, but it must not make local `npm run dev:all` depend on Keycloak.
- Existing HMAC smoke auth can remain for local smoke only if production mode requires OIDC by default after M6.2.
- Any changed auth-driven UI behavior must update browser acceptance IDs and operation IDs before completion.

## Success Criteria

- Production auth uses OIDC/JWKS validation, not static HMAC bearer injection.
- `/api/v1/me` returns the same WiseEff `AuthContext` shape after OIDC identity verification and WiseEff DB user/role lookup.
- Expired, wrong-audience, wrong-issuer, unsigned, malformed-role, and unknown-user tokens are rejected with consistent API errors.
- Admin can create/update/deactivate users and assign roles through backend APIs.
- Non-Admin users cannot call user-management mutation APIs.
- The active Admin cannot disable itself or remove its last Admin capability.
- User governance mutations write audit records in the same transaction as durable state changes.
- `PERM-USER-MGMT-001` upgrades from UI-only evidence to UI + API + DB + audit evidence.
- TD-020 and TD-021 are updated or closed with evidence.

## Expected File Structure

Create:

- `server/modules/auth/oidcVerifier.ts`: OIDC discovery/JWKS token verification adapter.
- `server/modules/auth/oidcVerifier.test.ts`: token verification and failure-mode tests.
- `server/modules/users/`: backend user-governance module with repository, service, routes, schemas, and tests.
- `server/migrations/0011_m6_user_governance.sql`: durable user-governance tables or indexes if the current schema is insufficient.
- `src/infrastructure/auth/oidcAuthProvider.ts`: frontend token lifecycle boundary if browser-managed login is selected.
- `src/infrastructure/auth/oidcAuthProvider.test.ts`: token lifecycle tests.
- `e2e/acceptance/identity-governance.acceptance.spec.ts`: OIDC/runtime and backend user-governance acceptance coverage if existing specs cannot be extended cleanly.
- `docs/runbooks/identity-provider.md`: Keycloak/OIDC setup and incident runbook.

Modify:

- `server/modules/auth/tokenVerifier.ts`
- `server/modules/auth/routes.ts`
- `server/modules/policy.ts`
- `server/contextFactory.ts`
- `server/index.ts`
- `src/infrastructure/http/apiClient.ts`
- `src/application/ports/auth` or nearest existing auth port files.
- `src/pages/UserPermissionsPage.tsx` or the current user-permissions page component.
- `e2e/acceptance/permissions.acceptance.spec.ts`
- `e2e/acceptance/permissions-matrix.acceptance.spec.ts`
- `e2e/acceptance/auth-runtime.acceptance.spec.ts`
- `e2e/acceptance/operationMatrix.ts`
- `docs/developer/browser-acceptance-coverage-map.md`
- `docs/developer/user-operation-coverage-matrix.md`
- `docs/SECURITY.md`
- `docs/api/authentication.md`
- `docs/security/audit-retention.md`
- `docs/developer/environment-variables.md`
- `.env.example`
- `ops/self-hosted/.env.example` if M6.1 has landed.

## Implementation Tasks

### Task 1: OIDC Verifier Contract

- [x] Write failing tests in `server/modules/auth/oidcVerifier.test.ts` for valid token, expired token, wrong issuer, wrong audience, missing roles, and JWKS key rotation.
- [x] Add an OIDC verifier interface that returns the existing `AuthContext` fields.
- [x] Implement issuer discovery, JWKS caching, audience validation, and role claim mapping.
- [x] Keep HMAC verifier available only for development/test or explicitly named local smoke mode.
- [x] Run `npm run test:server -- server/modules/auth/oidcVerifier.test.ts`.

### Task 2: Backend User Governance API

- [x] Write failing route/service tests for Admin create user, Admin role update, Admin deactivate user, non-Admin mutation rejection, and self-lockout rejection.
- [x] Add database migration for any missing durable user-governance fields.
- [x] Implement service methods with transaction boundaries and server-side role eligibility validation.
- [x] Add audit writes for every mutation.
- [x] Add API routes under the existing versioned API namespace.
- [x] Run focused server tests for `auth`, `users`, `policy`, and `audit`.

### Task 3: Frontend Auth Runtime

- [x] Write failing tests for token injection, refresh failure, logout, and unauthorized UI state.
- [x] Implement the selected frontend OIDC runtime boundary.
- [x] Ensure local mock mode and deterministic browser tests still work without a live Keycloak instance.
- [x] Ensure API-mode production builds do not silently fall back to static local bearer tokens.
- [x] Run `npm test -- src/infrastructure/auth src/infrastructure/http`.

### Task 4: User Governance UI And Acceptance

- [x] Update user-management UI to call backend APIs for create/update/deactivate/role changes.
- [x] Hide ineligible users from assignment controls and continue rejecting forced invalid assignments at the API boundary.
- [x] Update operation matrix for `PERM-USER-MGMT-001` assertion types to include `api`, `db`, and `audit`.
- [x] Add or update acceptance coverage for `AUTH-RUNTIME-001`, `PERM-GOV-001`, `PERM-MATRIX-001`, `PERM-MATRIX-002`, `PERM-USER-MGMT-001`, and `PARAM-ASSIGNEE-002`.
- [x] Run `npm run acceptance:coverage`, `npm run acceptance:operations`, and `npm run acceptance:browser`.

### Task 5: Self-Hosted Keycloak Runbook

- [x] Add `docs/runbooks/identity-provider.md` with realm, client, redirect URI, role mapper, user provisioning, token lifetime, backup, and emergency admin recovery procedures.
- [x] Add self-hosted env variables for OIDC issuer, audience, and optional JWKS override settings.
- [x] Document how to rotate signing keys without downtime.
- [x] Update Chinese security/runtime docs.

### Task 6: Verification And Debt Closure

- [x] Run `npm run docs:check`.
- [x] Run `npm run contract:check`.
- [x] Run `npm run test:all`.
- [x] Run `npm run build`.
- [x] Run `npm run acceptance:coverage`.
- [x] Run `npm run acceptance:operations`.
- [x] Run `npm run acceptance:browser`.
- [x] Run `npm run acceptance:evidence`.
- [x] Run `git diff --check`.
- [x] Update `docs/exec-plans/tech-debt-tracker.md`: narrow TD-020 and TD-021 while keeping them open until target OIDC and full browser/evidence gates exist.

## Verification Results

Local non-HDC M6.2 implementation evidence was captured on 2026-06-02 from branch `codex/m6-2-identity-user-governance`:

- `npm run docs:check`: passed.
- `npm run contract:check`: passed.
- `npm run test:all`: passed with 198 frontend test files / 1826 tests and 65 server test files / 551 tests.
- `npm run build`: passed; the existing Vite chunk-size warning remains non-blocking.
- `npm run acceptance:coverage`: passed with no missing required IDs.
- `npm run acceptance:operations`: passed with no missing automated operation IDs.
- `npm run acceptance:browser`: passed in `local-non-hdc` mode with 33 passed and 1 HDC-only skipped Playwright acceptance case.
- `npm run acceptance:evidence`: passed; `PERM-USER-MGMT-001` includes `ui`, `api`, `db`, and `audit` evidence.
- `git diff --check`: passed.

Target-environment OIDC evidence is still required before TD-020 can close: real self-hosted issuer discovery/JWKS, real browser token acquisition/refresh/logout, `/api/v1/me` with target OIDC access tokens, issuer/audience/expiry negative checks, and redacted target smoke evidence.

M6.2 target evidence gate added on 2026-06-03: `npm run identity:check` writes `docs/generated/m6-identity-evidence.md` and verifies target OIDC discovery/JWKS, Admin `/api/v1/me`, wrong-issuer rejection, wrong-audience rejection, expired-token rejection, and browser-runtime evidence status. This makes the target OIDC closure repeatable, but it does not close TD-020/TD-021 until it is run against a real self-hosted IdP/API target with redacted evidence and browser runtime proof.

On 2026-06-04, `npm run identity:local-oidc-drill` was added and passed against the local PostgreSQL-backed API. The drill starts a temporary local OIDC discovery/JWKS service, signs RS256 Admin/wrong-issuer/wrong-audience/expired tokens, runs the WiseEff API in OIDC production-auth mode, proves `/api/v1/me` resolves the OIDC subject to the database-backed `u-xu-yun` Admin context, proves issuer/audience/expiry negative checks, and proves the browser OIDC token-provider refresh/logout boundary. It writes `docs/generated/m6-local-oidc-identity-evidence.md` with `Status: passed` for this local drill while leaving `docs/generated/m6-identity-evidence.md` reserved for target `identity:check` output. This is stronger than local HMAC smoke and closes the local OIDC implementation evidence gap, but it is not a real Keycloak or deployed target evidence record. The plan remains active until target Keycloak/OIDC evidence, target browser token acquisition/refresh/logout evidence, and target user-governance acceptance evidence are archived.

## External Inputs Needed

- Preferred self-hosted identity provider. Default plan assumes Keycloak.
- Production domain and redirect URLs.
- Realm/client naming convention.
- Token lifetime and refresh policy.
- Initial Admin recovery procedure.
- Whether roles are managed only in WiseEff, only in Keycloak, or mirrored between the two. Recommended M6.2 default: Keycloak authenticates identity; WiseEff remains the source of truth for project-scoped authorization.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/runbooks/README.md`, `AGENTS.md` | Add identity provider runbook and backend user module route if durable. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` | Track M6.2 and TD-020/TD-021 status. |
| Product specs | Review | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Update only if user-management workflow semantics change. |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/api-contract.md` | Document OIDC, user-governance APIs, and auth context mapping. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add OIDC/user-governance gates and browser acceptance IDs. |
| Reliability/runbooks | Update | `docs/runbooks/identity-provider.md`, `docs/RELIABILITY.md`, `docs/runbooks/manual-acceptance.md` | Add identity outage, token rotation, and admin recovery procedures. |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/security/threat-model.md`, `docs/security/secrets-management.md`, `docs/security/audit-retention.md`, `docs/api/authentication.md` | OIDC and durable role governance are security-critical. |
| Frontend/design docs | Update | `docs/FRONTEND.md` | Document frontend auth runtime and API token handling. |
| Generated artifacts | Review | `docs/generated/acceptance-operation-evidence.md`, `docs/generated/acceptance-operation-evidence/index.json` | Regenerate evidence after acceptance changes. |
| References | Review | `docs/references/` | Add identity reference only if agent handoffs need compact auth notes. |
| Chinese developer docs | Update | `docs/zh-CN/security-reliability.md`, `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/frontend.md` | OIDC and user-governance changes are developer-facing. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to `docs/exec-plans/completed/`.
- Security, API auth, and Chinese docs must be updated in the same branch as the implementation.
- If Keycloak target evidence is not available, TD-020 must remain open with the exact missing evidence.
- If durable user mutations ship without browser operation evidence, the plan cannot be marked complete.

## UI Interaction Automation Review

M6.2 changes user-facing auth and user-governance behavior.

- Affected acceptance specs: `e2e/acceptance/auth-runtime.acceptance.spec.ts`, `e2e/acceptance/permissions.acceptance.spec.ts`, `e2e/acceptance/permissions-matrix.acceptance.spec.ts`, and parameter assignment specs if role eligibility changes.
- Acceptance requirement IDs: `AUTH-RUNTIME-001`, `PERM-GOV-001`, `PERM-MATRIX-001`, `PERM-MATRIX-002`, `PARAM-ASSIGNEE-002`, `PARAM-ASSIGNEE-003`.
- Operation IDs: `AUTH-RUNTIME-001`, `PERM-GOV-001`, `PERM-MATRIX-001`, `PERM-MATRIX-002`, `PERM-USER-MGMT-001`, `PARAM-ASSIGNEE-002`, `PARAM-ASSIGNEE-003`.
- Required update: `PERM-USER-MGMT-001` must gain backend API/DB/audit evidence or remain explicitly documented as not complete.
- Required commands: `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:browser`, and `npm run acceptance:evidence`.
