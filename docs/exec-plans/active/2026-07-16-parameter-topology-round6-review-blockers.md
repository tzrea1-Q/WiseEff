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
14. A forward migration invalidates every active draft without an exact candidate revision, including `file_sync` and conflict-derived rows; the 0060→0061 PostgreSQL upgrade, rollback, report, and idempotency path is proven without rewriting 0060.
15. Typed binding action `set|delete` is durable across draft, submission item, change request, candidate proof, audit, and locked writeback. Delete requires an evidence-chain tombstone in the exact candidate, removes the property after real review/merge/re-ingest, and never creates a replacement binding revision for the deleted value.
16. The human-maintained database schema summary reflects migrations 0053/0059/0060+ and every new Round6 action/invalidation column, constraint, index, and table.

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
| T14 | 0060 leaves candidate-less `file_sync` drafts active | Forward all-origin invalidation migration + PG upgrade/rollback/idempotency tests |
| T15 | Typed `action=delete` cannot submit or merge | Persist action + exact candidate tombstone proof + delete writeback acceptance |
| T16 | Generated database summary is stale | Manually re-derive `docs/generated/db-schema.md` from migrations (TD-004) |

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
| Candidate-less draft gate | Real PG: apply through 0060, insert manual/file_sync/conflict-derived drafts, apply 0061, inject rollback, rerun idempotently |
| Delete workflow | Schema/HTTP/PG tests plus real delete draft → submit → role review → semantic merge/writeback → re-ingest/reload acceptance |
| Generated DB summary | Compare documented columns/constraints/indexes with 0053/0059/0060+ and run `npm run docs:check` |

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
| Generated database schema | Update | `docs/generated/db-schema.md` (manual summary; no generator exists, tracked by TD-004) |

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

## Parent Review follow-up checkpoint 3 (2026-07-18)

Parent Review remains `Request changes` for two P1 and three P2 findings. Root-cause inspection confirms: post-cutover service dispatch still accepts legacy item/save shapes; exact submission reads drafts without a row lock and does not compare the candidate binding value; an in-flight project-A draft response can update project-B UI state; one new assignee assertion races its effect; and migration 0059 leaves pre-existing semantic drafts without candidate identity.

Implementation and TDD order:

1. Add post-cutover PG/HTTP RED cases for legacy save/submit rejection and candidate-value mismatch, then make semantic mode accept only the explicit binding-draft contract and compare the candidate binding revision value with the locked draft.
2. Add a deterministic two-connection PostgreSQL concurrency test, prove an edit can race the unlocked submission read, then lock `parameter_drafts d` with `FOR UPDATE OF d` and verify the edit cannot be silently deleted.
3. Add a deferred-promise project-switch component test and ignore responses whose captured project generation no longer matches the active project. Bind pending drafts and assignee loading to their owning project.
4. Replace the immediate assignee-effect assertion with `waitFor` and rerun standard `test:all` repeatedly.
5. Add forward migration 0060 instead of rewriting deployed 0059. Fail closed by invalidating pre-0060 semantic drafts that cannot prove an exact candidate chain, record deterministic migration evidence, add upgrade/idempotency/rollback PG tests, and document the rebuild requirement in both runbooks.

Documentation gate: update this plan, API/domain/testing/frontend behavior, and the English/Chinese identity cutover runbooks. TD-042 and external readiness remain blockers.

### Follow-up execution outcome 3

