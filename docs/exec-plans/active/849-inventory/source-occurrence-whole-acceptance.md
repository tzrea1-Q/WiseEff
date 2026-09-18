# T1.1 whole-candidate acceptance checkpoint

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/source-occurrence-whole-acceptance.md)

Status: **T1.1 local acceptance and seal preparation COMPLETE; formal SEALED delivery NOT performed.** The user authorized the R5/R6 design review, repair and acceptance after the earlier blocked checkpoint. Both findings are now closed with independent design and final implementation reviews. Stop here: no T1.2, commit, PR, merge, deployment or alteration of existing migration history. Read with the [accepted repair design](source-occurrence-review-repair-design.md), [threat matrix](source-occurrence-threat-matrix.md) and [workflow contract](source-occurrence-workflow-contract.md).

## Final authorized R5/R6 continuation — 2026-09-17

R5 now hashes the canonical serialized locator in the existing migration adapter. Its test independently encodes the sorted, two-space, LF-terminated preimage; the obsolete compact JSON digest is refused before mutation, and canonical replay leaves Binding/value/pin/history counts stable. R6 prepares the immutable Catalog snapshot before the pool wrapper owns a write connection. The transaction-owned operation receives that snapshot and does not acquire a pool client or manage transaction lifetime. HTTP prepares the snapshot before audited writes; seed reuses its existing snapshot and preserves null-Catalog behavior. No new dependency, permissive digest fallback, current-release restriction, pool-capacity increase or timeout relaxation.

| Final-candidate evidence | Observed result |
| --- | --- |
| R5 native Red → Green | 11:56:18 canonical-positive test failed (8 selector-excluded); complete adapter file at 11:57:25 **9/9 passed**, 0 skipped. |
| R6 native Red → Green | 11:57:54 empty Catalog / max-one pool failed with connection-acquisition timeout (9 selector-excluded); sync/drafts/three seed files at 12:00:11 **33/33 passed**, 0 skipped. Empty-Catalog max-one, four concurrent populated replays, sole-client caller transaction, value/audit rollback and client release covered. Max-one populated evidence is replay, not first materialization; whole seed still needs its advisory-lock connection plus a working connection. |
| Final affected native regression | 12:07:23, **19 files / 171 passed / 0 failed / 0 skipped**, 127.96 s. Binding/migration, values, sync/routes/drafts, seed, JSON workflow and DTS proof. Not a full backend/S1 run. |
| Final static/native gates | Build, Node TypeScript, OpenAPI freshness, UI ratchet and `git diff --check` passed. Native `docs:check` on fresh `t11r56docs` helper DB passed, including pgvector schema comparison (not skipped). Boundary against accepted base: **3513/3513 approved**, unapproved/stale/metadata/growth all zero, no allowance edits. Existing build externalization/chunk warnings remain. Documentation governance is rechecked after these receipt edits. |

Fresh authenticated HTTP used helper runtime `wiseeff_acceptance_disposable_t11_pc_mu50ci5c_ad460bb2`, API `http://127.0.0.1:49155`, real password authentication, database roles and ObjectStore. `work/t11-http-loop.ts` exited **0**: DTS `<1000>` → `<1250>`, JSON `36.5` → `45.625`; preview/stage/draft leave current unchanged; self-review is 403, independent review succeeds, retry is stable, historical export/diff and exact old/current reimport remain unchanged. Requests: `pvcr_bf0ccbe5-c9e2-4975-b7a8-39002957909c` and `pvcr_affda828-49a9-4dd2-a2c3-321ab4e4a81d`. Binding GET is read-only, not the sync entry point: Spec correctly required a separate receipt for the authenticated parameter-file upload POST and its sync audit.

The final browser readback used `liu.min` on `/parameters?project=aurora` and `/parameter-review?project=aurora` at **1440×900 only**. Observed current DTS `<1250>` and JSON `45.625`, normal empty pending-review state, document width 1440, no overlap/overflow in inspected screenshots `work/ui-checks/t11-r56-current.png` and `t11-r56-review.png`. Refreshed pages had zero console errors and two existing CopilotKit license warnings each; initial unauthenticated `/me` returned 401, subsequent observed API calls returned 200, no observed 5xx. This is fresh readback/navigation evidence, not a rerun of the earlier complete browser editing/keyboard flow below. Browser closed; SIGTERM to the exact owned runtime PID 73753 completed disposal. No Hosted/target/release claim.

**Standards: PASS.** Independent Luna/max reviewer checked actual dirty diff plus untracked R5/R6 code, proof-before-write, canonical digest, all transaction owners and relevant security/development/protocol rules; no blocking P1 or actionable code-smell finding. **Spec: PASS.** Independent Luna/max reviewer checked the approved R5/R6 design and workflow contract, immutable snapshot semantics, seed null behavior, canonical refusal/replay and rollback evidence; no blocking P1. Reviews are bounded; reviewers did not implement these changes or claim independent execution of the parent's tests. Earlier B1-03/06/29 and live-fixture reviews remain separately scoped below.

