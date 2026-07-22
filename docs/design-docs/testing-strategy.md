# WiseEff Testing Strategy

> Chinese: [Chinese](../zh-CN/design-docs/testing-strategy.md)

Date: 2026-05-25

## Goals

WiseEff's test strategy upgrades the prototype into a product-quality gate. The test suite must cover domain rules, API contracts, key UI workflows, permission boundaries, async jobs, Agent tool governance, device gateway behavior, and operations evidence.

## Layers

| Layer | Goal | Tooling |
| --- | --- | --- |
| Domain unit tests | Pure rules, state machines, permissions, derived data | Vitest |
| Component tests | Page/component interaction, accessibility, edge states | Testing Library |
| API integration tests | Routes, database writes, transactions, error model | Vitest server tests |
| Contract tests | OpenAPI and DTO drift | Contract scripts |
| State-model tests | Workflow transitions and invariants | fast-check + Vitest |
| E2E tests | Login, parameter workflow, log upload, debugging | Playwright |
| Job tests | Worker retry, failure, idempotency | Queue/database tests |
| Agent tests | Tool permissions, approvals, structured output | Model mocks and golden cases |
| Device tests | Gateway reads/writes and failures | Simulator and HDC lab |
| Security tests | RBAC, authz, audit, validation | Automated negative cases |

## Browser Acceptance

Browser acceptance covers requirement IDs and operation IDs from `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`. Evidence-grade runs write replayable records under `docs/generated/acceptance-operation-evidence.md` and its index.

Evidence-grade artifacts do not live in Playwright's disposable `outputDir`. The full browser runner creates `test-results/acceptance-evidence-runs/runs/<sourceCommit>/<runId>/{records,artifacts}` and atomically publishes `latest-full.json` only after a clean-source full Playwright run and its operation evidence both pass. Records carry the same `runId` and `sourceCommit`; `npm run acceptance:evidence` rejects mixed identities and missing artifacts. Direct focused `acceptance:e2e` runs use an unpublished focused namespace and cannot replace or delete the latest full-run evidence.

Debugging admin catalog changes are covered by `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts`. The acceptance flow exercises Admin UI, API, DB persistence, and audit evidence for parameter create/edit/archive/restore plus HDC/ADB binding management and complex value metadata editing.

Hierarchical module trees are covered by `MOD-TREE-PARAM-001/002`, `MOD-TREE-DEBUG-001`, and `MOD-TREE-AUTHZ-001` in `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` (nested create, subtree filter, move/cycle guard, authz, and non-empty delete guards).

Simulator debugging is covered by `DEBUG-SIM-001` in `e2e/acceptance/debugging-simulator.acceptance.spec.ts`, including a complex JSON write path that records `valueKind`, digest, and preview metadata in `node_operations` without leaking full payloads into operation evidence.

Targeted unit coverage includes `server/modules/debugging/valueCodec.test.ts`, gateway preservation tests, admin/runtime UI tests, and DTO mapper tests for legacy scalar defaults.

## Key Commands

```bash
npm test
npm run test:server
npm run test:all
npm run build
npm run contract:check
npm run acceptance:models
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:evidence
npm run acceptance:quality
```

Xiaoze work should also run:

```bash
npm run test:server -- server/modules/agent/xiaoze/
npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
npm run build
```

These tests cover AG-UI endpoint wiring, read-only perception tools, mutating action approval/resume, LangGraph planning/checkpoint behavior, safe readiness evidence, and the existing WiseEff approval boundary for mutating tool plans. Set `XIAOZE_DETERMINISTIC=true` for offline acceptance without live `AGENT_API_*` values.

## Parameter Topology (round 4)

Round 4 closes parent-agent review blockers on branch `fix/parameter-topology-round4-review-blockers`. **TD-042 remains a BLOCKER** — these gates prove local/temp-DB behavior, not production cutover readiness.