- `7e571f7c` closes the post-cutover legacy bypass: semantic mode rejects legacy draft saves and parameterId-only submissions with `409`, exact submission locks the owned draft and proves the candidate binding revision raw value equals the draft target before creating a round.
- The same change adds a deterministic two-connection PostgreSQL regression. A concurrent typed edit waits on the draft row lock while submission consumes the old draft, then recreates the newer draft after commit; the new value/reason are not deleted as a lost update.
- `713133b6` binds pending drafts to their project and rejects late create-draft responses after a project switch. The deferred-response component regression proves an Aurora response cannot repopulate the Nebula panel or load Nebula assignees; the load-effect assertion now uses `waitFor`.
- `0fc167e6` adds forward migration `0060_parameter_draft_candidate_identity_gate.sql`. It does not guess a candidate for pre-0059 data: manual drafts without candidate identity are recorded without value/reason in `parameter_draft_identity_invalidations`, removed from the active draft table, and must be recreated through the typed editor. The PostgreSQL upgrade test covers the 0059 state, injected rollback, report counts, and idempotency.
- Focused verification passed for the exact-identity/concurrency PG workflow, 0060 schema upgrade, HTTP routes, and the project workspace component (the final focused run was 44 server assertions and 10 component assertions). Standard `npm run test:all` passed three consecutive final runs; every run reported frontend 2,190 passed / 5 skipped and server 1,540 passed / 1 skipped.
- Browser verification used disposable API `http://127.0.0.1:52857` and frontend `http://127.0.0.1:5174/parameters`. The visible project control switched Aurora to Nebula; Nebula loaded its own current revision `a491efaf-648b-4652-830d-49c79a27e5d2`, did not show the false empty state, and did not retain a pending draft. `playwright-cli` snapshots/screenshots at 1440×900, 768×1024, and 390×844 reported zero console errors, no document-level horizontal overflow, and 200 responses for the Nebula current/source/binding/mapping requests. The disposable database was destroyed and both ports were released.
- The standard full run against the user-owned `8787` runtime used clean source `186c3f73ff5629931fd7a0b32ec9969fc2011fea` and accurately failed: preflight was blocked by `deviceGateway`, `xiaozeLlm`, and `backups`; that runtime's HDC/development-auth state produced 69 passed / 11 failed / 4 skipped and 49/56 operation coverage. Its failed evidence is preserved by `0d639e40` and did not replace `latest-full`.
- A separate clean-source run from `0d639e40ba5e4004c7602ad389e4b07cc354317a` used isolated ports 5174/18787 with production HMAC, simulator, and deterministic Xiaoze without touching 8787. Playwright completed 84 tests: 80 passed / 4 hardware-conditional skipped / 0 failed; workflows A–E and G–I passed; requirements were 59/59; operation evidence was 56/56 with 71 records, zero invalid records, and zero validation errors. `npm run acceptance:evidence` passed and `latest-full.json` SHA-256 became `a8ecd8a150c0f8d2beff029a368d9b85a3f5612d6426071b01e7cec52198e1d0`. The outer isolated runner remains failed solely because preflight was explicitly skipped; it does not override the real external preflight blocker. TD-042 remains BLOCKER, and no production, cutover, or merge-ready claim is made.

## Parent Review follow-up checkpoint 4 (2026-07-18)

Parent Review remains `Request changes` for two P1 and one P2 finding. Code/data-flow inspection confirms all three before implementation:

- 0060 filters both its evidence insert and delete by `origin = 'manual'`; a candidate-less `file_sync` draft survives the cutover even though file sync skips and legacy submission is rejected.
- The typed draft endpoint creates a valid delete candidate (`rawText = ''` and `/delete-property/`), but the exact submission schema rejects the empty target, no workflow table stores the action, candidate proof only accepts an existing matching binding revision, and semantic writeback defaults to `set`.
- `docs/generated/db-schema.md` is a manually maintained summary (TD-004); there is no `db:schema:docs` command, and its `parameter_drafts` section omits 0053/0059/0060 state.

Implementation and TDD order:

