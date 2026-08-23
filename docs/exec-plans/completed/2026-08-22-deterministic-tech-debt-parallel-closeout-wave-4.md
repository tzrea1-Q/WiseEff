# Deterministic tech-debt parallel closeout — wave 4

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md)
>
> Status: **Completed 2026-08-24**
>
> Date: 2026-08-22
>
> Planning baseline: `origin/main@86f2f409b6529ca459c0079e58c4d68bbdae2dc4`
>
> Planning branch: `codex/deterministic-tech-debt-wave4-plan`

> Closeout branch: `codex/deterministic-td-wave4-closeout`
>
> Implementation PRs: #598 (TD-067), #599 (TD-105), #600 (TD-014), #601 (TD-005 slice), #602 (hotspot), #603–#607 (TD-122)
>
> Final implementation baseline: `main@493a257a1f3507f883715c5b5235af7a233914c7`

## Goal

Close the largest safe set of independent rows that needs no HDC/ADB hardware, target deployment, live model/provider, KMS, expert-labelled data, or unresolved customer input:

- **TD-105:** bound `log_webhook_deliveries` growth through a production retention seam shared by both log-worker modes.
- **TD-014, conditional:** retire the unused legacy debugging-parameter Admin HTTP/client contract and prove node-catalog export/import governance. Close only if an explicit node-only architecture decision assigns live HDC evidence to TD-100 and proves no broader catalog-governance residual; otherwise keep TD-014 Open with the deterministic slice recorded.
- **TD-067, conditional:** make the stock self-hosted single-API topology executable and normative. Close only when ADR-0020 and the supported deployment contract explicitly make every non-bridge-aware multi-replica topology unsupported; a wrapper-only guard is insufficient.
- **TD-005 slice:** machine-enforce superseded-plan location and archive the known stale plans. Keep TD-005 Open unless a repository-wide completed-plan status/section inventory and contract cover the tracker row's broader historical-plan ambiguity.
- **Project-hotspot plan closeout:** align the API contract with the live behavioral breakdown, remove unreachable legacy projection code, and archive the stale implementation plan. This is not an extra tracker closure.
- **TD-122, conditional:** after all acceptance-affecting branches merge, execute a clean-source, owned-runtime, fresh-isolated-database Gate 0. Close only if the exact inventory is deterministic, repaired, and final full evidence is green; otherwise keep TD-122 Open with the reproduced next group.

Each track records a public-seam red before production edits, passes proportionate full gates, receives independent Standards and Spec reviews, and lands through its own PR. Tracker/plan state changes only after merged-main evidence.

## Closeout outcome

