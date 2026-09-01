# Wayfinder implementation specification: canonical parameter catalog replacement (#668)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md)

Status: **Phase A Publisher complete; Phase B and Phase C not run**. The accepted module seams, implementation/ticket granularity, and dependency edges remain frozen. G0 merged through PR #682, and the 53 launch Issues were published without enabling an implementation frontier.

Accepted publication baseline: `origin/main@0e3b3536da700ccb4ef3ba116d771a6f37236dec`. This is a target contract. It does not claim current implementation or release evidence, reserve a migration number, or authorize production activation.

## Phase A Publisher snapshot

Phase A completed on 2026-09-01 from publisher branch `codex/wayfinder-668-to-tickets-20260901`. G0 had already merged through PR #682 at the accepted baseline above. The launch map contains 53 Issues, #683-#735. The exact child sets are 11 historical, 53 launch, and 64 global. The exact native dependency sets are 18 historical, 136 launch-to-launch, zero historical/launch cross-boundary, and 154 global; both GitHub `blocking` and `blocked_by` views normalize to that same set, with no dependency cycle. All 27 ID and 18 RE records remain body-only and create no additional native relationship.

`ACTUAL_LAUNCH_READY_SET` is empty. S0-ID is the future frontier, but it must remain disabled until Phase B reviews this real Issue map, opens and merges the docs-only PR, synchronizes the exact `origin/main` merge SHA, and Phase C repeats the full set-level audit. Phase A did not create a PR and did not execute Phase B or Phase C.

| Node | Issue | Database ID | GraphQL node ID |
| --- | --- | --- | --- |
| `S0-ID` | #683 | `5311617399` | `I_kwDOSVLD3c8AAAABPJjZdw` |
| `S0-RAT` | #684 | `5311620341` | `I_kwDOSVLD3c8AAAABPJjk9Q` |
| `S0-FIX` | #685 | `5311629076` | `I_kwDOSVLD3c8AAAABPJkHFA` |
| `S1-BND` | #686 | `5311629415` | `I_kwDOSVLD3c8AAAABPJkIZw` |
| `S1-CMP` | #687 | `5311629764` | `I_kwDOSVLD3c8AAAABPJkJxA` |
| `S2-SCH` | #688 | `5311630186` | `I_kwDOSVLD3c8AAAABPJkLag` |
| `S2-RBAC` | #689 | `5311630643` | `I_kwDOSVLD3c8AAAABPJkNMw` |
| `S2-PGH` | #690 | `5311630952` | `I_kwDOSVLD3c8AAAABPJkOaA` |
| `S3-RUN` | #691 | `5311631317` | `I_kwDOSVLD3c8AAAABPJkP1Q` |
| `S3-INS` | #692 | `5311631684` | `I_kwDOSVLD3c8AAAABPJkRRA` |
| `S3-VFY` | #693 | `5311632218` | `I_kwDOSVLD3c8AAAABPJkTWg` |
| `S4-REG` | #694 | `5311632561` | `I_kwDOSVLD3c8AAAABPJkUsQ` |
| `S4-EVD` | #695 | `5311632931` | `I_kwDOSVLD3c8AAAABPJkWIw` |
| `S4-REV` | #696 | `5311633318` | `I_kwDOSVLD3c8AAAABPJkXpg` |
| `S5-RSL` | #697 | `5311633687` | `I_kwDOSVLD3c8AAAABPJkZFw` |
| `S5-PRP` | #698 | `5311634056` | `I_kwDOSVLD3c8AAAABPJkaiA` |
| `S6-BND` | #699 | `5311634422` | `I_kwDOSVLD3c8AAAABPJkb9g` |
| `S6-VAL` | #700 | `5311634925` | `I_kwDOSVLD3c8AAAABPJkd7Q` |
| `S6-WFA` | #701 | `5311635272` | `I_kwDOSVLD3c8AAAABPJkfSA` |
| `S7-CLS` | #702 | `5311635603` | `I_kwDOSVLD3c8AAAABPJkgkw` |
| `S7-MAP` | #703 | `5311635944` | `I_kwDOSVLD3c8AAAABPJkh6A` |
| `S7-ARC` | #704 | `5311636452` | `I_kwDOSVLD3c8AAAABPJkj5A` |
| `S7-ORC` | #705 | `5311636772` | `I_kwDOSVLD3c8AAAABPJklJA` |
| `S8-CON` | #706 | `5311637153` | `I_kwDOSVLD3c8AAAABPJkmoQ` |
| `S8-READ` | #707 | `5311637559` | `I_kwDOSVLD3c8AAAABPJkoNw` |
| `S8-GOV` | #708 | `5311638057` | `I_kwDOSVLD3c8AAAABPJkqKQ` |
| `S8-LEG` | #709 | `5311638395` | `I_kwDOSVLD3c8AAAABPJkrew` |
| `S9-PRT` | #710 | `5311638746` | `I_kwDOSVLD3c8AAAABPJks2g` |
| `S9-CAT` | #711 | `5311639049` | `I_kwDOSVLD3c8AAAABPJkuCQ` |
| `S9-GOV` | #712 | `5311639584` | `I_kwDOSVLD3c8AAAABPJkwIA` |
| `S9-BRW` | #713 | `5311639914` | `I_kwDOSVLD3c8AAAABPJkxag` |
| `S10-PER` | #714 | `5311640256` | `I_kwDOSVLD3c8AAAABPJkywA` |
| `S10-VMP` | #715 | `5311640597` | `I_kwDOSVLD3c8AAAABPJk0FQ` |
| `S10-DCP` | #716 | `5311641082` | `I_kwDOSVLD3c8AAAABPJk1-g` |
| `S10-API` | #717 | `5311641367` | `I_kwDOSVLD3c8AAAABPJk3Fw` |
| `S10-UI` | #718 | `5311641721` | `I_kwDOSVLD3c8AAAABPJk4eQ` |
| `S10-RPT` | #719 | `5311642129` | `I_kwDOSVLD3c8AAAABPJk6EQ` |
| `S11-UPG` | #720 | `5311642664` | `I_kwDOSVLD3c8AAAABPJk8KA` |
| `S11-RP` | #721 | `5311643014` | `I_kwDOSVLD3c8AAAABPJk9hg` |
| `S11-APL` | #722 | `5311643358` | `I_kwDOSVLD3c8AAAABPJk-3g` |
| `S11-REC` | #723 | `5311643750` | `I_kwDOSVLD3c8AAAABPJlAZg` |
| `S12-CGH` | #724 | `5311644127` | `I_kwDOSVLD3c8AAAABPJlB3w` |
| `S12-TOP` | #725 | `5311644630` | `I_kwDOSVLD3c8AAAABPJlD1g` |
| `S12-PRJ` | #726 | `5311645008` | `I_kwDOSVLD3c8AAAABPJlFUA` |
| `S12-FIL` | #727 | `5311645321` | `I_kwDOSVLD3c8AAAABPJlGiQ` |
| `S12-AGT` | #728 | `5311645856` | `I_kwDOSVLD3c8AAAABPJlIoA` |
| `S12-LOG` | #729 | `5311646318` | `I_kwDOSVLD3c8AAAABPJlKbg` |
| `S12-DBG` | #730 | `5311646689` | `I_kwDOSVLD3c8AAAABPJlL4Q` |
| `S12-DTS` | #731 | `5311647176` | `I_kwDOSVLD3c8AAAABPJlNyA` |
| `S12-KNW` | #732 | `5311647549` | `I_kwDOSVLD3c8AAAABPJlPPQ` |
| `S12-MOD` | #733 | `5311648036` | `I_kwDOSVLD3c8AAAABPJlRJA` |
| `S12-OPS` | #734 | `5311648532` | `I_kwDOSVLD3c8AAAABPJlTFA` |
| `RI-01` | #735 | `5311648867` | `I_kwDOSVLD3c8AAAABPJlUYw` |

`S13-PROGRAM` is deferred because its real two-release, 90-day, per-class 30-day zero-use, telemetry, purpose-report, and accountable approval window does not yet exist. `S14-PROGRAM` is deferred because it requires completed S13 evidence plus a separately approved cleanup release with real retention, recovery-point, restore, and zero-dependency proof. Neither deferred program has a launch Issue or a ready label.

## Problem Statement

The current parameter catalog distributes one property contract across `parameter_specs`, versions, attribution subjects, DriverSchema, Organization overlays, modules, review work, Bindings, and history. An Organization draft, subjectless DTS surface, schema root, proposal, or historical row can appear to be a second current definition. Lazy ingest, overlay precedence, current flags, module attribution, and implicit head selection create several structural authorities.

The replacement must finish in one bounded maintenance window. A repository-reviewed immutable Platform Catalog Release is the only structural source; PostgreSQL is its verified projection. Organizations register and place formal Subjects. Observation, ReviewEvidence, Proposal, Binding, and ProjectValue retain separate evidence and business responsibilities and never materialize Catalog truth. The cutover preserves provable stable IDs, complete history, and audit, fails closed on unknown or ambiguous evidence, and separates real PostgreSQL, real candidate API, browser-real, target-host, release, and approval evidence.

### Immutable decision inputs

This specification consumes, without reinterpretation, issue #669 at `f982c76a063f3c8bc0a7366d5253243ecba2866f`, #670 at `000f617ba9810adda4798b4bc4b2bdfed95b4c39`, #671 at `6c3adfc35c0e3be6d5d381013dace9408190380e`, #672 at `542c7a8bbce3bd6bb230b0d020d23d10af5182a9`, #674 at `bef06b341499e99fadddda7cf3db463c01511d55`, #675 at `9fe269d4facc31b49fc1e0535d2d51ba7140644b`, #676 DEV-only evidence at `9c803557a55803ccca79c20eadd033f57d4729e0`, #673 at `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb`, #677 at `c6c08e6e6f208f88160bdbcc610eec9f8e516cc3`, #678 at `1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d`, and #679 at `465c07ed60ca7fa6b7b2ff2f2559e8ccf504af9f`.

No unresolved product conflict was found among those inputs. Issue #679 explicitly repairs the earlier #678 evidence cycle: after P13, a new attempt reruns the complete V01-V17 and D01-D09 set; real API/browser evidence is produced only after the approved post-retirement runtime pin. Differences from current ADRs and schema are migration inputs: Organization overlays/shadow subjects/definition overrides, in-place documentation edits, and eager whole-catalog Organization placement are superseded target contracts, not blockers.

## Solution

There are exactly four externally visible deep modules: **Catalog Kernel**, **Parameter Governance**, **Catalog Cutover**, and **Release Verification**. Catalog Kernel exclusively owns release compilation, materialization, exact snapshots, and materialization verification. Parameter Governance is the only external governance module and internally owns Subject Registration/Placement, Observation/ReviewEvidence/ReviewItem, DefinitionProposal, and the review-resolution transaction coordinator. Catalog Cutover exclusively owns the P0-P16 phase semantics, R0-R10, typed mapping, Archive, checkpoints, and recovery. Release Verification exclusively owns purpose, plan, attempt, report, approval, evidence lineage, and runtime pins. Binding/ProjectValue is a consuming business module, not a fifth governance module. HTTP, frontend, consumers, and `upgrade.sh` are adapters and cannot pass transaction handles, coordinate multiple writers, select Definition heads, infer legacy dispositions, or waive gates.

## User Stories

1. Users read published formal definitions on one Parameter definitions page even before their Organization registers the Subject.
2. Organization Admins explicitly register a current active Driver or NodeType and choose either the reserved default or a valid parent Placement.
3. Organization Admins move, rename, retire, and restore the same retained Placement and Registration IDs without changing Definition, Binding, or history identity.
4. Organization Admins resolve same-page Review Queue evidence without creating an Organization definition.
5. Organization Admins submit DefinitionProposals; a different Platform Admin accepts or rejects them, and acceptance creates publication intent only.
6. Platform publishers ship a complete deterministic Catalog Release instead of editing structural truth through UI or database state.
7. Runtime callers observe one complete captured release, never mixed membership, aliases, or Definition heads.
8. Project workflows use canonical `definitionId`, `effectiveRevisionId`, and `currentValueId`; modules and `parameterSpecId` are not business identity.
9. Historical readers replay exact Catalog Releases and DefinitionRevisions without current aliases, lifecycle, or heads reinterpreting history.
10. Ingest automatically registers only a uniquely proven active Subject; unknown properties and ambiguous evidence create evidence/review only.
11. Agents read within the invoking principal's scope and expose no Catalog governance mutation.
12. Legacy callers receive typed mapping, redirect, gone, conflict, or scope-hidden not-found outcomes during the bounded window.
13. Operators use the same phase controller and verifier for fresh and populated databases.
14. Platform owners approve an exact report digest and purpose and cannot waive failed technical gates.
15. Incident owners use the immutable journal and Recovery Point to choose only a legal resume, forward recovery, or whole-state restore.

## Implementation Decisions

<a id="pcat-spec-modules"></a>

### Module boundaries and dependency direction

| Deep module | Exclusive ownership | External interface | Must not own |
| --- | --- | --- | --- |
| Catalog Kernel | compile, validate, install, pre-traffic switch-back, current/pinned snapshots, matcher, revision history, materialization verification/cache | role-shaped `CatalogMaintainer`, `CatalogRuntime`, and `CatalogVerifier`; six semantic operations | routes, Registration, Proposal, Observation, Binding, approval |
| Parameter Governance | Registration/Placement, Observation/ReviewEvidence/ReviewItem, DefinitionProposal, review-resolution coordinator, success/refusal audit | `GovernanceReader` plus typed governance commands; review resolution only through `resolveReviewItem` | Catalog materialization, Definition/Revision writes, Binding/value writes, caller-owned transactions |
| Catalog Cutover | `planCutover`, `executeCutover`, `inspectCutover`, `recoverCutover`; P0-P16 semantics, R0-R10, mapping/Archive, locks/checkpoints, recovery classification | four maintenance operations | Kernel transactions, Verification approval, HTTP/UI orchestration, traffic authorization |
| Release Verification | gate registry, plan/attempt/report, lineage, purpose approval, runtime pin, retention | five semantic operations plus private readiness projection | repair, migration, sync, Archive decryption, traffic mutation |

