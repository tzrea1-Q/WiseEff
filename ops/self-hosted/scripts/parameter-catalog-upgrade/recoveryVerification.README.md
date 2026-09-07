# Recovery and pre-switch evidence adapter

> Chinese: [Chinese](recoveryVerification.README.zh-CN.md)

`createControlledBoundaryEvidenceExecution` connects the two existing
`PCAT-RP-RECOVERY-POINT` and `PCAT-WRITER-PRE-SWITCH-FENCE` gates to S11-RP package
verification and the controller's live writer boundary. This is an invocation
adapter under the self-hosted controller owner. It does not change the gate
registry, S11-RP manifest, restore token, permissions or approval semantics.

The management root supplies the exact journal/run/target, an issued host lock,
the existing source identity observer and writer-boundary implementation. The
adapter finds the committed capture in the actual journal, opens its recorded
directory inode, checks every package payload through `verifyRecoveryPackage`,
and rechecks source, fence, lock and journal. Package checksum alone is not
provenance: it must match that same run's protected capture record.

One factory serves one pre-activation attempt. Changed plans, duplicate gate
execution, missing captures, altered packages, expired or lost boundaries,
directory replacement and target drift cannot produce usable evidence. Assembly
reads revalidate the inputs; there is no cached passing fallback. Evidence binds
the complete plan pins, purpose, lineage and subject. The owning source producer
must independently observe real identities; a test implementation of this code
port is not a deployment fence.

The adapter only checks. It cannot capture, restore, issue approval, start a
consumer or change a proxy. It does not implement post-retirement verification.
The existing domain service still prepares/runs/assembles the complete report,
and the actual distinct principals must approve it before P12. No CLI accepts a
caller-provided passed result.

Tests here use actual private package files and the host operation lock, with
explicit unit source bytes and a unit writer-boundary port. They are neither a
PostgreSQL dump restoration nor complete three-service/P12 acceptance. The parent
must compose the existing real source and writer producer for that evidence.

Documentation impact: this pair, the existing upgrade plan/evidence and terminal
manual. Parent owns this adapter and its tests; storage checks/execution,
activation SQL, report core and migrations remain separate owners. Independent
Standards/Spec review is required before treating this R3 increment as sealed.