- **TD-067 closed via #598 (`3a2cfc408bd737751420f976cbd30a511332e443`).** The stock single-API invariant is executable in the compose wrapper and normative across ADR-0020 plus English/Chinese reliability, deployment, bridge, and self-hosted entry documentation. Custom bridge-aware routing remains outside the stock claim; no target HA readiness is inferred.
- **TD-105 closed via #599 (`62a100e3b0e42817d7006a62b89aeb012af2c9ba`).** One bounded retention seam and one lifecycle loop per worker mode now prevent unbounded webhook-delivery growth, with stable per-domain ordering, redacted retry, awaited shutdown, an explicit disable switch, and backup-only recovery for deleted rows.
- **TD-014 closed via #600 (`e528c4a52d7646b70f8b2e576448684cf36aacf9`).** The unused legacy parameter-Admin HTTP/client contract is retired and the node-only boundary is explicit, while historical schema/data/runtime reads and audit evidence remain. Real node-catalog export/import acceptance is green; live HDC evidence remains open TD-100.
- **TD-005 remains Open after #601 (`a5a0b653a3f2cd65320757523eb38fc51049d7d7`).** Superseded plans are machine-blocked from active locations and four verified stale plan groups are archived, but only 4 of 177 English completed-plan basenames are managed by this bounded inventory; the remaining 173 prevent a repository-wide closure claim.
- **The stale hotspot plan is completed via #602 (`b2181d956129c844d86d6782f52d57dcf57efb37`).** The live four-key score contract is exact, unreachable legacy projection code is gone, and API-mode Parameter Home evidence preserves ranking/labels while fixing the mobile FAB collision. This track does not create or close a tracker row.
- **TD-122 closed via #603–#607; final proof is `493a257a1f3507f883715c5b5235af7a233914c7`.** The final clean merged-main owned run passed visual 20/20 and browser 127 expected / 29 planned skipped / 0 unexpected / 0 flaky; 125 operation records covered all 108 required IDs with no missing/invalid/errors; all 11 nested runtimes and all root resources cleaned; artifact scans had 0 violations; and `latest-full.json` binds the exact run/commit. The detailed retained evidence lives in the completed acceptance-baseline plan.
- Implementation PRs #598–#605 used their recorded required checks. GitHub Actions quota was exhausted for #606/#607; the repository owner explicitly authorized merge after complete local CI, which passed along with fresh zero-finding Standards/Spec reviews. The closeout records this exception rather than describing queued GitHub jobs as green.
- The shared closeout re-counted the Open sections and durable-number spaces before edits: 38 English open rows and 26 Chinese open bullets at `493a257a1`; removing the four proven closures leaves 34 English rows and 22 Chinese bullets. ADR files remain 37 and SQL migrations remain 113. The EN/ZH tracker formats are intentionally not numerically identical because the Chinese tracker is a concise companion, but both remove and complete the same four IDs. TD-005 remains in the authoritative English Open table after its bounded archive-hygiene slice.
- Review/No-change rows were checked against final `493a257a1`. Product workflows, permissions, target evidence, HDC/provider readiness, KMS, API trust boundaries, repository maps, and reference contracts did not move during this documentation-only closeout. Implementation PRs already supplied the runtime, architecture, quality, runbook, API, frontend, and generated-artifact updates required by the matrix.

## Fixed audit decisions

### TD-105

Every webhook attempt inserts a delivery row and no delete path exists. The deterministic policy is “latest N per domain”; it avoids inventing an age threshold before real volume exists. `LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED` defaults to `true`; `LOG_WEBHOOK_DELIVERY_RETENTION_PER_DOMAIN` defaults to a conservative `10000` and accepts integers `1..1000000`. The internal maintenance constants are 1000 deleted rows per batch, at most 10 batches per cycle, and one cycle every 60 seconds, with an immediate asynchronous first cycle. Rows are ordered by `created_at DESC, id DESC`, so ties are stable. Polling and durable workers consume one loop. A cleanup failure emits a redacted structured warning and retries next cycle without stopping webhook delivery. Operators may set `..._ENABLED=false` to stop future deletion, but already-pruned rows are irreversible except through the normal database backup/restore path; this limitation is part of the audit-retention docs.

### TD-014

The current product is node-only. `/debugging-admin/nodes` uses node CRUD and node-catalog import/export; legacy parameter client methods have no product callers, while `/api/v1/debugging/admin/parameters*` remains in the manifest/OpenAPI. Retire only that unused HTTP/client surface. Preserve historical tables, rows, bindings, and audit. `DEBUG-ADMIN-001` must exercise real node export/import and audit counts. Before closure, the node-only architecture contract must explicitly retire the legacy catalog and assign live device evidence to Open TD-100; otherwise this PR is a completed slice and TD-014 stays Open.

### TD-067

ADR-0020 records process-local bridge affinity, and stock self-hosting is one Linux host with one API service. The supported invariant is one API replica. The compose wrapper rejects `api>1`, allows `api=1`, and leaves unrelated-service scaling unchanged. ADR-0020 and normative deployment docs must also state that direct Compose, orchestrator, or external multi-replica topologies are unsupported unless they supply bridge-aware routing. Only that repository-wide supported-topology contract permits closure; the wrapper guard alone is partial.

### TD-005 and hotspot

