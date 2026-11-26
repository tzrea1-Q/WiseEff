# Markdown import and catalog activation at growing history depths

[Chinese edition](../../zh-CN/exec-plans/active/2026-11-25-catalog-publication-cost.md)

## Goal

A small import against an existing subject should have predictable preview and activation latency as the release history grows. The definition count, target bytes and historical bytes are independent scale variables. Measure all three. Enqueuing, acquiring the publication lock and committing a matching activation receipt are separate events.

## First implementation

- Plan Markdown against the validated current target when available. A supported batch of creates and revisions runs the predecessor/successor validation and checks persisted history-sensitive identities before writing a compact successor. An old database, unavailable proof or unsupported operation follows the full compiler path. A missing proof on a no-change import can still leave the next request cold.
- Assemble physical full and compact artifacts directly for the compiler. Check physical checksums and predecessor links. Online activation releases the read transaction before CPU-bound preparation and rechecks the candidate, authority, fence and bytes at commit. Compiling a long historical lineage still costs time.
- Insert a release's definition heads from paired arrays and restore the current heads with one joined update. Unchanged heads do not require an update. Other projection tables, triggers and verification still scale with the target.
- A retryable job stays under observation in the UI. Terminal timeout is a typed failure. Structured request and attempt timings distinguish artifact reads, compilation, waits, projection and commit. When checking success, use the job and its matching receipt.

## Checkpoint implementation

1. **Prepare the current base once.** An idempotent maintenance operation reads a pinned base using a consistent snapshot, verifies it through the full compiler, and writes a versioned checkpoint only if the same release and bytes are still current. Cover existing installations and repeated all-skipped imports. Deduplicate concurrent warmups by base and compiler version. Make progress and completion observable.
2. **Bound ordinary activation by one verified base plus the successor.** Persist the facts the compiler and installer require, including historical identity claims and toolchain/capability history. Bind the checkpoint to release ID, logical digest, physical checksum, compiler contract, validator version and materialization. Compare its output against full replay for counters, digest, capability decisions, projections and receipts. The existing compiled-model digest covers all normalized releases. Preserving its exact value requires an explicitly tested incremental encoding or a separately versioned conversion with compatibility for older artifacts.
3. **Make checkpoints safe across the lifecycle.** Invalidate derived proofs during authorized erasure, rewrite and contract upgrades. Cover stale bases, missing/corrupt ancestors, restore, competing jobs and late receipts. Keep full replay available for incompatible or ambiguous inputs. Checkpoint absence triggers verification, failed integrity checks block unsafe activation. No retry may advance the pointer twice.

The preview store distinguishes certificates for ordinary definition edits and subject spelling changes. A verified legacy subject whose selector and natural key differ can supply the former. Rename keeps its historical spelling checks. A read-only planning request with no changes can reuse either valid certificate.

Migration 0376 adds a synchronizer-owned installation proof tied to the current release, bytes, compiler and materialization. The manager can explicitly prewarm both certificates for an already-installed release. A successful publication records the next installation proof in the same transaction as its receipt. An artifact, release or materialization rewrite invalidates activation proofs and advances their generation. A reader checks that generation again under the pointer lock.

New Markdown definition successors on the migrated database use the manifest compiler `wiseeff-catalog-install-chain/v2` and capability v9. Descendants inherit the compiler contract. Full replay hashes verified normalized releases in numeric sequence into a typed model receipt. Ordinary definition appends extend those same commitments. Older releases keep the original compiled model and digest. Other operations on a v2 base still use full replay whenever the append proof cannot establish the required invariants. Operators upgrade compiler consumers together and keep a matched backup for rollback across the first v2 publication.

The v2 source format is `wiseeff-catalog-release@2`. The manifest binds the compiler marker to this format, allowing older offline validators to reject it before modifying catalog state. For v2, `compiled_model_digest` is the SHA-256 digest of the canonical `modelReceipt`. The full export still supplies the normalized model bytes. Use the version-aware compiler to reproduce both.

## Release acceptance

Exercise real PostgreSQL through preview, enqueue and the publication manager with synthetic catalogs of approximately 5,000 definitions. Vary history depth and total physical bytes independently, up to at least 600 MiB. Include cold and warm starts, create, revise, no-change, new subject, concurrent publish, interruption before/after commit and checksum mismatch. Compare each build on the same host, preserve the first cold run separately, and gather at least 20 warm samples per representative case.

Proposed targets for ordinary warm batches of one to five edits are preview P95 at most 15 seconds, click-to-receipt P95 at most 60 seconds, first-attempt activation and one receipt per successful job. Warm preview should read zero predecessor lineage payloads; after the checkpoint change warm activation should also read zero earlier historical payloads. Record manager CPU, peak RSS, database waits and physical bytes alongside elapsed time. Ratify the absolute thresholds on representative self-hosted hardware. Until then use the structural checks and per-stage measurements for comparisons.

## Documentation Impact Matrix

| Change | Documentation |
| --- | --- |
| Retry and terminal reason | API error references and OpenAPI |
| Compiler checkpoint and invalidation | Catalog design and recovery runbooks with the checkpoint implementation |
| Performance acceptance | This plan and the synthetic benchmark |

## Documentation Update Gate

Record the code revision, workload, database version and measured results in the implementing PR. A target-host result must identify the deployed revision, stage timings, job attempts and receipt.
