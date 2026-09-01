# Wayfinder specification draft: canonical parameter catalog replacement (#668)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md)

Status: **Complete draft awaiting parent-session review**. Implementation, `/to-tickets`, pull requests, and merges are blocked until the owner confirms the module seams, implementation/ticket granularity, and dependency edges.

Base: `origin/main@406c23bcaf0dcfca284de3135e27bfcd19c29c4e`. This is a target contract. It does not claim current implementation or release evidence, reserve a migration number, or authorize production activation.

## Problem Statement

The current parameter catalog distributes one property contract across `parameter_specs`, versions, attribution subjects, DriverSchema, Organization overlays, modules, review work, Bindings, and history. An Organization draft, subjectless DTS surface, schema root, proposal, or historical row can appear to be a second current definition. Lazy ingest, overlay precedence, current flags, module attribution, and implicit head selection create several structural authorities.

The replacement must finish in one bounded maintenance window. A repository-reviewed immutable Platform Catalog Release is the only structural source; PostgreSQL is its verified projection. Organizations register and place formal Subjects. Observation, ReviewEvidence, Proposal, Binding, and ProjectValue retain separate evidence and business responsibilities and never materialize Catalog truth. The cutover preserves provable stable IDs, complete history, and audit, fails closed on unknown or ambiguous evidence, and separates real PostgreSQL, real candidate API, browser-real, target-host, release, and approval evidence.

### Immutable decision inputs

This specification consumes, without reinterpretation, issue #669 at `f982c76a063f3c8bc0a7366d5253243ecba2866f`, #670 at `000f617ba9810adda4798b4bc4b2bdfed95b4c39`, #671 at `6c3adfc35c0e3be6d5d381013dace9408190380e`, #672 at `542c7a8bbce3bd6bb230b0d020d23d10af5182a9`, #674 at `bef06b341499e99fadddda7cf3db463c01511d55`, #675 at `9fe269d4facc31b49fc1e0535d2d51ba7140644b`, #676 DEV-only evidence at `9c803557a55803ccca79c20eadd033f57d4729e0`, #673 at `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb`, #677 at `c6c08e6e6f208f88160bdbcc610eec9f8e516cc3`, #678 at `1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d`, and #679 at `465c07ed60ca7fa6b7b2ff2f2559e8ccf504af9f`.

No unresolved product conflict was found among those inputs. Issue #679 explicitly repairs the earlier #678 evidence cycle: after P13, a new attempt reruns the complete V01-V17 and D01-D09 set; real API/browser evidence is produced only after the approved post-retirement runtime pin. Differences from current ADRs and schema are migration inputs: Organization overlays/shadow subjects/definition overrides, in-place documentation edits, and eager whole-catalog Organization placement are superseded target contracts, not blockers.

## Solution

Use four deep modules and one-directional business modules. Catalog Kernel exclusively owns release compilation, materialization, exact snapshots, and materialization verification. Release Verification exclusively owns purpose, plan, attempt, report, approval, evidence lineage, and runtime pins. Catalog Cutover exclusively owns P0-P16, R0-R10, typed mapping, Archive, checkpoints, and recovery. Subject Governance, Evidence/Review, Proposal, and Binding/ProjectValue each own their aggregate transactions. HTTP, frontend, and `upgrade.sh` are adapters and cannot coordinate internal transactions, select Definition heads, infer legacy dispositions, or waive gates.

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

### Module boundaries and dependency direction

