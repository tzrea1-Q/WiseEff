# Catalog R2 delivery — #814

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-05-catalog-r2-delivery.md)

## Outcome and accepted base

Deliver the remaining #815–#820 code and isolated non-target evidence. OP-09/#811, #735 target rehearsal, P12–P15, production writes, restore, cleanup and traffic switching are excluded. #668's launch graph stays frozen. No merge approval has been established; stop at a verified candidate/PR pending approval. This is a user-authorized round, not a newly created resumable Goal. No deadline was requested; completion requires non-overlapping review, integration and Hosted stages.

Fresh fetch accepted `origin/main` and checkout: `35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`; tree `6b634836083bdb2c3b54b01d0fa6acf006bd3085`. The initial checkout was detached and clean. The other worktree `/Users/tzrea1/Develop/WiseEff` remains on `docs/catalog-repair-status` at `475695fb9bea1b60ecb1304544aa3b7fe96106f8` and is not edited by this round.

GitHub #814–#820 and #802 bodies/comments/status were read. All new issues are open, needs-triage, unassigned; native blocked_by lists are empty. Body dependencies below remain binding. GitHub reports triage/maintain/admin permissions for the authenticated coordinator account; capability does not waive readiness or merge approval.

PR #812 is merged at the accepted base. Its historical candidate is `da52f6d5b7e328d0302cd3b2cbde0ca75db2373a`; its body cites earlier mixed-SHA evidence. PR #813 is open, has no reviews, and is the only observed open PR. Its statement that layers 1–2 landed does not prove the remaining R2 criteria. Historical run 33955890889 lists local non-HDC and target synthetic jobs as skipped. None is new R2 evidence.

## Counterexamples and lane state

| Issue | Risk | State | Current observation | Final dependency |
| --- | --- | --- | --- | --- |
| #815 | R2; scope changes R3 | PREFLIGHT | usage/query.ts returns fixed policyCount=0; read/ports.ts fills missing totals with zero; Policy source/mapping under review | authoritative contract or explicitly approved alternative |
| #816 | R2; authorization/transaction seams R3 | PREFLIGHT | handlers and ports perform one-object business projections; formal page maximum is 100 | #815 contract handoff |
| #817 | R3 | PREFLIGHT | mock checks current ETag before replay, reuses etag-p2 and lacks transition guards; HTTP mutation DTO loses base/content | challenged threat matrix |
| #818 | R3 | PREFLIGHT | guest test is mislabeled Agent; perception pin/readiness placeholders obstruct real positive reads | challenged threat matrix |
| #819 | R3 | PREFLIGHT | intercepted 409 and initial parity do not prove real conflict/operation parity | #817, #818 shared-file handoff; complete candidate includes #815/#816 |
| #820 | R2; provenance R3 | PREFLIGHT | evidence framework begins now; final gates not run | #815–#819 integrated |

No implementation, verification, merge or attestation is claimed by this table. Read-only preflight agents own Policy/batch, Proposal, and Agent/conflict investigations. The parent owns plan/environment/evidence integration. Production edits require frozen precise paths and a Spec challenge for R3. Later sections record those handoffs before editing.

## Observed integration checkpoint

The initial table above is historical preflight. Subject batching, Agent reads and Proposal fixes are integrated through `1009ecbfb28dea6f867f09fa13fa17709bdf40e5`, still Scratch, not sealed or integration-ready. #815 awaits the requested product decision; Definition/usage batching and final capacity remain pending.

| Slice | Exact source / parent integration | Actual evidence | Remaining gate |
| --- | --- | --- | --- |
| #816 Subject | `b26067e72accee2249a5f75a609c7cd730184a2c` | exact committed tree: 7 files / 25 tests passed; root HTTP business SQL 4/4/4 at 1/25/100, empty-page projection zero; auth 1, Kernel 15, transactions 8, unclassified 0, waiting 0 | Definition/usage, filter/cursor/isolation matrix and capacity distribution |
| #817 Proposal | child `143fe6736a331fd88ed455744647cb689fd705c4`, `389e58727c4ae60e306ae06cf317316f8cad1f50`; parent `bd05961ad`, `1009ecbfb` | exact final child: 12 server files / 106 tests and 11 frontend files / 92 tests passed; build, contract check, focused appRuntime lint passed | integrated checks, independent reviews and browser operation trace |
| #818 Agent | guest `835700cdc1c0e60c176907e19cc75e1ca097ea72`; child read `773545fc4be7c7402c2335efb50f8eda87297e36`; parent `3ebe49d9d`, `425cc0864` | child 17 root HTTP/PG + 8 unit tests and exact build passed; one selected User-invocation mutant failed (16 filtered), not a passing suite | successful source-backed Binding approval / duplicate confirmation; controlled missing/disagreement evidence; browser |
| #819 browser | guest and Proposal handoffs consumed sequentially | actual local-login A/B sessions: B submit 200, A stale withdraw 409, unchanged business/success audit and retained input; refresh failed to reload submitted state | UI repair, committed response-loss replay, operation parity and three viewports |

