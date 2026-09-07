# Controlled report approval target

Chinese: [Chinese](reportApprovalTarget.README.zh-CN.md)

This management-only adapter joins the existing deployment authority to the
existing Release Verification approval command. It does not run gates, fabricate
reports, grant privileges or authorize runtime/traffic/recovery. No management
credential belongs in an API or worker container.

## Inputs and ownership

`openReportApprovalTarget` accepts explicit private management and writer URLs
and a pinned PostgreSQL `systemIdentifier`/`databaseOid`. There is no ambient URL,
injected database, successful callback or environment bypass. The controlled
management root must collect and seal that pin using its actual handoff observer.
The management login needs its existing `pg_control_system` observation capability;
the restricted writer never receives that capability.

The private deployment authority assignment may carry `reportDatabase` with that
physical pin. It belongs in the same custodian-owned, digest-pinned file as the
run, complete `RecoveryTargetIdentity` and exact report digest/purpose. Missing
or mismatched mapping refuses execution. This is an explicitly sealed mapping
collected by the outer observer, not current multi-storage observation. No
`RecoveryTargetIdentity` encoding is changed: the Docker recovery producer's
PostgreSQL identity remains its existing container/database/bootstrap digest.
The outer handoff still owns current daemon/container/volume/bucket/Redis identity,
maintenance phase and drift checks. These five-file components do not implement
that observer or assert that it has already produced a real deployment mapping.

## Session and authority checks

Every actual writer pool checkout audits effective privileges and obtains a
random session advisory lock. An independently connected management session must
observe that exact PID/database/namespace/key at the pinned physical database;
management rechecks the physical identity before and after the challenge. The
lock is released before caller SQL. Unavailable, wrong-target or unknown unlock
results reject the checkout and destroy it. This challenge is not a maintenance
lock, source freeze or approval.

The only capability is immutable migration 0139's NOLOGIN
`catalog_verification_writer_role`: six verification SELECTs, five INSERTs, schema
USAGE. Real LOGIN membership must use INHERIT true, SET false, ADMIN false.
High/reachable roles, ownership, other memberships, missing grants, extra effective
table/column/sequence capabilities, DDL, grant options, default ACLs and unsafe
function/parameter privileges refuse. PUBLIC restricted built-in EXECUTE is
checked against PostgreSQL 16 `pg_init_privs`. No historical migration is changed.
Callable system-schema SECURITY DEFINER functions also require an initdb
provenance record; a newly created PUBLIC definer cannot hide in `pg_catalog`.

`approveDeploymentReport` accepts only a factory-issued opaque target and a real
authority-issued opaque command. The command is revalidated against its current
private assignment, expiry, run, complete target, principal, purpose/report digest
and physical mapping before dispatch and again inside the existing service's
transaction after checkout. JSON copies cannot create either capability.
`openDeploymentAuthority(...).approveReport(request, target)` is the authenticated
entry to this path; passing a raw database root continues to refuse.

The existing service decides missing/not-passed reports, purpose, independent
principals and append-only persistence. A valid session or physical target cannot
turn a missing report into a passed report. A successful approval alone is not
the runtime/public-release admission decision. Unknown failures return fixed
redacted errors; the owner closes both pools on subsequent initialization failure
and normal exit. The factory closes allocated pools on admission failure.

## Evidence boundary

Unit tests reject forged targets and invalid private connection inputs. The
existing owned `authority-pg16` suite exercises actual restricted LOGIN, physical
identity/challenge, real sessions and the formal missing-report refusal, plus
privilege/assignment drift. No passed report is inserted or gate mocked. This
does not yet establish a complete approved-report positive chain, real startup,
controller upgrade, multi-storage handoff or production readiness. Those remain
parent integration work. Production connection or action is not authorized here.
