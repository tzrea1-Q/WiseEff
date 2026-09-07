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

Inspection reopens the exact persisted custody version. It never creates a new
secret, retries ALTER ROLE, resets the journal, or infers success from an intent.
A missing low-level intent after a root-intent-only interruption stays unknown;
this unit does not introduce an automatic retry for that case. A completed
authentication fence still requires live P12/package/lock checks and a matching
low-level readback before returning `bootstrap-authentication-fenced-not-p13`.

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

Documentation impact is this paired root-adapter note. The parent retains the
single overall upgrade plan and owns subsequent controller/startup integration.
