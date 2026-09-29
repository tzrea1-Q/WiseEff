# MOD D02 comparison capture and runner permissions proposal

> Chinese companion: [中文提案](../../zh-CN/exec-plans/active/2026-09-29-mod-d02-comparison-runner-permissions-proposal.md)
>
> **Status: PROPOSED ONLY.** This is a forward contract proposal, not an accepted change to the S7/P11 decisions, not an implementation, and not authorization to provision credentials or write target data. The accepted P11 contract in [the cutover, Archive, and rollback decision](../../design-docs/parameter-catalog-cutover-archive-rollback.md) remains authoritative.

Date: 2026-09-29
Review base: `e0b219d8c3b164352c4d63faec1019853d01de5c`

## Decision requested

Approve or reject one small authenticated ingress for the existing organization-scoped MOD D02 v2 evidence writer, plus its narrowly scoped database call capability. The ingress captures **pre-P11, pre-activation evidence for one organization and one completed S7 run**. It does not run, replace, or pass P11.

The recommended ingress is one authenticated internal action:

```text
POST /api/v2/parameter-catalog/cutover-runs/:runId/comparison/mod-d02
```

The route uses the existing authenticated API resolver, derives the organization and principal from the authenticated `AuthContext`, constructs `createUserInvocation(auth)` on the server, and calls the existing `writeModParameterCatalogComparisonCasesV2` path. The request supplies only `runId`; it cannot supply organization, actor, phase, permissions, gates, or a waiver. The organization-admin check is reloaded from persisted user and role rows. This is the smallest USER-authenticated ingress because the writer requires a server-branded `user` invocation and there is no production caller that can currently construct one. A CLI `operatorAuditRef` is not authenticated USER proof.

After capture, a **separate read-only independent P11 verifier** must recompute the complete V01-V17 set and D01-D09 semantic comparison across all 11 consumer families from the same pinned source boundary. It must use code and database credentials distinct from writers. The P11 report, not the organization-projection capture response or rows, is the pre-P12 evidence. The verifier independently recomputes D02; it does not treat the v2 writer's observations as proof of itself.

## Observed repository boundary

- `createReleaseVerificationService` is routes-less and defaults to an empty adapter map. `runVerification(planDigest)` accepts no trusted invocation. The production PostgreSQL adapters cover V/M/P gates; no production call to `runVerification`, `generateLiveComparisonReport`, or the v2 MOD writer exists in this tree. Production OPS comparison reads S10-PER reports through `readReport` only.
- `writeModParameterCatalogComparisonCasesV2` accepts only `phase: "pre-activation"`, a trusted user invocation, and a completed-manifest run. It derives the organization from that invocation, re-reads persisted authorization, and writes only the MOD D02 organization projection. Its result explicitly says `fullReport.available: false` and `eleven-family-and-nine-gate-coverage-not-collected`.
- `readCompletedModComparisonManifestForComparison` verifies the trusted user, persisted organization/principal, and completed P7 manifest. `0179_parameter_catalog_comparison_manifest_binding.sql` constrains v2 rows to a completed `s7-orc-p0-p10-v2` run and an exact P7 selection. Its phase column records the comparison scenario; it does not attest P13 or establish independent verification.
- The MOD writer's transaction locks `public.users` and `public.user_role_bindings` `FOR SHARE`, then locks `public.parameter_modules`, `parameter_catalog.organization_subject_registrations`, and `parameter_catalog.subject_placements` `IN SHARE MODE`. It calls `parameter_catalog.assert_catalog_subject_active` and inserts/reads the two v2 comparison relations to verify idempotency.
- Migration 0138 revokes comparison case/result table access from `PUBLIC`, `catalog_synchronizer_role`, and `parameter_governance_writer_role`. Migration 0139's `catalog_verification_writer_role` is append-only on `verification_*`; `catalog_verifier_role` is SELECT-only on `verification_*`. Neither role grants v2 comparison writes or the source reads needed by P11. Migration 0179 adds constraints and triggers, not runtime grants.
- The disposable PostgreSQL test role in `comparisonCaseResultsV2.integration.test.ts` receives broad fixture SELECT grants, the Catalog active-subject guard EXECUTE, and INSERT on the two comparison tables. The test then observes SQLSTATE `42501` for the required row/table locks until it temporarily grants `UPDATE(id)` on `users`/`user_role_bindings` and table UPDATE on modules/registrations/placements. Those grants are test probes, not a deployment role contract. Copying them to an API LOGIN would grant mutation capability.
- `docs/SECURITY.md` preserves the ordinary API LOGIN's no-direct-Catalog-write boundary and the Governance composition-root boundary. Direct API grants for 0179 INSERT or UPDATE locks would contradict that accepted contract. The existing Governance writer cannot compose this operation: it has no Catalog, Cutover, Verification, or comparison-table grants.

