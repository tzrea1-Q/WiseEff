# Populated self-hosted upgrade compatibility

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-06-populated-upgrade.md)

## Scope and state

### Authorized continuation: NW-01–NW-04

The user's latest review authorizes D-A (the natural audit test repair at
`009ce086a3050ce555806394463bb8d179c70fbb` and only its three exact identity
relocations, after independent byte/metadata verification) and D-B (an explicit
comparison evidence version separating the complete mapping snapshot from
per-identity, fixed-plan-backed differences). Neither authorizes new migrations,
runtime grants, S6/Policy semantics, production operations or merging this Draft.
Historical v1 bytes and approvals, original trusted inventory, the previous
23-pair relocation and existing purpose/approval rules stay unchanged.

NW-01 code `25e8aabae` / report `4b346d6ef` is pushed, with D-A and native
client-close fixes independently reviewed. Run `34192523701` reached a new owned
failure at merge `7affb0894c4d78446efbfaf534ff61561c44e0a4`: bootstrap 39 passed/1
failed: the independent child passed its `not-applied` assertion, but the parent's
subsequent fresh-manager inspection returned `unknown` instead of `not-applied`.
Later owned suites did not execute. The subsequent local deferred real-PG test
proved an authentication-probe close race; it did not reproduce or prove the
original Hosted cause. The reviewed repair is integrated at `0390bd028`.

Subsequent local code: `53946302d` rechecks the existing host lock after planning
before journal commit or replay (Red: accepted after loss; Green: 19/19 scheduling
tests, bounded independent Standards/Spec PASS). `1ad2fdb0f` registers the real
Compose handoff in an owned route; 59 routing/supervision tests pass. Source
`c2197ae17` subsequently passed that actual route 9/9 with verified cleanup;
its application containers remain identity stubs. Parent owns runner/CI/controller;
Raman owns `handoffDataSource` and the handoff fixture. `b7c64328f` integrates the
independently reviewed mapping snapshot/v2 codec unit: actual PG activation 22/22,
pure five-file suite 24/24, build exit 0 with warnings. An initial wrong pure-test
configuration hit the default development ledger and collected no tests; it is
not validation. None of these results proves complete multi-head comparison,
P13, approved startup, or full controller success. No new code is added to the
already published `4b346d6ef` file package retroactively.

Integrated code `0390bd028` / tree `bdd8c313172648b2fedf58b2790775213fa9ab0f`
passes focused 97/97, build, unchanged boundary 3509/3509, and strict owned docs
including schema verification. Bootstrap source `3fa5db71e` separately passed
41/41 real PG with cleanup verified. Unit Standards/Spec and fresh bounded
integration Spec reviews pass; no current full-suite/Hosted result is inferred.
Exact source identities, hashes and the additional default-database invocation
deviation are in the existing evidence pair. Lagrange now owns the actual P0
inventory/registration and multi-head provider chain; Raman owns the real old
application source lease. These unfinished Scratch paths are not delivered code.

Current base remains `cda6737a8`; report `b5ef257cc` run `34169931811` finished
failed at merge checkout `829f8b49d`: runtime-role-source 12 passed/1 failed,
where the post-manager-termination session count was 1 instead of 0. Later owned
suites did not execute. Build/test, smoke and quality passed; two target jobs
skipped. This is separate from every earlier timeout and restore failure.

| Unit / sole writer | Exit condition and risk | Documentation impact |
| --- | --- | --- |
| NW-01 runtime source / Raman; audit and exact relocation / parent | PID-based teardown diagnosis; no budget relaxation; exact three old/new slices and adversarial identity checks | Existing runtime source, boundary, evidence pairs |
| NW-02 codec/provider/mapping integration / Lagrange; serial integration / parent | Actual multi-head owner data and fixed P0 rules pass existing nine gates; unknown provenance refuses | Existing comparison contract/decision pair and fingerprints |
| NW-03 controller/journal/composition roots / parent | Real P13 facts and formal approved reports allow restricted production API/worker startup | Existing startup, retirement and operator pairs |
| NW-04 integration / parent | Actual terminal upgrades a nonempty isolated old system through business/recovery acceptance | Existing evidence/operator pair |

Only one shared implementation root is active at a time; independent review
remains separate. Focused real-boundary checks precede one stable-candidate full
validation. A/B/C remain incomplete. The strict documentation gate still applies.

### Historical continuation: real dependencies and activation

Integrated `864bd95f180a297fb0fd3ec04aeeaf930b36718c` closes the bootstrap
fixture lifecycle failure without increasing any budget. Source `c4b99f4ba`
received independent Standards/Spec PASS and passed 40/40 real PG cases;
parent integration independently passed 40/40 with verified cleanup. The audit
timestamp-tie repair remains Scratch: a layout-preserving alternative is not
accepted merely because boundary scanning passes. The natural repair and its
three exact occurrence relocations require separate boundary review. Current
Hosted remains the failed `d79b9b23b` execution; no new CI success is claimed.

| Increment / sole writer | Risk and dependency | Documentation impact |
| --- | --- | --- |
| Bootstrap fixture / Raman, parent integration | Timed-out work must settle before shared credentials/locks change; cleanup must preserve the primary failure | Existing retirement pair and evidence |
| Audit timestamp tie / Lagrange, parent review | Equal timestamps do not order events; retain causal and complete audit assertions, preserve frozen identity rules | Existing evidence; exact decision if relocation is necessary |
| P13 finalizer / parent with Raman analysis | No generation until complete current writer controls and formal effects exist | Existing retirement/startup contracts; no new schema or grants |

Current integrated continuation `b7bd0e645` adds the independently reviewed HTTP
owner controls and native RI detection; parent HTTP 51/51, real PG 34/34,
build and unchanged-base boundary passed. The permanent actual terminal test at
`3cee9f235` also passed, separately from the earlier retained `73f12a24e` package.
Report `d79b9b23b` Hosted `34167230816` has a failed owned bootstrap job (27/3),
not a green candidate. Its 5000ms fixture overrun and subsequent shared-state
failures are being corrected without extending timeouts. A later database
analysis was stopped by the agent tool; that unfinished work remains explicit.
Actual StartupTarget, production-mode positive startup and full P13/controller
are still internal implementation work, separate from external target inputs.

