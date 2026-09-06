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

Browser gates: three Catalog `acceptance:e2e` specs; `acceptance:gate0`; `acceptance:artifacts:check`; playwright-cli at 1440×900, 768×1024, 390×844 with snapshot/screenshot, keyboard/focus/dialog/scroll interactions, console/network inspection. None had run at initial preflight; the checkpoint below supersedes that execution status.

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

## PR #821 review return — 2026-09-06

The external review fixes its comparison at head `b5ca4614c55b8061b3358656371f7f3ac757be9b` and base `27bc39d53235879afb579a86f6ee777a462e4204`. PR #821 was observed non-draft and restored to Draft. The user requests continued repair, not merge or Issue closure. The checkpoint below is historical; its #817 implementation status does not include the newly confirmed review-input gap.

Parent owns `src/application/parameter-catalog/mockAdapter.ts`, `src/application/parameter-catalog/proposalContractVectors.ts` and the two delivery plans. The bounded R2 input repair reuses the existing domain-equivalent token predicate; it does not change DTO schemas or weaken server validation. `R2-REV-04-accept-*` and `R2-REV-04-reject-*` run through the product mock and actual API adapter/root HTTP/PG harnesses. Initial state is submitted, current release and ETag, fresh key, same-organization non-author platform reviewer. Empty, whitespace, padded and C0/DEL/C1 control-character values must return `VALIDATION_FAILED` with the field and `retryable=false`; status, version, ETag, intent and successful audit/dedupe remain unchanged. Correcting the input with the original key must succeed once and replay its immutable first result. Parent owns execution evidence; independent reviewers assess the final fixed comparison.

Definition batching may proceed without inventing a Policy capability contract; #815 still requires a substantive decision. Separate read-only work checks T5 feasibility and the actual failed Hosted job/checkout before assigning a baseline cause. Boundary relocation and final gates remain failed or not run until new evidence proves otherwise. No new pass is recorded here. Documentation impact: update these plans and PR evidence; architecture, API schema, product scope and production runbooks remain unchanged by the bounded input fix.

Definition owner paths are frozen to `read/types.ts`, `read/ports.ts`, `read/handlers.ts`, `read/ports.batch.test.ts`, `read/handlers.test.ts` and `rootBatchQueries.integration.test.ts` under `server/modules/parameter-catalog-api/`. `productionWire.ts` and usage semantics are read-only. Pre-execution business SQL budgets: Subject nonempty page 4, Definition nonempty page 5, empty page 1 (prefilter only); no row-dependent projection query growth, cache or pool expansion. Restricted-project scope is a separate explicit counterexample to investigate, not an implicit pass.

Input repair evidence on the working tree over the reviewed head: product mock Red 20 failed / 32 passed, then Green 52 passed; real API adapter/root HTTP/PG 61 passed, no skips. The latter validates that the backend already rejects these inputs. Raw logs and metadata: `work/catalog-r2/evidence/b5ca4614c55b8061b3358656371f7f3ac757be9b/review-input-{red,green,api-baseline}.{log,json}`. These are working-tree runs, not post-commit evidence. Lane 820 doctor passed with the migration-owner canary.

## Verified Scratch checkpoint — 2026-09-06 Asia/Shanghai

Code candidate: `b54a126b594effe5470f7df4c8b4d0458abc14c6`, tree `c51651772664dfdc91e68673e67027a8dc3ed8be`. The accepted base remains `35cbfb18e0504d6ccf16d2fc18c72a0d2da80391` after the last fetch. A subsequent report-only commit does not relabel earlier execution SHAs. This is not sealed, integration-ready, Hosted, merged or attested. No R2 issue is closed; #813 remains the only observed open PR. Its historical status language does not establish the R2 results below.

| Issue | Implemented | Verified | Merged / attested | Remaining blocker |
| --- | --- | --- | --- | --- |
| #815 | No | Model gap investigated | No / no | No proven complete Policy-to-canonical Definition association or production Policy writer. Requested staged unavailable contract has not been approved; fixed zero remains. |
| #816 | Subject page only | Real root HTTP SQL budget, batch/empty/missing/error tests | No / no | Definition/usage projection still grows per row; depends on #815. |
| #817 | Yes | Shared actual API/PG and product mock contract vectors; integrated server and browser evidence | No / no | Final integration gates and approval remain outstanding. |
| #818 | Real Agent pinned-read and approved Binding workflow fixes | 18 actual HTTP/PG Agent cases; deterministic provider only; 23 additional real-PG identity cases | No / no | Supplemental T5 adapter-disagreement/missing-current-pointer proof remains absent; boundary gate below. |
| #819 | Proposal refresh/reconfirmation, real conflict/replay/parity and fixture corrections | All three Catalog specs: 21 passed, no failed/skipped, at the code candidate | No / no | Complete candidate still lacks #815/#816 and full Gate 0. |
| #820 | Plan, mapping, provisional capacity, independent review and artifact framework | Partial; exact results below | No / no | Policy decision, Definition batch/capacity, T5, boundary relocation and broad gate failures. |

