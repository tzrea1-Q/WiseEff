# Legacy LOGIN retirement

> Chinese: [Chinese](README.zh-CN.md)

This R3 work remains Scratch. Its database operation disables the exact former
application LOGINs and removes their incoming membership edges. It does not
erase owners, ACLs, roles, passwords or source data. The original capabilities
must remain represented in the same verified recovery package. No new privilege
is granted. The management connection must be distinct from the retiring roles.

P13 is not implemented elsewhere under `retireLegacyWrites`: the original
P0–P10 orchestrator explicitly leaves P13 unavailable. The formal
`createApplicationReadActivation().inspect(activationIntent)` is the predecessor
seam, using existing 0137 storage with no additional tables. It verifies the exact
intent and current full binding, not current runtime approval. This slice
must not replace the verifier or promote its login-fence result into a complete
writer-retirement result. Routes, Agent, jobs, triggers and the complete new
post-retirement V01–V17/D01–D09 attempt remain separate required observations.

## Incremental threat matrix and ownership

| Threat | Required observation |
| --- | --- |
| Caller supplies a role name instead of old application credentials | Open the actual source LOGIN, bind its backend to the physical management target, derive name/OID from that session |
| Wrong database or lost host lock | Refuse before role mutations; repeat before commit |
| Current bootstrap or a privileged role missing from recovery format | Refuse without altering it; do not invent a reduced-capability restoration |
| Role membership, owner or ACL outside this database | Refuse shared scope; retain recovery material unchanged |
| Old connection remains after NOLOGIN | Not retired; NOLOGIN is not connection termination or quiescence |
| Concurrent controller or uncertain commit | Durable intent remains; inspect only, no blind retry or journal reset |
| Source role renamed/replaced or capabilities drift | Refuse the fixed OID/name/package comparison |
| Partial database fence | Never resume processes, queues or proxy |

Files under `retirement/` and the new self-hosted composition adapter are owned
by this Scratch slice. Migration, application pools, the main controller,
generated schema and the consolidated execution plan remain parent-owned.
Both this file and its Chinese companion change with the implementation.
Real PostgreSQL uses a newly owned component cluster; no ambient database URL.

The v3 recovery bootstrap is a pre-existing OID 10 identity, not a transferable
privileged role declaration. Disabling the only bootstrap LOGIN while relying on
that same identity for reconnecting management would lose the control channel.
That case requires a separately demonstrated management/restore strategy; the
ordinary packaged-role path cannot silently claim to cover it.

## Implemented entry and evidence boundary

`ops/self-hosted/scripts/parameter-catalog-upgrade/legacyWriterRetirement.ts`
constructs the genuine P12 component, verifies its applied binding and current
Catalog/source/mapping facts, and consumes the capture entry from the existing
host journal. It reopens the same package using the captured directory inode and
package digest. Actual stopped container identity supplies the old credentials;
random backend locks prove those authenticated sessions are on the independently
observed management database. Every critical step repeats host-lock, package,
container and writer-boundary checks.

The bridge-only source observer first proves the original DATABASE_URL hostname
is the fixed PostgreSQL endpoint address or its unique alias in the actual owned
network, and its port is 5432. The same observed container must publish the exact
loopback management port. Unknown network members, wrong ownership, custom DNS,
hosts overrides or mounts, multiple networks, wrong ports and alias ambiguity
refuse before opening the former LOGIN. Every critical check re-observes this
mapping and rejects endpoint drift. Only after proving Docker's actual forwarding
relationship may private credentials use that published transport; equal
credentials alone are not evidence about the original connection target.
This profile requires the existing controlled-recovery ownership nonce and
bridge with IP masquerade disabled. Unsupported deployments fail before effects.

The endpoint regression creates two owned PostgreSQL containers and a psql-only
probe with the same fixed PostgreSQL image. It queries the original URL inside
the network and independently compares system identity through the published
port, then stops the probe. Wrong-database URLs, wrong published ports and an
actual duplicated network alias are refused. The probe is not an old API or
worker image. Its trust-authenticated throwaway databases prove routing only;
the original LOGIN-fence cases separately exercise actual restricted credentials.

The adapter binds the full `activationIntent` and the domain's `bindingDigest`,
then reads the formal approved pre-activation projection and checks its artifact,
target, source, Catalog, mapping and recovery inputs against the actual binding
and captured package. It rejects a later pending/unknown capture. This is an
additional predecessor check; the parent must still dispatch the eventual P13
action through the existing release gate and prove every legacy writer retired.

Once the admin lease holds the S7 lock, both transactions use
`inspectOnHeldManagementSession` rather than trying to take the same lock on a
second lease. The inspector verifies the actual target, identity, ExclusiveLock,
UTC and strong active transaction and repeats the original boundary check. Its
SAVEPOINT/RELEASE probe has local transaction effects, with no business writes,
DDL, role changes, BEGIN or COMMIT. Reconciliation uses the same seam and requires
the event's exact binding to remain current. It cannot turn an old event into
current runtime or release approval.

`beginLegacyRetirementTransaction` starts SERIALIZABLE and sets synchronous
commit and UTC, then obtains SHARE NOWAIT locks on the same six Catalog/mapping
relations protected by P12. Both mutation transactions call this preparation
before their first snapshot-producing query. S7 alone does not fence independent
mapping or installer writers; repeating SELECT under repeatable read would only
repeat an older snapshot. Contention leaves a failed transaction for the owner
to roll back, with no intent or role effect from that transaction. The helper
does not replace the actual target, S7 lock or boundary checks.

`retireLegacyApplicationLogins` persists an intent, then applies the database
fence and an effect event in a separate transaction. COMMIT uses synchronous
commit. It does not create a P13 checkpoint or advance the run phase. Its return
is `legacy-logins-fenced-not-p13`. A retained intent is not retry permission.
`inspectLegacyApplicationLoginFence` reads actual event/role/backend state after
an uncertain outcome without needing the disabled credential or changing data.
The original owner and table ACL remain intact for restoration and historical
access; they are not proof of zero reachable writers. New runtime permissions,
trigger/route/job retirement, all-consumer proof and a full P13 commit remain
internal integration work.

The dedicated `loginFence.integration.test.ts` invokes the exact management
effect with real LOGINs and checks reconnect rejection, membership removal and
owner/ACL/value preservation, plus wrong target, lock, session, role, recovery and
cross-database refusals. It includes already-switched direct and transitive
member sessions: NOLOGIN/REVOKE does not reset another backend's effective role.
The original caller OIDs remain recorded for post-commit inspection. A matching
shared advisory lock is refused: the management backend must hold the actual
granted `ExclusiveLock`. Its negative checks role, membership, owner and ACL state
before rollback, so rollback cannot conceal a mutation. These ten
cases are database-component evidence only;
they do not manufacture P12 reports or execute the top-level adapter. The parent
must route this exact test to a newly owned PG16 cluster and exclude it from the
shared server suite. Tests are not silently skipped when a receipt is missing.
The second database for the shared-role negative is prepared in suite setup;
database creation is not part of the five-second role-effect assertion.

Both mutation and inspection install the management lease error observer inside
the pool acquisition callback, before its return. The observer remains through
lease destruction; failed acquisition destroys an acquired lease and redacts the
transport error. This resource helper does not verify a target, grant permissions
or replace the caller's repeated connection and boundary checks.

Pure command: `node_modules/.bin/vitest run --config
server/modules/catalog-cutover/retirement/vitest.config.ts`. Real SQL uses
`retirement/vitest.integration.config.ts` through the parent-owned runner; it is
not a standalone command against an arbitrary database. No production command
or production readiness is delivered by this slice.
