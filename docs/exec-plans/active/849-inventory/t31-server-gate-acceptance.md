# T3.1 S1 / full server gate — progress receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t31-server-gate-acceptance.md)

Status: **local candidate green.** Full `test:server` on this Scratch is green. Not SEALED. No commit, PR, Hosted, target, or Issue update. Browser stays T3.2. Docker/S2 stays T3.3a. T3.4a remains the seal point.

HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e` plus uncommitted Scratch through T2.3b + T3.1 follow-up (0158/0159, seed/ACL/route/V13).

## Environment

- Helper PG **55438** / `wiseeff_t23b`. Not `wiseeff_lane_849`. Not compose `5432/wiseeff`.
- `S2_SCH_CONTRACT_FINGERPRINT` = `7bc944915eabc1689a9976332864bae3bc602fd9c407e91ed826340dbe0f69e1` (through 0158 function ACL; 0159 is SELECT grants only). `S2_SCH_0137_FINGERPRINT` unchanged. `sourceOccurrenceMigration` apply list includes 0154–0159.

## Verification (do not sum)

| Command | Result |
| --- | --- |
| `DATABASE_URL=…55438/wiseeff_t23b npm run test:server` | **573 files** / **4628 tests**: **4628 passed**, **0 failed**. Exit 0 |
| `npm run typecheck` (`tsc -b`) | **passed** |
| `npm run contract:check` | **passed** (OpenAPI artifact regenerated for the three published routes) |
| `npm run db:schema-doc:check` | **not re-run this turn** (previously skipped: pgvector-canonical CI owns that gate) |
| `npm run build` | **passed** (`tsc -b` + `vite build`) |

## What this turn changed (local Scratch only)

- Binding/observation seeds now supply 0151 `source_occurrence_id` + pin graph (`catalogSchemaRollback`, vendor T19, CP-10 revision, installer traffic).
- Catalog ACL: `plane_disposal_*` tables in T1 count; T13 upgrade through 0159; 0158 makes DELETE-allowing triggers SECURITY DEFINER and revokes PUBLIC execute on `plane_disposal_allows_delete`; 0159 grants disposer SELECT on named public tables.
- V13 ignores `catalog_migration_owner` DELETE grants on public legacy tables (NOLOGIN definer owner, not a login writer).
- Published `source-diff`, `reimport-preview`, `configuration-instances` in `routeManifest` + `schemaRegistry`.
- Governance/query/Agent/catalog-api fixtures use source-backed Binding/ingest. Agent legacy identity submissions now assert 409 `legacy-identity-mode-retired-for-agent`.

## Remaining program boundary

T3.1 is a local server gate only. T3.2 browser, T3.3a Docker/S2, T3.3b target, T3.4a seal, T3.4b PR/Hosted/merge, T3.5 Issue close are unchanged. Do not treat this Scratch as a delivery candidate until T3.4a.
