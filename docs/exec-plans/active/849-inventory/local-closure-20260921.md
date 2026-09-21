# Local closure round — 2026-09-21

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/local-closure-20260921.md)

Base: `5355f973bfb42dbc4bf47bfac25d56204bf550a9`. Branch: `codex/849-local-closure`. State: the six accepted local items are complete and independently reviewed for PR delivery. This is not a program SEAL; the boundary scanner still fails as recorded below.

The user authorizes the six local items below in order, including implementation, local verification, independent review, evidence reconciliation and one final PR. This supersedes the earlier per-item confirmation pauses for this round. It does not authorize merge, production access/mutation, Issue closure, checker weakening, successor table DROP, or a full T3.4a SEAL. Workers and reviewers use GPT-5.6-Luna with the highest exposed reasoning effort (`xhigh`).

| Order | Local outcome | Status / acceptance |
| --- | --- | --- |
| 1 | Draft DELETE project scope and audit | Complete locally: wrong project/tenant/owner refusal, audited success and audit-failure rollback. Included in the final 20-file / 211-test server pass. |
| 2 | Canonical review workflow contract | Single software review retained; exact current project roles, named eligible reviewer, withdrawal/rejection/resubmission and approved replay covered. Final server checks pass. |
| 3 | TD-125 empty Catalog and binding materialization | Canonical-only GET, real binding materialization, DTS/JSON property edit/delete and explicit terminal tombstones implemented. Final server checks pass, including populated migration and adversarial owner/locking cases. Full topology Gate0 remains separate. |
| 4 | Exact seed/source/preservation evidence | Complete under the accepted completed-instance replay boundary: real local storage, 372 exact tuples and IDs, independent values and non-parameter rows/attachments preserved. Seed checks are included in the final server pass. No independent fresh-allocation ID equality claim. |
| 5 | Boundary leftovers and relocation | Reviewed records contain 237 consumer / 265 family mappings; 12 vanished allowances retired. Script checks pass 8 files / 219 tests. Native checker: 3,568 observations, 3,491 allowlisted, 77 unallowlisted, zero stale/mismatch/growth, exit 1. This completes the accepted record-repair scope; full T1.4 stays open. |
| 6 | Review findings and bilingual state reconciliation | Core, frontend, seed, restart and relocation reviews completed; final property-delete review and current evidence are reconciled below. No merge or Issue mutation is authorized. |

The ancillary minimal-upgrade documentation/probe completion discrepancy may be repaired locally. Native amd64 terminal acceptance remains external; a local source check cannot complete T3.2. Hosted, user deployment, Windows installer/hardware and full program SEAL remain separate evidence owners.

## Environment and ownership

- New isolated worktree; preserve all inherited worktrees. Dependencies reuse the existing local installation without modifying it.
- PostgreSQL helper `127.0.0.1:55438`, container `wiseeff-g668-pg`. Final server runs create fresh `wiseeff_849_delete_*` databases from `template0`, set both database URLs explicitly, and use one worker. The older `wiseeff_ut_routes` test base is no longer used for server migrations after its local 0160 drift; its migration history was not repaired. Never shared `5432/wiseeff`, `wiseeff_lane_849`, or migrations on the `postgres` maintenance database.
- Coordinator owns integration, durable records, shared checkers, commits and PR. Workers own bounded paths; later-item investigation may overlap, but implementation remains ordered.
- UI changes use real API-mode browser evidence at 1440×900. Relevant native focused tests, typecheck/build and documentation gates remain mandatory. Broad acceptance is run after integration, not after every small edit.

## Risk cases

1. DELETE: URL project mismatch, organization/owner mismatch, absent draft, canonical-to-topology fallback, successful deletion and audit failure rollback.
2. Review: exact workflow stage, selected eligible actor, self-review, cross-project authorization, revoked/inactive actor, stale/replayed submission and current/source unchanged before final approval.
3. Catalog: absent/published-empty pointer, project with canonical rows, forbidden scope, failed publication/sync, retries, no fixture-lineage takeover and no user-value reset.
4. Seed: complete natural keys and locators, JSON/DTS separation, input order, replay, custom projects and non-parameter identities/relations.
5. Evidence: preserve trusted base, exact destination bytes, original security scanner, historical anchors, no allowance growth or fabricated zero.

Observed commands, counts and review dispositions will be appended as each item completes. No new pass is claimed by this plan.

