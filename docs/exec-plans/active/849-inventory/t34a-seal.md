# T3.4a freeze and independent review — seal record

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t34a-seal.md)

State: **PRESEAL-REVIEW FAIL. Not SEALED.** Independent Standards and Spec reviews are **grok-4.6**. T3.4a stays unchecked. No PR/push/Hosted. T3.4b is not started.

Round 4 candidate (this turn):

| Field | Value |
| --- | --- |
| HEAD | `d12bc808c9de2903b143ebfada4ccd9ec67eec23` |
| Tree | `6fd5066572f60dc9d50e2a68e05dbba37679b132` |
| Base / accepted main | `46b6068693942b95f7cba28ee5de6748a97170fa` |
| Branch | `codex/849-853-t11-source-identity` |
| Commits ahead of main | 57 |
| Independent reviews | grok-4.6 Standards **PASS** (P0=0 P1=0 P2=1); Spec **FAIL** |
| `tsc -b` | **passed** on `d12bc808c` |
| `npm run build` | **passed** on `d12bc808c` (chunk-size warnings remain) |
| T3.3a+T3.3b+liveStorePorts on this SHA | **5 passed** |

Spec FAIL (cannot SEAL): T3.1 and T3.2 checklist rows still open; Gate0 last full pass is `3dc5c9411`; T3.1 `test:server` not re-run on this SHA; T3.2 target-synthetic and minimal-upgrade still **not pass**; no independent seed/release fixture PASS. T3.3b is an authorized **local** self-hosted target (`:18080`), not a T3.4a-sealed remote host. Standards P2: Redis non-string keys fingerprint cardinality only.

## Candidate identities (Round 1 freeze, historical)

| Field | Value |
| --- | --- |
| Implementation freeze (pre-typecheck-fix) | `dc660481fe76656990520dbd503d693207373d09` |
| Round-1 HEAD / Gate0 SHA | `3dc5c94119c10061de92e90a4f99c8a36b7089d0` |
| Round-1 tree | `ddc2c4565c9f53ec338ae15919846b8a7c99dc50` |
| Base / accepted main | `46b6068693942b95f7cba28ee5de6748a97170fa` |
| Branch | `codex/849-853-t11-source-identity` |
| Commits ahead of main (Round 1) | 48 |
| Helper PG | **55438** (`wiseeff-g668-pg`). Not `wiseeff_lane_849`. Not 5432/`wiseeff`. |
| `S2_SCH_CONTRACT_FINGERPRINT` | `7bc944915eabc1689a9976332864bae3bc602fd9c407e91ed826340dbe0f69e1` (through 0158) |
| `S2_SCH_0137_FINGERPRINT` | `f2ad57b2af5c6e0d50841284bacf5aff927dd1dbf09039099144e20216c82453` |
| Last applied migration in tree | `0159_plane_disposal_definer_select.sql` |

`3dc5c9411` is `dc660481f` plus a typecheck-only identity-pin construction fix (`tsc -b` failed assigning readonly `CutoverIdentityPin` keys).

## Independent reviews (grok-4.6)

Round 1 (SHA `3dc5c9411` / docs `2d3895e66`):

| Axis | Verdict | Notes |
| --- | --- | --- |
| Standards | **FAIL** 0 P0 / 1 P1 | P3 operator JSON beside postgres-only receipt. |
| Spec | **FAIL** 1 P0 / 3 P1 | Evidence not one SHA; T3.2 leftovers not pass; T3.3b no target; exclusive unfreeze unit-only; P2/P3 not live fencing. |

Round 2 Standards (`beeea0bf0` memory stubs): still **FAIL** P1.

Round 3 Standards (`f2c7ef968`, grok-4.6): **PASS** (P0=0 P1=0). Isolated Docker postgres/redis/MinIO; live RESP and S3 health probe; apply reports `threeStoreRecoveryPoint: true` only with `WISEEFF_REDIS_URL` + `OBJECT_STORAGE_*`.