At `73f12a24e17f12b9b863b7ebe78790ddd46d722b` (tree
`c02d9512c54c643cb5e85efa0e4d460536c7fb7d`), the real `upgrade.sh`
artifact-init/prepare/inspect chain built that same source and reopened its
protected package in another process from a different working directory. The
two observations match exactly; neither authorizes startup. Artifact custody,
terminal dispatch and new-journal semantics each have independent Standards/Spec
review. Fixed-candidate focused tests passed 59/59; full owned scripts passed
source-lock 4/4 then 2001 passed/11 skipped, and backend passed 4300/4300.
Build, original-base boundary, contract and selfhost checks exited zero. Current
Hosted had not run at that local checkpoint. Exact hashes and the bounded negative-test correction are in
the existing evidence pair. The earlier checkpoints below retain their identities.

The exact authentication/SQL successor and trigger dispatch fixes are now
integrated: source `62090c07e` passed 30 joint cases plus the original 19 SQL
cases; source `205dabf26` passed 31 writer-reachability cases. Both have separate
independent reviews. These remain component evidence, not full P13. Next work
uses actual HTTP registration controls and effective database fencing, without
inventing a whole-repository source scanner or claiming a complete writer inventory.

Continuation `c3f5a4909` integrates the independently reviewed actual runtime
LOGIN source and its schema-array fix. Source test commit `a550e8a7f` passed
13/13 real PG authentication, backend-loss and cleanup cases; this is not
application startup. Its parent route/source selector passed 32/32. The SQL
privilege effect is integrated at `64d478f37`. Its fixed source `2a9b22e2b`
passed 19/19 real PG cases and independent Standards/Spec review; the earlier
root/route selector passed 147/147, not a database effect proof. At `64d478f37`,
full scripts passed source-lock 4/4 then 1940 passed/11 skipped; backend passed
4300/4300, both exit 0 with verified owned cleanup.
The independently reviewed application artifact producer is integrated at
`a557e6886`; its selector passed 20/20 and build exited 0. Builder `75e182236`
actually produced and checked an image of source `a321084a5`, separately from
this integration identity. Restart-safe selection was unfinished at this earlier
checkpoint; the later terminal execution above supersedes only that status.

Earlier `b8fbae437` integrates the independently reviewed bootstrap journal
lock checks, the seven-table V13 capability submatrix, and mandatory controlled
recovery adapter routing. Focused 274/274 and actual adapter 4/4 passed; build,
unchanged trusted-base boundary, contract and self-hosted checks exited 0. This
candidate has not run Hosted. Delivered `cf494324c` separately completed CI
`34153386496`, with local non-HDC and target synthetic jobs skipped.

| Current increment / sole writer | R3 threat / dependency | Documentation impact |
| --- | --- | --- |
| Bootstrap journal / Raman, parent integration | Lock loss during the last report await; retain committed evidence without replay | Existing bootstrap pair and evidence |
| V13 capabilities / Lagrange, parent integration | Indirect LOGIN privileges and custom system-schema definers; seven-table scope only | Existing gate pair and owned CI |
| Adapter mandatory route / parent | Neither generic exclusion nor opt-in may omit all four tests; failed child cleanup remains unknown | Existing operator/evidence pair |
| Runtime role source / Fermat, parent integration | Original configuration FD, actual restricted LOGIN and physical target proof; no new grants | Existing runtime source and evidence pairs |
| SQL privilege effect / Raman; parent owns runner/CI | Seven-table ACL CAS, current readback and unknown outcome; no P13 completion claim | Existing retirement pair and mandatory owned route |
| Authentication/SQL successor inspection / Raman, separate Scratch | A legitimate REVOKE changes the original authentication ACL baseline; recognize only the formally verified exact successor, never a caller override | Existing retirement/custody pairs; independent review and actual child-process readback |
| Application artifact / Lagrange; sole upgrade-lib writer | Actual fixed source/build trust and OCI bytes; Docker image ID is not assumed to be config or manifest digest | Artifact contract and existing decision pair |
| Artifact terminal dispatch / parent; sole upgrade.sh writer | Explicit prepare/inspect; existing run-bound journal and real host lock; reject ambiguous arguments before build, no implicit journal creation or stack apply | Existing operator/evidence pair and artifact custody contract |

Full P13 effects and its immutable generation producer, StartupTarget and real
API/worker positive startup remain internal implementation work. A, B and C are
not complete. No additional schema, capability or production action is authorized.
The following checkpoint retains its historical identity.

The four bounded increments below are integrated at `2b5d5ed44` (tree
`d97681435e034b7ee604efbe21295d7b434baa82`). Its mandatory actual recovery route
passed 15/15 with service image evidence. At server code `6e519a3b4`, bootstrap 240/240 and owned backend
4300/4300 passed after fixing an integration regression in the static missing-DB
diagnostic; the original assertion was retained. Build and strict owned documentation/schema checks passed. Exact prior-source
component executions and current-candidate checks are separate in the evidence
pair. Its Hosted result is recorded above; complete startup/controller acceptance
is not established. Typed publication events now exist in the host journal as
storage only; no new schema, grant or report format is authorized. A missing full P13
producer cannot be replaced by a caller-supplied retired flag or fabricated pin.

Recovery composition now uses formal capture and independently authenticated
approval before the separate restore process. Scratch `06dcc6ca5` passed all 15
actual package/queue tests; `2bfd4b2b4` adds a mandatory owned route, recorded
separately. Neither proves a complete old-application upgrade. Delivered report
`70c1a3ad0` CI `34146381260` succeeded at actual merge
`80f831e2a9641a93284a867cdf226499f569c656`; local non-HDC and target synthetic jobs
skipped. That Hosted result does not cover new Scratch changes.

