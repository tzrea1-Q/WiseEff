# User Account Deletion

> Status: Implementation complete on feature branch; unmerged
> Date: 2026-08-28
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-28-user-account-deletion.md)

## Goal

Let an authorized administrator permanently delete a non-self user from Organization administration while preserving business and audit history. Historical references to the deleted user become `NULL`; account-owned security and transient rows are removed. The server remains the authority for tenant scope, platform-admin protection, self-lockout protection, and durable audit.

## Success Criteria

- `DELETE /api/v1/users/:userId` requires an active caller with `users:manage`, scopes the target to the caller's home Organization, and returns `204` only after a successful transaction.
- The active caller cannot delete itself. An ordinary Admin cannot delete a platform super admin. Deleting a missing or cross-Organization user returns `404` without side effects.
- The user row, role bindings, password credential, auth sessions, pending local registration requests, personal notifications, active device leases, and unsubmitted parameter drafts are removed.
- Durable audit and business rows remain, with every foreign key to the deleted user changed to `NULL` by `ON DELETE SET NULL`.
- A High-severity `user-delete` audit event is committed in the same transaction. It retains the opaque target id and non-secret lifecycle facts, not the deleted user's name, username, email, password, or password hash.
- `/organization/members` exposes a destructive `注销` action for eligible rows, explains irreversibility and reference nulling, waits for the API, removes the row only after success, and keeps the dialog open with a projected server refusal on failure.
- Mock and API modes expose the same visible lifecycle semantics; backend authorization remains authoritative.

## Architecture And TDD Seams

Vertical slices use these public seams:

1. Real PostgreSQL service integration: migrated foreign-key policy, transactional deletion, retained/null historical rows, removed account-owned rows, and durable audit.
2. HTTP API: `DELETE /api/v1/users/:userId` success and authorization/self/cross-Organization failures.
3. Frontend HTTP client: encoded DELETE request and empty `204` handling.
4. Organization members page: eligibility, confirmation copy, awaited success removal, and visible server failure.
5. Browser acceptance: Admin deletion plus non-Admin denial under `PERM-USER-MGMT-001` with UI/API/DB/audit evidence.

Tests are added one vertical slice at a time and observed red before the minimum implementation for that slice.

## Data Retention Policy

| Class | Delete behavior | Examples |
| --- | --- | --- |
| Account-owned security/transient state | `ON DELETE CASCADE` | role bindings, password credentials, auth sessions, registration requests, personal notifications, active device leases, unsubmitted parameter drafts |
| Durable business/audit history | nullable + `ON DELETE SET NULL` | audit actors, submissions/reviews, debug and Agent history, knowledge authorship, feedback, file/config history |

Migration `0117` must convert every foreign key targeting `users(id)` to one of these two explicit policies. A PostgreSQL schema invariant test prevents future `NO ACTION`/`RESTRICT` user references or non-null `SET NULL` columns.

## Expected Files

- `server/migrations/0117_user_account_deletion.sql`
- `server/modules/users/{repository,service,routes}.ts`
- `server/modules/users/*.test.ts` and a PostgreSQL integration test
- `src/infrastructure/http/userGovernanceClient.ts` and tests
- `src/UserPermissionsPage.tsx` and tests
- `src/application/state/*`, reducer tests, and test harness ports as required
- `e2e/acceptance/permissions.acceptance.spec.ts`
- API, security, frontend, product, testing, generated schema/OpenAPI, and bilingual companion docs named below

## Tasks

- [x] Add the failing PostgreSQL schema/behavior test.
- [x] Add migration `0117` and make the PostgreSQL test green.
- [x] Add failing service and route tests for success, non-Admin, self, platform-admin, missing, and cross-Organization cases.
- [x] Implement repository/service/route deletion and transactional audit.
- [x] Add failing frontend client, reducer, and component tests.
- [x] Implement the client and Organization members destructive confirmation flow.
- [x] Extend `PERM-USER-MGMT-001` browser operation evidence.
- [x] Update documentation and generated contracts/schema.
- [x] Run focused tests, full server/frontend gates, build, docs/contracts, and browser verification.
- [ ] Review the final committed diff against `main` with the Standards/Spec review skill.

