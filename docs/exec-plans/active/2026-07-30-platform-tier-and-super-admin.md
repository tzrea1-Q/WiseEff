# Platform super admin and the driver schema platform tier — execution plan

## Goal

Give overlay parsing knowledge a way out of the organization that authored it, and give the platform an actor who can legitimately perform that act.

**Phase A** introduces `platform-admin`, a cross-organization super admin. It is the first role in the product whose authority is not bounded by one tenant.

**Phase B** adds a platform-scoped tier to the driver schema overlay tables. An overlay proven in one or more organizations can be **promoted** into a platform row visible to every tenant, matched ahead of organization overlays and behind vendor. Contributing organization rows are superseded rather than deleted, and the tree says so. `schemas/dts` stays repository-managed and product-read-only, unchanged from ADR-0008 (ADR-0009).

## Status

Planning only. No code, no migration. Blocked on the prerequisite below.

## Prerequisite and sequencing

`feat/org-driver-schema-overlay` is **not merged**: migrations `0076` and `0077` are still untracked in the worktree, and the whole overlay feature lives on that branch. Phase B starts from `main` **after** that PR merges.

Phase A does not depend on the overlay at all and can start immediately.

Batch 1 sits outside both phases: it is the pair of signals ADR-0009 named as the cheapest first increment, needs no schema change and no new actor, and is worth shipping on its own.

**Considered and rejected:** folding `organization_id` nullability into `0076` while it is still unmerged, to avoid an `alter table` later. Rejected because the platform tier's uniqueness, supersede, and provenance invariants have to land together; half of them sitting unused in `0076` is dead schema the next reader has to reverse-engineer.

## Git & PR Workflow

Three branches, three PRs, in this order. This plan is the exception to one-plan-one-branch, because the auth change and the schema change have different reviewers and different blast radii and must not land in one diff.

| Order | Branch | Covers |
| --- | --- | --- |
| 1 | `feat/parse-coverage-scope` | Batch 1 |
| 2 | `feat/platform-admin-role` | Batches 2–3 (Phase A) |
| 3 | `feat/driver-schema-platform-tier` | Batches 4–9 (Phase B) |

Implementation commits on the feature branch only. The table rename in batch 4 is its own commit so the behavioral diff stays readable. The parent agent opens and merges each PR and syncs local `main` between them.

## Domain decisions

Settled by ADR-0009; do not relitigate without updating it.

- The promotion target is a platform-scoped row in the overlay tables, **not** a generated DTS file. Repository DTS remains the route only for prefix patterns and content-hash reproducibility.
- Tier order is linux → vendor → platform-manual → org-manual, a strict total order. Organizations cannot locally override the platform tier; `matchDriver` treats same-tier multiplicity as ambiguous, so a total order is a structural requirement, not a preference.
- Promotion is a reviewed act, never automatic. Duplicate detection is automatic.
- Contributing organization rows are superseded, not deleted. Authorship and audit survive.
- The platform tier is exact-compatible only, same as the organization tier.

### Settled by this plan — the role

The implementer must not re-decide these.

