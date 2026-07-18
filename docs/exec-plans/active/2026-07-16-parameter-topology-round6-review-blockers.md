# Parameter Topology Round 6 Review Blockers

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md)
> Prior: [round5](./2026-07-16-parameter-topology-round5-review-blockers.md)

**Goal:** Close parent-agent Round 5 Review blockers: historical cross-tenant review-task scope reconcile, lossless manual spec identity, global-spec activation authz, full valueShape activate UX, real submit→review→merge acceptance, tenant-scoped fixture cleanup, and stable `npm run test:all`.

**Branch:** `fix/parameter-topology-round6-review-blockers`
**Preserved baseline:** Round5 `a2669639` via `--no-ff` merge. **TD-042 remains BLOCKER — not production cutover ready.**

## Success criteria

1. New forward migration (0058+) re-validates review-task scope from trusted joins only; polluted FKs cleared; ambiguous rows stay needs-review and block finalize; upgrade path from dirty 0055 state proven on real PG.
2. `vendor,limit` and `vendor-limit` (and other lossy-sanitize pairs) produce distinct stable IDs; collision audit fail-closed without silent rewrite of referenced IDs.
3. Org Admin can activate only org-owned drafts; global draft activate is rejected server-side; read/bind of active global specs still allowed.
4. Activate panel/API retain full inferred valueShape (bits/groups/cellsPerGroup/bytes); gpio_int three-cell shape preserved; incomplete shape blocks activate.
5. Topology acceptance exercises real submit→review→merge→writeback→validate via API/UI (no repository status forging); base immutable; candidate new; `writeback.skipped === false`.
6. Fixture cleanup resolves Config Sets by organizationId+projectId+name; cross-org/project same-name sets untouched.
7. Default `npm run test:all` is stable without ad-hoc maxWorkers; migration/dashboard isolation fixed at root cause.
8. Bilingual docs updated; `npm run docs:check` passes; TD-042 stays BLOCKER.
9. Default-shell toolchain discovery resolves the pinned project-local dtschema venv for the check script, API runtime, seed compiler, and topology acceptance; no personal Python path export is required.
10. API-mode `/parameters` renders only the binding-centric topology/edit/submission surface. Legacy flat tables and `recommendedValue` draft semantics remain mock-only; submit, role review, and merge are exercised through real UI/API boundaries.
11. A `projectId` change resets every project-scoped workspace value before loading the new project: preferred revision, pending draft, assignee candidates/errors, publish message, and mapping message. The new project always starts from its `current` revision.
12. Evidence-grade operation records and artifacts are stored under one immutable `runId + sourceCommit` namespace outside Playwright's disposable output directory. Focused runs cannot replace or damage the latest completed full-run evidence, and the checker rejects mixed-run/mixed-commit records.
13. Binding-draft submission uses an explicit wire identity (`draftId`, `projectParameterBindingId`, and `parameterSpecId`) rather than overloading legacy `parameterId`; the server validates organization, project, binding/spec consistency, candidate revision/write lock, while the legacy flat submission contract remains supported only as an explicit separate item shape.

## Task map

| Task | Finding | Implementation focus |
| --- | --- | --- |
| T1 | 0057 trusts polluted task FKs via coalesce | Migration 0058 evidence-only reconcile + PG upgrade tests |
| T2 | sanitize-before-hash collisions | Lossless canonical hash input + collision audit/tests |
| T3 | Org Admin activates global draft | activate requires org-owned row; global fail-closed |
| T4 | UI drops valueShape fields | Mapper→detail→panel full shape; server re-validates |
| T5 | Acceptance skips merge path | Real CR workflow + writeback assertions |
| T6 | Cleanup Config Set by name only | Tenant-scoped resolve + PG isolation tests |
| T7 | test:all PG races | Worker/DB isolation in standard vitest/npm scripts |
| T8 | Docs/browser/evidence | Bilingual docs + playwright-cli + gates |
| T9 | `dt-validate` depends on a developer PATH export | Project-local venv bootstrap + shared binary resolver + default-shell acceptance |
| T10 | API mode renders the legacy recommended-value workbench | API/mock render isolation + binding draft submission UI + role review/merge UI acceptance |
| T11 | Candidate revision leaks across project changes | Atomic project-scope reset + rerender regression |
| T12 | Focused Playwright runs delete full-run evidence artifacts | Immutable evidence run namespace + latest-full publication + mixed-run rejection |
| T13 | Submission schema strips semantic binding/spec identity | Explicit binding-draft wire item + server tenant/spec/write-lock validation |

