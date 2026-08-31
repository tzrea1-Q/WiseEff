# ADR-0040: Platform schema catalog releases materialize before runtime

> Chinese companion: [中文决策记录](../zh-CN/design-docs/adr-0040-platform-schema-catalog-releases-materialize-before-runtime.md)

Date: 2026-08-31

## Status

Accepted for [Choose platform schema publication and synchronization semantics](https://github.com/tzrea1-Q/WiseEff/issues/674), a decision ticket in [Wayfinder: replace the parameter catalog with one canonical definition model](https://github.com/tzrea1-Q/WiseEff/issues/668). This ADR defines the destination semantics; it does not claim that the current loader, database, cache, or upgrade path already implements them.

## Context

The approved destination has one Platform schema catalog as the sole structural truth source. Organizations register and place formal Driver and NodeType subjects but do not author, copy, override, or privately redefine their schemas. Runtime observations are evidence and cannot create a definition.

The current implementation does not satisfy that contract. `schemas/dts/catalog.json` lists YAML inputs, but a content-hash mismatch does not stop loading and missing common references are ignored. Database rows are materialized lazily as project ingest happens, so an untouched schema can be absent from the database. The process cache composes pinned files with Platform and organization overlays. The self-hosted upgrade starts the API, and therefore runs migrations, before checking only the catalog-shaped rows already present in PostgreSQL. The check neither loads the repository catalog nor proves that the database is its complete materialization. These facts are inventoried in [Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) and its [repository note](https://github.com/tzrea1-Q/WiseEff/blob/f982c76a063f3c8bc0a7366d5253243ecba2866f/docs/references/parameter-catalog-contract-inventory.md).

We need one publication lineage that keeps YAML, database rows, caches, upgrade ordering, rollback, and historical replay consistent without turning any derived copy into a second authority.

## Decision

### 1. The authoritative input is one immutable Catalog Release bundle

A **Platform Schema Catalog Release** is the only authoritative publication input. It is a repository-reviewed bundle shipped inside the target application artifact. Its manifest root is `schemas/dts/catalog.json` unless a later implementation plan changes only the physical format. The bundle contains or identifies:

- a monotonically ordered catalog release version and its predecessor release digest;
- the exact YAML documents in the release, each with its own content digest;
- the schema and toolchain provenance needed to validate those documents;
- explicit selector aliases, deprecations, retirements, and tombstones; and
- one canonical aggregate digest computed from the normalized release model.

Only manifest-listed content is authoritative. Directory scanning, unlisted files, database content, runtime cache state, remote hot fetches, product forms, and organization data are not catalog inputs. A database or product workflow may store review evidence or a proposed repository change, but it cannot publish structural truth. Even an emergency correction publishes a new Catalog Release through the same governed path.

CI must fail closed before publication on a missing file or reference, digest mismatch, schema-shape error, duplicate formal identity, non-deterministic normalization, alias conflict, or illegal lifecycle transition. It must compile the same release to the same aggregate digest independent of file-system enumeration order.

### 2. Catalog releases and definition revisions are different clocks

Every change to the bundle publishes a new immutable Catalog Release, including documentation, aliases, deprecation, and retirement metadata. An existing release version or digest is never rewritten.

A semantic or matching change to one formal definition mints a new immutable **Parameter Definition Revision**. This includes value shape, constraints, units, schema default, canonical selector behavior, or other content that can change recognition or interpretation. A documentation-only correction publishes a new Catalog Release but does not force a new semantic revision or binding cutover; the immutable release still retains the documentation snapshot that was current at publication time. Lifecycle and alias changes are release metadata and do not rewrite a pinned definition revision.

The stable definition identity remains typed formal subject plus property key, as fixed by the Wayfinder map. Exact opaque-id representation and relational current-revision constraints remain with [Choose the canonical parameter-catalog relational model](https://github.com/tzrea1-Q/WiseEff/issues/672).

### 3. Aliases are selector aliases, not alternate identities

A catalog alias maps an external subject selector, such as an old `compatible`, nodename, or vendor identifier, directly to one canonical Driver or NodeType subject. It does not create a second subject or definition. Resolution is one hop. Alias chains, cycles, ambiguous targets, collisions with canonical selectors, and reuse of a previously published alias for another subject are forbidden.

This alias vocabulary excludes both `property_key` aliases and the DTS source-write `targetRef`. A referenced property-key change remains the source-rewriting cutover fixed by ADR-0034; a standing alias must not hide whether project source actually moved.

Deprecation and retirement are distinct:

- **Deprecated** is a soft warning state. The definition remains matchable and replayable so existing and newly observed sources do not abruptly lose parse coverage, but it leaves default governance selection and points operators to a successor.
- **Retired** explicitly removes the selector or definition from current matching. Existing bindings, revisions, audit, and replay remain addressable through pinned history.

Omission from a later manifest never means retirement. Withdrawal requires an explicit tombstone whose history remains in the release lineage.

### 4. Derived state has one-way provenance

The destination lineage is:

```text
Catalog Release bundle
  -> canonical compiled model
  -> database materialization
  -> verified current-release pointer
  -> runtime cache
```

PostgreSQL is a queryable materialization, not an authoring source. A runtime cache is a disposable immutable snapshot of one verified database materialization, keyed by the exact Catalog Release digest. It never independently reparses YAML for business traffic and never composes Platform or organization overlays. A missing cache can be rebuilt; a missing or unverified materialization cannot be replaced by an empty registry.

The catalog synchronizer owns the complexity behind one narrow upgrade seam. It compiles the release, stages the full materialization, verifies it, and atomically changes the current-release pointer. Callers never coordinate subject creation, row upserts, revision cutover, aliases, tombstones, or cache invalidation themselves. The exact external module interface and transaction ownership remain with [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673).

### 5. Synchronization is explicit, idempotent, and fail closed

Synchronization runs as a one-shot maintenance operation under an exclusive catalog lock:

- When the expected digest already equals the verified current digest, it performs read-only verification and is a no-op.
- A fresh database requires an explicit bootstrap mode.
- An installed release may advance only when it is a declared supported ancestor of the target. The target artifact must carry the complete lineage needed to cross every supported skipped application release deterministically.
- Staging and the current-pointer switch are idempotent. Retrying the same known transition produces the same materialization and digest.
- Missing or malformed source content fails before any database write.
- Unexpected database rows, changed materialized content, an unknown installed digest, or a release outside the declared lineage is **catalog drift**. Drift stops the upgrade; the synchronizer does not silently overwrite, infer, or delete it.

Absence is never interpreted as an empty catalog or an implicit delete. Materialization changes only through additions, successor revisions, aliases, lifecycle transitions, and explicit tombstones declared by a release.

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

The synchronization verification for this ADR proves that the bundle and lineage are valid, every published object materialized exactly once, the materialization fingerprint equals the canonical compiled model, aliases and tombstones agree, the current pointer names a complete verified release, no organization-owned catalog object exists, and the runtime cache can be built from that release. Project-binding, HTTP, browser, observability, self-hosted end-to-end, and legacy-deletion acceptance remain with [Choose verification, upgrade, and legacy-retirement gates](https://github.com/tzrea1-Q/WiseEff/issues/679).

### 7. Failure, rollback, and history never rewrite publication truth

Before the current pointer switches, a failed staging transaction leaves the previous verified release current. After the pointer switches but before public traffic or candidate writes, an operator may switch back only when verification proves that the previous snapshot is still compatible and no candidate write occurred; otherwise the recorded recovery point is restored. Once candidate business writes or public traffic occurred, a pointer-only rollback is forbidden. Operational data recovery follows [Choose populated-data cutover, archive, and rollback strategy](https://github.com/tzrea1-Q/WiseEff/issues/678).

A business-level catalog rollback is a new forward Catalog Release. It may restore content from an older release, but it receives a new version and digest. Failed releases, materialization attempts, and audits are retained rather than deleted.

Historical business values pin their exact Parameter Definition Revision. Ingest, matching, alias resolution, and governance evidence also record the Catalog Release digest that produced the decision. Replay loads that immutable release or normalized snapshot by digest; current aliases, lifecycle, or revisions never reinterpret history. Production replay cannot depend only on Git history or a network fetch. If a required historical release is absent or fails its digest, replay fails closed.

### 8. Organization structural writes are impossible in steady state

The destination removes the ability to represent an organization-authored schema or definition override across every writable layer:

- the catalog relational model has no organization owner or scope for structural definitions;
- the catalog module interface exposes no organization structural mutation;
- HTTP, Agent, review-apply, coverage-claim, script, and background paths cannot create organization catalog objects;
- legacy overlay and organization-definition relations are read-only to production roles and reject new writes at the database layer;
- only a dedicated maintenance migration principal may classify, map, or archive legacy rows during the bounded cutover, with durable audit; and
- synchronization verification requires zero new organization structural rows after the cutover boundary, while runtime cache identity contains no organization key, overlay digest, or precedence rule.

Organizations may submit observations, review evidence, or repository change proposals. They cannot publish schema. Exact route retirement responses and compatibility windows remain with [Choose the parameter API and legacy-identifier transition](https://github.com/tzrea1-Q/WiseEff/issues/677).

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
- ADR-0032's semantic-successor rule remains: documentation changes are recorded in a new Catalog Release without manufacturing a semantic binding cutover.
- Catalog compilation, materialization, current-pointer selection, and cache construction become one deep module rather than coordination repeated in ingest, startup, scripts, and overlay services.
- Implementation must replace current silent loader fallback, lazy materialization, per-organization registry composition, API-start migration, and post-start database-only catalog check. This ADR contains no code or migration implementation.