Original archive and active 0151/0152/0153 hashes were rechecked unchanged. A final read-only persistent-lane query still returned only historical 0151 `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`, no 0152/0153. T1.1's local candidate is ready for the user's next delivery decision, not a committed exact-SHA seal. All subsequent todos remain unchecked. #849/#853 are not closed; S1/S2, remaining consumer/seed/cutover work and later delivery retain their own gates.

### Explicit authenticated upload/sync receipt

To close the Spec evidence note without changing production code, the existing disposable runtime script gained assertions at the actual upload seam. Fresh native runtime `wiseeff_acceptance_disposable_t11_pc_mu50odt5_18fa08e8`, API port 64624, passed: real authenticated `POST /api/v1/projects/aurora/parameter-files` returned **201**; canonical Binding count moved **0 → 1**, current DTS value was `<1000>`; exactly one canonical sync audit was added with actor `u-xu-yun`, action `binding-edited`, `written:1`, and target revision equal to the new source pin revision. Audit trace: `69e33f1c-3928-42de-9dd2-6890cb879b79`. Repeated read-only Binding GET left the response and audit collection unchanged. The script printed the explicit success receipt and reached ready; SIGTERM to owned PID 4898 then disposed the runtime with exit **0**. This is initial HTTP materialization on the normal runtime pool, separate from the max-one replay tests; it does not turn GET into a sync operation. Independent review confirmed the P2 evidence note closed. The script and screenshots remain ignored local evidence, not committed qualification artifacts.

Read-only cleanup checks found neither of the two final runtime database names in `pg_database` and no listener on ports 49155, 64624 or 5174. The persistent task lane was not a cleanup target.

## Candidate and execution boundary

