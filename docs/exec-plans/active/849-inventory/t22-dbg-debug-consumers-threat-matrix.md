# T2.2-DBG debug consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dbg-debug-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-DBG, [API transition](../../../design-docs/parameter-catalog-api-transition.md) Node/device debugging row, [inventory](../../../references/parameter-catalog-contract-inventory.md) Debugging row, T2.2-LOG [acceptance](t22-log-log-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the DBG implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-dbg-debug-consumers-design.md). Independent review `01a0aff9-7f3a-7f81-ad64-4132a6d2e2e6`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-LOG remain uncommitted; do not rewrite except DBG-owned paths.
- Allowed paths: `server/modules/debugging/**`, `DebuggingGateway.ts`, `debuggingClient.ts`, `debuggingDtos.ts`, matching tests, `e2e/acceptance/debugging-admin.acceptance.spec.ts`, and `scripts/parameter-catalog-allowlist/shards/s12-dbg.json` for ratchet. Classify in-family; do not steal DTS-reload/AGT/LOG/FIL/xiaoze.
- Stop after T2.2-DBG. No T2.2-DTS or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible debugging citation/pin surface changes. Default: no UI sweep.
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_dbg`.

## Invariant under protection

Every S12-DBG runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Debug observations stay **operational overlays** and **must not mutate the definition library**. Bound identities are **exact** (`debugging_parameters.project_parameter_binding_id`) or **typed-block**; never a guessed spec/definition. Unresolved links **fail closed**. Approved promotion into configured values is **canonical draft** (owned with T2.2-DTS if the promote path lives in dts-reload). Device write approval rules stay. No scanner-visible identity that runtime rewrites (`exactDebugOperationValues`). Repair behavior before deleting an allowance.

## Intake (measured 2026-09-17)

Shards still total **3513**. S12-DBG `s12-dbg.json` has **17** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| `repository.ts` | 10 | unresolved 7, identifier 3 (`parameter_spec_id` on `node_operations`) |
| `catalogSplitRepository.ts` | 4 | unresolved (debug node catalog SQL) |
| `routes.ts` | 2 | `legacy-catalog-route` — **debug node** admin catalog `/api/v1/debugging/admin/catalog/*`, not parameter-specs |
| `service.test.ts` | 1 | unresolved |

Rules: unresolved 12, identifier 3, catalog-route 2.

Live leaks:

1. `exactDebugOperationValues` in `canonicalProtectedReference.ts`: runtime nulls a guessed spec slot while scanned placeholders remain. Same dishonest-pin shape as T2.2-FIL/LOG intercepts. Used by comparison tests; **not** called from `insertNodeOperation`.
2. `resolveDebugProtectedReference` always reads `binding: null` + unbound snapshot, then `attachDebugPins` paints **every** parameter/node/operation with that one pin. That is not an exact bound identity from `debugging_parameters.project_parameter_binding_id`.
3. `insertPinnedNodeOperation` copies `pin.bindingId` from that unbound read onto `node_operations`.
4. `writeNode` still keys reload on `parameterDefinitionId`; the reload path is already **410 GONE**. Keep GONE. Do not revive reload writes. Promotion into configured values is **not** in this module (T2.2-DTS).

Device writes already go through lease/snapshot/approval. Debug admin catalog is the **debug-node** catalog (keep 2xx).

## Classification freeze

| Class | Meaning in DBG | This todo |
| --- | --- | --- |
| Canonical current — debug overlay | sessions, node writes, snapshots, debug-node admin catalog | Keep 2xx; no catalog mint |
| Canonical current — exact pin | optional `project_parameter_binding_id` on debug parameter / operation | **Exact or typed-block** |
| Exact canonical history | tests, e2e, comparison | Keep / retarget intercept helper |
| Archived notice | `exactDebugOperationValues`; reload-via-definition-id | **Delete helper**; reload stays 410 |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22D-01 | Inventory | 17 entries classified by file×rule | receipt table |
| T22D-02 | Overlay vs catalog | Debug writes do not mint/patch `parameter_specs` or configured binding values | grep + existing write tests |
| T22D-03 | Exact pin | List/operation pins come from stored binding id or typed-block; no unbound snapshot for the whole list | `canonicalProtectedReference.ts` + service |
| T22D-04 | No intercept | `exactDebugOperationValues` **gone** | grep + comparison test retarget |
| T22D-05 | Insert | `insertPinnedNodeOperation` does not copy unbound `pin.bindingId`; persist caller/stored binding only | `service.ts` |
| T22D-06 | Reload | `parameterDefinitionId` write path stays 410; no PPV write | existing GONE |
| T22D-07 | Promotion | No DBG-owned catalog promotion; drafts belong to T2.2-DTS if any | receipt |
| T22D-08 | Approval | Device write/rollback approval unchanged | no rewrite |
| T22D-09 | Debug catalog routes | `/api/v1/debugging/admin/catalog/*` stay 2xx (debug-node catalog) | no 410 |
| T22D-10 | Ratchet | Repair first; delete vanished DBG tokens vs 17/3513. Leftover `exactDebugOperationValues` is Spec fail even if delta ≠ 0. Honest zero only if helper gone and checker blocked | shard + checker if runnable |
| T22D-11 | UI | 1440x900 only if debug pin UI changes. Default no sweep | receipt |
| T22D-12 | Environment | 55438 disposable | receipt |
| T22D-13 | Non-goals | T2.2-DTS…OPS, T1.4, T2.1 fixture, Hosted, commit | receipt |

## Non-goals

- Zeroing 17 DBG allowances.
- 410 of debug-node admin catalog or device write routes.
- Implementing DTS reload promotion (T2.2-DTS).
- Changing device lease/snapshot/approval.
- Churning T2.1 `semanticBindingFixture.ts` or T2.2-TOP relocation fixtures.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