| Area | Tests / command | Proves |
| --- | --- | --- |
| Vendor dt-schema | `server/modules/dts/goldenPowerFixture.test.ts`, `scripts/vendorDtSchemaGenerator.test.ts` | Deterministic linux-bindings from property specs; golden DTBs pass real `dt-validate`; negative fixtures fail with expected diagnostics |
| Golden counts | `goldenPowerFixture.test.ts` (176 properties), `seedM1DtsFiles.test.ts` (528 `dts_properties`), `matcher.test.ts`, `ingestService.test.ts` | Locked **176/528** topology/seed counts |
| Stage → finalize | `server/modules/parameter-topology/migration.test.ts` (temp PostgreSQL, reconnect, inject-fail) | Durable `stage-review` transaction; atomic `finalize`; cutover rejects non-`finalized` runs |
| Exact writeback | `server/modules/parameter-topology/editService.test.ts`, merge workflow tests | Occurrence-locked merge/writeback; immutable base; stale identity → `409` |
| Matcher / review scope | `server/modules/parameter-specs/matcher.test.ts`, `matcherScope.integration.test.ts` | Override isolation by node locator fingerprint; `blocker_scope` honored on validate/release |
| Manifest gates | `server/modules/parameter-topology/manifestBackfillMigration.test.ts`, `configRevisionManifest.test.ts`, `editService` needs_review paths | Backfill from `dts_config_revision_members`; `needs_review` fail-closed on edit/validate/release/writeback |
| Global-spec hotspots | `server/modules/parameters/dashboard/postCutoverDashboard.integration.test.ts` | Tenant projects include `organization_id IS NULL` vendor specs |
| Unmatched review | `server/modules/parameter-specs/service.test.ts`, `routes.test.ts` | `createSpec` + `confirmPropertyMismatch` with governance audit |
| Browser acceptance | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | `PARAM-SPEC-GOVERN-001` through `PARAM-CONFIG-PUBLISH-GATE-001`; no teaching fallback in API mode |