Completed plans are historical evidence; current code, generated contracts, normative docs, and the tracker take precedence. Known stale plans are landed organization administration (#560), landed local-eval auth hardening (#563), superseded node-only/DTS-workbench plans, and the hotspot plan whose named remainder is API review. A `Superseded` plan cannot remain active; unchecked historical boxes do not create implicit work. This known-plan repair does not close TD-005 unless a full inventory proves every completed feature plan has unambiguous implementation status and superseded sections.

Production project/module/parameter hotspots already use `frequency`, `scope`, `workflow`, and `collaboration`; docs and unreachable branches still retain `frequency/risk/impact/workflow/drift`. Narrow `DashboardHotspot.scoreBreakdown` to the behavioral shape and delete only code unreachable under the current kind schema. Score values, ranking, route, and visible labels do not change.

### TD-122 Gate 0

The historical full browser run used a shared database and dirty worktree; its 18 failures are inventory, not fresh reproduction. Current preflight accepts any healthy fixed-port process without proving database, object store, source commit, or run ID. Introduce `OwnedLocalAcceptanceRuntime`, owning a checked-absent `wiseeff_acceptance_full_*` database, run/source marker, run-scoped object store, unique ports, production-HMAC auth, deterministic Xiaoze, local webhook policy, child lifecycle, and exact-target cleanup. A healthy but mismatched old service must be rejected, never adopted.

Darwin visual evidence is independently deterministic: four stale and seven missing baselines. Review each route/state/viewport; never bulk accept snapshots.

## Non-goals

- TD-062 shell thinning, TD-075 registry/state-machine unification, TD-076 fixture consolidation, TD-097 broad accessibility/table cleanup, TD-113 stock burn, or TD-118 latency closure.
- TD-055/068/090/103/116/119/120/121 or any work needing product policy, KMS, expert feedback, external identity, target volume, or customer infrastructure.
- Dropping debugging history, changing device-write policy, or claiming HDC readiness.
- Building bridge routing, sticky routing, a broker, or HA.
- Changing hotspot ranking or redesigning Parameter Home.
- Hiding TD-122 failures with retries, relaxed assertions, shared-DB cleanup, bulk snapshots, or unplanned skips.

## Deep seams

| Track | Public/deep seam | Boundary |
| --- | --- | --- |
| TD-105 | `pruneLogWebhookDeliveries(db, { keepPerDomain, batchLimit })` plus one worker-owned loop | Assert real PostgreSQL state; separate transport, queue, and cleanup policy. |
| TD-014 | route manifest/OpenAPI, node-catalog service, and `debuggingAdminClient` public surface | Retire only unused parameter Admin; preserve schema/history/authz/audit. |
| TD-067 | `ops/self-hosted/scripts/compose`, ADR-0020, and normative deployment contract | Reject unsupported stock topology before Docker and declare all non-bridge-aware multi-replica entry points unsupported; no target readiness claim. |
| TD-005 | `validatePlanDocument` and completed-plan interpretation contract | Machine-enforce location for known superseded plans; keep TD-005 Open without a full completed-plan inventory. |
| Hotspot | `DashboardHotspot.scoreBreakdown` and `getDashboardHotspots` | All valid kinds expose one behavioral shape; tests assert values, not source text. |
| TD-122 | `OwnedLocalAcceptanceRuntime` consumed by preflight, Playwright, and evidence | Runner owns/verifies dependencies; never adopts an arbitrary healthy process. |

## Scheduling and ownership

Merge this planning PR first, then start exactly three workers from refreshed `main`:

| Slot | First branch | First track | Reuse after merge |
| --- | --- | --- | --- |
| Worker 1 | `fix/td-105-webhook-retention` | TD-105 | `refactor/project-hotspot-behavioral-contract` |
| Worker 2 | `fix/td-014-retire-legacy-debug-admin` | TD-014 | review/support; TD-014 precedes TD-122 final |
| Worker 3 | `fix/td-067-single-api-invariant` | TD-067 | `docs/td-005-superseded-plan-governance` |
| Parent/next slot | `fix/td-122-owned-acceptance-runtime` | TD-122 Gate 0 | starts after acceptance-affecting PRs merge; reproduced repair groups may use later branches |
| Parent/shared | `docs/deterministic-td-wave4-closeout` | trackers/PLANS/Wave archive | starts after final evidence |

Implementation agents commit only to their branches; they do not edit this plan/tracker or open/merge PRs.

- **TD-105 owns:** `server/modules/logs/webhookRepository.ts`; new `server/modules/logs/webhookRetention.ts` and test; `server/modules/logs/workerRunner.ts` and test; `server/config/env.ts` and test; `.env.example`; bilingual env/log-operations docs.
- **TD-014 owns:** debugging routes/tests; contract manifest/OpenAPI tests; debugging Admin HTTP client/tests; `e2e/acceptance/debugging-admin.acceptance.spec.ts`; requirements/operation matrix; generated OpenAPI/coverage and exact API/acceptance docs.
- **TD-067 owns:** compose wrapper/test; bilingual RELIABILITY, local-device-bridge, deployment-operations. Rebase over #595/#596.
- **TD-005 owns:** doc-governance checker/tests; named stale plans; completed README plus a new Chinese companion; bilingual PLANS. Tracker remains shared-closeout-only.
- **Hotspot owns:** dashboard service/scoring and tests; dashboard types, score panel, presentation and tests; bilingual API contract; hotspot plan plus new Chinese companion.
- **TD-122 owns:** browser runner/preflight and tests; shared owned-runtime helper; Playwright config; CI only if invocation changes; reviewed Darwin snapshots; TD-122 plan/quality docs. Rebase after TD-014 and hotspot.
- **Shared closeout only:** both trackers, this Wave plan, launch summaries, and final PLANS state.

## TDD vertical slices

### A — TD-105

1. **Red:** a real PostgreSQL test calls the absent prune seam and covers two organizations, multiple domains, latest N, batch bounds, rerun convergence, and isolation.
2. **Green:** implement one bounded transaction with stable row-identity tie-breaking after timestamp order.
3. **Red/green:** prove polling/durable each start exactly one retention loop and close it on shutdown; wire the immediate asynchronous cycle plus 60-second maintenance. Reject invalid enabled/keep values; keep batch=1000 and max-batches=10 as named internal constants. Log deleted count/duration or a redacted failure code only; failures retry without stopping deliveries. Test `enabled=false` as the rollback switch and document deletion irreversibility.
4. Run focused PG with zero skips and full log/server gates.

### B — TD-014

1. **Red:** manifest/OpenAPI require legacy parameter paths absent; route tests require 404; a TypeScript surface contract rejects legacy client methods.
2. **Green:** remove only routes, manifest entries, exclusive schemas, and unused client methods; preserve DB/node CRUD/import/export/authz/audit.
3. **Red/green:** update `DEBUG-ADMIN-001` to node catalog, execute UI export/import, and verify export/import audit records through existing production seams.
4. Generate contracts/coverage and run focused API-mode evidence.

### C — TD-067

1. **Red:** `up --scale api=2` and `--scale=api=2` fail before Docker; `api=1` and other services pass.
2. **Green:** smallest wrapper validation, preserving #595/#596 image/build behavior.
3. Update ADR-0020 and bilingual reliability/deployment/bridge docs with the exact supported boundary for wrapper, direct Compose, orchestrator, and external deployments; run self-hosted gates. Keep TD-067 Open if any normative surface still implies unsupported multi-replica bridge readiness.

### D — TD-005 and hotspot

1. **Red/green:** governance requires `Superseded` plans outside active; implement the location rule and archive known landed/superseded plans while preserving invitation/org-directory/project-ACL rows.
2. **Red/green hotspot:** pin all valid kinds to the behavioral public DTO/service, delete unreachable legacy scorer/projection, and update bilingual API contracts.
3. Archive hotspot with a Chinese companion; document that historical unchecked tasks are not current work. Keep TD-005 Open after this bounded slice unless a repository-wide inventory plus completed-plan metadata/section contract is added and passes.

### E — TD-122

1. **Red:** a healthy fixed-port old service with mismatched marker/database/run ID is accepted today; the owned-runtime contract must reject it or allocate fresh ports.
2. **Green:** implement the runtime descriptor and verify database absence, fresh migration/seed, markers, object-store path, port/PID ownership, auth/runtime config, teardown, and cleanup target. Both `acceptance:visual` and full browser must consume this descriptor.
3. Land Gate 0 as its own reviewable PR. From the clean post-TD-014/hotspot merged tree, run visual/full browser and persist results, traces/screenshots, commit/runtime marker, projects/routes, and error classes before edits. On failure, retain the DB, object store, runtime manifest, and artifacts for diagnosis; exact cleanup is success-only.
4. Fix each reproduced group from a focused red; review every Darwin baseline.
5. Reproduced groups may use separate PRs. Close only after final merged-main visual and full browser both consume the owned descriptor and evidence is green with verified cleanup. Otherwise keep Open and record the exact next group; Gate 0 is not a false closure.

## Verification gates

- **TD-105:** PostgreSQL preflight/focused integration with zero skips; focused logs; `npm run test:server`; `npm run test:m2`; `npx tsc -b`; `npm run build`; `npm run docs:check`; `git diff --check`.
- **TD-014:** focused debugging/contracts/frontend; `npm run contract:check`; `npm run test:m3-5`; `DEBUG-ADMIN-001` focused API-mode acceptance and evidence; `npm test`; `npm run test:server`; `npx tsc -b`; `npm run build`; `npm run lint`; `npm run ui:check`; `npm run acceptance:a11y`; `npm run acceptance:visual`; `npm run acceptance:responsive`; `npm run docs:check`; `git diff --check`. At `/debugging-admin/nodes`, use 1440×900, 768×1024, 390×844 with snapshot+screenshot, export/import, audit result, console error 0, and relevant 2xx network.
- **TD-067:** compose tests, `npm run test:scripts`, `npm run selfhost:check`, `npm run docs:check`, `git diff --check`.
- **TD-005:** governance tests, `npm run test:scripts`, docs, diff.
- **Hotspot:** focused server/frontend, `npm run contract:check`, `npm test`, `npm run test:server`, `npx tsc -b`, `npm run build`, `npm run lint`, `npm run ui:check`, `npm run acceptance:a11y`, `npm run acceptance:visual`, `npm run acceptance:responsive`, and docs/diff. Run `e2e/acceptance/parameter-home.acceptance.spec.ts` for requirement/operation `PARAM-HOME-001`, then validate `npm run acceptance:evidence -- --run <runDir> --require PARAM-HOME-001`. API-mode Parameter Home at all three viewports requires snapshot+screenshot, hotspot expansion, console error 0, relevant 2xx network, and unchanged ranking/labels.
- **TD-122:** `npm run test:scripts`; `npx tsc -b`; `npm run build`; coverage/operations/quality/visual; `npm run acceptance:browser -- --mode local-non-hdc`; `npm run acceptance:evidence -- --run <exact-full-run>`; clean commit, owned marker, fresh migrate/seed evidence, zero unplanned failures, declared skips only, valid `latest-full`, reviewed snapshots, success-only verified DB/object-store cleanup, and failure-forensic retention; docs/diff.

Skipped target/HDC/provider jobs cannot support readiness claims.

## Git & PR Workflow

1. Parent merges this planning-only PR first. All implementation branches start from refreshed `main` afterward.
2. Start TD-105, TD-014, and TD-067 in isolated worktrees.
3. Implementers record red/green evidence and commit only their branches; they do not push main, open/merge PRs, or edit shared state.
4. Parent rebases each branch, repeats typecheck/affected tests, and commissions two independent fixed-point reviews in parallel: Standards against repository docs, Spec against this plan/tracker.
5. Fix findings and repeat both reviews to zero. Parent alone pushes/opens PRs, waits for every applicable CI job and Merge bar, merges, then refreshes main. Pending is not green.
6. Reuse slots for hotspot and TD-005 from then-current main; keep separate PRs. Merge hotspot before TD-005 moves its plan.
7. Start TD-122 only after TD-014 and all visible/acceptance-affecting changes merge. Its final evidence references the final merged composition.
8. Shared closeout starts after intended PRs merge and TD-122 status is known; re-check current TD/ADR/migration counts before tracker edits.

## Documentation Impact Matrix

| Area | Status | Exact files / evidence |
| --- | --- | --- |
| Repository maps | Review | `AGENTS.md`; `docs/zh-CN/root/AGENTS.md`; `ARCHITECTURE.md`; `docs/zh-CN/root/ARCHITECTURE.md`; `docs/README.md`; `docs/zh-CN/README.md`. Record unchanged unless an entry point moves. |
| Planning / debt | Update | `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md`; `docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md`; `docs/exec-plans/tech-debt-tracker.md`; `docs/zh-CN/exec-plans/tech-debt-tracker.md`; `docs/PLANS.md`; `docs/zh-CN/PLANS.md`; `docs/exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`; `docs/zh-CN/exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`; `docs/exec-plans/active/2026-08-19-organization-administration.md`; `docs/zh-CN/exec-plans/active/2026-08-19-organization-administration.md`; `docs/exec-plans/completed/2026-08-19-organization-administration.md`; `docs/zh-CN/exec-plans/completed/2026-08-19-organization-administration.md`; `docs/exec-plans/active/2026-08-19-local-eval-auth-hardening.md`; `docs/zh-CN/exec-plans/active/2026-08-19-local-eval-auth-hardening.md`; `docs/exec-plans/completed/2026-08-19-local-eval-auth-hardening.md`; `docs/zh-CN/exec-plans/completed/2026-08-19-local-eval-auth-hardening.md`; `docs/exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md`; `docs/exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md`; `docs/zh-CN/exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md`; `docs/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`; `docs/zh-CN/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`; `docs/exec-plans/completed/2026-07-19-dts-parameter-workbench-redesign.md`; `docs/zh-CN/exec-plans/completed/2026-07-19-dts-parameter-workbench-redesign.md`; `docs/exec-plans/active/2026-07-08-project-hotspot-scoring-redesign.md`; `docs/exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md`; `docs/zh-CN/exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md`; `docs/exec-plans/completed/README.md`; `docs/zh-CN/exec-plans/completed/README.md`. |
| Product specs | Review | `docs/product-specs/index.md`; `docs/product-specs/product-spec.md`; `docs/zh-CN/product-specs/index.md`; `docs/zh-CN/product-specs/product-spec.md`. Update only if TD-014 retirement changes a current statement. |
| Architecture / domain | Review | `CONTEXT.md`; `docs/adr/README.md`; `docs/adr/0020-reload-runs-execute-in-request-on-bridge-holding-process.md`; `docs/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`; `docs/design-docs/api-contract.md`; `docs/zh-CN/design-docs/api-contract.md`; `docs/design-docs/2026-06-22-debugging-admin-hdc-adb-crud-design.md`; `docs/zh-CN/design-docs/2026-06-22-debugging-admin-hdc-adb-crud-design.md`. |
| Quality / testing | Update | `docs/QUALITY_SCORE.md`; `docs/zh-CN/QUALITY_SCORE.md`; `docs/design-docs/testing-strategy.md`; `docs/zh-CN/design-docs/testing-strategy.md`; `docs/developer/verification-matrix.md`; `docs/zh-CN/developer/verification-matrix.md`; `playwright.acceptance.config.ts`; `playwright.quality.config.ts`. Update actual TD-122 runtime/baseline semantics only. |
| Acceptance / generated evidence | Update | `e2e/acceptance/debugging-admin.acceptance.spec.ts`; `e2e/acceptance/parameter-home.acceptance.spec.ts`; `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; `docs/developer/browser-acceptance-coverage-map.md`; `docs/zh-CN/developer/browser-acceptance-coverage-map.md`; `docs/developer/user-operation-coverage-matrix.md`; `docs/zh-CN/developer/user-operation-coverage-matrix.md`; `docs/generated/acceptance-browser-evidence.md`; `docs/generated/acceptance-operation-evidence.md`; `docs/generated/acceptance-operation-evidence/index.json`. |
| Reliability / runbooks | Update | `docs/RELIABILITY.md`; `docs/zh-CN/RELIABILITY.md`; `docs/design-docs/deployment-operations.md`; `docs/zh-CN/design-docs/deployment-operations.md`; `docs/runbooks/local-device-bridge.md`; `docs/zh-CN/runbooks/local-device-bridge.md`; `docs/developer/environment-variables.md`; `docs/zh-CN/developer/environment-variables.md`; `docs/api/log-analysis-integration.md`; `docs/zh-CN/api/log-analysis-integration.md`. |
| Security / governance | Review | `docs/SECURITY.md`; `docs/zh-CN/SECURITY.md`; `docs/security/README.md`; `docs/zh-CN/security/README.md`; `docs/security/audit-retention.md`; `docs/zh-CN/security/audit-retention.md`; `scripts/check-doc-governance.ts`; `scripts/check-doc-governance.test.ts`. Preserve authz, audit, secret redaction, exact-target cleanup, and document that webhook delivery rows are audit-adjacent rather than the immutable audit log. |
| Frontend / design | Review | `docs/FRONTEND.md`; `docs/zh-CN/frontend.md`; `docs/design-docs/ui-design-system.md`; `docs/zh-CN/design-docs/ui-design-system.md`; `docs/developer/ui-quality-checklist.md`; `docs/zh-CN/developer/ui-quality-checklist.md`. Record no visible hotspot change unless browser evidence differs; correct stale TD-111–115 wording if touched. |
| API contract | Update | `server/modules/contracts/routeManifest.ts`; `server/modules/contracts/routeManifest.test.ts`; `server/modules/contracts/openapi.test.ts`; `docs/generated/openapi.json`; `docs/api/README.md`; `docs/zh-CN/api/README.md`; `docs/design-docs/api-contract.md`; `docs/zh-CN/design-docs/api-contract.md`. Record intentional debugging-route retirement and behavioral hotspot shape. |
| Operations / self-hosted | Update | `ops/self-hosted/scripts/compose`; `ops/self-hosted/scripts/compose.test.ts`; `.env.example`; `server/config/env.ts`; `server/config/env.test.ts`; `docs/developer/environment-variables.md`; `docs/zh-CN/developer/environment-variables.md`. Preserve #595/#596; document supported topology/retention only. |
| References | Review | `docs/references/productization-api-contract-draft.md`; `docs/references/pi-agent-provider-evidence.md`. Record unchanged unless a current contract is stale. |

## Documentation Update Gate

- Every Update/Review row is updated or explicitly recorded unchanged; EN/ZH companions align.
- TD-105 ships enabled with latest 10000 per domain, stable ordering, 1000-row batches, 10 batches per 60-second cycle, fail-open delivery/retry semantics, an explicit disable switch, redacted observability, and backup-only recovery for already-pruned rows.
- Intentional API retirement reaches manifest, generated OpenAPI, API docs, acceptance registry/evidence, and current product wording.
- TD-014 closes only if the node-only architecture decision assigns live device evidence to TD-100 and no other catalog-governance residual remains; otherwise the deterministic slice is recorded and the row stays Open.
- Single API is a normative supported constraint across ADR-0020, wrapper, direct Compose, orchestrator, and external-deployment wording; external HA remains outside the claim. TD-067 stays Open if this contract is incomplete.
- Superseded plans cannot remain active; every real residual has an Open tracker row or active plan before archive. TD-005 stays Open unless repository-wide completed-plan status/section evidence exists.
- TD-122 stays Open unless final owned-runtime visual/browser/evidence gates are green; Gate 0 is not closure.
- Each PR runs scoped docs checks; merged-main closeout runs `npm run docs:check` and `git diff --check` before moving this plan to completed.