Parent `e1fa24376a83e24505f25e5b006176970ac03cd0` removed exactly six stale Agent SQL allowances, adding none. Scanner against accepted base passed: 3513 violations all allowlisted, zero stale/mismatch/growth; this does not automatically cover later bytes.

Manual disposable cleanup calls an undefined `stopRuntime`. Record this environment defect; #819 uses the existing tracked nested manifest path. Parent stopped only the proven leaked #819 API group after matching PID, start identity and worktree command using the existing stop helper. Database/object-store evidence is retained; no shared or target process was stopped. Raw record: `work/catalog-r2/evidence/owned-819-process-takeover.json`.

Standards and Spec independently review the same accepted base/checkpoint. No review PASS, PR, Hosted run, merge, attestation or issue closure is claimed here. A separate cleanup-design consultation failed due to model capacity and produced no review result. Historical #812/#813 evidence does not replace missing gates.

Both independent reviews of `1009ecbfb` returned findings, not PASS. The unified repair packet preserves their identities: R2-REV-01 = STD-01/SPEC-01 (mock accepts an invalid Proposal base); R2-REV-02 = STD-02 (empty-kind mutation differs from GET/list); R2-REV-03 = SPEC-02 (omitted evidenceRefs versus [] replay differs). The Proposal owner received all findings together. Reports: `work/catalog-r2/reviews/standards.md` and `spec.md`.

The subsequent exact `89904eb1a445f4143482e5fa586962f12578f48a` integrated focused run passed 43 server files / 261 tests. Frontend had 12 files passed / 1 failed, 105 tests passed / 1 failed: an old test expected the User to create a Proposal, contrary to the role table in the API contract. Parent `4da0c44cbea5fa571a25f75466cc52865e28663b` corrected that assertion to require no User create action; the single file then passed 12 tests. This is not a full-suite pass.

A temporary read-only Definition SQL probe on `4da0c44cb` plus the explicitly recorded probe source confirmed the outstanding N+1: at limits 1/25/100, business queries were 5/101/401 and transactions 10/106/406, auth 1, Kernel 15, unclassified 0, waiting 0. Against a fixed five-query projection budget it collected four tests: two passed, two failed. The probe source and raw SQL remain in `work/catalog-r2/evidence/definition-budget-red/`; the temporary test file was removed after collection. Its individual timings are not capacity percentiles. Definition batching remains blocked by the #815 usage contract, not deferred to OP-09.

## File ownership and execution budget

### Preflight decisions and bounded handoffs

The user has been asked to decide whether #815 may adopt a staged explicit unavailable contract. No response/approval has been received; no such contract has been implemented. Evidence: `CONTEXT.md:116`, TD-055, `0048_parameter_topology_schema_shadow.sql:66`, and exact mapping rules in `0137_canonical_parameter_catalog_schema.sql`. There is no production Policy writer. This is a functional/acceptance blocker, not an OP-09 dependency.

Independent Spec agent `policy_preflight` challenged #817/#818 and returned numbered P1 revisions before accepting bounded seams. #817 adds missing/partial historical snapshot failure (`503 SERVICE_UNAVAILABLE`, `proposal-replay-unavailable`, retryable false), two authorized principals using one key, complete immutable DTO contents, precise terminal and role transitions. Absent reason must retain old fingerprint bytes; a provided reason is part of request semantics. #818 preserves the existing Agent project binding rule and observes actual SSE/tool results and durable audit rather than assuming HTTP 403 for unknown tools. Its positive oracle uses Binding/current value 1842 pinned to release A while current is C. No constraints may be disabled to fabricate missing-value rows.

Bounded Spec decisions: #817 mock snapshot/ETag and then DTO/legacy/permission seams are THREAT-READY, based on actual Red; #818 canonical read seam is THREAT-READY after six root HTTP cases (three correct scope refusals, three positive reads failing). This does not approve final acceptance. #817/#818 readiness labels and assignee were updated by the authorized coordinator after this review; pending cases remain required.