- **`platform-admin` is a seventh `BackendRoleId` / `PlatformRoleId`, not a new identity dimension.** `AuthContext.organization` stays non-nullable, `user_role_bindings` is unchanged, and a platform admin still has a home organization. Making the organization nullable would touch every repository, every audit write, and the session tables, for no gain: the cross-organization capability is needed by a handful of platform-scoped operations, not by the request pipeline.
- **The role grants no additional access to any organization's business data.** It unlocks platform-scoped rows (`organization_id IS NULL`) and one aggregate cross-organization read — the promotion candidate report, which exposes compatibles, contributor organization ids, property keys, and value shapes, and nothing else. Parameters, projects, users, logs, and debugging stay bounded by `auth.organization.id`. **No existing route widens.** A reviewer should be able to confirm this by checking that no existing repository call site changes its `organizationId` argument.
- **Only a `platform-admin` may grant or revoke `platform-admin`.** `replaceUserRoles` is gated by `users:manage`, which every organization Admin holds; without this rule any org Admin could promote themselves out of their tenant. This is the single most important control in the plan and needs its own test.
- **The first platform admin is bootstrapped out of band.** Seeded in `scripts/seed-m0.ts` for development; a documented one-time procedure in a runbook for production. There is no self-service path and `selfRegistrationRoleIds` must continue to exclude it.
- **`level: "admin"` and `roleRank: 4`.** Setting `level` to `"admin"` makes every existing `level === "admin"` branch (review queue, personal workbench, dashboard repository) treat a platform admin as an org admin inside their home organization, which is the intent. Rank 4 puts it above `admin` on the existing linear ladder so `comparePlatformRoles(role, "admin") >= 0` passes.
- **Every exact-equality `roleId === "admin"` check is reviewed individually**, because rank does not help there. The full list is in batch 2; each site gets an explicit include-or-exclude decision, not a blanket replace.
- **Permissions are `platform:access` and `platform:schema-promote`**, added to `BackendPermission` and the frontend `PermissionKey`. `platform-admin` holds every `admin` permission plus these two. Separate permissions rather than one, so a future read-only platform auditor is expressible.
- **Audit gains a platform scope, and platform actions fan out.** `audit_events.organization_id` becomes nullable so a platform-scoped act has an honest home, and the same act additionally writes one organization-scoped event per affected tenant, so an organization whose overlay was superseded can see why in its own audit trail. `listAuditEvents` keeps its `organization_id = $1` predicate, which correctly hides platform rows from organization admins; the platform console gets its own read.

### Settled by this plan — the tier

- **Scope is a new field, not a new `SchemaSource`.** `SchemaSource` is persisted in `driver_schemas.source` and `parameter_specs.source_kind`, has DB check constraints and a `SCHEMA_SOURCE_PRECEDENCE` map, and is read by `matchProperty`. A fourth value ripples through all of it. Instead `DriverSchema` and `PropertySpec` gain `scope: "platform" | "organization"`, and the ordering key becomes `(sourcePrecedence, scopePrecedence)` where scope only discriminates inside `manual`. Pinned rows are `platform` and are unaffected because nothing above `manual` ties.
- **Tables are renamed in the Phase B migration.** `organization_driver_schemas` → `driver_schema_overlays`, `organization_driver_schema_properties` → `driver_schema_overlay_properties`, with the TypeScript module and symbol names following. A table whose name asserts a scope it no longer has misleads every future reader of `docs/generated/db-schema.md`, and the migration is already rewriting that table's constraints and indexes. Mechanical, no behavior.
- **Equivalence for promotion eligibility:** identical property-key sets across contributors, and identical `(valueShape.kind, units)` per key. `documentation` may differ; the promotion records which contributor's text it took. Any other divergence makes the compatible ineligible and the report shows the diff rather than picking a winner.
- **Deprecating a platform row restores its contributors to `active`.** Without this, a wrong promotion is unrecoverable, because every contributor is sitting in `superseded`.

## Architecture

### What the role does not change

`AuthContext` keeps its shape. Repositories keep taking an explicit `organizationId`. There is no RLS, no tenant middleware, and no organization-switching header — and this plan adds none. The cross-organization surface is exactly three new endpoints under a new route family, each of which reads platform rows or a bounded aggregate.

### Three seams move for the tier

**Coverage reporting.** `lookupParseCoverage` (`server/modules/parameter-specs/parseCoverage.ts`) returns the *first* driver in array order whose pattern matches, not the highest-precedence one. It agrees with `matchDriver` today only because `mergePinnedRegistryWithOverlay` appends overlays after pinned drivers. That is incidental ordering, not a rule, and within the pinned set a linux prefix listed before a vendor exact match already produces a `source` label that disagrees with what ingest would pick. Batch 1 makes it collect all matches, choose by tier, and report the losers as shadowed.

**Tier representation.** The frontend identifies an overlay by string-sniffing the driver id: `String(coverage.driverId).includes(":org/")` in `src/components/parameter-topology/moduleAttributionTreeUtils.ts`. With a platform tier that id shape stops carrying the answer. Scope becomes an explicit field end to end.

