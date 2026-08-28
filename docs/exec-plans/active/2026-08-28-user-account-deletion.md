# User Account Deletion

> Status: Implementation complete on feature branch; unmerged
> Date: 2026-08-28
> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-08-28-user-account-deletion.md)

## Goal

Let an authorized administrator permanently delete a non-self user from Organization administration while preserving business and audit history. Historical references to the deleted user become `NULL`; account-owned security and transient rows are removed. The server remains the authority for tenant scope, platform-admin protection, self-lockout protection, and durable audit.

## Success Criteria

- `DELETE /api/v1/users/:userId` requires an active caller with `users:manage`, scopes the target to the caller's home Organization, and returns `204` only after a successful transaction.
- The active caller cannot delete itself. An ordinary Admin cannot delete a platform super admin. Deleting a missing or cross-Organization user returns `404` without side effects.
- User deletion and role replacement take the same user-row lock, so a concurrent platform-admin grant is committed and rechecked before an ordinary Admin can delete the account.
- The user row, role bindings, password credential, auth sessions, pending local registration requests, personal notifications, active device leases, and unsubmitted parameter drafts are removed.
- Durable audit and business rows remain, with every foreign key to the deleted user changed to `NULL` by `ON DELETE SET NULL`.
- Retained API DTOs model those references as nullable. Surfaces whose writes always carried an authenticated user render `已注销用户`; legacy surfaces that also permit genuinely unattributed rows render `用户已注销或未记录`, avoiding unsupported deletion provenance while never showing a blank or stale identity.
- A High-severity `user-delete` audit event is committed in the same transaction. It retains the opaque target id and non-secret lifecycle facts, not the deleted user's name, username, email, password, or password hash.
- `/organization/members` exposes a destructive `注销` action for eligible rows, explains irreversibility and reference nulling, waits for the API, removes the row only after success, and keeps the dialog open with a projected server refusal on failure.
- Mock and API modes expose the same visible lifecycle semantics; backend authorization remains authoritative.

## Architecture And TDD Seams

Vertical slices use these public seams:

1. Real PostgreSQL service integration: migrated foreign-key policy, transactional deletion, retained/null historical rows, removed account-owned rows, and durable audit.
2. HTTP API: `DELETE /api/v1/users/:userId` success and authorization/self/cross-Organization failures.
3. Frontend HTTP client: encoded DELETE request and empty `204` handling.
4. Organization members page: eligibility, confirmation copy, awaited success removal, and visible server failure.
5. Browser acceptance: `e2e/acceptance/permissions.acceptance.spec.ts` covers Admin deletion, non-Admin denial, and post-delete rendering on `/knowledge-admin` and `/parameter-review` under requirement/operation `PERM-USER-MGMT-001`, with UI/API/DB/audit evidence.

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
- retained-attribution DTO/UI seams under `server/modules/{knowledge,parameters}/` and `src/features/{knowledge,parameter-review}/`
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
- [x] Review the final committed diff against `main` with the Standards/Spec review skill.

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

Browser verification covers `/organization/members`, `/knowledge-admin`, `/parameter-review`, `/audit`, `/feedback-admin`, `/parameter-admin/projects/aurora/configuration`, and `/parameters` at `1440x900`, `768x1024`, and `390x844`, with snapshot, screenshot, relevant interactions, retained-attribution rendering, console errors, page-level overflow, and relevant network requests checked. The API-mode parameter workspace was exercised both as the current `/parameters` route and through the configuration inspector's immutable file-version history. The mock-mode `/parameters` route was also exercised through its parameter-detail dialog because `ParameterDetailDialog` is mounted only on that runtime branch; its explicit-null fallback remains covered by the focused component test. The focused automated acceptance spec is `e2e/acceptance/permissions.acceptance.spec.ts` under requirement and operation `PERM-USER-MGMT-001`; it now seeds retained knowledge and initialization-review rows, deletes their user through the UI, and asserts both downstream pages render `已注销用户`.

The focused API-mode acceptance can be reproduced against a disposable pgvector PostgreSQL database as follows. The HMAC key and token are local test credentials only; this command does not constitute target OIDC evidence.