| Writer | Exact editable scope | Read-only / handoff |
| --- | --- | --- |
| Parent #816 Subject slice | `server/modules/parameter-catalog-api/read/types.ts`, `ports.ts`, `handlers.ts`, `ports.batch.test.ts`; `server/modules/parameter-catalog-api/rootBatchQueries.integration.test.ts` | usage/Definition path waits #815; productionWire unchanged; no permission changes |
| #817 `codex/catalog-r2-817` | `src/application/parameter-catalog/mockAdapter.ts`, `authority.ts`, new `proposalContractVectors.ts`, `proposalContract.test.ts`, direct tests; `src/app/appRuntime.ts`; `server/modules/parameter-governance/proposals/{command,result,writer,repositories}.ts`, actual failure mapping; `server/modules/parameter-governance/queries/proposals.ts`; `server/modules/parameter-catalog-api/governance/{dto,handlers,errors}.ts`, new `proposalAdapterParity.integration.test.ts`; `vitest.server.config.ts` aliases | Contract reason enum in `server/modules/contracts/dtoSchemas/parameterCatalog.ts` and generated OpenAPI temporarily belong exclusively to #817; transfer by SHA before #815 edits. No usage or browser helper writes. |
| #818 `codex/catalog-r2-818` | `server/modules/agent/tools/perceptionTools.ts`, direct test; new `server/modules/agent/xiaoze/catalogBoundary.integration.test.ts`; new `server/modules/parameter-bindings/adapters/projectReadAdapter.ts`, direct integration test, `adapters/index.ts` | Auth, registry, orchestrator and Kernel read-only; shared browser guest naming follows as a separate SHA handoff before #819. |

All branches above start at the accepted main in separate worktrees. Models are inherited. Test-only reproductions precede production edits. #817 API 13 collected/10 passed/3 failed and mock 11 collected/9 passed/2 failed are Red-stage dirty-tree evidence, not final candidate passes. #818 six-case Red has 3 passed/3 failed. These raw artifacts remain in each lane's ignored work evidence folder until a sanitized delivery bundle is assembled.

#816 Subject Red measured business SELECT counts 4/76/301 at page limits 1/25/100, with auth 1, Kernel 15, and transaction statements 8/56/206. Inventory is 125 Subjects/250 Definitions installed normally. The pre-reviewed fixed budget is exactly four business SELECTs (one prefilter plus three page projection queries); empty page has only one prefilter and zero page projection. The first focused Green reported 6 files/21 passed; additional missing-result/order/empty/dependency tests and raw measurement artifacts are being added before final slice verification. These timings are individual samples, not a capacity p50/p95 or production SLO.

One writer per file. Parent initially owns only this plan, its Chinese companion, and new ignored evidence under `work/catalog-r2/`. The inherited #802 plan and PR #813 bytes remain read-only. All migrations, ratchet allowlists, production/target operations and unrelated source are forbidden. DTO/OpenAPI, mock fixtures, read ports, productionWire and browser helpers require explicit sequential handoff SHAs.

Development WIP is at most two production lanes when shared contracts are involved; three read-only preflight agents may investigate concurrently. Reserve two independent reviewer slots at pre-seal by releasing implementation slots. Default model/reasoning is inherited; no override is claimed. Merge/Hosted WIP is one. Target one seal/review/Hosted round; findings return to Scratch, and byte changes invalidate a seal. No broad tests in inner loops, no duplicate full runs on unchanged trees.

## Threat and verification ownership

Before R3 implementation, freeze rows specifying initial state, principal/organization/project, request semantics, expected HTTP/business/audit result, executable case or explicit evidence gap, and owner. Cover success, stale/concurrent writes, identical replay, changed key semantics, lost committed responses, partial failure, forgery, cross-scope reads, terminal states and immutable response snapshots. A different Spec agent challenges these rows before production changes. Final Standards and Spec independently review the same base/head, return numbered findings or PASS, and the parent consolidates both reports before repairs.