**Cache.** `getCachedOrganizationSchemaRegistry` keys on `(schemasRoot, organizationId, contentHash, overlayDigest)` and gains a platform digest. Invalidating the platform tier invalidates every organization's entry — the first cross-tenant invalidation in this cache, and the main implementation risk.

## Batches

### Batch 1 — Coverage scope becomes explicit, and shadowing gets a signal

Independent of both phases. `ParseCoverage` gains `scope` and a `shadowedBy` report; `lookupParseCoverage` picks by tier instead of array order; `DriverRegistryParseCoverage` carries scope through the port, HTTP client, and mock; `isOverlayParseCoverage` reads the field instead of sniffing the id; the tree shows "shadowed by platform coverage" on an overlay a pinned schema now claims, so the operator does not read their work as deleted.

- `server/modules/parameter-specs/parseCoverage.ts` + test
- `server/modules/parameter-modules/service.ts` (`parseCoverages` projection), `schemas.ts`
- `src/application/ports/ParameterModuleRegistryRepository.ts`, `src/infrastructure/http/parameterModuleRegistryClient.ts`, `src/infrastructure/mock/mockParameterModuleRegistryRepository.ts`
- `src/components/parameter-topology/moduleAttributionTreeUtils.ts` + test, `ModuleAttributionTree.tsx`, `src/application/parameters/parameterAdminUiCopy.ts`

### Batch 2 — Platform role, backend (Phase A)

Add the role id, the two permissions, and the grant guard. Migration `0078` inserts the role catalog row and drops `not null` from `audit_events.organization_id`.

Role id and enum sites, all of which currently hardcode six values:

- `server/modules/auth/types.ts` — `BackendRoleId`, `BackendPermission`
- `server/modules/auth/policy.ts` — `rolePermissions`, `roleRank`
- `server/modules/auth/baselineCatalog.ts` — `baselinePlatformRoles`
- `server/modules/auth/localAuth.ts` (`roleIds` set, line ~20), `tokenVerifier.ts` (~15), `oidcVerifier.ts` (~30)
- `server/modules/users/service.ts` (`roleIds` set, ~28), `server/modules/users/schemas.ts` (`roleIdSchema`), `server/modules/auth/routes.ts` (`platformRoleIdSchema`)
- `scripts/check-acceptance-state-models.ts` (`roleIds`)
- `server/migrations/0078_platform_admin_role.sql`

Exact-equality `roleId === "admin"` sites, each needing a recorded include/exclude decision:

| Site | Purpose | Decision |
| --- | --- | --- |
| `server/modules/parameters/policy.ts:12` | project-id bypass in `hasRole` | Include |
| `server/modules/agent/policy.ts:14`, `agent/toolRegistry.ts:30` | global admin for Agent tools | Include |
| `server/modules/users/service.ts:76` `hasAdminRole` → lines 92/96 | last-admin protection | Include |
| `server/modules/users/service.ts:311/323/386` | cross-organization registration approvals | Include |
| `server/modules/auth/localAuth.ts:115` | self-registration role guard | **Exclude** — must refuse `platform-admin` |

Grant guard: `replaceUserRoles` refuses to add or remove `platform-admin` unless the caller already holds it. Bootstrap in `scripts/seed-m0.ts` (development only, alongside the existing demo credentials).

Audit: `createAuditEvent` accepts `organizationId: string | null`; a `writePlatformAuditEvent` helper writes the platform row plus one organization-scoped row per affected tenant.

### Batch 3 — Platform role, frontend (Phase A)

