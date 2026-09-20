# T2.2-DTS reload consumers — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dts-reload-consumers-threat-matrix.md)

Contract: #849/#853 T2.2-DTS, [API transition](../../../design-docs/parameter-catalog-api-transition.md) DTS reload row, [inventory](../../../references/parameter-catalog-contract-inventory.md) DTS reload row, T2.2-DBG [acceptance](t22-dbg-debug-consumers-acceptance.md). Product direction (eleven families, classify, repair then ratchet, vs 3513) is decided. This matrix freezes the DTS implementation boundary.

Status: **Spec PASS with P2 folded.** Companion: [implementable design](t22-dts-reload-consumers-design.md). Independent review `01a0b01e-21b9-79e1-a8cf-75485959fd8e`.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T2.2-DBG remain uncommitted; do not rewrite except DTS-owned paths.
- Allowed paths: `server/modules/dts-reload/**`, `DtsReloadRepository.ts`, `dtsReloadClient.ts`, matching tests, `e2e/acceptance/dts-reload-deploy.acceptance.spec.ts`, and `scripts/parameter-catalog-allowlist/shards/s12-dts.json` for ratchet. Classify in-family; do not steal KNW/MOD/OPS/DBG/AGT/xiaoze. Handoff/promote e2e files may be classified even if not in shard paths.
- Stop after T2.2-DTS. No T2.2-KNW or later, T1.4, commit, PR, merge, Issue mutation.
- Viewport 1440x900 only if a visible `/dts-reload` pin/handoff surface changes. Default: no UI sweep (SQL pin repair).
- Reviewers: grok-4.6 (requested gpt-5.6-luna unavailable; disclose).
- Helper PG 55438 disposable only. Never `wiseeff_lane_849`, never `5432/wiseeff`. Prefer `wiseeff_t22_cgh` or `wiseeff_t22_dts`.

## Invariant under protection

Every S12-DTS runtime read, write and reference is classified as **canonical current**, **exact canonical history**, or **authorized archived notice**. Reload candidates/verify/promote use **canonical binding + exact property_key + pinned config revision**. Unresolved pins **fail closed**. Promotion creates **canonical drafts**, never writes configured catalog values. Overlay members stay **DTS files only**. There is **no scanner-visible SQL that runtime rewrites**. Repair source SQL before deleting an allowance. Comparison adapters are not switched consumers.

## Intake (measured 2026-09-18)

Shards still total **3513**. S12-DTS `s12-dts.json` has **54** entries:

| Kind | Count | Notes |
| --- | --- | --- |
| Production `repository.ts` | 18 | 17 raw-read + 1 unresolved |
| Production `behaviouralVerify.ts` | 3 | raw-read (debug-node match by spec id) |
| Tests | 29 | sql-write 24, identifier 3, unresolved 1, raw-read 1 |
| E2E deploy | 4 | raw-read |

Rules: raw-read 25, sql-write 24, identifier 3, unresolved 2.

Live leak: `listReloadCandidateRows` / `getReloadCandidateRow` **source SQL** still uses `string_to_array(ps.specification_key)` / `coalesce(dps.property_key, ps.specification_key)` and latest-revision locator `order by … config_revision_id desc`. `behaviouralVerify` matches `debugging_parameters` by `parameter_spec_id` as well as binding id. Runtime `pinDtsReloadQueryable` wraps `db.query` via `interceptExactReloadPinSql` so executed SQL drops those fallbacks while the scanner still sees them. Same dishonest pin as T2.2-FIL/LOG. Callers: `service.ts`, `deploy.ts`, `promote.ts`.

Already good: overlay members `ppf.format = 'dts'`; `promote.ts` uses `createBindingDraft` (no catalog value write); residue/restore have server tests; HANDOFF/PROMOTE Playwright remain `test.skip(true)` with unit coverage cited.

## Classification freeze

| Class | Meaning in DTS | This todo |
| --- | --- | --- |
| Canonical current — reload | start/deploy/verify/residue/restore, DTS overlay members | Keep |
| Canonical current — exact pin | candidate SQL + verify match by binding id | **Repair SQL in source** |
| Canonical current — promote | `createBindingDraft` from stored debug values | Keep |
| Exact canonical history | tests, e2e deploy, comparison | Keep / retarget intercept tests |
| Archived notice | specification_key fallback, latest-revision locator, spec-id debug match, intercept | **Remove** |

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T22R-01 | Inventory | 54 entries classified by file×rule | receipt table |
| T22R-02 | Exact property pin | Candidate SQL uses `dps.property_key` only; no `specification_key` fallback in source | `repository.ts` + tests |
| T22R-03 | Exact revision pin | Logical-node locator subquery requires `config_revision_id = br.config_revision_id` in source SQL | `repository.ts` + tests |
| T22R-04 | No intercept | `pinDtsReloadQueryable` / `interceptExactReloadPinSql` / `__dtsExactPin` **gone** | grep + comparison test |
| T22R-05 | Verify match | Debug-node resolve matches `project_parameter_binding_id` only (no spec-id fallback) | `behaviouralVerify.ts` |
| T22R-06 | Promote | Drafts via `createBindingDraft`; no change request; no catalog value write | `promote.ts` + existing tests |
| T22R-07 | Overlay files | Device overlay members stay `format = 'dts'` | `repository.ts` |
| T22R-08 | Playwright | HANDOFF/PROMOTE e2e remain planned skip this family (unit coverage exists). Default no UI sweep | receipt |
| T22R-09 | Ratchet | Repair first; vs 54/3513. Leftover intercept is Spec fail even if delta ≠ 0. Honest zero only if intercept gone and checker blocked | shard + checker if runnable |
| T22R-10 | UI | 1440x900 only if `/dts-reload` UI changes. Default no sweep | receipt |
| T22R-11 | Environment | 55438 disposable | receipt |
| T22R-12 | Non-goals | T2.2-KNW…OPS, T1.4, T2.1 fixture, Hosted, unskip Playwright as gate, commit | receipt |

## Non-goals

- Zeroing 54 DTS allowances.
- Unskipping HANDOFF/PROMOTE Playwright as this todo's completion gate.
- Writing configured catalog values on promote.
- Including JSON/software files in overlay members.
- Churning T2.1 `semanticBindingFixture.ts` or T2.2-TOP relocation fixtures.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

Written by the coordinating implementer. Independent Spec review is required before production edits.