| Finding / issue | Existing requirement family | Concrete test surface / required level | Owner |
| --- | --- | --- | --- |
| Policy / #815 | CATFIX-QUERY; R2-POL-01..07 | server/modules/parameter-bindings/usage tests; authoritative Policy tests to be named; root HTTP list/detail; page | Policy lane |
| Batch / #816 | CATFIX-QUERY-10; CATFIX-POOL; R2-BATCH-01..07 | server/modules/parameter-catalog-api tests and catalog-kernel/runtime tests; new real SQL root-router measurement | Batch lane |
| Proposal / #817 | CATFIX-PROP; PCAT-UI-13; R2-PROP-01..09 | src/application/parameter-catalog/mockAdapter tests plus one shared-vector real API adapter→HTTP→PG harness | Proposal lane |
| Agent / #818 | PCAT-UI-12; PCAT-AGENT-READONLY-001; R2-AGT-01..07 | real authenticated Agent endpoint/registry/dispatcher with deterministic provider and PG; guest browser separately | Agent lane |
| Conflict/parity / #819 | PCAT-UI-10/13/15; PCAT-CONFLICT-RECONFIRM-001; PCAT-ADAPTER-PARITY-001; R2-E2E-01..08 | e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts and governance spec; shared helpers after #818 handoff | Browser lane |
| Integration / #820 | all preceding IDs; PCAT-UI-01..15 | three Catalog specs, broad gates, capacity, exact-candidate reviews and CI | Parent |

New executable test paths and case names must replace the pending descriptions before any pass claim. Existing requirement/operation IDs and mandatory status stay intact. Counts expected by tests are independently declared, never obtained from the subject under test.

## Environment and evidence

Observed Node v22.22.3, npm 10.9.8, playwright-cli 0.1.14. `npm ci` succeeded (1640 packages). Dedicated `wiseeff-g668-pg` runs pgvector/pgvector:pg16 on loopback port 55438. Other databases/containers are not evidence sources and are not cleaned. Provision and doctor use actual issue numbers; URLs are consumed from successful script output and kept in ignored mode-0600 files, excluded from delivery artifacts. Role canary must actually run, not merely be skipped.

Raw sanitized environment records: `work/catalog-r2/evidence/lane-820-provision.json` and `lane-820-doctor.json` when generated. Every test record carries finding/issue/requirement, test file/name, base/candidate/checkout/tree, environment/dataset/principal scope, command, start/end, exit, collected/passed/failed/skipped, evidence level, raw artifacts and reviewer disposition. Static, pure/mock, real-PG, root-HTTP, browser-real, Hosted and target remain separate. Missing environment, zero tests, mandatory skipped and not-run are blockers.

SQL budget is frozen before measurement: business projection query counts must be independent of page size (1/25/100), separately classified from auth, Kernel and transactions. Exact projection budget awaits the approved Policy contract and existing-query inventory. Empty pages issue no page projection queries. No global caching, larger pool or relaxed timeout is permitted as a fix. Capacity reports compare small/representative/growth datasets, current/pinned, first/later page, registered filter and detail; record distributions, page size, pool/concurrency, warmup/samples, warm/cold, SQL, waiting, p50/p95 and available memory. Unmeasured fields are unavailable. No hangs/leaks/mixed release/cross-organization pollution is mandatory; no invented latency SLO.

### Provisional Subject capacity observations

Measured source is `5b4118ae5f1bfb2964f425722e409854ba662d03` plus the retained read-only measurement probe, not the final integration candidate. Three independent installer-generated inventories contain 25/125/500 Subjects, each with two Definitions; all are unregistered. The route is the current first Subject page. Pool maximum is the observed default 10, request concurrency 1, two warmups and 20 warm samples per limit; the table uses nearest-rank percentiles. Other isolated lanes were active on the same host. No cache was added or cleared. The business-query budget stayed four before and throughout these runs.

| Subjects / Definitions | Limit (returned) | p50 ms | p95 ms |
| --- | --- | --- | --- |
| 25 / 50 | 1 (1) | 11.88 | 14.34 |
| 25 / 50 | 25 (25) | 10.92 | 14.20 |
| 25 / 50 | 100 (25) | 10.57 | 13.45 |
| 125 / 250 | 1 (1) | 22.85 | 26.13 |
| 125 / 250 | 25 (25) | 23.11 | 25.49 |
| 125 / 250 | 100 (100) | 22.36 | 25.29 |
| 500 / 1000 | 1 (1) | 82.98 | 91.51 |
| 500 / 1000 | 25 (25) | 76.87 | 81.89 |
| 500 / 1000 | 100 (100) | 75.37 | 80.36 |

