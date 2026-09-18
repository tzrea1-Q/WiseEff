# T2.2-AGT agent consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-agt-agent-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-AGT, [API transition](../../../design-docs/parameter-catalog-api-transition.md) Agent tools row, [inventory](../../../references/parameter-catalog-contract-inventory.md) Agent tools row, T2.2-FIL [acceptance](t22-fil-file-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the AGT implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-agt-agent-consumers-design.md). Independent review `01a0afc7-92e3-7393-af5a-442594f0cc6c`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-FIL remain uncommitted; do not rewrite except AGT-owned paths.
- Allowed paths: `server/modules/agent/tools/actionTools.ts`, `server/modules/agent/toolRegistry.ts`, `server/modules/agent/toolMetadata.ts`, `server/modules/agent/parameterCatalogComparisonContribution.ts`, `server/modules/agent/tools/perceptionTools.ts`, matching in-family tests, `e2e/acceptance/xiaoze-action.acceptance.spec.ts`, and `scripts/parameter-catalog-allowlist/shards/s12-agt.json` for ratchet. Classify in-family; do not steal LOG/DBG/DTS/KNW/xiaoze internals/`orchestrator.ts`.
- Stop after T2.2-AGT. No T2.2-LOG or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible Xiaoze/tool surface changes. Default: no UI sweep (tool identity repair).
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_agt`.

## Invariant under protection

Every S12-AGT runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Agent catalog reads stay in the invoking principal's scope. Parameter mutation is **governed draft + human approval** on a **binding id**. Unresolved or stale tool arguments **fail closed**. **Stale checkpoints/tool arguments cannot revive legacy PPV/definition writes.** Agent cannot mint specs, register subjects, change placements, or resolve review. Repair behavior before deleting an allowance. Comparison adapters are not switched consumers.

## Intake (measured 2026-09-17)

Shards still total **3513**. S12-AGT `s12-agt.json` has **30** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `actionTools.ts` | 2 | `legacy-parameter-spec-identifier` (`parameterSpecId` on submit items) |
| `actionTools.integration.test.ts` | 23 | sql-write 14, identifier 6, overlay-catalog 2, raw-read 1 |
| `actionTools.test.ts` | 3 | identifier |
| E2E `xiaoze-action.acceptance.spec.ts` | 2 | raw-read |
| `perceptionTools.ts` / `toolRegistry.ts` / `toolMetadata.ts` / comparison | 0 shard rows | Already off hotspot |

Rules: `legacy-catalog-sql-write` 14, `legacy-parameter-spec-identifier` 11, `legacy-catalog-raw-read` 3, `legacy-overlay-catalog-contract` 2.

Live leak: `action.submitParameterChange` still calls `submitLegacyParameterChange` when `resolveParameterIdentityMode() === "legacy"` (`getProjectParameterForUpdate` + flat `{ parameterId, targetValue }` submit). Unit test **expects** that TD-079 path. Post-cutover, a stale checkpoint/editedArgs `parameterId` must not take that write. Semantic path already uses `loadBindingContext` + `createBindingDraft` + submit with draft identity and `parameterSpecId` from the draft (keep; T2.2-PRJ still requires submit spec id). Perception already returns `pin.bindingId`. No Agent spec-mint tool. Xiaoze checkpointer/`orchestrator.ts` are **out of shard**; the tool boundary is the AGT-owned fail-closed gate.

## Classification freeze

| Class | Meaning in AGT | This todo |
| --- | --- | --- |
| Canonical current — agent read | perception, knowledge read tools, comparison adapter | Keep |
| Canonical current — governed draft | `action.submitParameterChange` binding + approval + `parameterSpecId` from draft | Keep / require binding |
| Exact canonical history | unit/integration/e2e | Keep / retarget legacy-submit test |
| Archived notice | `submitLegacyParameterChange` / TD-079 flat submit | **Remove**; ratchet vanished tokens if checker can |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22A-01 | Inventory | 30 entries classified by file×rule | receipt table |
| T22A-02 | Binding submit | Semantic submit uses binding id + `createBindingDraft`; `parameterId` is binding id | `actionTools.ts` + tests |
| T22A-03 | No legacy write | `submitLegacyParameterChange` **gone** (Spec fail if leftover, even when delta ≠ 0). Non-semantic identity mode does not call `getProjectParameterForUpdate` or flat submit | grep + `actionTools.test.ts` retarget |
| T22A-04 | Stale args | Unknown/non-binding `parameterId` → no PPV write (NOT_FOUND/CONFLICT) | existing 404 + new legacy-mode refusal |
| T22A-05 | Approval / provenance | Durable agent session + tool-call + approval still required before domain work | existing tests keep |
| T22A-06 | Catalog writes | No spec mint, placement, proposal, or review-resolve tool | `toolMetadata.ts` inventory |
| T22A-07 | Perception | Search citations remain binding ids via protected reads | no rewrite unless leak |
| T22A-08 | Checkpoints | Xiaoze checkpointer/`orchestrator.ts` out of shard; tool layer refuses legacy writes on resume payloads | receipt |
| T22A-09 | Comparison | contribution stays an adapter | no intercept |
| T22A-10 | Ratchet | Repair first; delete vanished AGT tokens vs 30/3513. Honest zero only if the legacy function is gone and checker is blocked | shard + checker if runnable |
| T22A-11 | UI | 1440x900 only if Xiaoze UI changes. Default no sweep | receipt |
| T22A-12 | Environment | 55438 disposable | receipt |
| T22A-13 | Non-goals | T2.2-LOG…OPS, T1.4, T2.1 fixture churn, Hosted, commit | receipt |

## Non-goals

- Zeroing 30 AGT allowances.
- 410 of `action.submitParameterChange` or perception tools.
- Removing submit `parameterSpecId` (still required on binding items).
- Rewriting `xiaoze/**`, `orchestrator.ts`, T2.1 `semanticBindingFixture.ts`, T2.2-TOP `writeLock.ts`.
- Agent knowledge draft tool (not a catalog structural write; owned with KNW if later).
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