## Task dependencies

```text
Plan
  → T1/T2/T3/T6 in parallel (independent)
  → T4 (frontend + activate validation)
  → T5 (acceptance merge path; needs T3/T4 semantics)
  → T7 (test harness isolation)
  → T8 docs + browser + full gates
```

## Verification matrix

| Area | Command / focus |
| --- | --- |
| Scope reconcile | new 0058 PG upgrade from polluted 0055 state |
| Spec identity | `vendor,limit` ≠ `vendor-limit`; property tests |
| Global authz | activate service + HTTP/PG negatives |
| ValueShape | mapper/panel/service tests + playwright-cli |
| Acceptance merge | topology acceptance submit→merge→reload |
| Cleanup | cross-org/project same-name Config Set PG test |
| Stability | `npm run test:all` ×3 default config |
| Toolchain | `dts:toolchain:check`, `dtc:seed:compile` |
| Default-shell toolchain | clear personal Python bin from `PATH`; shared resolver unit tests; bootstrap project venv; check + API topology acceptance without PATH injection |
| API-mode semantic UI | `ParametersPage` absence assertions; binding edit/submission component tests; Playwright typed edit → submit → role review → merge |
| Project switch isolation | Component `rerender` from Aurora candidate to Nebula; first Nebula topology request uses `current`; no stale project messages/draft |
| Evidence stability | Full-run evidence → focused topology run → `acceptance:evidence` still passes; mixed `runId`/commit and missing artifacts fail closed |
| Submission identity | Schema unit tests, HTTP/PG success, cross-project/mismatched spec/stale draft negatives, and legacy item regression |

## Documentation Impact Matrix

| Area | Action | Paths |
| --- | --- | --- |
| Plans | Update | this plan; `docs/PLANS.md`; zh-CN companions |
| Domain model | Update | `docs/design-docs/domain-model.md` + zh-CN |
| API contract | Update | `docs/design-docs/api-contract.md` + zh-CN |
| Testing strategy | Update | `docs/design-docs/testing-strategy.md` + zh-CN |
| Verification matrix | Update | `docs/developer/verification-matrix.md` + zh-CN |
| Cutover / identity runbook | Update | `docs/runbooks/parameter-identity-cutover.md` + zh-CN |
| Frontend | Update | `docs/FRONTEND.md` + zh-CN |
| Security / authz | Review/Update | `docs/SECURITY.md` + global-spec governance notes |
| Tech debt | Review | TD-042 stays BLOCKER |
| Acceptance evidence | Update | `e2e/acceptance/helpers/operationEvidence.ts`; browser runner/checker tests; testing/verification docs and zh-CN companions |

## Documentation Update Gate

Blocking before plan completion: every `Update`/`Review` row updated or explicitly unchanged with evidence; `npm run docs:check` passes; TD-042 not closed.

## Execution checkpoint (2026-07-18)

