# Catalog publication runtime acceptance (RA-01–RA-04)

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-09-13-catalog-publication-runtime-acceptance.md)

Status: **Active**. This plan operationalizes the already-merged CP-00–CP-10 stack from [PR #827](https://github.com/tzrea1-Q/WiseEff/pull/827). It does **not** redo Catalog architecture or CP-02–CP-10.

Accepted base: `origin/main` `1059acb57379bd120d0d2b1a4b4733d4c2e02901` (PR #827 merge; head `8622a1d7da419725bc142b2ab917483c3ddfce68`).

## Goal

An operator using the formal delivery image and supported self-hosted entries can complete: preexisting Catalog inspect → exact adoption → real publisher grant → in-product new definition → true activation → DTS ingest → project value save → second publish → restart reread.

Operators must not write ad-hoc TypeScript, SQL-patch Catalog rows, or depend on `WISEEFF_CATALOG_TEST_CAPABILITIES` to enable publication.

## Stop boundary

This wave does **not** authorize: business-server login, real customer DSN, production account mutation, `publication_enabled=true` on a shared `wiseeff` database, CP-12 target-host enablement, reopening #824, or a GitHub PR/merge until the user authorizes it.

`publication_enabled` remains default `false`. Isolated enablement uses `revisePublicationPolicy` only on an ephemeral database name (`wiseeff_<alnum>_<n>_<n>`) with `EPHEMERAL_POLICY_REVISION_CONFIRMATION`. That is not production authorization.

## Four findings

| ID | Finding | Disposition |
| --- | --- | --- |
| F1 | `ops/self-hosted/compose.yaml` has `worker:logs` only | **RA-01**: add `publication-manager` on the same app image |
| F2 | `operations.md` still says “call the runtime adoption adapter” | **RA-02**: executable `catalog-publication-ops` wrapping collector + `adoptPreexistingCatalog` |
| F3 | acceptance treats `/入队\|正在执行\|已生效\|曾经成功/` as success | **RA-04**: queued/running after timeout is failure |
| F4 | `setPublicationFreeze` has no upgrade/restore callers | **RA-03**: freeze then stop manager in `wiseeff_upgrade_stop_old_stack`; do not unfreeze on failure |

## Work packages

Shared Compose / package / env / no new migration checksums: one owner on `feat/catalog-publication-runtime-acceptance`.

| Package | Risk | Paths | Stop |
| --- | --- | --- | --- |
| RA-01 | R3 deploy | compose, selfhost check, Dockerfile unchanged except verified COPY of `managerRunner`, upgrade service list, env example split | Default `publication_enabled=false`. API/log worker never receive manager env file. |
| RA-02 | R3 ops | `scripts/catalog-publication-ops.ts`, adoption `check` export, capability bind CLI | No second installer; no overlay grants; no fake `repositoryReference` |
| RA-03 | R3 recovery | `upgrade-lib.sh` freeze/manager stop, ops freeze/unfreeze | Failure/timeout leaves freeze set |
| RA-04 | R2/R3 evidence | honest publication acceptance + isolated runner | Missing prerequisites exit non-zero; never skip-as-pass |

## Documentation Impact Matrix

| Area | Paths | Action |
| --- | --- | --- |
| Repository maps | `AGENTS.md` | Review — no new top-level map |
| Planning | `docs/PLANS.md`, this plan + Chinese pair | Update |
| Product specs | `docs/product-specs/*` | No change |
| Architecture / ADR | ADR-0043, control-plane | Review — no ADR rewrite |
| Quality / testing | `docs/developer/verification-matrix.md` + Chinese, coverage maps if new ops | Update |
| Reliability / runbooks | `ops/self-hosted/operations.md`, `upgrade.md`, README + Chinese; new `ops/self-hosted/catalog-publication.md` pair | Update |
| Security | `docs/developer/environment-variables.md` + Chinese | Update |
| Frontend / design | publication acceptance spec only | Review |
| Generated | none | No change |
| References | baseline verification | Review |

## Documentation Update Gate

Blocking: bilingual operator handbook, operations/upgrade tables, env-var rows, verification-matrix command, `npm run docs:check`.

## Success

Isolated environment proves the operational loop on the formal image/Compose path. A later actual server only re-runs those commands with real-environment verification and a separate production-enablement authorization.
