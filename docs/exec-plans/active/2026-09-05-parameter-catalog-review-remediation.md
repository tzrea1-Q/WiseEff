# Parameter Catalog review remediation

> Chinese: [中文](../../zh-CN/exec-plans/active/2026-09-05-parameter-catalog-review-remediation.md)

Status: **Active**. Layers 1–2 (defect close F1–F7 and product integration INT-01) landed on `origin/main` via [#812](https://github.com/tzrea1-Q/WiseEff/pull/812). Layer 3 (release / INT-02 / OP-09) remains **blocked** without explicit human authorization. This plan is not a production-release approval. Do not archive it under `completed/` while OP-09 is unrun.

Review baseline: `54815cdce5dd21d3d96587f0e52cc0f4faae9dd6` (tree `d5acc28a00ecebeb014040c53cd32fe1d4c72780`).

Landed candidate: `da52f6d5b7e328d0302cd3b2cbde0ca75db2373a`. Merge commit: `35cbfb18e0504d6ccf16d2fc18c72a0d2da80391` (2026-09-05T09:02:23Z). Hosted: [run 33955890889](https://github.com/tzrea1-Q/WiseEff/actions/runs/33955890889) (`pull_request` / candidate SHA). Required jobs success: Detect changed paths, Build and test, Acceptance quality, Acceptance smoke, Merge bar. Expected skips: Target synthetic acceptance, Acceptance local non-HDC.

GitHub issues: program #802 (open); OP-01 #803 through OP-08 #810 (closed on the #812 merge); OP-09 #811 (open, human-authorized).

## Progress (2026-09-05)

| Layer | Result | Evidence |
| --- | --- | --- |
| 1. Defect close F1–F7 | Landed on `main` | CATFIX-AUTH, CATFIX-SNAP, CATFIX-POOL, CATFIX-QUERY, CATFIX-PROP, CATFIX-MATCH plus #812 |
| 2. Product integration INT-01 | Landed on `main` | `CatalogOrganizationSurface` on `/parameter-admin/specs`; PCAT-UI-01..15 have no `test.skip`; Hosted Acceptance quality |
| 3. Release INT-02 / OP-09 | **blocked / not-run** | No target preflight, P12–P15, public-release, recovery drill, or traffic switch. #735 remains the release contract. |

Allowed status: **code repair complete, target release still blocked.** Not allowed: one green status for all three layers.

Known residuals that do not close OP-09 and do not reopen F1–F7: `policyCount` stays `0` until a definition-keyed Policy port exists; list reads remain N+1-bounded (CATFIX-QUERY-10); `seedCompiledCatalogProjection` predates this plan on `main`.

## Goal

Keep the existing Catalog domain model: official Subject, Parameter Definition, immutable Revision, Catalog Release, organization Registration/Placement, Observation, Proposal, Binding, and Project Value. Repair the runtime, HTTP wiring, and UI breakpoints on that model.

Deliver a Catalog with trusted identity, correct release snapshots, real query projections, a correct proposal state machine, a reachable page, and complete release evidence.

Three completion layers stay distinct:

1. Defect close: F1–F7 each have a failing case, a fix, and regression evidence.
2. Integration close: a real entry path of auth → API → domain service → PostgreSQL → query → page. Production assembly must not use fake-empty data.
3. Release close: existing Wayfinder/#735 gates on the target host. Merged code is not authorization to switch production traffic.

## Out of scope

Do not restore organization-structure schema overlay, introduce long-lived dual-write, relax database constraints to make tests pass, reorder applied migrations, batch-merge same-named parameters, rewrite DTS debugging or Agent internals, or opportunistically upgrade dependencies / frontend frameworks / visual design.

Performance work this round is limited to removing nested pool acquires and recording a measured baseline. Redis, distributed cache, large CQRS splits, and a standalone Catalog microservice are not required.

OP-09 must not execute cutover, restore, cleanup, or traffic switch without explicit human authorization.

## Baseline record (OP-00)

Recorded at plan creation on this host. Do not treat these values as target-host evidence.

| Item | Value |
| --- | --- |
| `origin/main` SHA | `54815cdce5dd21d3d96587f0e52cc0f4faae9dd6` |
| Git tree | `d5acc28a00ecebeb014040c53cd32fe1d4c72780` |
| Worktree | clean |
| Node | `v22.22.3` |
| npm | `10.9.8` |
| `package-lock.json` SHA-256 | `43adbfe23117426588694bbd209eb96997d3a73287da475a2a2d4dfab29050ea` |
| `package.json` SHA-256 | `dadd4917e72f86165729cf897a15683db4ab3d2c641886a1512687b03a0babf2` |
| Highest applied migration prefix in tree | `0139_parameter_catalog_verification_core.sql` |
| Local `psql` | not on `PATH` in this session |
| Catalog production auth at baseline | Catalog API is registered with `getCurrentAuthContext` (development user-header helper), not `authResolver` |

If the accepted main SHA moves, re-check F1–F7 behavior and close only items that are actually fixed.

Fixtures must go through the production installer in `server/testing/parameterCatalog/`. Do not use test-only SQL to fake a completed install as the happy path.

## Findings

| ID | Confirmed problem | Primary entry | Priority | Issue |
| --- | --- | --- | --- | --- |
| F1 | Catalog routes bypass the unified auth resolver and call the development user-header helper | `server/app.ts` | P1 | #803 |
| F2 | Creating a release by querying revisions of that release misses prior revisions still referenced by the current head; historical sets are incomplete | `catalog-kernel/runtime/currentSnapshot.ts` | P1 | #804 |
| F3 | Outer code holds a pool client while projection loading acquires another client from the same pool | same | P1 | #804 |
| F4 | Real production assembly still uses unregistered, zero-usage, and empty governance query implementations | `parameter-catalog-api/productionWire.ts` | P1 | #806, #808 |
| F5 | Historical release IDs are joined with the current release digest; metadata also contains placeholders | same, plus Kernel release metadata reads | P1 | #804, #808 |
| F6 | An existing proposal ID is treated as a definition revision ID; submitting an existing proposal incorrectly enters create | `governance/handlers.ts`, `proposals/` | P1 | #807, #808 |
| F7 | Driver alias matching does not fully check alias lifecycle; NodeType aliases do not participate | `runtime/currentSnapshot.ts` | P2, fix before enablement | #805 |
| INT-01 | New page is not on the live route; browser acceptance has unconditional skips and navigation-only cases | `src/app/routes.tsx`, three Catalog acceptance specs | release blocker | #809, #810 |
| INT-02 | Merging the implementation and proving the target host are different jobs | #735 and release-gate workflows | release blocker | #811 |

F3 is an application-level pool wait / starvation risk. It is not an observed PostgreSQL row-lock deadlock.

## Invariants

| ID | Invariant |
| --- | --- |
| INV-01 | Production identity comes only from the configured auth resolver. Request headers or bodies cannot become trusted context by themselves. |
| INV-02 | One read captures one Catalog release identity. Content, response headers, cursors, and revision visibility must not mix releases. |
| INV-03 | The selected revision equals the revision named by that release's head. Highest version, global head, or first match are not substitutes. |
| INV-04 | Pinned history contains only the target release and its ancestor closure. It must not drop ancestors or read the future / another branch. |
| INV-05 | Missing required projection, materialization, or head is an error. Do not fill empty lists, all-zero fingerprints, epoch timestamps, or invented revisions. |
| INV-06 | Each Kernel read owns one database connection in the current transaction scope. Nested helpers must not acquire from the pool. |
| INV-07 | Catalog structure changes only through the existing publish/install boundary. Organization governance commands and proposal accept must not write official Definitions. |
| INV-08 | Registration/Placement, Observation, Proposal, and usage queries have real data sources and honor caller organization/project scope. |
| INV-09 | Proposal ID, Proposal Revision ID, and Definition Revision ID are not interchangeable. Submitting an existing draft must not create another Proposal. |
| INV-10 | Conditional writes and idempotency hold inside the transaction. Failure must not leave half-state, duplicate publication intent, or a success audit. |
| INV-11 | Alias lifecycle and Subject lifecycle both participate in matching. A retired selector must not degrade into a valid fallback match. |
| INV-12 | A documentation-only revision must not automatically move existing Binding/ProjectValue pins. |
| INV-13 | Mock and API share the same operation permissions, state transitions, and error semantics. |
| INV-14 | CatalogPage must be reachable from the real application entry. Test markers, file existence, or warmup success are not browser evidence. |
| INV-15 | Code merge, local tests, Hosted, target-host evidence, and production authorization are recorded separately and do not substitute for one another. |

## Implementation decisions

1. Production keeps one auth entry. Pass the constructed `authResolver` into the Catalog API. The development helper may run only through the resolver's development branch. Stripping spoof headers is defense in depth, not authentication.
2. Kernel public reads acquire, begin, commit/rollback, and release at the outer boundary. Private projection functions receive the existing client. Prefer a short-lived read-only Repeatable Read transaction for multi-query projections.
3. Current-head resolution and historical-set construction are separate. Do not use `revision.catalog_release_id = targetId`, `release_sequence <= targetSequence`, or max revision as substitutes.
4. Release metadata stays in the Kernel. Release digest, compiled fingerprint, and database/materialization fingerprint are different evidence and must not stand in for each other.
5. Missing wiring is a configuration error. Missing approved runtime pin is Catalog not-ready. Neither returns a successful empty business payload.
6. Catalog content is release-pinned. Registration, Placement, review counts, and usage may be request-time organization state. Do not present today's usage as a historical release's usage.
7. Create makes a draft. Submit of an existing draft is an in-place ETag-protected transition of the same object. Accept creates a Publication Intent only.
8. File owners: `server/app.ts` is OP-01; Kernel `interface.ts` / `runtime/*` is OP-02 then OP-03; domain queries OP-04; proposals OP-05; `productionWire.ts` / HTTP / DTO OP-06. Do not widen allow-lists or delete boundary checks to dodge a ratchet.

## Work packages

| Package | Issue | Deliverable | Order |
| --- | --- | --- | --- |
| OP-00 | #802 | Baseline, threat scope, file ownership, fixture contract, evidence list, this plan | First; must not delay F1 |
| OP-01 | #803 | Unified auth wiring and root-router security regression | Independent first merge after baseline |
| OP-02 | #804 | Single-connection snapshot, correct lineage/head, real release metadata | After OP-00; parallel with OP-04/05 |
| OP-03 | #805 | Driver/NodeType alias matching and lifecycle | After OP-02 shared files are stable |
| OP-04 | #806 | Real governance queries, registration projection, usage reads | After OP-00; freeze the query API for OP-06 |
| OP-05 | #807 | Proposal in-place state machine, concurrency, idempotency, audit | After OP-00; do not edit the same files as OP-04 |
| OP-06 | #808 | Production composition root and HTTP semantics | After OP-01..05 |
| OP-07 | #809 | Real CatalogPage mount, state, deep links, API/mock alignment | After OP-06 |
| OP-08 | #810 | Cross-module regression, real browser assertions, capacity baseline | Tests throughout; final gate after OP-07 |
| OP-09 | #811 | Target rehearsal, purpose reports, authorization, recovery | After OP-08 and existing #735 gates; human-authorized |

## OP-01 (#803) — production auth

Replace `resolveAuth: (request) => getCurrentAuthContext(options, request)` with the unified `authResolver` in `buildWiseEffRouter()`. Audit every `registerParameterCatalogApi()` caller.

Extend `server/app.test.ts` rather than adding a second root-auth file. Cover one Catalog read (`GET /api/v2/catalog`), one governance write (`POST /api/v2/catalog/definition-proposals`), and one legacy read (`GET /api/v2/catalog/legacy-identifiers/:legacyType/:legacyId`).

| Case | Required result |
| --- | --- |
| CATFIX-AUTH-01 production, no credentials, no user header | 401; no domain write |
| CATFIX-AUTH-02 production, no credentials, development user header | 401; principal is not constructed |
| CATFIX-AUTH-03 invalid/expired/revoked credential plus any identity header | 401; no development fallback |
| CATFIX-AUTH-04 valid user A credential plus forged user/org B fields | principal stays A; unauthorized ops follow existing 403 / scope-hidden 404 |
| CATFIX-AUTH-05 authenticated without parameter permission | 403 or existing scope-hidden 404; not a successful empty list |
| CATFIX-AUTH-06 same-org read-only user or Agent governance write | rejected; no business write and no success audit |
| CATFIX-AUTH-07 development-mode debug request | still works; not production evidence |
| CATFIX-AUTH-08 local session and token/verifier modes | both follow the formal chain; no new provider |
| CATFIX-AUTH-09 rejected request database/audit | business tables unchanged; refusal audit per existing policy, no credentials |

## OP-02 (#804) — snapshot, pool, metadata

Public reads acquire once. `loadProjection` and split query helpers receive the existing client and neither commit nor release. Current reads capture the pointer and its authoritative identity once. Pinned reads resolve that ID's real digest and compare the caller's pin. ID-only historical reads resolve the authoritative pin inside the Kernel and must not borrow the current digest.

Head load is exact `(release_id, definition_id, revision_id)` with ownership checks. Historical lists are the predecessor closure belonging to the definition. Do not fall back to "any revision of the same definition".

Return real id, digest, sequence, published time, materialized time, and fingerprint. Missing materialization is not a zero hash. Missing time is not epoch. Digest is not a materialization fingerprint.

| Case | Required result |
| --- | --- |
| CATFIX-SNAP-01 A has X/r1; B does not change X | B selected revision remains X/r1 |
| CATFIX-SNAP-02 B changes only Y | X carried forward, Y switches, each head exact |
| CATFIX-SNAP-03 C documentation-only revision of X | C selects the new revision; old Binding/Value pins and row counts do not auto-change |
| CATFIX-SNAP-04 current is C; read pinned A/B | no C content; legal old revisions of A/B remain visible |
| CATFIX-SNAP-05 same revision carried by multiple releases | history deduped, stable order, no forged duplicate revisions |
| CATFIX-SNAP-06 historical pagination / cursor reuse or tamper | same query paginates; cross-release or cross-query cursors rejected |
| CATFIX-SNAP-07 historical ID A while current is B | Kernel resolves A's real digest; API does not borrow B |
| CATFIX-SNAP-08 correct ID, wrong expected digest | explicit conflict; pin is not silently replaced |
| CATFIX-SNAP-09 missing vs unmaterialized release | existing not-found / not-ready semantics; no default fill |
| CATFIX-SNAP-10 injected missing head / revision not owned | explicit drift or integrity error |
| CATFIX-SNAP-11 non-ancestor branch or future revision | not in target pinned history; sequence is not lineage |
| CATFIX-SNAP-12 caller mutates nested returned objects | later reads are not corrupted |
| CATFIX-SNAP-13 concurrent pointer advance during read | whole response is the captured version or an explicit reject |
| CATFIX-POOL-01 installed current, pool `max=1` | single read finishes in bounded time; no second-client wait |
| CATFIX-POOL-02 N requests, pool `max=N`, barrier | all finish bounded; `waitingCount=0` after |
| CATFIX-POOL-03 more requests than pool size | queue and complete; no hold-one-wait-for-second cycle |
| CATFIX-POOL-04 mid-query / commit fault injection | connection released or destroyed; next request works |
| CATFIX-POOL-05 auth failure, not-ready, digest mismatch | no leaked connection |

Do not copy every revision at publish time to hide the read bug.

## OP-03 (#805) — matching

Wait for OP-02. Matching is read-only. Use the existing canonical constructor; do not add private trim/lowercase/fuzzy rules. Driver canonical and alias candidates are deduped by Subject ID. A unique live target is `matched`. Distinct Subjects remain `ambiguous`. A retired selector keeps retired evidence and must not fall through to NodeType fallback. NodeType participates only when Driver rules allow fallback, and uses the same membership and lifecycle rules. Pinned snapshots use that release's membership.

CATFIX-MATCH-01..10 are in the Chinese companion and are required here.

## OP-04 (#806) — real queries

Each projection stays owned by its domain. Do not default a real pool to `unregisteredProjection`, `zeroUsageProjection`, or `emptyGovernanceQueryPorts`.

Registration by organization and stable Subject ID. Active and retired registrations keep their IDs and Placement IDs. Restore must not create a second registration. Definitions inherit the Subject's current Placement. A registration without required Placement is an integrity error, not `unregistered`.

`projectCount` dedupes allowed projects. `currentValueCount` counts current pointers, not all historical values. Joins must not inflate counts via review or alias tables. An organization with no registrations may still browse the global official Catalog.

CATFIX-QUERY-01..12 are required. Write through real domain commands, then read through official query ports.

## OP-05 (#807) — proposals

| Operation | From | To | Identity / side effect |
| --- | --- | --- | --- |
| Create | none | draft | one Proposal and initial Proposal Revision |
| Submit existing | draft | submitted | same proposalId, base pin, and content; ETag advances per contract |
| Withdraw | draft or submitted | withdrawn | same ID and history |
| Accept | submitted | accepted | different authorized reviewer; unique Publication Intent; no official Catalog write |
| Reject | submitted | rejected | same ID and reason; no official Catalog write |
| Submit a terminal object | accepted/rejected/withdrawn | unchanged | typed invalid-transition |

Submit-existing does not accept a proposalId wrapped as a DefinitionRevisionId. HTTP Create bodies that include a base release must match the captured release. Prefer application-logic changes; add a migration only if persistence cannot express the contract.

CATFIX-PROP-01..15 are required.

## OP-06 (#808) — production composition

| Startup | Behavior |
| --- | --- |
| Production Catalog enabled, required internals missing | configuration failure / not ready; no fake-empty fallback |
| Dependencies complete, no installed or approved runtime pin | Catalog not-ready with existing unavailable/retry semantics |
| Complete dependencies and legal runtime pin | real Kernel, Governance, Binding/usage queries |
| mock/demo | explicit mock adapters only on allowed demo/test boundaries |
| Historical pin request | that version's real metadata and content; never current |

Move empty projections to explicit test constructors and add a production-import regression so they cannot re-enter the real pool branch.

## OP-07 (#809) — CatalogPage

The live dispatcher is the `parameter-admin` branch in `src/app/routes.tsx`. Mount existing CatalogPage on `/parameter-admin/specs`. Do not replace the whole parameter-admin area and remove project management.

Preserve redirects, nav, breadcrumbs, and permission controls. Legacy bookmarks resolve through official legacy identifiers, not name search. Query-selected historical releases must survive refresh, back, and async responses.

Loading error, not-ready, and the four empty reasons (no registration, no definition, no review work, filter miss) are distinct. ETag/release conflicts keep user input and require reconfirm. Unauthorized writes must be server-rejected, not only hidden.

## OP-08 (#810) — evidence

Build the A→F installer fixture from the Chinese companion. Oracle values are written by the fixture author; they must not call the function under test to compute expected counts.

PCAT-UI-01..15 need observable assertions. Unconditional `test.skip` and `page.goto`-only cases are not acceptance. Mandatory cases may not skip. Missing environment fails closed.

Browser viewports: `1440x900`, `768x1024`, `390x844`.

## OP-09 (#811) — target / release

Follow existing #735. This package is not an agent-executable production cutover. Code repair may complete while target release remains blocked.

### OP-09 preflight checklist (not-run)

Do not execute P12, P13, P11b, P14a/b/c, P15, restore, cleanup, or traffic switch until a release owner fills the authorization boxes and names the exact target. This checklist is planning only.

**Candidate identity (already known, do not substitute a later SHA without re-running Hosted):**

| Item | Value |
| --- | --- |
| Review baseline | `54815cdce5dd21d3d96587f0e52cc0f4faae9dd6` |
| Repair candidate | `da52f6d5b7e328d0302cd3b2cbde0ca75db2373a` |
| `origin/main` merge | `35cbfb18e0504d6ccf16d2fc18c72a0d2da80391` |
| Hosted evidence | [run 33955890889](https://github.com/tzrea1-Q/WiseEff/actions/runs/33955890889) |
| Release contract | #735 (`scripts/run-self-hosted-release-gate.ts`, `ops/self-hosted/releases/**`) |

**Human must name before any target command:**

- [ ] Target identifier (redacted in public notes) and whether it is isolated from public traffic and queues
- [ ] Inventory mode actually present on that host (`fresh` or `populated`); do not report “zero inventory” from a failed query
- [ ] Production auth provider, database roles, Catalog bundle, and runtime pin
- [ ] Recovery-point scope (PostgreSQL, object store and metadata, Redis/queue/jobs, deploy config) and a restore that has already been proven
- [ ] Release owner for each distinct purpose approval: `pre-activation`, `post-retirement-runtime`, `isolated-candidate-acceptance`, `public-release`

**Purpose chain (existing #735 order; no simplified substitute):**

1. Isolated pre-activation verification and comparison → distinct `pre-activation` approval
2. P12 read switch (`activate-p12`) only against that approved pre-activation report
3. P13 writer retirement (`retire-p13`) while services and traffic stay isolated
4. P11b: new attempt, full V01–V17 + D01–D09; do not reuse pre-activation report bytes or checksums
5. P14a verify-only startup on the post-retirement runtime pin; queue/proxy/public still isolated
6. P14b isolated API and browser acceptance on the exact pin; first business mutation closes pointer-only rollback
7. P14c `public-release` aggregate of the three predecessor reports plus target/recovery/observability; distinct approval
8. Restore corresponding traffic only after that approval, then P15 observation

**Repair-specific checks on the real target (from this plan §15.3):**

- Production Catalog auth cannot be constructed from `x-wiseeff-user`
- Historical A/B release reads keep that release’s digest, head, and predecessor closure
- Registration, Placement, usage, and Proposal are readable after real writes; submit keeps the same proposal id; accept writes Publication Intent only
- Retired aliases are not newly identified
- `/parameter-admin/specs` is the live CatalogPage at `1440x900`, `768x1024`, and `390x844`
- Protected consumers stay on the existing comparison gates: Catalog/Governance, topology, project parameters, files, Agent, logs, debugging, DTS reload, knowledge, modules, operations

**Stop immediately on:** identity bypass, cross-org data, mixed-release snapshots, unexplained diffs, unqueryable protected references, sustained pool starvation, or missing recovery evidence. Do not continue by widening authz, infinite retry, empty-result conversion, or skipping artifact checks.

Authorization to start OP-09: **not granted** as of this progress update.

## Schema and data repair

Default: no historical migration edits. F1–F7 are code repairs. Add a new migration only after proving current structure cannot express the contract. Never edit applied SQL bytes, including `0137`.

Do not guess-merge damaged proposal base references by property key, name, or time proximity. Historical Binding/ProjectValue pins stay on their original revisions.

## Git & PR Workflow

- Accepted `origin/main` at plan creation: `54815cdce5dd21d3d96587f0e52cc0f4faae9dd6`.
- Scratch branches from latest `main`. Implementation agents commit only on the feature branch. They must not push `main`, open or merge GitHub PRs, or sync `main` after merge.
- Suggested branches: `fix/catalog-op-01-auth` (#803, may land OP-00 plan files), `fix/catalog-op-02-snapshot` (#804), `fix/catalog-op-03-match` (#805), `fix/catalog-op-04-queries` (#806), `fix/catalog-op-05-proposals` (#807), `fix/catalog-op-06-wire` (#808), `fix/catalog-op-07-page` (#809), `fix/catalog-op-08-evidence` (#810).
- Merge order: OP-01 first; OP-02 then OP-03 on shared Kernel files; OP-04 and OP-05 before OP-06; OP-07/OP-08 after OP-06; OP-09 last and human-authorized.
- Parent agent reviews, seals, opens, and merges PRs.
- Stop boundary: no target cutover, restore, cleanup, traffic switch, or bulk data repair without explicit authorization.

## Documentation Impact Matrix

| Area | Status | English | Chinese | Notes |
| --- | --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `ARCHITECTURE.md`, `docs/README.md` | `docs/zh-CN/root/AGENTS.md`, `docs/zh-CN/root/ARCHITECTURE.md`, `docs/zh-CN/README.md` | No module-map change expected unless Catalog page ownership moves. |
| Planning | Update | `docs/PLANS.md`; this file; later `docs/exec-plans/completed/2026-09-05-parameter-catalog-review-remediation.md` | `docs/zh-CN/PLANS.md`; Chinese companion; later completed companion | Index and remaining work. |
| Wayfinder launch plan | Review | `docs/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md` | Chinese companion | This remediation does not reopen frozen #668 nodes. |
| API authentication | Update | `docs/api/authentication.md` | `docs/zh-CN/api/authentication.md` | With OP-01: production Catalog identity is the unified resolver; development headers are not a production principal. |
| Security | Review / Update if semantics change | `docs/SECURITY.md`, `docs/security/README.md` | `docs/zh-CN/SECURITY.md`, `docs/zh-CN/security/README.md` | Update only if trusted-identity or refusal-audit wording changes. |
| Kernel contract | Update | `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md` | Chinese companion | With OP-02: single connection, capture time, lineage, metadata read boundary. |
| Catalog API transition | Update | `docs/design-docs/parameter-catalog-api-transition.md` | Chinese companion | With OP-05/06: proposal states, metadata, errors, conditional writes. |
| Domain model | Review | `docs/design-docs/domain-model.md` | Chinese companion | Update only for real semantic clarifications. |
| Frontend | Update | `docs/FRONTEND.md` | `docs/zh-CN/frontend.md` | With OP-07: actual mount point, adapter boundary. |
| Browser coverage | Update | `docs/developer/browser-acceptance-coverage-map.md`, `e2e/acceptance/operationMatrix.ts`, `docs/developer/user-operation-coverage-matrix.md` | Chinese companions | With OP-08 when coverage moves from planned to executable. Keep PCAT IDs. |
| Generated OpenAPI | Update if DTO/route change | `docs/generated/openapi.json` | n/a | OP-06; generate, do not hand-edit. |
| Generated schema | Update only if Schema changes | `docs/generated/db-schema.md` | n/a | Default no Schema change. |
| Release runbooks | Update before OP-09 | existing release/rollback/self-hosted runbooks named by the Chinese companion | Chinese companions | New candidate checks and restore limits. |
| Product specs | Review | `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Chinese companions | No product-intent rewrite expected. |
| Quality / testing | Review | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md` | Chinese companions | Record evidence layers; do not collapse them. |

## Documentation Update Gate

- Every `Update` row lands in the owning work-package PR. Every `Review` row is updated or recorded unchanged with evidence in this plan.
- Developer-facing docs stay bilingual through separate linked files.
- Generated artifacts come from the candidate, not a mixed working tree.
- Planned behavior is not written as completed fact. Unrun evidence stays `blocked` / `not-run`.
- `npm run docs:check` must pass before a work package is marked complete.
- This plan cannot move to `completed/` until F1–F7 and INT-01 code/integration evidence exist. OP-09 may remain blocked; record that explicitly rather than collapsing the three completion layers.

## Focused commands

```bash
git status --short
git rev-parse HEAD
npm run test:server -- server/app.test.ts
npm run test:server -- server/modules/catalog-kernel/runtime
npm run test:server -- server/modules/parameter-governance
npm run test:server -- server/modules/parameter-bindings
npm run test:server -- server/modules/parameter-catalog-api
npm test -- src/application/parameter-catalog
npm test -- src/features/parameter-catalog
npm test -- src/features/parameter-catalog-governance
npm run build
npm run docs:check
npm run contract:check
```

Lane PostgreSQL for Catalog evidence follows `docs/agents/catalog-launch-operating-rules.md`. Do not use the shared compose app database as Catalog evidence.

## Completion checklist

Code repair, product integration, and release remain three statuses. Allowed: "code repair complete, target release still blocked". Not allowed: one green status for all three.

See the Chinese companion for the full close-out checkbox list and the CATFIX/PCAT matrices copied from the 2026-09-05 review.
