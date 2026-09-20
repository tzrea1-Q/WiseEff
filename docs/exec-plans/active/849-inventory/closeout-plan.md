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
| C1 | **Not zeroed.** Last complete leftover count was **55** / stale **0**. Current tree cannot re-run the CLI to zero: relocation dest-blob reject on `e2e/acceptance/parameter-topology.acceptance.spec.ts` (Gate0-required Catalog 404 allowlist). Dest-rebind is not authorized. T1.4 stays unchecked. Checker not weakened. |
| C2 | **Passed** on `3b516ee1e` / helper PG **55438** / run `full-20260920t111458015z-3b516ee1e79e-23180b78` (repeat of `bc16fc633` after dest-blob restore). Visual **passed**. Playwright **passed**. Coverage **passed**. Operation-evidence **passed**. Inventoried **0**. Runtime cleanup **completed**. Not a skip-as-pass. |
| C3 | **Passed** on `6f8cbd236` / helper PG **55438** / owned HMAC runtime `full-20260920t120007490z-6f8cbd2361f8-391f8bd8` (API `127.0.0.1:18800`, frontend `127.0.0.1:5180`). Command: `npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime --runtime-descriptor <runtime.json> --frontend-url http://127.0.0.1:5180`. Preflight **passed** (`non_hdc_local`). Playwright **174 passed / 32 skipped**. Coverage **passed** (135 required IDs). Operation-evidence **passed** (192 records, invalid none). Status **passed**. Artifacts under `test-results/t32-target-synthetic-runtime/full-20260920t120007490z-6f8cbd2361f8-391f8bd8/`. Existing T3.3b `:18080` image `t33b-19b987e5a` was not used (SHA mismatch). Not Hosted; not production. |
| C4 | **CLI executed** on helper PG **55438** clone `wiseeff_dispose_c4_closeout` (TEMPLATE `wiseeff_quality_snap`; empty `public.project_parameter_values` added because post-cutover rename left `legacy_project_parameter_values`). Object store: owned-runtime seed files. `npx tsx scripts/wayfinder/dispose-plane-residue.ts --approval-ref closeout-c4` for atlas/aurora/nebula: aurora archive `pppa_9a06092d-a12c-4738-98c2-ad89d8c329a0` residue **232**; atlas `pppa_24107722-d8d6-44e7-8f0d-bc7ba5a635c7` residue **116**; nebula `pppa_f8401f4d-1080-47e0-bddf-f385eabce763` residue **116**. firstPhase/replayPhase both `residue-deleted` (idempotent DELETE, not DROP). After: `public.parameter_drafts` **0**; successor `public.project_parameter_bindings` and `parameter_catalog.project_parameter_bindings` still present. No DROP. Tests still **6 passed** on `wiseeff_ut_routes`. |
| C5 | **Not SEALED.** C1 leftover 55, minimal-upgrade still amd64-only. |
| C6 | **Not started.** Issues stay open. |

PR after C1–C4 local evidence (and C5/C6 only if actually sealed).