| Supporting module/adapter | Owns | Consumes/exposes | Prohibited |
| --- | --- | --- | --- |
| Catalog source/publication | immutable bundle, manifest/YAML, explicit stable IDs, CI compiler output | artifact -> Kernel compiler | current DB pointer, Organization state, runtime repair |
| Binding and ProjectValue | canonical Binding, effective-revision CAS, immutable values, explicit current pointer/history | captured Kernel snapshot + active Registration contract | Definition-head selection, module identity, governance writes |
| Legacy Mapping and Archive | typed identity, append-only versions/heads, Archive metadata/object refs | private Cutover adapters; exact compat/operator lookup | reclassification, ordinary Catalog reads, public Archive enumeration |
| Database current-release guard | migration-owned transaction-local active-membership assertion and shared/exclusive current-pointer lock protocol | exact release ID/digest, Subject ID, expected `active` -> success or typed failure; execute-only private Governance adapter | Catalog rows/results, public Kernel operation, table SELECT/DML grant, lifecycle interpretation by Governance |
| API/application composers | auth, scope, DTOs, timeline composition, wire ETag/idempotency mapping | only public module interfaces | raw repository, transaction handle, multi-writer orchestration |
| Parameter definitions frontend | URL state, one-page UI, ports, reconfirmation | ports -> HTTP adapters | durable business rules, raw diagnostics, mock-only authority |
| Self-hosted upgrade adapter | host/data-plane/journal/queue/proxy/process adapters | Cutover + Verification; release integration is the convergence owner | gate selection, API-startup migration/sync, waiver |
| Shared audit/observability/evidence | durable refusal sink, metrics/log/evidence stores, retention primitives | private infrastructure adapters | Catalog or release decisions |

Allowed edges are `artifact -> Kernel`; `HTTP -> Kernel runtime + Parameter Governance + Binding/ProjectValue`; `frontend -> ports -> HTTP`; `Parameter Governance -> nominal Catalog IDs + a captured Kernel snapshot` before a command, and inside its write UoW only `Parameter Governance -> execute-only database current-release guard`; `Binding/ProjectValue -> Kernel snapshot + Governance Registration read contract`; `Cutover -> Kernel maintainer/verifier + private Governance/Binding migration ports + mapping/archive + recovery`; `Release Verification -> read-only evidence adapters`; and `upgrade controller -> Cutover + Release Verification`. Parameter Governance never reaches the Catalog store, `catalog_state`, membership relations, or a Kernel internal store adapter directly.

Parameter Governance may coordinate several of its own internal aggregates inside its own UnitOfWork. The forbidden case is a caller, HTTP handler, Kernel, verifier, or another module opening or extending that transaction or invoking several writers and claiming atomicity. Every Governance repository, write port, coordinator, database-guard adapter, and audit writer is private; S2-SCH, not Governance, owns the guard function and pointer-lock protocol. Static ratchets reject reverse dependencies, caller-owned cross-module transactions, Governance Catalog-table imports/queries, raw Catalog-table routes, verifier-to-writer calls, Kernel-to-Governance calls, module-based Binding identity, and latest-head inference.

### Catalog Kernel contract

The fixed operations are `compilePublishedRelease`, `installPublishedRelease(bootstrap|advance)`, `switchBackBeforeTraffic`, `verifyCurrentMaterialization`, `loadCurrentCatalog`, and `loadPinnedCatalog`. `CatalogRuntime` exposes only load operations; `CatalogMaintainer` compile/install/switch-back; `CatalogVerifier` compile/verify/pinned load.

Snapshots are immutable and expose typed Subject get/list/resolve, Definition stable-key/opaque-ID get/list, exact Revision get/list, and Catalog publication timeline. Results distinguish found, unknown, ambiguous, retired, not-published, and revision-unavailable. Kernel owns one-hop aliases, Driver-first/NodeType-fallback matching, lifecycle/head selection, stable order/cursors, pre-page authorized selection intersection, and release fingerprints. It installs under one advisory lock and transaction, rechecks lineage/idempotency, stages the whole projection, forces deferred constraints, records exact release heads, atomically advances Definition heads and the current pointer, and commits success audit/materialization evidence. Same verified digest is a read-only no-op; conflicting bytes are drift/digest conflict. Cache keys include exact release identity/fingerprint and rebuild only from verified DB projection.

<a id="pcat-spec-governance-uow"></a>

### Parameter Governance contract and atomic transaction owner

Parameter Governance is the sole external governance seam. Registration, Placement, Observation, ReviewEvidence, ReviewItem, ReviewResolution, DefinitionProposal, and PublicationIntent are internal aggregates/packages, not separately callable HTTP writers. Every Review Queue resolution variant uses one typed command:

```text
resolveReviewItem(command: ResolveReviewItemCommand)
  -> Result<ReviewResolutionResult, GovernanceFailure>
```

The command carries a server-owned `TrustedInvocationContext`, Organization and ReviewItem nominal IDs, captured Catalog Release ID/digest, ReviewItem ETag, `Idempotency-Key`, canonical request fingerprint, reason, and the closed union `register-subject`, `restore-registration`, `mark-out-of-scope`, or `open-definition-proposal`. `register-subject` additionally requires Subject ID and an explicit `PlacementIntent` of `use-default` or `choose-parent`; `restore-registration` rejects Placement fields; every other variant rejects Registration payload. The result returns the exact ReviewItem/Resolution, any Registration/Placement or Proposal, Catalog pin, and new ETag. Failure is a closed `GovernanceFailure`, never `null` or a partial success.

For `register-subject`, Parameter Governance opens one pool-backed database UnitOfWork and performs all of the following in that transaction:

1. revalidate trusted Organization/principal/initiator and Org Admin authority; Agent, Platform Admin, and body/header role assertions cannot replace the Org Admin placement choice;
2. reserve `(organization, command-family, Idempotency-Key)` and compare the complete request fingerprint; exact committed replay returns the stored result without re-executing a mutation or re-auditing, while same key/different fingerprint is `revision-conflict`;
3. for a new mutation, invoke the migration-owned transaction-local current-release guard with exact release ID/digest, Subject ID, and expected `active`; no caller passes a transaction handle to Kernel or Governance, and Governance does not read or lock Catalog tables;
4. lock the ReviewItem, CAS its `If-Match` ETag, and prove that its status, reason, candidates, and captured evidence are still valid;
5. create or exactly reuse the `(organization,subject)` Registration only when lifecycle/method/proof are compatible;
6. create exactly one retained Placement or prove that the existing Placement exactly represents the requested PlacementIntent; a conflict returns `placement-conflict` and never moves the retained Placement to accommodate the request;
7. append immutable ReviewResolution, advance ReviewItem status/ETag, and append success audit plus the idempotency result reference;
8. force all deferred constraints immediately, then commit once. Any failure leaves no Registration, Placement, Resolution, ReviewItem change, success audit, or success idempotency result visible.

#### Transaction-local Catalog current-release guard

The only in-transaction Catalog assertion available to Parameter Governance is the private adapter interface `assertCatalogSubjectActive({ expectedReleaseId, expectedReleaseDigest, subjectId, expectedMembership: "active" }) -> Result<void, CatalogCurrentGuardFailure>`. S2-SCH owns the migration-owner `SECURITY DEFINER` database function, its fixed safe search path, exact scalar input validation, stable SQLSTATE/detail codes, and the repository-wide current-pointer lock protocol. The function returns no Catalog row, lifecycle, current identity, candidate, or membership object. Its closed failures are `PCAT-GUARD-RELEASE-MISMATCH`, `PCAT-GUARD-SUBJECT-NOT-PUBLISHED`, `PCAT-GUARD-SUBJECT-RETIRED`, `PCAT-GUARD-DRIFT`, and retryable `PCAT-GUARD-SYNCHRONIZATION-BUSY`; the private adapter maps them respectively to `release-drift`, `subject-not-published`, `subject-retired`, `catalog-not-ready`, and `catalog-not-ready` without parsing free-text database messages.

For a new Governance mutation, the function takes the transaction-scoped **shared** form of the same repository-wide advisory lock used for the current Catalog pointer, then atomically asserts the exact ID/digest pair is current and the exact Subject membership is active. S3-INS takes the **exclusive** form before its private Kernel store adapter locks/rechecks/advances `catalog_state` and Definition heads. Both modes are held until commit or rollback. Thus a pointer advance and a Registration/review-registration mutation have one database serialization point while neither module receives the other's transaction or store adapter. This narrow guard preserves #673: Catalog compilation, store queries, membership interpretation, pointer mutation, and Kernel internal adapters remain inside Catalog Kernel; S2-SCH owns only DDL/grants/guard semantics, and Governance receives only success or typed failure.

`parameter_governance_writer_role` receives `EXECUTE` only on this guard, with `PUBLIC` revoked. It has no `SELECT`, `INSERT`, `UPDATE`, `DELETE`, sequence, ownership, role-assumption, or function-creation capability on `catalog_state`, Catalog membership, or any other Catalog relation. Direct Catalog access is both a real-SQL permission failure and a static import/query ratchet failure.

Explicit registration, uniquely proved automatic registration, and review registration share the same internal registration writer and lock order: `idempotency row -> transaction-local Catalog guard(shared) -> optional ReviewItem -> (organization,subject) registration key/row -> requested parent/destination key/row -> retained Placement -> deferred constraints`. An exact committed idempotency replay short-circuits before the guard and returns the stored release pin, IDs, and audit reference; it is response recovery, not a new mutation. Explicit/review registration requires an Org Admin and explicit PlacementIntent. Automatic registration requires a Trusted System plus captured matcher/release proof, uses the reserved default root, and cannot restore a retired Registration or select a curated parent. Agent never writes. Release/ETag/proof/permission/kind/owner/cycle conflicts fail closed. Concurrent explicit, automatic, and review registration converge to one exact Registration/Placement or one success plus a typed conflict; they never create a second Placement.

Placement change, Registration lifecycle, Observation ingest, and Proposal transition also use typed Parameter Governance commands with private UoWs. Observation and ReviewEvidence are immutable. Proposal acceptance appends only `catalog_publication_intents` and trusted audit; it never writes Catalog Subject, Definition, Revision, head, or pointer. Success audit commits with the domain write. Authorization, stale, malformed, and evidence-conflict refusals use an independent pool-owned durable sink so the refusal survives rollback without borrowing the caller transaction.

Tests observe only public commands/queries and use independent real-PostgreSQL sessions for ETag races, explicit/automatic/review races, lost response, key-fingerprint conflict, deferred-constraint failure, refusal durability, and every guard serialization case. The required guard Red -> Green matrix is: pointer advance versus registration blocks and yields one legal serialization; an advance that wins with retirement makes the new mutation return `release-drift` or `subject-retired` with zero Governance rows, while a registration that wins remains durably attributed to its captured release and later mutations see retired current membership; stale ID or digest fails before domain writes; a rolled-back pointer transaction lets the waiting guard observe the unchanged release, while a rolled-back Governance transaction releases its shared lock and leaves no partial rows; and a committed-but-lost response replays the stored result/audit reference even if the pointer later advances. Direct `catalog_state`/membership SELECT or DML as `parameter_governance_writer_role` must fail with the expected SQLSTATE. A test-only repository, public transaction callback, direct ReviewResolution insert, or separate Registration/Placement writer calls are ratchet failures.

### Release Verification contract

The fixed operations are `prepareVerification`, `runVerification`, `assembleReport`, `approveReport`, and `readReport`. A private `readApprovedRuntimePin` returns only the latest passing and approved post-retirement-runtime report for the exact P13 state. Startup cannot prepare, execute, approve, synchronize, migrate, or repair.

Purposes are closed: pre-activation, post-retirement-runtime, isolated-candidate-acceptance, public-release, legacy-read-sunset, and p16-cleanup. Plans pin artifact/images, Catalog, migration ledger, cutover, mapping/Archive, Recovery Point, acceptance, target, verifier, and purpose lineage. Attempts and reports are append-only. Every applicable gate appears once as passed, failed, not-yet-executable, or registry-proved not-applicable. There is no waiver. Operator and Platform-owner approvals are distinct principals and purpose-specific; verifier signatures are not approvals.

<a id="pcat-spec-schema"></a>

### Canonical PostgreSQL model

These physical relation names, keys, and ownership rules are normative. A ticket may rename only with one atomic, proven-equivalent update to migration, OpenAPI, verifier, and both language documents; it may not weaken a key or invariant.

#### Platform Catalog

| Relation | Required columns and keys | Invariant |
| --- | --- | --- |
| `catalog_releases` | `id`; unique `release_version`; unique `release_digest`; restricted `predecessor_release_id`; compiled/toolchain digests | append-only; no update/delete |
| `catalog_subjects` | `id`; `kind=driver` or `node-type`; `canonical_key`; unique `(kind,canonical_key)` and `(id,kind)` | Platform-only; no Organization/lifecycle/current selector |
| `catalog_drivers`, `catalog_node_types` | PK/FK `subject_id` plus subtype fields | every Subject has exactly one matching subtype; deferred xor check |
| `catalog_release_subjects` | PK `(release_id,subject_id)`; lifecycle; selector/provenance snapshot; tombstone | active has null tombstone; retired has non-null tombstone; successor never silently omits identity |
| `catalog_subject_aliases` | `id`, `subject_id`, selector kind/value; unique normalized selector and `(id,subject_id)` | permanent owner; no reuse or alias chain |
| `catalog_release_subject_aliases` | PK `(release_id,alias_id)` plus composite owner FKs, lifecycle/provenance/tombstone | an active alias requires its active Subject in the same release |
| `catalog_state` | singleton PK; non-null `current_catalog_release_id` | sole current release pointer |
| `parameter_definitions` | `id`, `subject_id`, normalized `property_key`, non-null `current_revision_id`; unique `(subject_id,property_key)` and `(id,subject_id)` | no Organization/module/proposal/observation/content columns |
| `definition_revisions` | `id`, `definition_id`, positive `revision_number`, `catalog_release_id`, `content_digest`, complete typed content; unique `(definition_id,revision_number)` and `(definition_id,id)` | every persisted content delta, including docs, creates an immutable row |
| `catalog_release_definition_heads` | PK `(release_id,definition_id)`; composite FK to exact revision | pinned replay/switch-back never infers head by max/time |
| `catalog_materializations` | release, compiled/database fingerprint, attempt, success-audit ref, installed time | append-only successful projection evidence |

`parameter_definitions.current_revision_id` uses deferrable composite FK `(id,current_revision_id) -> definition_revisions(definition_id,id)`. Before current-pointer commit, deferred completeness checks prove explicit predecessor inheritance/retirement, alias ownership, complete release heads, and valid active/tombstone combinations. Historical reads use pinned release membership/head tables and never join current `catalog_state`.

#### Organization governance