## Verification

```bash
npm run test:server -- server/modules/users
npm test -- src/infrastructure/http/userGovernanceClient.test.ts src/UserPermissionsPage.test.tsx src/reducer.userPermissions.test.ts
npm run contract:check
npm run docs:check
npm run ui:check
npm run test:all
npm run build
npm run acceptance:coverage
npm run acceptance:operations
playwright-cli --version
```

Browser verification covers `/organization/members` at `1440x900`, `768x1024`, and `390x844`, with snapshot, screenshot, confirmation interaction, success removal, refusal behavior, console errors, and relevant network requests checked. The focused acceptance spec is `e2e/acceptance/permissions.acceptance.spec.ts` under requirement and operation `PERM-USER-MGMT-001`.

Observed local evidence on 2026-08-28:

- Focused real-PostgreSQL/backend: 5 files, 74 tests passed; user-deletion schema/behavior and retained workflow-read tests included.
- Full frontend at bounded concurrency: 420 files, 3152 tests passed. Full server: 362 files passed, 1 skipped; 2798 tests passed, 4 skipped. Scripts: 69 files passed (948 tests, 5 skipped). Bridge: 21 files / 138 tests passed.
- `npm run build`, `npm run ui:check`, `npm run contract:check`, `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` passed. The schema doc was generated from a disposable pgvector PostgreSQL container migrated from scratch.
- `playwright-cli` mock-runtime UI proof at the three required viewports passed: desktop confirmation and removal, responsive table containment, mobile dialog, disabled self/platform-admin actions, and zero console errors. API/DB behavior is proven separately by PostgreSQL and HTTP tests; the evidence-grade API-mode acceptance case was updated and successfully listed/compiled, but was not executed against a target OIDC environment in this worktree.

## Git & PR Workflow

- Worktree: `/Users/tzrea1/Develop/WiseEff-workspace-20260828`
- Feature branch: `codex/user-account-deletion-20260828`, created from `main@551eec66c9ffacca668ba8c579857dddadf71e5d`.
- This implementation session may edit, test, and commit only on the feature branch. It does not push to `main`, open or merge a PR, or synchronize `main` after merge.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `ARCHITECTURE.md`, `docs/README.md` | Update only if navigation or module ownership changes. |
| Planning docs | Update | `docs/PLANS.md`, this plan, Chinese companion | Track active scope and verification. |
| Product specs | Update | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Replace the prior no-delete lifecycle boundary. |
| Architecture/API | Update | `docs/design-docs/api-contract.md`, `docs/design-docs/full-stack-architecture.md`, `docs/api/authentication.md` | Document DELETE contract and data-retention behavior. |
| Quality/testing | Update | `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md`, acceptance coverage/operation matrices | Record PostgreSQL and browser gates. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/identity-provider.md` | Record unchanged or update operator consequences. |
| Security/governance | Update | `docs/SECURITY.md`, `docs/security/audit-retention.md` | Define delete authorization, audit, and PII retention boundary. |
| Frontend/design | Update | `docs/FRONTEND.md`, `docs/design-docs/2026-08-19-organization-administration-design.md` | Add the members-page lifecycle action. |
| Generated artifacts | Update | OpenAPI contract and database schema summary | Regenerate after route/migration changes. |
| References | Review | `docs/references/` | Add no new compact reference unless needed. |
| Chinese developer docs | Update | `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/frontend.md`, `docs/zh-CN/security-reliability.md`, Chinese design/plan companions | Keep developer-facing semantics bilingual. |

Review disposition: repository maps, top-level architecture navigation, reliability overview, and compact references remain unchanged because no route ownership, module boundary, deployment dependency, or navigation entry changed. All `Update` rows landed; API/security/frontend/product/testing and Chinese companion docs were updated, and generated OpenAPI/database-schema artifacts were regenerated.

## Documentation Update Gate

- Every `Update` row must land in this branch; every `Review` row must be updated or explicitly recorded unchanged in this plan.
- `npm run docs:check`, `npm run contract:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` must pass before completion.
- Local PostgreSQL and browser evidence are local implementation evidence only; existing target OIDC/M6.2 evidence remains pending and is not upgraded by this change.