## Recommended execution sequence

1. A maintenance Operator starts the accepted S7 flow and proves P2 traffic isolation, zero leased work, zero business traffic, and both writer fences. The run has completed P0-P10 checkpoints and a valid v2 P7 manifest.
2. An authenticated Organization Admin submits the proposed POST action with only the completed `runId`. The server re-resolves the user's persisted organization-admin authority; a body or URL value never selects an organization. The completed-manifest reader binds the persisted run, P0/P1/P5/P7/P10 checkpoints, plan/source fingerprint, Release ID/digest, and full manifest digest. The route compares the run's target artifact SHA with its trusted deployment artifact SHA. Missing or unequal pins refuse before capture, and the current-release guard runs again in the write transaction.
3. The action runs the MOD provider and persists its complete organization projection as an atomic pre-activation case/result batch. An exact retry is a no-op replay. A different batch under an existing case identity fails closed.
4. The action returns the scoped projection digest, inventory count/checksum, case count, and append/replay counts. It returns no Archive payload, raw value, or claim that a Release Verification report passed.
5. A separately operated read-only P11 verifier executes every required V01-V17 and D01-D09 check against the same run, plan, artifact, Catalog Release, mapping epoch, and source boundary. It emits and binds immutable report digests. It independently reads/recomputes D02 and proves complete inventory/family coverage.
6. P11 passes only at the accepted thresholds: zero `unexplained-difference`, zero `unqueryable/protected-reference-missing`, every protected reference enumerated, all 11 consumer families covered, and deterministic expected counts/checksums. Only the accepted P11/report approval flow may advance to P12.

The proposed action is available only after S7 P10 and while the accepted P11 maintenance predicates still hold. It must refuse when the run is incomplete, its source pins drift, an inventory/provider read fails, an association is absent/ambiguous, or the user is unauthorized. A successful MOD D02 capture alone is never a P11 result.

## Object and permission matrix

The table distinguishes the proposed scoped capture from the independent verifier. “Exact SELECT” means only the relations/columns and run/organization rows required by the frozen provider and manifest reader; it is not schema-wide access.

