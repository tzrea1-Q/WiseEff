# Debugging Repository Behavior Tests (TD-096 slice 2)

Status: **Completed** (PR #345)

## Goal

Retire the SQL-text-assertion test file `server/modules/debugging/repository.test.ts` (1,385 lines, 39 tests, 99 `toContain` assertions against a hand-rolled fake database) in favour of behavior-level tests running the real repository functions against Postgres via `createInMemoryTestDatabase()` (rollback-per-test, savepoint transactions, `describe.skipIf(!databaseAvailable)`).

New file: `server/modules/debugging/repository.integration.test.ts` — 20 behavior tests. Tenancy is asserted as behaviour (seed two organizations, read across the fence) instead of grepping for `organization_id = $1`. Verified against both identity modes: post-cutover local database (semantic) and a fresh migrated database (legacy, CI-equivalent) — `insertNodeOperation` / `listDebugSessionEvents` fork on `parameterIdentityMode()`.

The catalog block (`debugging_parameters`, protocol bindings) is the archive-only legacy surface per TD-033; coverage is kept so archive/restore invariants stay guarded, and the block is labelled accordingly.

## What the migration surfaced (fake-fixture fictions)

- `debugging_parameters` enforces uniqueness on `(organization_id, node_path)` (`debugging_parameters_org_node_path_idx`) — invisible to the fake DB; now an explicit behavior test.
- Lease semantics the fake could not exercise: a live lease **refuses** a competing session (upsert `where` guard returns no row); takeover after expiry resets `acquired_at`; renewal by the owner preserves it. Asserted with backdated timestamps because `now()` is frozen inside the fixture transaction.
- `linkOperationSnapshot` silently refuses cross-session links (join predicate), not just cross-tenant ones.

## Old → new test mapping

| Old test (`repository.test.ts`) | New coverage (`repository.integration.test.ts`) |
| --- | --- |
| creates debugging parameters for admin catalog writes | creates a parameter and reads back the full record, invisible to other tenants |
| updates debugging parameter mutable metadata for admin catalog writes | updates mutable metadata in place and refuses cross-tenant updates |
| archives and restores debugging parameters without deleting rows | archive hides a parameter from runtime lists… and restore preserves enabled state |
| preserves catalog enabled state when archiving and restoring debugging parameters | same (enabled-state assertions on both params) |
| excludes archived debugging parameters from runtime lists by default | same (runtime list excludes archived and disabled) |
| includes archived debugging parameters for admin lists when requested | same (`includeArchived: true` branch) |
| listDebugParameters returns sorted parameters by sort_order | lists parameters ordered by sort_order then name |
| maps debugging parameter archive fields | covered by full-record read-back (`archivedAt`, `archiveReason`) |
| maps debugging parameter value metadata with scalar defaults | covered by full-record read-back of create defaults |
| updateDebugParameterValues stores current and target values for a scoped parameter | updateDebugParameterValues writes current/target only inside the owning organization |
| upserts and archives protocol bindings | upserts a binding, updates it idempotently, and archive hides it from enabled-only reads |
| returns null when upserting a binding for a parameter outside the organization scope | refuses to bind a parameter owned by another organization |
| maps target, session, and operation protocol fields | covered by read-backs in target/session/operation tests |
| returns parameter node bindings by parameter and protocol | binding upsert/get round-trips |
| can return disabled parameter node bindings when explicitly requested | `includeDisabled: true` assertions (bindings + smoke default) |
| keeps parameter node binding lookup enabled-only by default | archive → default lookup returns null |
| lists shared protocol bindings for selected parameters | lists bindings for selected parameters… |
| returns the enabled default ADB smoke binding for an organization | …and returns only the enabled ADB smoke default |
| listDebugDevices filters by organization | scopes device lists and lookups to the organization |
| getDebugDevice scopes device lookup by organization | same |
| upsertDetectedTargets updates target status and device last_seen_at | upsertDetectedTargets updates target status, derives device status… |
| upsertDetectedTargets creates bridge-backed debug devices before persisting targets | …and auto-creates bridge devices |
| ensureBridgeDebugDevice upserts bridge-backed debugging_devices | ensureBridgeDebugDevice upserts only bridge-prefixed device ids |
| ensureBridgeDebugDevice skips non-bridge device ids | same |
| createDebugSession persists an active session for actor | createDebugSession persists an active session readable by its organization only |
| ensureDtsReloadLeaseSession upserts target then synthetic session | ensureDtsReloadLeaseSession creates target + synthetic session idempotently |
| acquireDebugDeviceLease returns the lease when the device is claimable | lease acquisition renews for the owner, refuses a live competitor, and allows takeover after expiry |
| acquireDebugDeviceLease resets acquired_at when a different session takes over | same (backdated-timestamp assertions) |
| releaseDebugDeviceLease expires only the owning session lease | releaseDebugDeviceLease expires only the owning session's lease |
| insertNodeOperation stores read/write status, values, failure reason, duration | insertNodeOperation stores read/write outcome fields and lists them newest-last |
| listDebugSessionEvents returns operations newest-last for UI history | same |
| createDebugSnapshot stores JSON entries and valid status | snapshot lifecycle test (entries + `valid` assertions) |
| markSnapshotConsumed prevents reuse / marks consumed | snapshot lifecycle: … → consumed, each edge scoped and single-shot |
| markSnapshotConsumed returns null when no valid scoped snapshot is updated | same (cross-tenant + double-consume nulls) |
| claimSnapshotForRollback atomically moves only valid scoped snapshots to rollback_pending | same (single-shot claim assertions) |
| claimSnapshotForRollback returns null when no valid scoped snapshot is updated | same |
| restoreSnapshotValid moves only rollback_pending scoped snapshots back to valid | same |
| links operation snapshots and inserts debug events with metadata | links a snapshot to an operation only within the same session…; insertDebugEvent persists audit trail rows with metadata |
| (net-new) | rejects a second catalog parameter on the same node path within one organization |

## Verification

- `npx vitest run server/modules/debugging/repository.integration.test.ts`: 20/20 against the post-cutover local database (semantic mode) **and** against a fresh migrated database (legacy mode)
- `npm run test:server` full suite on the fresh database
- `tsc -b` clean; `npm run docs:check` green

## Documentation Impact Matrix

| Area | File(s) | Impact |
| --- | --- | --- |
| Planning docs | `docs/PLANS.md`, this plan | Update (entry + status) |
| Quality/testing docs | `docs/design-docs/testing-strategy.md` | No change (pattern documentation is owned by TD-096's closing slice, together with the parameters slices) |
| Tech debt | `docs/exec-plans/tech-debt-tracker.md` | Update (TD-096 progress note: debugging repository slice done) |
| Repository maps / product / security / runbooks / generated / references / zh-CN | — | No change (test-only change; no behaviour, contract, or schema impact) |

## Documentation Update Gate

- [x] `docs/PLANS.md` lists this plan
- [x] TD-096 row updated with the debugging slice
- [x] `npm run docs:check` green
- [ ] Move to `completed/` after merge