### Root causes, ownership and permanent regressions

- #816: formal Subject handlers previously projected each row. `read/types.ts`, `read/ports.ts`, `read/handlers.ts` now deduplicate this page and map required batch results by ID after authorization/filtering and Kernel pagination. `rootBatchQueries.integration.test.ts` measures actual root-route SQL; `read/ports.batch.test.ts` covers missing/error/empty semantics. Definition remains explicitly unfixed.
- #817: mutable replay results, current ETag checks before replay and fixed mock versions violated request identity/history. The Proposal command/writer/repositories/result/query and HTTP DTO now preserve the first successful snapshot; mockAdapter has fresh opaque ETags, state/author/reviewer guards and immutable results. `proposalContractVectors.ts`, `proposalContract.test.ts`, `proposalAdapterParity.integration.test.ts` cover lifecycle, replay, key semantics, concurrency, permissions, terminal states and side-effect uniqueness. Historical missing snapshots return `proposal-replay-unavailable`, not current mutable state.
- #818: perception fabricated empty results and lacked real pin lookup. Binding-owned `adapters/projectReadAdapter.ts` now reads actual protected references; Agent perception uses the trusted invocation. `xiaoze/catalogBoundary.integration.test.ts` exercises local authentication, actual orchestrator/registry/dispatcher, real PG, pins and high-privilege Agent restrictions. T6 exposed absolute semantic versus relative structural DTS paths. `sensitiveNode.ts` accepts only two strictly validated full-path spellings inside the locked scope/version and rejects zero or multiple rows. The independently authored `sensitiveNode.identity.integration.test.ts` proves relative/absolute/root/duplicate/foreign/current/sibling/malformed cases in real PG. Its baseline Red was 14 failed/9 passed; the candidate Green is 23/23. A duplicate charger row in `propertyKeyCutover.integration.test.ts` was corrected to update the existing fixture identity without removing critical/audit assertions.
- #819: `ProposalPanel.tsx` and `CatalogOrganizationSurface.tsx` now refresh Proposal and release evidence, clear the previous confirmation and preserve input before a new explicit write. `catalogConcurrency.ts` proves real A/B stale ETag, real installer drift, committed-then-response-failure replay and browser operation parity. Shared ownership transferred from #818 guest-only commit `835700c` through parent integration `ee60c5a1d`; review fixes followed in `116273025`, `c1032d730` and the code candidate. The remaining guest label in the main Catalog spec is corrected. `catalogEvidence.ts` seeds a real platform-only reviewer; optional bearer organization scope is tested by the production verifier. No claims grant roles. Owned runtime pages detach before server cleanup. Lane guards retain loopback/port/database/ownership checks and reject URL query/fragment redirection.

Additional editable paths were frozen through independent threat/readiness reviews before the corresponding implementation: sensitiveNode and its tests, the exact duplicate fixture repair, the new identity test (Scratch `aa6b603`), Catalog browser fixtures/specs, and the additive `bearerAuth.ts` organization argument plus `scripts/catalog-bearer-auth.test.ts`. Reviewers never wrote parent production files. Implementation agents did not open PRs, merge, close issues or modify other worktrees.

### Execution ledger and evidence levels

