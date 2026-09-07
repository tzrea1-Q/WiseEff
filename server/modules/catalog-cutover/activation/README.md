# P12 application-read persistence

> Chinese: [Chinese](README.zh-CN.md)

This management component implements the persistent portion of the existing
[P12 contract](../../../../docs/design-docs/parameter-catalog-cutover-archive-rollback.md).
It does not implement application read routing, P13, runtime approval, queue
delivery, public release, or pointer rollback. The P0–P10 orchestrator and its
unavailable later-phase contract remain unchanged.

## Ownership and authority

`0141_parameter_catalog_application_activation.sql` adds exactly three
`catalog_migration_owner` tables: `cutover_mapping_epochs`,
`cutover_activation_attempts`, and `application_read_state`. Historical migrations
are unchanged. No runtime, verifier, governance or synchronizer capability is
added. The migration rejects residual ACLs introduced by the installing login's
default privileges. P5's `catalog_state` is neither updated nor redefined.

The management LOGIN remains restricted and NOINHERIT; each management transaction
explicitly assumes the existing owner. The Catalog Kernel uses an independent
0140 reader connection and owns its read-only transaction. Report projections use
their existing separate database connection and approval implementation.

The component owns the dedicated Catalog reader pool. Every actual Kernel
checkout verifies the LOGIN and capability role, their sole PG16 membership
(INHERIT true, SET false, ADMIN false), ownership, direct ACLs, PUBLIC capabilities
and privileged function delegation before a random session-lock challenge binds
that exact checkout to the independently observed management database. It grants
nothing. The ordinary business pool and the report reader are separate: additional
business/report capabilities are a refusal on this dedicated connection.
Restricted built-ins' PUBLIC EXECUTE is compared with PostgreSQL's recorded
[initial privileges](https://www.postgresql.org/docs/16/catalog-pg-init-privs.html),
not the permissive default function ACL. The challenge is not a maintenance lock
or a release approval.

PUBLIC definers are audited by the owner's effective capability relative to the
reader across application schemas: table and individual column privileges,
sequence privileges, CREATE and additional function EXECUTE. A low-privilege
owner can still delegate a private inner function or sequence; the function's
SQL body is not parsed as evidence. A definer with no additional owner capability
is not rejected merely for being a definer. Effective database CREATE (including
PUBLIC) is refused; ordinary database CONNECT/TEMP remains unchanged.

`createP12Activation` requires an actual target owner. `installTarget(attemptId)`
installs its P12 effect into the existing `runCatalogReleaseAction` target port;
there is no CLI, default target, environment approval, or generic SQL executor.
The actual owner supplies artifact, storage, subject, recovery and isolation facts;
it receives observed management facts, never a report from which to invent pins.
The SQL effect is private and re-reads the approved report through the formal
Report service. Domain checks here do not replace the release dispatcher's
complete purpose, applicability, lineage and approval contract.

## Stable epoch and observation

`prepareEpoch` is an explicit management write. It freezes a deterministic digest
of the actual target, run/source/plan identity, complete current mapping heads and
versions, complete public source inventory digest, and P0–P10 checkpoint digest.
Missing or dangling mapping heads are rejected. A new head/version invalidates the
old epoch; a changed source snapshot is rejected. Archive, Catalog and migration
changes independently invalidate report applicability without redefining mapping
identity. Epoch creation does not approve a report or re-create historical P7.

`inspect` is read-only; it never creates an epoch or fixes a checkpoint. It requires
the genuine controlled P0–P10 path, including P0 source inventory, P2/P3 recovery
boundary and P4 management receipt. Earlier boolean-only fixture checkpoints do
not qualify. Management facts and Kernel materialization are independently read
under the actual maintenance boundary and compared before returning metadata.

The report's database `targetIdentity` is the canonical digest of the observed
`{systemIdentifier,databaseOid}` pair. `schemaVersion` is the exact last packaged
migration filename; the full filename/checksum inventory is bound separately.
These serialization choices are local producer contracts, not new privileges or
a replacement verification schema.

## Persistent CAS and interruption

An attempt is persisted before the CAS. The effect owns a SERIALIZABLE transaction,
the existing Cutover advisory lock, run/pointer row locks, and mapping/Catalog
table locks. It rechecks actual facts and the owner's boundary before writes and
commit. One transaction changes legacy to canonical, increments generation,
records P12 event/checkpoint and marks the attempt applied. It never modifies P5.
Actual management identity is checked before any advisory, row or table lock;
a wrong database is rejected before touching its activation objects.

An uncertain commit destroys the connection and leaves the durable attempt for
inspection. No automatic retry, journal reset, pointer reversal or traffic action
exists. `inspectAttempt` reads pointer, attempt, P12 checkpoint and event even if
source facts subsequently drift. Only matching atomic records yield `applied`;
`pending`, `missing` and `inconsistent` are explicit. Even `applied` is effect
reconciliation, not a new release authorization. The parent controller owns the
next approved action.

`inspectAppliedBinding` returns the persisted binding only after the same read
transaction verifies pointer, attempt, checkpoint, event and recomputed request
digest. P13 and startup producers use this public management seam; they must still
observe their current state and obtain their own applicable approval. This reader
does not turn historical activation facts into current runtime authorization.

## R3 threats and verification ownership

| Threat | Required result / owner |
| --- | --- |
| Missing target owner, empty inventory, malformed attempt, direct effect call | Refuse before database access; pure admission tests |
| Legacy schema / missing release / incomplete P0–P10 / boolean preparation | No epoch or CAS; real PostgreSQL tests |
| Source, mapping, migration, artifact or target drift | Existing report not reused; component plus parent integration |
| Wrong purpose, missing/unapproved report, foreign subject | Formal Report and release dispatcher refuse; parent report chain |
| Concurrent controller, lost lock, unknown commit | One atomic effect or retained pending; real PostgreSQL fault cases |
| Reader connects to another database or mixed endpoint | Actual checkout must be independently target-verified; foundation integration |
| Reader gets SET/ADMIN, another role, direct ACL, PUBLIC CREATE or high-privilege function delegation | Refuse before the session challenge; dedicated LOGIN regression |
| Reader or PUBLIC reads/writes activation metadata | Denied; real restricted LOGIN migration tests |
| P12 succeeds but candidate/public effects are requested | Refuse; later effects are not installed by this slice |

## Evidence and documentation impact

This is Scratch implementation. Pure admission tests and migration text checks are
not real SQL activation evidence. The earlier five real PG16 component cases
prove schema preservation, restricted Kernel reads, session target challenge and
missing-run/privileged-login refusal on their recorded bytes; they do not prove a
successful P12 CAS. The subsequent owned `activation-pg16` run on 2026-09-07
13:06:26 +08:00 collected 16, passed 16, failed 0 and skipped 0 (exit 0), including
ten actual LOGIN drift cases and the wrong management database. It used PG16
Alpine, not a production copy, and verified cleanup. This was uncommitted Scratch
code atop `04590b69a`; the parent evidence record must bind its file hashes to the
eventual commit without relabelling it as a post-commit run. Genuine P11 reports and approvals, root processes, and
controller end-to-end execution remain separate integration evidence. No production command is executable from
this component alone. Do not use the Report tests' constant `passingAdapters` to
claim a legitimate P11 report.

The follow-up owner-delegation review used the same owned PG16 lane. At
2026-09-07 13:21:40 +08:00, the prior audit resolved instead of rejecting all five
new unsafe cases: 22 collected, 17 passed, 5 failed, 0 skipped, exit 1. After the
capability comparison and effective database CREATE fix, the 13:22:30 run passed
22/22, 0 skipped, exit 0, including the definer with no additional capability.
Both runs verified cleanup; neither executes or proves P12 activation.

| Artifact | Update owner |
| --- | --- |
| This module contract and Chinese companion | Activation slice |
| Migration inventory and generated schema | Parent, using existing generator after integration |
| Active upgrade plan, evidence and terminal manual | Parent; one consolidated bilingual record |
| Runtime/worker/controller shared files | Parent; not modified in this slice |

Pure checks: `node_modules/.bin/vitest run --config
server/modules/catalog-cutover/activation/vitest.config.ts`. The real SQL cases
must run in the existing owned upgrade-component lane, not against ambient
`DATABASE_URL`. No production or real-backup operations are authorized here.
