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
| `apply` | Typed intent, real approved pre-activation report and current target observation | **Not executable yet:** `COMPARISON-ADAPTER-UNAVAILABLE` protects the missing formal Comparison-to-S10 evidence binding before journal pending or SQL |

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

| R3 threat | Enforcement / required evidence |
| --- | --- |
| Wrong physical database | Same acquired session checked before any target lock and before completion |
| Concurrent controller or stale snapshot | Exact S7 session advisory lock before the repeatable-read snapshot |
| Mapping/installer writer bypassing the advisory lock | SHARE locks on the existing mutable Catalog/mapping inventory relations during management writes |
| Input, source, mapping, report or predecessor drift | Fixed cloned intent/observations, complete inventory and exact current chain checks; formal report projection |
| Partial commit or process failure | Atomic 0137 writes, static unknown outcome, durable pending and explicit readback reconciliation |
| Report or caller digest used as permission | Report approval projection plus mandatory future formal comparison evidence binding; currently fails closed |
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

Remaining internal work: formal comparison report artifact/9-gate evidence
association, genuine approved report and principal chain, released-lease and
cross-run/fork fault expansion, actual current read-mode consumption, host journal
reconciliation integration, and the complete controller/API/worker positive path.
Real backup, enterprise network and production authorization remain distinct
external evidence. These limitations are not an instruction to stop internal work.