- `src/domain/users/types.ts` — `PlatformRoleId`, `platformRoles`, `roleRank`, `isPlatformRoleId`, `PermissionKey`, and the three `role === "admin"` / `role.id === "admin"` workflow-slot helpers (lines ~180/196/214)
- `src/app/permissions.ts` — `pageRequiredRoles` gains `platform-console`, `actionRequiredRoles` gains the promote action, the role-label `Record`, and the `parameter.merge` exact check at line 77
- `src/appConfig.ts` — new `PageKey` `platform-console`, path `/platform-console`, `utilityItems` entry
- `src/app/routes.tsx` — render the console page
- `src/App.tsx` — `selfRegistrationRoleIds` must not gain it; the last-active-admin guard at line 617
- `src/UserPermissionsPage.tsx` — Chinese label 平台超级管理员, capability description, and the grant control hidden unless the current user holds the role
- `src/mockData.ts` — a mock platform admin user so mock mode can render the console

### Batch 4 — Platform tier storage (Phase B)

Migration `0079`: rename both tables; `organization_id` nullable with a `check` that platform rows carry none; a second partial unique index on `lower(compatible)` where `lifecycle = 'active' and organization_id is null`; `lifecycle` gains `superseded`; `superseded_by_schema_id` self-reference; a `driver_schema_overlay_promotions` table recording `(platform_schema_id, source_schema_id, source_organization_id, promoted_by_user_id, promoted_at, documentation_source)` so N contributors keep provenance. The repository becomes scope-aware and rejects at write time an organization row whose compatible an active platform row already covers.

- `server/migrations/0079_driver_schema_platform_tier.sql`
- `server/modules/parameter-specs/driverSchemaOverlayRepository.ts` (renamed) + test
- `server/shared/database/migrationInvariant.test.ts`, `server/modules/parameter-topology/schemaMigration.test.ts`

### Batch 5 — Matching and cache (Phase B)

Materialization emits `scope`; platform driver ids drop the organization segment (`driver:platform/{compatible}:v{n}`); `matchDriver` splits the manual tier into platform-then-organization while keeping same-tier multiplicity ambiguous; `matchProperty` gap-fill order follows; `schemaRegistryCache` gains the platform digest and a cross-tenant invalidation path. Platform properties need a spec identity formula that is not `buildManualSpecIds`, which bakes in `organizationId`.

- `server/modules/parameter-specs/driverSchemaOverlayMaterialize.ts` + test, `matcher.ts` + tests, `schemaRegistryCache.ts` + test, `specIdentity.ts`, `types.ts`

### Batch 6 — Promotion API (Phase B)

A new route family `/api/v2/platform/driver-schemas`, every handler gated on `platform:schema-promote`:

- `GET .../promotion-candidates` — active organization overlays grouped by `lower(compatible)`, with contributor count, per-contributor property shapes, and an equivalence verdict
- `POST .../promotions` — validate equivalence, promote linked `ParameterSpec` rows to `organization_id IS NULL`, write the platform overlay row, mark contributors `superseded` with provenance, invalidate every organization's registry cache, fan out audit
- `POST .../promotions/:id/revert` — deprecate the platform row and restore its contributors to `active`

Register all three in `server/modules/contracts/routeManifest.ts`. The operation lives in `server/modules/parameter-specs/driverSchemaPromotion.ts` with its own test; routes stay thin.

### Batch 7 — Platform console (Phase B)

`/platform-console`: the promotion candidate list, a side-by-side contributor diff for the ineligible ones, and promote/revert actions with a confirmation that states the cross-tenant blast radius. Port, HTTP client, and mock repository follow the existing parameter-admin pattern.

### Batch 8 — Org-facing signals (Phase B)

An overlay that was promoted reads as promoted rather than merely shadowed, with the platform row that replaced it. Authoring a compatible an active platform row already covers is refused in the dialog with the reason, matching the batch-4 write-time rejection.

- `src/components/parameter-topology/ModuleAttributionTree.tsx`, `src/components/admin/OrganizationDriverSchemaDialog.tsx`, UI copy

### Batch 9 — Documentation and acceptance

Bilingual FRONTEND, API contract for the new route family, domain model, generated schema for `0078`/`0079`, ADR-0009 status note, the promotion runbook, and the `PLAT-ROLE-*` / `DRV-PROMOTE-*` IDs in both coverage maps and their Chinese companions.

## Risks

