# Verify-only startup adapter and management observation

Chinese: [中文](README.zh-CN.md).

This slice continues candidate `1190ba591`. It does not connect the API or worker
startup callback, produce P12/P13 effects, authorize production, or complete M2.
The existing startup refusal remains necessary until the controller supplies the
real current boundary and the parent connects the composition roots.

`verifyIsolatedCandidateStartup` calls only the existing
`createStartupRuntimePin().readApprovedRuntimePin` projection. That module still
owns report selection, approval and retention. The adapter holds the target
owner's maintenance boundary, observes live state, reads the projection, matches
the exact selected report and phase/lineage/target pins, then observes again.
It copies the first observation so mutation of a shared object cannot hide
drift. Its positive result is scoped to isolated candidate startup. It invokes
no startup effect, queue, proxy, report write, migration or repair.

`verifyPublishedCandidateStartup` handles the separate published-restart check.
Its observation owner must lock activation/configuration/retirement metadata;
normal business traffic does not pretend to be a maintenance quiescence proof.
It consumes the existing runtime and approved-report projections, requires the
current public report and closed pointer-only rollback eligibility, and binds
runtime to the actual P12 pre-activation report and acceptance to that runtime.
The public report must name exactly those three predecessors. Historical runtime
phase/rollback values are not rewritten to match the later publication. Its unit
tests do not implement the observation producer or demonstrate process startup.

The `StartupTarget` port is not yet implemented by the root controller. It must
derive every field independently of the report under its real lock, including
the latest runtime report selection, completed P12 action, retired P13 state,
retirement fingerprint, generation and all fixed inputs. A caller-built object,
environment flag or P10 checkpoint is not a production implementation. Missing
state must refuse; there is no default that returns a synthetic boundary.

`catalog-cutover/runtimeState.ts` supplies one part of that producer. It reads the
actual system identifier/database OID and complete migration ledger, matches the
independent packaged filename/checksum inventory, and uses the public Kernel
`loadCurrentCatalog` interface in its own transaction. It also
captures run, checkpoint, current mapping-head and Archive-record observations.
Only their digests leave the module where rows may contain private references.
The observation's `approvalState` is always `not-produced`: installed Catalog
state and a completed P10 run do not establish P12/P13 or runtime approval.
The observation digests are explicitly not a newly defined mapping epoch,
Archive package digest or complete `VerificationPins` producer. Object bytes,
Redis, host/Compose/artifact identity and the recovery point require their real
owning adapters. Each metadata observation uses REPEATABLE READ READ ONLY;
the Kernel owns a separate read transaction. The mandatory
`RuntimeObservationBoundary` must fence relevant writers throughout both
metadata observations and the Kernel call. The observer verifies that boundary
before/after reads, compares all metadata facts/digests and all public snapshot
pins, and refuses boundary loss or drift. Equality alone is not a substitute for
the real fence (including an intervening change and reversal). No transaction or
callback is passed into the Kernel, and no private Kernel implementation is
imported. The public seam and frozen transaction ownership stay unchanged.

## Permissions and ownership

| Connection | Existing capability | Limit |
| --- | --- | --- |
| Source/installer management pool | Actual source inventory, `public.schema_migrations`, Catalog projection, Cutover/mapping/Archive reads and system identity | Controlled management phase only; never passed to API/worker |
| Startup report reader | `0139` `catalog_verifier_role`: schema USAGE and SELECT on six verification tables; the projection reads plans, reports and approvals | Separate restricted login/pool; no verification writer, governance writer, synchronizer or migration-owner membership |
| Runtime Catalog reader | Authorized additive `0140` `catalog_runtime_reader_role`, ten explicit Kernel tables | No Binding, governance, activation or management metadata capability; runtime connection integration remains separate |

`0138` does not grant `catalog_migration_owner` SELECT on `schema_migrations`, so
the observer deliberately uses the source/installer pool rather than silently
granting that privilege. Its transactions and the Kernel-owned read are read-only.
Unknown rollback outcomes destroy the connection. This is not evidence that
the management login is an acceptable runtime identity.

No SQL grants or role attributes change here. Report reads use the already
approved `0139` interface and do not need either of the two proposed `0140`
governance-writer EXECUTE additions. Those additions remain unapproved. The
parent must validate the dedicated login. The shared runtime guard explicitly
rejects reachable `catalog_verification_writer_role` membership.

The frozen sequencing is P12 activation, P13 retirement, then a new complete
post-retirement verification attempt and approval. The existing runtime query
uses P13 `retired`; this adapter preserves that semantic value. There is still
an existing caller mismatch to resolve before root integration:
`run-self-hosted-release-gate.ts` uses P12 `completed`, while browser evidence
`identity.ts` requires P12 `retired`. This slice does not manufacture a new P12
state or silently change either caller's acceptance contract.

## Threats and regression scope

