# T2.2-CGH catalog/governance consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-cgh-catalog-governance-acceptance.md)

Status: **T2.2-CGH local candidate complete.** Design Spec FAIL then PASS with P2; implementation Standards PASS with P2; implementation Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). Formal SEALED, commit, PR, merge, Hosted, target and Issue updates are not performed.

Contract: [threat matrix](t22-cgh-catalog-governance-threat-matrix.md), [design](t22-cgh-catalog-governance-design.md), [design Spec review](t22-cgh-catalog-governance-spec-review.md), [implementation review](t22-cgh-catalog-governance-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- Accepted main: `46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T2.1 remain uncommitted dirty work on the same tree. No commit.

## Behaviour delivered

Winning `registerParameterSpecRoutes` `POST /api/v2/parameter-specs` (admin definition-library mint) returns **410** `CatalogLegacyGoneResponse` `reason: "legacy-surface-retired"` successor `/api/v2/catalog`, **gone-first** (no db, no auth, no body parse). Spec-review `createSpec` stays on `POST /api/v2/parameter-spec-review-tasks/:taskId/resolve`. List and detail `view=governance`, activate, overlay, PATCH/deprecate/restore/reattribute/cutover stay 2xx.

Catalog definition library remains #847 CatalogPage + `parameter-catalog-api`. `parameterAdminClient.invokeRetiredLegacyWrite` unchanged.

## Classification (T22C-01)

S12-CGH shard still **1804** entries in **123** file×rule groups (table below). **0 unexplained.** Four labels:

| Class | Count | Notes |
| --- | --- | --- |
| canonical-current-catalog | 0 | `parameterAdminClient.ts` already 0 shard rows |
| canonical-current-dts-spec | 1193 | production `parameter-specs/**` including list/detail governance HTTP and overlay |
| exact-canonical-history | 611 | 609 tests + 2 e2e import-wizard rows |
| archived-notice | 0 | POST path token remains; `createParameterSpec` remains in `service.ts` |

Full file×rule groups (123 / 1804):

| n | file | rule | class |
| --- | --- | --- | --- |
| 118 | `server/modules/parameter-specs/driverSchemaOverlayRepository.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 108 | `server/modules/parameter-specs/service.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 90 | `server/modules/parameter-specs/definitionVerification.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 56 | `server/modules/parameter-specs/effectiveDefinitionService.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 52 | `server/modules/parameter-specs/repository.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 44 | `server/modules/parameter-specs/driverSchemaOverlayService.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 44 | `server/modules/parameter-specs/reviewApply.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 43 | `server/modules/parameter-specs/driverSchemaOverlayRepository.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 42 | `server/modules/parameter-specs/definitionReconciliation.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 42 | `server/modules/parameter-specs/repository.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 36 | `server/modules/parameter-specs/specIdentity.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 34 | `server/modules/parameter-specs/driverSchemaPromotion.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 33 | `server/modules/parameter-specs/routes.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 30 | `server/modules/parameter-specs/service.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 29 | `server/modules/parameter-specs/routes.ts` | legacy-catalog-route | canonical-current-dts-spec |
| 28 | `server/modules/parameter-specs/driverSchemaOverlayRepository.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 27 | `server/modules/parameter-specs/driverSchemaOverlayService.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 26 | `server/modules/parameter-specs/propertyKeyCutover.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 26 | `server/modules/parameter-specs/specCompleteness.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 24 | `server/modules/parameter-specs/service.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 19 | `server/modules/parameter-specs/driverSchemaOverlayRepository.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 18 | `server/modules/parameter-specs/coverageClaim.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 16 | `server/modules/parameter-specs/driverSchemaOverlayMaterialize.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 15 | `server/modules/parameter-specs/definitionReconciliation.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 15 | `server/modules/parameter-specs/definitionReconciliation.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 14 | `server/modules/parameter-specs/repository.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 12 | `server/modules/parameter-specs/driverSchemaOverlayMaterialize.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 12 | `server/modules/parameter-specs/effectiveDefinitionService.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 11 | `server/modules/parameter-specs/effectiveDefinitionService.ts` | legacy-effective-governance-contract | canonical-current-dts-spec |
| 10 | `server/modules/parameter-specs/effectiveDefinition.ts` | legacy-effective-governance-contract | canonical-current-dts-spec |
| 10 | `server/modules/parameter-specs/propertyKeyCutover.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 10 | `server/modules/parameter-specs/propertyKeyCutover.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 9 | `server/modules/parameter-specs/coverageClaim.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 9 | `server/modules/parameter-specs/coverageClaim.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 9 | `server/modules/parameter-specs/driverSchemaOverlayService.ts` | legacy-catalog-raw-read | canonical-current-dts-spec |
| 8 | `server/modules/parameter-specs/driverSchemaOverlayService.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 8 | `server/modules/parameter-specs/schemas.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 8 | `server/modules/parameter-specs/schemas.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 7 | `server/modules/parameter-specs/driverSchemaPromotion.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 7 | `server/modules/parameter-specs/schemaRegistryCache.ts` | legacy-overlay-catalog-contract | canonical-current-dts-spec |
| 6 | `server/modules/parameter-specs/matcher.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 5 | `server/modules/parameter-specs/service.ts` | legacy-effective-governance-contract | canonical-current-dts-spec |
| 3 | `server/modules/parameter-specs/definitionVerification.ts` | legacy-effective-governance-contract | canonical-current-dts-spec |
| 3 | `server/modules/parameter-specs/repository.ts` | legacy-effective-governance-contract | canonical-current-dts-spec |
| 3 | `server/modules/parameter-specs/repository.ts` | unresolved-boundary-expression | canonical-current-dts-spec |
| 3 | `server/modules/parameter-specs/reviewApply.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 2 | `server/modules/parameter-specs/coverageClaim.ts` | legacy-catalog-sql-write | canonical-current-dts-spec |
| 2 | `server/modules/parameter-specs/effectiveDefinitionService.ts` | unresolved-boundary-expression | canonical-current-dts-spec |
| 2 | `server/modules/parameter-specs/schemaLoader.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 2 | `server/modules/parameter-specs/types.ts` | legacy-parameter-spec-identifier | canonical-current-dts-spec |
| 1 | `server/modules/parameter-specs/definitionReconciliation.ts` | unresolved-boundary-expression | canonical-current-dts-spec |
| 1 | `server/modules/parameter-specs/definitionVerification.ts` | unresolved-boundary-expression | canonical-current-dts-spec |
| 1 | `server/modules/parameter-specs/routes.ts` | legacy-effective-governance-contract | canonical-current-dts-spec |
| 60 | `server/modules/parameter-specs/effectiveDefinition.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 30 | `server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 25 | `server/modules/parameter-specs/definitionReconciliation.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 22 | `server/modules/parameter-specs/propertyKeyCutover.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 20 | `server/modules/parameter-specs/specReviewTenantEvidence.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 19 | `server/modules/parameter-specs/driverSchemaOverlayService.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 18 | `server/modules/parameter-specs/driverSchemaOverlayRepository.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 18 | `server/modules/parameter-specs/propertyKeyCutover.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 18 | `server/modules/parameter-specs/service.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 17 | `server/modules/parameter-specs/driverSchemaOverlayService.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 15 | `server/modules/parameter-specs/effectiveDefinition.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 15 | `server/modules/parameter-specs/populatedUpgrade.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 14 | `server/modules/parameter-specs/specIdentity.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 14 | `server/modules/parameter-specs/specIdentityCorrection.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 13 | `server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 12 | `server/modules/parameter-specs/driverSchemaOverlayRepository.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 11 | `server/modules/parameter-specs/definitionReconciliation.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 11 | `server/modules/parameter-specs/effectiveDefinition.test.ts` | legacy-effective-governance-contract | exact-canonical-history |
| 11 | `server/modules/parameter-specs/specIdentitySurrogate.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 11 | `server/modules/parameter-specs/specLifecycle.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 10 | `server/modules/parameter-specs/driverSchemaOverlayService.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 10 | `server/modules/parameter-specs/driverSchemaOverlayService.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 10 | `server/modules/parameter-specs/effectiveDefinition.integration.test.ts` | legacy-effective-governance-contract | exact-canonical-history |
| 10 | `server/modules/parameter-specs/specReviewTenantEvidence.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 9 | `server/modules/parameter-specs/specIdentitySurrogate.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 9 | `server/modules/parameter-specs/specVersionCutover.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 8 | `server/modules/parameter-specs/driverSchemaOverlayMaterialize.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 8 | `server/modules/parameter-specs/propertyKeyCutover.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 8 | `server/modules/parameter-specs/specReviewApply.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 8 | `server/modules/parameter-specs/specReviewTenantEvidence.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 7 | `server/modules/parameter-specs/driverSchemaOverlayRepository.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 7 | `server/modules/parameter-specs/effectiveDefinition.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 7 | `server/modules/parameter-specs/matcherScope.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 7 | `server/modules/parameter-specs/matcherScope.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 7 | `server/modules/parameter-specs/specIdentitySurrogate.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 7 | `server/modules/parameter-specs/specVersioning.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 6 | `server/modules/parameter-specs/populatedUpgrade.integration.test.ts` | legacy-effective-governance-contract | exact-canonical-history |
| 6 | `server/modules/parameter-specs/specReviewApply.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 6 | `server/modules/parameter-specs/specVersionCutover.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 5 | `server/modules/parameter-specs/definitionReconciliation.integration.test.ts` | legacy-effective-governance-contract | exact-canonical-history |
| 5 | `server/modules/parameter-specs/driverSchemaOverlayMaterialize.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 5 | `server/modules/parameter-specs/matcherScope.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 5 | `server/modules/parameter-specs/specCompleteness.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 5 | `server/modules/parameter-specs/specReviewApply.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 4 | `server/modules/parameter-specs/driverSchemaOverlayMaterialize.platform.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 4 | `server/modules/parameter-specs/driverSchemaOverlayRepository.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 4 | `server/modules/parameter-specs/repository.attributionModules.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 4 | `server/modules/parameter-specs/specLifecycle.integration.test.ts` | legacy-catalog-route | exact-canonical-history |
| 3 | `server/modules/parameter-specs/createParameterSpec.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 3 | `server/modules/parameter-specs/driverSchemaOverlayMaterialize.platform.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 3 | `server/modules/parameter-specs/globalSpecActivate.authz.test.ts` | legacy-catalog-route | exact-canonical-history |
| 3 | `server/modules/parameter-specs/globalSpecActivate.authz.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 3 | `server/modules/parameter-specs/specIdentityCorrection.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 3 | `server/modules/parameter-specs/specVersioning.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 2 | `server/modules/parameter-specs/createParameterSpec.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 2 | `server/modules/parameter-specs/createParameterSpec.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 2 | `server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts` | legacy-catalog-sql-write | exact-canonical-history |
| 2 | `server/modules/parameter-specs/driverSchemaPromotion.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 2 | `server/modules/parameter-specs/driverSchemaPromotion.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 2 | `server/modules/parameter-specs/matcher.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 2 | `server/modules/parameter-specs/populatedUpgrade.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 2 | `server/modules/parameter-specs/populatedUpgrade.integration.test.ts` | unresolved-boundary-expression | exact-canonical-history |
| 2 | `server/modules/parameter-specs/schemaLoader.releasability.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 2 | `server/modules/parameter-specs/specIdentityCorrection.integration.test.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 2 | `server/modules/parameter-specs/specReviewTenantEvidence.integration.test.ts` | unresolved-boundary-expression | exact-canonical-history |
| 2 | `server/modules/parameter-specs/specVersionCutover.integration.test.ts` | legacy-parameter-spec-identifier | exact-canonical-history |
| 1 | `e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` | legacy-catalog-raw-read | exact-canonical-history |
| 1 | `e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` | legacy-catalog-table-name | exact-canonical-history |
| 1 | `server/modules/parameter-specs/createParameterSpec.integration.test.ts` | legacy-overlay-catalog-contract | exact-canonical-history |
| 1 | `server/modules/parameter-specs/globalSpecActivate.authz.test.ts` | legacy-catalog-raw-read | exact-canonical-history |

## Ratchet (T22C-08)

| Measure | Before | After | Delta |
| --- | --- | --- | --- |
| S12-CGH | 1804 | 1804 | 0 |
| All shards | 3513 | 3513 | 0 |

Honest zero delta: 410 landed; remaining tokens in the same family files (`service.ts` `createParameterSpec`, `schemas.ts` body schema, GET `/api/v2/parameter-specs*`). Shard not edited. No checker weakening, no growth, no fixture rewrite.

Full `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` **did not complete**: `Runtime topology relocation rejected: destination whole-file blob for e2e/acceptance/parameter-import-wizard.acceptance.spec.ts` (pre-existing T2.1 dirty file; not a CGH edit).

## Verification (do not sum)

Helper PG: `postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t22_cgh` (created this todo; not `wiseeff_lane_849`, not compose `5432/wiseeff`). No UI sweep (API mode CatalogPage does not POST mint).

| Command | Result |
| --- | --- |
| `DATABASE_URL=…55438/wiseeff_t22_cgh npm run test:server -- parameterSpecHttpAdapter.test.ts` | **5 passed** (gone-first mint 410, unauthenticated 410, governance list/detail/resolve/activate not 410) |
| same env `test:server -- routes.test.ts parameterSpecHttpAdapter.test.ts` | **27 files, 292 passed** including topology routes, catalog-api legacy isolation, catalogProjectValueRoutes |
| `npx tsc -b` | **passed** |
| `git diff --check` on CGH code files | **passed** |
| `parameter-catalog-boundaries:check --trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` | **did not complete** (T2.1 import-wizard relocation blob) |

## Remaining limits

- List `view=governance` still 2xx until T2.2-MOD.
- Detail `view=governance` still 2xx until T1.4 / successor draft-read.
- PATCH/lifecycle/cutover still 2xx until T2.2-TOP.
- Topology HTTP `createParameterSpec` will now 410 in API mode; CatalogPage is the library when catalog ports are injected.
- Full boundary checker blocked by T2.1 dirty import-wizard relocation (Spec impl P2; 1804/3513 from shard state, not a finished checker).
- Adapter tests: unauthenticated mint 410 overlaps gone-first invalid-body (Standards P2); keep-2xx cases only assert not 410 without db (same pattern as the pre-existing GET adapter test).
- No T2.2-TOP, no commit.

## Non-goals kept

No overlay rewrite, no CatalogPage rewrite, no T1.4 zero-allowance, no Hosted/target/Issue mutation.