Toolchain gate before topology release work:

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameter-topology/migration.test.ts server/modules/parameter-specs/matcherScope.integration.test.ts --run
```

## Parameter Topology (round 5)

Round 5 closes parent-agent review blockers on branch `fix/parameter-topology-round5-review-blockers`. **TD-042 remains a BLOCKER** — these gates prove local/temp-DB behavior, not production cutover readiness.

| Area | Tests / command | Proves |
| --- | --- | --- |
| Immutable base vs candidate | `postCutoverWorkflow.integration.test.ts`, `editService.test.ts` | Base binding revision unchanged after merge/writeback; merged value on candidate revision only |
| Fail-closed writeback | `parameters/service` merge path, `writebackService`, `editService` toolchain gates | Missing `objectStore`, project scope, write lock, or toolchain fails closed; no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production bypass |
| Phase audit + run linkage | `migration.test.ts` (`parameter_identity_migration_phases`, `migration_run_id`) | Immutable `stage-review`/`finalize` phase rows; inferred tasks linked to staged run; cutover rejects forged status |
| Tenant-owned resolve | `parameter-specs/repository` `validateSpecReviewTenantEvidence`, cross-tenant PG tests | Resolve rejects cross-tenant evidence; 0055 does not trust raw evidence IDs |
| Draft→activate→resolve | `draftSpecWorkflow.integration.test.ts`, `parameter-specs/service.test.ts`, `routes.test.ts` | `createSpec` draft only; `activate` requires Admin + complete shape; resolve rejects draft specs |
| Acceptance fixture honesty | `e2e/acceptance/helpers/acceptanceTaskLookup.ts`, `semanticFixtureCleanup.ts`, topology/files/dts acceptance specs | No `items[0]` fallbacks; prefix-scoped FK-complete cleanup; draft→activate→resolve covered |

Round 5 toolchain gate (same as round 4):

```bash
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts server/modules/parameter-topology/migration.test.ts --run
```

### Parameter topology Round 6 review blockers

Round 6 closes remaining parent-agent review blockers on branch `fix/parameter-topology-round6-review-blockers`. **TD-042 remains a BLOCKER.**

| Area | Tests / command | Proves |
| --- | --- | --- |
| Evidence-only scope reconcile | `0058_*.sql`, `specReviewTenantEvidence.integration.test.ts` | Polluted historical FKs rebuilt/cleared from proven evidence; unproven resolved → open; idempotent + rollback |
| Lossless spec identity | `specIdentity.test.ts`, `draftSpecWorkflow.integration.test.ts` | `vendor,limit` ≠ `vendor-limit`; sanitize not in hash; collision audit fail-closed |
| Global activate authz | `globalSpecActivate.authz.test.ts` | Org Admin activate global draft → 403; org draft OK; read/bind global still allowed |
| Full valueShape activate | `DraftSpecActivatePanel.test.tsx`, `specCompleteness.ts` | gpio_int cellsPerGroup=3 preserved; incomplete shape blocks |
| Integrated DTS workbench | `ParametersPage.test.tsx`, `DtsParameterWorkbench.test.tsx`, `DtsTopologyNavigator.test.tsx`, `DtsBindingDetailDialog.test.tsx`, `DtsBindingDraftTray.test.tsx` | Mature `WorkbenchLayout` + nested semantic navigation, search/filter, raw value/shape/provenance detail, current edits, project-safe typed submission, and responsive accessibility; no legacy recommendation/teaching fallback |
| Tenant-scoped cleanup | `semanticFixtureCleanup.isolation.test.ts` | Same-name Config Sets in other org/project untouched |
| Submit→review→merge acceptance | `parameter-topology.acceptance.spec.ts`, `disposablePostCutoverRuntime.ts` | Drives the integrated DTS workbench through semantic search/tree/detail/current-edits, then automatically creates a disposable DB, applies migrations+identity cutover, verifies marker/run identity, and proves real set/delete role chains, writeback, candidate AST/tombstone, reload, and base immutability before dropping the DB. Delete authoring/submission uses public APIs because no delete UI control exists; role decisions and merge remain UI operations. |
| Assignee/review UI acceptance | `parameters-negative.acceptance.spec.ts`, `parameters.acceptance.spec.ts` | Three visible selectors use API-scoped eligible users; production HMAC browser identities perform each hardware/software/merge UI action. DB role queries or one Admin token cannot replace these operations. |
| Project switch isolation | `ApiProjectTopologyWorkspace.test.tsx` rerender + deferred-response regressions, browser interaction | A project-A candidate/draft/messages cannot influence project B; B starts at `current`; late project-A draft responses are ignored and cannot load B assignees. |
| Evidence run isolation | `check-operation-evidence.test.ts`, `run-browser-acceptance.test.ts` | Full records/artifacts share one run+commit namespace; focused runs preserve `latest-full`; mixed runs fail closed. |
| Binding submission identity | `routes.test.ts`, `postCutoverWorkflow.integration.test.ts`, migrations `0059`–`0063` | HTTP keeps draft/binding/spec/action and returns the exact candidate ID. Two real PG connections prove candidate status mutation waits while submission holds draft+candidate locks; submission promotes `draft -> pending_approval` and persists the ID on item/request. Merge rejects missing/changed candidate status, set value, or delete proof. Upgrade tests cover 0061 all-origin invalidation and 0063 transactional/idempotent schema application. |
| Typed delete lifecycle | `schemas.test.ts`, `postCutoverWorkflow.integration.test.ts`, `parameter-topology.acceptance.spec.ts` | `delete` requires an empty target, persists through draft/submission/CR/audit, proves candidate binding absence plus matching occurrence effect, writes `/delete-property/`, re-ingests/validates, leaves no replacement binding revision, and reloads absent after real role review/merge. |
| test:all stability | App API-runtime isolation, unique dashboard fixture namespaces, FIFO queries on each transactional PG client | Default `npm run test:all` without ad-hoc worker overrides or global timeout inflation |

Do not cut over a shared developer/acceptance database merely to make the topology acceptance green. The topology spec owns a disposable `wiseeff_acceptance_disposable_*` database and verifies its test marker before destructive cleanup. Keep TD-042 open until the separate clean-snapshot rehearsal is complete.
