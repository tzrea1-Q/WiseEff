# Parameter Topology Round 5 Review Blockers

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-round5-review-blockers.md)
> Prior: [round4](./2026-07-16-parameter-topology-round4-review-blockers.md)

**Goal:** Close parent-agent Round 4 Review blockers: immutable base binding revisions, fail-closed merge/writeback dependencies, immutable stage/finalize phase audit, tenant-owned review resolution, draft→activate createSpec, and honest acceptance fixtures.

**Branch:** `fix/parameter-topology-round5-review-blockers`  
**Preserved baseline:** Round4 `8a6971bd` via `--no-ff` merge. **TD-042 remains BLOCKER — not production cutover ready.**

## Round 5 fixes landed (implementation evidence)

| Fix | Evidence |
| --- | --- |
| Immutable base vs candidate binding revisions | `applyLockedOverlayWriteback` upserts binding revision on candidate config revision only; `postCutoverWorkflow.integration.test.ts` proves base `<1>` unchanged, candidate `<9>` |
| Fail-closed writeback dependencies | `parameters/service` merge rejects missing `objectStore`/project/write lock; real DTC toolchain via `assertCandidateToolchainRelease`; no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production path |
| Immutable phase audit + run linkage | `migration.test.ts` — `parameter_identity_migration_phases` append-only; inferred tasks carry `migration_run_id`; cutover rejects staged-only/forged runs |
| Tenant-owned review resolve | `validateSpecReviewTenantEvidence` tenant-scoped join; cross-tenant PG negative tests; migration 0055 hardening |
| Manual spec draft→activate→resolve | `draftSpecWorkflow.integration.test.ts`; `POST /api/v2/parameter-specs/:specId/activate`; `DraftSpecActivatePanel` + `ParameterSpecLibrary` |
| Acceptance fixture honesty | `acceptanceTaskLookup.ts`, `semanticFixtureCleanup.ts`; topology acceptance draft→activate→resolve; no `items[0]` fallbacks |

## Success criteria

1. Merge never UPDATEs `project_parameter_binding_revisions` for the locked base config revision; candidate revision holds the new value.
2. Post-cutover semantic merge fail-closes when `objectStore`, `projectId`, write lock, or real DTC toolchain is missing; no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production path.
3. Stage-review and finalize keep immutable phase/attempt audit rows; cutover only accepts successful finalize of a linked staged run.
4. Review resolve validates organization/project/revision/occurrence/logical-node ownership in one tenant-scoped join; 0055 never trusts raw evidence IDs.
5. `createSpec` creates org-owned **draft** specs with typed shapes from occurrence AST; activate requires Admin; only active+complete specs can resolve.
6. Acceptance removes `items[0]` fallbacks; cleanup is prefix-scoped and FK-complete; topology acceptance covers draft→activate→resolve and immutable merge.
7. `git diff --check main...HEAD` clean; bilingual docs updated; TD-042 stays BLOCKER.

## Task dependencies

```text
Plan
  → T1 failing tests for immutable merge + fail-closed writeback
  → T2 fix immutable base binding revision (P0-1)
  → T3 fix fail-closed writeback deps (P0-2)
  → T4 failing tests for stage/finalize audit + scoping
  → T5 phase audit + run-linked tasks (P1-1)
  → T6 failing tests for cross-tenant evidence
  → T7 tenant-owned resolve + 0055 harden (P1-2)
  → T8 failing tests for draft createSpec
  → T9 draft→activate→resolve (P1-3)
  → T10 acceptance fallback removal + cleanup (P2)
  → T11 bilingual docs + verification gates
```

## Test matrix

| Area | Command / focus |
| --- | --- |
| Immutable merge | `postCutoverWorkflow.integration.test.ts`, new merge immutability cases |
| Fail-closed writeback | service/writeback tests with missing objectStore/toolchain; env var must not bypass |
| Stage/finalize | `migration.test.ts` phase audit, concurrent finalize, inject-fail |
| Tenant evidence | new PG cross-tenant resolve/migration tests |
| Draft createSpec | reviewApply/service + UI component tests |
| Acceptance | topology focused + `acceptance:browser` / `acceptance:evidence` |
| Toolchain | `dts:toolchain:check`, `dtc:seed:compile`, vendor schema tests |

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Plans | Update | this plan; `docs/PLANS.md`; zh-CN companions |
| Domain model | Update | `docs/design-docs/domain-model.md` + zh-CN |
| API contract | Update | `docs/design-docs/api-contract.md` + zh-CN |
| Testing strategy | Update | `docs/design-docs/testing-strategy.md` + zh-CN |
| Verification matrix | Update | `docs/developer/verification-matrix.md` + zh-CN |
| Cutover runbook | Update | `docs/runbooks/parameter-identity-cutover.md` + zh-CN |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` — TD-042 stays BLOCKER |
| Frontend | Update if UI | `docs/FRONTEND.md` + zh-CN when draft/activate UI ships |

## Documentation Update Gate

Blocking before plan completion: every `Update`/`Review` row updated or explicitly unchanged with evidence; `npm run docs:check` passes; TD-042 not closed.

## Git & PR Workflow

- Implementation branch from local `main`, `--no-ff` merge Round4.
- Implementation agent: commit on feature branch only; **must not** push, open PR, or merge `main`.
- Parent agent: Review, PR, merge, sync `main`.

## Out of scope / explicit non-claims

- No production cutover; no customer DB/snapshots.
- Not production ready; not cutover ready; not merge-ready without parent Review.
- External pilot blockers (`deviceGateway`, `backups`) reported honestly if still present.