## Item 1 — reproduced boundary failure

Real-PG route reproduction on helper 55438: `catalogProjectValueDraftDelete.integration.test.ts`, **3 tests / 3 failures** before the repair. A same-owner draft in another project was deleted; successful deletion had no removal audit; an injected audit failure did not roll deletion back. The repair belongs in the shared domain transaction, including v1 callers, rather than only in the v2 router.

After repair, the route file passes **6/6** including v1 wrong-project refusal, v2 wrong-project/foreign-owner/foreign-organization refusal, success audit and audit-failure rollback. Canonical draft integration passes **14/14**; three focused unit files pass **63/63**. `npm run typecheck` passes on this intermediate item-1 tree. These are local observations, not final combined acceptance.

## Item 2 — contract decision before implementation

The ordinary topology submission retains `hardware_review → software_review → software_merge` with three project-role pools. The canonical source workflow retains its existing single `software_review` approve/apply unit. The local correction is one optional named software reviewer (with explicit eligible-pool fallback), software-only canonical readiness, and current active/project-role authorization serialized with revocation before approval or replay disclosure. It does not introduce an exclusive assignee or translate canonical changes into the ordinary three-stage workflow. Sources: the ordinary-submission scope in `2026-09-15-project-review-role-governance.md`, the explicit canonical software-stage authorization in section 1.5 of `2026-09-15-parameter-unification-round-report.md`, and the atomic approval requirement in `source-occurrence-workflow-contract.md`. This round's decision is not independent evidence of its own acceptance. Independent read-only investigation: worker `workflow_contract`; implementation began after item 1's focused checks passed.

## Owner decisions accepted on 2026-09-21

The owner replied to the three recommendations with “按照你的建议继续”. This authorizes the following local delivery boundary:

1. Keep canonical single-stage software review; complete property editing/deletion and migrate the corresponding regression obligations without restoring empty-Catalog fallback or silently dropping operation coverage.
2. Accept seed identity stability on permuted replay of the same completed instance, with the existing allocator unchanged. The clarification is recorded in T1.3 design §8 and B2-15.
3. Deliver the reviewed local boundary-record repairs while retaining the unresolved scanner findings explicitly. Full T1.4 zero-hit acceptance stays open and needs a separate boundary contract; no checker weakening or allowance growth is authorized.

The following paragraphs record the conflicts that prompted those decisions, not unanswered approval requests.

At the decision checkpoint, the existing topology browser suite depended on the removed empty-Catalog fallback and included three-stage review and property deletion, whereas canonical source requests supported only `set`. The accepted correction adds canonical edit/delete coverage under its own operation ID. The original operation IDs and assertions remain; full topology Gate0 acceptance is separate.

The boundary checker initially aborted on an outdated destination blob. The first independently reviewed rebind reported 214 unallowlisted and 155 stale allowances. A second reviewed batch adds 144 exact mappings and retires 11 vanished old slices; together with the first TOP retirement, that native run reported 3,561 observations, 3,491 allowlisted, 70 unallowlisted, zero stale allowances, zero metadata mismatches and zero allowance growth (exit 1). Required keep-2xx routes and locked-binding SQL contain observations with no existing historical allowance mapping. The owner accepted delivery with these findings retained; full zero-hit closure remains open. No checker rule or historical runtime/edit record has been changed.

## Prior-tree canonical browser and materialization observations

The browser and combined counts in this section predate the property-delete extension and its second JSON browser test. They do not certify the current two-test file. The delete design subsequently passed independent Spec and Standards review; its implementation and final native evidence remain in progress. Strict wire-contract reproduction is separately **4 failed / 18 collected → 18 passed** in the pure DTO unit harness (no PostgreSQL setup), covering action preservation, deleted DTS/JSON manifests and history state.

The accepted seed criterion is completed-instance replay: every binding ID survives project/file input reordering. Independently initialized databases still allocate random source identities; the allocator and binding key are unchanged.

The existing canonical review component had no production caller, and the HTTP withdrawal method was absent from the application port. Two failing frontend tests reproduced the missing queue and withdrawal. After connecting the existing panel and method, the two UI files pass 9/9; adapter/client/runtime/accessibility checks pass 4 files / 41 tests. The queue remains visible when pending is empty so history is reachable; only the submitter sees withdrawal.