1. Add a real PostgreSQL RED upgrade that applies through 0060, inserts candidate-less manual and `file_sync` rows (including a resolved-file conflict lineage), and proves the non-manual rows survive. Add forward migration 0061 to record and delete every candidate-less draft regardless of origin; verify injected rollback and idempotent rerun.
2. Add schema/HTTP/PG RED cases for a binding submission item `{ action: 'delete', targetValue: '' }`. Add migration 0062 with checked `action` columns on `parameter_drafts`, `parameter_submission_items`, and `parameter_change_requests`; default existing rows to `set` and make exact binding submission carry the persisted action.
3. Prove delete candidates with one exact evidence chain: candidate revision belongs to the draft's organization/project/config set, contains no binding revision for the binding, and contains a `delete` occurrence effect for the binding's logical node plus property spec. Reject missing, mixed, or contradictory tombstones.
4. Pass the persisted action into locked semantic writeback. `delete` emits `/delete-property/`, re-ingests and validates fail-closed, and intentionally returns no new binding revision. Record action in submit/merge/writeback audit metadata and expose it in workflow DTOs.
5. Extend the disposable topology acceptance with a second real request that deletes the property through submit → Hardware Committer → Software Committer → Software User merge. Assert base revision/binding immutability, `writeback.skipped=false`, candidate property/binding absence, reload persistence, and no success audit before full writeback+validation.
6. Manually re-derive the database summary from the migrations, update bilingual domain/API/testing/cutover docs, run the complete gates, then regenerate clean-source evidence. External readiness and TD-042 remain blockers.

### Follow-up execution outcome 4

- `7e948d54` adds forward migration `0061_parameter_draft_candidate_identity_all_origins.sql`. A real PostgreSQL upgrade starts at 0060 with candidate-less manual, `file_sync`, and resolved-file-conflict drafts plus a candidate-backed control. Injected failure rolls the transaction back; a successful run records origin/file-version evidence, deletes every candidate-less row through normal FK cascades, preserves the control, and reruns idempotently.
- `93610634` adds migration `0062_parameter_change_action.sql` and carries `set|delete` through typed draft, submission item, change request, DTO, audit, candidate proof, and locked writeback. Delete proof requires absence of the candidate binding revision plus a same-chain logical-node/property-spec delete effect. Real writeback emits `/delete-property/`, re-ingests and validates, records an empty history tombstone, leaves the base config/binding revision unchanged, and creates no replacement candidate binding revision.
- The disposable topology acceptance now performs one set and one delete request through public typed-draft/submission boundaries and visible Hardware Committer → Software Committer → Software User review/merge controls. It passed 1/1 on clean source. Focused PostgreSQL/schema verification passed 21/21 and focused frontend action/workspace/client tests passed 24/24.
- `48328c99` updates the generated database summary and separate English/Chinese domain, API, testing, frontend, verification, and cutover documentation. The runbook now gates every origin at 0061 and documents 0062 delete tombstone handling. `docs:check` and `git diff --check` pass.
- Default `npm run test:all` passed three consecutive runs with no worker override. Every run reported frontend 316 files / 2,191 passed / 5 skipped and server 215 files / 1,548 passed / 1 skipped. Standalone frontend and server runs reported the same totals.
- `playwright-cli` verified `http://127.0.0.1:5173/parameters` and `/parameter-admin` at 1440×900, 768×1024, and 390×844. Search opened the `sc8562@6E` `gpio_int = <&gpio13 29 0>` binding/spec detail; mobile tree→property→detail navigation remained operable. Every viewport had a snapshot/screenshot, zero console errors, successful topology/spec network requests, and document overflow=false. Screenshots are `work/ui-checks/parameter-topology-round6-delete-*.png`. The product has no delete-authoring control; delete panel rendering is component-tested and the public-API creation/submission plus UI role chain is covered by disposable acceptance rather than a fabricated control.
- The standard clean-source `npm run acceptance:browser` at `48328c99` accurately failed: preflight is blocked by external `deviceGateway`, `xiaozeLlm`, and `backups`; the user-owned 8787 HDC/development-auth runtime produced 69 passed / 11 failed / 4 hardware-conditional skipped and 49/56 operation coverage. That diagnostic evidence is preserved by `889fd29b`.
- A separate clean-source run from `889fd29b26372823d955a09e7c4a6ce8f8ac8ea7` used isolated 5174/18787 production-HMAC, simulator, and deterministic-Xiaoze services. Playwright completed 84 tests: 80 passed / 4 hardware-conditional skipped / 0 failed; workflows A–E and G–I passed; requirements were 59/59; operation evidence was 56/56 with 71 records, zero invalid records, and zero validation errors. `npm run acceptance:evidence` passed; `latest-full.json` SHA-256 is `f4a71b053231f52602d7e87d761dcc992cadbc392638d92ba3f17b63a33913c3`. The isolated outer status remains failed solely because preflight was explicitly skipped and does not override the real readiness blockers.
- Toolchain gates resolve project-pinned dtc 1.8.1, fdtoverlay 1.8.1, and dtschema 2026.6. Aurora, Nebula, and Atlas compile with empty diagnostics. TD-042 remains BLOCKER because no clean non-customer snapshot apply→cutover→whole-database restore rehearsal has run; no production, cutover, or merge-ready claim is made.