| Object | Proposed MOD D02 capture | Independent P11 verifier | Explicit denial |
| --- | --- | --- | --- |
| Authenticated principal (`public.users`, `public.user_role_bindings`, `public.organizations`, `public.roles`) | Existing auth middleware resolves identity; the writer rechecks persisted active user, organization, and `admin`/`platform-admin` role. Database lock owner uses the exact `FOR SHARE` rows for users and role bindings. | Read-only identity/authorization evidence needed by the verifier. | No request-body actor/org/role; no user or role updates; no Agent/System invocation. |
| S7 run and P7 manifest (`parameter_catalog.parameter_catalog_cutover_runs`, `parameter_catalog.parameter_catalog_cutover_events`, `parameter_catalog.parameter_catalog_cutover_checkpoints`, `parameter_catalog.catalog_releases`, `parameter_catalog.legacy_identities`, `parameter_catalog.legacy_mapping_versions`, plus manifest-referenced owner rows) | SELECT the exact completed v2 run and immutable P7 selection, scoped to its authenticated organization projection. No head advance or checkpoint edit. | SELECT-only recomputation against the same frozen P0-P10 data and pins. | No new mapping, Archive, checkpoint, phase, or run writes from either path. |
| MOD source and associations (`public.parameter_modules`, `parameter_catalog.organization_subject_registrations`, `parameter_catalog.subject_placements`) | Exact organization-scoped reads and rechecks while holding `SHARE` table locks; modules and associations remain unchanged. | Read-only dual-read of legacy and canonical semantics over the accepted source snapshot. | No INSERT/UPDATE/DELETE, reconciliation, reclassification, or fallback. |
| Catalog identity and active Release | Resolve Subjects through the existing authenticated Catalog read composition; call only `parameter_catalog.assert_catalog_subject_active(text,text,text,text)` for exact active-subject guards. | SELECT/read-only canonical semantic resolution pinned to the same Release ID/digest. | No Catalog subject, Definition, Release, head, or activation writes; no publication capability. |
| `parameter_catalog.parameter_catalog_comparison_cases` | INSERT new v2 MOD/D02/pre-activation rows; SELECT by exact key to prove identical idempotent replay. | SELECT for independent consistency checks; no writes by the verifier. | No UPDATE/DELETE/TRUNCATE; no v1-row rewrite; no case insertion by P11 verifier. |
| `parameter_catalog.parameter_catalog_comparison_results` | INSERT matching result rows; SELECT by exact key/evidence tuple; run deferred constraints before commit. The capture function must check every case/result pair before returning. | SELECT for independent consistency checks; no writes by the verifier. | No UPDATE/DELETE/TRUNCATE; a case without its result must raise and roll back the function transaction. Migration 0179 alone does not enforce the reverse pair. |
| Historical raw comparison inventory (`parameter_module_dismissed_compatibles` via `parameter-modules/comparisonInventoryRepository.ts`) | Not a substitute for the scoped MOD D02 capture contract. | The independent P11 historical-read gate must first resolve the 174th unallowlisted native Catalog observation, `S12-MOD:legacy-catalog-raw-read:3d36995998094eb1:b170050e2ad90587`: the parameter-modules historical identity owner provides controlled exact row-ID enumeration and Catalog approval/retirement proof. SELECT permission alone does not authorize this raw read; the existing `comparisonInventoryRepository.ts` SQL remains unlicensed even if verifier SELECT succeeds. Six known historical unqueryable cases remain blockers; the scoped v2 organization projection does not cover or resolve them. | No write access and no silent replacement with the current Module Registry projection. |
| Archive metadata and payload | The P7 manifest may identify the exact selected Archive ID/disposition. The capture and report may retain typed IDs, checksums, counts, and disposition only. | The verifier may prove the exact Archive reference and mapping outcome. | No payload export, copy to comparison rows/logs/reports, delete, rewrite, or retention shortening. |
| Release Verification evidence (`verification_gate_registry`, `verification_plans`, `verification_attempts`, `verification_gate_results`, `verification_reports`, `verification_approvals`) | The capture route cannot approve a report or add a passed P11 gate. | A separate approved evidence-writer composition may append verifier artifact/report references; the independent source reader remains read-only. | Do not assign `catalog_verification_writer_role` or `catalog_verifier_role` to the capture route as a shortcut; these roles do not grant source access or v2 row access. |
| Trusted audit | The proposed capture function appends one fixed, redacted `public.audit_events` row in the same transaction as the case/result pair and reads it by deterministic ID on retry. A missing audit capability blocks enablement. | Persist the independent verifier's artifact/report digests through the report owner, without granting source writes to the verifier. | No caller-supplied actor attribution, raw payload logging, or best-effort audit after a committed write. |

### Exact privilege delta for the proposed capture