- **Privilege escalation through role granting.** Every organization Admin holds `users:manage`, so without the batch-2 guard an org Admin can grant themselves `platform-admin` and leave their tenant. This is the highest-severity risk in the plan and the reason the guard has its own test rather than riding along with the role's other tests.
- **Rank 4 silently widens future checks.** Once `roleRank["platform-admin"] = 4`, every present and future `comparePlatformRoles(role, "admin") >= 0` passes for it. That is intended inside the home organization, but it means a later feature that gates on "admin or above" gets a platform admin for free without anyone deciding so. The exact-equality table in batch 2 documents today's sites; it does not protect tomorrow's.
- **Cross-tenant data exposure through the candidate report.** The report is the only place an authenticated request reads rows belonging to organizations other than the caller's. It must project a fixed column set; returning the overlay record shape directly would leak whatever fields that record gains later.
- **Audit nullability weakens an invariant.** `audit_events.organization_id` has been `not null` since `0001`. Making it nullable means a bug that forgets to set it now produces a silently platform-scoped, org-invisible audit row instead of failing. Constrain it: only the platform writer may pass null, and assert that in a test.
- **Cross-tenant cache invalidation.** `invalidateOrganizationSchemaRegistryCache` scopes by an organization suffix in the key. Platform-tier invalidation must clear every entry, and a promotion that writes rows without clearing leaves tenants matching the superseded overlay from a warm process cache — a per-process, per-tenant inconsistency that reproduces only under load.
- **Spec identity for platform properties.** `buildManualSpecIds({ organizationId, propertyKey, driverModule })` bakes the organization into the id. A platform property needs a different formula, and getting it wrong creates a second `parameter_specs` row that looks correct in isolation while existing bindings keep pointing at the old one. Same silent double-write class the overlay plan flagged, now with a blast radius of every tenant.
- **Promotion is a cross-tenant behavior change.** Every organization that had no overlay for the compatible starts parsing it. That is the point, but their next ingest produces bindings that did not exist before, and provenance must record the platform tier version or the change is unattributable.
- **Reproducibility is now a triple.** `vendorContentHash` plus organization overlay version plus platform tier version. If binding provenance records only the first two, a promotion becomes invisible in history.
- **Equivalence is weaker than it looks.** Two organizations agreeing on property keys and value shapes have not agreed on semantics; the same key can mean different things on different boards. The report must show contributor documentation side by side rather than asserting that a passing check means the promotion is correct.
- **The rename touches the in-flight surface.** Batch 4 renames symbols across roughly fifteen files the overlay PR just created. A dedicated commit keeps review tractable, but rebasing over any follow-up fix to the overlay will conflict noisily.

## UI Interaction Automation

Batches 1, 3, 7, and 8 change user-facing behavior. Register these in `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md` (and the Chinese companions) **before** implementation. The existing `e2e/acceptance/permissions-matrix.acceptance.spec.ts` enumerates six roles and must gain the seventh, along with `e2e/acceptance/helpers/roleFixtures.ts` and `helpers/bearerAuth.ts`.

| ID | Behavior | Status |
| --- | --- | --- |
| `PLAT-ROLE-001` | A platform admin sees `/platform-console` in the sidebar; every other role gets permission-denied on direct navigation | To register |
| `PLAT-ROLE-002` | An organization Admin cannot grant `platform-admin` to anyone, including themselves, and the control is not rendered | To register |
| `PLAT-ROLE-003` | A platform admin's access to another organization's parameters, logs, and users is unchanged — still denied | To register |
| `DRV-PROMOTE-001` | An overlay whose compatible a pinned or platform schema now covers reads as shadowed, naming the tier that replaced it | To register |
| `DRV-PROMOTE-002` | A promoted overlay reads as promoted and links the platform row that replaced it | To register |
| `DRV-PROMOTE-003` | Authoring an overlay for a compatible an active platform row already covers is refused with the reason | To register |
| `DRV-PROMOTE-004` | After promotion, an organization that never authored the compatible sees it as platform-covered on the attribution tree | To register |
| `DRV-PROMOTE-005` | Promotion from the console shows the cross-tenant blast radius before confirming, and reverting restores the contributors | To register |