Independent review then found that the global primary role could expose review buttons in a different project, and that a reviewer could see actions on their own submission. Three new failing cases reproduced those presentation errors; the two UI files now pass 14/14. The page uses the signed-in user's exact project roles (retained during auth hydration), and the panel withholds review actions from the submitter. Backend authorization remains authoritative. Combined affected frontend checks pass **9 files / 253 tests**, and `npm run build` passes on this intermediate combined tree (existing bundler externalization/chunk-size warnings remain).

`canonical-value-workflow.acceptance.spec.ts` passes 1/1 using a dedicated helper-55438 disposable runtime, real HTTP authorization, explicit first-release installation, real source upload and local storage, at 1440×900. It exercises UI draft creation/removal/reload, software-reviewer selection, unchanged current value before approval, withdrawal, rejection, resubmission, approval, and history after reload. Screenshot inspection exposed a mismatched header project; an added browser assertion failed before the header/deep-link repair and passed afterward, including switching to another project's empty queue. This is new canonical browser evidence, not a pass for the unchanged topology Gate0 suite. The disposable runtime's successful teardown is part of the observed run.

`catalogProjectBindingRead.integration.test.ts` passes 2/2 on real PostgreSQL and local object storage. Source-first/publication-later stays empty until the existing HTTP upload owner materializes values. A repeated upload refuses with 409/CONFLICT and leaves exact binding/value/pin/file/revision identities unchanged. Repeated GET and a newly opened database pool preserve identity. Opening a new pool is not an API-process restart or target-host acceptance.

Independent fixture review rejected the initial in-memory-store claim and found missing seed payload/preservation evidence. The repaired T1.3 fixture uses an owned filesystem ObjectStore, verifies archive bytes/digests, exact 372 natural-key-to-binding-ID pairs, independent thermal/JSON payloads, a non-empty custom-project role relation and shared-object preservation. A real authorized draft and submitted change precede a full row-level replay witness. A missing JSON pointer in the complete three-project fixture fails after staging nine files and three revisions with zero canonical bindings/values; the subsequent valid run succeeds. Reversing project and file order preserves the seed digest and every already-allocated identity during completed replay. The combined seed checks pass **3 files / 10 tests**. This does not prove first-allocation equivalence between independent databases. The later owner decision accepts completed-instance replay as the item-4 identity boundary; that bounded item is complete.

The latest core follow-up fixes editable-tray hydration for submitted drafts: pending requests hide their persisted drafts, while rejection/withdrawal makes them editable again. Each successful submission is removed locally even if a later batch item fails. Focused reproduction was **1 failed / 17** backend and **1 failed / 26** frontend; both passed after repair. Selected-reviewer eligibility now acquires the existing user-row lock before reading the exact project role. Its real concurrent revocation case failed before repair and passes in the existing **18-test** canonical draft suite. Independent review withdrew one incorrect browser-label finding and accepted the tray repair.

After these follow-ups, the combined server run passes **9 files / 145 tests**, affected frontend checks pass **5 files / 212 tests**, `npm run build` passes, and the real API browser flow passes **1/1**, including submission/reload with no editable pending draft and later withdrawal/rejection/resubmission. Earlier counts below remain intermediate observations, not additional tests to sum.

The registration-approval user-row lock passes its focused real-PostgreSQL file, **31/31**, after removing a redundant request-row lock; the existing conditional request decision preserves transactional rollback on a competing decision. The combined affected server check passes **9 files / 144 tests** on helper 55438, covering draft deletion, canonical workflow, materialization reads and role writes; it excludes the seed tests still being repaired. Documentation governance passes. The first database-schema documentation check skipped for missing pgvector; a subsequent explicit helper-55438 run verifies the generated database-schema artifact as current, without a skip. These are intermediate-tree observations, not final combined acceptance.

## Current boundary inventory

The unchanged native command is `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 5355f973bfb42dbc4bf47bfac25d56204bf550a9`. The final 77 unallowlisted observations are distinct from stale positions and remain failed acceptance. Seven additions since the earlier 70-row inventory are explicit SQL probes in the new JSON owner/rollback integration test; they receive no allowance:

| Family | Count | Current surfaces represented |
| --- | ---: | --- |
| CGH | 27 | Definition verification, required governance/detail/overlay routes, import and verification tests |
| FIL | 22 | Prior 15 locked binding/spec/conflict/sync/writeback observations plus seven canonical JSON integration-test SQL observations |
| MOD | 14 | Existing module impact/dismissal reads and test fixtures |
| TOP | 8 | Existing source-edit regression setup using legacy definition and locked binding rows |
| KNW | 4 | Knowledge route tests, comparison join and parameter reference identity |
| DBG | 1 | Debugging binding `parameter_spec_id` identity |
| PRJ | 1 | Changed, project-scoped draft DELETE SQL expression |

Independent review caught a repeated-call mapping error in the proposed family record before it was applied. The historical verification call belongs to the old test now at line 264; the identical call in a newly inserted test at line 248 stays unallowlisted. A regression assertion preserves this distinction. Current record hashes and exact shard-subtraction checks bind the reviewed bytes. The inventory test still requires `report.status === "failed"`; updated diagnostic counts are not a new allowance or a passing acceptance baseline.

## Final seed preservation evidence

A final seed preservation check adds pre-existing non-parameter knowledge rows and a real stored attachment. Full organization-scoped entry/file rows, ownership/relations, metadata, checksum and actual bytes match before and after both first initialization and completed replay. The updated T1.3 integration test passes **1/1**; independent review closes the preservation finding. Earlier 3-file / 10-test evidence predates this additional assertion, with production seed code unchanged.

## Actual API restart and cleanup ownership

The canonical browser now stops the exact API process group and starts a replacement on the same port, database and ObjectStore. After restart it compares the full approved binding, current value, exported source bytes and approved history. The local browser run passes **1/1**. Its non-sensitive process receipt records predecessor PID `78593`, replacement PID `78736`, port `60825`, start tokens and command hashes. `LOG_ANALYSIS_DETERMINISTIC=true` belongs only to this browser fixture's API environment and persists across its restart; it is not a shared runtime default or an external-model acceptance claim.

Independent restart review initially found three issues: failed replacement publication was not latched through disposal, the supervised launch ledger rejected a legitimate replacement, and macOS second-resolution start tokens could reject a different PID. The repair latches unresolved failures, blocks another restart, records failed cleanup and retains database/ObjectStore evidence. The finalizer requires every historical/current launch to match the complete replacement chain exactly, confirms historical process groups are absent before signaling any writer, and permits takeover only of the current incarnation. Missing, extra, unknown or still-live history remains a refusal. Same-incarnation checks include PID.

The affected script run passes **4 files / 84 tests**, including failure injection through the returned runtime's `restartApi()` and `dispose("success")` methods. The lifecycle fixture uses synthetic process probes/signals; its final isolation correction passes **2/2** again without real OS signaling. These fault-injection checks are distinct from the real browser process restart. Node TypeScript checking and the final `npm run build` pass. Incremental independent review closes all three restart findings. The native documentation gate remains required before handoff; no full supervised Gate0 run or target-server qualification is claimed.

## Intermediate property-delete checks

At this intermediate checkpoint, frontend checks passed **12 files / 279 tests** and pure DTO/JSON-parser checks passed **2 files / 29 tests**, with PostgreSQL global setup explicitly disabled. Browser collection alone was not acceptance. Final native execution is recorded below.

Independent parser/E2E Spec review passes within its source-inspection scope. It withdrew an unconfirmed instance-root deletion finding after a direct regression passed on both the prior and clarified guard: the existing final absence proof already rejected root deletion. The browser assertions now compare literal JSON bytes and validate a real deleted-value export with the strict DTO, matching its pin, base pin, request and proof to PostgreSQL. Final producer/migration alignment and execution remain required.

## Final local verification and review

The final server command uses the native `npm run test:server -- <affected files>` with both database URLs explicitly bound to a fresh helper-55438 database and one worker. **20 files / 211 tests pass, zero failed or skipped** (`/tmp/849-final-candidate-server.log`). This includes the earlier nine core files, the three seed files, strict DTO/JSON/DTS source checks, ProjectValue service/integration/concurrency, the protected-read adapter, and populated property-delete migration. Unit cases in that combined run are not individually described as PostgreSQL integration evidence.

Unchanged affected frontend checks pass **12 files / 279 tests** (`/tmp/849-current-delete-frontend.log`). The eight affected relocation/restart/cleanup script files pass **219 tests** (`/tmp/849-final-scripts.log`). `npm run build` passes (`/tmp/849-final-reviewed-build.log`), retaining existing bundler externalization/chunk-size warnings. The schema artifact was regenerated from disposable helper PostgreSQL after adding migrations 0160/0161.