| Object and operation | Existing formal capability | Actual need and current gap | Proposed owner | Negative acceptance |
| --- | --- | --- | --- | --- |
| LOGIN and role switch | `wiseeff_api` is a `NOINHERIT` member of baseline reader, Governance writer, and publication coordinator; 0139 writer/verifier roles are `NOLOGIN`. No capture LOGIN or production caller exists. | A server-authenticated USER trigger and one same-database capture connection; neither SYSTEM nor a caller-built `AuthContext` suffices. | API route owns authentication; proposed `wiseeff_mod_d02_capture` LOGIN can execute only the fixed function. | Record `session_user`, `current_user`, `rolsuper=false`, `rolbypassrls=false`, no unexpected membership; worker/verifier/API cannot execute the function. |
| `assert_catalog_subject_active` `EXECUTE` | Governance writer can execute it after its controlled role switch; formal API LOGIN directly receives `42501`. | Current writer invokes it in its write transaction; Governance role does not possess comparison-table capability. | Proposed function owner gets exact-signature `EXECUTE`; no API direct grant. | Direct API call remains `42501`; wrong/drifted Release or inactive Subject refuses under the function. |
| `users` and `user_role_bindings` `FOR SHARE` | Ordinary API public-table DML is not the capture LOGIN's authority; 0139 roles do not provide these locks. Disposable test login needed `UPDATE(id)`. | Persisted admin recheck must hold both row locks until case/result commit. | Function owner alone receives exact-table `SELECT` and `UPDATE(id)`; capture LOGIN gets neither. | Direct capture-login lock returns `42501`; inactive/non-admin/cross-org request inserts zero rows. |
| `parameter_modules`, organization registrations, placements `SHARE` and reads | API's public/Governance paths are separate; the proposed capture LOGIN has no table rights. Disposable test login required table UPDATE for the locks. | Lock all three and recheck complete inventory, each module observation, and exact Registration/Placement under the write transaction. | Function owner receives the listed `SELECT` and lock-motivated table UPDATE, with no callable data-update routine. | Direct capture-login UPDATE/lock fails `42501`; changed source or association yields zero case/result/audit writes. |
| Completed-run, Release, legacy identity/version and P7 event/checkpoint `SELECT` | Formal API Catalog baseline read exists; verifier role has only `verification_*` SELECT. | Revalidate v2 completed run, plan/artifact/release/manifest and exact selection on the capture connection. | Function owner receives only the enumerated S7/Catalog `SELECT`; 0179 remains the deferred exact-selection check. | Wrong/incomplete run, selection, version, or pin refuses; capture LOGIN cannot write S7 or Catalog rows. |
| 0179 case/result `SELECT, INSERT` | 0138 excludes Governance/synchronizer/PUBLIC; 0139 writer covers only `verification_*`; formal API LOGIN has no Catalog write. | Atomically store and idempotently verify complete MOD D02 pairs. | Function owner alone gets `SELECT, INSERT` on the two named relations. | Direct API/capture-login/worker/verifier INSERT is `42501`; wrong tuple or case-only attempt cannot commit through the function. |
| `public.audit_events` `SELECT, INSERT` | Existing application audit helper writes as its caller; capture LOGIN has no direct table grant. | One fixed redacted event in the same SQL transaction as the pair; an exact request retry must read the existing event by deterministic ID. | Function owner has `SELECT, INSERT` only, through the fixed event path described below. | Direct capture-login SELECT/INSERT is `42501`; audit failure rolls back pair; same request ID with changed stable content refuses. |
| Historical dismissed row-ID enumeration | Existing `comparisonInventoryRepository.ts` raw SELECT is unlicensed by the native Catalog boundary; SELECT privilege does not cure it. | Complete organization-scoped historical identity for independent P11 comparison, separate from MOD v2 capture. | Parameter-modules historical identity owner must deliver a controlled read and Catalog approval/retirement proof in a later slice. | Current native ID remains unallowlisted; denial/unavailable source blocks P11, and read credential cannot write dismissed rows. |

## Proposed database call boundary — not current SQL or grants

