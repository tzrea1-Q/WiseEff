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

## Style Contract Tests

Stylesheet contract tests query selectors, at-rules, and declarations through
`src/test/cssAssertions.ts`; they do not match the formatting of raw CSS text.
The error-level ESLint rule `wiseeff/no-raw-css-text-assertions` prevents direct
`toMatch`/`toContain` assertions over CSS file reads while leaving unrelated
source-contract tests outside its scope. Rendered behavior and computed visual
outcomes remain owned by Testing Library and the Playwright quality gates.

## Browser Acceptance

Browser acceptance covers requirement IDs and operation IDs from `docs/developer/browser-acceptance-coverage-map.md` and `docs/developer/user-operation-coverage-matrix.md`. Evidence-grade runs write replayable records under `docs/generated/acceptance-operation-evidence.md` and its index.

Evidence-grade artifacts do not live in Playwright's disposable `outputDir`. The full browser runner creates `test-results/acceptance-evidence-runs/runs/<sourceCommit>/<runId>/{records,artifacts}` and atomically publishes `latest-full.json` only after a clean-source full Playwright run and its operation evidence both pass. Records carry the same `runId` and `sourceCommit`; `npm run acceptance:evidence` rejects mixed identities and missing artifacts. Direct focused `acceptance:e2e` runs use an unpublished focused namespace and cannot replace or delete the latest full-run evidence.

Debugging admin catalog changes are covered by `DEBUG-ADMIN-001` in `e2e/acceptance/debugging-admin.acceptance.spec.ts`. The acceptance flow exercises Admin UI, API, DB persistence, and audit evidence for parameter create/edit/archive/restore plus HDC/ADB binding management and complex value metadata editing.

Hierarchical module trees are covered by `MOD-TREE-PARAM-001/002`, `MOD-TREE-DEBUG-001`, and `MOD-TREE-AUTHZ-001` in `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` (nested create, subtree filter, move/cycle guard, authz, and non-empty delete guards).

Module attribution (compatible queue, classify preview/apply, kind-scoped tree, importance inheritance) is covered by `MOD-ATTR-QUEUE-001`, `MOD-ATTR-CLASSIFY-001`, `MOD-ATTR-BULK-001`, `MOD-ATTR-TREE-001`, and `MOD-ATTR-IMPORTANCE-001` in `e2e/acceptance/parameter-topology.acceptance.spec.ts` (see `docs/exec-plans/completed/2026-07-27-module-attribution-redesign.md`).

Simulator debugging is covered by `DEBUG-SIM-001` in `e2e/acceptance/debugging-simulator.acceptance.spec.ts`, including a complex JSON write path that records `valueKind`, digest, and preview metadata in `node_operations` without leaking full payloads into operation evidence.

Targeted unit coverage includes `server/modules/debugging/valueCodec.test.ts`, gateway preservation tests, admin/runtime UI tests, and DTO mapper tests for legacy scalar defaults.

Quality and acceptance Playwright configs (`playwright.quality.config.ts`, `playwright.acceptance.config.ts`) run a `runtime-warmup` dependency project before product specs. After the webServer reports ready, warmup loads the SPA entry via `page.goto` so Vite's first transform is not billed to the first a11y/visual/responsive or acceptance case; product spec timeouts are unchanged.

The populated `/parameter-review` visual case is evidence-owned test data, not a general seed. An isolated runner opts in with both `WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true` and `WISEEFF_QUALITY_FIXTURE_DATABASE_NAME=<current_database()>`; the seed/cleanup scripts verify the live database name and exact ownership of their fixed IDs before any mutation. Target synthetic runs omit both variables and planned-skip only this one write-dependent visual case, so they remain read-only while the other visual routes and all a11y/responsive cases still run. Volatile values that must remain visible, such as the organization creation clock, are normalized at the test read seam instead of being hidden by a screenshot mask.

The committed Linux visual snapshots are merge-authoritative only when adopted from the GitHub Actions `Acceptance quality` runner artifact. That runner is the environment that enforces them on pull requests, including its production/HMAC seed identity and installed CJK font stack. The repository-compatible local MCR Playwright arm64 container remains a useful Linux preflight, but its rendered screenshots must not replace committed Linux baselines when they differ from a reviewed GitHub runner artifact. Adopt only the exact failed images after inspecting each actual at original resolution; never run a wholesale snapshot update.

## M5.12 CI And Synthetic Evidence

M5.12 archives CI and target synthetic evidence on top of the deterministic browser gates. The merge bar is **L1**, not the full local-non-HDC suite:

- Every PR starts `ci.yml` (job-level `if:` skip only). `detect` classifies the diff and always runs `docs:check`.
- Product and workflow PRs run `build-and-test` plus `@ci-smoke` (`npm run acceptance:smoke`). UI or product paths also run one `acceptance:quality-run`.
- Docs-only PRs run `detect` + `docs:check` + sentinel `Merge bar`.
- L2 events run `acceptance-quality` as a sibling (one `acceptance:quality-run`) plus `acceptance-local-non-hdc` on `push` to `main`, the nightly schedule, label `full-acceptance`, and `workflow_dispatch` `local-non-hdc`. The local browser job runs `npm run acceptance:models` and then the authoritative `npm run acceptance:gate0`. Gate0 verifies pinned DTS tooling before provisioning, owns one fresh PostgreSQL database, one run-scoped object store, exact loopback API/frontend processes, and a shared secret-free descriptor for visual plus full browser acceptance. Its 60-minute owner deadline includes provisioning and finalization; Playwright outputs, reports, snapshots, preflight, and generated evidence stay under the run root. Failure retains exact forensic resources, while success alone removes the owned database/object store. Before CI upload, Gate0 redacts credentials recursively (including ZIP trace entries) and a separate fail-closed scanner must report zero secret-bearing paths. The legacy `npm run acceptance:browser -- --mode local-non-hdc` remains a direct/manual runner and is not the authoritative owned-runtime L2 gate.

