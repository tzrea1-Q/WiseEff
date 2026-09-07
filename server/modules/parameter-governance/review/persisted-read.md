# Persisted Review Queue projection

[中文](persisted-read.zh-CN.md)

`createPersistedReviewQueueReader(pool)` is an additive S4-REV query factory.
It implements the existing `ReviewQueueReader` list/get interface without the
existing factory's lazy creation of open ReviewItems. The old
`createReviewQueueReader`, grouping/ETag algorithm, contract fingerprint,
authorization and command failure union remain unchanged. The existing export
checks prohibit resolution writers and public repositories/transactions; they
do not fix a closed list of query factories.

The new projection validates the original Organization Admin context and current
Kernel pin, reads evidence and open items in a repeatable-read **read-only**
transaction, and requires a persisted item for every current evidence group.
It checks identity, grouping fingerprint, matcher revision, release, reason and
positive safe ETag version before calling the existing redacted projection.
Malformed evidence and unexplained current open items are unavailable. It does
not fabricate an item ID, ETag version 1, or an empty queue to replace missing
preparation or permissions. A genuinely empty observed inventory remains empty.

The checkout is returned before the final independent Kernel pin validation;
this supports pools with one connection without transferring Kernel transaction
ownership. A changed pin fails closed. This is a bounded query snapshot, not a
writer fence or an applicable approved runtime/verification report. The upgrade
owner must still hold its actual target boundary around comparison collection.

Storage/preparation failures throw an Error named
`ReviewQueueProjectionUnavailable`, with static code/message
`review-queue-projection-unavailable` and no SQL, connection string or evidence
payload. This uses the existing query's thrown storage-failure boundary rather
than adding a member to the frozen command failure union. SQL rollback failure
destroys the checkout; release failure cannot replace a prior unavailable error.
The caller owns the pool and closes it.

| Threat | Required check |
| --- | --- |
| Missing grouping looks like prepared data | Missing persisted group refuses; no INSERT or synthetic ETag |
| Evidence cannot be decoded | Explicit unavailable, never silently dropped |
| Wrong stored identity/version | Full group/item binding and safe positive version |
| Unauthorized or stale query | Existing Organization Admin scope and Kernel checks |
| Caller changes query during an await | Snapshot selection before first asynchronous work |
| Query/rollback/connection error leaks or passes | Static error, rollback and checkout release |
| Read becomes an implicit writer | Actual READ ONLY transaction; state equality in real-PG tests |

The pure tests exercise the public factory with synthetic database/Kernel ports.
The integration selector is
`server/modules/parameter-governance/review/persistedQuery.integration.test.ts`;
it requires the parent's existing owned-target receipt and an isolated cluster.
Do not run it using the ambient backend configuration. The parent owns its exact
runner/CI routing and shared production API composition.

The real-PG fixture prepares release/evidence/items through the existing compiler,
installer, ingest and grouping entrypoints. Its positive LOGIN uses existing
0138 synchronizer and governance capabilities with INHERIT TRUE, SET FALSE,
ADMIN FALSE. **It is not a least-privilege API/worker identity**: those capabilities
also carry writes. The actual projection transaction is read-only. A separate
0140 Catalog-reader-only login must fail Review access without modifying that
capability's grants or creating records. This test depends on the exact parent's
0140 migration and owned-target helper, absent from the Scratch main base; it
must run after their verified integration, not against a replacement schema.

No grant, migration, new governance EXECUTE, startup approval or release permission
is added. Production API composition may choose this factory without a command
pool, but missing legitimate Review SELECT remains a real refusal. Preparation
of grouping state and the final runtime capability are separate responsibilities.

Documentation impact is this English/Chinese pair; the parent maintains the
overall PR plan and exact execution evidence. Pure tests, governance-capable
component PostgreSQL tests, final runtime identity and full upgrade acceptance
must be reported separately.

Unexpected errors from both independent Kernel pin checks use the projection's
static unavailable error. Test fixture cleanup settles the reader pool, role,
admin pool and database in order and attempts every stage even after a failure.
It reports the first failed stage without the underlying private diagnostic; a
limited-login assertion failure and cleanup failure are both retained. The pure
cleanup fault cases exercise this shared fixture function, not PostgreSQL DROP
or successful real resource cleanup.

The bootstrap fixture uses the existing `firstReleaseBundle`, whose real compiler
result has no predecessor. The general compiler fixture targets a successor and
is correctly rejected on an empty Catalog. A pure precondition regression covers
this distinction; actual installation still requires the owned PostgreSQL lane.