| Threat | Refusal or proof |
| --- | --- |
| Report reused across candidate, database, release, phase or subject | Exact independent boundary match and second observation |
| Missing, unapproved, pre-pin, stale retained report | Existing projection; typed absence preserved |
| Schema exists without installed release | Actual observation has `catalog: null`, no approval |
| Different database or packaged migration drift | Real backend identity and complete independent ledger comparison |
| Missing fence or drift across separate Kernel/metadata transactions | Mandatory live boundary, full before/after observations and snapshot pin match |
| Partial query or unknown rollback | Static refusal; unknown close destroys session |
| Startup reads become approval or traffic effects | Read-only projection and no effect methods |

`verifyStartup.test.ts` is an adapter-only unit suite using a stubbed report
projection. Its positive case is not a technical verification report or M2
proof. `runtimeState.test.ts` requires the explicit owned-cluster receipt before
any database operation; it has no ambient probe, database fallback or skip mode.
It uses real migrations/Kernel installation and database SHARE locks for
observation, rejects a lost real lock, and uses a real
NOINHERIT verifier login to read an absent report and reject report DML and
management role assumption. The fixture fence covers only its owned database;
it does not implement the cross-storage production controller. It does not
create a fake passed report.

Execution identities and counts remain in the maintained populated-upgrade
evidence document. Startup unit selectors use the config without globalSetup;
the real PostgreSQL file additionally requires the existing owned-target
receipt/config guard. No production command is executable from this module.

## Independent report connection

`openStartupReportDatabase` in `reportConnection.ts` opens a real pool using an
explicit PostgreSQL URL. It verifies the actual login before returning that
pool. It does not call an application startup adapter, so opening the report
reader cannot recursively demand the runtime report it is about to read.
There is no development-mode bypass, ambient URL fallback, grant, role switch,
DDL, report write, or approval action. The six required SELECTs are exactly the
tables listed in immutable migration `0139_parameter_catalog_verification_core.sql`.

The login must effectively inherit only `catalog_verifier_role`, using PostgreSQL
16 membership `INHERIT TRUE, SET FALSE, ADMIN FALSE`; the capability role remains
NOLOGIN and NOINHERIT. Superuser, BYPASSRLS, CREATEDB, CREATEROLE, replication,
other reachable roles (including Catalog reader, governance and management),
object ownership, direct extra relation/column/function grants, effective
application writes, schema/database CREATE, unsafe definer delegation and
privileged parameter grants refuse admission. Ordinary existing PUBLIC reads
are not treated as a new grant. Normal PostgreSQL built-in execution is retained.
PUBLIC table/column SELECT on non-report Catalog objects is nevertheless refused;
the ordinary-business PUBLIC read exception does not widen canonical access.
Sequence USAGE/UPDATE delegated by a definer is write capability and is refused,
even when its owner lacks table writes and schema CREATE.
The same refusal applies when the definer owner has only non-report Catalog
table/column SELECT or Catalog function EXECUTE: a read-only proxy still crosses
the report/Catalog boundary. The six 0139 report reads are excluded from this
extra Catalog-read test; no report query needs protected function EXECUTE.
Definer owners also cannot delegate additional effective function EXECUTE or
application relation/column SELECT beyond the report login's capabilities. This
comparison includes private functions and owner-rights views across schemas;
moving an inner function outside Catalog does not hide its extra authority.
Ordinary built-ins executable by both identities and the six report reads do
not differ. Function bodies are not parsed or matched as SQL text.
Explicit function grants and user-schema definers delegating elevated/write
capabilities continue to refuse. Callable system-schema SECURITY DEFINER functions
without PostgreSQL 16 initdb provenance also refuse; a new PUBLIC definer cannot
hide in `pg_catalog`. PUBLIC EXECUTE on restricted built-ins is compared with
`pg_init_privs` initial ACLs. Ordinary built-ins and the existing harmless business
definer exception retain their previous contract. This adds no grant.

This is a purpose-specific login precondition, not a
replacement for the complete migration/permission manifest or release verifier.

Only a successfully checked `RootDatabase` leaves the function. The composition
root must close it after use, on later application bootstrap failure, and on
normal shutdown. Every failure closes any created pool; a close error cannot
replace the fixed admission reason with private database diagnostics. No report
content, credential, connection URL or raw SQL error is returned in an error.

| Incremental threat | Required observation |
| --- | --- |
| Forged role name, elevated/member/owner login | Actual session and effective-capability query reject before pool exposure |
| Missing SELECT or mixed application/governance capability | Fixed refusal; no grant or role repair |
| Broken connection, partial/malformed audit result, failing close | Fixed redacted error and attempted resource release |
| Report connection used as startup permission | Separate existing startup adapter and controller state remain mandatory |

`reportConnection.test.ts` covers lifecycle and typed failures with a mocked
database factory. `reportConnection.integration.test.ts` requires the existing
owned PG16 cluster receipt, uses real restricted LOGIN connections and the formal
report projection, and includes role/ACL/definer contamination tests. It never
probes an ambient database or skips for unavailable infrastructure. Its successful
absent-report read proves connection usability only; it is not a fabricated passed
report or a successful application startup. Root/config wiring and real execution
evidence belong to the parent integration lane.
