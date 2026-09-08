# Startup publication persistence

[中文](startupPublication.README.zh-CN.md)

This root-owned component implements the existing append-only host journal's
publication storage obligation. It does not implement P13, approve a runtime
report, start API/worker, publish traffic, or provide a runtime `StartupTarget`.
It changes no SQL schema, grants, report codec, or P0–P10 state transition.

## Actual interfaces

`prepareStartupPublication({journal, lock, activation})` holds the genuine
same-directory host operation lock, compares the complete durable journal,
consumes its exact committed/reconciled activation intent, calls the actual
`createApplicationReadActivation().inspect`, and reads the original pre-activation
report through `createVerificationReportService().readReport`.

There is currently no complete P13 producer. After the available preconditions,
the function returns the typed `p13-producer-unavailable` refusal. It cannot write
a pending publication. It accepts no caller boundary, passed flag, retirement
boolean, new report verifier, or environment-pin fallback. A low-level login
fence or bootstrap password rotation is not P13 evidence.

`openStartupPublicationStorage` is a lower persistence adapter, like
`ActivationJournal`. Its `pending(intent)`, `committed(intentDigest)`,
`unknown(intentDigest)`, and `inspect({attemptId,intentDigest})` operations store
and read records. Its inputs do not prove approval. No startup consumer is wired
to this interface. The inspection result explicitly has
`scope: publication-storage-only`; even a committed result is not readiness.

## Record and lifecycle

The intent stores distinct host and Cutover run IDs, attempt ID, actual target
identity, activation binding digest, the existing full isolated `StartupBoundary`,
explicit predecessor publication digest, and a recomputed host-codec digest.
Exact keys reject missing or extra fields. The existing report/activation inner
digests retain their own codecs; no report bytes are rehashed as host evidence.

`generation` is a positive sequence within one host journal. It is **not**
`runtimePinGeneration`; that boundary field must eventually come from the real
P13 owner. It is also not a target-global head across host journals. Publishing
across host runs still needs the root owner's actual unique-head protocol.

Only pending can become committed or unknown. Commit requires the exact intent
issued by the same adapter; a fresh process cannot supply an acknowledgment.
A successor requires the explicitly named committed predecessor, next sequence,
same target and an unused attempt. Old-generation replay cannot overwrite a
new pending publication. All operations compare complete journal records, not
just their claimed hashes, and retain the original directory FD across awaits.

The existing journal writes and fsyncs its file, renames it and fsyncs its
directory. A directory-sync failure preserves the write lock and uncertainty;
renamed bytes alone are diagnostic. Nothing here deletes a durability lock,
automatically retries a publication, or converts unknown to committed.
Current-state reconciliation must be added through the real P13/publication
owner; reading a historical committed entry does not implement it.

## Tests and remaining source work

The pure Node selector is `startupPublication.test.ts` under the existing
`vitest.scripts.config.ts`, which has no database global setup. It uses real
filesystem journals, genuine host locks, an injected fsync failure on an actual
directory FD, and a real separate Node process terminated after durable pending
or committed storage. Constructed boundary records are explicitly **storage
fixtures**, not passed reports or a completed P13. No PG/Docker or startup
positive is inferred from these tests.

The parent still owns complete P13 writer/route/job/trigger/privilege retirement,
its immutable fingerprint and runtime generation, the full post-retirement
verification and distinct approval, independent complete pins, target-global
publication selection, current-state reconciliation, and runtime read-only
transport. Published restart must protect metadata while allowing ordinary
business traffic; it cannot reuse a stopped-service maintenance boundary or
receive management credentials. S6 and Policy #815 remain separate decisions.