Root instruction discovery selected `AGENTS.md` in `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`; root `AGENTS.override.md` is absent and the scoped nested instruction search found none. Branch is `codex/849-853-t11-source-identity`, inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`, accepted base `46b6068693942b95f7cba28ee5de6748a97170fa`. Actual T1.1 code is the dirty diff against HEAD plus untracked files, not just `base...HEAD`. Inherited work and the main checkout remain intact. This turn did not refresh/rebase main; refresh is still required before future integration.

All native tests use fresh helper-owned databases on dedicated pgvector PostgreSQL port 55438. `wiseeff_lane_849` is only the server/admin connection locator, never the migration target. A final read-only check still found historical 0151 checksum `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7` and no 0152/0153. Archived original 0151, active 0151/0152/0153 retain the four SHA-256 values in the earlier repair receipt. No persistent receipt or history was rewritten.

## Earlier whole-candidate verification ledger (before R5/R6)

| Check | Observed result and limitation |
| --- | --- |
| Affected backend collection, 11:04:37 | 105 files; 896 passed / 9 failed / 0 skipped of 905. Three timeouts in two source-proof/migration files; six deterministic stale live schema fingerprint failures in two comparison contribution files. This was not a full backend/S1 suite. |
| Isolated backend rerun, 11:13:22 | The two timed-out files plus corrected matcher/capability compatibility paths: 4 files, 71 passed, 0 skipped, unchanged assertions/timeouts, one worker. The original invocation had named two nonexistent compatibility paths; these are the actual coverage, not extra claimed collection in the first run. |
| Live schema fixture correction, 11:22:48 | Two comparison files, 8 passed, 0 skipped. Only the live expected fingerprint/comment was updated; frozen 0137 remains unchanged. |
| Frontend affected tests, 11:04:37 | 11 files, 136 passed, 0 skipped. |
| Boundary script tests | Initial 4-file attempt: 24 passed / 104 skipped because three beforeAll hooks timed out. One isolated single-worker rerun of those three files: 104 passed, 0 skipped. No timeout/assertion relaxation. |
| New migration evidence, 11:30:54 | Source-occurrence migration plus shared migration runner: 2 files, 26 passed, 0 skipped. Includes B1-06 and B1-29 below. |
| Final changed-evidence regression, 11:37:39 | JSON workflow, source-occurrence migration, shared runner and both comparison contributions: 5 files, 51 passed / 0 failed / 0 skipped, 32.56 s. This includes the parent's final actual-file-pointer isolation assertion. |
| Static gates | Build and Node TypeScript passed; browser externalization/large-chunk warnings remain. Lint `--quiet` returned zero errors (not a claim of zero warnings); contract freshness and UI ratchet passed. Full boundary checker against accepted base: 3513 approved / 3513 findings, zero unapproved/stale/metadata/growth; no allowance edits. Final post-evidence checks are recorded below. |

Do not sum overlapping selective runs into a fictitious single all-green run. Broad failures were isolated once, not repeatedly rerun as a full suite.

### Live schema fingerprint explanation

The native six-category inventory (relations, columns, constraints, indexes, triggers, functions) was compared on fresh databases using the unchanged migration runner. Original archived 0151 plus 0152 gives `49bef3f5ef76c8a233c9d67de5f2b716bf9e509f1fc1e336166cd3155ecea38d`; revised 0151 plus 0152 gives `55bc44246fe7372769e9503ef5db3d2de424d3d4e4103d004ca1b311eef43c05`; current 0153 gives `7976ce24cb2bcccfeab4e0f33caa51eb298e26849991fe0e28afc66df29a9649`.

Exactly ten entries explain the change: R1 pin-locator constraint, observation owner function and canonical DTS locator function; 0153 replacement occurrence constraint, root-digest constraint, replacement owner function/trigger, occurrence-identity function and both current-binding resolvers. No additional relation/column/index difference occurred. Both reviewers accepted this live fixture calibration. It is not a new seal, a historical checksum alias or a replacement for the 0137 freeze.

### Added matrix evidence

- **B1-06:** create a second valid occurrence in the same tenant/project/file/config-set, then forge an observation and a match toward it while preserving the existing subject/Definition. Owner/composite FK rejection leaves both valid migrated matches intact and rolls back probe observations. The first test attempt hit the observation exact-replay uniqueness before the match; the fixture was corrected with a distinct matcher revision and the required locator digest. This was a fixture failure, not a production Red.
- **B1-29:** disconnect the exact test-owned runner connection after all populated 0151 SQL but before receipt/commit. A separate observer sees no new table/column/receipt and unchanged old Binding/observation rows. A new connection applies 0151–0153 exactly once; the next run applies nothing. An older, through-0150 file inventory is refused without changing receipts or Bindings. This verifies rollback/resume and downgrade-inventory refusal, not a destructive down migration or deployment recovery drill.
- **B1-03:** the same Definition creates three distinct Bindings/occurrences across three files and two config sets. Applying one target advances its same-set sibling's pin/revision while preserving that sibling's business value and file version. The other set retains its exact value, pin, revision, actual current-file record and real stored source snapshot. The JSON suite passed 17/17, followed by the final combined 51/51 above. These additions are coverage-only, not a claimed production Red-to-Green fix.

Independent bounded evidence review accepted B1-03 and B1-06 and the rollback/reconnect/old-inventory core of B1-29. The new interruption case does not itself call the old DTS resolver; resolver compatibility remains in its existing migration tests. The role/HTTP evidence is separate from these DB ownership cases. The parent strengthened B1-03 with an actual current-file readback after review and reran the complete changed-evidence collection.

## Earlier HTTP and single-PC evidence (before R5/R6)

A helper-owned disposable runtime used real local password authentication with database-backed roles, real API, native PostgreSQL and local ObjectStore. Fixture Catalog installation/registration is setup, not production publication-manager or final seed qualification. Runtime URL was `http://127.0.0.1:5174`, API `http://127.0.0.1:58425`; routes `/parameters?project=aurora` and `/parameter-review?project=aurora`. Viewport was **1440×900 only**. Both final page widths were 1440; inspected screenshots showed no horizontal overflow or overlapping controls.

The HTTP loop asserted DTS `<1000>` → `<1250>` and JSON `36.5` → `45.625`, genuine drafts with unchanged current values, submit/frozen diff, self-review 403, independent approval, repeat no-op, stable historical export, exact old/current reimport and stable historical diff. Requests were `pvcr_b882f4a6-8ac0-4629-b391-2b6b9f80dca3` and `pvcr_6f4e2ca8-7f3a-47d6-9fad-de45f3ed660b`. The script completed its assertions; a subsequent unquoted CLI URL in its shell wrapper failed glob expansion, so the wrapper itself is not an exit-zero receipt.

Separate author/reviewer browser sessions then exercised malformed JSON validation (400), corrected JSON draft/tray, submit, automatic frozen diff, keyboard approval and refreshed `46.875`; DTS edit/tray/submit/approval then refreshed `<1300>`, with JSON still `46.875`. Browser request IDs: JSON `pvcr_a37a099f-5c24-47c7-8f46-d6c3ef86ed76`; DTS `pvcr_111157ff-f426-44da-9bb8-3b43ae71581e`. Both approval requests returned 200. Snapshot and screenshot evidence is in local `work/ui-checks/t11-accept-{json-error,json-review,dts-draft,dts-review,current}.png` and `.playwright-cli/` (gitignored, not a committed artifact).

