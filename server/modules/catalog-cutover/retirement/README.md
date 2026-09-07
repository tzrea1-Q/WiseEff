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

Docker configuration alone is insufficient: the stopped container's actual
`/etc/hosts`, `/etc/resolv.conf` and `/etc/nsswitch.conf` are read with `docker cp`.
The existing host `tar` utility extracts only the named member to bounded stdout,
never to the host filesystem. Unknown/missing files or unsupported resolver rules
refuse. This profile requires `hosts: files dns`, Docker DNS at `127.0.0.11` and
`ndots:0`; actual hosts entries cannot redirect the original hostname, and a
container hostname equal to the database alias is rejected. The three file
digests participate in the repeated endpoint observation.
`RES_OPTIONS`, `LOCALDOMAIN` and `HOSTALIASES` container environment overrides
are unsupported. Each Docker tar must list exactly one ordinary file with the
requested name; links, duplicate members and multi-file concatenation refuse.

Endpoint refusal retains the static `SOURCE-ENDPOINT-UNPROVEN` error and adds
an enumerated stage. Diagnostics expose only counts, tar exit status and a
bounded set of option categories (`ndots-zero`, `ndots-other`, `edns0`, `trust-ad`,
`other`), never resolver contents, Docker stderr, hostnames or credentials.
Diagnostic categories alone do not authorize additional resolver options. The real endpoint
fixture requires a valid baseline before each adverse change and checks the
specific refusal stage, so an unrelated early failure cannot count as the
intended negative case. The Hosted failure at run 34125753813 had only the outer
catch location; that diagnostic increment did not establish its platform cause
or fix it, and did not change endpoint acceptance or timeout limits.

Run 34130699134 then located the Linux failure at `resolver-options`: one line
contained the categories `edns0`, `trust-ad`, and `ndots-zero`. The parser now
requires one options line with exactly one `ndots:0`, and permits only `edns0`
and `trust-ad` alongside it, at most once each. Other options, duplicates, missing
or nonzero ndots still refuse. Resolver contents remain bound by their digest;
no file, DNS server, namespace, target identity or timeout is rewritten.

