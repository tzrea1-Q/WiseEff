# S6 management Binding history import

[中文](README.zh-CN.md)

This internal seam consumes a controller-owned P0/P8 receipt. It is not exported
by the runtime Parameter Bindings API and does not approve a release, change a
pointer, resume queues, or open traffic.

The management login must be a real NOINHERIT login without superuser,
BYPASSRLS, CREATEDB or CREATEROLE, with membership of the existing
`catalog_migration_owner` capability. The import transaction assumes that role;
no migration credential or capability is added to runtime pools.

P0 must pin the digest of the complete `s6-binding-import-v1` manifest and its
source inventory fingerprint. P8 must persist that same manifest. The receipt
binds the run, plan, source snapshot, exact current mapping versions, encrypted
source evidence, retained release heads, original audit references and an
explicit source revision tip. The importer does not infer identity or tip from
a name, property key, timestamp, revision number or the current Catalog head.
Producing and reviewing these receipts remains the controller's responsibility.
Synthetic receipt fixtures are not Release Verification reports or approvals.

The source reader includes every column of the old Binding and revisions, DTS
revisions, definition revisions and referenced audit rows. SQL NULL flags keep
SQL NULL distinct from JSON null. Raw, canonical, schema and policy evidence
stays in the encrypted Archive source graph. Canonical ProjectValue receives
the actual typed value and its original ID and timestamp. Each target revision
must have its own verified retained release head. Import events explicitly use
`legacy-project-value-import`; they do not invent a source edit ordering.

Evidence is a complete definition graph, including every Binding in every
project that references the old definition. Several manifest entries select
their own checksum-bound subgraphs from the same Archive. The importer verifies
the complete source Binding set, so one definition's mapping head never needs
to be overwritten to attach a different project's evidence.

Operational evidence uses `Archive.persistEvidenceArchive` and the existing
mapping `evidenceArchiveId`. This path requires an existing operational mapping
of the same identity, run and R class. It preserves that primary disposition.
The ordinary `persistArchive` path continues to reject mapped R classes.

| Threat | Required refusal or invariant |
| --- | --- |
| Runtime or privileged login | Refuse before canonical mutation |
| Changed run, phase, manifest, mapping head or source bytes | Refuse the stale receipt |
| Missing or corrupt encrypted source evidence | Refuse before canonical mutation |
| Cross-owner registration, Placement or source references | Refuse without widening grants |
| Unproved tip or unavailable historical release head | Refuse; never substitute the latest head |
| Existing target rows without a committed receipt | Refuse, rather than overwrite or duplicate |
| Lost commit response | Return unknown outcome; explicit replay revalidates persisted state |
| Changed imported history or audit on replay | Refuse instead of trusting the completion event |
| Concurrent plans on the same target | One target advisory lock, independent of plan digest |

The pool entry owns its transaction and target lock. A controller already
holding that lock on another connection must not call it recursively. Shared
controller-transaction integration, complete source-family conservation, source
tip authority and full release approval remain separate integration work; this
module cannot authorize their omission. A manifest with an unsupported or
unprovable source must not be manufactured to reach this seam.

The PostgreSQL integration fixture starts from the exact `82344044…` migration
files and populates the old schema before applying the unchanged candidate
suffix. It invokes the real compiler, installer, registration writer,
classifier, mapping writer and encrypted Archive. It is bounded S6 evidence,
not a whole application upgrade, runtime pool switch or production rehearsal.