Round 4 Standards (`d12bc808c`, grok-4.6): **PASS** (P0=0 P1=0 P2=1). Redis non-string keys fingerprint cardinality only; exclusive unfreeze still fail-closed; 5432/`wiseeff` unused.

Round 4 Spec (`d12bc808c`, grok-4.6): **FAIL**. T3.3b “no target” is closed as an authorized local self-hosted instance; it does not make a one-SHA seal. Remaining P0: T3.1/T3.2 rows open, Gate0/`test:server` not on `d12bc808c`, T3.2 synthetic/minimal-upgrade not pass. Disposition: **not SEALED**.

Live Docker three-store rehearsal (not 5432/`wiseeff`, not `wiseeff_lane_849`):

```bash
docker compose -p wiseeff-t34a-stores -f ops/self-hosted/compose.t34a-stores.yaml up -d
```

Ports: postgres `127.0.0.1:55441/wiseeff_t34a`, redis `127.0.0.1:56379`, MinIO `127.0.0.1:59000`. `ops/self-hosted/storage/liveStorePorts.integration.test.ts` captured postgres+MinIO+Redis through `captureRecoveryPoint` (**1 passed**). `upgrade.sh` uses those live ports when `WISEEFF_REDIS_URL` and `OBJECT_STORAGE_*` are set; otherwise it still reports `threeStoreRecoveryPoint: false` and `notCapturedStores: ["redis"]`.

## Evidence bound to `3dc5c9411`

| Gate | Result | Level |
| --- | --- | --- |
| `acceptance:quality` | passed | static |
| `acceptance:coverage` | passed; `missingRequiredIds: []`; `coverageMapOrphanIds: []` | static |
| `acceptance:operations` | passed; `missingAutomatedOperationIds: []` | static |
| `tsc -b` | passed on 3dc5c9411 | static |
| `npm run build` | passed (chunk-size warnings remain) | static |
| `git diff --check origin/main...HEAD` | exit 2: trailing whitespace in `t23a-archive-disposal-design.md`; new blank line at EOF in applied `0153_source_occurrence_integrity.sql` (not edited this seal) | static |
| `LANG=C` Gate0 | **passed** run `full-20260919t063253898z-3dc5c94119c1-ddcd3c3d`; visual passed; browser passed; inventory 0; operation-evidence passed (`missing: []`, `invalid: []`); cleanup completed | local-non-HDC / browser-real |
| T3.1 `test:server` | last full green was older Scratch `f9c710f6a` / `wiseeff_t23b` (4628 passed). **Not re-run on 3dc5c9411.** | stale vs this SHA |
| T3.3a cutover/S11-APL/rehearsal | recorded on `dc660481f` | local PG/Docker |
| target-synthetic | **not pass** — [t32-remaining-verification.md](t32-remaining-verification.md) | skipped / unavailable |
| minimal-upgrade | **not pass** — same file | skipped / unavailable |
| T3.3b target | Authorized local-target; rehearsal **1 passed** again on `d12bc808c` — [t33b-remaining-verification.md](t33b-remaining-verification.md). Does **not** reseal T3.4a. | local self-hosted target |

## Seed / release fixture

No separate T3.4a fixture-review agent ran. Frozen in-tree pins: S2-SCH fingerprints above; Catalog capability D1 digest from T2.2-CGH remains `sha256:3d5c70fb5e0aad4bb7c3c063ca3283a81fb39ec25c471669a0500dd410a48f97` (historical). Seed reconciliation manifest is unchanged this turn. This is **not** an independent fixture PASS.

## Reviewable target / restore plan

Authorized local-target evidence: [t33b-target-plan.md](t33b-target-plan.md) / [t33b-remaining-verification.md](t33b-remaining-verification.md). Restore remains whole-state (application + PostgreSQL + object-store + Redis). A Catalog pointer flip or DB-only restore is forbidden after traffic. This local instance is not production and is not a T3.4a-sealed remote host.

## Stop boundary

T3.4a open, **not SEALED**. T3.4b PR/Hosted/merge not started. No Issue mutation.
