# Canonical API source-lock capability audit

> Chinese: [API 来源行锁能力审阅](../zh-CN/design-docs/catalog-api-source-lock-audit.md)

## Decision requested, not implemented

Fixed source: A #939 `8dd0ea074e6686ba58d773c99c5a387050fb937c`, tree `1ed21d931af9f4badd8e1c461ce2b70953684379`. This independent documentation successor changes no authorization, migration, provisioning, source SQL or #939. It does not integrate #1008/#1009. [Sanitized measurements](../exec-plans/active/849-inventory/issue-853-api-source-lock-audit.json) include every inspected column and all 71 probes.

The measured API LOGIN can read the three protected objects but cannot acquire their required row locks. Base Binding and public source locks work. No existing executable controlled function implements the missing read/lock contract. Recommend one function-only source-lock capability, with the three closed operations below, for explicit human authorization before implementation. Do not grant table/view UPDATE to API, remove locks, or reuse maintenance/capture approval for this capability.

## Environment and evidence limits

Dedicated PostgreSQL 16.14/pgvector 0.8.6, database `wiseeff_a_api_lock_20261001`, isolated object store, 180 migrations through 0182. Bootstrap/admin prepared the existing canonical DTS fixture. Unchanged `provisionPublicationRuntimeLogins(mode="lab")` then provisioned the measured LOGIN; no additional grants were added. This proves the repository's lab provisioning on this source, not an installed target account.

LOGIN `wiseeff_ra_aapilock20261001_api`: LOGIN, NOSUPERUSER, NOINHERIT, NOCREATEROLE, NOCREATEDB, NOBYPASSRLS. Successful ordinary probes recorded equal session_user/current_user and the same backend PID before/after each transaction. Rejection records label the same connected API client; the catch path did not retain separate actor/PID fields. Writer contrast explicitly used SET LOCAL ROLE; it is not ordinary API identity.

71 observations: **60 successful queries/owner calls, 9 expected 42501 rejections, 2 typed application refusals**. They are not 71 end-to-end product passes. Raw ACL probes select one row without tenant filtering to isolate permissions; scoped owner calls test the real predicates. All inspected objects have RLS=false; tenant authorization is not inferred from SELECT. Fixture AuthContext/persisted fixture users are not OIDC, HTTP, browser or deployed identity evidence. No device I/O ran.

The original 190-relation logical row count/hash comparison and object hashes were equal before/after. Review found the fixture credential table's derived fingerprint in the original snapshot; the delivered JSON and retained local JSON now omit six credential/session/token/webhook table summaries, publishing 184 relation summaries and one object hash. Equality remains an observed original result; omitted hashes/rows are not evidence supplied here. Future collectors must exclude these tables before reading them. Every probe rolled back. The common postgres lease covered migration/provisioning, LOGIN use, close and role teardown: zero API backends, zero lab roles, independent lease reacquisition succeeded. The owned container and generated private connection file were then removed. No credentials or full rows are published. Empty fixtures below prove permission to issue a lock query, not a row lock.

## Actual ACL/lock matrix

Public names below use schema public; remaining names use parameter_catalog. S = SELECT, U = table UPDATE; all inspected columns have the same respective S/U booleans as their table/view. Exact column names/booleans are in the evidence JSON. U permits the statement; immutable triggers may still reject writes.

| Object | S/U | UPDATE NOWAIT | SHARE NOWAIT | Seed rows | Real consumer/scope |
| --- | --- | --- | --- | ---: | --- |
| public.debug_nodes | yes/yes | success | success | 0 | DBG association, organization + node |
| public.dts_config_set | yes/yes | success | success | 1 | source prefix/member, exact set |
| public.project_parameter_files | yes/yes | success | success | 1 | exact source member file |
| public.project_parameter_file_versions | yes/yes | success | success | 1 | exact member version |
| public.dts_config_revisions | yes/yes | success | success | 1 | complete exact revisions |
| public.dts_config_revision_members | yes/yes | success | success | 1 | complete ordered membership |
| public.dts_logical_nodes | yes/yes | success | success | 1 | nodes of exact revisions |
| public.dts_logical_node_revisions | yes/yes | success | success | 1 | exact revision graph |
| public.dts_node_occurrences | yes/yes | success | success | 1 | exact revision graph |
| public.dts_property_occurrences | yes/yes | success | success | 1 | exact revision graph |
| public.dts_occurrence_effects | yes/yes | success | success | 1 | exact revision graph |
| public.project_parameter_file_candidates | yes/yes | success | success | 0 | owned candidate, after source fence |
| public.project_parameter_value_drafts | yes/yes | success | success | 0 | frozen selected draft, after source fence |
| public.project_parameter_value_change_requests | yes/yes | success | success | 0 | scoped request + reviewer |
| public.project_parameter_value_change_targets | yes/yes | success | success | 0 | request's ordered targets |
| project_parameter_source_occurrences | yes/no | **42501** | **42501** | 1 | full org/project/config-set occurrence set |
| project_parameter_bindings (base) | yes/yes | success | success | 1 | full cohort/base identity |
| current_project_parameter_bindings (view) | yes/no | **42501** | **42501** | 1 | current eligible Binding, not historical replacement |
| project_value_source_pins | yes/no | **42501** | **42501** | 1 | exact org/project/Binding/Value/source pin |
| project_parameter_values | yes/yes | success | success | 1 | exact Value/Binding identity |
| binding_history_events | yes/yes | success | success | 1 | retained exact history |