- T1/T2 follow-up findings are closed: unproven polluted tasks reopen even without evidence IDs; finalize blocks every open migration-run task; manual entity IDs and persisted `specificationKey` values are lossless and coexist in one organization.
- T4 follow-up is closed: activation state resets on spec/valueShape changes and frontend/backend reject fractional cell counts.
- T5 creates and destroys a marker-verified `wiseeff_acceptance_disposable_*` database, applies every migration, runs real identity apply+cutover, and passes the formal Software User → Hardware Committer → Software Committer → Software User submit/review/merge/writeback/reload chain. The candidate binding stores a valid three-cell phandle AST; base config/binding revisions remain unchanged.
- The previously weakened `PARAM-ASSIGNEE-001/002` and parameter-review operations again use visible UI controls. API mode loads organization+project-scoped eligible assignees, and browser acceptance switches production HMAC identities before each role-specific UI action.
- Browser-visible behavior was verified with `playwright-cli` at 1440×900, 768×1024, and 390×844 on `/parameters` and `/parameter-admin`. The real API topology exposes the `sc8562@6E` `gpio_int = <&gpio13 29 0>` occurrence; the disposable admin fixture preserved `phandle-list`, `bits=32`, `groups=1`, and `cellsPerGroup=3`, reset stale form state, rejected fractional/incomplete cells, activated the org-owned draft through HTTP 200, hid global-draft activation, and returned HTTP 403 for a forced global activate. Console errors were zero. A 390px topbar overflow found during this pass was fixed in `51bc0608`; both pages then reported document overflow false.
- Full `acceptance:browser` evidence was regenerated from clean source commit `51bc06085df382754197270611cc25e990e19758` (`Dirty worktree: false`). Playwright completed 85 tests: 81 expected/pass, four hardware-conditional skips, zero failures/errors. Requirement coverage is 59/59; operation evidence is 56/56 with 71 records, zero invalid records, and zero validation errors. `npm run acceptance:evidence` exits zero. The outer runner remains failed only because pilot readiness is externally blocked by `deviceGateway`, `xiaozeLlm`, and `backups`.
- Three recorded default `npm run test:all` runs (logs 2/3/4) exited zero with identical totals: frontend 314 files, 2178 passed / 5 skipped; server 214 files, 1531 passed / 1 skipped. No ad-hoc worker override was used.
- Toolchain verification passes with dtc 1.8.1, fdtoverlay 1.8.1, and dtschema 2026.6. Aurora, Nebula, and Atlas all compile with empty diagnostics. Generated evidence/docs were recorded in `4c199b3a`; post-commit contract/docs/build, standalone frontend/server tests, default `test:all`, toolchain, self-host, operation-evidence, and diff gates all pass. The plan remains active only for the explicitly external pilot/cutover blockers. TD-042 remains BLOCKER because no clean non-customer snapshot apply→cutover→whole-DB restore rehearsal has run.

## Parent Review follow-up checkpoint (2026-07-18)

Parent Review remains `Request changes` for two P1 findings. Both findings are accepted after reproduction: a default shell cannot resolve `dt-validate`, and API-mode `/parameters` continues below the topology workspace into the legacy `recommendedValue` table/draft surface.

- T9 design: create an ignored `.wiseeff-tools/dts-toolchain` venv from the pinned `tools/dts-toolchain/requirements.txt`; expose an explicit bootstrap command; resolve all three binaries through one shared resolver used by the API runner and CLI check. Project-local binaries take precedence, an invalid explicit override fails closed, and runtime validation never auto-installs or mutates the host.
- T10 design: API mode renders only `ApiProjectTopologyWorkspace`; legacy table/detail/draft/export UI remains mock-only. Binding edits require an explicit reason, retain the typed binding/candidate identity returned by `/api/v2`, and expose a submission panel backed by `/api/v1/parameter-submission-rounds`. Hardware Committer, Software Committer, and Software User actions continue through the real `/parameter-review` UI.
- TDD gate: resolver and render-isolation tests must fail before implementation; binding submit tests must assert typed identity/value/reason and server-filtered role candidates; Playwright must replace direct business-state API advancement with visible edit/submit/review/merge interactions.
- Documentation gate: remove personal `~/Library/Python/...` PATH guidance from EN/zh-CN developer, testing, verification, and cutover docs; document project bootstrap/resolution order and the mock-only legacy parameter workbench.

### Follow-up execution outcome

