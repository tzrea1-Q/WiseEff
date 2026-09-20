# T1.1 reopened review repair design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/source-occurrence-review-repair-design.md)

Status: authorized Scratch repair. After the bounded design reviews, the user explicitly accepted revising unpublished 0151 while preserving its original bytes, existing task databases/receipts and 0152. This does not authorize applied-history rewriting, scope reduction, commit/PR/merge or the next todo. Read with the [threat matrix](source-occurrence-threat-matrix.md), [schema contract](source-occurrence-schema-contract.md) and [workflow contract](source-occurrence-workflow-contract.md).

## Authorized R5/R6 continuation (2026-09-17)

The user explicitly authorized the R5/R6 design review, repair and acceptance described in the whole-acceptance checkpoint. Complete T1.1 local acceptance/seal preparation, then stop; no T1.2, commit, PR, merge, deployment or historical receipt rewrite. This is a renewed threat/design gate, not permission to skip its independent reviews. The parent's concrete packet below must receive both Standards and Spec design approval before production edits.

### R5: one canonical locator representation

The existing adapter must hash `serializeContract(locator)` exactly as all canonical pin writers do; reuse the existing serializer, not a new helper/format. Fix its two direct test proof constructors and the shared source-backed fixture. Keep exact locator shape, real ObjectStore/CST proof, value agreement, replay, role/tenant and owned-source-commit restrictions unchanged. Canonical valid proof must succeed; the formerly accepted compact/insertion-order JSON digest must refuse before any Binding/value/history/pin mutation. Use a literal sorted, two-space, LF-terminated locator preimage in the native adapter test as an independent oracle, including the existing fixed SHA-256 vector. Do not derive expected bytes by reusing the production call. Existing persisted pins/receipts and all migration bytes stay unchanged; no permissive legacy-digest fallback.

### R6: snapshot preparation precedes write-transaction ownership

Keep the existing `loadPublishedCatalog(pool)` semantics: its immutable release snapshot is allowed to remain pinned while publication advances. Do not add a latest-release check or borrow the business transaction for the Catalog Kernel's repeatable-read transaction.

- `syncPublishedCatalogProjectValues(pool, input)` remains the direct-pool entry. Load the snapshot first; empty Catalog returns zero without acquiring a write client. Then acquire one client, BEGIN once, call the transaction-owned operation, COMMIT/ROLLBACK once, always release. No recursive call and no optional session fallback.
- Extract the existing write body as `syncPublishedCatalogProjectValuesInTransaction(tx, snapshot, input)`. It requires a prepared non-null `CatalogSnapshot` and an existing transaction client, takes no pool, never loads a snapshot and never begins/commits/releases the caller transaction. Preserve sorted source locks, ownership checks, source pin/value/history writes, CAS and retryable-conflict translation. Reuse existing types; one shared input type is sufficient, no new abstraction or dependency.
- HTTP `syncLatestPublishedValues` prepares the snapshot before `withAuditedWrite`; an absent Catalog remains a zero-write/no-audit no-op. The audited callback calls only the transaction-owned operation. Authorization and durable audit behavior stay unchanged.
- Seed materialization already prepares `snapshot` before staging. Reuse that exact snapshot for registration and all project sync transactions; do not fetch another inside `root.transaction`. Preserve existing no-Catalog behavior. Its pre-existing advisory-lock session remains held separately: the whole seed operation needs the lock connection plus a working connection; R6 does not promise a one-connection seed orchestrator or rewrite its lock lifecycle. A project sync must not acquire a third connection.
- Adapt every caller and existing caller-owned rollback test. No fake Pool cast, pool cache, nested BEGIN, globally raised pool size or timeout relaxation.

### Accepted verification seams and review packet