Final refreshed sessions had zero console errors and two pre-existing CopilotKit licensing warnings each. Earlier unauthenticated `/me` 401s and deliberate malformed JSON 400 remain recorded; no observed 5xx. No sensitive headers/tokens were inspected. Both browser sessions closed; the exact task runtime received SIGTERM and reported disposal of `wiseeff_acceptance_disposable_t11_pc_mu4y5g9b_4e7f707c`. Read-only database inventory and port checks confirmed that database and both listeners were gone. This is local evidence, not Hosted, target, S1/S2 or release acceptance.

## Earlier review findings and respected design stop gate (historical)

The following records the checkpoint before renewed user authorization. Its open/stop wording is historical; the final continuation above is the current disposition.

Both independent whole-candidate reviewers and the bounded evidence worker used GPT-5.6-Luna / `max`; implementation does not self-approve. Reviews were bounded, not a claim that every line of the large dirty candidate was exhaustively audited.

**Standards:** live fingerprint finding is fixed and verified. The proposed stale-current-release race was withdrawn: a captured immutable Catalog snapshot may legitimately continue using its pinned release. **One confirmed P1 remains:** `binding/migrationAdapter.ts` hashes `JSON.stringify(locator)` while canonical pins use `serializeContract(locator)`. The fixtures use the same noncanonical calculation and therefore hide rejection of a valid canonical proof. A fixed five-key read-only vector gives adapter `sha256:de386a8fc1fc63cad6be4d3485563790a0a33b965b1d6f3d39c48fce6e018af8` versus canonical `sha256:1b9ad36da413ad4a105de8eedaece29006c15816b74ce8628e8d7b9d03f3dea4`.

**Spec:** the initial sibling-value P1 was withdrawn after tracing verified complete source bytes into the same transaction's new parser results. The initial dangling-overlay P1 has no current canonical-bound reproducer; permissive generic ingest alone does not prove the canonical path admits it. Keep malformed historical canonical provenance as a B1-16 residual boundary, not an asserted reproduced defect. The concrete remaining review items were B1-03/06/29 coverage gaps described above; their evidence must be re-reviewed before PASS.

**R6 — additional independently confirmed P1, not the withdrawn stale-release claim:** the new self-owned sync transaction holds a pool connection while `loadPublishedCatalog(pool)` asks the same pool for another. On fresh native PostgreSQL with `max:1, connectionTimeoutMillis:300`, standalone loading returns `null` for the empty Catalog, but sync fails with `timeout exceeded when trying to connect` instead of returning zero. The task-owned pool closes and helper cleans up. Standards confirmed the pool-starvation/transaction-lifecycle defect, including caller-owned transactions and saturated pools. No production repair was made.

The repeated source-proof/canonical-digest P1 triggers delivery protocol Step 5: **stop ordinary patching and return to threat/design review**. Do not silently defer the adapter or loosen evidence. The prior authorization covered R1–R4, not a newly chosen transaction interface. Current production files/migrations are untouched by this continuation; changes are acceptance tests, the live test fingerprint and bilingual evidence.

Next bounded design packet must cover: (1) **R5**, canonical serialization in the existing adapter and independently derived fixtures, preserving refusal of noncanonical inputs and all historical pins/receipts; (2) **R6**, prepare the immutable snapshot outside the transaction, pass it into the existing transaction-owned sync operation, and update direct-pool, HTTP and seed owners consistently, without nested pool acquisition, fake Pool casts or nested BEGIN/COMMIT; (3) native positive/refusal and single-connection/caller-owned/full-pool tests; (4) independent Standards/Spec design review before production edits, then focused regression and final acceptance. Snapshot preparation must retain the existing release semantics, not impose an invented latest-release requirement. This checkpoint does not authorize that repair, broaden Catalog behavior, regenerate relocation allowances or start T1.2.

## Documentation Impact Matrix

| Area | Disposition |
| --- | --- |
| Plans and evidence | Add this bilingual checkpoint; update todolist/threat-matrix current status and link from repair receipt. |
| Runtime/schema/API/security | Authorized R5 adapter digest correction and R6 transaction ownership split; HTTP/seed callers adapted. No schema, public API or permission expansion; earlier repair evidence remains separately scoped. |
| Tests/generated artifacts | Two migration tests and cross-set JSON evidence; one explained live fingerprint correction. No historical freeze, applied migration, allowance or generated SQL-schema change. |

## Documentation Update Gate

The earlier evidence-addition gate passed Node TypeScript, boundary (3513/3513 approved), native `docs:check` on `t11acceptdocs` and diff validation, but correctly did not close R5/R6 then. The separately authorized final continuation above closes both findings and completes T1.1 local acceptance/seal preparation. English/Chinese receipts and todolist are updated together; final document-governance and diff validation cover these edits. No commit, formal SEALED state, PR, merge, issue closure or next todo is claimed.