| Increment / sole writer | R3 threat and required evidence | Documentation impact |
| --- | --- | --- |
| Recovery and owned CI / parent | Formal capture and four-principal approval; package-only restore; paused BullMQ/retry; exact unknown-resource reconciliation; private journal retained | Existing operator/evidence pair, plan and authority pair |
| Bootstrap inspection root / Lagrange | Full observed binding and original lock/report/package checks before custody transport; no old-password fallback | Existing retirement pair |
| Initialization signals / Fermat | No late consumer/database write after termination; settle existing resources | Lifecycle and shared signal owner pair |
| Organization archive identity / Raman | Preserve verified owner identity without plaintext in other metadata or ciphertext | Existing Archive pair |

Independent reviews remain separate from author tests. Route/config/CI changes
require route regression and actual owned execution; generic exclusions cannot
become unexecuted tests. The existing strict Documentation Update Gate applies.
Production boundaries and separate external decisions are unchanged.

The following delivered checkpoint retains its original execution identity.

Current code is `ec0ee9f3e86c6c3e037bf5485e8d32f322375ca5`, tree
`ba7e906bf6a3d8d40d679bf87eacb3f9b0e8717c`. The reviewed root bootstrap
guard/report/cleanup increment and mandatory owned runtime-identity lane are
integrated. Current focused 92/92, real bootstrap 27/27, full scripts 4/4 then
1842 passed/25 skipped, and build passed. Exact evidence and remaining runs are
in the existing evidence pair. Final limited Standards/Spec reviews passed.
Latest completed Hosted `34142368636` on `8f3cf8489` succeeded, with two target
jobs skipped; it does not include this increment. New candidate CI is pending.

Parent retains sole ownership of terminal/controller and plan/evidence changes.
Raman's next isolated unit connects retained credential custody to an independent
management transport without exposing secrets or adding grants. This addresses
whole-root inspection after source authentication changes; it does not manufacture
P12 or P13. Full startup observation, terminal phase composition and complete
synthetic acceptance remain internal work. A/B/C are incomplete. R3 threats and
the existing Documentation Impact Matrix/strict documentation gate remain in force.

The following checkpoint is historical.

Code `8ed7ac196b34caf351e7331f6e2be15ea7f8a5d3` integrates the independently
reviewed formal CGH router, persisted Review query, production query composition
and mandatory owned PG route. Real PG16 projection tests passed 10/10, backend
4289 passed/11 skipped, full scripts 4/4 then 1826 passed/25 skipped, and
build/boundary/contract/selfhost passed. These are actual
route/query results, not approved API/worker root startup. Exact failures, WIP
identities and CI checkout are recorded in the existing evidence pair.

The latest completed Hosted `34138417314` on `c04d42703` passed the main job but
failed two owned bootstrap COMMIT fault cases. The reviewed native-socket no-delay
fix preserves the 2000ms deadline; new Hosted verification is pending. A/B/C
remain incomplete. Parent owns root integration, runner, shared journal and this
plan/evidence; Raman owns the separate legacy retirement/bootstrap integration;
independent reviewers own no implementation files in that increment. R3 risks are
borrowed credentials, unstable observations, unknown commit outcome, capability
leakage and fake empty inventories. Documentation Impact Matrix remains the
existing plan/evidence/operator and directly affected bilingual module contracts;
the Documentation Update Gate requires the owned strict docs/schema check.

The following checkpoint is historical.

Current checked code is `e5c76c9ce4f828df8866f2b26888661a75aa9919`, tree
`dd12fd3b8a15f168a05487f7dbf16a3e245b72cd`, on unchanged base `cda6737a8`.
The integrated increments have independent reviews. Owned Binding PG16 92/92,
backend 4260 passed/11 skipped, scripts 4/4 then 1822 passed/25 skipped, comparison
4/4, build/boundary/contract/selfhost passed. Each retains its exact execution in
the existing evidence document; no result establishes full populated conversion.
Bootstrap independent-process recovery and endpoint fixes are integrated; their
prior 22/22 and local 16/16 retain their own SHAs. Hosted still records the failed
`fa3dbef3f` run until a new candidate actually executes.

Parent is the sole writer of root integration, runner/config and this plan/evidence
pair. Fermat owns a separate CGH formal-query Scratch; Raman reviews its Spec and
Lagrange its Standards. Replace CGH's constant readiness and fake empty projections
through existing public composition APIs, without adding grants or moving frozen
boundaries. Query failures must not prove empty inventory. D01's real usage and
registration permissions, D06's query/command composition, complete startup facts
and actual controller success remain explicit internal seams. A/B/C are incomplete.
R3 threats remain false empty inventories, borrowed authority, stale pins, cleanup
outcome loss and cross-target effects. Documentation impact: the existing plan,
evidence and directly affected bilingual module/decision documents; no new macro plan.

The following checkpoint is historical.

Current local code is `439f79c96794d165a73bf41fdd1697bc552ffffe` (tree
`8b1e7d0510f7d22175d4d586c9565809d9380d2e`). Reviewed bootstrap fencing is now
integrated: actual owned PG16 18/18 and routing 47/47, build/boundary/contract/
selfhost exit 0. Extra process/unknown-commit tests remain separate pending
actual execution. Latest remote report `fa3dbef3f` ran Hosted `34130699134`,
merge `1a6c126e93d1b565b77d3b8baada937374da799f`: scripts has two cleanup-hook
timeouts, owned endpoint has five resolver-options failures. It is not green.
Parent owns cleanup/integration and delivery; Lagrange owns endpoint correction;
Fermat owns the serial PG lane; Raman owns bootstrap and cleanup diagnosis.
No timeout, grant, trusted baseline or stage approval is relaxed. Documentation
impact remains this plan/evidence pair and the affected bilingual module contract.
Startup producer and actual root success remain internal work; A/B/C incomplete.
The following continuation paragraph records the preceding checkpoint only.