| Module | Owns | Public seam | Must not own |
| --- | --- | --- | --- |
| Catalog source/publication | immutable bundle, manifest/YAML, explicit stable IDs, CI compiler output | artifact | current DB pointer, Organization state, runtime repair |
| Catalog Kernel | compile, validate, install, pre-traffic switch-back, current/pinned snapshots, matching, revision history, materialization verification/cache | role-shaped Kernel facets | routes, Registration, Proposal, Observation, Binding, approval |
| Subject Governance | Registration lifecycle and exactly-one Placement | queries and commands | Subject/Definition creation, matcher, Binding identity |
| Evidence and Review | immutable Observation/ReviewEvidence and ReviewItem grouping/resolution | ingest/query/resolve | Catalog materialization or weak-evidence binding |
| Definition Proposal | proposal revisions and workflow, publication intent | proposal query/commands | Definition/Revision writes |
| Binding and ProjectValue | canonical Binding, revision/value CAS pointers, immutable values/history | binding/value query/commands | Definition head selection or module identity |
| Legacy Mapping and Archive | typed identities, append-only mapping versions/heads, Archive metadata/object references | exact compat/operator lookup | reclassification or public Archive enumeration |
| Catalog Cutover | P0-P16, R0-R10, locks, checkpoints, mapping, Archive, P12/P13, recovery | four maintenance operations | Kernel internals and approval |
| Release Verification | registry, plan/attempt/report, lineage, purpose approvals, runtime pin, retention | five semantic operations plus private readiness projection | repair, migration, synchronization, traffic writes |
| API/application composers | auth, scope, DTOs, idempotency adapter, composed reads | canonical HTTP | raw Catalog repositories and policy inference |
| Parameter definitions frontend | URL state, one-page UI, ports, reconfirmation | application ports | durable rules or raw diagnostics |
| Self-hosted upgrade adapter | host/data-plane/journal/queue/proxy/process adapters | Cutover and Verification calls | selecting gates or starting API to migrate |

Allowed dependencies are `artifact -> Kernel`; `HTTP -> Kernel runtime + owning business modules`; `frontend -> ports -> HTTP`; `Evidence/Registration/Binding/Proposal -> nominal Catalog IDs + captured snapshot`; `Cutover -> Kernel maintainer/verifier + migration ports + mapping/archive + recovery`; `Release Verification -> read-only evidence adapters`; and `upgrade controller -> Cutover + Release Verification`. Static ratchets reject all reverse edges, cross-module open transactions, raw Catalog-table routes, verifier-to-writer calls, module-based Binding identity, and latest-head inference.

### Catalog Kernel contract

The fixed operations are `compilePublishedRelease`, `installPublishedRelease(bootstrap|advance)`, `switchBackBeforeTraffic`, `verifyCurrentMaterialization`, `loadCurrentCatalog`, and `loadPinnedCatalog`. `CatalogRuntime` exposes only load operations; `CatalogMaintainer` compile/install/switch-back; `CatalogVerifier` compile/verify/pinned load.

Snapshots are immutable and expose typed Subject get/list/resolve, Definition stable-key/opaque-ID get/list, exact Revision get/list, and Catalog publication timeline. Results distinguish found, unknown, ambiguous, retired, not-published, and revision-unavailable. Kernel owns one-hop aliases, Driver-first/NodeType-fallback matching, lifecycle/head selection, stable order/cursors, pre-page authorized selection intersection, and release fingerprints. It installs under one advisory lock and transaction, rechecks lineage/idempotency, stages the whole projection, forces deferred constraints, records exact release heads, atomically advances Definition heads and the current pointer, and commits success audit/materialization evidence. Same verified digest is a read-only no-op; conflicting bytes are drift/digest conflict. Cache keys include exact release identity/fingerprint and rebuild only from verified DB projection.

### Release Verification contract

The fixed operations are `prepareVerification`, `runVerification`, `assembleReport`, `approveReport`, and `readReport`. A private `readApprovedRuntimePin` returns only the latest passing and approved post-retirement-runtime report for the exact P13 state. Startup cannot prepare, execute, approve, synchronize, migrate, or repair.

Purposes are closed: pre-activation, post-retirement-runtime, isolated-candidate-acceptance, public-release, legacy-read-sunset, and p16-cleanup. Plans pin artifact/images, Catalog, migration ledger, cutover, mapping/Archive, Recovery Point, acceptance, target, verifier, and purpose lineage. Attempts and reports are append-only. Every applicable gate appears once as passed, failed, not-yet-executable, or registry-proved not-applicable. There is no waiver. Operator and Platform-owner approvals are distinct principals and purpose-specific; verifier signatures are not approvals.

### Canonical PostgreSQL model

The physical contract uses:

- immutable `catalog_releases`; Platform-only `catalog_subjects` with disjoint Driver/NodeType subtype; immutable complete `catalog_release_subjects`;
- permanent `catalog_subject_aliases` and complete immutable `catalog_release_subject_aliases`;
- singleton `catalog_state`; stable `parameter_definitions`; immutable `definition_revisions`; exact `catalog_release_definition_heads`; append-only materialization evidence;
- `organization_subject_registrations` with non-null current Placement and permanent `(organization,subject)` uniqueness; `subject_placements` with unique registration and Organization module;
- immutable `parameter_observations`, at-most-one accepted observation match, immutable ReviewEvidence, mutable ETag ReviewItems plus immutable resolutions;
- DefinitionProposals with immutable revisions and publication intents that carry no Catalog mutation pointer;
- canonical `project_parameter_bindings` unique by project/logical-node/Definition, non-null effective revision, explicit current value, no module identity; immutable `project_parameter_values` and history;
- immutable legacy identities, append-only mapping versions, CAS mapping heads, immutable Archive metadata/object references;
- append-only cutover runs/events/checkpoints, comparison corpus/results, verification plans/attempts/gate results/reports/evidence/approvals/runtime pins, and immutable rollback closure.

Composite and deferred foreign keys prove Definition/head ownership, release completeness, subtype xor, Registration/Placement exactly-one ownership, same-Organization placement, kind-correct placement, Binding registration/subject/Definition/revision agreement, and ProjectValue exact revision ownership. All protected domain history uses restricted deletion. Catalog tables are owned by a non-login owner; the synchronizer receives insert plus column-limited pointer/head updates only; application/proposal/verifier roles cannot mutate immutable Catalog state or assume writer roles.

### Aggregate state machines and transactions

- Catalog installation is uninstalled -> bootstrap -> advance*. Business rollback is a forward release. Pointer switch-back is only pre-traffic with zero business writes, compatible migrations, and verified previous projection/head map.
- Registration is unregistered -> active -> retired -> active. Explicit registration requires an Org Admin, current release anchor, and explicit PlacementIntent. System auto-registration requires one authoritative active match; Agent cannot write; observation cannot auto-restore.
- Observation is immutable. ReviewItems move open -> resolved/out-of-scope using only register-subject, restore-registration, mark-out-of-scope, or open-definition-proposal. Choosing a Subject creates no Definition, Revision, or Binding.
- Proposal is draft -> submitted -> accepted/rejected, with draft/submitted -> withdrawn. Acceptance requires a different Platform Admin and creates intent/audit only.
- Binding recognition validates one captured release, active Registration, Definition, exact revision, and all owners. Semantic cutover CASes the effective revision; documentation-only heads do not. Value change locks the Binding/value head, validates against effective revision, appends one immutable ProjectValue, CASes current value, and audits atomically.
- Successful domain writes and success audit commit together. Refusal evidence uses a pool-owned durable sink. Trusted invocation is server-owned and never body/header asserted.

### Publication, API, frontend, and legacy transition

The bundle contains exact release/predecessor identity, manifest-listed YAML and file digests, explicit stable IDs, complete Subject/alias memberships, selector/tombstone provenance, complete Definition snapshots, schema/toolchain provenance, and aggregate digest. Any missing/unlisted file, digest mismatch, duplicate/reassigned identity, alias conflict, illegal lifecycle/tombstone, non-determinism, or lineage gap fails before writes. Every bundle change creates a release; only changed persisted Definition content creates a Revision, including documentation. One-hop Subject aliases are allowed; property aliases/chains/cycles are not.

Canonical responses include `X-WiseEff-Catalog-Release`; mutable Organization/proposal resources use ETag/If-Match; governance writes use Idempotency-Key. The route set covers the Catalog document, Subject/Definition/revision/timeline reads, Organization Registration lifecycle/Placement, Observation/Review, Proposal, exact typed legacy resolver, canonical project Binding/history/drafts, and operator-only diagnostics. All nine Catalog read routes close through the typed Kernel facet. Stable error reasons and HTTP codes are exactly those fixed by issue #677.

The only UI entry is `/parameter-admin/specs`. It provides Subject/Placement navigation, Definition list/detail, same-page Review Queue, revision/audit timeline, and ready/unregistered/empty/loading/error/retired/conflict states. It preserves opaque URL selection and release anchors. Desktop 1440x900, tablet 768x1024, and mobile 390x844 use one information architecture. Frontend ports separate CatalogRead, SubjectGovernance, ReviewQueue, DefinitionProposal, DefinitionTimeline, and LegacyLink. HTTP and mock adapters have identical state/authority semantics. Issue #676 is DEV-only decision evidence and is never implementation or release proof.