```bash
docker run --name wiseeff-user-delete-acceptance \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=wiseeff_user_delete_acceptance \
  -p 50736:5432 -d pgvector/pgvector:pg16
export DATABASE_URL='postgres://postgres:postgres@127.0.0.1:50736/wiseeff_user_delete_acceptance'
export TEST_DATABASE_URL="$DATABASE_URL"
export AUTH_TOKEN_ISSUER='wiseeff-acceptance-user-delete'
export AUTH_TOKEN_HMAC_SECRET="$(openssl rand -hex 32)"
export VITE_WISEEFF_API_AUTHORIZATION="$(node --input-type=module -e 'import { createHmac } from "node:crypto"; const payload = Buffer.from(JSON.stringify({ iss: process.env.AUTH_TOKEN_ISSUER, sub: "u-xu-yun", org: "org-chargelab", name: "Xu Yun", email: "xu@chargelab.cn", title: "Platform Owner", orgName: "ChargeLab", roles: [], permissions: [], isActive: true, nbf: 0, exp: 9999999999 })).toString("base64url"); process.stdout.write(`Bearer ${payload}.${createHmac("sha256", process.env.AUTH_TOKEN_HMAC_SECRET).update(payload).digest("base64url")}`);')"
DATABASE_URL="$DATABASE_URL" npm run db:migrate
DATABASE_URL="$DATABASE_URL" npm run db:seed:m0
AUTH_MODE=production AUTH_PROVIDER=hmac \
  WISEEFF_ACCEPTANCE_OWNED_RUNTIME=true \
  WISEEFF_ACCEPTANCE_FRONTEND_URL=http://127.0.0.1:5188 \
  VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8899 \
  WISEEFF_ACCEPTANCE_EVIDENCE_SOURCE_COMMIT="$(git rev-parse HEAD)" \
  WISEEFF_ACCEPTANCE_EVIDENCE_RUN_ID=user-delete-final \
  WISEEFF_ACCEPTANCE_EVIDENCE_ROOT=/tmp/wiseeff-user-delete-acceptance-evidence \
  WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR=/tmp/wiseeff-user-delete-playwright \
  WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR=/tmp/wiseeff-user-delete-report \
  npm run acceptance:e2e -- \
    e2e/acceptance/runtime-warmup.spec.ts \
    e2e/acceptance/permissions.acceptance.spec.ts \
    --grep 'warm vite entry graph|lets Admin manage a non-self user in UI while denying non-Admin access'
docker rm -f wiseeff-user-delete-acceptance
```

Observed local evidence on 2026-08-28:

- Focused final-tree user-deletion backend: 3 files, 49 tests passed, including a two-connection PostgreSQL lock barrier, account-owned lease/draft cleanup, platform-admin/missing/cross-organization route boundaries, and deletion audit behavior. Retained workflow/log null-adaptation tests are also included in the full server gate.
- Full frontend at bounded concurrency: 420 files, 3160 tests passed. Full server: 362 files passed, 1 skipped; 2804 tests passed, 4 skipped. Scripts: 69 files passed (948 tests, 5 skipped). Bridge: 21 files / 138 tests passed. The default-concurrency frontend attempt was stopped after 415 files passed and 16 tests failed under cross-module 5-second timeout pressure; the same implementation tree passed completely with `npm test -- --maxWorkers=2`.
- `npm run build`, `npm run ui:check`, `npm run contract:check`, `npm run docs:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` passed. The schema doc was generated from a disposable pgvector PostgreSQL container migrated from scratch.
- `playwright-cli` mock-runtime UI proof at the three required viewports passed: desktop confirmation and visible disabled reasons, responsive table containment, mobile dialog/removal, parameter-detail interaction, and zero console errors. A final Standards finding about raw mock audit copy was reproduced with two failing tests, then fixed by using canonical action `delete` and the Chinese `user-delete` label `注销用户`; the focused 25-test green run, full 420-file/3160-test frontend run, and build all passed on the resulting implementation commit. The real mock flow then deleted a user, navigated in-app to `/audit`, and rendered `删除` / `注销用户` without raw English or an internal slug at all three viewports; screenshots are `work/ui-checks/user-delete-audit-label-{desktop-1440x900,tablet-768x1024,mobile-390x844}.png`.
- The focused `PERM-USER-MGMT-001` API-mode acceptance also passed against a disposable pgvector PostgreSQL database (runtime warmup plus one product case), proving HTTP `204`, database null adaptation, downstream deleted-attribution rendering, deletion audit, and non-Admin `403`. Machine-readable results are at `/tmp/wiseeff-user-delete-playwright-final5/results.json`; the HTML report is `/tmp/wiseeff-user-delete-report-final5/index.html`; the passed operation record is `/tmp/wiseeff-user-delete-acceptance-evidence-final5/runs/70cb3770fc0afd8ddc6845bcf71fea65d94fad2d/user-delete-final/records/PERM-USER-MGMT-001-admin-user-management-ui-and-non-admin-denial.json`. It records implementation commit `70cb3770fc0afd8ddc6845bcf71fea65d94fad2d` and run id `user-delete-final`. This is deterministic local HMAC evidence, not target OIDC evidence.
- API-mode retained-attribution browser proof covered `/knowledge-admin` and `/parameter-review` at `1440x900`, `768x1024`, and `390x844`. Both surfaces rendered `已注销用户`; relevant API reads returned `200`, console errors were zero, and each mobile document remained 390 px wide without page-level overflow. Screenshots are under `work/ui-checks/user-delete-null-{knowledge,review}-{desktop-1440x900,tablet-768x1024,mobile-390x844}.png`.
- API-mode provenance-boundary proof covered `/audit`, `/feedback-admin`, and the configuration inspector at `/parameter-admin/projects/aurora/configuration` in all three viewports. Audit and immutable file-version history rendered `用户已注销或未记录`; feedback rendered `已注销用户`. Relevant API reads returned `200`, console errors were zero, and mobile documents remained 390 px wide. Screenshots are `work/ui-checks/user-delete-{audit,feedback,file-history}-{desktop-1440x900,tablet-768x1024,mobile-390x844}.png`.
- `/parameters` was checked in API mode in all three viewports with its current DTS topology workspace (117 parameters and all relevant API reads `200`) and in mock mode by opening the real parameter-detail dialog. Console errors were zero and mobile documents remained 390 px wide. Screenshots are `work/ui-checks/user-delete-parameters-{desktop-1440x900,tablet-768x1024,mobile-390x844}.png` and `work/ui-checks/user-delete-parameter-detail-{desktop-1440x900,tablet-768x1024,mobile-390x844}.png`. The explicit-null `ParameterDetailDialog` copy is additionally asserted by its focused test because the seeded mock record has a named actor.
- Final committed-diff review result: Standards P1=0/P2=0; Spec P1=0/P2=0.

