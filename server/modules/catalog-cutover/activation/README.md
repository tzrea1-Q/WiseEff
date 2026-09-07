# Existing-storage application read activation

[中文](README.zh-CN.md)

This is unfinished PR #824 Scratch implementation. It adds no schema, migration,
grant or frozen phase change. It uses the existing 0137 Cutover run, immutable
event and checkpoint stores. It does not change the P0–P10 orchestrator's public
phase allowance. The application read binding is distinct from the P5 Catalog
pointer. No API/worker startup or full controller success is claimed.

The public factory is `createApplicationReadActivation`. The owning controller
supplies an independently observed physical target, the existing restricted
NOINHERIT management login, the separate report reader, its actual source and
traffic boundary, and the durable host journal adapter. The controller must wrap
`apply` in the existing `runCatalogReleaseAction` dispatcher. Domain code never
imports that script or substitutes its own verifier.

| Command | Inputs and effect | Output / failure contract |
| --- | --- | --- |
| `inspectFacts` | Exact run/plan; management read-only transaction | Actual Catalog, complete mapping inventories and current binding; an unprepared epoch remains null |
| `prepareMappingEpoch` | Explicit management write, exact run/plan and held boundary | One immutable P11 `activation-mapping-epoch` preparation event; it is not a P11 verification checkpoint or approval |
| `inspect` | Exact typed activation intent | Applied binding only when it remains the unique current chain head and live source/mapping/Catalog agree; otherwise exact not-applied or refusal |
| `inspectOnHeldManagementSession` | Exact intent and the P13 owner's actual management lease | Same physical target, identity, UTC, strong transaction isolation and granted Exclusive S7 lock; reads the same current binding without acquiring a second lease |
| `apply` | Typed intent, real approved pre-activation report, actual Comparison artifact and current target observation | Formal approval projection and exact nine-gate artifact association precede journal pending and SQL; missing, unrelated or changed evidence refuses |

An epoch hashes the complete C-ordered current head/version/identity rows and
all historical mapping versions, under UTC, plus physical target, run, plan and
source snapshot. Missing identities, heads or referenced versions are failures,
not empty-source evidence. Inspect never records an epoch. Changed inventory
invalidates the old epoch; explicit preparation records the newly observed one.
Preparation alone never approves changed source or mapping semantics.

Activation intents bind run, attempt, physical target, plan, explicit predecessor,
approved report selection and expected observation digest. They use `sha256:`
digests and align with the host journal's typed activation port. The domain run
is distinct from the host upgrade run. A database-wide explicit predecessor
chain, rather than timestamps or a latest-row query, determines the unique head.
The existing `(run, P12)` checkpoint key allows one committed activation per run.

The private SQL effect atomically changes the run progress and appends its P12
event/checkpoint. A rolled-back transaction has no binding. The controller must
durably record pending before SQL and only record committed after acknowledgment.
Lost acknowledgment requires formal inspection and host journal reconciliation;
it never permits clearing the journal or blindly repeating the activation.
Inspection of a stored binding is not report approval or runtime admission.

The held-session inspector probes an existing transaction with a randomly named
`SAVEPOINT` and `RELEASE SAVEPOINT`. These are local transaction-control effects;
the method does not begin or commit a transaction, change roles, write business
data or run DDL. It refuses autocommit and aborted transactions. The P13 owner
keeps its management lease and source boundary alive. Kernel still owns its own
transactions; no Kernel transaction is passed into this method. The ordinary
inspector retains its original independent lease and lock behavior.

The root supplies `comparisonReport` from the actual comparison execution's
`readEvidence().report`. The factory snapshots these bytes. After the formal
approved report projection succeeds, `assertComparisonEvidenceAssociation`
checks the original Comparison checksum and all nine gate envelopes, results and
typed refs. Its returned digest must equal the independently observed digest.
This wiring has not yet produced a successful authorized public `apply` run.
The actual full consumer producer, valid privilege gates and approvals remain
required; passing a report-shaped object cannot bypass them.

| R3 threat | Enforcement / required evidence |
| --- | --- |
| Wrong physical database | Same acquired session checked before any target lock and before completion |
| Concurrent controller or stale snapshot | Exact S7 session advisory lock before the repeatable-read snapshot |
| Mapping/installer writer bypassing the advisory lock | SHARE locks on the existing mutable Catalog/mapping inventory relations during management writes |
| Input, source, mapping, report or predecessor drift | Fixed cloned intent/observations, complete inventory and exact current chain checks; formal report projection |
| Partial commit or process failure | Atomic 0137 writes, static unknown outcome, durable pending and explicit readback reconciliation |
| Report or caller digest used as permission | Formal report approval projection and exact Comparison artifact/9-gate association; missing evidence fails closed |
| Private diagnostics or lease leakage | Static errors, synchronous management error observer, destructive pool release, original refusal preserved |

Documentation impact is confined to this README pair. Parent-owned journal,
controller, release adapter and operational documentation must be integrated and
reviewed independently. No production command is available from this component.

## Executed evidence and limits

From Scratch base `d7cdd6473` plus the tracked activation implementation:

- Pure public-boundary regression: 2 passed / 3 failed before fixes, then 5/5.
- Owned PG16 first scope: 6/6; expanded fixture first run: 7/10 with three fixture
  failures (foreign-identity Archive FK, subsequent replay, missing source row).
  Corrected expanded run: 10/10, 10.68 seconds, zero skips, owned cleanup verified.
- Actual old `82344044…` schema and nonempty archived definitions ran through
  the existing P0–P10 orchestrator. Its older no-Binding P2 flags are **not** a
  production quiescence proof. These tests do not cover full Binding conversion.
- Real restricted management/report logins exercise epoch/inspection, contention,
  missing-report refusal and SQL persistence. The private SQL test intentionally
  uses unapproved references and therefore does not call public `apply`, emit a
  release approval or authorize startup. No passed report is inserted or mocked.
- A real owner mapping append uses a checksum of observed synthetic source bytes.
  It proves inventory drift invalidates the previous epoch, not that the old
  source plan becomes applicable again.
- The owned runner selector is `activation-existing-pg16`, in
  `scripts/run-upgrade-component-tests.ts`. It requires the existing real daemon
  admission and owned-cluster receipt; there is no ambient DATABASE_URL fallback.

An additional owned PG16 observation ran the existing P01/P02 implementations
under an actual 0139 SELECT-only login and a READ ONLY transaction. With the
controlled management membership present, P01 failed; removing only that test
membership made P01 pass. P02 passed in both cases, but all seven P01 and nine
P02 role-switch probes returned `42501` before reaching the intended writer.
This diagnoses the existing verifier contract conflict, not successful writer
privilege verification. The test restores the original management membership.
No verifier grant or historical gate implementation is changed.

Remaining internal work: genuine approved report and principal chain, released-lease and
cross-run/fork fault expansion, actual current read-mode consumption, host journal
reconciliation integration, and the complete controller/API/worker positive path.
Real backup, enterprise network and production authorization remain distinct
external evidence. These limitations are not an instruction to stop internal work.
