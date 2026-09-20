# T3.4b integration receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t34b-integration.md)

Status: **Conditional Scratch is on `main`. T3.4a is still not a full SEAL. Do not close #849/#853.**

## PR #884

| Field | Value |
| --- | --- |
| PR | https://github.com/tzrea1-Q/WiseEff/pull/884 |
| Merge | squash to `main` at 2026-09-20T02:15:43Z |
| Merge SHA | `fbb17717ad05f521da8651ed6dcf1ba08e502819` |
| Hosted run | `35481683792` Merge bar SUCCESS / `CLEAN` |
| Skipped Hosted | local-non-HDC, target-synthetic, minimal-upgrade |

## PR #885

| Field | Value |
| --- | --- |
| PR | https://github.com/tzrea1-Q/WiseEff/pull/885 |
| Merge | squash `--admin` to `main` at 2026-09-20T05:13:41Z |
| Merge SHA | `be052265588bd9da0602c099bd82cae0ad02b1c5` |
| Hosted run | `35489948533` |
| Jobs that ran | L1 static/frontend/scripts/backend, quality, smoke — SUCCESS |
| Jobs that did not start | Build and test, Merge bar — GitHub Actions budget exhausted |

Local re-check on `be0522655` (helper PG **55438**, not `5432/wiseeff`):

- `check-parameter-catalog-boundaries.test.ts` **24 passed**; leftover still **55** unallowlisted
- `dispose.integration.test.ts` **6 passed** on `wiseeff_ut_routes` (residue disposer, not DROP)

Does not seal T3.4a, does not zero T1.4 leftover, does not authorize T2.3b DROP of successor tables.