This corrects the narrow string comparison, not the identity contract.
[`resolv.conf(5)`](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)
defines `edns0` as protocol extensions and `trust-ad` as DNSSEC AD-bit handling;
the latter is not a general trust guarantee. This observer does not consume AD
bits or authorize a target through DNSSEC. Its proof remains the independently
observed Docker ownership, single bridge, unique alias/address, exact published
port and the caller's physical database observation. The
[musl 1.2.5 parser](https://git.musl-libc.org/cgit/musl/plain/src/network/resolvconf.c?h=v1.2.5)
consumes ndots, attempts and timeout from options, not these two flags. The
existing `127.0.0.11`, `hosts: files dns`, host-file, container-state and resolver
override checks remain mandatory. Synthetic archive tests cover the observed
Linux token combination; they do not replace a new Hosted or real PG execution.

The parent supervisor creates two owned PostgreSQL containers and psql-only
probes with the same fixed PostgreSQL image, then supplies a private receipt.
The test child creates no resources and cannot rely on its own afterAll to clean
up after termination. It queries the original URL inside
the network and independently compares system identity through the published
port, then stops the probe. Wrong-database URLs, wrong published ports and an
actual duplicated network alias are refused. A real hosts-file override is first
shown to redirect the original URL to the second database, then rejected after
the probe stops. Docker's own hostname collision is also refused. The probe is
not an old API or worker image. Its throwaway databases use private random
passwords supplied only through the receipt and stdin; they prove routing only;
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

## Bootstrap credential work in progress

Bootstrap authentication retirement is a separate, unfinished component. Its
private custody preparation writes and fsyncs two raw credential files and their
0700 directory. The public receipt contains a random version and exact file
identities, never passwords or password hashes. Reopening requires the original
version and identities; a changed file is refused. This filesystem evidence is
not a PostgreSQL rotation, P13 evidence, or production approval.

The low-level SQL action requires an actual standard OID 10 management lease,
the existing exclusive S7 session lock, the exact database target, zero other
bootstrap sessions, no bootstrap memberships, and the supported SCRAM TCP
profile. It retains role attributes, names, OIDs, owners and ACLs. It records
its own authentication intent and applied events in existing 0137 storage;
neither event advances the cutover phase or creates a P13 checkpoint. A prepared
run is sufficient for the isolated management-action test. The eventual root
entry must additionally prove the real P12 binding, approved report, recovery
package, stopped writers and issued host lock before calling it. This component
has no maintenance CLI and supplies none of those missing approvals.

The initial single-database prototype did not support the usual business
database plus default maintenance database. The bounded extension permits only
the actual `postgres` database with OID 5, bootstrap owner OID 10 and default
database ACL. A separate read-only connection derives its endpoint from the
already verified manager, checks the same cluster and observed database OID,
and rejects non-bootstrap objects (PostgreSQL 16 `FirstNormalObjectId` 16384),
custom namespaces, non-default public schema ACL, grants to additional user
roles, default ACL, foreign/large objects, publications, and active sessions.
It closes before rechecking database inventory and bootstrap sessions. A name
match alone is insufficient; another business database remains unsupported.
The password transaction also holds a SHARE lock on `pg_database` to prevent
database inventory changes during its mutation. These checks do not constitute
the root controller's stopped-writer proof or expand the supported restore
package. The first owned business-plus-maintenance runs collected 10 cases,
with nine passing and the positive action refused. Subsequent precise session
classification found one PostgreSQL logical replication launcher, not a leaked
client; the initial failure cannot be attributed uniquely to the single-DB
restriction. The supported profile now permits at most one database-less,
transaction-less built-in launcher, but refuses all clients, replication
workers and unknown backends, and requires no replication slots or subscriptions.
Transaction sampling, parse/rewrite/plan debugging and statement statistics are
refused before any intent or BEGIN; disabling sampling inside an already sampled
transaction cannot protect its password statement. The later owned execution
below does not change those earlier failed results.

The password transaction separately disables `track_activities` and checks that
setting on the same lease before sending the password statement. This prevents
statistics readers from observing the statement through `pg_stat_activity`;
logging settings alone do not provide that protection. Inspection snapshots its
target, run, attempt, custody and client before its first await, so caller mutation
cannot replace the selected recovery attempt. The new statistics-reader and
asynchronous-selection regressions were executed separately: old implementation
with the stronger tests at runner candidate `34f3c12a8` collected 18, passed 16
and failed 2; fixed runner candidate `75a88cf0687a07a93367f18e2e0ba228a4176684`
passed all 18 in 3.75 seconds, with verified resource cleanup. Its code/test blobs
match component `3ec370aeb`; the earlier 17-case result does not cover these fixes.

Two subsequent process/transport cases are pending execution. They forward only
to the receipt-proven isolated database and observe actual server COMMIT replies.
The first holds the intent commit acknowledgment and terminates the real child;
inspection must find the unchanged old credential and the original pending intent.
The second drops the actual connection after the password/event transaction
commits; a fresh management connection must reconcile that same private version.
No COMMIT reply, authentication result, applied event or approval is fabricated.
The existing test/supervisor timeouts remain unchanged. These cases concern the
authentication component, not whole-state recovery eligibility or completed P13.

Template flags are not an escape from the database inventory. Only the actual
default template OIDs 1 and 4, bootstrap owner and default template ACL are
accepted. Connectable `template1` receives the same independent read-only
catalog inspection as the maintenance database. `template0` must remain
non-connectable with no active sessions; it is preserved under this default
template profile, not opened or claimed to have had its business contents
queried. Additional template databases and user state in `template1` refuse
the action. No template flag, ACL or connection policy is changed by the effect.

The private version is persisted before the first SQL intent. The password
transaction changes only the authentication secret and records its applied
event atomically. A lost acknowledgment is not retried: inspection requires the
same run, attempt and original custody identities, unchanged metadata, new
password authentication to the same OID/database, and old-password rejection.
Only SQLSTATE `28P01` counts as a password rejection. Network failures, missing
private files and inconsistent event/authentication results remain unknown.
Its success label is `authentication-fenced-not-P13`.

The source through `4ba8a753020b178967e271abc3e5034309a3150e` was executed with
the dedicated parent-owned runner at actual checkout
`f122a62854c46cdbcb96668d17b549b215a28af3`, tree
`f44599a6af253d187bc771c6a72a79970ecba986`: **17 collected, 17 passed, zero failed
or skipped**, 2.43 seconds, exit 0 and verified resource cleanup. The positive
case took 314 ms. This used `postgres:16-alpine`, Linux arm64 image
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
The actual log is `/tmp/upg824-bootstrap-seventeen-fixed.log`, SHA-256
`e67b4d5c9aca7e50a971607056378189ea3a834127397954666988a5008a7809`.
This is local coordinator evidence, not an uploaded attachment or a run on this
documentation commit. It proves the actual old/new password lifecycle and the
listed refusal cases, preserving bootstrap OID, attributes and representative
owner/ACL/data. It does not yet cover unknown commit acknowledgment or process
interruption, a complete role-restoration cycle, real API/worker startup,
production authorization or the complete controller/P13 chain. Independent
whole-slice review is still pending.

Two invalid test invocations during this work used `vitest.server.config.ts`
instead of this directory's pure config. Both collected zero tests and failed in
`server/testing/testDatabase.ts` while checking the shared migration ledger.
Before that failure, the setup can create a migrations template, remove stale
test databases, and execute ledger bootstrap DDL. The logs do not establish
which of these writes occurred; no rollback or absence of writes is claimed.
The executions used head `d3e2af891c198859a25753cc98bf5d21d379e5c3`
plus two untracked bootstrap files. Their logs remain
`/tmp/pr824-bootstrap-custody-red.log` and
`/tmp/pr824-bootstrap-custody-green.log`; neither is valid Red/Green evidence.
A later environment-only observation found no explicit database URL, but it
cannot establish the earlier processes' environment. The configuration's
fallback is the loopback default database, without an independently issued
target receipt. No follow-up connection or cleanup was performed against it.

Use the existing pure `retirement/vitest.config.ts` with an empty environment
except PATH/HOME and the exact `bootstrapCredentialFence.test.ts` selector.
It has no database setup. Future real PostgreSQL cases belong in a separate
`bootstrapCredentialFence.integration.test.ts` and require a new parent-owned,
exclusive cluster/receipt; the general server suite is not its execution path.
