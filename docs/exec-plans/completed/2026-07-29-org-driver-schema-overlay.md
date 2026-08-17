# Organization driver schema overlay — execution plan
> Status: **Completed 2026-08-17 (archive round 2)** — implementation is on `main`.

## Goal

Make "解析未覆盖" fixable from the product. An Admin who registers a driver group whose exact `compatible` no pinned schema claims can author an organization-owned manual driver schema — exact compatible plus property definitions — which merges into `SchemaRegistry` as the lowest releasable tier. Subsequent uploads match it at ingest, and already-uploaded devices pick it up on activation rather than requiring a re-upload. `schemas/dts` stays repository-managed and product-read-only (ADR-0008).

## Status

Implementation complete on `main` (PRs #209 / #210). Batches 1–8 done. Remaining `DRV-SCHEMA-*` Playwright stubs are not open product work.

**Retroactive `schemaState` decision (locked):** Historical binding-revision `schemaState` stays immutable. Activation upgrades provisional/manual `parameter_specs` in place so the current view reads typed definitions; the UI may distinguish "spec defined, revision predates it" rather than rewriting past revisions.

## Git & PR Workflow

- Feature branch: `feat/org-driver-schema-overlay` (cut from `feat/driver-registry` worktree baseline).
- Implementation commits on the feature branch only.
- Parent agent opens and merges the GitHub PR, then syncs local `main`.

## Domain decisions

Settled by ADR-0008; do not relitigate without updating it.

- Authored parsing support is **driver-scoped and organization-scoped**. The pinned file layer is global and stays read-only from the product.
- Overlay drivers are `source = 'manual'`. Precedence needs no new rule: `matchDriver` already picks `manual` only when no linux or vendor driver matches, and `matchProperty` already places `manual` last as gap-fill.
- **Exact compatible only.** Prefix patterns remain a repository privilege, consistent with ADR-0005 and ADR-0007.
- Additive only. An overlay never edits, hides, or overrides a pinned document.
- `draft → active` lifecycle with audit. `isReleasableDriver` already excludes drafts, so a half-authored driver cannot reach ingest.
- The overlay is **input to matching**, not a spec store. Once a property matches, upsert paths produce `parameter_specs` / `dts_property_specs` rows; overlay property ids use `buildManualSpecIds` so they share identity with provisional surface rows.
- The spec review queue keeps its job: properties under a *matched* driver that the schema does not define. `createOrgManualParameterSpec` is unchanged.

## Architecture

Two registry call sites are organization-aware:

- `server/modules/parameter-topology/ingestService.ts` — matching via `getCachedOrganizationSchemaRegistry`.
- `server/modules/parameter-modules/service.ts` — parse coverage for the tree via the same accessor.

Pinned base stays sync/cached on `catalog.vendorContentHash`. Org overlay merges async and caches on `(organizationId, contentHash, overlayDigest)`.

## Batches

1. **Storage.** [x] Migration `0076` + `0077` (properties link `parameter_spec_id`) + repository CRUD.
2. **Materialization and cache.** [x] Overlay → `DriverSchema`/`PropertySpec` from linked ParameterSpecs; org-aware cache; precedence tests.
3. **Ingest and coverage share one instance.** [x] Both call sites repointed; overlay upsert writes org-scoped manual specs; `driver_schemas.organization_id` set for overlays.
4. **API.** [x] Admin CRUD + activate/deprecate under `/api/v2/organization-driver-schemas`; properties accept `parameterSpecId` or create-into-library shape; reject pinned-covered; audit.
5. **Authoring UI.** [x] Port/HTTP/mock + `OrganizationDriverSchemaDialog` links definition library or creates ParameterSpecs, from uncovered chip.
6. **Coverage semantics.** [x] Chip distinguishes organization overlay vs platform.
7. **Retroactive activation.** [x] Activate upgrades provisional specs via linked / `buildManualSpecIds` identity; resolves review tasks.
8. **Documentation and acceptance.** [x] Bilingual FRONTEND, API contract, domain model, ADR-0008 note, `DRV-SCHEMA-*` IDs, generated schema note.

## Retroactive design

Unmatched properties are not invisible today. When `matchProperty` returns unmatched and `isParameterSurfaceRow` passes, ingest calls `upsertProvisionalSurfacePropertySpec`, which creates an organization-owned `parameter_specs` row with a draft version, an empty `constraints`, and no units or documentation, then binds it. The operator sees the parameter without semantics.

That provisional writer and the review queue's `createOrgManualParameterSpec` both derive their identifiers from `buildManualSpecIds({ organizationId, propertyKey, driverModule })`, so they already resolve to the same row. **Overlay property materialization should use that same identifier formula rather than the pinned `pspec:{schemaNamespace}:{propertyKey}` shape.** Then the provisional spec and the overlay-matched spec are one row from the start, and activation becomes an in-place upgrade — fill `value_shape`, `units`, `constraints`, `documentation`, flip the version lifecycle from `draft` to `active` — with no change to `parameter_spec_id`. Existing bindings gain semantics without being rebound, which matters because binding revisions were made immutable by the round-5 work and rebinding would fight that.

Two things must be settled inside this batch rather than assumed:

- **Identifier derivation must match exactly.** Ingest computes `driverModule` from `matchable.compatible[0]?.split(",").pop()`; the overlay must reproduce that from its own compatible or the upgrade will silently create a second row instead of upgrading the first. Cover it with a test that ingests unmatched, activates an overlay, and asserts one spec row.
- **Historical `schemaState` is immutable.** Revision rows recorded what was known at ingest and should stay honest. The current view therefore still reads non-valid until the next revision. Decide explicitly whether activation re-validates the latest revision as a new audited revision, or whether the UI distinguishes "spec now defined, revision predates it". Do not leave this to the implementer.

Review tasks whose property the overlay now defines must be resolved with a provenance reference to the activation, not left open.

## Risks

- **Sync to async registry seam.** The registry is currently a synchronous file read on the ingest hot path. Batch 2 changes its shape for every caller. A partial migration where one call site sees the overlay and the other does not reproduces exactly the disagreement ADR-0007's cache was introduced to prevent. Repoint both call sites in one batch and assert equality in a test.
- **Reproducibility.** Re-ingesting the same DTS after an overlay change legitimately produces different bindings. Without the overlay version on provenance, "why did this revision parse differently" is unanswerable. Batch 3 is not optional.
- **Cross-tenant cache leakage.** A shared process cache keyed only on `schemasRoot` would serve one organization's overlay to another. The organization segment in overlay ids is a second line of defence, not the primary one; the cache key is.
- **Double authoring.** An organization may already hold manual `parameter_specs` for the same property key through the review queue. The overlay must not create a competing definition silently; batch 5 should surface the existing spec when prefilling.
- **Overlay drift from vendor releases.** When a pinned vendor schema later claims the compatible, the overlay stops matching. That is correct precedence, but batch 6 must say so in the UI or the operator will file it as data loss.
- **Retroactive expectations.** Attribution rules already apply to existing bindings through the apply path in `parameter-modules/service.ts`, so operators will expect parsing to behave the same way. Batch 7 closes the gap, but if it slips, the shipped feature silently means "next upload only" and the workaround — re-uploading the same DTS — leaves duplicate provisional rows behind. Do not ship batches 1–6 without either batch 7 or an explicit in-product statement of the limitation.
- **Silent double-write on upgrade.** The in-place upgrade depends on the overlay reproducing `buildManualSpecIds` exactly. A mismatched `driverModule` derivation produces a second spec row that looks correct in isolation and leaves the original provisional binding untouched, which is the hardest class of bug here to notice.

## UI Interaction Automation

Behavior is user-facing. Register IDs in `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md` **before** implementation.

| ID | Behavior | Status |
| --- | --- | --- |
| `DRV-SCHEMA-001` | Author a draft overlay schema from an uncovered driver group, activate it, and see the coverage chip change to overlay-covered | Registered (Playwright stub) |
| `DRV-SCHEMA-002` | Upload a DTS whose compatible only the overlay claims; properties bind and no longer enter the unmatched review queue | Registered (Playwright stub) |
| `DRV-SCHEMA-003` | An overlay cannot be activated for a compatible a pinned schema already covers, and the rejection explains why | Registered (Playwright stub) |
| `DRV-SCHEMA-004` | Activating an overlay for an already-uploaded device gives existing parameters their type, units, and documentation without a re-upload, and closes their review tasks | Registered (Playwright stub) |

## Documentation Impact Matrix

| Area | Action | Paths | Status |
| --- | --- | --- | --- |
| ADR | Update | `docs/adr/0008-platform-authored-parsing-is-an-org-scoped-overlay.md` | Done |
| Domain context | Update | `CONTEXT.md` — ADR index + glossary | Done |
| Planning | Update | `docs/PLANS.md` active plan list | Done |
| Frontend | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | Done |
| API contract | Update | `docs/design-docs/api-contract.md` | Done |
| Domain model | Update | `docs/design-docs/domain-model.md` | Done |
| Generated schema | Update | `docs/generated/db-schema.md` — migrations `0076`/`0077` | Done |
| Acceptance maps | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, zh-CN companions | Done |
| Security | Review | Admin-only authoring; org-scoped overlay cannot shadow pinned schemas | Reviewed — no SECURITY.md change |
| Reliability | Review | Org registry cache invalidation on overlay mutate | Reviewed — no RELIABILITY.md change |
| Product specs | Review | Vocabulary lives in ADR-0008 / FRONTEND | Reviewed — no change |
| Tech debt | Review | No new deferred blockers beyond plan Deferred | Reviewed — no TD row |
| Runbooks | No change | — | No change |

## Documentation Update Gate

Blocking. This plan cannot move to `completed/` until every `Update` and `Review` row is updated or explicitly recorded as unchanged with evidence, the four `DRV-SCHEMA-*` IDs exist in both coverage maps, and `npm run docs:check` passes.

## Verification

```bash
npx vitest run server/modules/parameter-specs server/modules/parameter-modules
npm run test:server -- --run server/modules/parameter-topology
npx vitest run src/components/parameter-topology src/components/admin
npm run build
npm run docs:check
# playwright-cli: /parameter-admin/modules overlay authoring at 1440x900, 768x1024, 390x844
```

## Deferred

- Prefix patterns for overlay drivers. Overlapping prefixes across the pinned tier and the overlay need a precedence rule that reopens ADR-0005.
- Promoting a proven overlay into `schemas/dts` through the product (export or PR generation). Copying the YAML by hand is the first cut.
- Sharing an overlay across organizations, or a platform-curated review of overlays.
- Overlay authoring for `nodename`-selected drivers; compatible only for now.
