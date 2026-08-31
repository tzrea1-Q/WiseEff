# ADR-0041: Platform schema catalog releases materialize before runtime

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0041-platform-schema-catalog-releases-materialize-before-runtime.md)

Date: 2026-08-31

## Status

Accepted for [Choose platform schema publication and synchronization semantics](https://github.com/tzrea1-Q/WiseEff/issues/674), a decision ticket in [Wayfinder: replace the parameter catalog with one canonical definition model](https://github.com/tzrea1-Q/WiseEff/issues/668). This record is ADR-0041 and depends on [ADR-0040](0040-canonical-parameter-catalog-relational-model.md) for model authority, stable identity, revision, and transaction rules. This ADR defines destination publication and synchronization semantics; it does not claim that the current loader, database, cache, or upgrade path already implements them.

## Context

The approved destination has one Platform schema catalog as the sole structural truth source. Organizations register and place formal Driver and NodeType subjects but do not author, copy, override, or privately redefine their schemas. Runtime observations are evidence and cannot create a definition.

The current implementation does not satisfy that contract. `schemas/dts/catalog.json` lists YAML inputs, but a content-hash mismatch does not stop loading and missing common references are ignored. Database rows are materialized lazily as project ingest happens, so an untouched schema can be absent from the database. The process cache composes pinned files with Platform and organization overlays. The self-hosted upgrade starts the API, and therefore runs migrations, before checking only the catalog-shaped rows already present in PostgreSQL. The check neither loads the repository catalog nor proves that the database is its complete materialization. These facts are inventoried in [Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) and its [repository note](https://github.com/tzrea1-Q/WiseEff/blob/f982c76a063f3c8bc0a7366d5253243ecba2866f/docs/references/parameter-catalog-contract-inventory.md).

[ADR-0040](0040-canonical-parameter-catalog-relational-model.md) fixes the governing model: Proposal acceptance produces publication intent only; one published immutable Catalog Release is the only input allowed to create catalog truth; and the Catalog Release synchronizer is the sole database materializer of `CatalogSubject`, `ParameterDefinition`, and `DefinitionRevision`. It also requires a new immutable DefinitionRevision for every persisted definition-content change, including documentation.

We need one publication lineage that keeps YAML, database rows, caches, upgrade ordering, rollback, and historical replay consistent without turning any derived copy into a second authority or weakening those rules.

## Decision

### 1. The authoritative input is one immutable Catalog Release bundle

A **Platform Schema Catalog Release** is the only authoritative publication input. It is a repository-reviewed bundle shipped inside the target application artifact. Its manifest root is `schemas/dts/catalog.json` unless a later implementation plan changes only the physical format. The bundle contains or identifies:

- a monotonically ordered catalog release version and its predecessor release digest;
- the exact YAML documents in the release, each with its own content digest;
- the schema and toolchain provenance needed to validate those documents;
- explicit selector aliases, deprecations, retirements, and tombstones; and
- one canonical aggregate digest computed from the normalized release model.

Only manifest-listed content is authoritative. Directory scanning, unlisted files, database content, runtime cache state, remote hot fetches, product forms, and organization data are not catalog inputs. Proposal acceptance writes only an approved publication intent or repository-change reference plus trusted audit. It neither is a Catalog Release nor directly creates or changes a CatalogSubject, ParameterDefinition, DefinitionRevision, or current-release pointer. Publication occurs only when the reviewed repository content is assembled as a new immutable Catalog Release with its own version and digest. Even an emergency correction uses this same path.

CI must fail closed before publication on a missing file or reference, digest mismatch, schema-shape error, duplicate formal identity, stable-ID or natural-key reassignment, non-deterministic normalization, alias conflict, illegal lifecycle transition, invalid predecessor, or a release that cannot preserve required history. It must compile the same release to the same aggregate digest independent of file-system enumeration order. The synchronizer repeats the complete offline validation before opening a materialization transaction; CI success is not trusted as runtime proof.

### 2. Catalog releases and definition revisions are different clocks

Every change to the bundle publishes a new immutable Catalog Release, including definition content, documentation, aliases, deprecation, retirement metadata, or release provenance. An existing release version or digest is never rewritten.

Every persisted content change to one formal definition mints a new immutable **DefinitionRevision**. This includes value shape, constraints, units, schema default, definition-level lifecycle or matching metadata, display text, examples, and documentation-only corrections. Existing revisions are never updated or deleted. A documentation-only revision advances the ParameterDefinition head, but it does not change any Binding `effective_revision_id`, create or replace a Binding, or cut over current or historical ProjectValues. A release-only change that does not alter any persisted definition snapshot, such as release provenance or a subject-selector alias, does not manufacture a DefinitionRevision.

The stable definition identity remains typed formal subject plus permanent property key, with the opaque IDs and relational current-head constraints fixed by [ADR-0040](0040-canonical-parameter-catalog-relational-model.md). Catalog Release and DefinitionRevision are different clocks, but the release is the only source from which the synchronizer may mint a revision.

### 3. Aliases are selector aliases, not alternate identities

A catalog alias maps an external subject selector, such as an old `compatible`, nodename, or vendor identifier, directly to one canonical Driver or NodeType subject. It does not create a second subject or definition. Resolution is one hop. Alias chains, cycles, ambiguous targets, collisions with canonical selectors, and reuse of a previously published alias for another subject are forbidden.

This alias vocabulary excludes both `property_key` aliases and the DTS source-write `targetRef`. A referenced property-key change remains the source-rewriting cutover fixed by ADR-0034; a standing alias must not hide whether project source actually moved.

Deprecation and retirement are distinct:

- **Deprecated** is a soft warning state. The definition remains matchable and replayable so existing and newly observed sources do not abruptly lose parse coverage, but it leaves default governance selection and points operators to a successor.
- **Retired** explicitly removes the selector or definition from current matching. Existing bindings, revisions, audit, and replay remain addressable through pinned history.

Omission from a later manifest never means retirement. Withdrawal requires an explicit tombstone that names the stable identity, prior selectors, last current revision, successor when applicable, and the release that made the transition. A retired subject or definition is unavailable for new matching or selection but retains its stable ID, permanent natural key, revisions, aliases needed for replay, references, and audit. Restore uses the same identity through a later forward release; changed definition content creates another revision.

Physical deletion is not a catalog lifecycle operation. A released subject, definition, revision, alias, tombstone, or release snapshot must not be deleted while any supported lineage, Binding, ProjectValue, observation, match, audit, or replay record can reference it. Storage retirement may archive an immutable verified snapshot, but it cannot make the digest or pinned identity unavailable. Alias and natural-key reuse for a different identity remains forbidden after retirement.

### 4. Derived state has one-way provenance

The destination lineage is:

```text
Catalog Release bundle
  -> canonical compiled model
  -> database materialization
  -> verified current-release pointer
  -> runtime cache
```

PostgreSQL is a queryable materialization, not an authoring source. Only the Catalog Release synchronizer may insert CatalogSubject, ParameterDefinition, or DefinitionRevision rows or advance definition and release heads. Proposal, ingest, review, HTTP, Agent, scripts, and ordinary application services have no parallel materialization path.

A runtime cache is a disposable immutable snapshot of one verified database materialization, keyed by the exact Catalog Release digest. It never independently reparses YAML for business traffic and never composes Platform or organization overlays. A missing cache can be rebuilt from the verified database projection; a missing or unverified materialization cannot be replaced by an empty registry.

The catalog synchronizer owns the complexity behind one narrow upgrade seam. It compiles the release, stages the full materialization, verifies it, and atomically changes the current-release pointer. Callers never coordinate subject creation, row upserts, revision cutover, aliases, tombstones, or cache invalidation themselves. The exact external module interface and transaction ownership remain with [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673).

### 5. Synchronization is explicit, idempotent, and fail closed

Synchronization runs as a one-shot maintenance operation under an exclusive catalog lock. Before any catalog write, validation proves that:

- the release version and aggregate digest are unused or already identify byte-for-byte equivalent normalized content;
- the predecessor and every required skipped-release transition form a supported, gap-free lineage from the installed digest;
- all manifest files, references, per-file digests, schemas, stable opaque IDs, permanent natural keys, complete definition snapshots, aliases, lifecycle transitions, and tombstones are valid;
- each changed persisted definition snapshot maps to exactly one new DefinitionRevision, including documentation-only changes, while unchanged snapshots map to none; and
- every historical release/snapshot required by references or supported replay is present and digest-valid.

After validation:

- When the expected digest already equals the verified current digest, it performs read-only verification and is a no-op.
- A fresh database requires an explicit bootstrap mode.
- An installed release may advance only when it is a declared supported ancestor of the target. The target artifact must carry the complete lineage needed to cross every supported skipped application release deterministically.
- The release row, subjects, definitions, exactly required revisions, aliases, tombstones, materialization fingerprint, and current pointers commit as one atomic domain transaction. Any error leaves the previous verified release and every previous definition head unchanged, with no partial candidate catalog visible.
- Stable keys and content digests make retries idempotent. Retrying the same known transition after success is a verified no-op; retrying after failure produces the same complete result or the same rejection, never duplicate revisions.
- Missing or malformed source content fails before any database write.
- Unexpected database rows, changed materialized content, an unknown installed digest, or a release outside the declared lineage is **catalog drift**. Drift stops the upgrade; the synchronizer does not silently overwrite, infer, or delete it.

Absence is never interpreted as an empty catalog or an implicit delete. Materialization changes only through additions, successor revisions, aliases, lifecycle transitions, and explicit tombstones declared by a release. Failed-attempt evidence and trusted audit may be recorded durably outside the failed domain transaction, but it cannot look like a partially published release.

### 6. Upgrade synchronization and verification precede application startup

Self-hosted install and upgrade use the following order:

1. build the target artifact and validate its Catalog Release offline;
2. quiesce traffic and queues, then create and verify a recovery point;
3. start the data plane;
4. run database migrations as a one-shot candidate operation;
5. run catalog synchronization as a separate one-shot candidate operation;
6. run independent catalog synchronization verification;
7. only then start API, worker, and web processes;
8. require readiness to prove that each process expects the database's verified current digest before queues and public traffic resume.

An ordinary process restart verifies only. API and worker startup never migrates or synchronizes catalog state. A process whose packaged digest differs from the verified current digest exits or remains not-ready; it does not self-heal the database.

The independent synchronization verification recomputes the normalized release and database fingerprints through a read-only path distinct from the writer. It proves that the bundle and lineage are valid, every published object materialized exactly once, all Definition heads agree with the release, documentation-only revisions left Binding/ProjectValue cutover state unchanged, aliases and tombstones agree, the current pointer names a complete verified release, no organization-owned catalog object exists, and the runtime cache can be built from that release. Project-binding, HTTP, browser, observability, self-hosted end-to-end, and final legacy-deletion acceptance remain with [Choose verification, upgrade, and legacy-retirement gates](https://github.com/tzrea1-Q/WiseEff/issues/679).

### 7. Failure, rollback, and history never rewrite publication truth

Before the current pointer switches, a failed synchronization leaves zero catalog-domain changes and the previous verified release current. After the pointer switches but before public traffic or candidate business writes, an operator may switch back only when independent verification proves that the previous snapshot is intact, the database migrations remain compatible, and no candidate write occurred; otherwise the recorded recovery point is restored. Once candidate business writes or public traffic occurred, a pointer-only rollback is forbidden. Operational data recovery follows [Choose populated-data cutover, archive, and rollback strategy](https://github.com/tzrea1-Q/WiseEff/issues/678).

A business-level catalog rollback is a new forward Catalog Release. It may restore content from an older release, but it receives a new version and digest. Failed releases, materialization attempts, and audits are retained rather than deleted.

Historical business values pin their exact DefinitionRevision. Ingest, matching, alias resolution, and governance evidence also record the Catalog Release digest that produced the decision. Replaying the already-current digest is a verified no-op. A retained older release may be deterministically materialized into a fresh or isolated read-only replay projection, or loaded as its immutable normalized snapshot by digest; it never advances the production current pointer backward. Current aliases, lifecycle, documentation, or revisions never reinterpret history. Production replay cannot depend only on Git history or a network fetch. If a required historical release is absent, outside its recorded lineage, or digest-invalid, replay fails closed.

### 8. Organization structural writes are impossible in steady state

The destination removes the ability to represent an organization-authored schema or definition override across every writable layer:

- the catalog relational model has no organization owner or scope for structural definitions;
- the catalog module interface exposes no organization structural mutation;
- HTTP, Agent, review-apply, coverage-claim, script, and background paths cannot create organization catalog objects;
- legacy overlay and organization-definition relations are read-only to production roles and reject new writes at the database layer;
- only a dedicated maintenance migration principal may classify, map, or archive legacy rows during the bounded cutover, with durable audit; and
- synchronization verification requires zero new organization structural rows after the cutover boundary, while runtime cache identity contains no organization key, overlay digest, or precedence rule.

Organizations may submit observations, review evidence, or repository change proposals. They cannot publish schema. Exact route retirement responses and compatibility windows remain with [Choose the parameter API and legacy-identifier transition](https://github.com/tzrea1-Q/WiseEff/issues/677).

## Required verification scenarios

The implementation specification must automate at least these scenarios against real PostgreSQL where database state is involved. Each failure assertion checks both the current Catalog Release pointer and all Definition heads for non-change.

| Area                   | Required scenario and expected result                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication authority  | Accepting a Proposal writes publication intent and trusted audit only; CatalogSubject, ParameterDefinition, DefinitionRevision, and release-head row counts and pointers remain unchanged, and the proposal role cannot mutate them.                 |
| Release validation     | Missing/unlisted files, bad file or aggregate digests, duplicate identities, stable-ID/natural-key reassignment, alias conflict, illegal lifecycle/tombstone transition, and a lineage gap all fail before catalog writes.                           |
| Revision completeness  | Each persisted definition-content delta, including documentation, creates exactly one immutable DefinitionRevision and advances only that Definition head; unchanged definitions create none.                                                        |
| Documentation-only     | A documentation-only revision advances the Definition head while Binding IDs/count, `effective_revision_id`, current ProjectValue, and all historical ProjectValues remain byte-for-byte unchanged.                                                  |
| Idempotency            | Re-running the verified current digest is a read-only no-op; retrying a failed known transition creates no duplicates and either commits the one complete target or repeats the same rejection.                                                      |
| Failure atomicity      | Injected failure after staging any release component but before commit leaves no candidate subjects/definitions/revisions/aliases/tombstones visible and leaves all prior release and Definition heads unchanged.                                    |
| Drift                  | An unknown installed digest, mutated materialized row, unexpected catalog row, or compiled-model/database fingerprint mismatch blocks synchronization and startup without silent repair or empty fallback.                                           |
| Retirement and restore | Omission without a tombstone fails; explicit retirement stops new matching while stable IDs, natural keys, revisions, aliases needed for replay, references, and audit remain; restore reuses the same identity through a later release.             |
| Historical replay      | A retained older release reproduces its exact normalized snapshot and decisions in an isolated replay projection without changing production heads; missing or digest-invalid history fails closed.                                                  |
| Rollback               | Pre-traffic switch-back succeeds only with zero candidate writes and verified compatible prior state; after candidate writes/traffic it is rejected, while a new forward release or recovery-point restore remains available.                        |
| Upgrade/readiness      | API, worker, and web do not start until one-shot synchronization and independent verification pass; ordinary restart verifies digest equality only and never synchronizes.                                                                           |
| Overlay prohibition    | HTTP, Agent, review, coverage, script, background, and ordinary database roles cannot create organization structural definitions/overlays; zero such rows appear after the cutover boundary and cache keys contain no organization precedence input. |

## Considered options

- **Let PostgreSQL or a Platform Admin UI author the catalog.** Rejected because it creates a second structural truth, loses repository review and deterministic self-hosted provenance, and permits instances to diverge.
- **Keep lazy ingest materialization and repair missing rows at runtime.** Rejected because an untouched schema can vanish from database verification, traffic observes partial state, and a warm cache can disagree with stored history.
- **Treat directory absence as deletion.** Rejected because a packaging error would silently empty or shrink the effective catalog. Retirement must be an explicit reviewed act.
- **Apply current aliases while replaying history.** Rejected because it changes the identity decision that an old observation actually saw.
- **Retain organization overlays behind lower precedence.** Rejected because precedence still leaves two structural truth sources and keeps organization-authored definitions writable.
- **Roll the current pointer backward after traffic.** Rejected because current business writes may already depend on the successor revision or selector semantics; recovery must restore data and catalog consistently.

## Consequences

- The destination supersedes ADR-0008 and ADR-0009's organization-overlay publication model. Those ADRs continue to describe legacy runtime behavior until the bounded cutover removes it; this decision is not permission to delete or bypass migration evidence early.
- ADR-0011's soft-deprecation safety remains, while explicit retirement becomes a separate forward-matching withdrawal with retained history.
- ADR-0040 supersedes any reading of ADR-0032 that permits in-place documentation mutation: documentation changes create a DefinitionRevision and advance the Definition head, but they do not manufacture a Binding or ProjectValue cutover.
- Catalog compilation, materialization, current-pointer selection, and cache construction become one deep module rather than coordination repeated in ingest, startup, scripts, and overlay services.
- Implementation must replace current silent loader fallback, lazy materialization, per-organization registry composition, API-start migration, and post-start database-only catalog check. This ADR contains no code or migration implementation.