The actual DBG pin query is FOR SHARE without NOWAIT; the isolated SHARE NOWAIT probe fails before lock waiting. DBG's actual current recheck independently fails on the view. Source complete-cohort owner call independently fails on occurrence locking. Source-prefix fence succeeds on actual rows; independent cohort JOIN FOR UPDATE OF binding also succeeds. Explicit writer-role occurrence locking still fails 42501.

## Call chain and reuse

- API provisioning: `server/modules/catalog-publication/runtime/provisionRuntimeLogins.ts`, grant/convergence block 389–414. API receives Catalog SELECT, explicit governance/workbench DML and SET-capable, non-inherited coordinator/governance-writer/baseline-reader membership. Occurrence/pin/view UPDATE is absent; migration/synchronizer/maintenance/capture owner membership is absent.
- DBG: `debugging/service.ts` rechecks at 1474/1560/2131/2298 → `canonicalProtectedReference.ts` 322–365 → public source prefix → current-view FOR UPDATE → pin FOR SHARE → exact owned pin/Value/revision recheck before I/O. Historical `assertDebugHistoryPin` is a separate exact retained read and succeeded; it must not be relabelled current.
- Draft/submit/review/member: `parameter-files/canonicalSource.ts` → Values owner `values/service.ts` → `values/repositories.ts` 129–163: sorted complete scoped occurrence set, lock/re-read equality, sorted base Bindings lock/re-read, current projection + exact Value/pin. Member inspection calls this before reviewed tombstone SET ROLE. Values write/member apply also use `loadBindingById(...,"update")`, currently locking the current view.
- Reuse `sourceVersion.ts:lockExactSourceRevisionsForProof` unchanged: set → file → version → revision → membership → logical nodes/revisions → node/property occurrences → effects; sorted IDs, complete-set rechecks, 128-member/100000-row guards and existing busy semantics remain. Then canonical occurrence/Binding fences, then existing workflow locks in their caller order. Do not add missing Catalog locks ahead of the public prefix.
- Reuse server authorization, persisted reviewer/project checks, trusted invocation, source/cohort proofs, pending guards, constraints, audit and atomic caller transactions. `server/shared/database/client.ts` acquires one client for BEGIN/callback/COMMIT or ROLLBACK; the new seam must use that caller Queryable, not root pool/new connection. Nested savepoints remain existing policy.

The inspected 103 functions contain no API-executable lock/read function for these objects. Writer-executable `assert_catalog_subject_active`, `ensure_dts_observation_source_occurrence`, `insert_reviewed_member_tombstone` are different subject/producer/reviewed-write contracts. Trigger functions are not ordinary callable APIs. Publication guard is not a source-row fence. 0182 historical enumeration and D02 capture are maintenance-specific, not API capabilities. Function metadata hashes/ACLs are retained in the JSON; text matching alone was not used as authorization proof.

## Minimum proposed contract — requires approval

One proposed function `parameter_catalog.lock_canonical_source_read(organization_id text, project_id text, request jsonb)`; name/signature are a review proposal, not deployed SQL. A closed discriminated request supports only existing missing locks; no arbitrary relation, SQL, predicate, mode or organization list.