| Relation | Required columns and keys | Invariant |
| --- | --- | --- |
| `organization_subject_registrations` | `id`, Organization, Subject, `status=active` or `retired`, method/proof, non-null `current_placement_id`; unique `(organization,subject)`, `(id,organization)`, `(id,organization,subject)` | retire/restore retains ID and Placement |
| `subject_placements` | `id`, registration, Organization, taxonomy `module_id`, origin; unique registration, `(registration,id)`, `(organization,module)` | exactly one retained Placement; deferred same-Organization/kind checks |
| `parameter_observations` | immutable source identity, Organization/project/logical-node/config/source locator, release/matcher pin, evidence fingerprint | never becomes a Definition |
| `parameter_observation_matches` | unique accepted match per observation; pins Registration/Definition/Revision/Binding/release/matcher | only complete provenance plus one active match; unknown/ambiguous has no row |
| `parameter_review_evidence` | immutable evidence bundle, reason, candidate-safe digest, R/source-graph refs where applicable | no publicly exposed raw payload |
| `parameter_review_items` | `id`, `organization_id`, evidence fingerprint, matcher revision, release, reason, `status=open/resolved/out-of-scope`, positive ETag version; unique active grouping `(organization_id,matcher_revision,evidence_fingerprint)` | repeated evidence groups; resolved status requires deferred resolution FK |
| `parameter_review_resolutions` | immutable `id`; unique `review_item_id`; resolution type; before/after ETag; actor/initiator; captured release; request fingerprint; typed Registration/Proposal/out-of-scope target | closed-union target columns and atomic commit with ReviewItem/Registration/Placement/audit |
| `definition_proposals` | `id`, Organization/author, base release/revision, closed status, non-null current proposal revision, positive ETag; unique `(id,organization)` | no accepted Definition/Revision materialization pointer |
| `definition_proposal_revisions` | immutable `id`, proposal, positive number, typed payload/reason/evidence; unique `(proposal_id,revision_number)` and `(proposal_id,id)` | edit appends; current pointer uses deferrable composite FK |
| `catalog_publication_intents` | immutable `id`; unique accepted proposal; exact proposal revision/base release; repository/publication ref; reviewer/audit | intent only; no Catalog head/pointer or Catalog grant |
| `governance_command_idempotency` | PK `(organization_id,command_family,idempotency_key)`; request fingerprint; state; typed result ref; committed time | pending exists only inside its UoW; exact success replay; different fingerprint conflicts |

`UNIQUE(subject_placements.registration_id)` proves at most one Placement. The non-null Registration pointer plus deferrable `(id,current_placement_id) -> subject_placements(registration_id,id)` proves at least one. Driver Placement kind is `driver-group`; NodeType kind is `node-type`; parent rules are the accepted taxonomy rules. Organization creation creates only reserved roots and zero Registrations.

#### Binding, ProjectValue, mapping, and Archive

| Relation | Required columns and keys | Invariant |
| --- | --- | --- |
| `project_parameter_bindings` | stable `id`, Organization/project/logical-node, registration, subject, definition, non-null effective revision, explicit current value, release pin; unique `(project,logical_node,definition)` | no module identity; composite FKs prove every owner/revision agreement |
| `project_parameter_values` | immutable `id`, binding, definition, exact revision, source/config/value digest, typed storage | history never follows Definition head; no update/delete |
| `binding_history_events` | binding, old/new pointer, reason, trusted audit, release/mapping pin | append-only; current is not inferred from time |
| `legacy_identities` | unique `(source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)` | immutable typed source identity |
| `legacy_mapping_versions` | identity, run, checksum, graph fingerprint, R class, exactly one typed target or Archive, optional supersedes | append-only; never reclassify at read time |
| `legacy_mapping_heads` | one CAS pointer per legacy identity | historical consumers pin versions; repair appends and CASes |
| `parameter_catalog_archives` | Archive ID, source/owner/R class/reason, checksums, encrypted object ref, protected refs, run/release/audit/retention | ordinary roles cannot update/delete/decrypt; excluded from Catalog/public UI |
| `catalog_command_idempotency` | non-governance scope/key/request fingerprint/result ref/status | exact replay returns stored result; different fingerprint conflicts |

R6's production target is ReviewEvidence plus Archive/mapping evidence; R8's is DefinitionProposal plus Archive/mapping evidence. Only a separate complete project/logical-node/source-revision occurrence graph may create a ParameterObservation. Same property key never merges R6 and R8.

Cutover persistence uses `parameter_catalog_cutover_runs`, append-only events, phase CAS/checkpoints, classification ledger, comparison corpus/results, and rollback-closure record. The unique run tuple is `(source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest)`. Verification persists immutable plans, attempts, gate results, reports, evidence refs, approvals, runtime pins, and retention calculations. Canonical report bytes are SHA-256 digested; approvals never mutate reports. `pointer_rollback_closed_at` records the earliest candidate business mutation, queue business delivery, or accepted public business request and is irreversible.

Catalog relations are owned by a non-login migration owner. `catalog_synchronizer_role` can insert immutable rows and perform only column-limited current release/Definition-head updates. `parameter_governance_writer_role` has only necessary Governance DML, success-audit append, and `EXECUTE` on the narrow current-release guard; it has no Catalog table `SELECT` or DML and no Binding/Cutover/Verification capability. Only the Parameter Governance composition root holds its pool. Proposal capability is a role-shaped Governance facet and its DB grant touches proposal/intent/audit only. Application, Agent, ordinary API/worker, and verifier cannot assume writer roles. The verifier cannot `SET ROLE`, call write-capable functions, create writer functions, or obtain Archive keys. P01/P02 prove both Catalog immutability and post-P13 legacy-writer unreachability with real SQLSTATE negatives.

### Aggregate state machines and transactions

- Catalog installation is uninstalled -> bootstrap -> advance*. Business rollback is a forward release. Pointer switch-back is only pre-traffic with zero business writes, compatible migrations, and verified previous projection/head map.
- Registration is unregistered -> active -> retired -> active. Explicit registration requires an Org Admin, current release anchor, and explicit PlacementIntent. System auto-registration requires one authoritative active match; Agent cannot write; observation cannot auto-restore.
- Observation is immutable. ReviewItems move open -> resolved/out-of-scope using only register-subject, restore-registration, mark-out-of-scope, or open-definition-proposal. Choosing a Subject creates no Definition, Revision, or Binding.
- Proposal is draft -> submitted -> accepted/rejected, with draft/submitted -> withdrawn. Acceptance requires a different Platform Admin and creates intent/audit only.
- Binding recognition validates one captured release, active Registration, Definition, exact revision, and all owners. Semantic cutover CASes the effective revision; documentation-only heads do not. Value change locks the Binding/value head, validates against effective revision, appends one immutable ProjectValue, CASes current value, and audits atomically.
- Successful domain writes and success audit commit together. Refusal evidence uses a pool-owned durable sink. Trusted invocation is server-owned and never body/header asserted.

| Operation | Concurrency/transaction | Lost response/retry | Conflict behavior |
| --- | --- | --- | --- |
| Catalog install/switch-back | exclusive transaction-scoped current-pointer advisory lock -> private `catalog_state` row lock/recheck -> expected current pin | verify committed release digest/fingerprint, then no-op | stale lineage, split head, or unknown projection fails closed |
| explicit/automatic Registration | idempotency -> shared transaction-local Catalog guard -> `(organization,subject)` key/row -> destination key/row -> deferred constraints, in Governance UoW | exact committed fingerprint returns stored Registration/Placement/release pin/audit ref before guard | proof/permission/release/retirement/Placement conflict leaves no partial Registration |
| Placement move/rename | Registration row, source/destination keys, ETag CAS | exact same mutation replays result | cycle/kind/Organization/stale destination is 409 and audit rolls back |
| Review resolution | idempotency -> shared transaction-local Catalog guard -> ReviewItem ETag -> Registration/Placement locks -> deferred constraints, only through `resolveReviewItem` | exact committed replay returns identical Resolution/Registration/Placement/Proposal/release pin/audit ref before guard | stale/resolved/key reuse is `revision-conflict`; release/retirement/Placement conflict leaves item unresolved |
| Proposal transition | proposal ETag/revision row + exact base release/revision | identical transition returns stored outcome | stale base is `proposal-stale`; self approval 403; no Catalog materialization |
| Observation ingest | immutable occurrence identity + evidence fingerprint unique | identical occurrence deduplicates/aggregates | changed payload for one source identity is evidence conflict, never overwrite |
| automatic Registration | same shared writer/locks as explicit/review; captured matcher/release proof; reserved default only | concurrent paths converge on one exact result | zero/multiple/retired/conflicting evidence creates review/refusal and never auto-restores |
| Binding create/cutover | unique `(project,logical_node,definition)` + Binding row + expected revision | identical recognized association is idempotent | stale pin/owner mismatch/CAS loser leaves no history |
| ProjectValue append | Binding/current-value row + expected current value/effective revision | command idempotency returns exact immutable value | stale CAS leaves no value, pointer, or success audit |
| Cutover phase | host operation lock + PG advisory lock + phase CAS + exact digests | inspect checkpoint; resume only known committed phase | unknown outcome is classified first; otherwise `recovery-required` |
| Verification/report | immutable plan/attempt/report; approval unique by report/purpose/principal role | interrupted attempt is closed and a new attempt starts; valid report may be reused | nondeterminism, lineage/purpose mismatch, or same-role approval blocks |

### Publication, API, frontend, and legacy transition

The bundle contains exact release/predecessor identity, manifest-listed YAML and file digests, explicit stable IDs, complete Subject/alias memberships, selector/tombstone provenance, complete Definition snapshots, schema/toolchain provenance, and aggregate digest. Any missing/unlisted file, digest mismatch, duplicate/reassigned identity, alias conflict, illegal lifecycle/tombstone, non-determinism, or lineage gap fails before writes. Every bundle change creates a release; only changed persisted Definition content creates a Revision, including documentation. One-hop Subject aliases are allowed; property aliases/chains/cycles are not.

Canonical responses include `X-WiseEff-Catalog-Release`; mutable Organization/proposal resources use ETag/If-Match; governance writes use Idempotency-Key. The route set covers the Catalog document, Subject/Definition/revision/timeline reads, Organization Registration lifecycle/Placement, Observation/Review, Proposal, exact typed legacy resolver, canonical project Binding/history/drafts, and operator-only diagnostics. All nine Catalog read routes close through the typed Kernel facet. Stable error reasons and HTTP codes are exactly those fixed by issue #677.

The only UI entry is `/parameter-admin/specs`. It provides Subject/Placement navigation, Definition list/detail, same-page Review Queue, revision/audit timeline, and ready/unregistered/empty/loading/error/retired/conflict states. It preserves opaque URL selection and release anchors. Desktop 1440x900, tablet 768x1024, and mobile 390x844 use one information architecture. Frontend ports separate CatalogRead, SubjectGovernance, ReviewQueue, DefinitionProposal, DefinitionTimeline, and LegacyLink. HTTP and mock adapters have identical state/authority semantics. Issue #676 is DEV-only decision evidence and is never implementation or release proof.

At canonical launch every legacy structural mutation, overlay, and promotion write returns 410. Eligible exact reads remain for at least the later of two production releases and 90 days and until every deployment class has 30 consecutive zero-use days plus all exit gates. The resolver allow-list and mapped/archived/ambiguous/unknown behavior are fixed by #677 and can never reclassify R0-R10.

<a id="pcat-spec-api"></a>

#### Exact canonical route and wire contract

Every canonical response includes `X-WiseEff-Catalog-Release`. Collections are `{items,nextCursor,catalogReleaseId}` and items are `{item}`. Cursors bind release plus stable sort key and opaque ID. Publication-dependent writes echo the release header; mutable Governance/Proposal resources require ETag/`If-Match`; Governance commands require `Idempotency-Key`. HTTP maps one typed module command and never accepts/passes a transaction handle.

| Resource | Method/path | Owning seam |
| --- | --- | --- |
| Catalog | `GET /api/v2/catalog` | Kernel snapshot + read-only readiness |
| Subjects | `GET /api/v2/catalog/subjects` | Kernel `listSubjects` |
| Subject detail | `GET /api/v2/catalog/subjects/{subjectId}` | Kernel + Governance read composition |
| Subject definitions | `GET /api/v2/catalog/subjects/{subjectId}/definitions` | Kernel `listDefinitions` |
| Definitions | `GET /api/v2/catalog/definitions` | Kernel `listDefinitions` |
| Definition detail | `GET /api/v2/catalog/definitions/{definitionId}` | Kernel + scoped usage/Governance reads |
| Definition revisions | `GET /api/v2/catalog/definitions/{definitionId}/revisions` | Kernel exact reverse-order page |
| Pinned revision | `GET /api/v2/catalog/definitions/{definitionId}/revisions/{revisionId}` | Kernel exact revision; no current fallback |
| Timeline | `GET /api/v2/catalog/definitions/{definitionId}/timeline` | Kernel facts + authorized History/Audit composer |
| Registrations | `GET, POST /api/v2/organizations/{organizationId}/subject-registrations` | Parameter Governance query/register command |
| Registration detail/lifecycle | `GET .../{registrationId}`; `POST .../{registrationId}/retire`; `POST .../{registrationId}/restore` | Parameter Governance |
| Placement | `GET, PATCH .../{registrationId}/placement` | Parameter Governance ETag command |
| Observations | `GET /api/v2/organizations/{organizationId}/parameter-observations`; detail | Parameter Governance read only; creation internal |
| Review Queue | `GET /api/v2/organizations/{organizationId}/parameter-review-items`; detail | Parameter Governance reader |
| Review resolution | `POST .../{reviewItemId}/resolve` | exactly one `resolveReviewItem` command |
| Proposals | `GET, POST /api/v2/catalog/definition-proposals`; detail | Parameter Governance Proposal facet |
| Proposal workflow | `POST .../{proposalId}/submit`, `/withdraw`, `/accept`, `/reject` | Parameter Governance Proposal command |
| Legacy ID | `GET /api/v2/catalog/legacy-identifiers/{legacyType}/{legacyId}` | exact mapping-head adapter |
| Project Binding/history/compare/drafts | retained v2 project paths with canonical DTO IDs | Binding/ProjectValue seams |
| Operator diagnostics | `/api/v2/operator/parameter-catalog/*` | deployment Operator only; public router 404 |

