# Live comparison evidence

[中文](README.zh-CN.md)

`liveEvidence.ts` connects the existing eleven-family live aggregation and
Comparison report generator to the nine S10 `PCAT-CMP-D01`–`D09` adapters. It
does not implement another verifier, approval service or Catalog converter.

## P0 source wiring under development

`comparisonSource.ts` connects the original stopped handoff, private management
configuration and issued host lock to a single source transaction. The root
provides its original registered container set; actual endpoint checks still
verify every owner label and network member. The explicit source-system name
comes from the pinned management configuration, not from a comparison report.
The source owner captures all installed 0137 source identities and the eleven
consumer inventories. P0 registration uses the existing management transaction
and journal attempt, with exact tuple reuse and post-insert readback. Its source
lease retains legacy-table locks through P0 commit and host acknowledgement.

This wiring has only focused tests with database/transport doubles and real
private files/host locks so far. The original populated-plan conversion and
Binding-family restrictions remain; full-source planning, actual P0 execution,
v2 providers/report/gates and the complete two-head positive are not verified.
The existing MOD production reader still reads schema files/cache in addition
to locked database rows. No filesystem-free source claim is made. The proposed
MOD database projection is isolated pending its exact boundary decision; no
allowance or trusted baseline was changed.

## Composition contract

Create one `createComparisonEvidenceExecution({ source })` per actual
`runVerification` invocation. Install its adapters in the existing verifier;
after all nine required gates finish, obtain `readEvidence()` and supply its
typed evidence references to the existing `assembleReport` together with the
other required gates' references. Persist the returned Comparison artifact
through the owning controller's evidence storage. A second attempt requires a
new execution and a new live capture; this module has no cross-attempt cache.

`source` is an installed code port, not a CLI JSON option. Its `withBoundary`
must hold the real target and writer boundary until the callback and boundary
release finish. It supplies the actual `Database`, pool and `observe` function.
Each observation contains the current `AggregationContext`, complete
`VerificationPins`, `VerificationSubject` and `VerificationLineage`. The source
owner must produce these from the observed target, not copy them from the plan
or a report. Missing source, drift, failed capture and unknown exceptions fail
closed with static typed diagnostics. The original typed corpus failure code
is retained without contribution values or connection details.

The adapter snapshots the plan and both observations, compares their complete
pins/subject/lineage, runs `aggregateLiveComparisonCorpus` with its existing
default providers, then `generateComparisonReport`. It checks the original
report checksum and complete passing coverage before issuing evidence. It
accepts the existing pre-activation and post-P13 comparison phases for fresh
and populated modes. Registry-defined non-applicability remains unchanged;
unsupported required purposes/modes cannot be silently relabelled.

Each envelope binds the producer, short gate ID, original comparison ID,
original Comparison checksum, S10 plan digest, purpose, subject, phase and full
pins using the existing S10 digest codec. The artifact identity is
`sha256:<Comparison checksum>`: the prefix labels the original Comparison
UTF-8/LF byte digest, not a second serialization with the S10 codec.

After obtaining the applicable approved report through the formal report
projection, P12 can call
`assertComparisonEvidenceAssociation({ comparisonReport, verificationReport, subject })`.
It verifies the original artifact and exact one-to-one correspondence of all
nine results, typed references and evidence digests, returning
`{ comparisonReportDigest }`. It does **not** establish report approval,
principal authority, freshness or current target applicability. Those remain
the responsibilities of the existing release action and actual state producer.

## R3 boundaries and remaining producer work

| Threat | Retained boundary |
| --- | --- |
| Caller supplies a passing artifact | Production execution always calls the existing live aggregation and generator; no provider override or report input |
| Shared object mutates during capture | Independent plan and observation snapshots; second full observation must match |
| Reuse for another attempt or target | Each gate once per execution; full plan match; new execution recaptures |
| Artifact or envelope substitution | Original codec integrity plus nine exact producer/purpose/subject/phase/pin associations |
| Query/lock failure appears empty | Typed failure, no usable evidence bundle |
| Mapping identity is guessed | No conversion of mapping head/version/checksum to epoch/head digest |

The real composition root still owns target fencing and production of joined
Catalog, mapping, source and lineage facts. In particular, the adapter does not
infer that `catalogSnapshotChecksum` equals a Catalog pin, or that
`mappingHeadId`/`mappingHeadVersion`/`mappingHeadChecksum` equals
`mappingArchive.mappingEpoch`/`headDigest`. A valid producer must prove those
relationships using the existing domain records while retaining every source
record's exact mapping and disposition.

The current frozen contribution parser requires each declared difference's
mapping head/version to equal its contribution, and every contribution's tuple
to equal the context. Two actual per-identity heads therefore cannot both be
represented as different tuples in one current context. The permanent
multi-head counterexample records this limitation; this slice changes neither
that parser nor the frozen codec. A global epoch must not replace per-case
mapping evidence. Joining the actual complete mapping inventory and preserving
per-case evidence remains an integration obligation, not an approved semantic
shortcut.

## Verification and documentation impact

`liveEvidence.test.ts` runs the real aggregation, parsers and report generator
with synthetic family contributions and a synthetic boundary source. Its
report association fixture is not an approved service report. These tests
cover all nine associations, capture failures, drift, replay, unavailable
families and the multi-head limitation; they do not prove real PostgreSQL
consumer queries, real approvals, P12 apply, startup or a full controller run.

Documentation impact is limited to this module's English/Chinese composition
contract. The owner of the controller maintains the main upgrade plan and
operating evidence; no frozen schema, grant, consumer or release rule changes.
