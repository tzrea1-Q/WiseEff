# S6 management Binding history import

[中文](README.zh-CN.md)

This internal seam consumes a controller-owned P0/P8 receipt. It is not exported
by the runtime Parameter Bindings API and does not approve a release, change a
pointer, resume queues, or open traffic.

The management login must be a real NOINHERIT login without superuser,
BYPASSRLS, CREATEDB or CREATEROLE, with membership of the existing
`catalog_migration_owner` capability. The import transaction assumes that role;
no migration credential or capability is added to runtime pools.

The production P0 input is `s6-binding-import-intent-v1`: a deterministic,
server-enumerated inventory of every old Binding and its complete Definition,
source-authority and tip-proof digests. It contains no future run, Archive or
mapping IDs. P8 generates `s6-binding-import-v2` from the current P7 mapping pins,
encrypted evidence and the real guarded registration command. The receipt
binds the run, plan, source snapshot, exact current mapping versions, encrypted
source evidence, retained release heads, original audit references and an
explicit source revision tip. The importer does not infer identity or tip from
a name, property key, timestamp, revision number or the current Catalog head.
The historical `s6-binding-import-v1` pool entry remains for the earlier receipt
consumer fixture; the production controller cannot use that version. Synthetic
fixtures are not Release Verification reports or approvals.

Tip proof follows every file's explicit `current_version_id` and requires one
config revision with exactly that complete file/version member set, plus one
Binding revision and logical-node revision. Empty, missing or multiple matches
fail. Historical Definition mappings require an explicit `retainedReleaseId`.
The driver registration proof follows an actual R2 root, its DriverSchema and
same-Organization legacy Placement; node-type and other unsupported families
remain refused. The classifier's R classes are unchanged.

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
| Omitted whole Definition, changed file pointer or source authority | Rebuild the complete intent and refuse its changed digest |
| Installer and Binding management pools point to different targets | Compare actual PostgreSQL system identifier and database OID; query failure refuses |
| P7 head changes before P8, or any pinned formal head changes before P9 | Refuse the stored checkpoint/receipt lineage |

`importPreparedBindingHistory` requires the controller's actual management
transaction and reacquires the target lock on that same connection; no trusted
lock boolean exists. P9 imports and its checkpoint commit together. Archive
preparation owns a separate transaction, then P8 registration, evidence mapping
CAS and receipt checkpoint commit together. Unknown commit outcomes stop without
retry, and Archive preserves ciphertext for inspection. A completed S7 no-op
revalidates the import. The controller pins an explicit retention-owner date;
it does not invent a production retention period.

The new Binding lane requires a real deployment boundary port for writer
isolation and a three-store recovery manifest. It never consumes the older
P2 booleans/P3 count dump. That deployment producer, full source-family coverage,
P12/P13 and the full approval chain remain separate integration work. This
module cannot authorize their omission.

The PostgreSQL integration fixture starts from the exact `82344044…` migration
files and populates the old schema before applying the unchanged candidate
suffix. It invokes the real compiler, installer, registration writer,
classifier, mapping writer and encrypted Archive. It is bounded S6 evidence,
not a whole application upgrade, runtime pool switch or production rehearsal.
The additive S7 producer fixture exercises actual P7 mapping outputs, P8 Archive
and registration, and P9 same-transaction import. Its earlier phase checkpoints
are explicitly synthetic slice setup; it is not evidence of P2/P3 or root entry
execution. No execution result is implied by the presence of a test file.