The existing TypeScript writer cannot run safely under the formal API LOGIN today: direct Catalog active-Subject EXECUTE and 0179 INSERT are unavailable, and its SHARE locks require UPDATE privileges under PostgreSQL. A new migration or runtime grant is **not** implied by this proposal.

Recommended implementation candidate: one atomic `SECURITY DEFINER` function, for example `parameter_catalog.capture_mod_d02_pre_activation_v2(...)`, owned by a new `catalog_mod_d02_capture_owner` role (`NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOBYPASSRLS`). It receives the run ID, server-resolved principal and organization IDs, immutable manifest pins, and the TypeScript-produced batch/checksum. The normal route must first validate the branded USER invocation; the function independently reloads and locks persisted authorization, then relies on the 0179 deferred constraint/trigger for exact completed-run P7 selection binding. It atomically inserts the supplied evidence and audit fact. It does not re-run or certify the TypeScript provider's semantic observations; only independent P11 does that. The function cannot authenticate HTTP or replace the independent verifier.

The function owner would receive only:

- `SELECT` on `public.users`, `public.user_role_bindings`, `public.organizations`, `public.roles`, `public.parameter_modules`, `parameter_catalog.organization_subject_registrations`, `parameter_catalog.subject_placements`, `parameter_catalog.parameter_catalog_cutover_runs`, `parameter_catalog.parameter_catalog_cutover_events`, `parameter_catalog.parameter_catalog_cutover_checkpoints`, `parameter_catalog.catalog_releases`, `parameter_catalog.legacy_identities`, and `parameter_catalog.legacy_mapping_versions`;
- `UPDATE(id)` on `public.users` and `public.user_role_bindings` only because PostgreSQL requires it for the existing `FOR SHARE` row locks;
- table-level `UPDATE` on `public.parameter_modules`, `parameter_catalog.organization_subject_registrations`, and `parameter_catalog.subject_placements` only because PostgreSQL requires it for the existing `LOCK TABLE ... IN SHARE MODE` checks;
- `SELECT, INSERT` on `parameter_catalog.parameter_catalog_comparison_cases` and `parameter_catalog.parameter_catalog_comparison_results`, with no `UPDATE`, `DELETE`, or `TRUNCATE`;
- `EXECUTE` on the exact `parameter_catalog.assert_catalog_subject_active(text,text,text,text)` guard; and
- `SELECT, INSERT` on `public.audit_events` for one fixed capture event and exact-ID retry verification; no update/delete/truncate.

These lock-motivated UPDATE privileges belong only to the `NOLOGIN` function owner. The owner has no members and no login. The ordinary API runtime gets no table grants and no membership in the owner role. A dedicated `wiseeff_mod_d02_capture` LOGIN, provisioned as a separate connection used only by the authenticated capture service, gets schema `USAGE` and `EXECUTE` on this exact function only; it has no membership in Governance, Catalog, Cutover, Verification, or migration-owner roles. Revoke function EXECUTE from `PUBLIC` and every other role. Pin `search_path` to trusted system schemas (for example `pg_catalog, pg_temp`) and schema-qualify every non-system object inside the function.

The TypeScript writer must adapt to submit its produced batch through this one function call. In that transaction the function takes the existing `FOR SHARE` user/role locks and `SHARE` locks on modules, registrations, and placements, then rechecks the complete MOD inventory count/checksum, each locked module's `id/kind/origin/parentId/attributionSubjectId/sourceKey` against its case's legacy observation, and the exact Registration/Placement association. It inserts and verifies every case/result pair plus audit atomically, then forces the 0179 deferred constraint before commit; 0179 checks run/P7 selection binding but does not reject a case lacking a result. The function does not duplicate the TypeScript semantic provider or claim those observations are true. A detached preflight lock call followed by direct API DML is rejected: the locks are transaction-scoped and direct DML still fails `42501`. The independent P11 verifier remains responsible for source-boundary and semantic equivalence across all families.