| Operation | Required identities | Fixed action/output |
| --- | --- | --- |
| source-cohort | configSetId, expected complete occurrenceIds/bindingIds | verify scope; snapshot exact sorted sets; occurrence UPDATE NOWAIT then base Binding UPDATE NOWAIT; re-read exact sets; return scoped identities for existing Values projection |
| current-binding | bindingId, expected definition/effective-revision/Value | scoped base Binding lock, then authoritative current-view read and exact equality; expose only existing update/share modes required by Values owner, preserving each caller's wait policy; replaced/missing stays distinct |
| source-pin | bindingId, ValueId, pinId, expected configRevisionId | validate exact joined scope/identity; pin SHARE with existing wait policy; return exact locked pin identity |

The current-binding branch locks the authoritative base row and immediately rechecks current eligibility. This is a proposed equivalence to view locking, **not demonstrated by the present permission probes**; Catalog/Values owner must prove replacement/publication concurrency before adopting it. It avoids granting API view UPDATE. Do not lock an extra full cohort for DBG merely to share code.

- Dedicated owner `catalog_source_lock_owner`: NOLOGIN/NOINHERIT/NOSUPERUSER/NOBYPASSRLS, no role membership granted to API or other callers. Give this owner only schema USAGE, SELECT on these four objects and UPDATE(id) on occurrence/base Binding/pin for PostgreSQL row-lock permission. This is new privileged scope requiring review; owner direct-write resistance must be proved, not assumed from NOLOGIN.
- SECURITY DEFINER, VOLATILE; fixed `search_path=pg_catalog,pg_temp`; every object fully qualified; no dynamic SQL or DML; unknown keys/kinds, null/duplicate/mismatched identities, over-limit sets, missing/replaced rows and changed complete sets fail closed. Cap checks must reject oversized cohorts before blocking work and never truncate them.
- PUBLIC EXECUTE revoked. Exact-function EXECUTE only to approved API runtime LOGIN through its existing provisioner after human approval; no table/view UPDATE, owner membership, maintenance reader/capture expansion or default EXECUTE grant. Baseline, worker, manager and D02 roles must remain denied unless separately authorized.
- Server derives org/project and expected identities from authenticated persisted context/proofs; verifies exact user/project action and assigned human reviewer in the same caller transaction before calling. The DB function verifies relational scope, not the authenticity of a user ID supplied by a shared API LOGIN. Current API has broad SELECT and RLS=false: accepting this server-trust boundary is an explicit contract decision, not independent DB user authorization.
- Caller must already hold the public source-prefix fence and use the same tx/client. Results are only for that transaction; no reusable lock token/cache. PostgreSQL functions alone cannot prove the caller will keep an outer transaction open. Owner wrappers/caller tests must reject pool/autocommit misuse. Failed identity, drift, busy, permission or later apply rolls back the existing transaction; never continue I/O or partial write. No approval, audit or constraints are bypassed.
- Revoke exact API EXECUTE to disable the seam; new calls must fail 42501, with existing row privileges unchanged. Already executing calls/held transactions need a separately reviewed drain policy; REVOKE is not cancellation. Provisioner replay must not silently restore a disabled capability.

## Required next proof / owner

Catalog authorization/Values owner implements only after the above API capability is approved; A owns shared ACL/phase acceptance. Coordinator fixes one forward migration number after checking all delivered heads. No number is reserved here.

Required adversarial acceptance: real approved LOGIN + same caller PID/transaction; real seeded rows and two-client lock contention; full cohort inserts/deletes/retargeting; current replacement/publication/Value/pin drift; PUBLIC/worker/D02 EXECUTE denial; mismatched relational org/project identities rejected by the function; unauthorized project/other-org users rejected by the real application AuthContext checks (the shared LOGIN has no per-human RLS); direct occurrence/pin/view DML still denied (existing base Binding DML remains its separate contract); unknown/oversized inputs; successful retained reads; human-review atomicity and late-failure rollback; EXECUTE revoke/provisioner disabled behavior; zero LOGIN backends and role cleanup. Preserve 404/403 distinctions and stale/pending/replay contracts.

The supplied D HTTP failures (500/42501 at occurrence lock, unchanged failure snapshots) and Catalog current/pin 42501 corroborate the seam but are owner-supplied evidence, not A's fresh HTTP acceptance. JSON lifecycle/pending and DTS locator scenarios were not reached. No deployed role, browser, device, full backend, build or new Hosted run is claimed here. Fixed-tree native result 3562/3389/173 exit1 is inherited evidence, not rerun; this docs-only audit grants no Catalog clearance. The interrupted old #1006 review is excluded. Fresh contract review and actual configuration limitations are recorded in this independent PR.
