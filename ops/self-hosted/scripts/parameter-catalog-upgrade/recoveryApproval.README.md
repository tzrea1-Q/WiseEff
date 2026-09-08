# Authenticated recovery execution approval

Chinese: [Chinese](recoveryApproval.README.zh-CN.md)

`tsconfig.node.json` explicitly includes this producer, `deploymentAuthority.ts`
and `reportApprovalTarget.ts`; the ordinary build must typecheck these management
modules even before the final terminal controller imports them.

`recordRecoveryExecutionApproval` is a controller-side approval producer. It
joins the existing private deployment authority, typed capture journal, Recovery
Point/package verifier and host operation lock. It does not restore any store,
restart a process, resume a queue or open a proxy. It grants no release purpose
or database capability.

## Trust and inputs

The fixed management root supplies its actual journal, private operation root,
original `HostOperationLock`, existing run-bound restore token and an opaque
`IncidentRestoreConfirmation`. A structural lock callback, copied confirmation
or caller JSON cannot replace these capabilities. The confirmation originates
in `openDeploymentAuthority(...).confirmRestore` after real production session
authentication and the custodian's exact private run/attempt/capture/destination
assignment. `assertIncidentRestoreConfirmationCurrent` rereads that same private
assignment and authenticates the same original session; expiry, logout, account
disablement or file replacement refuses. Tokens stay inside private closures.

The capture is read from the existing journal's committed typed capture event,
not supplied as caller JSON. Its run and record digest must match the confirmation;
its source must match the authority's sealed source target. The recorded package
directory device/inode must still match. Operation, journal and package directory
identities and private ownership are rechecked around package/authentication
operations. A captured source pin is not a fresh observation of live destination
volumes or proof that application writers remain stopped; the execution layer
still performs its own current target/boundary checks.

## Durable effect and refusal

The existing package verifier rereads the actual manifest and payload bytes,
checks their digests and roles/metadata/AOF structure, and invokes the existing
Recovery Point verification. The existing `restoreCheck` validates its run-bound
token. None of those checks grants approval by itself. The package is checked
again after authentication, and directory custody, journal CAS state and the
actual lock are checked immediately before the synchronous journal commit.

The sole effect is the existing `recovery-execution-authorized` committed event.
Its typed record preserves the six existing `RecoveryExecutionApproval` fields
plus assignment digest, authenticated principal and trace. The approval reference
is the original authenticated confirmation digest. No phase or release pin is
changed. Existing journal fsync/CAS/unknown-outcome handling remains authoritative;
failure never resets a journal, removes evidence, guesses the commit result or
blindly retries. The returned approval is consumed by the existing execution
authorization module against the durable record.

Absent/uncommitted capture, cross-run/capture/source/destination scope, package or
directory drift, a bad token, stale journal, unresolved binding attempts, invalid
authority or a missing/lost/wrong lock refuses. Any previous execution approval,
revocation, start, unknown or completion also refuses a new approval; reconciliation
belongs to the parent controller. Inspection and approval do not execute recovery.

## Acceptance and limits

The focused unit rejects fabricated confirmation/callback input without journal
changes. `authority-pg16` adds actual restricted authentication LOGIN/session
cases that call the real capture producer, persist approval through this producer
and then invoke the existing consumer's authorization check. Capture uses bounded
synthetic store adapters and package bytes in these component cases. It proves
package/journal/authentication integration, not a restorable PostgreSQL dump,
independently observed source quiescence, a three-store restore or business recovery.
No fixture directly inserts an approved journal event for the positive path.

The parent still owns actual source/destination observers, terminal/controller
dispatch and full capture-to-restore acceptance. Production backup access,
restoration and traffic changes remain unauthorized. This component adds no
production command or alternative manifest, token, verifier or state machine.