## Git & PR Workflow

- Worktree: `/Users/tzrea1/Develop/WiseEff-workspace-20260828`
- Feature branch: `codex/user-account-deletion-20260828`, created from `main@551eec66c9ffacca668ba8c579857dddadf71e5d`.
- This implementation session may edit, test, and commit only on the feature branch. It does not push to `main`, open or merge a PR, or synchronize `main` after merge.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `ARCHITECTURE.md`, `docs/README.md` | Update only if navigation or module ownership changes. |
| Planning docs | Update | `docs/PLANS.md`, `docs/exec-plans/active/2026-08-28-user-account-deletion.md`, `docs/zh-CN/exec-plans/active/2026-08-28-user-account-deletion.md` | Track active scope and verification. |
| Product specs | Update | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Replace the prior no-delete lifecycle boundary. |
| Architecture/API | Update | `docs/design-docs/api-contract.md`, `docs/design-docs/full-stack-architecture.md`, `docs/api/authentication.md` | Document DELETE contract and data-retention behavior. |
| Quality/testing | Update | `docs/design-docs/testing-strategy.md`, `docs/zh-CN/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md`, `docs/zh-CN/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `e2e/acceptance/operationMatrix.ts`, `docs/developer/user-operation-coverage-matrix.md`, `docs/zh-CN/developer/user-operation-coverage-matrix.md` | Record PostgreSQL and API-mode browser gates. |
| Reliability overview | Review | `docs/RELIABILITY.md` | No deployment dependency or runtime-readiness boundary changed. |
| Identity runbook | Update | `docs/runbooks/identity-provider.md` | Keep local HMAC and target OIDC evidence boundaries explicit. |
| Security/governance | Update | `docs/SECURITY.md`, `docs/security/audit-retention.md` | Define delete authorization, audit, and PII retention boundary. |
| Frontend/design | Update | `docs/FRONTEND.md`, `docs/design-docs/2026-05-17-user-permissions-design.md`, `docs/design-docs/2026-08-19-organization-administration-design.md`, `docs/zh-CN/design-docs/2026-08-19-organization-administration-design.md` | Add the members-page lifecycle action. The 2026-05-17 file is a historical English-only design record rather than an active bilingual developer guide; its supersession note links to the current bilingual organization-administration design, so no separate Chinese copy is created. |
| Generated artifacts | Update | `docs/generated/openapi.json`, `docs/generated/db-schema.md` | Regenerate after route/migration changes. |
| References | Review | `docs/references/productization-api-contract-draft.md` | No compact-reference contract changed. |
| Chinese developer docs | Update | `docs/zh-CN/backend-runtime.md`, `docs/zh-CN/frontend.md`, `docs/zh-CN/security-reliability.md`, `docs/zh-CN/design-docs/2026-08-19-organization-administration-design.md`, `docs/zh-CN/exec-plans/active/2026-08-28-user-account-deletion.md` | Keep developer-facing semantics bilingual. |

Review disposition: repository maps, top-level architecture navigation, reliability overview, and compact references remain unchanged because no route ownership, module boundary, deployment dependency, or navigation entry changed. All `Update` rows landed; API/security/frontend/product/testing and Chinese companion docs were updated, and generated OpenAPI/database-schema artifacts were regenerated.

## Documentation Update Gate

- Every `Update` row must land in this branch; every `Review` row must be updated or explicitly recorded unchanged in this plan.
- `npm run docs:check`, `npm run contract:check`, `npm run acceptance:coverage`, and `npm run acceptance:operations` must pass before completion.
- Local PostgreSQL and browser evidence are local implementation evidence only; existing target OIDC/M6.2 evidence remains pending and is not upgraded by this change.
