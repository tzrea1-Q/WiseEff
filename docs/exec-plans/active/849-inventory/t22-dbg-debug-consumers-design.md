# T2.2-DBG debug consumers — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dbg-debug-consumers-design.md)

Companion to the [threat matrix](t22-dbg-debug-consumers-threat-matrix.md). Debug observations stay overlays. Bound identities are exact or typed-block. Do not keep a values intercept or an unbound snapshot painted onto every row.

Status: **Spec PASS with P2 folded.** Independent review `01a0aff9-7f3a-7f81-ad64-4132a6d2e2e6`. Implementation may start.

## 1. What T2.2-DBG is

Classify S12-DBG (17). Repair: (a) `exactDebugOperationValues` nulls a guessed spec slot at runtime; (b) `attachDebugPins` / `insertPinnedNodeOperation` use `resolveDebugProtectedReference` with `binding: null` for every record. Fail closed on unresolved links. Do not steal DTS reload promotion.

| Seam | Owner today | T2.2-DBG |
| --- | --- | --- |
| Device read/write/rollback | `service.ts` + approval/lease/snapshot | Keep; overlay only |
| Reload via `parameterDefinitionId` | already 410 | Keep GONE |
| Debug-node admin catalog | `/api/v1/debugging/admin/catalog/*` | Keep 2xx |
| `exactDebugOperationValues` | values intercept | **Delete** |
| List/operation pins | unbound snapshot for all rows | **Stored binding id or typed-block** |
| `insertPinnedNodeOperation` | copies unbound `pin.bindingId` | **Do not copy unbound pin** |
| Catalog promotion | not in this module | Record T2.2-DTS |
| Client/mock | debugging routes | Keep; no spec mint |
| Comparison | intercept helper tests | Retarget |
| Jobs/scripts | none in shard paths | Record none |

## 2. Classification method

Group `s12-dbg.json` by `file` × `rule`. Labels: canonical-current-debug-overlay, canonical-current-exact-pin, exact-canonical-history, archived-notice (`exactDebugOperationValues` / reload-definition).

## 3. Repairs after Spec PASS

**A. Delete values intercept (`canonicalProtectedReference.ts`)**

Remove `exactDebugOperationValues`. Do not wrap `db.query` or rewrite insert values after the fact.

**B. Exact pin or typed-block**

Never call `readProtectedReference` with `DBG_UNBOUND_SNAPSHOT` / `binding: null`. For a debug parameter/operation:

- `listDebugParameters` **must SELECT** stored `project_parameter_binding_id` (add it to `debugParameterColumns`).
- If that binding id is present, pin that binding (`canonical-pin`).
- Else typed-block `missing-binding`. Do not invent a spec id from `parameterDefinitionId`.

`attachDebugPins` is per-record from stored fields, not one global unbound read.

**C. Operation insert (`service.ts`)**

`insertPinnedNodeOperation` must not set `projectParameterBindingId` from the unbound pin. Persist `input.projectParameterBindingId` only (or the stored link on the debug parameter). `parameterSpecId` only if supplied as that binding's spec; never coerce from `parameterDefinitionId`.

**D. Tests**

Retarget `parameterCatalogComparisonContribution.test.ts`: delete `exactDebugOperationValues` tests; assert pins are binding-id-or-block and insert values are not rewritten by a helper. Keep writeNode reload 410 tests. Keep device-write approval tests.

**E. Out of family**

Do not implement dts-reload promotion. Do not edit T2.1 fixtures, TOP relocation, AGT/LOG intercepts. Do not 410 debug-node catalog or device writes.

## 4. Ratchet

1. Implement A–D.
2. Checker `--trusted-base-sha 9b3ba7df7e21f5589684bc92c872da593ad4c246` if it can complete. If T2.2-TOP `editService.ts` relocation still blocks, record that error; do not rewrite those fixtures.
3. Delete only vanished **DBG** shard entries. No growth, no checker weakening.
4. Receipt: DBG before **17**, total before **3513**, after counts, delta.

`exactDebugOperationValues` still present after repair is a Spec fail even if delta ≠ 0. Honest zero only when the helper is gone and the checker is blocked.

## 5. Evidence

- `test:server --` affected debugging files (`canonicalProtectedReference` via comparison test, `service.test.ts` if write/pin touched).
- `git diff --check`. `tsc -b` if types change.
- Browser: default **no UI sweep**.
- Independent Standards + Spec implementation review.
- Bilingual acceptance with classification groups.

Helper PG 55438.

## 6. Order after Spec PASS

1. Delete values intercept + exact/block pins + insert no unbound copy.
2. Retarget comparison tests.
3. Checker / DBG shard ratchet if possible.
4. Receipt; review; stop. No T2.2-DTS. No commit.

## PR Plan

This todo does not open a PR.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Delete intercept + exact pin | `canonicalProtectedReference.ts`, `service.ts`, tests | Spec PASS |
| B | Shard ratchet | `s12-dbg.json` if tokens gone | A |
| C | Receipt | T2.2-DBG docs | B |