The legacy resolver allow-list is exactly `parameter-spec`, `parameter-spec-version`, `project-parameter-binding`, `project-parameter-binding-revision`, `parameter-subject`, `parameter-placement`, and `parameter-module`. It supports no prefix/reverse search, candidates, confidence, source rows, or raw Archive. Exact mapped target returns the canonical link; Archive is 410; ambiguous/blocker is 409; unknown/out-of-scope is 404.

| `details.reason` | HTTP/top-level | Required behavior |
| --- | --- | --- |
| `catalog-not-ready` | 503 / `SERVICE_UNAVAILABLE` | writes disabled; `Retry-After`; never empty fallback |
| `release-drift` | 409 / `CONFLICT` | refresh and explicit reconfirmation |
| `subject-not-published` | 404 / `NOT_FOUND` | no inference/create |
| `subject-retired` | 409 / `CONFLICT` | show lifecycle; never auto-restore |
| `definition-not-found` | 404 / `NOT_FOUND` | scope-safe not found |
| `definition-retired` | 409 / `CONFLICT` | historical read allowed; mutation blocked |
| `registration-required` | 409 / `CONFLICT` | offer explicit Org Admin registration only |
| `placement-conflict` | 409 / `CONFLICT` | refresh retained Placement and resolve explicitly |
| `invalid-placement-parent` | 409 / `CONFLICT` | ReviewItem remains unresolved |
| `observation-ambiguous` | 409 / `CONFLICT` | open linked review work; no Binding |
| `proposal-stale` | 409 / `CONFLICT` | rebase as reviewed Proposal revision |
| `proposal-self-approval-forbidden` | 403 / `FORBIDDEN` | require another Platform Admin |
| `revision-conflict` | 409 / `CONFLICT` | stale/missing ETag, resolved item, or key fingerprint conflict; no silent retry |
| `legacy-id-archived` | 410 / `GONE` | no Archive payload |
| `legacy-surface-retired` | 410 / `GONE` | successor link, no retry |
| `legacy-id-ambiguous` | 409 / `CONFLICT` | no candidate disclosure |
| `forbidden` | 403 / `FORBIDDEN` | no out-of-scope disclosure |
| `migration-diagnostics-not-public` | 404 / `NOT_FOUND` | operator route absent from public router |

At launch, exact eligible Effective reads may be a bounded canonical adapter. Governance/raw modes, Organization definition edit/lifecycle/identity correction, identity-map mutation/reopen, overlay/promotion, and module structural writes return 410 immediately. Legacy responses carry `Deprecation`, `Sunset`, successor `Link`, `Warning`, and `X-WiseEff-Legacy-Contract`. A failed exit gate extends read-only compatibility and never revives a writer or dual read.

### P0-P16 and release chain

<a id="pcat-spec-p0-p16"></a>

| Phase | Exact exit contract |
| --- | --- |
| P0 inventory/plan | Read-only exact target, migration filenames/checksums, source fingerprints, R0-R10/protected counts, read modes, release lineage, store identities, and plan digest. |
| P1 offline validate | Candidate built; bundle/toolchain/lineage, old/new compatibility, and #671 fixture evidence verified; changed artifact means new plan. |
| P2 quiesce | Proxy stopped, queue paused/drained, API/worker/web stopped, host+PG locks and writer fences held, zero active write transaction and leased job. |
| P3 Recovery Point | One same-boundary PostgreSQL + S3-compatible object store + durable Redis manifest with identities, checksums, restore tool, target, and maximum age verified. |
| P4 schema expand | Dedicated one-shot append-only old-binary-compatible migration; API is not runner; M01-M04 pass. |
| P5 Catalog install | Kernel bootstrap/advance atomically switches exact release/heads; exact same verified digest is no-op. |
| P6 classify | Full-graph R0-R10 with classifier/source/graph/protected fingerprints; any R0 or drift stops. |
| P7 typed mapping | Every legacy identity has exactly one primary append-only mapping version/head; conflict never overwrites. |
| P8 register/place | Only strong Organization/Subject evidence; active membership, same Organization, kind, and exactly-one Placement prove. |
| P9 Binding/value/history | Complete operational and historical graph, exact revisions/tips/source/config/audit; never max/time tip inference. |
| P10 Archive | Immutable metadata plus encrypted object ref/checksums for every Archive disposition and required source graph. |
| P11a initial verification | Isolation/fences remain; full V01-V17, M/P, and D01-D09; zero unexplained/unqueryable; all 11 families. |
| P12 read switch | CAS legacy -> canonical bound to exact approved pre-activation report, release, mapping, verifier, and comparison digests; no runtime dual-read fallback. |
| P13 R-L0 writer retirement | Permanently revoke/disable role, grant, trigger, function, HTTP, Agent, job, and script writers; record fingerprint. |
| P11b post-retirement rerun | New attempt reruns all V01-V17 and D01-D09, including V13/P02; approve exact post-retirement runtime pin. |
| P14a verify-only startup | API consumes latest runtime pin; worker/web internal checks follow; queue/proxy/public stay isolated. |
| P14b isolated acceptance | Exact-target real-PG/HTTP/auth/audit API and browser-real acceptance; any business mutation irreversibly closes pointer rollback. |
| P14c public release | New report aggregates three predecessor reports plus current target/recovery/observability; distinct purpose approvals precede queue -> proxy -> public traffic. |
| P15 observe/accept | Predeclared time and at least one complete workload cycle; zero drift, unmapped ID, legacy write, Archive/pin/Placement error. |
| P16 R-L3 cleanup | Separate cleanup release and purpose after sunset, telemetry, dependency, recovery, and retention gates; approved assets only; protected history retained. |

R0 blocks; R1 archives; R2 maps only to an independently published Subject plus Archive; R3 becomes ReviewEvidence; R4/R5 exact-map to Driver/NodeType Definition and Revision; R6 becomes ReviewEvidence plus Archive; R7 Archive plus policy-review reason; R8 DefinitionProposal; R9 same-kind immutable history; R10 unresolved Archive and blocks when a protected consumer needs an operational target.

Pointer-only rollback closes permanently on the earliest candidate business mutation, queue delivery, or accepted public business request. Before that boundary, switch-back still requires exact compatibility and zero-write proof. Afterwards recovery is forward repair or incident-approved whole-state restore of PostgreSQL, configured object storage, and Redis from one manifest; partial restore is unsupported.

The controller actions are exact and fail closed: `plan`; `apply`; `activate-p12` with an approved pre-activation report whose API/browser entries are `not-yet-executable`; `retire-p13` while isolated; `approve-runtime-startup` only after a new complete post-P13 V/D attempt; `start-candidate` verify-only; `run-isolated-acceptance`; `release-public`; `resume` only for known unchanged commits; `recover-candidate` only for recorded completion failures without restore; token-gated `rollback --restore-data`; and purpose-specific `legacy-read-sunset`/`p16-cleanup`. The append-only journal records all plan/attempt/report/approval/predecessor pins, target/host/Compose/volume/bucket identities, migration/schema/Catalog/materialization/source/classifier/recovery/mapping/Archive digests, both V/D attempts, P13 fingerprint, runtime-pin generation, API/browser/recovery evidence, traffic/queue/proxy states, rollback closure, phase events, bounded failure fields, and exactly one executable `next_action`.

### Gate registry, observability, retention, and retirement

<a id="pcat-spec-verification"></a>

| Purpose | Required now | Intentionally unavailable | Sole authorization after passing approval |
| --- | --- | --- | --- |
| `pre-activation` | exact pins, Catalog/materialization, migration, initial V01-V17/D01-D09, Recovery Point, pre-switch fence | API/HTTP/browser/runtime are `not-yet-executable` | P12 read switch |
| `post-retirement-runtime` | new post-P13 full V/D attempt, V13/P02, pointer/fingerprint, zero writer, runtime pin | API/browser acceptance still `not-yet-executable` | API verify-only, then isolated worker/web checks |
| `isolated-candidate-acceptance` | exact-target API/PG/HTTP/auth/audit, three-view browser, internal observability, rollback-closure record | public approval absent | evidence only; no traffic act |
| `public-release` | exact three predecessor reports plus current target/recovery/observability/rollback | sunset/P16 absent | queue, proxy, public traffic |
| `legacy-read-sunset` | public lineage, two releases plus 90 days, per-class 30-day zero use, consumer/reference/recovery proof | P16 deletion | eligible public legacy reads become 410 |
| `p16-cleanup` | full canonical/fresh/populated/API/browser/observability/rollback, own Recovery Point/target restore, zero dependency, retention/legal hold | no waiver | removal of explicitly approved assets |

| Gate | Exact invariant | Stable failure code |
| --- | --- | --- |
| V01 | current `(subject,property)` duplicate = 0 | `PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION` |
| V02 | each Definition has exactly one owned head | `PCAT-VRF-V02-CURRENT-REVISION-CARDINALITY` |
| V03 | cross-owner/Organization refs = 0 | `PCAT-VRF-V03-OWNER-SCOPE-MISMATCH` |
| V04 | every current operational ref has active membership | `PCAT-VRF-V04-SUBJECT-MEMBERSHIP-MISSING` |
| V05 | every active/retired Registration has exactly one valid Placement | `PCAT-VRF-V05-PLACEMENT-CARDINALITY` |
| V06 | Binding/Registration/Subject/Definition/revision agree | `PCAT-VRF-V06-BINDING-DEFINITION-MISMATCH` |
| V07 | ProjectValue/Binding/revision/source ownership agrees | `PCAT-VRF-V07-PROJECT-VALUE-REVISION-MISMATCH` |
| V08 | protected legacy/external ID mapping is exact | `PCAT-VRF-V08-PROTECTED-ID-UNMAPPED` |
| V09 | P0 source = blockers + unique primary dispositions | `PCAT-VRF-V09-SOURCE-CONSERVATION` |
| V10 | R6/R8 same-key merge = 0 | `PCAT-VRF-V10-R6-R8-IDENTITY-MERGE` |
| V11 | Archive row/graph/object integrity exact | `PCAT-VRF-V11-ARCHIVE-INTEGRITY` |
| V12 | packaged/compiled/DB/head/cache/readiness exact | `PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT` |
| V13 | reachable legacy writers = 0 | `PCAT-VRF-V13-LEGACY-WRITER-REACHABLE` |
| V14 | Binding/value tips and histories conserved | `PCAT-VRF-V14-BINDING-TIP-CONSERVATION` |
| V15 | audit principal/initiator/trace/map/target continuity | `PCAT-VRF-V15-AUDIT-CONTINUITY` |
| V16 | Organization structural Catalog objects/paths = 0 | `PCAT-VRF-V16-ORGANIZATION-STRUCTURAL-CATALOG` |
| V17 | exact fresh/populated mode result | `PCAT-VRF-V17-MODE-RESULT-MISMATCH` |

M01-M04 are respectively package-inventory drift, applied-file missing/checksum, ordered suffix/append-only alias ledger, and one-shot exact result, with codes `PCAT-MIG-PACKAGE-INVENTORY-DRIFT`, `PCAT-MIG-APPLIED-FILE-MISSING`, `PCAT-MIG-HISTORICAL-ALIAS-INVALID`, and `PCAT-SCHEMA-MIGRATION-RESULT-MISMATCH`. P01/P02 are real-PostgreSQL privilege negatives `PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS` and `PCAT-PRIV-LEGACY-WRITER-BYPASS`.

| Comparator gate | Semantic scope | Stable failure code |
| --- | --- | --- |
| D01 | Definition semantics | `PCAT-CMP-D01-DEFINITION-SEMANTICS` |
| D02 | Subject identity | `PCAT-CMP-D02-SUBJECT-IDENTITY` |
| D03 | Registration/Placement | `PCAT-CMP-D03-REGISTRATION-PLACEMENT` |
| D04 | Binding/current tip/history | `PCAT-CMP-D04-BINDING-HISTORY` |
| D05 | ProjectValue/revision pin | `PCAT-CMP-D05-PROJECT-VALUE-PIN` |
| D06 | Review/Proposal/Observation disposition | `PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION` |
| D07 | protected consumer references | `PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE` |
| D08 | source/writeback provenance | `PCAT-CMP-D08-SOURCE-WRITEBACK` |
| D09 | legacy/operator HTTP outcome | `PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME` |

Each comparison case is exactly `exact-equivalent`, `declared-expected-difference`, `unexplained-difference`, or `unqueryable/protected-reference-missing`. The last two counts are zero. Every expected difference has one R class, mapping-head/version, typed target or Archive, rule ID, and plan pin. Corpus-integrity codes are `PCAT-CMP-CORPUS-COVERAGE`, `PCAT-CMP-UNEXPLAINED-DIFFERENCE`, `PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE`, `PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE`, and `PCAT-CMP-REPORT-INTEGRITY`. All 11 inventory families are non-sampled and covered.

PCAT-API-01 through 12 are blocking: readiness; Subject/Definition reads; exact revision/timeline; Registration/Placement atomicity; Review; Proposal; typed legacy; legacy 410; role-spoof negatives; release/ETag/idempotency; all nine reads through Kernel; canonical project IDs. PCAT-UI-01 through 15 are blocking and reserved in the bilingual browser/operation registries: single page, URL/release anchor, detail, same-page queue, timeline, every state, conflict, legacy link, Agent read-only, adapter parity, three viewports, and real interactions. The exact files are `e2e/acceptance/parameter-catalog.acceptance.spec.ts`, `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts`, and `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts`.

| Browser ID | Normative behavior | File owner |
| --- | --- | --- |
| PCAT-UI-01 | one Parameter definitions entry; no Effective/Governance peer | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-02 | opaque Subject/Definition/release deep link survives reload/Back/Forward | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-03 | formal detail, current/pinned revision, usage, Registration/Placement | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-04 | same-page Review Queue and atomic allowed resolution | `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts` |
| PCAT-UI-05 | deterministic Catalog plus authorized History/Audit timeline | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-06 | ready exposes only role-authorized actions | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-07 | unregistered remains readable; Org Admin chooses explicit Placement and registers | `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts` |
| PCAT-UI-08 | loading/error and four empty reasons are distinct; stale-visible writes disabled | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-09 | retired/deprecated history remains readable and new actions disabled | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-10 | release/ETag/parent/idempotency conflict preserves input and requires reconfirmation | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| PCAT-UI-11 | exact legacy mapped/410/409/404 outcomes without Archive/candidate disclosure | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| PCAT-UI-12 | Agent read-only within invoking scope and all mutation/spoof paths denied | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| PCAT-UI-13 | API/mock states and authority are identical; mock has no extra power | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| PCAT-UI-14 | no overlap/overflow/hidden action/obstructed overlay at all three viewports | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| PCAT-UI-15 | real navigation/search/detail/timeline/registration/review/proposal/conflict/deep-link/focus journey | `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts` |