These are the existing user-confirmed native seams: `mapLegacyBinding`, direct/caller-owned canonical sync, authenticated sync route and seed materialization. R5 first exposes canonical proof rejection with an independently encoded locator; then confirms old-digest refusal and existing adapter/replacement regressions. R6 first reproduces direct sync with `max:1` (including empty Catalog), then proves a populated sync, caller-owned rollback/audit atomicity, released clients and saturated-pool completion without nested acquisition. Concurrent source-lock conflicts are allowed only as the existing retryable conflict, never a pool-acquisition timeout. Reuse real PostgreSQL, published fixture snapshots and existing real source fixtures; no mocked pool proof. Run only fresh helper-owned databases on 55438.

Implementation ownership: parent owns R6 integration, R5 minimal serializer correction and documentation; any worker receives disjoint tests only. Independent Luna/max reviewers own Standards and Spec conclusions. After both design approvals, perform Red→Green by seam, narrow regression, build/Node TypeScript/contract/docs/boundary gates, then independent pre-seal review. No SQL/schema/fingerprint/allowance regeneration is expected. Earlier whole-candidate tests and PC evidence remain explicitly time/candidate-scoped; do not relabel them as fresh execution after product edits.

### R5/R6 execution receipt

Both independent GPT-5.6-Luna / `max` design reviews passed before production edits. R5 reuses `serializeContract`; the independent literal locator preimage exposes canonical rejection before the patch and accepts it after the patch. The compact JSON digest is refused, with Binding/value/pin/history counts unchanged; canonical replay is stable. Native Red: 1 failed / 8 selector-excluded at 11:56:18. Green: the complete adapter file, **9/9**, at 11:57:25.

R6 now separates snapshot preparation from transaction-owned work exactly as above. All direct, HTTP, seed and test callers are adapted; the seed retains its null-snapshot no-op and existing two-connection orchestration boundary. Native Red: empty Catalog with `max:1` failed with `timeout exceeded when trying to connect` at 11:57:54 (1 failed / 9 selector-excluded). Green at 12:00:11: sync, drafts and three seed files, **33/33**, no skips. Coverage includes empty-Catalog single connection, four concurrent populated-Catalog replays on one connection, a caller-owned transaction on the sole client, existing forced value/audit rollback and released-client/pool health assertions. The populated max-one case is replay, not initial creation; the existing initial-materialization case uses the transaction-owned operation on its normal pool. No timeout or pool-capacity relaxation.

Final affected collection at 12:07:23: **19 files, 171 passed / 0 failed / 0 skipped**, 127.96 s, fresh helper-owned PostgreSQL. It covers Binding/migration, values, sync/routes/drafts, seed, JSON workflow and DTS source proof. Build, Node TypeScript, OpenAPI freshness, UI ratchet and native `docs:check` passed; boundary remains 3513/3513 approved with zero other categories. New real-auth HTTP and single-PC observations, independent final review disposition and the exact stop boundary are in the [whole-acceptance receipt](source-occurrence-whole-acceptance.md). No migration, schema fingerprint, allowance, original archive or persistent receipt changed in R5/R6.

## Earlier R1–R4 boundary and evidence

Later whole-candidate acceptance is recorded separately in the [2026-09-17 checkpoint](source-occurrence-whole-acceptance.md). Its adapter-digest and sync-connection findings reopened the design gate; the separately authorized R5/R6 continuation above does not rewrite this earlier R1–R4 receipt.