PR #824 remains Draft/Open, base `cda6737a8`; the refreshed remote is `3c0fe1d66`.
Its Hosted `34125753813` failed on merge checkout
`e0f9ea2e56582b1dfe5398c5d5f4d9b77b30ea73`: two missing recovery dependency
registrations and the Linux endpoint positive case. The older `34104402409`
success remains historical. Parent candidate `be95a710f` fixes the registration,
integrates the reviewed P12 adapter, and adds safe endpoint diagnostics without
claiming the Linux cause is resolved. New Hosted evidence remains pending.

At clean `1376fbcbe`, complete owned scripts passed 4/4 then 1781/1781 with 25
skips; backend passed 4241 with 11 skips, and mandatory owned Binding tests passed
92/92. Build and unchanged-baseline boundary passed. These executions are not
relabeled as later handoff changes. At `be95a710f`, actual Compose identity tests
passed 9/9 after reproducing shared-object drift acceptance; build passed. Both
increments have independent Standards/Spec review. The fixture uses identity
apps, not actual old API/worker processes.

The unintegrated bootstrap candidate passed 17 actual PG cases on `f122a6285`,
but independent Spec then found activity-statistics secret exposure and mutable
inspection input. It is not sealed; fixes and real counterexamples are in progress.
Parent remains responsible for actual startup/management roots. No legal runtime
pin root startup, full populated controller or production command is claimed.

| Increment / unique writer | Required evidence | Documentation impact |
| --- | --- | --- |
| Durable Redis / lifecycle Scratch | Actual BullMQ connection, error events, draining and recovery; independent review | Queue module contract and this plan/evidence pair |
| P12 existing-storage / activation Scratch | Existing 0137 storage, real approval and PG effects, explicit unknown outcome | Activation bilingual module contract |
| Host activation journal / journal Scratch | Durable intent, full-record CAS, scope and independent readback | Journal contract and operator pair |
| Startup producer, roots and integration / parent | Independent current facts and real restricted production processes | Existing operator/evidence pair |
| P13 stopped-source resolver / Raman | Actual stopped-container hosts/resolver files, original endpoint and two-PG counterexample | Retirement/source module contract pair |
| P13 endpoint resource supervisor and owned routing / Fermat | Parent-issued private receipt, durable planned/observed IDs, child kill and exact cleanup | Runner contract and mandatory CI route |
| P13 integration Spec / Lagrange | Independent fixed-SHA cross-layer review, no implementation edits | Review evidence in this plan/evidence pair |
| Formal durable enqueue / parent, independent Spec Lagrange | Actual producer key accepted by locked BullMQ, existing identity and retry compatibility | Queue contract and existing evidence pair |
| P12 activation command composition / Lagrange; root/controller integration / parent | Existing domain, report dispatcher and persistent journal under the issued host lock; inspect/reconcile never replays SQL | Activation-controller module pair and existing operator pair |

The new P12 composition Scratch depends explicitly on `07919b498`. It owns no
new schema/grant or verifier. Threats are forged/lost host locks, cross-run journal
reuse, unobserved pins, pending before approval, lost SQL acknowledgment and
reconcile accidentally applying again. Its command input selects only action,
report and attempt; current observations must come from the real owner, not the
report. Lagrange now implements this module; its eventual independent review must
come from another reviewer. Parent retains the producer, shared controller/state
machine and shell entry. Auxiliary port tests cannot prove approved PG activation.

The stopped-source resolver and parent supervision increment is integrated through
`c6a57ae41`, after independent Standards/Spec review. Subsequent actual old-image
business acceptance failed at upload with HTTP 500. A new permanent real Redis
test using the formal `enqueueLogAnalysisJob` producer reproduced the locked
BullMQ rejection of its colon-containing job ID (9 passed/1 failed, no skips,
exit 1, exact owned cleanup verified). Earlier controlled-task lifecycle passes
did not exercise this producer key. The fix must preserve persisted task identity
and retries; changing fixtures to an accepted key cannot satisfy this acceptance.
Current API/worker approved startup and full controller remain internal unfinished
work. See the evidence pair for the separately recorded invalid bootstrap setup
invocations; no unverified default database may be contacted to continue testing.

API request/background-work drain at `b404b615b` has independent Standards and
Spec PASS for that exact increment. Its focused execution is 61/61, and build
passed. The actual disconnected HTTP client counterexample failed before the
fix: socket close does not mean its asynchronous handler has finished using DB.
This does not prove approved production startup or all initialization paths.

The activation journal `e0ce5aa42` has independent Standards/Spec PASS and is
integrated as `814199bb6`; the integrated four-file selector executed 109/109.
It retains intent/unknown/reconcile and full-record CAS, without authorizing P12.

Durable Scratch `815666f16` reported 8/8 real Redis and 60/60 unit tests. Parent
integration exposed TS2341: Worker.blockingConnection is private, not protected.
The parent-supervised Redis route then collected eight cases: seven passed and
authenticated INFO rejection timed out at the unchanged 30000ms limit; exit 1,
owned resource cleanup verified. Independent Standards also reproduced malformed
URL construction causing an unhandled URIError. Fixed Scratch `2381aaff1` replaces
private access with public client/duplicate ownership and validates URLs before
allocation; independent Standards/Spec re-review passes. Parent integration
`de15d6b46` ran the supervised real Redis suite 8/8, exit 0, with verified cleanup;
build passed. Earlier failures remain attributed above. Construction, authenticated
connection, liveness, readiness and permission to consume remain distinct.

Comparison `d21627c02` and existing-storage activation `5b945a645` have independent
review and are integrated. Activation now calls the formal approved report
projection and nine-gate Comparison association instead of constant refusal.
Parent owned PG16 execution collected/passed 11, skipped 0, exited 0; these cover
storage, epoch and missing-report refusal, not successful approved public apply.
The actual SELECT-only verifier experiment found P01 rejects the required
management membership, while P02 passes after every role-switch probe failed with
42501. A separate bounded S6 contract decision has been requested; no verifier or
runtime grant has been widened. Actual P12/P13/root producer and successful runtime
approval remain unfinished; this finding is not a reason to abandon independent
integration work.