| Candidate / input | Actual execution | Result and limit |
| --- | --- | --- |
| `b54a126b594e` | Four named files: `server/modules/agent/xiaoze/catalogBoundary.integration.test.ts`; `server/modules/parameter-kernel/sensitiveNode.identity.integration.test.ts`; `server/modules/parameter-catalog-api/rootBatchQueries.integration.test.ts`; `server/modules/parameter-catalog-api/governance/proposalAdapterParity.integration.test.ts` | 86/86 passed, no skipped; real PG/root HTTP, including 18 actual Agent cases. The 40 sensitiveNode Queryable tests elsewhere are pure tests, not PG. |
| `b54a126b594e` | `acceptance:e2e` with the three Catalog spec paths, Desktop Chrome, no dependency project, owned local runtime | 21/21 passed, no skipped, 1.3 minutes. Includes three viewport conflict cases, response-phase committed replay, operation parity, role and legacy behavior. Raw metadata preserves exact start/end/command. |
| `b54a126b594e` | build; lint; contract:check; ui:check; acceptance:coverage; acceptance:operations; acceptance:models | Passed. Lint covers src; no server lint claim. Documentation report-head check is recorded separately. |
| `77586ba67d50` | `npm run test:server` | 501 files, 3816/3816 passed, no skipped. Server source bytes are unchanged through the code candidate; this was not rerun under the later helper-only SHA. |
| `ee60c5a1d` | `npm run test:all` | Frontend 3354 passed; scripts 1178 passed/20 failed/5 skipped. The command stopped before bridge/server. Three changed-code script failures were fixed; 15 temporary-database routing failures disappeared in one controlled recheck against the dedicated container. Two unchanged finalize-gate0-upload process-identity cases still failed; no third retry or unrelated repair. Later boundary failure is separately recorded. |
| `1162730256fd` | bridge:test; acceptance:gate0 | Bridge passed. Gate 0 visual 16 passed/4 failed. Parent sent SIGINT after the complete server suite found this round's regressions; exit 130, browser phase incomplete. This is failed/interrupted evidence, not a complete Gate 0 pass. Its own safety scan had zero violations. |
| `c1032d730d50` | playwright-cli, actual local-login/API/PG at `/parameter-admin/specs` | 1440×900, 768×1024, 390×844 snapshots/screenshots; fill, dialog, Tab focus, cancel/input retention, scroll and explicit creation. Authenticated console: zero errors/two warnings. Initial unauthenticated 401s are preserved in network evidence. UI src bytes remain unchanged at the code candidate. |

At the code candidate, real Subject limits 1/25/100 observe business/auth/Kernel/transaction/other SQL counts `4/1/15/8/0`, waitingCount 0; empty page makes no page-projection query. The retained Definition Red probe measured business `5/101/401`, demonstrating the remaining N+1. Earlier capacity data above is provisional and must not be promoted to final candidate or representative inventory evidence.

Boundary gate on the code candidate failed: 3513 total occurrences, 23 unallowlisted and 23 stale, all paired to unchanged legacy evidence in the shifted property-key fixture. `work/catalog-r2/evidence/boundary-relocation-23.json` preserves both IDs, positions, tokens and evidence. Independent Standards found no existing authorized relocation mechanism. No allowance was added, no trusted-base SHA was replaced, and no padding or scanner relaxation was used. A separately approved and reviewed relocation mechanism is required; equal counts alone do not pass the gate.

Independent Standards and Spec reports are in `work/catalog-r2/reviews/`, including `standards-b54.md` and `spec-b54.md`: limited PASS with the above blockers retained. Spec authored the 23 PG tests but did not implement production; Standards independently inspected those tests. Earlier findings and their corrections remain in the same directory. There is no Hosted job/checkout, new PR, merge SHA or attestation for this Scratch candidate.

### Documentation disposition and delivery

Plans/indexes, bilingual API transition contract and generated operation coverage were updated. OpenAPI was regenerated for the actual Proposal error/contract change; database schema was unchanged. Requirement and operation IDs/mandatory status were preserved. Repository maps, architecture, product requirements, security model, frontend design system, runbooks and general verification references remain unchanged because this repair uses existing boundaries and does not authorize a new product, domain or release workflow. Coverage metadata passes are structural checks, not proof that all mandatory requirements passed. The plan stays active, so no completion record is fabricated.

Sanitized, shareable raw logs, metadata, SQL, screenshots, review reports and SHA applicability comparisons are assembled under `work/catalog-r2/shareable-evidence/`; its safety check and hash manifest are separate from source delivery. `work/catalog-r2/delivery/<report-head>/complete-changed-files.zip` contains the complete bytes of every changed tracked file with preserved paths; `paths.json` lists each file and hash. Private lane URLs, storage-state tokens and runtime descriptors are excluded. The original worktree and all Scratch/controlled-mutant worktrees are preserved. Owned test processes were stopped; failed-run database/object-store evidence is retained, not silently cleaned.

To rerun, provision/doctor the actual lane 820 using the documented script, consume its emitted URLs privately, then run the exact commands from each metadata JSON. The focused command lists the four real files above; the browser wrapper `work/catalog-r2/run-catalog-specs.ts` uses the existing owned runtime provisioner and runs all three spec paths without inventing a descriptor. Full Gate 0 and capacity must be rerun only after their blockers are resolved. OP-09, #811/#735 target work, P12–P15, production recovery/data changes/traffic switching were not executed and remain independently unauthorized.