- Repository/cwd instruction discovery selected root `AGENTS.md`; `AGENTS.override.md` is absent. No nested `AGENTS*` was found in scoped plan/migration/source directories. Inherited HEAD is `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main is `46b6068693942b95f7cba28ee5de6748a97170fa`. This design does not rebase or modify inherited work.
- Frozen 0151 SHA-256: `b2740b8ef3854661ef156bf63d0f83ba72403b41ba616ca0c02961964f65ed64`; frozen 0152: `fbdb6ae3efbae67476c7daf96491d08904b995d3654d6027cc07ad3a9acc88fe`. The archived original 0151 and active 0152 remain unchanged; the explicitly authorized active Scratch 0151 is now revised.
- 0151 is untracked in this Scratch tree; the local `git log --all -- server/migrations/0151_source_occurrence_identity.sql` returned no commit. This does not prove absence from remote/unseen deployments.
- A read-only query of the task's persistent `wiseeff_lane_849` found 0151 checksum `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`, applied at `2026-09-16T13:54:02.562Z`, and no 0152 row. This is a distinct historical candidate, not an authorized checksum to normalize. No database or migration-history mutation was performed.
- The runner inventories names, checks applied checksums, then executes sorted pending files in separate transactions. A failure in 0151 prevents any ordinary 0153 successor from running. `before`/`through` are test/setup bounds, not a production bypass.
- User clarification: “本任务测试库执行过就可以”. Work proceeds within this task's test-database scope; this is not independently verified evidence about any external deployment. The existing `wiseeff_lane_849` database and its older receipt remain untouched. The accepted boundary is to revise only the unpublished Scratch 0151, preserve the original frozen bytes/digest as evidence, and verify upgrades on newly helper-owned disposable databases. No existing applied receipt is reinterpreted as the revised candidate.

## R1 — populated observation/match upgrade (P1 on both axes)

The early null guard precedes actual backfill, and the later `md5:` assignment conflicts with the required canonical parameter-locator SHA-256. Moving only the guard or changing only the digest spelling is insufficient.

**Accepted execution decision:** ordinary additive SQL cannot repair this pre-0151 failure. Within the user-clarified task-test scope, preserve applied histories and revise only the explicitly unfrozen unpublished Scratch candidate. Preserve frozen `b274…` bytes outside the active migration inventory; leave 0152 and the existing `8930…` task lane untouched. Test `0150 → revised 0151 → 0152` using the unchanged migration runner on new helper-owned disposable databases. An existing applied checksum mismatch must still fail. External environments and any forward-recovery contract remain outside this authorization. Do not reset the existing lane, delete evidence to make 0151 empty, insert a pre-0151 staging workaround, add checksum aliases, skip SQL, or manufacture a receipt that the migration ran.

The repaired upgrade must prove every existing observation's immutable tenant/project/revision/file/property ownership and exact canonical format-tagged parameter locator; ambiguity, missing source, cross-owner evidence or an unsupported historical locator aborts the whole upgrade. Preserve observation/match/review-evidence IDs and reference sets. Use the same canonical locator/digest representation as current ingestion; never hash a display path or rely on a same-name/raw-value match. Distinct parameters under one root remain distinct.

Derive each observation's root from its own exact typed locator and historical revision/member/file-version/node/property/effect ownership, not `_0151_binding_roots` or a current Binding tip. Require a unique consistent historical root; create/reuse its exact natural occurrence key and then prove each match agrees with both the observation and its Binding. Preserve the source locator rather than translating unsupported legacy shapes. Missing/extra/non-string locator keys, zero/multiple ownership candidates, contradictory effects or cross-owner facts abort the transaction. Any JSON identity requires already-persisted schema/instance/file/root proof and containment; do not fabricate it. Lock affected observation/match and historical graph rows by sorted IDs under the existing ordered table fence. Only after exact backfill succeeds may final non-null/FK/unique checks run. Positive populated observation **and match**, linked review-evidence, and historical-not-current-revision coverage are mandatory; refusal-only tests do not satisfy this requirement.

The bounded Spec review distinguishes identity/ownership proof from source-byte/value proof: the persisted graph can establish unique DTS locator ownership, but cannot establish object bytes, CST or the actual source value. Observation backfill follows schema contract §2.5 and Phase B; it must not be presented as the separate adapter/replacement source-value proof. Those runtime paths retain their real ObjectStore proof unchanged. The existing ordered `SHARE ROW EXCLUSIVE` table fence at the start of 0151 already encloses discovery, backfill and constraint validation in the runner's one transaction; no new migration hook or lock framework is needed.

Canonical digest feasibility is now checked read-only in the task lane: after validating exactly five string-valued DTS locator keys, serialize keys in fixed ASCII order, JSON-escape each scalar, use two-space indentation and LF separators including the final LF, then hash exact UTF-8 with `pg_catalog.sha256(bytea)`. This is a bounded locator serialization, not a generic JSON serializer. Two SQL/TypeScript byte-equality vectors passed: `{fileVersionId: "version-1", kind: "dts-property", nodeOccurrenceId: "node-1", propertyName: "clock-frequency", propertyOccurrenceId: "property-1"}` hashes to `sha256:1b9ad36da413ad4a105de8eedaece29006c15816b74ce8628e8d7b9d03f3dea4`; replacing the property occurrence suffix with an emoji and the property name with Chinese/quote/backslash/slash/accented characters also matched. The experiment used `BEGIN READ ONLY` and `ROLLBACK`, and did not implement the migration. Keep these vectors in the eventual native upgrade tests.

For replay, remove only this unpublished candidate's added `sourceOccurrenceId` field from `ObservationFingerprintModel`, restoring the existing evidence preimage. Do not rewrite old evidence fingerprints or receipts or add a permissive fallback. Occurrence remains independently enforced by the exact replay key, full locator/evidence comparison and DB ownership checks. A new exact-key idempotency receipt may be appended for a valid replay; the old source-identity receipt and observation/match/review IDs remain unchanged. Test equal retries after reconnect, same-root distinct properties, changed evidence, mismatched occurrence and unsupported legacy locators. The schema contract requires occurrence-aware replay, not a new evidence fingerprint format.

## R2 — replacement occurrence guard (Spec P1)

Use a new, independently reviewed additive migration for already valid exact-0151/0152 databases; reserve its number only at integration. Do not edit 0144/0151/0152. First check existing completed projections and abort on missing or unequal old/new occurrence ownership without rewriting history.

Add a deferred constraint trigger on the replacement-project owner covering insertion and changes to completion status/old-new Binding endpoints. Resolve the final row at constraint time, not a stale queued transition. For completed rows require both Bindings to exist in the recorded organization/project and to have identical non-null `source_occurrence_id`; retain existing Definition/value FKs. A staged valid transition in one transaction must remain possible. Add the same fail-closed comparison to both current-binding resolver projections; zero, unique and ambiguous behavior remains unchanged. No new runtime DML grant or device/publication authority.

Keep and explicitly exercise the existing ProjectValue/source-pin/current-tip guards as well: equality of Binding occurrences alone must not admit a mismatched old/new value or source pin. Their SQL/ACL remains enforced through the same owned completion transaction.

## R3 — shared complete manifest validation (Spec P1)

The three direct callers are `canonicalJsonSource.ts`, `canonicalSource.ts` and `sourcePropertyProof.ts`. Repair the existing `sourceVersion.ts` owner once: validate persisted entry/include/overlay shape and safe paths against all frozen members before returning any member bytes to callers. Reuse `normalizePersistedManifest` and existing path normalization, supplementing missing reference checks rather than adding a second parser.

For DTS or mixed revisions, require the explicit unique DTS base/entry, valid relative include roots and ordered, unique overlays that resolve to the proper frozen DTS members. JSON members remain in mixed revisions but never enter the DTS resolver. Never choose a first member or use current display filenames. JSON-only requires every member to have `format=json`, `entry_file IS NULL`, `include_search_paths=[]`, `overlay_order=[]` and `manifest_state=complete`, matching the existing creator's `insertConfigRevision` defaults. Reject nonempty DTS fields; do not call the DTS normalizer to fabricate a base or a `["."]` default. Reject malformed types, path escape, absent/wrong-format entry or overlay, ambiguous aliases and budget overflow. Complete all metadata checks before the first `getBounded` read. Validation may use a normalized view, but must not silently rewrite stored manifest identity or change historical lifecycle-state compatibility. Preserve the existing DTS rule: historical `[]` and `["."]` both have an effective resolver search path of `["."]`; nonempty path and overlay order remains ordered. Return/export each revision's original stored manifest, not the normalized view; its own exact export package must reimport unchanged. Reject `needs_review`. Existing 2 MiB/member, 128-member, 32 MiB aggregate and 8 MiB metadata limits remain. No public API expansion is required merely to relocate validation.

## R4 — JSON root digest immutability (Spec P2)

The JSON creator currently computes `sha256:` plus SHA-256 of the exact root-pointer UTF-8 bytes (not JSON serialization). Preserve that representation. The additive DB repair must reject a digest-only identity update, validate format and agreement with the immutable root on insertion, and fail preflight on inconsistent existing rows without rewriting their identity. DTS root/digest remain null. Preserve same-value no-op updates; keep actor ACLs unchanged. Reuse a supported database-native SHA-256 operation after checking availability; no new extension solely for this check.

Read-only availability check on the task lane resolved `pg_catalog.sha256(bytea)`; the design needs no new `pgcrypto` extension or grant. This check is local capability evidence, not repair execution.

## Required Red-to-Green evidence

| Repair | Positive proof | Refusal/rollback proof |
| --- | --- | --- |
| R1 | Populated observation+match+review-evidence upgrade preserves exact IDs/references; two properties in one root survive; reconnect/replay is unchanged | Unprovable/ambiguous/cross-owner/missing locator; one invalid row aborts all schema/data/receipt changes; old checksum mismatch remains refused |
| R2 | Same-occurrence completed replacement; valid pending-to-completed transaction; old/new resolver parity | Different occurrence/file/config-set/tenant, missing endpoint, invalid existing completed projection; deferred `SET CONSTRAINTS ALL IMMEDIATE` and commit both refuse without history loss |
| R3 | DTS includes/overlays, mixed set, JSON-only, immutable historical revision in all previously accepted lifecycle states | Malformed arrays, escaped/absent/wrong-format entry/overlay, alias collision and limits through the shared loader **and public export/reimport**; no partial response/state change |
| R4 | Valid empty/escaped/Unicode JSON root and exact digest; unchanged update; DTS nulls | Digest-only change, malformed/wrong digest insert, inconsistent historical row; exact rollback and role denial |

Parent owns the disposition, migrations and integration. Any implementation worker receives only a reviewed bounded path packet, uses GPT-5.6-Luna at current maximum effort, and neither opens nor merges a PR. Standards and Spec reviews remain independent. WIP is at most two implementers. Capture Red before each repair, then focused native PostgreSQL tests and real storage only where bytes are required; regenerate schema/ACL artifacts after the final accepted migration and run build/docs/boundary checks. Do not repeat the prior broad suite until findings are stable. A new changed relocation destination requires its own exact-data decision, never automatic re-signing. UI policy stays one PC 1440×900 and evidence remains local, not Hosted/target.

## Git & PR Workflow

Remain on `codex/849-853-t11-source-identity`. The user has now explicitly accepted the concrete repair contract and frozen-candidate boundary. Original 0151 is preserved outside the active inventory at `work/migration-evidence/0151-frozen-b2740b8e.sql`, verified byte-identical by SHA-256 before any repair. No commit, PR, merge, target execution or next todo is authorized.

Implementation packet: `r1_upgrade` owns 0151, its migration integration test and evidence fingerprint/replay tests; `r3_manifest` owns the shared source loader and focused source-proof/JSON integration tests. Both are GPT-5.6-Luna / `max`, with development WIP two. The parent owns documentation, integration and later R2/R4 after a slot is released. Existing `wiseeff_lane_849` is only the known server/admin connection locator: no migration or writes may target it. Each run uses helper-owned fresh databases and retains exact Red/Green counts. Independent reviewers do not implement these changes. Runtime usage is unknown; no program-wide cost claim is made.

## Historical design review and verification

- Initial design review was NOT READY. After the task-test clarification and concrete amendments above, Spec accepted the bounded observation/match ownership-backfill contract; Standards returned conditional PASS with no new blocker for its exact-locator, atomic-locking, digest and replay design. Neither conclusion substitutes for real ProjectValue/ObjectStore evidence or whole-candidate acceptance.
- Standards also accepted R3's existing effective `[]`/`["."]` compatibility and unchanged raw export identity, conditional on metadata rejection before `getBounded`. R2 retains existing ProjectValue/source-pin/current-tip tests; R4 still needs immutable-root enforcement, not only a digest-format check. The concrete Scratch-0151 unfreeze remains the execution decision for the user, not permission inferred from a test-scope answer.
- Previous design round: `git diff --check`, document governance and full `npm run docs:check` passed, with schema verification using a helper-owned disposable migrated PostgreSQL database. This continuation: two read-only SQL/TypeScript exact-byte digest vectors, document governance and diff checks passed. Frozen 0151/0152 digests remained unchanged. No product build/regression suite, repair implementation or target-environment validation was performed in either design round.

## Documentation Impact Matrix

| Area | Disposition |
| --- | --- |
| Maps/product/architecture/references | No change in this design round: `AGENTS.md`, `ARCHITECTURE.md`, ADR-0046 and the #849 contract keep their accepted invariants |
| Plan/threat/schema/workflow | Update this file, `source-occurrence-threat-matrix.md`, the closure todolist and Chinese companions; Review sibling schema/workflow contracts before implementation |
| Migration history/security/recovery | Review `server/shared/database/migrations.ts`, `docs/SECURITY.md` and `docs/runbooks/README.md`; deployment classification and any recovery authority remain explicit prerequisites, not new permissions |
| Quality/API/UI | No change to `docs/developer/verification-matrix.md`, `docs/developer/ui-quality-checklist.md` or public API/design contracts; use their existing evidence gates |
| Generated schema/ACL/fingerprints | Update the native-generated schema and role upgrade boundary through 0153 after implementation; OpenAPI remains unchanged and is checked for drift |
| Boundary records/allowances | No change to `scripts/fixtures/parameter-catalog-allowlist/`; preserve approved bytes and review actual consumer drift separately |

## Documentation Update Gate

Maintain the Chinese companion and pass full docs/diff checks before handoff. The migration boundary and source-proof seam are now explicitly authorized. Record native repair evidence and independent re-review separately from the historical design receipts; a design review alone never closes T1.1 or starts T1.2.

## Repair execution receipt (2026-09-17)

The explicitly authorized R1–R4 Scratch repair is implemented and independently re-reviewed. The parent took over R3 and then R1 after each worker stopped editing; all final integration changes are parent-owned. Implementation WIP stayed at most two. Workers and separate Standards/Spec reviewers used GPT-5.6-Luna / `max`. No shared-path concurrent editing, commit, PR, merge, applied-history rewrite or next todo occurred.

| Finding | Final disposition |
| --- | --- |
| R1 | Revised only unpublished 0151. Historical observation-owned graph/locator backfill preserves IDs, matches, review references and old evidence preimages; deterministic row locks sit inside the existing table fence. Pin and observation locators reject extra/non-string keys. DB owner verifies canonical DTS/JSON observation digests. Exact replay uses an unambiguous JSON-serialized tuple. Multi-level JSON Pointer ingestion now preserves valid segments/escapes instead of rejecting them. |
| R2 | New 0153 preflights completed replacement endpoints, defers the final-row same-occurrence/tenant/project guard and makes both resolvers refuse inconsistent projections; existing source-pin/value/current-tip guards remain. |
| R3 | Shared source-version owner validates complete metadata before object reads. Malformed historical entry/overlay export and reimport refuse without reads/mutation. Raw `[]` versus `["."]` manifest identity remains intact while retaining compatible effective resolution. |
| R4 | 0153 validates the exact UTF-8 root digest and prevents digest-only identity changes; bad historical roots abort atomically and unchanged updates remain legal. |

Exact migration SHA-256 inventory at handoff:

| Artifact | SHA-256 |
| --- | --- |
| Archived original 0151 (`work/migration-evidence/0151-frozen-b2740b8e.sql`) | `b2740b8ef3854661ef156bf63d0f83ba72403b41ba616ca0c02961964f65ed64` |
| Revised active 0151 | `fda64044cda15be8a3eade7463e1b4c7ba54b67e0ae5c4ecb0bdf5996e34e9a6` |
| Unchanged active 0152 | `fbdb6ae3efbae67476c7daf96491d08904b995d3654d6027cc07ad3a9acc88fe` |
| New 0153 | `42783d4e0cb9cdd8635f44d27153e38677cd7ee1fc6911211df915d96b34a0f1` |

Read-only recheck of persistent `wiseeff_lane_849` still shows only its historical 0151 checksum `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`, with no 0152/0153 receipt. The old lane is not evidence for the revised candidate. The original archive is local/gitignored evidence, not a committed artifact.

Verification:

- Genuine initial counterexamples: R1 populated upgrade failed 1 selected test; R2 guard run had 4 failed / 1 passed; R3 control-character manifest failed 1 selected test; R4 digest checks failed 2 selected tests. These selective runs excluded other cases and are not whole-suite totals. The final JSON multi-level-pointer native test also failed before its one-line fix, then passed. Additional replay-collision/forged-digest cases were added after their fixes and establish regression coverage, not a claimed pre-fix Red.
- Final native run: **12 files, 183 passed, 0 failed, 0 skipped**, started 2026-09-17 10:52:48 Asia/Shanghai, 29.82 s elapsed. It covered `sourceOccurrenceMigration`, `drafts`, `sourcePropertyProof`, `canonicalJsonSource`, `sourceOccurrenceGuard`, `catalogRoles`, evidence `ingest` integration/unit and `jsonLocator`, replacement `execute`/`provenance`, and seed-initialization `archive` integration. The root was newly created by `withTempDatabase(prefix: "t11repairfinal")` on the dedicated pgvector server at 55438; suites used native helper-owned children and actual runtime roles/storage as required. This is affected local regression, not a full backend/S1 run.
- Earlier combined attempts (138/139 and 139/140) were not accepted: one stale test expectation and one oversized fixture timeout were corrected. The budget fixture now uses a small two-level include expansion that still exceeds the unchanged visit budget; no timeout or production budget was increased. The final 183/183 run supersedes those attempts.
- A worker's early default-5432 probe is excluded; read-only inspection found no remaining `wiseeff_r3red_%` database, but its storage cleanup was not independently attested. An attempt against the old task lane was stopped by the unchanged checksum-drift guard and is also excluded. No old receipt was normalized.
- Final boundary checker against accepted base `46b6068693942b95f7cba28ee5de6748a97170fa`: **3513 violations / 3513 approved; 0 unapproved, stale, metadata mismatch or growth**. Dynamic test SQL/raw out-of-owner value access was replaced with static owned SQL/the existing typed repository. No allowance, checker policy or relocation record was edited.
- Final `npm run build` and Node TypeScript check passed. Existing browser-externalization and large-chunk warnings remain. Schema was regenerated through the repository command against fresh disposable PostgreSQL; OpenAPI/UI checks passed earlier in this repair round without API/UI changes. Full docs and diff checks are recorded at the documentation gate below.
- **Standards PASS:** the coercion P1 is closed; no new P1/P2 in the bounded follow-up. **Spec PASS:** replay-tuple and canonical-digest P1s are closed, including the final JSON Pointer correction; no new bounded R1–R4 blocker. Reviewers inspected code independently and used parent-run test receipts; neither claimed to rerun the tests.

Documentation gate: `npm run docs:check` passed both governance and native pgvector schema comparison on a fresh helper-owned `t11docsfinal` database root; no schema check was skipped. `git diff --check` passed. The bilingual todolist and threat matrix link this receipt and keep T1.1 unchecked.

This receipt closes the reopened R1–R4 review checklist only. The inherited dirty candidate is still uncommitted/unsealed; T1.1 remains unchecked pending whole-candidate acceptance/sealing and delivery authorization. T3.1 full backend/S1, T3.2 broader acceptance, S2, Hosted and target execution are not supplied here. This backend repair added no visible UI change or fresh browser proof; earlier PC 1440×900 evidence is historical, not re-labelled as current. Later todos remain unstarted.