## Parent review follow-up checkpoint 5 (2026-07-18)

The parent review remains `Request changes` because exact candidate proof is not transactionally durable. The finding is confirmed: submission locks only `parameter_drafts`, reads candidate status/action proof without locking the candidate revision, deletes the draft after creating workflow records, and does not copy `candidate_config_revision_id` to either `parameter_submission_items` or `parameter_change_requests`.

### Success criteria and TDD sequence

1. Add forward-only migration `0063`. Persist the exact candidate revision on submission items and change requests with foreign keys and indexes. Existing rows remain nullable because their candidate cannot be reconstructed safely; post-cutover review/merge fails closed when identity is absent.
2. Add RED PostgreSQL tests first: persistence of one candidate ID across draft/item/request; a deterministic two-connection status race; merge rejection for missing, foreign, status-changed, value-mismatched, and action-mismatched candidates for both `set` and `delete`; migration upgrade, injected rollback, and idempotency.
3. Submission locks the draft and its candidate revision, proves the same organization/project/config set and exact action chain, atomically transitions `draft -> pending_approval`, and only then creates workflow records.
4. Review and merge retain the exact candidate identity. Merge locks that candidate and re-checks `pending_approval` plus the persisted set binding-revision proof or delete tombstone proof before history/writeback begins.
5. Audit and API workflow data expose candidate identity so submitted evidence can be correlated with the reviewed request. Acceptance may not add repository/DB business bypasses.

### Documentation Impact Matrix and Update Gate

| Artifact | Impact / required update |
| --- | --- |
| Domain model (English/Chinese) | Document durable candidate review identity, `draft -> pending_approval`, and historical fail-closed rows |
| API contract (English/Chinese) | Document candidate identity in workflow responses and merge conflicts |
| Testing/verification (English/Chinese) | Document two-connection PG race and merge revalidation gates |
| Identity cutover runbook (English/Chinese) | Add 0063 pre/post checks and reject/recreate remediation for historical rows |
| Generated DB schema | Record new FKs and indexes through 0063 |
| Active plan (English/Chinese) | Keep success, rollback, and real command evidence synchronized |

Documentation gate: update each impacted English and Chinese document separately plus `docs/generated/db-schema.md`, then run `npm run docs:check`. Lock order is draft then candidate at submission, and request then candidate at merge; the race test must prove blocking/release without deadlock. Never infer a candidate for historical requests. Application rollback leaves additive nullable columns harmless; transaction rollback is proven in a disposable database. Verification includes focused repository/service/HTTP/PG/schema tests, topology acceptance, `test:all`, contract/docs/build/toolchain/seed/selfhost, clean-source evidence, and `git diff --check main...HEAD`.

### Follow-up execution outcome 5