At canonical launch every legacy structural mutation, overlay, and promotion write returns 410. Eligible exact reads remain for at least the later of two production releases and 90 days and until every deployment class has 30 consecutive zero-use days plus all exit gates. The resolver allow-list and mapped/archived/ambiguous/unknown behavior are fixed by #677 and can never reclassify R0-R10.

### P0-P16 and release chain

P0 inventories exact inputs. P1 validates/builds offline. P2 quiesces proxy, queue, services, DB writers, and jobs. P3 captures and verifies a same-boundary PostgreSQL/object-store/Redis Recovery Point. P4 runs one-shot append-only schema migration. P5 installs the immutable Catalog. P6 classifies R0-R10. P7 creates typed mapping versions/heads. P8 migrates only evidence-backed Registration/Placement. P9 preserves complete Binding/ProjectValue/history and explicit tips. P10 creates immutable Archive. P11a runs the complete initial V01-V17, migration/privilege gates, and D01-D09. P12 CASes the application read pointer bound to the approved pre-activation report. P13 permanently retires all legacy writers. P11b creates a new attempt and fully reruns V01-V17 and D01-D09, including V13/P02, then publishes the approved runtime pin. P14 starts API verify-only, then isolated worker/web, executes exact-target API/browser acceptance, assembles/approves the public-release report, and only then resumes queue, proxy, and public traffic. P15 observes the declared period and workload cycle. P16 is a separate cleanup release and purpose.

R0 blocks; R1 archives; R2 maps only to an independently published Subject plus Archive; R3 becomes ReviewEvidence; R4/R5 exact-map to Driver/NodeType Definition and Revision; R6 becomes ReviewEvidence plus Archive; R7 Archive plus policy-review reason; R8 DefinitionProposal; R9 same-kind immutable history; R10 unresolved Archive and blocks when a protected consumer needs an operational target.

Pointer-only rollback closes permanently on the earliest candidate business mutation, queue delivery, or accepted public business request. Before that boundary, switch-back still requires exact compatibility and zero-write proof. Afterwards recovery is forward repair or incident-approved whole-state restore of PostgreSQL, configured object storage, and Redis from one manifest; partial restore is unsupported.

### Gate registry, observability, retention, and retirement

V01-V17 cover duplicate current identity, head cardinality, owner scope, active membership, Placement cardinality, Binding agreement, ProjectValue pins, protected ID mapping, source conservation, R6/R8 separation, Archive integrity, materialization drift, writer reachability, Binding-tip conservation, audit continuity, zero Organization structural Catalog, and exact fresh/populated mode. M01-M04 cover migration package/applied-file/suffix-alias/one-shot result. P01/P02 are real-PostgreSQL privilege negatives.

D01-D09 cover Definitions, Subject identity, Registration/Placement, Binding/history, ProjectValue pin, Review/Proposal/Observation, protected consumer references, source/writeback, and legacy/operator outcomes. Unexplained and unqueryable/protected-reference-missing counts are zero; expected differences carry exact R class, mapping head, typed target/Archive, rule, and plan pin; all 11 consumer families are covered.

PCAT-API-01-12 and PCAT-UI-01-15 are all blocking. Browser evidence uses the real candidate API, all three viewports, snapshot and screenshot, console/page/request/critical-response checks, network summaries, real interactions, and immutable artifact/report/release/target pins. Fresh runs prove zero legacy inventory through executed zero-corpus predicates; populated runs are complete and non-sampled.

Stable failure families are `PCAT-ART|MIG|SCHEMA|SYNC|CLASS|MAP|REG|BIND|ARCH|VRF|CMP|API|AUTH|UI|UPG|WRITER|RP|RESTORE|RET-*`. Metrics use bounded labels and never entity/property/value/person identifiers. Structured logs and audit carry trace, target/release/run/attempt/report/gate/phase/stable code and redacted evidence references. Reports exclude raw values, DTS, Archive payloads, credentials, and person data. Retention is the latest legal/audit hold, protected/business/Archive/mapping need, cleanup-plus-one-year, last restore/compatibility-plus-one-year, and completed public legacy window; failed/interrupted attempts remain at least one year.