- T9 is closed in `858d8751`: `npm run dts:toolchain:bootstrap` creates the ignored project venv, while CLI checks and API runtime share one resolver. A default shell with no personal Python PATH now passes `npm run dts:toolchain:check` with dtc/fdtoverlay 1.8.1 and dtschema 2026.6. Aurora, Nebula, and Atlas compile with empty diagnostics.
- T10 is closed by `e9eb025f`, `0843cc75`, and `1abb57f2`: API mode renders only the binding-centric topology workspace; typed edit retains candidate/binding/spec/value/reason; visible project-scoped assignee selectors submit through the public endpoint; the real role UI completes review and semantic merge/writeback. `PARAM-ASSIGNEE-001/002` now assert exact defaults and exclusion sets inside that disposable full-chain acceptance, not the removed legacy table.
- In-app browser verification used `http://127.0.0.1:5173/parameters` with a disposable post-cutover API/database at 1440×900, 768×1024, and 390×844. Legacy table, `recommendedValue` copy, and legacy Excel export all had count zero. The visible `gpio_int` edit preserved `<&gpio13 30 0>`, loaded the three role selectors from API data, and submitted formal review. Console errors were zero. A real 390px tree overflow found during the pass was fixed in `7de8f56c`; the final document width is 390px with no horizontal overflow. Screenshots are `work/ui-checks/parameter-topology-round6-followup-*.png`.
- Three consecutive default `npm run test:all` runs at the follow-up source state exited zero with identical totals and no worker override: frontend 315 files, 2182 passed / 5 skipped; server 214 files, 1534 passed / 1 skipped.
- The standard outer `npm run acceptance:browser` from clean source `1abb57f2` accurately failed: preflight was externally blocked by `deviceGateway`, `xiaozeLlm`, and `backups`; the user-owned 8787 runtime was also configured for HDC/development auth, producing 69 passed / 11 failed / 4 skipped. Diagnostic evidence is retained in `bb2e3e61`.
- A separate clean-source run from `bb2e3e6160b05930ecc8a7e5a0a88ab22fcd7bab` used isolated ports 5174/18787 with production HMAC, simulator, and deterministic Xiaoze without touching 8787. Playwright completed 84 tests: 80 passed / 4 hardware-conditional skipped / 0 failed; workflows A–E and G–I passed; requirements are 59/59; operation evidence is 56/56 with 71 records, zero invalid records, and zero validation errors. `npm run acceptance:evidence` exits zero. Its outer runner status remains failed solely because preflight was explicitly skipped; it does not override the real external preflight blocker.
- TD-042 remains BLOCKER. No clean non-customer snapshot apply→cutover→whole-database restore rehearsal has been executed, so this plan does not claim production readiness, cutover readiness, or merge readiness without parent Review.

## Parent Review follow-up checkpoint 2 (2026-07-18)

Parent Review remains `Request changes` for T11–T13. Root-cause inspection confirms all three findings before implementation:

- T11: the project-change effect clears pending draft and assignees but retains `preferredRevisionId`; the load effect therefore requests a project-A candidate under project B and maps the resulting 404 to a false empty state.
- T12: operation JSON records persist under `test-results/acceptance-operation-evidence`, while JSON/screenshot artifacts written with `testInfo.outputPath()` live under Playwright's disposable `test-results/acceptance`. A focused run clears the latter without atomically replacing the former.
- T13: the frontend sends semantic IDs, but `submitRoundBodySchema` declares only `parameterId`, `targetValue`, and `reason`, so Zod strips binding/spec identity. The service currently succeeds by treating a binding ID as legacy `parameterId` and re-deriving state indirectly.

Implementation order and TDD gate:

1. Add a component `rerender` regression, observe the foreign revision request, then reset all project-scoped state before the new load.
2. Add run-manifest/checker/runner tests that reproduce focused-run artifact deletion and mixed-run aggregation, then move evidence-grade artifacts into immutable full-run namespaces and publish `latest-full` only after a complete run.
3. Add schema and HTTP/PG RED tests for explicit binding-draft identities and tenant/spec/write-lock mismatches, then introduce a separate binding item shape without weakening legacy submissions.
4. Update bilingual API/testing/verification/frontend documentation, run browser project-switch acceptance, then execute the full verification matrix. External readiness and TD-042 remain explicit blockers.