Browser evidence uses the real candidate API at 1440x900, 768x1024, and 390x844 and contains snapshot+screenshot, console/page/request/critical-response checks, network summary, real interaction ledger, browser/runtime/source/API/frontend/OpenAPI/report/release/target pins, and redaction result. `npm run acceptance:browser` cannot pass a blocking ID by skip/planned marker; `npm run acceptance:evidence` requires exact full-run role/route/assertion/API/DB/audit/artifact/runtime/replay records. Fresh executes zero-inventory and zero-corpus predicates rather than skipping; populated is complete and non-sampled. Target-host executes exact artifact/data-profile/cross-store restore/isolation/verifier/browser/observability; local and Hosted do not substitute.

Stable failure families are `PCAT-ART|MIG|SCHEMA|SYNC|CLASS|MAP|REG|BIND|ARCH|VRF|CMP|API|AUTH|UI|UPG|WRITER|RP|RESTORE|RET-*`. Metrics use bounded labels and never entity/property/value/person identifiers. Structured logs and audit carry trace, target/release/run/attempt/report/gate/phase/stable code and redacted evidence references. Reports exclude raw values, DTS, Archive payloads, credentials, and person data. Retention is the latest legal/audit hold, protected/business/Archive/mapping need, cleanup-plus-one-year, last restore/compatibility-plus-one-year, and completed public legacy window; failed/interrupted attempts remain at least one year.

R-L0 is P13 writer retirement, R-L1 read-only observation, R-L2 approved public read sunset, and R-L3/P16 cleanup. Cleanup requires two releases, 90 days, every deployment class at 30 zero-use days, complete consumer disposition, zero unresolved protected/ambiguous operational references, target mapping/Archive restore proof, zero writer/read/dependency, full fresh/populated/API/browser/observability/rollback evidence, its own Recovery Point and target restore, explicit old-binary behavior, distinct approvals, and retention/legal-hold proof. It never deletes Audit, Archive, mapping history, Catalog history, revisions, Bindings, ProjectValues, Proposals, Observations, or ReviewEvidence merely because they are not current.

### Migration numbering and immutable history

Current main ends at `0136`; this draft reserves no number. Every implementation slice fetches current `origin/main`, enumerates package filenames/checksums and the applied ledger, and takes the next unique contiguous prefix at that time. A collision may content-preserving-renumber only an unapplied branch migration. Applied filenames/bytes are never edited, removed, or recreated with different bytes; repairs are append-only. Historical aliasing requires one explicit append-only alias ledger. M01-M04 execute before/after one-shot migration, and API startup proves it applied none. Fresh, supported-floor upgrade, populated fixture, COMMIT/deferred constraints, and independent-session concurrency are mandatory. Generated schema and `docs:check` use a real pgvector PostgreSQL path.

<a id="pcat-spec-work-packages"></a>

### Ticket-ready work packages and published launch Issues

S0-S14 are workstream numbers, not Issue numbers. Each launch row below now maps one-to-one to the Phase A Issue in the publisher snapshot, with one agent/branch/merge decision. Parent acceptance still freezes the module seams, row granularity, and dependency edges. Evidence codes are D=document/static, L=local pure/fake, PG=real local PostgreSQL, B=browser-real, H=Hosted/CI, T=real target-host, and R=release/production report. “None” means another level cannot be inferred. Publication does not make a node ready: the ready set remains empty until the later Phase C gate.

Number/ID ownership defaults apply to every row: unless a row explicitly names a migration, ADR, PCAT-API, PCAT-UI, operation, V/M/P/D, or generated artifact, that node owns **none** of that class. Only S2-SCH/S2-RBAC/S10-PER may allocate their explicitly scoped migrations; G0/parent owns ADR numbers; S8-CON owns the API registry while route nodes own only their named assertion ranges. This Spec/G0 owns the initial non-blocking `PCAT-UI-01..15` and fifteen `future` operation registry entries; S9-BRW alone later changes their status to blocking/automated and regenerates the English operation matrix, while S9-CAT/S9-GOV/S9-BRW own only their named acceptance markers/files. This default is a normative explicit “none,” not omitted ticket metadata.

#### S0-S3: contracts, bundle, schema, and Kernel

| Node | Objective / owner and public seam | Allowed paths; artifact/ID ownership | Input -> output | Red -> Green | Evidence boundary | Dependencies; merge/conflict gate |
| --- | --- | --- | --- | --- | --- | --- |
| S0-ID | branded IDs, closed enums, failure/gate/purpose/results; shared contract package | `server/modules/parameter-catalog-contract/**`; sole ID/enum registry; no migration/ADR/API/UI IDs | #669-#679 -> compile-time registry | primitive/cross-kind assignment -> type/serialization golden | D+L; no PG/B/H/T/R | G0(CD); no other ticket edits registry |
| S0-RAT | legacy-writer/raw-read/import/route ratchets | `scripts/check-parameter-catalog-*.ts`, tests, allowlist manifest | inventory -> exact violation list | enumerate current violations -> named decreasing allowlist only | D+L only | G0(CD), S0-ID(CD); consumer tickets own only their allowlist entry removal |
| S0-FIX | integrate checksum-locked #671 populated and zero-mode fixture | `scripts/wayfinder/**`, exact EN/ZH fixture references; sole fixture/version owner | #671 -> reusable loader | checksum/R6-R8/dirty DB failure -> checked-empty load/cleanup | D+L; PG execution in S2-PGH; H later; no T/R | G0(CD), S0-ID(CF); downstream consumes without edits |
| S1-BND | immutable bundle schema/manifest/stable IDs/lineage | `schemas/dts/catalog-release/**`, `docs/generated/parameter-catalog-bundle.schema.json`; schema-version owner | ADR-0040/41 -> canonical JSON schema | malformed/reassigned/cycle -> reject before compile | D+L only | G0(CD), S0-ID(CD); sole generated schema owner |
| S1-CMP | deterministic offline compiler/validator | `server/modules/catalog-kernel/compiler/**`, tests; compiled model/toolchain digest owner | S1-BND -> byte-identical compiled release | reorder/duplicate/gap -> deterministic result/violations | L; H repeat later; no PG/B/T/R | S1-BND(CD), S0-ID(CD); no DB/runtime files |
| S2-SCH | physical schema, keys, deferred constraints/triggers, and migration-owned current-release guard/lock protocol | sole `server/migrations/<next>_canonical_parameter_catalog_schema.sql`, schema tests; physical-name, guard signature/failure, and shared/exclusive pointer-lock owner | ADR-0040/42 + S0-ID -> fresh/upgrade schema and execute-only guard contract | COMMIT constraint failure, stale pin, retirement, pointer race, rollback -> exact typed guard/serialization and zero residue | PG required with independent sessions; D ledger; H later | G0(CD), S0-ID(CF); freeze guard signature/SQLSTATE/lock protocol before S3-INS, S4-REG, or S5-RSL; no shared migration file |
| S2-RBAC | owners/roles/grants/function reachability | sole later `server/migrations/<next>_canonical_parameter_catalog_roles.sql`, role tests; grant-manifest owner | S2-SCH guard/schema contract -> least privilege | Governance Catalog SELECT/DML or broad function access -> guard-only EXECUTE plus P01/P02 SQLSTATE matrix | PG required; H repeat later | S2-SCH(CF); revoke PUBLIC and grant guard EXECUTE only to `parameter_governance_writer_role`; separate migration filename |
| S2-PGH | real-PG harness, independent sessions, COMMIT/failure injection | `server/testing/parameterCatalog/**`, runner config; no schema ownership | S0-FIX + schema -> disposable checked-empty DB | fake/shared-session accepted -> real server/independent pools | PG required; H later | S0-FIX(CD), S2-SCH(CF); no migration/generated-schema edits |
| S3-RUN | Kernel public types and immutable current/pinned read facet | `server/modules/catalog-kernel/interface.ts`, `runtime/**`, tests; sole public-type owner | compiler+schema contracts -> six-operation interface/snapshots | mixed release/null/post-page filter -> tagged captured reads/cursors | L+PG; B via API later | S1-CMP(CF), S2-SCH(CF), S2-PGH(CD); freeze before consumers |
| S3-INS | bootstrap/advance/switch-back Kernel-owned transaction and exclusive current-pointer lock implementation | `server/modules/catalog-kernel/install/**`, tests; install adapter and exclusive lock-order owner, without exposing the internal store | S1-CMP + S2-SCH guard/lock + S2-RBAC + S3-RUN -> atomic materialization | failure/lost response/concurrent install plus pointer advance versus registration/retirement/rollback -> one exclusive serialization and all-or-none/no-op/conflict | PG required with independent sessions; H later | S1-CMP(CD), S2-SCH(CF/CD), S2-RBAC(CD), S3-RUN(CF); lock protocol freeze precedes S4-REG/S5-RSL integration; no public-interface edits |
| S3-VFY | independent verifier, cache rebuild, failure injection | `server/modules/catalog-kernel/verification/**`, `cache/**`; fingerprint/cache-format owner | S3-RUN + S3-INS -> verifier snapshot/cache | stale/poisoned/partial/writer credential -> read-only exact drift | L+PG; H later | S3-RUN(CD), S3-INS(CD), S2-RBAC(CD); S10-VMP consumes its read-only schema |

#### S4-S6: internal Governance packages and Binding/ProjectValue

| Node | Objective / owner and public seam | Allowed paths; artifact/ID ownership | Input -> output | Red -> Green | Evidence boundary | Dependencies; merge/conflict gate |
| --- | --- | --- | --- | --- | --- | --- |
| S4-REG | Governance Registration/Placement explicit/auto/lifecycle/move through the shared transaction-local guard | `server/modules/parameter-governance/registration/**`; private repos, guard adapter/failure mapping, and post-idempotency shared lock order owner; no API/UI IDs | captured Kernel pin + context + intent/proof -> stable result without Catalog row access | direct Catalog query, double Placement, stale/retired pin, pointer race/rollback, auto-restore, lost response -> guard-only shared serialization and exact replay | L+PG independent sessions; B/H later | S2-SCH(CF/CD), S2-RBAC(CD), S2-PGH(CD), S3-RUN(CF), S3-INS(CF/ID); no public repo/UoW; parallel with S4-EVD only after guard freeze |
| S4-EVD | immutable Observation/ReviewEvidence ingest | `server/modules/parameter-governance/evidence/**`; fingerprint owner | matcher/source provenance -> evidence | weak match/overwrite/R6-R8 merge -> immutable dedupe/conflict | L+PG | S3-RUN(CF), S2-SCH(CD); creates no Registration/Definition/Binding |
| S4-REV | Review Queue grouping/read/state, excluding resolution coordinator | `server/modules/parameter-governance/review/**`; ReviewItem ETag/query owner | S4-EVD -> grouped open read model | duplicate group/stale candidate/raw leak -> exact authorized query | L+PG; B later | S4-EVD(CD), S3-RUN(CF); no Resolution/Registration write |
| S5-RSL | sole `resolveReviewItem` coordinator and atomic review-registration using S4-REG's private guarded writer | `server/modules/parameter-governance/resolveReviewItem/**`; command/result/failure/UoW owner; no Catalog adapter/query ownership | S4-REG + S4-REV + captured release -> ReviewResolutionResult | HTTP multiwriter, direct Catalog query, ETag/key/pointer race, retirement, rollback, lost response, failure each step -> one guarded commit + durable refusal/exact replay | PG required with independent sessions; B/H later | S4-REG(CD), S4-REV(CD), S2-SCH(CF), S2-RBAC(CD), S3-RUN(CF), S3-INS(ID); no public transaction/repository imports; only the S4-REG internal guarded writer may be used; no second guard adapter |
| S5-PRP | Proposal revisions/workflow/publication intent | `server/modules/parameter-governance/proposals/**`; Proposal command/result owner | captured base + roles -> Proposal/intent | self-accept/stale/Catalog write -> distinct reviewer/intent-only audit | L+PG; B/H later | S3-RUN(CF), S2-SCH(CD); parallel with S5-RSL after shared interface freeze |
| S6-BND | Binding stable identity/effective-revision semantic cutover | `server/modules/parameter-bindings/binding/**` and explicit migration adapter; Binding-type owner | Kernel + active Registration -> Binding/CAS | module/latest/cross-owner race -> composite agreement/stable ID | PG required | S3-RUN(CD), S4-REG(CF), S2-SCH(CD); cannot be fully parallel with S4-REG |
| S6-VAL | immutable ProjectValue, explicit current tip, complete history | `server/modules/parameter-bindings/values/**`, tests; value/history owner | Binding + exact revision/source -> value/pointer | max-time/update/history loss/CAS race -> append+CAS+audit | PG required | S6-BND(CD); no consumer adapters |
| S6-WFA | protected workflow adapter contract, not 11 consumer migrations | `server/modules/parameter-bindings/adapters/**`, tests; internal canonical adapter DTO owner | S6-BND + S6-VAL -> protected-reference adapter | `parameterSpecId` fallback -> canonical pin or typed block | L+PG; consumer evidence later | S6-BND(CD), S6-VAL(CD); S12-CGH/S12-TOP/S12-PRJ/S12-FIL/S12-AGT/S12-LOG/S12-DBG/S12-DTS/S12-KNW/S12-MOD/S12-OPS own their call sites |

#### S7-S11: Cutover, API/UI, Verification, and upgrade