Controller recovery/fence evidence `920b3f1d9` has independent Standards/Spec PASS.
The path-escape counterexamples first failed (two tests); the fixed thirteen-case
suite passes using private package files and a real host lock with unit source/
writer ports. It is not a real three-storage restoration or complete stop-write
producer. The permanent owned CI routing now includes both actual Redis lifecycle
and existing-schema activation; general suites exclude those exact integration
files, with routing regression. Current candidate Hosted remains not-run.

R3 increment threats: initialization/close error events, transient disconnect
without permanent poisoning, active work after pool close, signals during startup,
untrusted activation facts, SQL/file commit uncertainty, cross-run replay and
metadata drift under the real boundary. Existing two authorized contracts remain
in force. No new schema/grants, S6/Policy decision, production operation or release
authorization is included. A/B remain internal work; C retains separate external
requirements. Parent integrates changes serially and does not self-certify review.

The P13 source Scratch `64c613980` is not integrated. Its 13 real PG/endpoint
cases pass, but independent review still found two P2 boundaries: inspecting only
Docker resolver configuration misses effective `/etc/hosts` content; child-owned
endpoint containers can outlive a killed test process. The next executable cases
are an original hostname resolving to the second real PG, and a killed child
followed by parent-owned resource readback/cleanup. The parent supervisor owns all
resource creation and persistent receipts; the source consumer may only observe.
Unknown create/commit/cleanup outcomes retain evidence and fail. Neither these
endpoint probes nor login fencing alone is full P13 retirement or old app startup.

The source-lock scheduling and strict owned database-documentation increments
received independent Standards/Spec review. Complete scripts passed on `734b10dae`
with 1722 collected/1697 passed/0 failed/25 skipped, including all four frozen
source-lock cases. Owned strict docs passed on `6be8e08ef` with real schema
comparison and no skip. The existing evidence pair preserves command identities,
hashes and earlier failures. A verified-TLS build of the actual fixed old source
Dockerfile now supplies a local source image; successful build is not startup,
enterprise-network trust or controller evidence. Documentation update gate remains
required after final integration; this plan is not complete.

### Attributed CI and existing-schema activation increment

At `d7cdd6473`, parent owns CI routing, exact execution evidence and final
integration. Hosted `34097926621` timed out during backend; the original S11-RP
failure is resolved in that run's scripts, but its new backend failure/cancellation
is retained separately. The receipt-requiring runtimeState file now executes in
mandatory owned `bindings-pg16`; the identity fixture clones the existing migrated
template without changing its 23 assertions, source seed or timeout. Independent
Standards/Spec reviews cover these two fixes. Full results remain in the existing
evidence pair, not combined across checkouts.

Further Spec review corrects a design dependency: the frozen contract requires
P12/P13 and their append-only journal evidence, **not** the prototype's three new
tables. The unapproved 0141 prototype remains excluded. The activation lane owns
only a new public `catalog-cutover/activation/` module, tests and bilingual README,
using existing 0137 run/event/checkpoint storage and privileges. Parent owns host
journal and root composition. No expansion of S7's pre-activation interface, S2
schema, grants or trusted baseline is authorized or needed for this alternative.

R3 threats for this increment: a fabricated current head, forked predecessor
chain, cross-run checkpoint reuse, approved report used as its own target oracle,
SQL commit followed by failed file-journal commit, live lock loss and immutable
checkpoint overwrite. Effects need exact preconditions, real approval projection,
explicit pending/committed/unknown state and readback reconciliation. The read-mode
consumer must actually honor the validated state; recording an event is not P12
completion or startup approval. P12/P13 and full root execution remain internal
implementation work; the chosen three-table proposal is not a blanket blocker.

The lifecycle lane owns workerRunner/worker and their existing tests to close
actual pools on stop/start failure and await in-flight polling work, without
changing release admission or privileges. Threats are partial start, synchronous
cleanup failure, repeated stop, concurrent in-flight work and leaked private errors.
Parent retains single-writer ownership of runtimeConnection, API root, Compose,
migrations, generated artifacts and fingerprints. Documentation impact is this
plan pair, existing operator/evidence pair, and the activation module README pair.

### Accepted bounded contract evolution, 2026-09-07

The user explicitly authorizes implementation and isolated verification of two
independent R3 changes at `f00f94435` (code `11d8147a5`, main `cda6737a8`).
Refreshed refs are unchanged and the worktree is clean. Earlier pending decisions
for these two scopes are superseded; this is implementation authorization.

Recovery: retain S11-RP capture/verify/restore-check manifest, exact target,
quiescence and run-bound token ownership. No direct or transitive execution from
check-only entrypoints. Register every storage module and its dependencies under
an independent controlled execution contract. Restore consumes existing verified
package/token contracts with persistent attempt, source provenance, authorization
and live target/lock checks at each store. Unknown/partial outcomes remain locked;
success cannot resume traffic. The blanket token scan evolves only into this
exhaustive split, preserving every unrelated forbidden operation.

Reader: append the next migration (currently 0140; recheck before integration),
preserving every historical SQL/checksum. NOLOGIN capability grants only schema
USAGE and SELECT required by real Kernel SQL, with an exact object manifest.
Retain historical 0138 negatives and test new opt-in real LOGIN reads. No DML,
ownership, grant/admin option, high role reachability, governance EXECUTE or new
privileged system metadata capability. Report reads retain the separate 0139 role.

Single writers: recovery Scratch owns storage execution/check ownership/tests;
reader Scratch owns the new migration, role manifest and real Kernel/role tests;
parent owns runtime roots/controller, generated schema, fingerprint publication
and final bilingual operator/evidence changes. Each lane writes its own bilingual
module contract. Integrate reader then recovery serially after independent
Standards/Spec review. Test clusters cannot share cluster-global roles. Do not
apply the old proposal wholesale. Parent continues startup/P12/P13 integration.

