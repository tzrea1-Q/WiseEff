# Bootstrap source authentication retirement adapter

[中文](legacyWriterRetirement.bootstrap.README.zh-CN.md)

This unit extends the existing `retireLegacyApplicationLogins` root adapter for
the exact OID 10 source login. It does not relax the ordinary role fence or mark
P13 complete. Its dependency is candidate `8ed7ac196b34caf351e7331f6e2be15ea7f8a5d3`;
the Scratch branch was created from local main and advanced to that exact
candidate before this path-owned change. No migration or grant is added.

The root still proves the stopped handoff, effective source endpoint, original
credential's actual backend, current P12 binding and approved report projection,
same-boundary recovery package, directory inode, target identity and issued host
lock. Bootstrap support additionally requires an explicit private
`bootstrapCredentialDirectory`, a direct child of this run's locked private root
and outside the backup package. There is no default path or secret argument.
The original password comes from the already checked source container URL.
The existing credential custodian creates and syncs the new private version;
neither passwords nor password hashes enter the root event or result.

Before invoking `applyBootstrapCredentialFence`, the root persists a
`bootstrap-application-authentication-intent` in the existing 0137 event store.
It binds the P12 intent/binding, handoff and recovery digests, target, attempt,
custody directory and issued receipt. This is neither a P13 checkpoint nor a
runtime grant. The low-level fence retains its own intent/applied events and
authentication/owner/ACL invariants.

## Lock and lifecycle boundaries

| Lease or operation | Required fact and compatibility |
| --- | --- |
| Independent guard | Existing restricted management LOGIN, no reachable high role, explicit SET to the existing migration owner |
| Guard identity | Exact session PID/advisory challenge observed by the already identified OID 10 backend; no new system-function EXECUTE grant |
| Guard inventory | Six existing Catalog/mapping SHARE locks remain held across both low-level commits and final inspection |
| Bootstrap manager | Sole S7 session-lock holder; current P12 is inspected on this same lease in a short read-only transaction |
| Low-level effect | Its own run/event writes and role alteration do not write the six guarded relations; actual two-session compatibility remains to be verified |
| Guard error/end | Immediately destroy the mutating connection; retain an unknown outcome if execution started |
| Cleanup | Attempt both lease releases, pool close, custody close and package-directory close; errors do not replace the earlier refusal |

`acquireBootstrapInventoryGuard` is the actual root resource implementation,
also exercised by the existing owned PostgreSQL fixture. It does not authorize
P12, recovery or retirement: it acquires no credential and performs no stage
effect. Its guard holds no S7 lock; the mutator owns that lock. No connection
pool is enlarged in production. Each guard verification observes the exact six
relation locks and mutator S7 lock. Guard loss destroys the actual mutator.

The low-level `beforeEffect` lifecycle constraint is installed by the root's
own closure, never accepted in root input. The closure rechecks the issued host
lock, source/package/journal boundary, held guard and formal report projection before each event append,
password change and COMMIT, and after the first COMMIT. It uses the existing
sessions and starts no nested transaction. The low-level API without a hook
remains only a management component, not a supported maintenance entry point.
The report is read again because its retention deadline can pass independently
of the six inventory locks; an earlier approved projection cannot replace that check.

Inspection reopens the exact persisted custody version. It never creates a new
secret, retries ALTER ROLE, resets the journal, or infers success from an intent.
A missing low-level intent after a root-intent-only interruption stays unknown;
this unit does not introduce an automatic retry for that case. A completed
authentication fence still requires live P12/package/lock checks and a matching
low-level readback before returning `bootstrap-authentication-fenced-not-p13`.

After a successful rotation the old source and old management passwords cannot
connect. Inspection therefore requires an explicitly supplied, valid private
`administrativeConnectionString` from the retained credential custodian's
authorized maintenance input. Source URLs stay unchanged. The adapter does not
guess old/new passwords, use ambient configuration, expose a password-returning
API or automatically construct that private input. The current root mock test
proves that inspection does not reconnect the rejected old source credential;
a separate-process **whole-root** inspection with genuinely approved P12 and
capture predecessors is still unexecuted. Existing independent-process
low-level inspection evidence does not fill that gap.

## Validation scope

The direct root tests execute the real root function and real private custody
file lifecycle. PostgreSQL, Docker, approval and P12 observations are test I/O
substitutes. They prove dispatch, binding, refusal and cleanup behavior only;
they are not an actual approved upgrade or an actual password rotation.
The previously executed low-level PostgreSQL authentication tests retain their
own SHAs. This root integration still needs actual two-session lock compatibility,
guard termination during commit and the complete legitimate P12/report/capture
predecessor fixture. It must not use an inserted `passed` report to obtain that
evidence. No production command is supplied.

The appended PostgreSQL tests execute this root's real guard and the existing
authentication effect on a prepared run. They retain all 22 existing tests and
their timeouts, and add restricted LOGIN/SET-negative, cross-COMMIT lock,
actual guard backend termination and actual host-lock-holder termination cases.
Their prepared run is not a forged P12 checkpoint or report approval.

| Actual candidate | Execution and scope |
| --- | --- |
| `dba3e7f8d` | Parent owned `bootstrap-credential-pg16`: 25 passed / 2 failed, 5.49s, exit 1, cleanup verified. Host-lock loss still allowed the password write; a separate fixture incorrectly expected the image's existing `pg_control_system` permission to reject. The positive guard test had not reached its two commits. |
| `290b0e240a1cdda22bfff7bedfbe5207f3c10a22` | Same owned selector: 27 passed / 0 failed / 0 skipped, 5.55s, exit 0, cleanup verified. Actual cross-commit guard, authentication readback and holder/backend loss tests passed. |
| `22bdf0e1d462635cd17b39ce4f4c13ad1681efff` | Subsequent root-only report-retention fix: 75 pure root tests passed and targeted strict types passed. Its Red was 14 passed / 1 failed. It does not relabel the PostgreSQL execution above as this commit. |

The parent used `postgres:16-alpine`, linux/arm64, image ID
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
The raw Red/Green log SHA-256 values are respectively
`704b6106abda7548b99f7fc26afad0c4c61ef7924f78beab51feaf8d8c1fb28c` and
`b770f8952c3c67ef244f4c85695381d26dc0da20663fc9abdcfed8c91fbd0a06`.
This is isolated component evidence, not full-root approval, startup, P13,
business queue acceptance, Hosted evidence or production authorization.

Documentation impact is this paired root-adapter note. The parent retains the
single overall upgrade plan and owns subsequent controller/startup integration.
