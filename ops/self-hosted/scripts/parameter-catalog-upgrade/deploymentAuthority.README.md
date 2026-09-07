# Per-run deployment authority

Chinese: [Chinese](deploymentAuthority.README.zh-CN.md)

This adapter implements the existing Deployment Operator, Platform owner and
incident-owner responsibilities for a private deployment/run. It introduces no
product role, database grant, verification purpose, restore token or release
verifier. Product Admin/Platform Admin membership alone authorizes no action.

## Trust and admission

The fixed management composition root supplies `openDeploymentAuthority` with
the independently observed source database identity, exact target/run, expected
assignment digest and an explicit private authentication connection. It also
supplies the trusted configuration custodian UID and canonical custody directory.
These inputs must come from the management handoff, never HTTP body/header role
claims or arbitrary per-request configuration. The custodian provisions the
assignment; request principals and application containers must not be able to
write the custody directory. Same-UID hostile host administration is outside this
filesystem trust boundary. A digest is an integrity pin, not proof of custody.

The assignment is a bounded JSON document conforming to
`DeploymentAuthorityAssignment` in the adjacent module. It fixes exactly three
distinct authenticated identities, one each for Operator, Platform owner and
incident owner, and excludes declared independent verifier identities. It fixes
the run, complete source target, expiry, authentication database observation,
exact report digests/purposes and optional restore attempt/capture/destination.
No default identity or wildcard grant exists. A 0700 custody directory and 0600
single-link file must have the trusted UID; symlinks and aliases refuse. File and
directory identity are pinned for the adapter lifetime and reread at admission.
Replacing even identical file contents invalidates the adapter and requires the
parent to re-plan against current custody evidence. Assignment is eligibility,
not an approval or permission to execute recovery.

The implementation constructs the existing production `AuthContextResolver`
with `createLocalAuthService(...).resolveSession`. No injected authentication
callback, development context, role field or TEST bypass exists. Sessions must
be real, current, unrevoked and associated with an active database user. The
server-owned user invocation retains the exact authenticated user/Organization;
an ordinary bearer credential does not prove physical human presence.

The pool opens only the explicit management authentication URL and validates
every actual lease, including reconnects. Elevated/reachable roles, memberships
and object ownership refuse. The observed authentication database must match its
private pin and differ from the actual source database. Authentication queries
retain their existing public-table contract, with an explicit per-lease
`pg_catalog,public,pg_temp` search path. The controlled login needs SELECT on
`auth_sessions`, `users`, `organizations`, `user_role_bindings` and
`user_password_credentials`, plus UPDATE only on `auth_sessions.last_used_at`.
This document does not provision those grants or expand any runtime pool.

Local-session resolution updates `last_used_at`; this write belongs to the
independent management authentication database, never the frozen source. The
component test uses separate databases in one owned cluster: that proves database
write isolation, not independent recovery failure domains. A control plane that
must authenticate after the source cluster stops needs separately available
authentication infrastructure and its own observed identity. This adapter does
not provision or claim that infrastructure.

## Commands and ownership

`approveReport` authenticates the requested Operator/Platform-owner role and
exact assigned purpose/report digest, then calls the existing
`VerificationReportService.approveReport` with that actual user. The report pool
is a separate real root owned by the caller. Report integrity, passed decision,
distinct approvals, immutable persistence and typed refusal remain domain-owned.
Missing/blocked reports still fail; a configured digest cannot fabricate one.

`confirmRestore` authenticates only the incident owner and exact assigned
attempt/capture/destination. Its opaque, immutable result is explicitly
`authenticated-confirmation-not-persisted`. `assertConfirmationCurrent` rereads
the pinned assignment, expiry and control database admission; a copied object
cannot become a confirmation. Neither method writes the upgrade journal, reads
a recovery package, restores data or resumes traffic. Source provenance, current
lock/quiescence and package validity still require the parent's recovery checks.

The parent must persist the confirmation with the existing journal and current
capture/handoff bindings before deriving an execution authorization. After
process restart, the parent must read and validate the durable authority record;
it cannot JSON-deserialize this in-process brand into an execution capability.
Report/restore actions must be rechecked against their actual phase and target
by their owning controller. The adapter does not grant startup approval.

Open/validation failure closes the new pool and returns fixed redacted errors.
The owner calls `close()` on later initialization failure and normal exit; calls
after close refuse. Credentials and session tokens never enter returned receipts
or diagnostics. Authenticated IDs and assignment contents remain private audit
data and must not enter public delivery artifacts.

## Acceptance and remaining integration

The unit suite covers custody, scope, expiry, independent principals and forgery.
The real PostgreSQL suite requires the existing owned-target receipt before any
connection, uses actual migrations, issues sessions through real local login,
and uses a restricted authentication LOGIN. It checks incident confirmation,
unassigned product admin/verifier refusal, actor spoofing, source exclusion,
credential revocation, pool privilege drift, assignment drift and lifecycle.
Operator/Platform owner calls consume the real domain's missing-report refusal;
there is no synthetic `passed` report or mock gate. A real approved-report
positive chain remains an integration obligation, not a claimed component pass.

The parent owns the fixed handoff configuration/credential reader, formal
controller actions, typed capture/approval journal records, current phase/pin
checks and root API/worker lifecycle. These are not connected by this five-file
component. Its future terminal selector must be added to the existing owned
component runner; no production command is supplied here. Production assignment,
backup use, restore, migration, queue/proxy changes and release remain separately
authorized. Both the implementation and its custody/authority boundary require
independent Standards and Spec review.