Threats: missing modules, indirect/dynamic check-to-execution imports, command
obfuscation, forged/stale/cross-run package/token, nonempty/wrong/shared target,
lost locks between stores, unknown restore outcomes, source stopped after capture,
PUBLIC/owner/indirect membership escalation, unsafe INHERIT/SET/ADMIN options,
unauthorized reads/writes, invalid Kernel pins and pool cleanup failures. These
require permanent negatives and real isolated positive evidence before sealing.

Documentation impact: existing plan pair, module contracts, ownership/grant
manifests, relevant tests/fingerprints and generated schema, operator/evidence
pairs. No global trusted-base reset or unrelated allowance changes. Neither
authorization approves #815, real backups, enterprise CA, production operations,
merge or release. PR #824 remains Draft; these slices do not replace the full
startup and populated controller acceptance.

## Continuation: M1 and M2

### Current integration ownership

Parent integrated capture and typed approval persistence through `35770b7e1`;
recovery owns the real authority/approval producer integrated as `0d87cbf20`.
That owner connected actual authenticated approval to the real four-case Docker
restore suite at `b8378f9f4`; the latest issued-lock increment is being reverified.
Parent owns remaining CI composition repairs,
report-only evidence and delivery; activation supplies independent Spec review.
The reader and report capability audits passed their dedicated real-login lanes.
Root production startup still lacks a true current-state producer and actual
P12/P13 lineage. P12 schema and S6 business capability decisions remain separate;
management lease challenges can proceed without a new runtime system grant.
No completed component changes the production stop boundary.

Parent owns typed recovery capture events in the existing journal and its
capture bridge. The real capture return, not caller JSON, supplies source/package
digests. A durable pending attempt precedes capture; missing/unknown journal
outcomes retain the package and block retry. Old hash-only events remain
inspectable but cannot become trusted producer records. A module-issued live
host lock is checked for the exact configured root before every step. This does
not certify the writer-boundary producer or grant restoration. Recovery Scratch
owns a separate five-file deployment authority adapter using real production
authentication and private per-run assignments; no new product role or implicit
admin mapping. Parent remains sole writer of journal, handoff and controller;
Scratch cannot add those seams independently. Documentation impact is this plan
pair, recovery execution contract pair and the existing operator/evidence pairs.

Parent owns the database foundation and composition roots. Activation Scratch
`codex/pr824-p12-contract-scratch` preserves additive 0141 and
`catalog-cutover/activation/` at `9b7af682c`: management-only mapping epochs and
P12 CAS, separate from P5 and actual consumer routing. Full server integration
showed that these three tables require a separate S2/S2-RBAC/S2-PGH decision;
the existing S7 ownership does not authorize changing frozen schema contracts.
Parent appended explicit reverts `68304f9bf` and `d4640da40` to separate this
unsealed prototype from the two authorized contract changes. No history was
reset and no historical migration was changed. Its independent acceptance lane
is absent with its implementation, not skipped to claim acceptance. After a
bounded schema decision, restore the prototype and its lane together, verify the
historical and current schema separately, and repeat affected acceptance.

The parent added an opt-in per-checkout observation hook in `9d55cde19` so the management
owner's target challenge covers the actual session used by Kernel. A before/after
probe on another pooled connection is insufficient. The hook receives only the
checked-out query session, precedes its first caller statement/BEGIN, and covers
the raw pool exposed to formal Kernel. Failure destroys the lease and preserves
the admission error; pending verification must not expose the session. No external
transaction enters Kernel and no database privilege is added. Regressions cover
root queries/transactions, raw promise/callback checkout, delay and cleanup. The
generic hook is neither target proof nor approval; the owner supplies actual
nonce/physical-target observations. Documentation impact: this plan pair,
foundation documentation and activation contracts, then operator/evidence pairs
after execution. Reader and recovery retain separate reviews and execution SHAs.

Fresh preflight confirms base `67d4a77325b6009b77c2373bd788298a6d022bcf`, inherited report head `1a9ba7745b6f4e0ba1e52aede3e0ee5fe1ab6016`, clean candidate worktree. Source deployment is unchanged. M1 is independently reviewable interception; M2 requires a successful actual isolated upgrade and remains separate.

The later remote refresh found documentation-only PR #823 at
`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`. Parent read its current security/test
guidance and appended merge `7218a43dcd5402d52b5e57166b746d0c6409642f`.
Existing implementation/report/test identities are retained; M1's independent
backup is still based on `67d4a7732`. The source deployment is still `82344044…`.

Parent owns M1 CLI/debt shrink, fixed-entry handoff, shared upgrade/Compose/migrations, integration and delivery. `m2_release` owns the existing release-gate script and tests; `m2_runtime` owns runtime connection/startup files and tests; `m2_recovery` owns package restore adapters and synthetic recovery tests. Each works in isolated Scratch; parent integrates serially. No agent owns production actions or permission changes.

Incremental threat review: preserve absent-diagnostic versus release refusal; remove only proven unused imports and four exact debt IDs, reject reintroduction, retain immutable fixture/relocation/base; bind handoff to artifact/daemon/project/storage identities before effects; produce reports from real state; runtime initialization precedes all queue effects and never repairs; restore consumes only a verified package with external secret inputs, binds the target and stops on partial/unknown outcomes. Package verification must resist file replacement, path traversal and stale Redis AOF. These augment the matrix below. First Red is the inherited boundary failure, then retired-module load rejection at the CLI diagnostic seam.

Documentation impact: update this existing bilingual plan, existing bilingual operator/evidence documents, and module-owned runtime/recovery guidance together with executable paths. No duplicate status report. Focused checks own inner loops; final build/contracts/docs and independent reviews precede a milestone PR. Synthetic schema preservation is not canonical conversion; sentinel RDB restore is not AOF production-shape recovery.

M1 now has exact four-ID debt removal, permanent reintroduction negatives and
independent Standards/Spec review. Its final scripts batch at `ffc240498` has
1301 passed / 1 source-lock timeout / 5 skipped. Boundary passes. It remains
Scratch pending the frozen source-lock performance decision; no PR or Hosted run.
The remote M1 branch is a backup, not release authorization.

