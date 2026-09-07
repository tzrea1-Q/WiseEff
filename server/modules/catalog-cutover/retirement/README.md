# Legacy LOGIN retirement

> Chinese: [Chinese](README.zh-CN.md)

## Authentication inspection after the SQL successor

This separate Scratch starts at main and fast-forwards `5f7a3d5b4`.
The existing authentication baseline includes relation ACLs. A later, legitimate
seven-table SQL fence therefore makes the original authentication-only inspection
return unknown. The 19 SQL component cases do not prove that combined lifecycle.

The repair must consume the original persisted authentication/root intent and
the exact subsequent SQL intent/applied pair, matching run, attempt, physical
target, P12 binding, root request and recovery package. The root must also verify
the actual host pending/applied digests. The existing SQL inspector must prove
the current effect, under its real locks. Only that verified successor's exact
relation/column ACL delta may participate in reconstructing the original
authentication baseline; no generic baseline override, caller mapper or
checksum-only authorization is admitted. Every other observed metadata field
retains its original equality check. Existing custody transport remains private,
uses only the original version's new secret, and exports no privileged client.

The permanent Red must actually rotate credentials, revoke grants and invoke
inspection in a separate process using the retained custody. Wrong run/target,
missing or mismatched host steps, extra ACL changes and changed non-ACL metadata
must remain unknown. Inspection must not rotate, revoke, issue P13 completed or
silently promote uncertain host writes. A storage-only P12 fixture remains
explicitly unapproved. Before implementation this is a threat proposal, not a
successful combined execution.

The first actual Red at `0c1c3cc33` collected 28: 27 passed and the final
independent-process successor assertion failed with unknown (9.98 seconds,
exit 1, cleanup verified). Its original four transport modes and the actual
seven-table SQL effect/zero remaining UPDATE assertion passed first. Log
`/tmp/pr824-successor-red.log` has SHA256
`7dcb02c8669c12f0998c7442c4ad4d6d083a2977a98606e4678730db6c7f4c77`.
This is a valid combined-lifecycle Red, not an installer or timeout failure.

The candidate shares the original SQL owner's locked readback between its
ordinary inspector and a held-session inspector. The latter verifies actual
backend, target, transaction and all seven relation/ten catalog locks;
no declared-held boolean is accepted. The private custody owner keeps those
locks through authentication, exact baseline reconstruction and the final P12/
root boundary checks. This inspection has no DML but requires a read/write
transaction for ACCESS EXCLUSIVE locks. It returns only the existing bounded
authentication outcome. The original baseline format has no column ACL member;
column ACLs continue to be checked by the SQL owner's complete before/after
inventory rather than changing that format. Root dispatch passes its original
issued host lock and journal selection; the facade reads actual host steps.
Extra grants, new relations and missing/wrong host selection have permanent
real-IO counterexamples. Candidate Green and independent final reviews remain
pending; the original SQL 19-case result does not cover this new inspection.

Review exposed two additional real failures at `5c46be585`: copied generic host
SQL steps without the original capture/credential chain were accepted, and a
GRANT in the final boundary callback escaped the released locks (28 passed,
2 failed). Moving that callback inside the transaction at `317aa226e` closed
the host mismatch but still returned 29 passed/1 failed: an existing grantee's
ACL update is not serialized by the relation lock or an unchanged shared
dependency. Neither execution is a final Green.

Every SQL-owner transaction now takes SHARE NOWAIT on the exact observed
catalogs before its first snapshot: `pg_authid`, `pg_auth_members`, `pg_shdepend`,
`pg_class`, `pg_attribute`, `pg_namespace`, `pg_proc`, `pg_type`, `pg_database`
and `pg_default_acl`. Acquisition and held-session checks share this list.
The first three and `pg_database` affect cluster metadata; the remaining locks
temporarily exclude conflicting metadata writes in the current database. This
can refuse concurrent DDL/ACL work; it is not only a seven-table lock. No grant,
schema, timeout or baseline format changes. The last real boundary runs before
SQL/authentication rechecks under these locks. Table/column GRANT and CREATE
FUNCTION adversaries must receive 55P03 there and succeed after release.
Host readback also requires the parser-validated capture and credential chain,
exact root request/version/digest, cutover run and plan, before the SQL steps.
Both owners accept the existing recovery package's bare 64-hex digest, matching
the root's `backup.digest`; earlier synthetic prefixed values hid this mismatch.