The function itself owns the fixed audit insert. The existing TypeScript `withAuditedWrite` helper can share a `Database` transaction, but its ordinary audit INSERT would execute as the capture LOGIN, which deliberately has no direct `audit_events` grant. Its `public.audit_events` row uses the rechecked organization and user (`actor_type='user'`), fixed `app='release-verification'`, `kind='mod-d02-comparison-capture'`, `action='capture-pre-activation'`, `severity='Medium'`, `target_type='cutover-run'`, and `target_id=runId`; `trace_id` is the validated server request ID. Metadata contains only stable manifest/projection and source-inventory digests and case count. New/replayed counts belong in the call receipt, not the audit content checked on retry. A deterministic ID derived from length-prefixed organization, run, and request IDs makes the same request retry return the existing audit row only after reading it by ID and verifying all stable fields; a different request may record a separate replay event. Audit failure aborts the case/result transaction. This is a proposed new fixed-event definer routine, not the existing application audit helper or an already granted capability.

Non-executable SQL/call sketch for review only. The signature, arguments, and receipt fields are concrete proposals; the body placeholder intentionally makes this invalid as a migration. Do not apply it:

```sql
-- PROPOSED ONLY; NON-EXECUTABLE PSEUDO-SQL; NO MIGRATION NUMBER ASSIGNED.
CREATE ROLE catalog_mod_d02_capture_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE wiseeff_mod_d02_capture LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public, parameter_catalog TO catalog_mod_d02_capture_owner;
GRANT SELECT ON public.users, public.user_role_bindings, public.organizations, public.roles,
  public.parameter_modules, parameter_catalog.organization_subject_registrations,
  parameter_catalog.subject_placements, parameter_catalog.parameter_catalog_cutover_runs,
  parameter_catalog.parameter_catalog_cutover_events,
  parameter_catalog.parameter_catalog_cutover_checkpoints, parameter_catalog.catalog_releases,
  parameter_catalog.legacy_identities, parameter_catalog.legacy_mapping_versions,
  parameter_catalog.parameter_catalog_comparison_cases,
  parameter_catalog.parameter_catalog_comparison_results
TO catalog_mod_d02_capture_owner;
GRANT UPDATE (id) ON public.users, public.user_role_bindings TO catalog_mod_d02_capture_owner;
GRANT UPDATE ON public.parameter_modules, parameter_catalog.organization_subject_registrations,
  parameter_catalog.subject_placements TO catalog_mod_d02_capture_owner;
GRANT INSERT ON parameter_catalog.parameter_catalog_comparison_cases,
  parameter_catalog.parameter_catalog_comparison_results, public.audit_events
TO catalog_mod_d02_capture_owner;
GRANT SELECT ON public.audit_events TO catalog_mod_d02_capture_owner;
GRANT EXECUTE ON FUNCTION parameter_catalog.assert_catalog_subject_active(text,text,text,text)
TO catalog_mod_d02_capture_owner;

CREATE FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(
  p_run_id text, p_principal_id text, p_organization_id text,
  p_expected_artifact_sha text,
  p_manifest_digest text, p_projection_digest text,
  p_case_batch jsonb, p_request_id text
)
RETURNS TABLE (
  organization_id text, selection_run_id text, selection_projection_digest text,
  source_inventory_count integer, source_inventory_checksum text, case_count integer,
  newly_written_count integer, replayed_write_count integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS <reviewed body>;
ALTER FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,jsonb,text)
  OWNER TO catalog_mod_d02_capture_owner;
REVOKE ALL ON FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,jsonb,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA parameter_catalog TO wiseeff_mod_d02_capture;
GRANT EXECUTE ON FUNCTION parameter_catalog.capture_mod_d02_pre_activation_v2(text,text,text,text,text,text,jsonb,text)
  TO wiseeff_mod_d02_capture;
-- Grant no table privileges and no role membership to wiseeff_mod_d02_capture.
```

```text
PROPOSED call: route resolves auth -> createUserInvocation(auth) -> existing MOD D02 provider builds
              canonical case batch -> one function call(runId, principalId, auth-derived organizationId,
              trustedDeploymentArtifactSha, manifestDigest, projectionDigest, caseBatch, requestId)
              on dedicated connection -> return
              typed scoped receipt; independent P11 remains a separate run.
```