### Follow-up execution outcome 2

- T11 is closed by `a585162b` and `4fcc707a`: the workspace stores the preferred revision together with its owning project, clears preferred revision/draft/assignee/publish/mapping state on project changes, and uses the persisted draft ID returned by the database. The component rerender regression and the real topology acceptance both create an Aurora candidate, switch to Nebula, assert Nebula loads its own `current` revision without a false 404, and then switch back before continuing the formal workflow.
- T12 is closed by `b0c9d644`: evidence-grade records and artifacts live under `test-results/acceptance-evidence-runs/runs/<sourceCommit>/<runId>`, and `latest-full.json` is published only for a completed full run. A focused topology run no longer clears or republishes the full namespace; the checker rejects missing artifacts and mixed run/commit input.
- T13 is closed by `c3da65ea`: the submission wire contract has a separate binding-draft item with `draftId`, `projectParameterBindingId`, and `parameterSpecId`. Schema, service, and HTTP/PG tests prove tenant/project/spec/candidate/write-lock validation while preserving the independent legacy flat-item contract.
- Clean source commit `4fcc707a4c8a8a12860a2e4ad36051990e66385b` produced full run `full-20260718T045954503Z-4fcc707a4c8a`: Playwright 80 passed / 4 hardware-conditional skipped / 0 failed; requirements 59/59; operations 56/56; 71 evidence records; 0 invalid records; 0 validation errors. `latest-full.json` SHA-256 was `ed93176d505d7e9a418bb0573d20a93a8c9ad6aeebec0c8bed7bcd0947068531`.
- After that full run, a focused topology acceptance passed. The latest-full manifest hash remained unchanged and `npm run acceptance:evidence` still exited zero; all 71 record files and 71 referenced artifacts remained present in the immutable full namespace.
- In-app browser verification used disposable API `http://127.0.0.1:50645` and frontend `http://127.0.0.1:5174/parameters`. Aurora candidate `185c2846-78da-4c18-9ec8-be851f317858` was created through the visible typed-edit UI; switching the project control to Nebula loaded revision `8e211c47-4e0a-45e4-bffa-6d01350f2376`, cleared the submission panel, and did not display the false “no semantic revision” state. Snapshots/screenshots at 1440×900, 768×1024, and 390×844 had zero console errors and no document-level horizontal overflow. The disposable runtime was stopped and its ports released after verification.
- The standard outer acceptance gate remains blocked by external `deviceGateway`, `xiaozeLlm`, and `backups` readiness. TD-042 remains BLOCKER because the clean non-customer snapshot apply→cutover→whole-database restore rehearsal has not run; no production, cutover, or merge-ready claim is made.

## Risks & rollback

| Risk | Mitigation |
| --- | --- |
| Changing identity hash breaks idempotent createSpec | Lookup existing by org+property before insert; collision audit reports only; no silent rewrite |
| 0058 clears too many scopes | Preserve only join-proven chains; mark others needs_review with diagnostic |
| test:all isolation changes slow CI | Prefer unique namespaces + serial migration file group over global single-worker |

## Git & PR Workflow

- Implementation branch from local `main`, `--no-ff` merge Round5 (`a2669639`).
- Implementation agent: commit on feature branch only; **must not** push, open PR, or merge `main`.
- Parent agent: Review, PR, merge, sync `main`.

## Out of scope / explicit non-claims

- No production cutover; no customer DB/snapshots.
- Not production ready; not cutover ready; not merge-ready without parent Review.
- External pilot blockers (`deviceGateway`, `backups`) reported honestly if still present.
- Platform-admin for global specs: fail-closed unless a designed platform governance path already exists.
