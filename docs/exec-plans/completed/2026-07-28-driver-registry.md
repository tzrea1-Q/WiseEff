# Driver registry — execution plan
> Status: **Completed 2026-08-17 (archive round 2)** — implementation is on `main`.

## Goal

Make the platform's supported-driver scope declarable and visible before a DTS upload, without introducing a third compatible-keyed store. A registration is a curated driver group plus its exact compatible rules; the registry surface is a view over that data with parse coverage and observed coverage as derived columns (ADR-0007).

## Status

Implementation complete on `main`. Batches 1–8 done: server seams, registry UI, queue claim, upload `driverSummary` + frontend dialog, bilingual FRONTEND, API contract, acceptance IDs, domain/tech-debt review. Remaining `DRV-REG-*` Playwright stubs are not open product work.

## Git & PR Workflow

- Feature branch: `feat/driver-registry` (cut from `feat/module-logical-kind` per agreed baseline B).
- Implementation commits on the feature branch only.
- Parent agent opens and merges the GitHub PR; do not push to `main` from this plan.

## Domain decisions

Settled during design; do not relitigate without updating ADR-0007.

- A registration **is** a curated driver group plus its compatible rules. No new table, no new match lever.
- Registrations are organization-scoped. The `schemas/dts` parsing contract stays global and is referenced, not owned.
- A registration entry carries display name, exact compatibles, target business category, and notes. Property definitions stay with schema documents and the spec review queue.
- Register-then-create: saving a registration creates the curated driver group and its mappings immediately, so `resolveBindingInstanceModuleId` is unchanged.
- Exact compatibles only. N compatibles produce N exact mappings pointing at one driver group.
- Registering an already-mapped compatible claims the existing driver group: reuse, move when the target category differs, promote `origin` to `curated`.
- No report entity. The unclassified queue is re-framed as "observed but not registered"; the upload response carries a one-shot ingest summary; "registered but never observed" is a coverage column.
- Zero-parameter registered driver groups stay visible in the tree with a not-yet-observed marker, behind a default-off hide toggle.
- The registry **read model** is consumed by the attribution tree (coverage chips + edit-dialog detail), not a separate `/modules/registry` table view. Sub-nav is tree + unregistered queue only; legacy registry URLs redirect to the tree.

## Batches

1. **Registry read model.** [x] Expose `loadSchemaRegistry` outside the ingest transaction with a process-level cache keyed on the catalog content hash, and add a lookup that answers "is this compatible covered by a pinned schema, and by which pattern". Keep ingest reading the same cached instance so parse coverage and matching can never disagree.
2. **Registry query.** [x] Server query listing driver-group modules for an organization with their compatible rules, subtree binding counts, `origin`, and parse coverage. Reuse `isScaffoldingDriverLabel` so scaffolding leftovers never appear as drivers.
3. **Register action.** [x] One transaction creating a curated driver group under the declared business category plus its exact mappings, with an audit event. Reject a target that is not a business category, mirroring the parent/child guards added for ADR-0006.
4. **Claim action.** [x] When a compatible already maps, reuse the module, move it when the declared category differs, promote `origin`, and apply the declared display name. Emit the same audit event shape as batch 3 with a `claimed` discriminator.
5. **Tree marker.** [x] Not-yet-observed marker on zero-parameter curated driver groups, plus a default-off hide toggle next to the existing kind and origin filters.
6. **Registry view.** [x] Initially a peer table under `/parameter-admin/modules/registry`. Folded into the attribution tree: coverage chips, uncovered filter, and edit-dialog per-compatible detail; registry tab removed; queue claim retained.
7. **Upload summary.** [x] DTS upload responses include a one-shot `driverSummary`; `ProjectParameterFilesPanel` shows `DriverUploadSummaryDialog` after upload.
8. **Documentation and acceptance.** [x] ADR-0007 + CONTEXT, bilingual FRONTEND, API contract, acceptance IDs, domain-model + TD-045 notes.

## Risks

- **Registry loading.** `loadSchemaRegistry` reads the catalog and every vendor document from disk on each call, synchronously, inside the ingest transaction. Batch 1 changes when and how often that happens; a stale cache would make parse coverage disagree with actual matching. Key the cache on the catalog content hash and cover the invalidation with a test.
- **Prefix versus exact.** Parsing matches `vendor,sc85*`; registration does not. The state "parseable, unregistered" is legitimate and will be common. The coverage column must name the matching pattern, otherwise it reads as a defect and someone will "fix" it by adding prefix matching to the write path.
- **Naming on claim.** Claimed driver groups carry a machine name from `driverGroupDisplayNameFromCompatible`. Applying the declared display name promotes the module to curated, which is intended under ADR-0004 but must be an explicit, audited step rather than a side effect.
- **Scaffolding leftovers.** TD-045 modules (`i2c@…`, `pmic@0`, `batt`) are neither devices nor logical nodes and must not surface as drivers. The registry query reuses the queue's existing filter rather than inventing a second one.

## UI Interaction Automation

Behavior changes are user-facing, so requirement and operation IDs must be registered in `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md` **before** implementation starts.

| ID | Behavior | Status |
| --- | --- | --- |
| `DRV-REG-001` | Register a driver before any upload; it appears in the tree as a not-yet-observed driver group with a parse-coverage chip | Registered (Playwright stub) |
| `DRV-REG-002` | Claim an observed-but-unregistered driver from the queue or module tree; origin becomes curated | Registered (Playwright stub) |
| `DRV-REG-003` | Upload summary reports matched registered drivers and new unregistered compatibles | Registered (Playwright stub) |

## Documentation Impact Matrix

| Area | Action | Paths | Status |
| --- | --- | --- | --- |
| ADR | Update | `docs/adr/0007-driver-registry-is-a-view-over-curated-driver-groups.md` (new), `docs/adr/0006-*.md` follow-up | Done |
| Domain context | Update | `CONTEXT.md` glossary and ADR index | Done |
| Planning | Update | `docs/PLANS.md` active plan list | Done |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Done |
| API contract | Update | `docs/design-docs/api-contract.md` — registry query, register/claim, upload summary field | Done |
| Acceptance maps | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md` | Done |
| Product specs | Review | `docs/product-specs/product-spec.md` — no product-spec section names driver registration; vocabulary lives in ADR-0007 / FRONTEND | Reviewed — no change |
| Domain model | Review | `docs/design-docs/domain-model.md` — registration vocabulary + `logical` kind | Done |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md`, `docs/zh-CN/exec-plans/tech-debt-tracker.md` — TD-045 interaction with the registry view | Done |
| Generated schema | No change | — | No migration; the decision adds no tables or columns |
| Security / reliability | No change | — | — |

## Documentation Update Gate

Blocking. This plan cannot move to `completed/` until every `Update` and `Review` row is either updated or explicitly recorded as unchanged with evidence, the three `DRV-REG-*` IDs exist in both coverage maps, and `npm run docs:check` passes.

## Verification

```bash
npx vitest run server/modules/parameter-modules src/components/parameter-topology
npm run test:server -- --run server/modules/parameter-specs server/modules/parameter-files
npm run build
npm run docs:check
# playwright-cli: /parameter-admin/modules tree coverage chips at 1440x900, 768x1024, 390x844
```

## Deferred

- Prefix matching as an attribution lever (`match_mode` on `parameter_module_mappings`). Revisit only if exact registration proves unworkable at scale; it would need an ADR because it reopens ADR-0005.
- Platform-authored schema documents with property definitions.
- A persisted upload comparison report with history. The one-shot summary plus the queue is the agreed first cut.
- Moving the global parsing contract itself onto the platform; `schemas/dts` stays repository-managed.