The final real-API browser file passes **2/2** at 1440×900 (`/tmp/849-final-candidate-browser.log`), covering DTS editing/deletion, JSON deletion, exact export/history, actual API replacement and post-restart reads. All three review screenshots were inspected. The browser leaves the app during each intentional outage and reopens after readiness; this proves persistence/restart, not uninterrupted frontend reconnect behavior. A prior attempt failed because background `/api/v1/me` polling raced the planned outage; no diagnostic exception was added. `npm run docs:check` passes with a reachable helper and current schema artifact, without a skip. Operation-matrix validation and `npm run acceptance:coverage -- --results /tmp/849-canonical-browser-results/results.json` pass. The explicit result path avoids an older collection-only report; static mapping coverage does not mean the entire Gate0 suite ran.

Independent Standards (`standards_review`) and Spec (`seed_independent_review`) source reviews now report **PASS within the accepted local scope**, with no remaining production finding. Reviewers excluded their own implementation/test paths; the coordinator and the other reviewer covered those increments. Review corrections and runnable evidence include:

- Strict action/format/state DTOs; final approval rehydrates the request so JSON deletion does not become DTS in the response.
- Immutable terminal tombstones, exact historical export, protected-reader refusal and deleted-ID admission before the old draft/import fallback.
- Request/action/base-pin/target-versus-sibling checks at append/CAS; sorted source-occurrence and Binding locks with membership rereads. A two-connection probe reproduced the missing FK-reference lock before repair.
- Exact DTS before/after bytes, unique maximal delete effects, JSON member/absence proof, complete owner request/value/history/audit/source association, and owner-verified locator digest. Wrong applied-value reuse and wrong JSON digest were accepted in Red and refused after repair; tied DTS effects and audit failures roll back.
- Populated 0159 → 0160 → 0161 preserves the prior Binding/value/pin/history/source-version rows and active projection. JSON digest helper ownership/EXECUTE privilege assertions failed before the final symmetric owner/revoke correction and pass afterward.

The proposed JSON re-registration bypass was **withdrawn**, because its real source/database probe already refuses on the existing implementation; `canonicalJsonSource.ts` was not changed. The earlier proposed JSON instance-root bypass was also withdrawn after the original absence proof rejected it. Neither is presented as a repaired defect.

Current boundary bytes are independently reviewed: consumer record SHA-256 `97f3190a80d0800fac88b6d3d5b60897ed24312ef056bdc59e2099dfa6e712a9`, 237 mappings; family record SHA-256 `6e55b1378acf6f4439392ae53971092a996c12b41fe358fa31622f052e7f4cf2`, 265 mappings. Native scanning remains **failed with 77 unallowlisted**, not zero-hit T1.4 acceptance. No scanner rule, historical runtime/edit record, or allowance-growth limit was relaxed.

## Test target incident

One initial server-test invocation omitted `TEST_DATABASE_URL` and reached the harness default `127.0.0.1:5432/wiseeff`. Global setup failed on the immutable migration 0151 checksum before pending migrations in that shared database or tests ran. A subsequent read-only query observed zero migrations applied in the preceding two hours and zero null migration checksums; this is not a claim that all metadata was compared before and after. No repair or rollback of that database was attempted. The user was informed. The subsequent core verification used an explicit helper-55438 URL; the failed setup is neither a Red test nor acceptance evidence.

During the later JSON parser subtask, the worker incorrectly repeated the unqualified native command `npm run test:server -- server/modules/parameter-files/jsonSource.test.ts` despite the no-DB instruction. Neither database URL was explicitly set, so it again selected shared `5432/wiseeff`. The observed stack reached the shared `applyMigrations` checksum check through `testDatabase.ts:210` and stopped on 0151 before test collection or that shared path's pending migration loop. The preceding template preparation may have reused or created a template and cleaned stale test databases; the output does not establish which occurred. Metadata bootstrap/checksum-backfill effects and template effects are unknown, so no zero-change claim is made. No further shared query, repair, rollback or cleanup was attempted. The user was informed and the worker was restricted to read-only review. Its later isolated parser run is **10/10 unit checks only**, using no database/global setup; no parser Red run was observed. All remaining PostgreSQL verification must use the explicit helper-55438 wrapper.