R-L0 is P13 writer retirement, R-L1 read-only observation, R-L2 approved public read sunset, and R-L3/P16 cleanup. Cleanup requires two releases, 90 days, every deployment class at 30 zero-use days, complete consumer disposition, zero unresolved protected/ambiguous operational references, target mapping/Archive restore proof, zero writer/read/dependency, full fresh/populated/API/browser/observability/rollback evidence, its own Recovery Point and target restore, explicit old-binary behavior, distinct approvals, and retention/legal-hold proof. It never deletes Audit, Archive, mapping history, Catalog history, revisions, Bindings, ProjectValues, Proposals, Observations, or ReviewEvidence merely because they are not current.

### Migration numbering and immutable history

Current main ends at `0136`; this draft reserves no number. Every implementation slice fetches current `origin/main`, enumerates package filenames/checksums and the applied ledger, and takes the next unique contiguous prefix at that time. A collision may content-preserving-renumber only an unapplied branch migration. Applied filenames/bytes are never edited, removed, or recreated with different bytes; repairs are append-only. Historical aliasing requires one explicit append-only alias ledger. M01-M04 execute before/after one-shot migration, and API startup proves it applied none. Fresh, supported-floor upgrade, populated fixture, COMMIT/deferred constraints, and independent-session concurrency are mandatory. Generated schema and `docs:check` use a real pgvector PostgreSQL path.

### Implementation slices and dependency graph

S0 contract/gate/fixture ratchets precedes S1 bundle compiler and S2 schema/roles; S1+S2 enable S3 Catalog Kernel. S3 enables parallel S4 Registration/Placement and S5 Observation/Review/Proposal; S3+S4 enable S6 Binding/ProjectValue. S2-S6 converge in S7 mapping/Archive/Cutover P0-P10. S3-S6 enable S8 canonical API/legacy resolver, which enables S9 one-page frontend and consumers. S7-S9 converge in S10 Release Verification/evidence, then S11 self-hosted controller/recovery. S8-S11 converge in S12 all 11 consumer cutovers and P12-P15. S12 enables later S13 R-L2 sunset, then S14 P16 cleanup.

Future ticket granularity should be one public seam or independently verifiable vertical contract, not one file/table. No issues are created until the parent confirms these seams, the S0-S14 granularity, and the dependency graph.

## Testing Decisions

Tests use production public seams or controlled adapters to the same production port. Direct Catalog-table insertion, private repository tests as acceptance, test-only materializers, mock-only governance, API-startup migrations, and manual repair do not satisfy acceptance. Pure/fake adapters cover deterministic failures; transactions, roles, constraints, concurrency, cutover, audit, and verification use real PostgreSQL.

TDD proceeds Red -> Green through: static legacy/raw-read ratchets; deterministic malformed/valid release compilation; real-PG deferred constraints/roles/failure injection; Kernel bootstrap/advance/replay/cache; separate Proposal/Evidence/Registration aggregate boundaries; Binding/ProjectValue exact pins and CAS; #671 R0-R10/mapping/Archive/failure/idempotency/rollback; API contract+PG+running HTTP+auth+audit; one-page mock/API parity and browser-real; six-purpose report chain and complete post-P13 rerun; upgrade fresh/populated/restore/unknown-outcome guards; all 11 consumer families; and finally sunset/P16 fail-closed gates.

The locked populated rehearsal retains `npm run test:scripts -- parameter-catalog-rehearsal.integration` semantics: checked-empty dedicated DB, exact schema ledger, checksum-locked fixture, candidate and verifier, failure after each phase, same-run idempotency, R6/R8 separation, and byte-identical canonical dump after rollback containment. It proves populated shape only, not target readiness.

The acceptance matrix includes fresh, populated, rollback/restore, browser-real, Hosted/CI, real target-host, release, and production approval as separate columns. Focused tests, `npm run test:all`, `npm run build`, OpenAPI/route checks, acceptance coverage/operations/models/browser, self-host checks, migration-history checks, `npm run docs:check`, and `git diff --check` are local gates. Hosted, target, release, and approval results must be recorded where executed and cannot be inferred from local green.

