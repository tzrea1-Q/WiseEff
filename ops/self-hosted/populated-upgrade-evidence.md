# Populated upgrade candidate evidence

> Chinese: [Chinese](populated-upgrade-evidence.zh-CN.md)

## Identity and status

Collected 2026-09-06, local isolated development only. Source deployment remains `82344044b436a8dafecefbb85dfd724cecb05e3f`; supplied historical image ID is `sha256:be121540c40fbb35e774b48cefb29b7ddf27d1bb8aa0c050a17acca3b7dfbf6c`, not a registry manifest or a newly verified image. Initial development base was `1c9fa56e3eaca6e7984f35a097876772a6e4025d`. Final refresh base is `67d4a77325b6009b77c2373bd788298a6d022bcf`; its advancement is documentation-only PR #822.

Code candidate: `b2c150d18bb6d7a8d8d5b45bcbf9f683fdafecbf`, tree `b8eb49d3a074e00196fb89c30ba4d1cae3677b3c`, branch `codex/populated-upgrade-candidate`. All 27 task blobs match the preserved earlier Scratch `d357a5e6538f4bac4d63ba782ce13f75fe1cf194`. This evidence document is a later report-only change, not a relabeling of executions. No CI checkout, merge-ref, final merge SHA, release bundle/pin, mapping/source freeze, or approved real target exists for this candidate.

| Outcome | State |
| --- | --- |
| UPG-01 missing-context refusal | Implemented and real CLI regression demonstrated |
| Complete upgrade code delivery | Incomplete; boundary regression and release integrations remain |
| Synthetic populated | Original schema and limited value/history migration passed; full semantic rehearsal not completed |
| Authorized real backup rehearsal | Not run; no backup supplied and intake adapter incomplete |
| Actual recovery | Synthetic three-store sentinel restore executed and verified; full business/real recovery unproven |
| Hosted / PR | Not run / not opened; Scratch is not integration-ready |
| Production maintenance readiness | No |
| Production execution / approval | Not authorized, not executed |

## Regressions and commands

On initial base with a real isolated PostgreSQL fixture, `npm run parameter-definitions:check -- --catalog-only` returned exit 0 with typed `absent/missing`. On `8922b3884573bd5d7c3c3f2efce53f3f51d6b894` it returned exit 2 and `PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE`; explicit `--verify --diagnostic --report-id missing` still returned typed absence with exit 0. The actual seven-line source controller gate fixture matches source Git bytes (SHA256 `29c28f2b5951bf4650984ec1be07ac121b8bb61c07e29388f70b7848e8952232`). Its subprocess regression uses the real npm/CLI and a Docker transport adapter; it is not a full old-controller Compose proof. New ordinary-stack apply/no-op/resume/recover-candidate refuse unsupported canonical targets. A usable production handoff is still missing.

Local tools: Node 22.22.3, npm 10.9.8, Vitest 4.1.5, Docker 29.5.3. New original-schema tests use isolated `postgres:16-alpine`; the dedicated verifier fixture uses pgvector PostgreSQL 16. Migration inventory is 126 original files plus 11 candidate suffix files 0129–0139, complete filename/checksum validation. This does not establish production extension compatibility or application startup readiness.

| Exact code | Check | Result |
| --- | --- | --- |
| 8922b3884 | 11 focused script files, real Docker flags enabled | 266 passed, 0 failed/skipped; exit 0 |
| 8922b3884 | Full scripts | 103 files: 99 passed/4 failed; 1306 tests: 1251 passed/17 failed/38 skipped; exit 1 |
| d357a5e65 | CLI plus boundary after restoring inherited inventory | 42 tests: 41 passed/1 failed; exit 1; prior Scratch parent shrink rejected restoration |
| 1c9fa56e3 and d357a5e65 separately | Serial exactRelocation/source-lock, original timeout limits | Each 37 passed, 0 failed/skipped; exit 0; 53.98s and 60.40s |
| Same two SHAs separately | One real zero-inventory export/import/rollback selector with matched isolated URL/container | Each 1 passed, 80 selector-filtered; exit 0; other failed scenarios not rerun |
| b2c150d18 | 12 focused files, both Docker flags, `--maxWorkers=1` | 290 collected: 289 passed/1 failed/0 skipped; exit 1; 83.94s |
| b2c150d18 | Boundary CLI with trusted base 9b3ba7df7e21f5589684bc92c872da593ad4c246 | 3513 violations: 3512 matched, 1 unallowlisted/1 stale, 0 growth/mismatch; exit 1 |
| b2c150d18 | npm run build | exit 0; existing Node externalization/chunk warnings retained |
| d357a5e65 | contract:check / selfhost:check | Both passed |
| 8922b3884 | docs:check with dedicated PostgreSQL | Governance and schema artifact passed |
| 2e40a8b3d | Report and role server integration files | 31 passed, 0 failed/skipped; not a full server suite |

The remaining boundary failure is this candidate's responsibility: the retained legacy verifier reference moved and no longer binds its frozen occurrence. No assertions, checker limits, or allowance IDs were changed to hide it. Original full-suite failures also include 15 database/container routing failures and two timeouts (33 tests skipped after setup timeout). Bounded same-environment comparisons support routing/load attribution but do not turn that full batch green. Full frontend/server suites, browser business acceptance, growth capacity, complete consumer oracle, enterprise-network image builds and Hosted were not run.

Logs and exact full-file hashes are included in the local delivery archive, under `evidence/` and `manifest.json`. They retain their original execution SHAs; synthetic credentials and host paths are not production evidence. No private backup or business values are included.

## Remaining work and ownership

The [frozen relocation contract](../../docs/agents/catalog-boundary-relocation.md) explicitly forbids padding source to retain identities. Independent Standards review rejected that option. The minimal boundary decision is a separately reviewed exact mapping for this unchanged occurrence (full blobs, spans, raw bytes and adversarial coverage), or debt removal under its owning contract. The existing 23-pair authorization does not approve this new mapping.

Parent implementation owner must resolve the occurrence regression without loosening the frozen boundary. Release integration owner must supply approved P12/P13 ownership, post-retirement full verification, runtime/public-release wiring and fixed-identity handoff. Runtime security owner must implement actual role/pool migration and business acceptance; the new inspector does not change credentials. Recovery owner must implement authorized backup intake, same-boundary snapshots and target-bound full restore. Product owner must resolve #815 authoritative Policy references or explicitly approve unavailable. Build operator must provide enterprise CA and actual trusted image provenance. Data owner must authorize a real backup. Acceptance owner must complete full semantics/browser/capacity. Production authorization remains separate.

Independent Standards review passed the bounded code and verified all 27 refreshed blobs. Independent Spec review accepted only the bounded helpers and explicitly found the complete request unmet. The earlier Docker ambient-target P1 was fixed with pinned local endpoint/daemon identity checks. No overall seal, release approval, or OP-09 closure is claimed. Follow the [terminal guide](populated-upgrade.md); it deliberately provides no production upgrade command.
