# Controlled recovery execution

> Chinese: [Chinese](README.zh-CN.md)

This is the independently reviewable execution layer authorized by the user for
PR #824 after report `f00f94435d128ff8706ffadedabbee507f79781b`. It does not
authorize production access, restore, queue delivery, proxy activation or release.

## Contract change

Previously `scripts/run-restore-drill.test.ts` forbade restore commands across all
top-level storage TypeScript files. The existing capture and restore adapters
shared modules, so the actual `pg_restore` implementation violated that contract.
CI run `34071070497` reproduced the same conflict as `34067803219`; this failure
was not the earlier source-lock timeout. The user explicitly authorized a genuine
module split and the related ownership/dependency contract on 2026-09-07.

Now `scripts/recovery-storage-boundary.ts` registers every storage file, including
nested modules, fixtures and documentation. The registry classifies these layers:

| Layer | Modules | Allowed behavior |
| --- | --- | --- |
| S11-RP check | `recoveryPoint.ts`, `threatMatrix.ts`, `recoveryPackage.ts`, `controlledRecovery.ts`, `controlledRecovery.docker.ts`, `dockerAccess.ts`, `scripts/run-restore-drill.ts` | Capture, verify, restore-check and observations; no restore dispatch or execution-layer imports/re-exports. |
| Recovery execution | `execution/packageRestore.ts`, `execution/controlledRestore.ts`, `execution/dockerRestore.ts`, `execution/authorization.ts` | Explicit target-only restore after independently observed identity and persisted authorization checks. |
| Test | Listed `.test.ts` files and `execution/authorization.fixture.ts` | Synthetic fixtures and fault injection. No production layer may import these fixtures. |

The check scans the transitive local dependency graph, including helpers outside
storage, and rejects unknown files, missing registrations, unresolved imports,
dynamic loading/evaluation, test-module imports and execution dependencies.
Constant string folding detects concatenation, template and array-join disguises.
The capture executable must remain the fixed `pg_dump` command. The original
S10-PER no-reimplementation and `DROP DATABASE` / `FLUSHALL` prohibitions remain across both
production layers. This is a finite static boundary plus behavioral acceptance,
not a claim that text scanning proves arbitrary JavaScript safe.

## Authorization and journal consumption

Recovery approval is persisted as `recoveryApproval`: the exact approval,
assignment digest, authenticated principal identifiers and trace identifier.
The journal recomputes the approval reference, binds the preceding typed capture,
and refuses state/pin changes, reused attempts and approval after execution or
revocation. Historical hash-only events remain inspectable but cannot authorize
the executor. This persistence validation does not authenticate a caller; the
separate producer must consume the current issued authority and maintenance lock.

Every executor store step requires the original module-issued host lock for the
exact private parent directory of this journal. A plain `assertHeld` callback,
an unrelated/ancestor-directory lock, a released handle or a replaced directory
cannot authorize effects. The approval producer enforces this same direct-parent
layout before persisting approval. Synthetic fixtures follow this layout too.

The controller must produce these existing-journal entries in order:

1. `recovery-package-captured`: `inputDigest` is
   `recoveryExecutionRecordDigest(RecoveryCaptureRecord)`.
2. `recovery-execution-authorized`: `inputDigest` is
   `recoveryExecutionRecordDigest(RecoveryExecutionApproval)`.

`RecoveryCaptureRecord` binds the run, package digest, S11-RP digest, complete source
identity and independently obtained writer-boundary digest. `RecoveryExecutionApproval`
binds that capture digest, an execution attempt, complete destination identity,
an authenticated approval reference and expiry. Both events must be committed;
the capture must precede the current approval. A subsequent revocation or changed
approval invalidates the consumer. These are typed internal journal events, not
new free-form controller commands or proof that a technical test may self-approve.

The consumer exports no approval writer. `createRecoveryExecutionAuthorization`
requires the existing private `UpgradeJournal`, the current live
`HostOperationLock`, the capture/approval records and the S11-RP restore token.
It reloads the journal, reopens and verifies the on-disk package, and calls the
existing S11-RP `restoreCheck`. The token proves run/integrity binding; it is not
an authentication secret and cannot supply source provenance or approval.

`createControlledRecoveryTarget`, exported by `packageRestore.ts`, accepts only an
authorization capability issued by that factory. The root `restoreRecoveryPackage`
rejects unissued target objects before reading a package; importing the lower
adapter builder cannot create a root-admitted target.
The issued target is opaque: it exposes no authorization or restore methods,
and copying its fields cannot copy its internal admission capability. Before each
store it rechecks package bytes, current authorization, lock and independently
observed identities. The existing append-only upgrade journal is the sole
execution state: it records start, committed store steps, completion or unknown
outcome. The former truncatable package status file has been removed.
Reconstructing an adapter does not make a started/unknown attempt retryable.
Reconciliation belongs to the parent controller and must not reset the record.