## Out of Scope

- This specification branch implements no production TypeScript/React, SQL, migration, API, UI, Catalog YAML, or `upgrade.sh` change.
- It creates no implementation Issues, does not run `/to-tickets`, opens no PR, and merges/synchronizes no `main`.
- It does not redesign parameter value editing, drafts/review, debugging, DTS reload, or knowledge beyond their canonical identity adapters.
- It permits no Organization structural override, long-lived dual write/read, runtime lazy repair, remote Catalog hot fetch, property alias, or module-as-definition identity.
- It does not treat the #676 DEV prototype as production/browser/release evidence or combine launch with R-L2/R-L3 deletion.

## Further Notes

Current blockers: none among the immutable decisions. Implementation blocks immediately on R0, missing release lineage/history, an untyped protected reference, migration checksum drift, an unprovable Binding/value tip, missing same-boundary Recovery Point, incomplete post-P13 P11, any unexplained/unqueryable D case, reachable writer, or target/report/approval pin mismatch.

Evidence remains classified as documentation/static, local synthetic, real local PostgreSQL, populated-shape, browser, Hosted/CI, real target-host, release, and production approval. This draft creates documentation evidence only. It runs no production behavior, PostgreSQL, browser, Hosted, target, or release verification. Issue #676 remains DEV-only decision evidence.

## Documentation Impact Matrix

| Area | Disposition | Exact paths / gate |
| --- | --- | --- |
| Repository maps | Update with implementation | `AGENTS.md`, `ARCHITECTURE.md` and Chinese companions |
| Planning | Update now/review later | this bilingual active plan; `docs/PLANS.md`, `docs/zh-CN/PLANS.md`; later completed/tech-debt moves |
| Domain/glossary | Update with model slice | `CONTEXT.md`, domain model and Chinese companion |
| ADR/index | Update before implementation merge | ADR index and bilingual ADR-0040/41/42; mark supersession without rewriting history |
| Product/UI specs | Update with UI slice | bilingual product spec and prototype functional spec |
| Architecture | Update | bilingual full-stack architecture, domain model, design index |
| API | Update atomically | bilingual API contract/guides, OpenAPI artifact, route manifest, error registry |
| Frontend/design | Update with S9 | bilingual FRONTEND, UI design system, UI quality checklist |
| Quality/testing | Update before P12 | bilingual QUALITY, testing strategy, verification matrix, browser coverage and operation matrix |
| Security/governance | Update with roles/audit | bilingual SECURITY, threat model, data classification, audit retention, permissions |
| Reliability/runbooks | Update with S11 | bilingual RELIABILITY, self-hosted, backup/restore, rollback, release, monitoring, incidents |
| Self-hosted operator docs | Update with S11 | bilingual `ops/self-hosted/upgrade.md`, operations, release template |
| Generated schema | Update after migrations | `docs/generated/db-schema.md` from exact migrations on real pgvector PostgreSQL |
| Immutable decision docs | Land/review | preserve #669-#679 SHA citations; do not silently replace their evidence |
| External compatibility | Update before launch | deprecation/sunset, import/export, deep-link, operator-diagnostics docs |

## Documentation Update Gate

The plan cannot complete until every Update/Review row is updated bilingually or recorded unchanged with exact evidence; glossary and ADR/index agree; OpenAPI, route manifest, errors, browser requirement/operation IDs match the implementation SHA; migration inventory and generated schema match; real-pgvector `npm run docs:check`, links, language links, and `git diff --check` pass; and no deferred item is a release-blocking gate.

### Git & PR Workflow

Each future implementation agent starts from then-current `origin/main` in an isolated worktree and `codex/` feature branch, reads this specification and the owning decisions, implements/tests/commits only on that branch, and never opens/merges a PR or updates `main`. The parent/session owner reviews exact diffs and evidence, owns integration/PR/merge/main synchronization, and rechecks migration/ADR/acceptance IDs after every rebase. Inherited dirty worktrees remain untouched. This draft remains paused pending seam, granularity, and dependency confirmation.