| Node | Objective / owner and public seam | Allowed paths; artifact/ID ownership | Input -> output | Red -> Green | Evidence boundary | Dependencies; merge/conflict gate |
| --- | --- | --- | --- | --- | --- | --- |
| S7-CLS | private R0-R10 full-graph classifier | `server/modules/catalog-cutover/classifier/**`; classifier version/rule IDs | P0 graph+fixture -> one primary class | R0 archive/R6-R8 merge/sample -> full conservation/block | L+populated PG; H/T later | S0-FIX(CD), S2-PGH(CD), S3-RUN(CF); no mapping/archive writes |
| S7-MAP | typed identity, append-only mapping versions/heads | `server/modules/catalog-cutover/mapping/**`; mapping schema owner | S7-CLS result -> one typed head | reclassify/overwrite/ambiguous -> append/no-op/conflict | PG; T later | S7-CLS(CD), S2-SCH(CD); no S7-ARC adapter edits |
| S7-ARC | immutable Archive DB+encrypted object adapter | `server/modules/catalog-cutover/archive/**`; manifest/object schema owner | S7-CLS archive outcomes -> metadata/object checksum | public/partial/leak -> atomic integrity/authorized restore read | L+PG+local object; T later | S7-CLS(CD), S2-SCH(CD); parallel with S7-MAP |
| S7-ORC | four Cutover operations, P0-P10, rehearsal/rollback containment | remaining `server/modules/catalog-cutover/**`, `scripts/wayfinder/**` orchestration; plan/run-schema owner | S3-INS/S4-REG/S4-EVD/S4-REV/S5-RSL/S5-PRP/S6-BND/S6-VAL/S6-WFA/S7-CLS/S7-MAP/S7-ARC -> checkpoints | duplicate/unknown/ad-hoc/rollback drift -> same-plan resume/dump equality | populated PG required; H/T later | S3-INS(CD), S4-REG(CF), S4-EVD(CF), S4-REV(CF), S5-RSL(CF), S5-PRP(CF), S6-BND(CF), S6-VAL(CF), S6-WFA(CF), S7-CLS(CD), S7-MAP(CD), S7-ARC(CD); P12-15 not executed |
| S8-CON | OpenAPI, route manifest, DTO/error registry, clients | `server/modules/contracts/**`, `docs/generated/openapi.json`, client contract source; PCAT-API-01..12 registry owner | #677 + frozen S3-RUN/S4-REG/S4-REV/S5-RSL/S5-PRP/S6-WFA/S7-MAP/S7-ARC seams -> wire contract | missing route/reason/client branch -> generated parity | D+L; runtime later | S3-RUN(CF), S4-REG(CF), S4-REV(CF), S5-RSL(CF), S5-PRP(CF), S6-WFA(CF), S7-MAP(CF), S7-ARC(CF); sole generated OpenAPI owner; freezes before S8-READ/S8-GOV/S8-LEG and S9-PRT |
| S8-READ | nine Catalog read routes close through Kernel | `server/modules/parameter-catalog-api/read/**`, tests; PCAT-API-01..03 assertions | S3-RUN + S8-CON -> HTTP DTO/cursors | raw repo/post-filter/scope leak -> exact closure | L+PG+HTTP; B/H later | S3-RUN(CD), S4-REG(CF), S6-WFA(CF), S8-CON(CF); no generated OpenAPI edits |
| S8-GOV | Governance route family maps one command per handler | `server/modules/parameter-catalog-api/governance/**`; PCAT-API-04..07 assertions | S4-REG/S4-REV/S5-RSL/S5-PRP + S8-CON -> ETag/idempotent HTTP | tx handle/multiwriter/spoof/partial -> typed mapping | PG+HTTP+audit; B/H later | S4-REG(CD), S4-REV(CD), S5-RSL(CD), S5-PRP(CD), S8-CON(CF); no private imports |
| S8-LEG | exact resolver/read adapter/410 transition | `server/modules/parameter-catalog-api/legacy/**`; PCAT-API-08..10 assertions | S7-MAP/S7-ARC + S8-CON -> mapped/410/409/404 | inference/reverse/raw Archive/write -> allow-list exact | PG+HTTP; B/H later | S7-MAP(CD), S7-ARC(CD), S8-CON(CF); no P12-15 |
| S9-PRT | frontend ports, domain states, URL/release/ETag/idempotency | `src/application/ports/ParameterCatalog*.ts`, `src/application/parameter-catalog/**`; frontend port/state owner, consuming already frozen operation IDs | S8-CON freeze -> frontend types/states | Effective/Governance/mock power -> parity | L; B later | S8-CON(CF); no registry/page/spec edits |
| S9-CAT | one-page list/detail/timeline/read states | `src/features/parameter-catalog/**`, route slice, `e2e/acceptance/parameter-catalog.acceptance.spec.ts`; owns UI-01/02/03/05/06/08/09/14 markers | ports + running read API -> UI | mixed release/peer/hidden state/overflow -> exact 3-view UI | L+B real API; PG via API | S9-PRT(CD), S8-READ(ID); no Governance/negative file edits |
| S9-GOV | Registration/Placement/Review/Proposal interactions | `src/features/parameter-catalog-governance/**`, `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts`; UI-04/07/15 markers | ports + running Governance API -> reconfirming UX | silent retry/Agent write/partial/Proposal materialize -> exact role/ETag flows | PG+HTTP+B+audit | S9-PRT(CD), S8-GOV(ID); separate spec owner |
| S9-BRW | responsive/deep-link/negative bundle and registry transition | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts`, four EN/ZH coverage docs; owns UI-10..13 markers plus the all-15 `required=false` -> `true` and `future` -> `automated` transition | S9-CAT + S9-GOV + S8-LEG -> blocking browser suite/evidence schema | lost input/inference/mock drift/diagnostics fail -> all 15 IDs and exact existing spec references | B three views + PG/API/audit refs; H/T later | S9-CAT(ID), S9-GOV(ID), S8-READ(ID), S8-GOV(ID), S8-LEG(ID); sole registry/generated-English-matrix transition owner |
| S10-PER | Verification persistence/core, gate registry, applicability | `server/modules/release-verification/core/**`; only its own allocated migration; registry/base-report and five-operation public-type owner, including the `readReport` port | S0-ID + S2-SCH freeze -> plans/attempts/results and frozen evidence/report ports | waiver/missing/mutable -> closed append-only | L+PG; H later | S0-ID(CD), S2-SCH(CF); early parallel core |
| S10-VMP | V01-V17, M01-M04, P01/P02 SQL adapters | `server/modules/release-verification/gates/postgres/**`; V/M/P implementation owner | producer contracts -> typed results | false zero/skip/bypass -> exact counts/SQLSTATE | fresh+populated PG; H/T later | S10-PER(CF), S2-RBAC(CD), S3-VFY(CD), S7-ORC(ID); waits producer evidence |
| S10-DCP | D01-D09 corpus/comparator | `server/modules/release-verification/comparison/**`; corpus/result schema owner | #669 families + S7-ORC and consumer outputs -> report | sample/missing/free text -> zero unexplained/unqueryable | populated PG; H/T later; D09 may consume B | S10-PER(CF), S7-ORC(ID), S12-CGH(ID), S12-TOP(ID), S12-PRJ(ID), S12-FIL(ID), S12-AGT(ID), S12-LOG(ID), S12-DBG(ID), S12-DTS(ID), S12-KNW(ID), S12-MOD(ID), S12-OPS(ID); core may land early |
| S10-API | API-01..12 evidence adapter | `server/modules/release-verification/evidence/api/**`; API evidence schema owner | running S8-READ/S8-GOV/S8-LEG -> immutable HTTP/PG/auth/audit refs | mock/stale/missing request ID -> exact candidate bundle | PG+HTTP; H/T later | S10-PER(CF), S8-CON(CD), S8-READ(ID), S8-GOV(ID), S8-LEG(ID); never starts runtime |
| S10-UI | UI-01..15 evidence adapter | `server/modules/release-verification/evidence/browser/**`; browser bundle adapter owner | S9-BRW -> sanitized evidence refs | screenshot-only/pre-P13/stale/redaction fail -> full pins | B; H/T later; PG/API refs | S10-PER(CF), S9-BRW(ID); no UI action implementation |
| S10-RPT | report lineage, approvals, runtime pin, retention | `server/modules/release-verification/report/**`; report/approval/pin persistence and implementation owner | S10-PER + S10-VMP/S10-DCP/S10-API/S10-UI -> purpose report/pin and `readReport` implementation | wrong purpose/self/pre-pin/nondeterminism -> exact lineage | L+PG; T/R later | S10-PER(CD), S10-VMP(CD), S10-DCP(CD), S10-API(CD), S10-UI(CD); waits all final producers, without changing the S10-PER public port |
| S11-UPG | controller state machine/journal core, Cutover/Verification only | `ops/self-hosted/scripts/upgrade-lib.sh`, future controller/tests; journal/state owner | S7-ORC + S10-PER contracts -> guarded actions | API migrate/gate select/guess -> idempotent guards | L; PG in apply; H/T later | S7-ORC(CF), S10-PER(CF); parallel with S11-RP and S10-PER |
| S11-RP | Recovery Point capture/verify/token restore | `scripts/run-restore-drill.ts`, `ops/self-hosted/storage/**`, tests; manifest owner | quiesced target -> 3-store manifest/restore | pre-quiesce/partial/stale/wrong target -> exact checksum | local cross-store+PG; T later | G0(CD), S10-PER(CF); disposable targets only |
| S11-APL | fresh/populated apply through controller | `ops/self-hosted/scripts/upgrade.sh` integration tests/self-host fixtures; mode-acceptance owner | S11-UPG + S11-RP + S7-ORC -> P0-P11 checkpoints | startup migration/duplicate/mode ambiguity -> exact zero/full mode | PG required; H/T later | S11-UPG(CD), S11-RP(CD), S7-ORC(CD), S10-VMP(ID); no P12-15 ownership |
| S11-REC | resume/recovery-required/failure matrix | controller recovery paths/tests; failure/next-action owner | S11-UPG + S11-RP + S11-APL -> one legal result | unknown auto-resume/partial restore -> exact next action | L+PG cross-store; H/T later | S11-UPG(CD), S11-RP(CD), S11-APL(CD); no production incident action |

#### S12: eleven independent consumer-family adapter tickets

Each owns only its family's legacy-to-canonical call sites and acceptance. None owns P12/P13/P14/P15, Cutover phases, Verification reports, upgrade controller, shared OpenAPI/migration, or generated schema.

| Node/family | Allowed paths and objective | Input -> output; owned corpus IDs | Red -> Green | Evidence | Dependencies; merge/conflict gate |
| --- | --- | --- | --- | --- | --- |
| S12-CGH Catalog/governance HTTP | migrate/remove old consumers/wiring in `server/modules/parameter-specs/**` and old methods in `src/infrastructure/http/parameterAdminClient.ts` | S8-READ/S8-GOV/S8-LEG -> no Effective/Governance/raw writer; D01/D03/D06/D09 cases | direct legacy read/write -> exact adapter/410 | PG+HTTP; B via S9-BRW; H/T later | S8-READ(CD), S8-GOV(CD), S8-LEG(CD), S7-ORC(CF); frozen S8-CON manifest avoids route-file conflict |
| S12-TOP Parameter topology HTTP | `server/modules/parameter-topology/**`; `src/application/ports/ParameterTopologyRepository.ts`; `src/infrastructure/http/parameterTopologyClient.ts` | S4-EVD/S6-WFA -> canonical Subject/evidence/Binding; D02/D03/D04/D06 | provisional spec/module identity -> observe/review/bind or block | PG+HTTP+B existing suite | S4-EVD(CD), S6-WFA(CD), S8-CON(CF); no raw Catalog writer |
| S12-PRJ Project parameter workbench | `server/modules/parameters/**`; `server/modules/parameter-drafts/**`; `src/application/ports/ParameterRepository.ts`; `src/infrastructure/http/parameterClient.ts`; `src/infrastructure/http/parameterDtos.ts` | S6-WFA -> Binding/revision/value tips; D04/D05 | `parameterSpecId`/latest -> stable history | PG+HTTP+B | S6-WFA(CD), S8-CON(CF); no S6-WFA core edits |
| S12-FIL File sync/writeback | `server/modules/parameter-files/**`; `src/application/ports/ParameterFileRepository.ts`; `src/infrastructure/http/parameterFileClient.ts` | S6-WFA protected adapter+source -> canonical writeback; D07/D08 | property fallback -> exact pin/source or block | PG+HTTP+B | S6-WFA(CD); frozen shared port |
| S12-AGT Agent tools | parameter tools/schemas under `server/modules/agent/**` | S8-READ + S6-WFA normal Binding workflow; D07/D08 | structural tool/spoof -> scoped read, no Governance write | L+PG+HTTP; B where existing | S8-READ(CD), S6-WFA(CD), S8-CON(CF); tool-registry/provenance gate |
| S12-LOG Log analysis | `server/modules/logs/**`; `src/application/ports/LogAnalysisRepository.ts`; `src/infrastructure/http/logClient.ts`; `src/infrastructure/http/logDtos.ts` | S8-READ/S7-MAP exact refs; D07 | tenant leak/unpinned/create -> scoped immutable ref | PG+HTTP+B existing log | S8-READ(CD), S7-MAP(CD); no Catalog DTO edits |
| S12-DBG Debugging | `server/modules/debugging/**`; `src/application/ports/DebuggingGateway.ts`; `src/infrastructure/http/debuggingClient.ts`; `src/infrastructure/http/debuggingDtos.ts` | S6-WFA/S7-MAP exact Binding/revision map; D07 | debug mutates Catalog/guesses -> exact or block | PG+HTTP+B; HDC/T separate | S6-WFA(CD), S7-MAP(CD); device approval unchanged |
| S12-DTS DTS reload | `server/modules/dts-reload/**`; `src/application/ports/DtsReloadRepository.ts`; `src/infrastructure/http/dtsReloadClient.ts` | S6-WFA/S8-READ/S7-MAP Binding/value/revision/release pins; D07/D08 | stale/unpinned/direct write -> exact or block | PG+HTTP+B fake bridge; HDC/T separate | S6-WFA(CD), S8-READ(CD), S7-MAP(CD) |
| S12-KNW Knowledge | `server/modules/knowledge/**`; `src/application/ports/KnowledgeRepository.ts`; `src/infrastructure/http/knowledgeClient.ts`; `src/features/knowledge/**` | S8-READ/S7-MAP canonical ref + legacy metadata; D07 | orphan/silent retarget/draft -> exact history | PG+HTTP+B existing knowledge | S8-READ(CD), S7-MAP(CD); no shared OpenAPI edit |
| S12-MOD Module registry | `server/modules/parameter-modules/**`; `src/application/ports/ParameterModuleRegistryRepository.ts`; `src/infrastructure/http/parameterModuleRegistryClient.ts` | S4-REG/S8-LEG Registration/Placement navigation; D02/D03 | module proves identity/overlay -> placement-only or 410 | PG+HTTP+B transition | S4-REG(CD), S8-LEG(CD); structural-owner census zero |
| S12-OPS Release/operations | `server/modules/operations/**`, reconciliation/operator-read callers, excluding controller | S7-ORC inspect + frozen S10-PER `readReport` port + S8-LEG -> canonical diagnostics; D09 | old verifier/reclassify/public diag -> typed read only | PG+HTTP; H/T later | S7-ORC(CF), S10-PER(CF), S8-LEG(CD); P12-15 excluded; integration with S10-RPT occurs after S10-DCP without a code cycle |

#### Release integration and later programs

| Node | Objective/owner and allowed artifacts | Input -> output | Red -> Green | Evidence | Dependency/merge gate |
| --- | --- | --- | --- | --- | --- |
| RI-01 | independent parent/release-owner package invokes Cutover, Verification, and controller; allowed paths `scripts/run-self-hosted-release-gate.ts`, its tests, and `ops/self-hosted/releases/**`; owns P12/P13/P14/P15 invocation wiring and target/report refs, no business module | all consumers + P0-P10 + Verification + upgrade/recovery + API/UI -> approved public chain | missing producer/pre-pin/P13 delta/pre-runtime browser/early traffic -> exact purpose/isolation chain | PG+B; H repeat only; T required; R with distinct approvals | S7-ORC(CD), S10-RPT(CD), S11-REC(CD); S12-CGH(RE), S12-TOP(RE), S12-PRJ(RE), S12-FIL(RE), S12-AGT(RE), S12-LOG(RE), S12-DBG(RE), S12-DTS(RE), S12-KNW(RE), S12-MOD(RE), S12-OPS(RE), S10-VMP(RE), S10-DCP(RE), S10-API(RE), S10-UI(RE), S9-BRW(RE); last launch merge only |
| S13-PROGRAM | later R-L2 production-release program; telemetry/compat docs, not a launch ticket | two releases + 90 days + per-class 30-day zero use + purpose report -> eligible reads 410 | unmet real time/telemetry blocks | T+R only | RI-01(RE) plus actual window and `legacy-read-sunset` approval |
| S14-PROGRAM | later R-L3/P16 production-release program; separately approved removal list | S13-PROGRAM + retention/recovery/zero dependency + own RP/restore -> deletion | any protected dependency/history/restore gap blocks | T+R only | S13-PROGRAM(RE) plus actual evidence; never merge with launch or delete from static “unused” proof |

<a id="pcat-spec-dag"></a>

### Typed dependency DAG, critical path, and merge order

`CD` means code dependency, `CF` contract freeze, `ID` candidate integration, and `RE` release/evidence dependency. Every label below is an actual row above; a workstream shorthand is never a node.

```text
G0: #669-#679 decisions + this parent-accepted Spec are present on main
G0 -(CD)-> S0-ID
S0-ID -(CD/CF)-> S0-RAT, S0-FIX, S1-BND, S2-SCH
S1-BND -(CD)-> S1-CMP
S2-SCH -(CF)-> S2-RBAC; S0-FIX + S2-SCH -(CD/CF)-> S2-PGH
S1-CMP + S2-SCH + S2-PGH -(CF/CF/CD)-> S3-RUN
S1-CMP + S2-SCH + S2-RBAC + S3-RUN -(CD/CF/CD/CF)-> S3-INS
S3-RUN + S3-INS + S2-RBAC -(CD)-> S3-VFY
S2-SCH + S2-RBAC + S2-PGH + S3-RUN + S3-INS -(CF/CD/CD/CF/CF)-> S4-REG
S3-RUN + S2-SCH -(CF/CD)-> S4-EVD -(CD)-> S4-REV
S4-REG + S4-REV + S3-INS -(CD/CD/ID)-> S5-RSL
S3-RUN + S2-SCH -(CF/CD)-> S5-PRP
S3-RUN + S4-REG + S2-SCH -(CD/CF/CD)-> S6-BND -(CD)-> S6-VAL
S6-BND + S6-VAL -(CD)-> S6-WFA
S0-FIX + S2-PGH + S3-RUN -(CD/CD/CF)-> S7-CLS
S7-CLS + S2-SCH -(CD)-> S7-MAP, S7-ARC
S3-INS + S4-REG + S4-EVD + S4-REV + S5-RSL + S5-PRP + S6-BND + S6-VAL + S6-WFA
  + S7-CLS + S7-MAP + S7-ARC -(CD/CF)-> S7-ORC(P0-P10)
S3-RUN + S4-REG + S4-REV + S5-RSL + S5-PRP + S6-WFA + S7-MAP + S7-ARC -(CF)-> S8-CON
S3-RUN + S4-REG + S6-WFA + S8-CON -(CD/CF)-> S8-READ
S4-REG + S4-REV + S5-RSL + S5-PRP + S8-CON -(CD/CF)-> S8-GOV
S7-MAP + S7-ARC + S8-CON -(CD/CF)-> S8-LEG
S8-CON -(CF)-> S9-PRT
S9-PRT + S8-READ -(CD/ID)-> S9-CAT; S9-PRT + S8-GOV -(CD/ID)-> S9-GOV
S9-CAT + S9-GOV + S8-READ + S8-GOV + S8-LEG -(ID)-> S9-BRW
S0-ID + S2-SCH -(CD/CF)-> S10-PER
S10-PER + S2-RBAC + S3-VFY + S7-ORC -(CF/CD/CD/ID)-> S10-VMP
S10-PER + S7-ORC + S12-CGH + S12-TOP + S12-PRJ + S12-FIL + S12-AGT + S12-LOG
  + S12-DBG + S12-DTS + S12-KNW + S12-MOD + S12-OPS -(CF/ID)-> S10-DCP
S10-PER + S8-CON + S8-READ + S8-GOV + S8-LEG -(CF/CD/ID)-> S10-API
S10-PER + S9-BRW -(CF/ID)-> S10-UI
S10-PER + S10-VMP + S10-DCP + S10-API + S10-UI -(CD)-> S10-RPT
S7-ORC + S10-PER -(CF)-> S11-UPG; S10-PER -(CF)-> S11-RP
S11-UPG + S11-RP + S7-ORC + S10-VMP -(CD/CD/CD/ID)-> S11-APL
S11-UPG + S11-RP + S11-APL -(CD)-> S11-REC
S8-READ + S8-GOV + S8-LEG + S7-ORC -(CD/CF)-> S12-CGH
S4-EVD + S6-WFA + S8-CON -(CD/CF)-> S12-TOP
S6-WFA + S8-CON -(CD/CF)-> S12-PRJ; S6-WFA -(CD)-> S12-FIL
S8-READ + S6-WFA + S8-CON -(CD/CF)-> S12-AGT
S8-READ + S7-MAP -(CD)-> S12-LOG
S6-WFA + S7-MAP -(CD)-> S12-DBG
S6-WFA + S8-READ + S7-MAP -(CD)-> S12-DTS
S8-READ + S7-MAP -(CD)-> S12-KNW
S4-REG + S8-LEG -(CD)-> S12-MOD
S7-ORC + S10-PER + S8-LEG -(CF/CF/CD)-> S12-OPS
S7-ORC + S10-RPT + S11-REC -(CD)-> RI-01, with S9-BRW/S10-VMP/S10-DCP/S10-API/S10-UI and
  S12-CGH/S12-TOP/S12-PRJ/S12-FIL/S12-AGT/S12-LOG/S12-DBG/S12-DTS/S12-KNW/S12-MOD/S12-OPS -(RE)-> RI-01
RI-01 -(RE + actual time/telemetry)-> S13-PROGRAM -(RE + actual evidence)-> S14-PROGRAM
```

The critical path is `G0 -> S0-ID -> S1-BND -> S1-CMP` plus `G0 -> S0-ID -> S2-SCH -> S2-PGH`, converging at `S3-RUN -> S3-INS -> S4-REG`; the Governance branch continues through `S4-EVD -> S4-REV -> S5-RSL`, then `S6-BND -> S6-VAL -> S6-WFA`, `S7-CLS -> S7-MAP/S7-ARC -> S7-ORC`, `S8-CON -> S8-READ/S8-GOV/S8-LEG -> S9-PRT/S9-CAT/S9-GOV/S9-BRW`, the blocking S12-CGH/S12-TOP/S12-PRJ/S12-FIL/S12-AGT/S12-LOG/S12-DBG/S12-DTS/S12-KNW/S12-MOD/S12-OPS frontier, `S10-VMP/S10-DCP/S10-API/S10-UI -> S10-RPT` plus `S11-UPG/S11-RP -> S11-APL -> S11-REC`, and finally `RI-01`. S6-BND starts only after S3-RUN and the S4-REG contract freeze and is not fully parallel with S4-REG. S10-PER can start after S0-ID and the S2-SCH schema freeze; S11-UPG, S11-RP, and S10-PER are then kept as parallel as their exact edges allow. S9-PRT starts only after S8-CON, and browser-real S9-CAT/S9-GOV/S9-BRW integration waits for runnable S8-READ/S8-GOV/S8-LEG.

Recommended merge waves use only ticket rows: (0) `G0`; (1) `S0-ID`; (2) parallel `S0-RAT`, `S0-FIX`, `S1-BND`, `S2-SCH`; (3) `S1-CMP`, `S2-RBAC`, `S2-PGH`, `S10-PER`; (4) `S3-RUN`, `S11-RP`; (5) `S3-INS`, `S4-EVD`, `S5-PRP`, `S7-CLS`; (6) `S3-VFY`, `S4-REG`, `S4-REV`, `S7-MAP`, `S7-ARC`; (7) `S5-RSL`, `S6-BND`; (8) `S6-VAL`; (9) `S6-WFA`; (10) `S7-ORC` and `S8-CON`; (11) `S8-READ`, `S8-GOV`, `S8-LEG`, `S9-PRT`, `S11-UPG`; (12) `S9-CAT`, `S9-GOV`, `S10-VMP`, `S10-API`, `S11-APL`, `S12-CGH`, `S12-TOP`, `S12-PRJ`, `S12-FIL`, `S12-AGT`, `S12-LOG`, `S12-DBG`, `S12-DTS`, `S12-KNW`, `S12-MOD`, `S12-OPS`; (13) `S9-BRW`, `S10-UI`, `S11-REC`; (14) `S10-DCP`; (15) `S10-RPT`; (16) `RI-01`. S12-OPS compiles against the frozen S10-PER `readReport` port, S10-DCP integrates every S12 result, and only then does S10-RPT implement the port against complete evidence; every node still has one branch and one merge decision. S13-PROGRAM and S14-PROGRAM wait for real windows and are not launch waves.

<a id="pcat-spec-artifact-freeze"></a>

### Artifact ownership and freeze

| Artifact | Sole owner before freeze | Downstream rule |
| --- | --- | --- |
| branded IDs/enums | S0-ID | downstream consumes; semantic change returns to owner |
| migration filenames | S2-SCH, S2-RBAC, S10-PER each owns only its allocated file | allocate after fetch/rebase; never two tickets edit one file; applied bytes immutable |
| ADR numbers/index | G0/parent | decisions and ADR-0040-0042 freeze on main; tickets do not self-allocate |
| bundle schema/generated JSON | S1-BND | freeze before compiler; one generator owner |
| PostgreSQL schema | S2-SCH | freeze before Kernel/Governance/Binding/Cutover/Verification |
| Kernel public types | S3-RUN | freeze before implementations and consumers |
| OpenAPI/route/error/generated OpenAPI | S8-CON | route/frontend tickets do not edit generated artifact |
| frontend ports/state | S9-PRT | freeze before page/Governance UI |
| browser requirement/operation IDs and initial metadata | this Spec/G0 owns the existing `required=false` requirements and `coverage=future` operations; S9-BRW owns the later status/spec-reference transition | IDs are frozen before S9-PRT/S9-CAT/S9-GOV; S9-BRW alone changes all fifteen to blocking/automated and regenerates the English matrix; each acceptance file owns only its markers |
| Verification gate registry/report schema | S10-PER and S10-RPT in non-overlapping files | adapters/controller cannot change applicability |
| upgrade journal/state machine | S11-UPG | freeze before apply/recovery/RI-01 |
| `docs/generated/db-schema.md` | schema integration owner | regenerate from exact tree on real pgvector; parallel tickets do not edit |
| #671 shared fixture | S0-FIX | checksum freeze; downstream consumes only |
| acceptance files | S9-CAT owns `e2e/acceptance/parameter-catalog.acceptance.spec.ts`; S9-GOV owns `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts`; S9-BRW owns `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` | one file, one ticket owner |

Two tickets in one wave may not own the same generated artifact, migration, registry source, or acceptance file. The parent must change ownership/wave before implementation; resolving the conflict later does not preserve ticket independence. Parent acceptance has frozen the four seams, every row's granularity, dependency types, critical path, and merge order. Phase A published the exact one-node/one-Issue map and relationships without changing those decisions; implementation remains disabled pending Phase B and Phase C.

## Testing Decisions

Tests use a production public interface or controlled adapters at the same production seam. Direct Catalog-table inserts, private repository tests as acceptance, test-only materializers, mock-only Governance, API-startup migration, and manual repair are invalid acceptance. Pure/fake adapters cover deterministic computation/failure injection. Transactions, roles, deferred constraints, concurrency, cutover, audit, and Verification use real PostgreSQL. Parameter Governance acceptance crosses `resolveReviewItem`, never its private repositories/UoW.

#### TDD Red -> Green order

1. Red static legacy writer/raw-read/`parameterSpecId`/overlay/Effective/Governance census; Green an exact monotonically decreasing compatibility allowlist.
2. Red malformed/missing/duplicate/reordered bundle/lineage fixtures; Green enumeration-order-independent byte-identical compile and fixed violations before write.
3. Red real-PG deferred head/subtype/Placement/owner, role bypass, and injected transaction failures; Green constraints fire at `SET CONSTRAINTS ALL IMMEDIATE` or COMMIT with zero partial rows.
4. Red Kernel bootstrap/advance/idempotency/drift/current+pinned/cache/failure points; Green all six operations through the public facets and unchanged pointers/heads on every failure.
5. Red caller/HTTP transaction handles and multiwriters, Review ETag partial writes, explicit/auto/review double Placement, lost-response duplicate audit, and Proposal Catalog write; Green Governance-owned UoW, shared lock order, exact replay, durable refusal, and intent-only acceptance.
6. Red module/latest Binding identity, unpinned ProjectValue, and CAS race; Green composite FK agreement, immutable history, independent-session winner, and no partial audit/pointer.
7. Red #671 R6/R8 merge, R0 Archive-as-success, rerun duplicates, and rollback dump drift; Green full P0-P10 fixture, every failure point, and byte-identical containment.
8. Red raw-repository routes, scope leak, role spoof, partial idempotency conflict, and legacy inference; Green PCAT-API-01..12 over real PG/running HTTP/auth/audit.
9. Red every page state/viewport/interaction and mock/API mismatch; Green PCAT-UI-01..15 browser-real bundle and zero unexpected console/network failures.
10. Red adapter-chosen gates, missing/wrong-purpose/wrong-predecessor report, self approval, pre-report runtime pin, and post-P13 V13/P02-only delta; Green frozen registry, six-purpose chain, complete rerun, distinct approvals, no waiver.
11. Red API migration/sync, guessed resume, partial restore, and early traffic; Green independent controller core, Recovery Point adapter, fresh/populated apply, and recovery-required matrix before integration.
12. Red each of 11 consumers on legacy structure/ID; Green each S12 adapter plus complete D corpus and zero unresolved protected reference; no consumer ticket executes P12-P15.
13. Red RI-01 with any missing consumer/P0-P10/V-D-API-UI/recovery evidence, premature browser, or early traffic; Green exact pre-activation -> P12 -> P13 -> full P11b -> runtime pin -> isolated API/browser -> public report -> P15 chain.
14. Red sunset/delete with missing time/telemetry/dependency/retention; Green only in later S13/S14 production programs with their own passing purpose.

#### Real PostgreSQL and evidence matrix

| Dimension | Fresh | Populated #671 | Rollback/restore | Browser-real | Hosted | Target/release |
| --- | --- | --- | --- | --- | --- | --- |
| Schema/migration | empty DB full chain, M01-M04, roles | pre-candidate schema + exact ledger/fingerprint | failed-phase dump equality; isolated three-store restore | N/A | Linux repeatability | exact target ledger/schema |
| Catalog | bootstrap, zero legacy | formal Driver/NodeType only from release; no subjectless/manual materialization | old/current/pinned head/fingerprint | API-backed read states | artifact/digest repeat | packaged/DB/runtime equality |
| Governance | zero default Registrations | only proved Organization/Subject + one Placement; full evidence/review/proposal | stable IDs through lifecycle/move/recovery | unregistered/register/review/conflict/proposal | contract repeat | same-Organization/kind/lock proof |
| R0-R10 | executed zero-inventory predicate | all fixture classes + full graph | P0 conservation and mapping/Archive checksums | legacy deep links | corpus artifact | non-sampled target inventory |
| Binding/value | no rows absent explicit seed | stable IDs, complete histories, exact pins, mismatch block | current/effective pointer equality | project consumer states | test repeat | exact target protected refs |
| Verification | complete zero-mode V/D | V01-V17 + D01-D09 twice | restore-bound verifier rerun | API-01..12/UI-01..15 | archived runner evidence only | six-purpose chain + accountable approvals |
| Claim limit | real local PG only | populated shape only | local mechanics only | local/target browser exactly as run | Hosted only | target-host, then release/production approval separately |

The locked rehearsal retains `npm run test:scripts -- parameter-catalog-rehearsal.integration` semantics: checked-empty dedicated DB, exact schema ledger, checksum-locked fixture, candidate and verifier transactions, failure after every phase, same-run idempotency, R6/R8 separation, byte-identical dump after rollback, and cleanup marker. It is populated-shape evidence, never target readiness.

Implementation completion requires risk-appropriate focused tests, `npm run test:all`, `npm run build`, OpenAPI/route checks, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:models`, `npm run acceptance:browser`, `npm run acceptance:evidence`, self-host checks, historical-migration inventory, `npm run docs:check`, and `git diff --check`. Local, real-PG, browser, Hosted, target, release, and production approval remain separate observations; none is inferred from another.

## Out of Scope

- This specification branch implements no production TypeScript/React, SQL, migration, API, UI, Catalog YAML, or `upgrade.sh` change. Its only TypeScript changes are non-production acceptance-registry metadata plus static registry tests; those do not exercise or prove application behavior.
- It creates no implementation Issues, does not run `/to-tickets`, opens no PR, and merges/synchronizes no `main`.
- It does not redesign parameter value editing, drafts/review, debugging, DTS reload, or knowledge beyond their canonical identity adapters.
- It permits no Organization structural override, long-lived dual write/read, runtime lazy repair, remote Catalog hot fetch, property alias, or module-as-definition identity.
- It does not treat the #676 DEV prototype as production/browser/release evidence or combine launch with R-L2/R-L3 deletion.

## Further Notes

Current blockers: none among the immutable decisions. Implementation blocks immediately on R0, missing release lineage/history, an untyped protected reference, migration checksum drift, an unprovable Binding/value tip, missing same-boundary Recovery Point, incomplete post-P13 P11, any unexplained/unqueryable D case, reachable writer, or target/report/approval pin mismatch.

Evidence remains classified as documentation/static, local synthetic, real local PostgreSQL, populated-shape, browser, Hosted/CI, real target-host, release, and production approval. This repair creates documentation/static evidence and acceptance-registry metadata-test evidence only: `PCAT-UI-01..15` are non-blocking, all fifteen operations remain `future`, `specFiles` remains empty, and exact future spec ownership is prose in `deferralReason`. It runs no production behavior, PostgreSQL, browser, Hosted, target, or release verification. Issue #676 remains DEV-only decision evidence.

<a id="pcat-spec-documentation"></a>

## Documentation Impact Matrix

`Disposition` is restricted to `Update`, `Review`, or `No change`. This repair updates the bilingual active plan and coverage maps, the acceptance metadata sources/static ratchets, the generated English operation matrix, and its manually synchronized Chinese companion; it does not describe future behavior as implemented.

| Area | Disposition | English paths | Chinese paths | Owner/gate |
| --- | --- | --- | --- | --- |
| Repository maps | Update | `AGENTS.md`; `ARCHITECTURE.md` | `docs/zh-CN/root/AGENTS.md`; `docs/zh-CN/root/ARCHITECTURE.md` | first module merge records four modules/dependencies/readiness |
| Planning | Update | `docs/PLANS.md`; `docs/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md`; later `docs/exec-plans/completed/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md` | `docs/zh-CN/PLANS.md`; `docs/zh-CN/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md`; later `docs/zh-CN/exec-plans/completed/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md` | parent keeps one plan across many tickets |
| Domain/glossary | Update | `CONTEXT.md`; `docs/design-docs/domain-model.md` | `docs/zh-CN/design-docs/domain-model.md` | S0/S2 first model slice; CONTEXT remains implementation-free |
| ADR/index and decisions | Update | `docs/adr/README.md`; `docs/adr/0040-canonical-parameter-catalog-relational-model.md`; `docs/adr/0041-platform-schema-catalog-releases-materialize-before-runtime.md`; `docs/adr/0042-organizations-register-canonical-subjects-once.md`; `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md`; `docs/design-docs/parameter-catalog-api-transition.md`; `docs/design-docs/parameter-catalog-cutover-archive-rollback.md`; `docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | `docs/zh-CN/design-docs/index.md`; `docs/zh-CN/design-docs/adr-0040-canonical-parameter-catalog-relational-model.md`; `docs/zh-CN/design-docs/adr-0041-platform-schema-catalog-releases-materialize-before-runtime.md`; `docs/zh-CN/design-docs/adr-0042-organizations-register-canonical-subjects-once.md`; `docs/zh-CN/design-docs/catalog-kernel-interface-and-transaction-boundary.md`; `docs/zh-CN/design-docs/parameter-catalog-api-transition.md`; `docs/zh-CN/design-docs/parameter-catalog-cutover-archive-rollback.md`; `docs/zh-CN/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | G0; cite immutable SHAs and never rewrite meaning |
| Product specs | Update | `docs/product-specs/index.md`; `docs/product-specs/product-spec.md`; `docs/product-specs/prototype-functional-spec.md` | `docs/zh-CN/product-specs/index.md`; `docs/zh-CN/product-specs/product-spec.md`; `docs/zh-CN/product-specs/prototype-functional-spec.md` | S9 one page, roles, states |
| Architecture/design | Update | `docs/design-docs/index.md`; `docs/design-docs/full-stack-architecture.md`; `docs/design-docs/domain-model.md` | `docs/zh-CN/design-docs/index.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/domain-model.md` | S3/S5/S7/S10 seams |
| API contract/guides | Update | `docs/design-docs/api-contract.md`; `docs/api/README.md`; `docs/api/authentication.md`; `docs/api/errors.md`; `docs/api/examples.md` | `docs/zh-CN/design-docs/api-contract.md`; `docs/zh-CN/api/README.md`; `docs/zh-CN/api/authentication.md`; `docs/zh-CN/api/errors.md`; `docs/zh-CN/api/examples.md` | S8-CON exact route/error/concurrency/legacy |
| Frontend/design | Update | `docs/FRONTEND.md`; `docs/design-docs/ui-design-system.md`; `docs/developer/ui-quality-checklist.md` | `docs/zh-CN/frontend.md`; `docs/zh-CN/design-docs/ui-design-system.md`; `docs/zh-CN/developer/ui-quality-checklist.md` | S9 ports/state/three views/focus |
| Coverage registries | Update | `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; `scripts/check-acceptance-coverage.test.ts`; `scripts/check-acceptance-operation-matrix.test.ts`; `docs/developer/browser-acceptance-coverage-map.md`; generated `docs/developer/user-operation-coverage-matrix.md` | `docs/zh-CN/developer/browser-acceptance-coverage-map.md`; `docs/zh-CN/developer/user-operation-coverage-matrix.md` | this Spec/G0 registers non-blocking/future metadata; S9-BRW later supplies existing specs, changes blocking/automated status, and regenerates evidence |
| Quality/testing | Update | `docs/QUALITY_SCORE.md`; `docs/design-docs/testing-strategy.md`; `docs/developer/verification-matrix.md` | `docs/zh-CN/QUALITY_SCORE.md`; `docs/zh-CN/design-docs/testing-strategy.md`; `docs/zh-CN/developer/verification-matrix.md` | S2/S10/S11/RI evidence hierarchy |
| Security/governance | Update | `docs/SECURITY.md`; `docs/design-docs/security-governance.md`; `docs/security/README.md`; `docs/security/threat-model.md`; `docs/security/data-classification.md`; `docs/security/audit-retention.md`; `docs/security/user-permission-design.md` | `docs/zh-CN/SECURITY.md`; `docs/zh-CN/design-docs/security-governance.md`; `docs/zh-CN/security/README.md`; `docs/zh-CN/security/threat-model.md`; `docs/zh-CN/security/data-classification.md`; `docs/zh-CN/security/audit-retention.md`; `docs/zh-CN/security/user-permission-design.md` | S2/S5/S10 roles/audit/retention/refusal sink |
| Reliability | Update | `docs/RELIABILITY.md`; `docs/design-docs/deployment-operations.md` | `docs/zh-CN/RELIABILITY.md`; `docs/zh-CN/design-docs/deployment-operations.md` | S10/S11 readiness/failure/recovery |
| Runbooks | Update | `docs/runbooks/self-hosted-runtime.md`; `docs/runbooks/backup-restore.md`; `docs/runbooks/rollback.md`; `docs/runbooks/release-rollback.md`; `docs/runbooks/monitoring-alerting.md`; `docs/runbooks/observability-operations.md`; `docs/runbooks/incidents.md`; `docs/runbooks/effective-driver-parameter-catalog-reconciliation.md`; `docs/runbooks/platform-admin-and-schema-promotion.md` | `docs/zh-CN/runbooks/self-hosted-runtime.md`; `docs/zh-CN/runbooks/backup-restore.md`; `docs/zh-CN/runbooks/rollback.md`; `docs/zh-CN/runbooks/release-rollback.md`; `docs/zh-CN/runbooks/monitoring-alerting.md`; `docs/zh-CN/runbooks/observability-operations.md`; `docs/zh-CN/runbooks/incidents.md`; `docs/zh-CN/runbooks/effective-driver-parameter-catalog-reconciliation.md`; `docs/zh-CN/runbooks/platform-admin-and-schema-promotion.md` | S11/RI/S13/S14 phase/restore/sunset and supersession |
| Self-hosted operator docs | Update | `ops/self-hosted/upgrade.md`; `ops/self-hosted/operations.md`; `ops/self-hosted/releases/README.md`; `ops/self-hosted/releases/release-template.md` | `ops/self-hosted/upgrade.zh-CN.md`; `ops/self-hosted/operations.zh-CN.md`; `ops/self-hosted/releases/README.zh-CN.md`; `ops/self-hosted/releases/release-template.zh-CN.md` | S11/RI; same merge as controller |
| Generated artifacts | Update | `docs/generated/openapi.json`; `docs/generated/db-schema.md`; `docs/generated/acceptance-operation-evidence.md`; `docs/generated/acceptance-operation-evidence/index.json` | same language-neutral generated paths: `docs/generated/openapi.json`; `docs/generated/db-schema.md`; `docs/generated/acceptance-operation-evidence.md`; `docs/generated/acceptance-operation-evidence/index.json` | S8-CON/S2 integration/S9-BRW sole owners, exact source SHA |
| Log-analysis API guide | Review | `docs/api/log-analysis-integration.md` | `docs/zh-CN/api/log-analysis-integration.md` | S12-LOG records exact unchanged review or updates |

## Documentation Update Gate

The plan cannot complete until every Update/Review row is updated bilingually or recorded unchanged with exact evidence; glossary and ADR/index agree; OpenAPI, route manifest, errors, browser requirement/operation IDs match the implementation SHA; migration inventory and generated schema match; real-pgvector `npm run docs:check`, links, language links, and `git diff --check` pass; and no deferred item is a release-blocking gate.

### Git & PR Workflow

- The current specification branch is exactly `codex/wayfinder-668-implementation-spec-20260901`; repairs are append-only commits, never amend/rebase/force-push.
- Every future ticket agent starts from then-current `origin/main` in an isolated worktree with branch template `codex/pcat-<issue-number>-<slug>` and reads this Spec plus the owning decisions/module docs.
- This is one plan with many ticket branches. An implementation agent implements/tests/commits only its node, does not open or merge a PR, does not update/push/fast-forward/merge `main`, and does not collapse an entire workstream into one branch.
- The parent/session owner integrates branches under the CD/CF/ID/RE graph and exclusively owns PR creation, merge, and main synchronization.
- Migration/ADR/acceptance IDs are claimed before parallel work and rechecked after rebase. Inherited dirty worktrees are never reset, stashed, cleaned, or checked out.
- Phase A Publisher completed on `codex/wayfinder-668-to-tickets-20260901`; this documentation commit is the Phase A stopping point. Phase B must review/open/merge the docs-only PR, and Phase C must re-audit the exact GitHub and `origin/main` state before S0-ID can receive `ready-for-agent`.