Manual `workflow_dispatch` can select `target-non-hdc` or `full-pilot`. Those runs use `--no-start-runtime`, target frontend/API URLs, GitHub Secrets, and uploaded Playwright/evidence artifacts. `full-pilot` is never a default PR gate and remains valid only with external HDC, backup/restore, rollback, object-store, worker, and live Agent evidence. Smoke uses the focused evidence namespace and must not publish `latest-full.json`.

## Key Commands

```bash
npm test
npm run test:server
npm run test:scripts
npm run bridge:test
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

These tests cover AG-UI endpoint wiring, read-only perception tools, mutating action approval/resume, LangGraph planning/checkpoint behavior, safe readiness evidence, and the existing WiseEff approval boundary for mutating tool plans. Set `XIAOZE_DETERMINISTIC=true` for offline acceptance without live `XIAOZE_LLM_API_BASE_URL`, `XIAOZE_LLM_MODEL`, and `XIAOZE_LLM_API_KEY` values.

## Log Analysis Eval (two layers)

Log analysis carries a two-layer AI evaluation system alongside the ordinary suites:

- **Behavior-layer eval** (`npm run logs:eval`, CI-gated, zero API cost): deterministic scripted models drive the real kernels — the P1 single-shot analyzer plus the P2 bounded agent loop (scripted tool-call sequences + final conclusions through `server/modules/logs/analyzer/scriptedModel.ts`). Scenarios pin grounding, honest degradation marking, tool-call legality (illegal names/arguments rejected and corrected), step/token-budget convergence with capped confidence, and honest refusal on insufficient evidence. Meta self-checks prove the harness flags known-bad behaviors (hallucinated citations, silent degradation, overconfident early convergence, silently accepted illegal tools). Report: `docs/generated/log-analysis-eval.{json,md}`.
- **Quality-layer eval** (`npm run logs:eval:quality`, on prompt/model change and pre-release): runs the current kernel over the golden case set (`eval-cases/logs/`, loader-validated `log.txt` + `case.yaml` pairs). Deterministic metrics (evidence-line overlap hit/missed/extra, hallucination rate, refusal appropriateness) are computed in-process; root-cause correctness goes through a rubric judge seam — `LOG_ANALYSIS_JUDGE_*` LLM-as-judge in real mode, a deterministic scriptable stub offline. Only `realLog: true` cases count toward the baseline gate (`eval-cases/logs/baseline.json`, tolerances stated in the report); synthetic cases document format coverage. Report: `docs/generated/log-analysis-quality.{json,md}`.

Prompt changes bump `LOG_ANALYSIS_PROMPT_VERSION` / `LOG_ANALYSIS_LOOP_PROMPT_VERSION` and must keep `logs:eval` green; golden-set annotation and de-identification rules live in `eval-cases/logs/README.md`.

## Parameter Topology (round 4)

Round 4 closes parent-agent review blockers on branch `fix/parameter-topology-round4-review-blockers`. **TD-042 remains a BLOCKER** — these gates prove local/temp-DB behavior, not production cutover readiness.

| Area | Tests / command | Proves |
| --- | --- | --- |
| Vendor dt-schema | `server/modules/dts/goldenPowerFixture.test.ts`, `scripts/vendorDtSchemaGenerator.test.ts` | Deterministic linux-bindings from property specs; golden DTBs pass real `dt-validate`; negative fixtures fail with expected diagnostics |
| Golden counts | `goldenPowerFixture.test.ts` (parsed topology), `seedM1DtsFiles.test.ts` (`dts_properties`), `matcher.test.ts` (120 matched after structural exclusion), `ingestService.test.ts` (176 occurrences) | Locked **176 occurrences / 120 matched / 684 seed rows** |
| Stage → finalize | `server/modules/parameter-topology/migration.test.ts` (temp PostgreSQL, reconnect, inject-fail) | Durable `stage-review` transaction; atomic `finalize`; cutover rejects non-`finalized` runs |
| Exact writeback | `server/modules/parameter-topology/editService.test.ts`, merge workflow tests | Occurrence-locked merge/writeback; immutable base; stale identity → `409` |
| Matcher / review scope | `server/modules/parameter-specs/matcher.test.ts`, `matcherScope.integration.test.ts` | Override isolation by node locator fingerprint; `blocker_scope` honored on validate/release |
| Manifest gates | `server/modules/parameter-topology/manifestBackfillMigration.test.ts`, `configRevisionManifest.test.ts`, `editService` needs_review paths | Backfill from `dts_config_revision_members`; `needs_review` fail-closed on edit/validate/release/writeback |
| Global-spec hotspots | `server/modules/parameters/dashboard/postCutoverDashboard.integration.test.ts` | Tenant projects include `organization_id IS NULL` vendor specs |
| Unmatched review | `server/modules/parameter-specs/service.test.ts`, `routes.test.ts` | `createSpec` + `confirmPropertyMismatch` with governance audit |
| Browser acceptance | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | `PARAM-SPEC-GOVERN-001` through `PARAM-CONFIG-PUBLISH-GATE-001`; `PARAM-ENABLE-*` stubs registered (ADR-0003); no teaching fallback in API mode |

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