All groups observed business/auth/Kernel/transaction query counts 4/1/15/8, waitingCount 0, total connections 1 and idle connections 1 after response. The three runs each collected/passed 64 tests without skipped tests. The raw JSON records actual RSS/heap for the combined test worker/API process, not a standalone production process. Disk-cold behavior, connection-wait duration, production representativeness, pinned/later pages, registration filters, details and higher concurrency are unavailable; no latency SLO is inferred. This does not satisfy the full #820 capacity gate. Raw probe, timestamps, SQL, memory and unrounded summary: `work/catalog-r2/evidence/subject-capacity-checkpoint/`.

## Git & PR Workflow

Parent Scratch branch: `codex/catalog-r2-integration`, created from the accepted main in the existing isolated worktree. Child Scratch branches start from that accepted main in separate worktrees; only the parent integrates commits. Proposed serial order #815 → #816 → #817 → #818 → #819 → #820 may be adjusted only for recorded dependency reasons. Child agents do not create PRs, write main, close issues or dispatch downstream work. PR bodies use Refs #814 and child numbers, not automatic closure. Final PR creation waits for integration-ready and independent review. Merge and closing remain pending actual approval and exact merge attestation.

Focused commands use existing package.json paths and issue-specific lanes. Final candidate commands: `npm run test:all`, `npm run build`, `npm run lint` (src only), `npm run contract:check`, `npm run ui:check`, `npm run docs:check`, `npm run acceptance:coverage`, `npm run acceptance:operations`, `npm run acceptance:models`, `git diff --check`, and `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`. Trusted-base suitability must be checked against scanner policy before execution; never substitute HEAD to hide violations. No Hosted substitution has been accepted.

Browser gates: three Catalog `acceptance:e2e` specs; `acceptance:gate0`; `acceptance:artifacts:check`; playwright-cli at 1440×900, 768×1024, 390×844 with snapshot/screenshot, keyboard/focus/dialog/scroll interactions, console/network inspection. Final browser artifacts must bind the actual candidate. No browser gate has run yet.

## Documentation Impact Matrix

| Area | Status | Exact paths | Disposition |
| --- | --- | --- | --- |
| Repository maps | Review | AGENTS.md; ARCHITECTURE.md; docs/README.md; docs/zh-CN/root/AGENTS.md; docs/zh-CN/root/ARCHITECTURE.md; docs/zh-CN/README.md | retain unless module map changes |
| Plans | Update | this file; docs/zh-CN/exec-plans/active/2026-09-05-catalog-r2-delivery.md; docs/PLANS.md; docs/zh-CN/PLANS.md | new R2 record, no historical rewrite |
| Product | Review | docs/product-specs/product-spec.md; docs/product-specs/prototype-functional-spec.md; Chinese companions | no product redesign authorized |
| Architecture/API | Review | docs/design-docs/parameter-catalog-api-transition.md; docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md; Chinese companions | update when frozen contract actually changes |
| Quality/coverage | Update | e2e/acceptance/requirements.ts; e2e/acceptance/operationMatrix.ts; docs/developer/browser-acceptance-coverage-map.md; docs/developer/user-operation-coverage-matrix.md; Chinese companions | parent after executable evidence, preserve IDs |
| Reliability/runbooks | No change | docs/RELIABILITY.md; docs/runbooks/README.md; docs/zh-CN/RELIABILITY.md; docs/zh-CN/runbooks/README.md | target work excluded |
| Security/domain | Review | docs/SECURITY.md; CONTEXT.md; docs/security/README.md; Chinese companions where present | clarify only proven boundaries |
| Frontend/design | Review | docs/FRONTEND.md; docs/zh-CN/frontend.md; docs/design-docs/ui-design-system.md; docs/developer/ui-quality-checklist.md | minimum relevant state/adapter changes |
| Generated | Review | docs/generated/openapi.json; docs/generated/db-schema.md | run generators only on actual contract/schema change |
| References | Review | docs/references/productization-api-contract-draft.md; docs/developer/verification-matrix.md; Chinese companions | no invented command/evidence equivalence |

## Documentation Update Gate

Resolve every Update/Review row with changed paths or an explicit unchanged rationale before completion. Maintain linked separate English/Chinese files. Generate coverage/OpenAPI only through their actual generators and inspect diff. `npm run docs:check` must pass. Keep this plan active until all required R2 evidence exists; OP-09 stays independently pending. Full changed code files will be supplied in a directory-preserving artifact with an exact path manifest; exclude credentials and unrelated files.