Read-only bootstrap/empty checks retain the destination adapter's actual Docker
and database observations. Complete target identity is recomputed at authorization
and immediately before each dispatched store effect, including after the empty
check. Removing repeated full observations within read-only preflight does not
cache an identity across a write boundary; a dedicated drift-after-empty test
proves the first restore is refused if that state changes.

The isolated Docker destination preserves PG16 roles, owner and ACL semantics,
object bytes/content type/metadata and Redis AOF files. It refuses nonempty or
shared resources and retains stopped Redis after copying the persistence files.
Restore completion means `restore-executed-not-business-verified`. It does not
approve candidate startup, business queue consumers, or public traffic.

## Evidence and remaining integration

The deterministic tests cover persisted approval absence, wrong token/run/target,
expired/revoked approval, changed package files between stores, lock loss, partial
failure and replay. The real Docker test creates its own independently identified
PG16 Alpine, original MinIO 2024-12-18 and Redis 7 AOF resources, captures a package,
stops the source and restores in a separate process using only that package and
private destination inputs. The fixture's actual journal writes prove the
consumer contract only; they are explicitly not a real domain approval producer
or a complete controller upgrade. Queue-shaped keys are persistence evidence,
not full business-consumer acceptance.

The Docker matrix uses four independent runs: `postgres` and `wiseeff` bootstrap,
each with `package-only-restore` and `nonempty-target-refusals`. The positive run
performs source shutdown, child restore and owner/ACL/object/AOF acceptance. The
negative run captures its own real package and exercises all six preexisting
function/view/sequence/type/extension/event-trigger refusals. No live source,
package, destination or deadline is shared between these responsibilities.
Earlier combined cases at `be7f73f78` and `21f9e89ff` each passed `postgres` but
timed out for `wiseeff`; those remain failed executions. Phase timings showed
the six sequential refusals consumed 33–39 seconds in the successful lifecycle's
180-second budget. The split preserves every assertion and that per-case limit.
Every scenario retains its private package and append-only journal, including
accepted scenarios. Docker resources and private secret inputs still have their
separate owned-resource cleanup. The evidence fixture exposes no deletion
operation. It creates a 0700 directory and opens a 0600 `retained-evidence.json`
marker with `wx` during initialization. Settlement writes the accepted/failed
test outcome only through that same original file descriptor, syncs and closes it.
It rechecks directory and marker device/inode/owner/mode and descriptor identity;
replacement, symlinks, hardlinks or permission drift refuse settlement. Actual
directory-substitution race tests prove no foreign deletion or redirected write.
On detected path drift no marker locator is returned as verified. A successful
diagnostic locator is relative to the development host's temporary directory and
omits its host path; it is not a custody or restore-approval record. Retained
packages must not enter ordinary artifacts. No general package cleanup command
is introduced, and older combined-case results are not relabeled by this fixture
retention change.

Run only in a independently verified development workspace, with the installed
dependencies and the four pinned image references already present:

```bash
./node_modules/.bin/vitest run --config vitest.scripts.config.ts \
  scripts/recovery-storage-boundary.test.ts \
  ops/self-hosted/storage/recoveryPackage.test.ts \
  ops/self-hosted/storage/controlledRecovery.test.ts \
  ops/self-hosted/storage/execution/authorization.test.ts
```

The following command creates/stops/removes only its own synthetic resources and
executes real restoration into those empty targets. It requires the user's
isolated-execution authorization and independent Docker daemon verification; the
environment flag selects tests and cannot bypass resource identity checks:

```bash
UPG_CONTROLLED_RECOVERY_DOCKER_TEST=1 ./node_modules/.bin/vitest run \
  --config vitest.scripts.config.ts \
  ops/self-hosted/storage/controlledRecovery.docker.integration.test.ts --maxWorkers=1
```

Stop on any test failure; retain the refusal/unknown evidence and do not manually
clear a real restore target or journal. No production restore command is provided.
The controller-side `recordControlledRecoveryCapture` bridge now persists the
actual S11-RP capture output after a durable typed intent. Its directory identity,
run/attempt, full capture record and unchanged controller pins are checked on
journal load/append. Execution rejects historical hash-only capture records;
they remain inspectable, without being promoted into current trusted capture.
A pending/unknown attempt retains its package and cannot be blindly retried.
The bridge uses the real issued host lock, checks root/lock objects on every
probe, and stops writing the journal after its parent directory changes. Package
outputs use verified exclusive file descriptors. These component boundaries do
not yet supply the complete terminal/controller capture or approval producer.
The shell release still uses a check followed by pathname cleanup; the tests do
not establish atomic cleanup against a replacement after that final check.

The real controller approval producer and complete business acceptance remain
integration work; real backups, custody/encryption, enterprise-network evidence
and production authorization remain separate requirements.