## Documentation Impact Matrix

| Area | Action | Paths | Status |
| --- | --- | --- | --- |
| ADR | Update | `docs/adr/0009-overlay-parsing-knowledge-promotes-into-a-platform-tier.md` — implementation status; consider a new ADR for the cross-organization role if the discussion outgrows this plan | Pending |
| Domain context | Update | `CONTEXT.md` — glossary rows for platform tier, promotion, and the platform super admin | Pending |
| Planning | Update | `docs/PLANS.md` active plan list | Pending |
| Security | Update | `docs/SECURITY.md` and `docs/security/` — first cross-tenant role, the grant guard, the bounded cross-organization read, and the audit nullability change | Pending |
| Domain model | Update | `docs/design-docs/domain-model.md` — role table, platform tier, supersede lifecycle, promotion provenance | Pending |
| API contract | Update | `docs/design-docs/api-contract.md` — `/api/v2/platform/driver-schemas` family; `parseCoverages` scope field | Pending |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` — platform console, role gating, shadowed/promoted chips | Pending |
| Generated schema | Update | `docs/generated/db-schema.md` — migrations `0078`/`0079`, renamed tables, audit nullability | Pending |
| Acceptance maps | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, Chinese companions | Pending |
| Runbooks | Update | `docs/runbooks/` — bootstrapping the first platform admin in production, and the promotion/revert procedure with its cross-tenant blast radius | Pending |
| API docs | Update | `docs/api/authentication.md` — the new role and its permissions | Pending |
| Reliability | Review | Cross-tenant cache invalidation on promotion | Pending |
| Product specs | Review | Whether the platform operator is a product persona worth naming in `docs/product-specs/` | Pending |
| Developer setup | Review | `docs/developer/` — seeded platform admin in local development | Pending |
| Tech debt | Review | Any batch deferred at merge time gets a row | Pending |
| References | No change | — | — |

## Documentation Update Gate

Blocking. This plan cannot move to `completed/` until every `Update` and `Review` row is updated or explicitly recorded as unchanged with evidence, the eight `PLAT-ROLE-*` / `DRV-PROMOTE-*` IDs exist in both coverage maps and their Chinese companions, the two runbook procedures exist, and `npm run docs:check` passes.

## Verification

```bash
npx vitest run server/modules/auth server/modules/users
npx vitest run server/modules/parameter-specs server/modules/parameter-modules
npm run test:server -- --run server/modules/parameter-topology
npx vitest run src/domain/users src/app src/permissionRouting.test.tsx
npx vitest run src/components/parameter-topology src/components/admin
npm run build
npm run docs:check
# playwright-cli: /platform-console and /parameter-admin/modules at 1440x900, 768x1024, 390x844
```

Four assertions carry more weight than the rest and should be written first:

- An organization Admin calling `replaceUserRoles` with `platform-admin` is refused, including when the target is themselves.
- A `platform-admin` authenticated in organization A receives the same 403s as before on organization B's parameters, logs, and users. Negative authorization is the property most likely to rot silently.
- Ingest and the coverage chip agree on the chosen tier for a compatible matched by both a platform row and an organization row, asserted against one shared registry instance — the same seam the overlay plan guarded.
- Promoting a compatible leaves exactly one `parameter_specs` row per property key, with existing bindings still pointing at it. This is the double-write guard and the test most likely to catch the spec-identity risk.

## Deferred

- A read-only platform auditor role. `platform:access` is split from `platform:schema-promote` so this stays expressible without another migration.
- Organization switching for a platform admin. The role deliberately does not widen tenant-scoped reads; if operating inside another tenant becomes a requirement, it is a separate decision with its own ADR.
- Promoting a platform row further into `schemas/dts`, which remains the only route to prefix patterns and content-hash reproducibility.
- Automatic equivalence reconciliation. Divergent contributors are reported, never merged.
- Exposing "who else authored this compatible" to organization admins. The candidate report is platform-facing only; showing tenants each other's coverage gaps is a product question, not a technical one.