M2 ownership refinement: `m2_runtime` is the sole writer of additive migration
0140 and governance read-port separation; parent has not edited that migration.
`m2_release` owns S7 exact conversion manifests plus S6 management import and
evidence Archive capability, preserving classification and immutable history.
`m2_recovery` owns fixed-entry identity/private-input hardening and controlled
package restoration. Parent owns Compose/Dockerfile/ignore rules, root dispatch,
generated documentation and final integration. Parent's independent review
requires the new reader role to reject pre-existing unverified capability;
the runtime command role must not receive broad Catalog/audit SELECT.

Current integrated M2 pieces are report-action binding, restricted-login startup,
separate governance pool, exact formal-definition mapping/source fingerprints,
package-only restore with source stopped, initial handoff, and explicit Catalog
Compose credential/profile/external-volume separation. These are not the M2
success chain. P2 live writer isolation, phase-aware handoff resume, P12/P13
producer ownership, full post-retirement report/runtime loader, complete consumer
and business permissions, browser/capacity, and root upgrade success remain open.
Secrets must remain outside the candidate build context; `.dockerignore` defense
does not replace descriptor-bound private input verification. Recovery package
limits and actual enterprise/real-data evidence remain separately tracked.

Current state: SCRATCH, incomplete. See the [execution evidence](../../../ops/self-hosted/populated-upgrade-evidence.md) for refreshed base/candidate, passing checks and unresolved boundary/release blockers. The following paragraph records the initial preflight.

PREFLIGHT, R3. Source deployment stays `82344044b436a8dafecefbb85dfd724cecb05e3f`; development base is freshly fetched `origin/main@1c9fa56e3eaca6e7984f35a097876772a6e4025d` (no difference from the supplied main). Source counts and image identity are supplied historical observations, not rerun evidence. The local clean isolated worktree uses `codex/populated-upgrade-scratch`. No production access is authorized. Stop at a reviewed candidate/PR; do not merge, close historical issues, approve release, or operate production.

Latest code candidate `21f5aa4a8bdbb7208504396bce62796cf55875da` has real
Binding producer/import component evidence (50/50), final compatibility/gate
regressions (63/63), and a passing build. Recovery remains at its own commits
(35/35 with database settings refusal); totals are not combined. Parent still
owns the concrete writer/recovery boundary, journal adapter/reconciliation,
phase-aware handoff, runtime/public state producers, and complete
business/browser/capacity acceptance. These independent code tasks do not require
a production backup. The full root milestone remains incomplete.

The old governance EXECUTE proposal was not authorized and is not part of 0140.
Current separate decisions concern the frozen source-lock preparation cost,
P12's three management tables and S2 contracts, S6 Binding/Value business reads,
and #815 authoritative counting versus an explicitly approved unavailable contract.
None is assumed. Remaining P12/P13/controller implementation is still owned by
the parent; an unavailable constant alone is not an external decision. The P12
prototype is preserved separately. PR #824 is Draft; the terminal guide supplies
tested component/inspection commands, not an invented full-upgrade command.

## Ownership and dependencies

### Increment on 2026-09-07

The parent continues implementation rather than treating missing production
authorization as a coding blocker. Parent owns controller admission, S7 P4
composition and its immutable preparation pins, documentation and actual test
execution. Release lane owns the controlled migration/structure receipt;
runtime lane independently reviews management and P4, and recovery lane reviews
controller cross-run admission. No parallel PostgreSQL test cluster shares roles.

New R3 threats: a live-looking but dead host lock; file/directory fsync uncertainty;
another run's pending Binding/management attempt; caller mutation after an await;
search_path redirection; a new table/column outside the frozen source; a different
candidate borrowing a management receipt; physical schema/ACL drift despite an
unchanged migration ledger; and resume skipping historical P4 applicability.
Receipts describe observed preparation, never report approval. P4 pins bind the
outer preparation run/plan and candidate SHA/tree without a circular S7 digest.

Actual additional matrix uses a separately owned `postgres:16-alpine` cluster.
The pgvector Catalog lane and its required setup remain unchanged. Recovery now
has package-only real three-store tests for both PG16 bootstrap identities,
original MinIO version, AOF and explicit unsupported database-property refusal.
Precise batches, including setup failures and zero-collection mistakes, belong
in the existing evidence pair; they are not combined across SHAs.

Documentation impact: this plan and companion, existing operator and evidence
pairs. Parent still owns the unfinished terminal composition, full source-family
producers, P12/P13 implementation within frozen ownership, new report chain,
runtime startup/pool integration and application/browser/capacity acceptance.
These are internal implementation gaps. Real backup, enterprise CA/network,
production authorization and the separately documented Policy/permission
decisions are distinct external dependencies. Neither group closes M2 or OP-09.

### Increment at report `1190ba591`

R3 continuation: parent owns controller/journal, root composition and all actual
execution. Release lane owns handoff lock liveness; runtime lane owns new
startup/state readers; recovery lane owns controlledRecovery adapter/test files.
Independent pre-review found replay before live admission, stale journal writes,
unknown phase outcomes across runs, lost host locks and stopped-writer resume
mismatches. These are implementation work, not external dependencies. P12/P13
must retain existing ownership and approvals; its unavailable constant alone is
not an approval requirement. No frozen grant or Policy decision changes.

First Red at `1190ba591` plus tests: stale handles overwrite newer entries and
symlink paths are accepted (5 passed, 2 failed). The first fix checks the current
digest under an exclusive writer lock, uses exclusive temporary files, file and
directory fsync, and refuses unsafe journal files. Journal/controller tests then
pass 19/19 on the working tree. Next: durable phase intents across process and run
boundaries, with replay checked against the current real target. The root must
hold the deployment lock and re-observe identity before each external effect.
Documentation impact: this plan and its Chinese companion now; the existing
operator/evidence pair after actual adapter execution. No full-upgrade or
production readiness is inferred from component results.