Exclusive paths are the existing bootstrap credential module/owned integration
test and fixture, SQL fence module/test where needed for its own inspection,
the existing retirement root/tests, and this README pair. Runner/CI and shared
migrations/grants remain outside this fragment.

## Bounded legacy SQL privilege effect

This Scratch implementation uses the existing retirement root and
`legacySqlPrivilegeFence.ts`. Its actual owned PostgreSQL component validation
passed as recorded below. It removes
independently reachable legacy SQL grants; it produces no P13 completed
checkpoint, runtime generation, startup pin or approval.

The fixed inventory is the four existing `LEGACY_STRUCTURAL_TABLES` in `public`,
plus `public.driver_schemas`, `public.driver_schema_versions` and
`public.dts_property_specs`. Only table INSERT, UPDATE, DELETE and TRUNCATE and
column INSERT and UPDATE are eligible for revocation. SELECT, owners, other
relations, schemas, functions and role memberships remain unchanged. Remaining
REFERENCES/TRIGGER, owner and superuser capabilities block this grant-only step.
Opaque executable mutation paths remain outside its proof and must still pass
the existing V13 verifier before full retirement; this module does not duplicate
that verifier or authorize broader REVOKE.
No CASCADE, role deletion or new grant is introduced.

The root reuses its already authenticated, explicitly configured management
lease and S7 lock. It checks actual role/owner/grantor authority before selecting
ACL changes; a Catalog management role name or 0137 INSERT privilege alone is
insufficient. A denied restricted connection never triggers administrator
fallback. The private custody facade never exports a client for this operation.

Candidate identities come from the actual runtime-role source, while original
source identities remain separately authenticated through the stopped-source
boundary. Neither caller role names nor candidate configuration alone identify
the ACL scope. Actual object/role OIDs, PUBLIC, column grants and INHERIT/SET
paths must be observed. Cross-database/shared use, unidentified principals,
unsupported grant chains or incomplete recovery association refuse before any
REVOKE; unrelated business permissions are not collateral cleanup targets.

The original verified PostgreSQL package remains the restoration authority. An
exact pre-effect inventory retains object/column/owner OIDs, nullable raw ACLs
versus defaults, grantor/grantee identities, grant options and membership edges.
It binds the same target, source, P12 intent/binding, approved report, retained
package/capture, host run and attempt. This inventory describes the immediate
source-side CAS preimage, not capture-time ACLs or a new GRANT-based restore
interface. Whole-state recovery returns to the original captured state, not to
each post-capture privilege change. The original snapshot dump already includes
owners and ACLs; its existing verified producer/package/source/role boundary is
retained without an additional restore or an invented per-ACL archive oracle.
Source OIDs bind the live CAS only; logical schema/table/column and role names
identify objects across restore, where OIDs can change. Post-effect readback
must prove that only the selected grants changed.

The existing host pending boundary and a dedicated 0137 P13 step intent must be
durable before REVOKE. Every write and COMMIT retains the root's last-await lock,
report, package and live database checks. Actual acknowledgment and exact
readback are required for the step result. An uncertain commit preserves its
intent for exact inspection, never blind REVOKE replay. No second S7 lock or
recursive max-one-pool checkout is allowed; cleanup must retain the first error.

The existing root opens the branded runtime-role source before credential
retirement and re-observes it throughout the SQL effect. Its already held six
P12 inventory locks are retained. The SQL owner separately locks all seven
legacy relations before the first snapshot in each transaction. Before identity
observation the actual management search path must have `pg_catalog`
first. The same transaction also takes SHARE NOWAIT locks on `pg_authid`,
`pg_auth_members` and `pg_shdepend`: these briefly freeze cluster-wide role and
shared-dependency metadata writes, including conflicting DDL/ACL operations,
not only the seven tables. Existing contention refuses immediately. It commits an
immutable intent, then performs and commits exact REVOKEs and their actual
readback. A third transaction holds the seven locks across fresh readback and
the root's host acknowledgment. No borrowed pool/client is closed by this owner.
The ACL preimage records role recovery names; it does not assert that later role
attributes or memberships equal the original capture, or independently restore
them. All current membership edges remain part of the effect CAS.

