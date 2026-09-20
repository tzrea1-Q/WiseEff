# Closeout plan — leftover, T3.2, T2.3b, T3.4a/T3.5

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/closeout-plan.md)

Base: `origin/main` **`3d5e3b1348a02973545be353d83fc3fdb390d8d2`**. Branch: `codex/849-853-closeout`. Helper PG **55438**. Not `5432/wiseeff`. Not production. No Hosted quota. Do not DROP successor tables.

| ID | Item | Local pass | Stop if |
| --- | --- | --- | --- |
| C1 | **T1.4 leftover 55** | Checker summary `unallowlisted: 0`, `staleAllowances: 0`. Do not weaken the checker. | leftover cannot go to 0 without checker weakening |
| C2 | **T3.2 local-non-HDC** | Gate0 / `acceptance:browser --mode local-non-hdc` on this SHA, owned ports, helper PG | environment missing |
| C3 | **T3.2 target-synthetic** | `acceptance:browser --mode target-non-hdc --no-start-runtime` against local Docker target (`:18080` if up) | target down |
| C4 | **T2.3b `disposeProjectParameterPlaneResidue`** | Run disposer on helper PG 55438 against a captured Atlas/Aurora/Nebula plane (residue DELETE, not DROP). Record command, archive id, residue counts, replay no-op. | archive missing / auth refuse |
| C5 | **T3.4a full SEAL** | Bind S1/S2/browser/dispose evidence to this SHA; grok-4.6 Standards+Spec PASS; seed/release fixture review. **Blocked if C1–C3 fail or minimal-upgrade still has no amd64 pass.** | minimal-upgrade still required and unavailable |
| C6 | **T3.5 close #853 then #849** | Only after C5. Docs/diff gate, story/decision map, then close issues. | C5 not SEALED |

`minimal-upgrade` stays out of this plan (linux/x86_64). If it remains the only T3.2 hole, C5/C6 stay open and the PR records that.

## Progress

| ID | Status |
| --- | --- |
| C1 | **Not zeroed.** Inventory still 55 (`legacy-catalog-raw-read` 18, `legacy-parameter-spec-identifier` 15, `legacy-catalog-route` 9, `legacy-catalog-sql-write` 7, `legacy-effective-governance-contract` 3, `legacy-catalog-table-name` 2, `legacy-overlay-catalog-contract` 1). Stale 0 — these are current-tree hits, not dest-rebind. Gone-path `view:governance` and adapter tests of `/api/v2/parameter-specs` cannot be deleted without hiding the 410/route surface. T1.4 stays unchecked. |
| C4 | Disposer **executed** on helper PG via `dispose.integration.test.ts` **6 passed** (`wiseeff_ut_routes`). CLI against `wiseeff_dispose_c4` (TEMPLATE `wiseeff_quality_snap`) refused at capture: M1 seed has no `public.project_parameter_values` (34-relation archive is the test plane, not M1). No DROP. |

PR after C1–C4 local evidence (and C5/C6 only if actually sealed).
