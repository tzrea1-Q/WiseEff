# Organization administration

> Historical status: **Implemented and archived** — merged via PR #560 (`85953051`).
>
> Residual ownership: invitations remain TD-119, the platform Organization directory remains TD-120, and project membership / project-scoped roles remain TD-121. None is implied complete by this archive.
>
> Date: 2026-08-19
> Design: [`docs/design-docs/2026-08-19-organization-administration-design.md`](../../design-docs/2026-08-19-organization-administration-design.md)
> Chinese: [`docs/zh-CN/exec-plans/completed/2026-08-19-organization-administration.md`](../../zh-CN/exec-plans/completed/2026-08-19-organization-administration.md)
> ADR: [ADR-0037](../../adr/0037-organization-administration-is-home-org-tenant-operations.md)

## Goal

Make Organization a product object the home-organization Admin can operate: honest local onboarding (no department-as-tenant), a visible Organization record with an editable display name, and today’s user governance hosted as **组织管理** on `/organization`.

## Non-goals

Invitations (TD-119), a platform Organization directory (TD-120), Project member / project-scoped roles (TD-121), OIDC claim remapping, a new `organization:manage` permission, Tenant + Department as two entities.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation agent | Commit on `feat/organization-administration` checked out from latest `main`; do not open or merge GitHub PRs |
| Parent agent | Review, run verification, open/merge the PR, then sync local `main` |

One branch: `feat/organization-administration`.

## Phase 1 — stop minting department tenants

1. Local register: drop the required department Organization field. Development and non-development `AUTH_PROVIDER=local` join the Evaluation Organization (ChargeLab when seeded; otherwise the single bootstrap Organization). Reject creating `org-hardware-department` / `org-software-department` from register.
2. Remove the 硬件部 / 软件部 picker from the auth screen (`src/App.tsx`). Role discipline stays on the role dropdown.
3. `bootstrapLocalAdmin`: join ChargeLab when present; otherwise create or join exactly one Organization from the bootstrap name (neutral default, never 硬件部). Fail closed on 0 or many Organizations without an explicit target.
4. Stop seeding department Organizations as registration targets (`baselineCatalog` / migration follow-up). Reassign existing users, role bindings, sessions, and pending registration requests from those ids onto the deployment home organization (ChargeLab in seeded databases).
5. Keep OIDC claim → Organization mapping unchanged (D11).
6. Tests: `localAuth`, `bootstrapLocalAdmin`, `app` register path, frontend auth screen.

## Phase 2 — Organization administration surface

1. `GET` / `PATCH /api/v1/organization` for the caller’s home organization. `PATCH` accepts `{ name }` only, requires `users:manage`, writes `organization-update` in the same transaction (ADR-0027). Name: trimmed, non-empty, length-capped, not unique.
2. Frontend: rename utility 用户管理 → 组织管理; canonical `/organization` (profile) and `/organization/members` (people) as debugging-admin-style scope peers; permanent redirect from `/user-permissions` to `/organization/members` (keep query). Reuse `UserPermissionsPage` members table (`DataTable`).
3. Update `/api/v1/me` consumers so a rename shows on the next current-user fetch. Mock port matches.
4. Acceptance IDs **before** UI work: extend `PERM-USER-MGMT-001` / `PERM-GOV-001` / `PLAT-ROLE-002` and onboarding `PM-02` / `PM-03` onto `/organization`; add `ORG-ADMIN-RENAME-001` (Admin rename + audit + non-Admin 403) to the coverage map and operation matrix (EN + zh).
5. Retarget `e2e/acceptance/permissions.acceptance.spec.ts` and `permissions-matrix.acceptance.spec.ts`.

## Phase 3 — documentation gate

Update every `Update` row in the Documentation Impact Matrix (product onboarding, authentication docs, FRONTEND, SECURITY, environment-variables note about ChargeLab join, self-hosted runbook “move account into ChargeLab”). Run `npm run docs:check`.

## Verification

- Targeted vitest: `server/modules/auth/localAuth.test.ts`, `bootstrapLocalAdmin.test.ts`, users/org routes, `UserPermissionsPage` / new organization page, `App.test.tsx` auth screen.
- `npm run test:server`, `npm run build`, `npm run docs:check`.
- `npm run acceptance:browser` for the permission and onboarding IDs above.
- playwright-cli viewports 1440×900 / 768×1024 / 390×844 on `/organization` (snapshot + screenshot + console error) per the frontend UI gate.

## Success criteria

- Local register has no Organization picker; new accounts see ChargeLab (or the single bootstrap Organization) projects.
- Register never inserts `org-hardware-department` / `org-software-department`.
- Admin opens 组织管理, renames the Organization, and members + `/api/v1/me` show the new label; id unchanged.
- `/user-permissions` redirects. Parameter-admin organization area is unchanged.
- Non-Admin cannot `PATCH /api/v1/organization`. Last-Admin and self-lockout rules on members are unchanged.

## UI interaction automation

Affected specs: `e2e/acceptance/permissions.acceptance.spec.ts`, `permissions-matrix.acceptance.spec.ts`, and the local-account onboarding coverage that today names `/user-permissions` (`PM-02`, `PM-03`). Add `ORG-ADMIN-RENAME-001` before Phase 2 UI. Operation evidence stays on `npm run acceptance:browser` / `npm run acceptance:evidence`.

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Repository maps | Review | `ARCHITECTURE.md` + zh — mention Organization administration only if the users module grows a home-org route worth listing |
| Planning | Update | This plan + zh; `docs/PLANS.md` + zh (this change) |
| Product specs | Update | `docs/product-specs/new-user-onboarding.md` + zh; `docs/product-specs/index.md` if the summary still says department picker — Phase 1/2 |
| Domain / glossary | Update | `CONTEXT.md` + ADR-0037 + domain-model EN/zh (done at lock); keep honest during implementation |
| Design docs | Update | This design + zh (done); `docs/design-docs/index.md` + zh (this change) |
| API | Update | `docs/api/authentication.md` + zh; `docs/design-docs/api-contract.md` + zh; OpenAPI — Phase 1/2 |
| Frontend | Update | `docs/FRONTEND.md` + `docs/zh-CN/frontend.md` (auth screen, `/organization`) — Phase 1/2 |
| Security | Update | `docs/SECURITY.md` + zh; `docs/security/user-permission-design.md` + zh — Phase 2 |
| Reliability / runbooks | Update | `docs/runbooks/self-hosted-runtime.md` + zh; `docs/runbooks/platform-admin-and-schema-promotion.md` + zh if they still say register into ChargeLab via the department picker |
| Developer env | Update | `docs/developer/environment-variables.md` + zh (ChargeLab join is the product rule, not a `NODE_ENV` lie) — Phase 1 |
| Quality / acceptance | Update | coverage map + operation matrix EN/zh; permission specs — Phase 2 |
| Generated artifacts | Review | `docs/generated/db-schema.md` only if a migration adds columns (v1 should not) |
| References | No change | `docs/references/` |
| Tech debt | Update | TD-119 / TD-120 / TD-121 (this change) |

## Documentation Update Gate

This plan cannot move to `completed/` until every Update/Review row is updated or recorded unchanged with evidence, `npm run docs:check` passes, and the new acceptance IDs have automation or an honest `@acceptance-planned` marker.