`inspectLegacySqlPrivilegeFence` reads the exact original run/attempt/selection
and intent digest under the existing management/S7 boundary. It can distinguish
no intent, intent-only unchanged state, and the exact committed grant-only
effect; malformed records, changed ACLs or lost boundaries return unknown.
It never replays SQL or promotes a host pending entry. The existing root's
inspection currently remains credential inspection only: automatic root SQL-step
reconciliation and the ordinary LOGIN SQL branch are still internal gaps.

Permanent cases cover root dispatch; actual direct, column,
PUBLIC and INHERIT/SET writes; preserved SELECT/owner/unrelated business access;
insufficient grantor authority; shared/unidentified use and grant dependencies;
intent persistence failure with zero REVOKE; and commit/host-lock loss without
replay. The original-root Red was one failure with 50 filtered: the new effect
was not called. The root now passes 54 pure/real-host-FS cases, including host
pending failure with no SQL dispatch, effect uncertainty retaining pending, and
runtime-source target mismatch before credentials change. SQL/report/Docker
ports in those cases are substitutes. The first fixed owned run at `490b976d6`
collected 17: five passed and twelve failed, 90.35 seconds, exit 1, cleanup true.
The unsafe search-path case genuinely returned success. Eleven other failures
were fixture UPDATE prerequisites: changing `definition_lifecycle` invoked the
existing DTS trigger without its required read access. The fixture now updates
the real structural `specification_key` column, preserving the actual row-count,
UPDATE denial and other assertions; no trigger or extra grant was introduced.
The log `/tmp/pr824-sql-privilege-pg-red.log` has SHA256
`0047ddf3ae7b13bfa2a53840d7a641b94d4e5186491c074a1ead0ad006b7e27c`.
The next fixed Red `d101d5ded` passed 16/18 in 95.04 seconds, exit 1 and cleanup
true. Only unsafe resolution and the actual concurrent `pg_write_all_data` grant
failed: the latter grant succeeded during final host acknowledgment and the
actual LOGIN could UPDATE afterward. Its retained log is
`/tmp/pr824-sql-privilege-membership-red.log`, SHA256
`40239689884ee73630ffa74ec193fe078e6dd54bd4d673d532a97e7947f82ba4`.
The management-resolution and role-metadata-lock fixes at `f1064b650` passed
18/18, 94.76 seconds, exit 0 and cleanup true. Its log
`/tmp/pr824-sql-privilege-pg-green.log` has SHA256
`0da0d4c778fc5af765848dafe2219663265d9a4e33913ae2956052a1442138f6`.
The subsequent fixed `175a6e320` adds a separate owned database: its actual
GRANT SELECT at final host acknowledgment succeeded and created a new shared
dependency, despite the existing role locks. That Red was 18/19, 104.66 seconds,
exit 1 and cleanup true, in `/tmp/pr824-sql-privilege-dependency-red.log` (SHA256
`c14028dcbd4dcf69ad15da61a01e124bc278c8bdf46d219e7cdf00fc83ad1e1d`).
The new fixture
initially passed a real `pg.Client` to a query-only helper typed as `PoolClient`;
targeted types rejected it. It now uses the existing actual observed pool
checkout and independently closes that pool and database; no cast or helper
contract change was used. The file
uses actual P0–P10/P12 storage with explicitly unapproved references and
tests authentication-independent SQL effects. Host-ack failure after real SQL
commits is an injected host failure, not a network COMMIT fault. No full root
P12/P13 approval or full writer retirement is claimed.