| Package | Owner / paths | Dependencies / success |
| --- | --- | --- |
| A | Parent: this bilingual plan, final evidence and operator guide | Freeze threats before production edits; independent Spec challenge |
| B | Parent: reconcile CLI/tests, upgrade.sh/upgrade-lib.sh and tests, new handoff helper | Real old invocation fails closed; diagnostic queries cannot authorize release |
| C | Parent: release-verification integration and controller adapters | B, approved role/recovery contracts; unavailable frozen phases remain blocked |
| D | Identity/recovery lane, initially read-only: runtime roots, database roles | Explicit parent handoff before edits; real restricted login proof |
| E | Identity/recovery lane, initially read-only: storage/recovery | Isolated three-store evidence, never target proof |
| F | Build lane: build-network-specific helpers/tests | Existing policy; synthetic trust evidence separate from corporate CA |
| G | Parent: isolated rehearsal, documentation, delivery archive | A-F; authentic backup and production approval are external dependencies |

Single writers: parent owns upgrade shell, Compose, runtime integration, migrations, generated docs and proof fingerprints. Other worktrees and inherited bytes are preserved. Development WIP 2 for shared schema; path-disjoint build work may proceed. Final Standards and Spec reviews run against one candidate. One final Hosted batch after integration readiness, no speculative broad reruns.

## Threat matrix

### PR #824 continuation

Parent owns runtime admission, API/worker roots and this plan pair. The independent
CI Scratch lane owns recovery execution attribution; a read-only Spec reviewer
challenges startup facts and privileges. Refreshed main remains `cda6737a8` and
head remains `7fabeb8c4`. Hosted `34067803219` executed merge-ref
`51ec49131ea542d499607021c20012ad1b39266c`: scripts 1427 passed, 1 failed,
39 skipped. The failure is the recovery executor's `pg_restore` token against
the S11-RP contract, not the historical source-lock timeout. Same-selector local
candidate/base comparison reproduced candidate failure and base success.

Additional R3 threats: missing namespace bypasses application startup admission;
the report becomes its own current-state oracle; management credentials enter
runtime; isolated startup starts business consumers; public restart borrows stale
approval; initialization failures leak pools or private diagnostics. Independent
Spec review confirmed the namespace and worker cleanup seams. Production missing
DATABASE_URL already fails in env validation; it is not a new defect.

Actual process success still requires a real P12/P13/current-pin producer. The
authorized 0140 Kernel reader is now implemented and tested, separately from
0139 report reads; historical 0138 negatives remain. Reader and recovery-layer
decisions are settled within their approved scopes. They do not grant S6 business
reads or approve the separate P12 schema. Do not grant synchronizer membership or
manufacture a passed report. Continue independent initialization and controller
work without relaxing scans, grants or timeouts. Documentation impact: this plan
pair and existing operator/evidence pair. The Draft remains partial; no production
operations are authorized.

| Threat | Required observation / evidence owner |
| --- | --- |
| Missing args, absent/unapproved/blocked report; unknown CLI option | Nonzero typed refusal at real CLI, parent B |
| Old source controller invokes new check | Actual source command cannot resume traffic on diagnostic success, parent B |
| Cross candidate/target/release/mapping/source, stale purpose/attempt | Existing verifier rejects exact-input mismatch; no Bash verifier, parent B/C |
| Pre-activation used for runtime/public release; forged approvals | Refusal at each action; distinct approval records, parent C |
| apply/resume/recover-candidate/no-op bypass | All reachable release paths gated; old-service recovery distinct, parent B |
| Missing/ordered phases, concurrent controller, unknown commit | Journal/lock refusal; no reset/guess, parent C |
| Fresh with any old inventory; partial migration/checksum drift | Refuse false fresh; immutable historical SQL; retry evidence, parent G |
| Runtime superuser/role inheritance/DEFINER escalation | Real limited logins and business/negative PG proof, D |
| Wrong DB/host/Compose/volume/bucket/Redis or partial restore | Keep isolated; explicit bound recovery, E |
| Candidate write/queue/public traffic followed by pointer rollback | Persistent refusal, E |
| Untrusted/expired/wrong TLS chain; insecure readiness | Reject; trusted synthetic chain succeeds; no secret leakage, F |
| Lost values/history/protected references or unknown Policy count | Full classification/consumer oracle, no count equivalence, G |
| Lane pgvector assumed equivalent to source postgres:16-alpine | Separate extension compatibility evidence, G |

## Test levels and stop points

Red then focused Green at CLI/controller seams; real subprocess exit codes; real PostgreSQL migration/role tests; isolated Docker/Compose ordering; synthetic populated oracle; build/contract/boundary/selfhost/docs checks. Browser changes require playwright-cli desktop/tablet/mobile. Each run records exact SHA/tree, command, exit and collected/passed/failed/skipped separately. Setup failure is not zero-test success. A synthetic rehearsal, B authorized backup rehearsal and C production execution remain separate.

External blockers: no authorized real backup, enterprise CA, or production maintenance authorization supplied. #815 still needs authoritative Policy association or approved unavailable contract. Frozen unavailable release phases are an integration blocker, not permission to forge implementation or approvals. Continue independent work while these remain blocked.

## Documentation Impact Matrix

| Change | English | Chinese | Gate |
| --- | --- | --- | --- |
| Scope/threats/evidence | This plan | Companion plan | docs:check |
| Upgrade/diagnostic/handoff contract | ops/self-hosted/upgrade.md | ops/self-hosted/upgrade.zh-CN.md | CLI tests + docs:check |
| Operator procedure | New populated-upgrade runbook | Chinese terminal procedure | Only tested real commands; unavailable steps explicit |
| Build trust | Existing build-network documentation as needed | Matching companion | Trust tests |

## Documentation Update Gate

Update both language files in the same change; generators own generated artifacts. Run `npm run docs:check` before plan completion. This plan remains active until its independent deliverables and limitations are recorded; no production readiness inferred from code completion.