- `8c1df608` adds forward migration `0063_parameter_submission_candidate_identity.sql`, candidate/evidence row locking, atomic `draft -> pending_approval`, durable item/request identity, merge-time candidate/status/set/delete proof revalidation, and submit/review/merge audit correlation. PostgreSQL migration tests cover injected rollback and idempotency; historical nullable requests are never guessed and fail closed.
- The deterministic two-connection PostgreSQL test observed the candidate status writer waiting on a real `Lock` until submission released its transaction. Focused schema/repository/service/HTTP/PG verification passed 6 files / 137 tests. Set merge rejects status/raw-value drift; delete merge rejects a changed tombstone effect before any history or success audit.
- `b1c69c2e` extends disposable topology acceptance to assert the draft candidate is copied unchanged to both workflow rows, remains `pending_approval` through review, and is the identity revalidated before the real set/delete role merge. The focused topology acceptance passed 1/1.
- `003014de` synchronizes the separate English/Chinese domain, API, testing, verification, cutover, technical-debt, and generated-schema documentation through 0063. Contract, docs, and build gates pass.
- Default `npm run test:all` passed three consecutive runs with identical counts and no worker/timeout override: frontend 316 files / 2,191 passed / 5 skipped; server 215 files / 1,550 passed / 1 skipped.
- Project-pinned toolchain checks pass at dtc 1.8.1, fdtoverlay 1.8.1, dtschema 2026.6. Aurora, Nebula, and Atlas compile with empty diagnostics; `selfhost:check` passes.
- Standard clean-source browser acceptance at `003014de6b013fbf082d91d887d067253a445649` accurately remains failed: preflight is blocked by external `deviceGateway`, `xiaozeLlm`, and `backups`; the shared 8787 HDC/development-auth runtime produced 69 passed / 11 failed / 4 hardware-condition skips and operation evidence 49/56. Topology itself passed.
- A separate clean-source run at `04e46b87f9db8879e3cded8cc526447524a04c52` used isolated 5174/18787 production-HMAC, simulator, and deterministic-Xiaoze services. Playwright completed 80 passed / 4 hardware-condition skips / 0 failed; workflows A–E and G–I passed; requirements 59/59; operation evidence 56/56 with 71 records, zero invalid records, and zero validation errors. `acceptance:evidence` passes. Run ID is `full-20260718T123157160Z-04e46b87f9db`; `latest-full.json` SHA-256 is `d432dd7eb6b1d6c9266366ac471af6cd75ae104f9771af562862c44c6c7f1eb1`. The outer isolated runner remains failed only because preflight was explicitly skipped and does not override the real blockers.
- TD-042 remains BLOCKER: no clean non-customer snapshot apply→cutover→whole-database restore rehearsal has run. No merge-ready, production-ready, or cutover-ready claim is made.

## Parent Review follow-up checkpoint 6 (2026-07-19)

Review found a local readiness gate drift: `/api/v1/operations/pilot-readiness` already returned the canonical `xiaozeLlm` blocker, while the preflight consumer still checked the retired `agentProvider` name. The deterministic local allowlist therefore could not recognize the API response.

- Task 0 repaired the device-bridge standby test baseline race across `89a8dace`, `dad470e6`, `1d945fce`, and `2f901271`: the test now waits for the actual readiness log, verifies shutdown, cleans up on failure, and preserves the primary assertion error. At the implementation checkpoint HEAD `c10b8379`, a fresh `npm run bridge:test -- packages/device-bridge/src/cli.test.ts` passed 1 file / 12 tests.
- Task 1 replaced the retired allowlist literal with `xiaozeLlm` in `a4155bc7`; `c10b8379` then tightened exact-set matching to reject duplicates and added coverage for order-independent and unknown blocker inputs. A fresh `npm test -- scripts/run-acceptance-preflight.test.ts` at that checkpoint passed 1 file / 27 tests.
- After the fix, this compatibility path can return only `non_hdc_local`; it cannot produce `pilot_ready`. It applies only when preflight starts the local deterministic Xiaoze runtime. Target and full-pilot modes remain strict.
- `deviceGateway`, `xiaozeLlm`, and `backups` remain honestly listed as blockers; `backups` is allowed only as the existing local non-customer evidence blocker. No standard acceptance success is recorded by this checkpoint.
- TD-042 remains unchanged as BLOCKER because the clean non-customer snapshot apply→cutover→full-database restore rehearsal has not run. No production-ready, cutover-ready, pilot-ready, or merge-ready claim is made.

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
- External pilot blockers (`deviceGateway`, `xiaozeLlm`, `backups`) reported honestly if still present.
- Platform-admin for global specs: fail-closed unless a designed platform governance path already exists.