Fixed `2a9b22e2b28e9254f7635e56e7feb897b40bdb99`, tree
`11018998b52e927564b64e8fbc506ee815e98759`, passed all 19 actual cases in a clean
detached checkout: 104.13 seconds, exit 0, runner and fixture cleanup verified.
The concurrent role grant and cross-database ACL grant both received `55P03`
inside the acknowledgment window, then succeeded after the transaction locks
ended. The exact command was `env -i PATH="$PATH" HOME="$HOME" node --import tsx
scripts/run-upgrade-component-tests.ts --expected-daemon-id <independently
observed owned daemon> --suite legacy-sql-privileges-pg16`. Node was 22.22.3;
the actual PG16 linux/arm64 image was
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`.
The final log `/tmp/pr824-sql-privilege-dependency-green.log` has SHA256
`fb454b14d7ea1f34ec0729978d411dde41a3bc00ef6de19231a32d508887a58b`.
Independent Spec and Standards reviews passed this bounded component. Later
documentation-only commits do not acquire that execution identity.

Exclusive paths: this README pair; `legacySqlPrivilegeFence.ts`, its `.test.ts`
and `.integration.test.ts`; adjacent
`vitest.legacy-sql-privilege.integration.config.ts`; and the existing root
`legacyWriterRetirement.ts`/`.test.ts`/`.bootstrap.test.ts`. The parent owns mandatory routing and
generic-suite exclusion. No migration, permission manifest, shared journal type,
report format or frozen baseline changes belong to this unit.

The root `inspectLegacyApplicationLoginFence` now dispatches this transport before
constructing any old-secret administrative pool. It binds the borrowed actual TCP
socket to both already verified source endpoints, retains lock/package/report/P12
checks, and returns the lease before a final max-one-pool P12 read. Root `44d63de87`
passed 95 orchestration regressions and independent review; these are not a full
approved-root PG invocation. The organization Archive failure recorded below was
subsequently fixed and independently tested in the [Archive evidence](../archive/README.md);
the original custody executions remain platform-scoped.

## Private custody transport inspection

`inspectBootstrapCredentialFenceFromCustodyTransport` returns only the existing
authentication inspection outcome. It borrows an actual restricted management
LOGIN and reads the unique existing `bootstrap-application-authentication-intent`
for the complete non-secret root binding. It recomputes the request digest and
compares every root field before reopening that exact custody receipt. It never
chooses the latest attempt, prepares another secret, retries ALTER or falls back
to the old password. No password, URL, client or administrator callback escapes.

The supported transport is an already-connected plain TCP socket with actual
peer `127.0.0.1` and its observed port. TLS, Unix sockets and other peers are
refused. Loopback is a transport limit, not authority: the enclosing root must
independently prove this endpoint through its stopped handoff/Docker observation.
The facade verifies the login and physical database before reading the secret;
a random actual session-lock challenge and target identity bind the new private
OID10 connection back to the reader. Mutable client host/port fields and ambient
connection variables are not used as routes.

The borrowed session must start in autocommit. Its own transaction obtains the
six existing activation inventory SHARE locks before a snapshot, then becomes
READ ONLY. SET LOCAL and rollback restore the caller's login. The new OID10
session takes S7 and invokes the actual activation owner's same-session inspector
before and after authentication inspection. The guard stays held throughout,
preventing non-S7 mapping writers from producing an ABA between snapshots. Root
records are also re-read through fresh OID10 transactions. All owned pools/FDs
are closed before returning; the borrowed client is never released or ended.

The root still owns host lock, stopped source/endpoint, package, applicable
approved report and current P12 checks. This facade is not P13 or runtime
approval. After a first-COMMIT interruption before ALTER, the prepared new secret
cannot connect; unknown preserves that version and does not retry the effect.

The new test-only fixture reuses actual shared fixture writes, S7 P0–P10 and existing
epoch/storage transactions. Its P12 reference, handoff and package identities
are explicitly unapproved component inputs, never release evidence. The child
receives only a restricted guard URL and complete non-secret selection after
the original custody and OID10 connections close. It checks exact inspection
and cross-run/package drift refusal. Actual `9d26ab1c2` collected 28, passed the
original 27 and failed fixture planning before the facade; it is not a valid
transport Red. `e518f7047` also passed the original 27 and failed preparation:
the actual 0081 constraint rejected a structural key in a DTS property surface.
Neither failure reached the facade. The correction uses `seedSpecBindingGraph`'s
existing optional-property path, without creating or deleting a DTS property.
It reads back the residual definition/version before requiring actual R10
classification. This older no-Binding P2 path is not application quiescence.
The corrected fixture and implementation have separate execution evidence below.

Further isolated preparation `6424d31f5` and `90f8dbbfc` each collected 28 with
27 passed and one preparation failure; both cleaned their owned resources.
P0–P6 actually completed. P7 rejected the organization-owned source because the
archive plaintext detector treats its long organization ID as private payload,
while the same owner ID is required in archive metadata. This is an internal
archive compatibility gap, not missing production authorization. No detector,
ID length, owner metadata or safety check is weakened here. The transport fixture
instead uses the already-supported platform source shape. The shared fixture's
`organizationId` type now expresses its existing SQL NULL behavior; its SQL and
constraints are unchanged. This slice does not validate organization archives.

Actual owned PG16 Red `84a17cd477b3dce72057dde76d8697e7b67ee04a`
passed preparation and all original 27 cases; the new independent-process exact
selection returned the stub's `unknown` instead of the existing fence digest
(28 collected, 27 passed, 1 failed, 6.21s). Green
`312400172a4c0b43f4c6cc5efcd58ef72c30882b` passed all 28 in 8.59s,
including exact selection, cross-run/package drift and actual borrowed-client
`end` refusal. Both runs verified owned-resource cleanup. The latter also proves
the six-lock/READ ONLY statement order is accepted by actual PostgreSQL 16.
Logs `/tmp/pr824-custody-transport-platform-red.log` and
`/tmp/pr824-custody-transport-platform-green.log` have SHA-256
`3bb3fc37665a92382b614231b921421e79be6eda7a993471a497a617d3f9f681`
and `ebb3c4cf4d075ed003fb9b67fe5e98547de4cbbacef285b898e449e54d8ccf4c`.
These are local component observations on those exact checkouts, not execution
of this evidence-only update, Hosted or a formally approved whole-root P12/P13.

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

### Bootstrap fault transport and Linux small-packet delay

Hosted run `34138417314`, head `c04d42703`, passed the endpoint lane's 16 cases
but returned 20 passed / 2 failed in bootstrap acceptance. Both failures reached
the unchanged 2000ms wait without observing COMMIT 2; the COMMIT 1 cases passed.
This did not establish a credential, PostgreSQL commit, or production failure.

The proxy split server responses into individual PostgreSQL frames while both
new TCP sockets retained Nagle's algorithm. The locked `pg` client's connection
already calls `setNoDelay(true)`. The test proxy now does the same on both sockets
before forwarding. Frame parsing, wire bytes, selected COMMIT interception,
2000ms observation limit and the original test/hook budgets are unchanged.
[Node's TCP documentation](https://nodejs.org/docs/latest-v22.x/api/net.html#socketsetnodelaynodelay)
describes the default buffering and this setting; no server or runtime fence
configuration changes.

A bounded Linux/arm64 Node 22.21.1 container, image
`sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf`,
ran the actual `c04d42703` proxy with 30 synthetic loopback request/reply cycles.
Original: 1263ms total, 42ms median; with the socket setting: 5ms total, 0ms
median. Both preserved bytes and intercepted COMMIT 2. The container had no
network access, mounts or secrets and its exact owned identity was cleaned.
The preceding macOS comparison was 5ms versus 4ms, so it did not reproduce the
delay. An initial container invocation omitted interactive stdin and produced
zero observations; it is not passing evidence. Only the corrected two-result
invocation supplies the Linux comparison. No PostgreSQL was used in this probe.

`scripts/bootstrap-fault-proxy.test.ts` executes the actual proxy function from
the test's syntax tree against synthetic TCP frames, without importing its
database setup. It requires native no-delay configuration before either socket
forwards bytes, exact replies, COMMIT 1 hold / COMMIT 2 disconnect, and cleanup.
It uses no speed threshold or fake SQL/approval result. The two new cases failed
on the unmodified transport and passed after the change. Real bootstrap 22-case
acceptance and a new Hosted run remain separate required execution evidence;
this protocol regression alone is not a successful credential fence or P13.