The SQL function receives actor and organization IDs as values; PostgreSQL cannot infer or authenticate the HTTP principal from those IDs. Only the authenticated route may select the dedicated connection and supply them. The function rechecks persisted active-user/organization-admin state under its row locks, and 0179 checks the exact run/P7 selection on inserted rows. Neither proves the TypeScript observations truthful; independent P11 does.

Proposed deployment configuration is `MOD_D02_CAPTURE_ENABLED` (default `false`), a secret `MOD_D02_CAPTURE_DATABASE_URL` for the dedicated LOGIN, and `MOD_D02_CAPTURE_ARTIFACT_SHA` populated from the deployed package attestation. At startup, the composition root must compare the capture connection's database identity with the ordinary API connection and record redacted `session_user`/`current_user` plus `rolsuper`/`rolbypassrls`; a missing URL or artifact SHA, wrong database/LOGIN, or elevated role leaves the action disabled. The function compares the server-supplied artifact SHA with the persisted run and manifest. No value is accepted from a request, and no credentials are logged. Disabling the action stops new captures without changing committed evidence.

Required privilege/atomicity acceptance before enabling the route:

- direct API LOGIN INSERT/UPDATE/DELETE/TRUNCATE on both comparison tables and UPDATE on all three locked source/association tables fails with SQLSTATE `42501`;
- direct execution of the function by `PUBLIC`, worker, Agent, verifier, Governance, or a non-authorized API role fails with `42501`;
- authenticated non-admin, inactive, cross-organization, body-scope substitution, wrong run/phase, incomplete manifest, stale inventory, altered retry, and missing audit each produce a stable refusal and zero committed case/result/audit rows;
- a valid complete write inserts matching case/result/audit rows once; exact replay inserts zero new rows; any mid-batch constraint or audit error rolls back the entire unit;
- the historical raw-read gate runs under its distinct read-only verifier credential and proves writes fail with `42501`.

These are proposed acceptance checks; the current integration-test role is disposable fixture evidence only.

## Archive retention and rollback

Comparison evidence stores typed Archive IDs and mapping/manifest digests, never Archive payload bytes. Archive relations and objects remain append-only and follow the longest protected-reference, audit, business, and legal retention period. P16 cleanup and application rollback do not delete Archive or comparison history. If the route is disabled or rolled back, revoke the dedicated function EXECUTE grant and disable/rotate the dedicated connection secret; retain 0179 and all committed case/result/audit rows. Do not apply a down migration or erase data to make an old binary appear compatible. The proposed migration is forward-only and additive; its exact version number is assigned only after approval.

## Remaining approval boundary

The single approval package is the authenticated Organization Admin trigger plus the dedicated capture connection/function capability and its atomic audit path. The accepted independent P11 verifier remains a separate blocking prerequisite owned by its existing contract; it is not an additional decision in this proposal. Approval or successful local tests alone does not authorize Hosted/target credentials, production invocation, P12, or public release. Until the approval package and role-faithful tests land, the v2 writer is a testable internal primitive and the independent P11 comparison remains a separate required gate.

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| Proposal | This file and its `docs/zh-CN/exec-plans/active/` companion | Update together |
| Accepted security and P11 contracts | `docs/SECURITY.md`, `docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md`, `docs/design-docs/parameter-catalog-cutover-archive-rollback.md` and applicable Chinese companions | Review; amend only if the proposed capability is approved |
| Runtime and API verification | `docs/developer/verification-matrix.md`, generated OpenAPI and schema docs | Update when the implementation changes route, role, or schema |

## Documentation Update Gate

This proposal remains in `active/` until the one approval package is decided. Its English and Chinese texts must stay equivalent and `npm run docs:check` must pass. An implementation must update the accepted security, API, schema, and verification documents before claiming the new action is enabled; this proposal alone changes none of those runtime contracts.
