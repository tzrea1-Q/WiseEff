# WiseEff Testing Strategy and Design

> Chinese: [Chinese](../zh-CN/design-docs/testing-strategy.md)

Reviewed: 2026-09-06. Source baseline: `67d4a77325b6009b77c2373bd788298a6d022bcf`.
This is the test-design entry for the implemented product. It complements the [technical document](full-stack-architecture.md). All design cases below are **not executed in this documentation task**. A linked test file means source-inspected related automation, not complete coverage or a passing run.

## Ownership and Traceability

| Question | Single owner |
| --- | --- |
| What behavior is required? | [Product specifications](../product-specs/index.md), [domain model](domain-model.md), [API contract](api-contract.md), [security rules](../SECURITY.md) |
| What risks, scenarios and assertions should be tested? | This page |
| Which command, dependency and gate applies? | [Verification matrix](../developer/verification-matrix.md) |
| Which requirement and operation IDs already exist? | [Requirement coverage map](../developer/browser-acceptance-coverage-map.md), [operation coverage matrix](../developer/user-operation-coverage-matrix.md) |
| How is coverage generated? | [operationMatrix.ts](../../e2e/acceptance/operationMatrix.ts), referenced acceptance specs and coverage scripts |
| How does a human execute the ordinary acceptance journey? | [Manual acceptance](../runbooks/manual-acceptance.md) |
| Where is proof recorded? | The run-specific artifacts and evidence rules in the verification matrix; historical dashboards are not fresh proof |

`TDES-*` identifiers below identify documentation scenarios only. They do not introduce acceptance operation IDs or change `automated/manual/conditional/future` coverage. When automating a missing scenario, map it to the existing requirement/operation first; add an operation only through the owning source and generator. Never hand-edit the generated operation matrix.

## Scope, Risks and Layers

Scope includes parameter workbench/review/catalog/files, log upload/analysis/admin, node debugging/DTS reload/Bridge, identity and organization governance, Xiaoze, knowledge, feedback, notifications, audit, shell and operations. Future retirement/cutover milestones and target release signoff remain conditional procedures, not implied by current source.

| Priority | Risk and representative designs | Minimum useful proof |
| --- | --- | --- |
| P0 | Tenant/role escape, unsafe or duplicate mutation, stale merge, unauthorized Agent/device action, data loss: AUTH, PARAM, CAT, DBG, AGENT, OPS | Negative plus positive control; API/domain state and real PostgreSQL assertions where transactions matter; audit and external-effect assertions |
| P1 | Broken core journey, misleading analysis, missing content or notification: FILE, LOG, KB, FEEDBACK, NOTIF | Successful and failed/recovery flows; persisted result and user-visible state |
| P2 | Lower-risk presentation and discoverability | Component plus browser quality checks; promote to P0/P1 when a defect hides authorization or blocks a core action |

Existing operation priorities remain authoritative for those operations. These design priorities select depth, not release waivers.

| Layer | Purpose | Existing tooling |
| --- | --- | --- |
| Domain and policy | Types, normalization, state transitions, permissions | Vitest |
| Component and runtime | Loading/error/empty states, project switching, port parity | Testing Library / Vitest |
| API and database | HTTP contracts, role scope, locking, idempotence, retention | Server Vitest plus real PostgreSQL |
| Contract and model | DTO/OpenAPI drift and state invariants | Contract scripts, fast-check |
| Worker and provider behavior | Leases, retry/degradation, budgets and grounding | Worker tests, deterministic log eval |
| Browser | Actual role journeys, API/UI integration, durable result | Playwright acceptance |
| Quality | Accessibility, visual consistency and responsive usability | Existing a11y/visual/responsive gates |
| Device and target operations | Physical effects, restore, upgrade, capacity, OIDC/provider quality | Simulator for local shape; separately identified target/lab evidence |

## Environment and Test Data

Use [local development](../developer/local-development.md) and the verification matrix for exact setup; do not copy a second environment-variable inventory here.

1. Record source SHA, clean/dirty state, command/filter, runtime mode, database identity, migration state, browser viewport and deterministic/live flags before execution.
2. Use an isolated API-mode test runtime and owned PostgreSQL database/object prefix. Catalog database evidence needs pgvector and the role-faithful setup from [Catalog lane rules](../agents/catalog-launch-operating-rules.md); do not use a shared application database. Missing prerequisites produce **blocked** or explicit **skipped**, never a pass.
3. Prepare two organizations, two projects in one organization and one in the other. Use separate editor, hardware reviewer, software reviewer, merger, organization Admin, platform reviewer, read-only and inactive identities as required. Actual permissions come from database bindings; do not substitute one Admin session for the role sequence.
4. Give data a run-specific prefix. Capture project/candidate/definition/release/approval IDs, base versions and expected counts before mutation. Reuse fixture builders in the linked specs; verify unique identity rather than selecting the first row.
5. Use the existing log fixtures `test-fixtures/logs/charging-foldback.log` and `unsupported.bin`; use the linked specs' DTS, Catalog, knowledge and Bridge fixtures. Numeric boundaries come from the chosen fixture's declared range/shape, not arbitrary device-safe assumptions.
6. Deterministic model and simulator runs need no live model/hardware claim. Real-device writes, target restore and upgrade drills require their runbook prerequisites and an authorized isolated lab/non-customer target.
7. After each case, undo only owned mutations using the spec's cleanup or documented domain operations. After a suite, the runtime owner removes its own disposable resources. Retain failed-run evidence and resource identity before cleanup; never drop a database merely because its name looks disposable.

## Coverage Map for This Design

The IDs in the middle column are existing examples, not exhaustive equivalence. Open the linked source and generated matrix for exact assertions and runtime conditions.

| Capability / designs | Existing operation or source | Related automated entry |
| --- | --- | --- |
| Parameter edit/review; TDES-PARAM-01/02 | `PARAM-HAPPY-001`, `PARAM-ASSIGNEE-001`; semantic workflow integration | [parameters](../../e2e/acceptance/parameters.acceptance.spec.ts), [negative](../../e2e/acceptance/parameters-negative.acceptance.spec.ts), [topology](../../e2e/acceptance/parameter-topology.acceptance.spec.ts), [PostgreSQL workflow](../../server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts) |
| File/import/configuration; TDES-FILE-01 | `PARAM-ADMIN-002`, `PROJ-CONFIG-REVISION-GATE-001` | [import wizard](../../e2e/acceptance/parameter-import-wizard.acceptance.spec.ts), [parameter files](../../e2e/acceptance/parameter-files.acceptance.spec.ts), [revision gate](../../e2e/acceptance/config-set-revision-gate.acceptance.spec.ts) |
| Catalog; TDES-CAT-01/02/03 | Production composition, root usage scope and SQL budget contracts | [composition](../../server/modules/parameter-catalog-api/productionComposition.integration.test.ts), [scope](../../server/modules/parameter-catalog-api/rootUsageScope.integration.test.ts), [batch queries](../../server/modules/parameter-catalog-api/rootBatchQueries.integration.test.ts), [Catalog browser](../../e2e/acceptance/parameter-catalog.acceptance.spec.ts), [negative browser](../../e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts) |
| Logs; TDES-LOG-01/02/03 | Manual flow D, worker/eval contracts | [log acceptance](../../e2e/acceptance/log-analysis.acceptance.spec.ts), [worker](../../server/modules/logs/worker.test.ts), [eval](../../server/modules/logs/eval/), [golden corpus](../../eval-cases/logs/README.md) |
| Debugging/reload; TDES-DBG-01/02 | `DEBUG-SIM-001`, `DTS-RELOAD-DEPLOY-001`, `DTS-RELOAD-DEPLOY-HW-001` | [simulator](../../e2e/acceptance/debugging-simulator.acceptance.spec.ts), [reload](../../e2e/acceptance/dts-reload-deploy.acceptance.spec.ts), [ADB design](2026-06-21-adb-real-device-full-chain-test-design.md) |
| Identity/retention; TDES-AUTH-01/02 | `AUTH-RUNTIME-001`, `PERM-USER-MGMT-001` | [auth](../../e2e/acceptance/auth-runtime.acceptance.spec.ts), [permission matrix](../../e2e/acceptance/permissions-matrix.acceptance.spec.ts), [deletion](../../server/modules/users/deletion.integration.test.ts) |
| Xiaoze; TDES-AGENT-01/02 | Tool approval and checkpoint contracts | [action](../../e2e/acceptance/xiaoze-action.acceptance.spec.ts), [orchestrator](../../server/modules/agent/orchestrator.test.ts), [checkpoint](../../server/modules/agent/xiaoze/durableCheckpointer.integration.test.ts) |
| Knowledge; TDES-KB-01 | `KB-READ-001`, `KB-EDIT-001`, `KB-INDEX-001` | [knowledge browser](../../e2e/acceptance/knowledge.acceptance.spec.ts), [knowledge service](../../server/modules/knowledge/service.test.ts) |
| Feedback/notifications; TDES-FEEDBACK-01, TDES-NOTIF-01 | `PFB-SUBMIT-001`, `PFB-ADMIN-001`, `PFB-AUTHZ-001`, `NOTIF-INBOX-001`, `NOTIF-READ-001` | [feedback](../../e2e/acceptance/product-feedback.acceptance.spec.ts), [notifications](../../e2e/acceptance/notifications.acceptance.spec.ts) |
| Shell/quality; TDES-UI-01 | `SHELL-DIAG-001`; quality gates | [shell](../../e2e/acceptance/shell-navigation.acceptance.spec.ts), [UI checklist](../developer/ui-quality-checklist.md) |
| Operations; TDES-OPS-01 | Recovery/readiness contracts, conditional target procedures | [upgrade regression](../../ops/self-hosted/scripts/upgrade.sh.test.ts), [manual acceptance](../runbooks/manual-acceptance.md), [verification matrix](../developer/verification-matrix.md) |

## Executable Core and Risk Cases

For every case, record actual results against each expected result, API status/error code, relevant DB predicates/counts, audit correlation, and artifacts where applicable. The common environment, cleanup and evidence rules above apply to every case. Browser steps use the route/labels in the current fixture and spec; service fault injection is performed in the isolated harness, not against a shared server.

### TDES-PARAM-01 — Typed change through real review roles (P0)

- **Prepare:** Owned project, editable binding, known base/candidate revision and distinct assigned reviewers.
- **Steps:** Follow manual flow B using the current workbench; save value/reason, select eligible assignees, submit; perform hardware review, software review and merge in their respective sessions; reload the project and inspect history.
- **Expect:** Each transition requires its actual role; submission retains exact draft/binding/candidate/action identity; the merged candidate value and audit persist; immutable base stays unchanged. Where file writeback applies, inspect the resulting file and re-ingested value.
- **Cleanup:** Use the acceptance fixture cleanup for the owned request, candidate and project. Do not rewrite shared history.

### TDES-PARAM-02 — Stale candidate and project isolation (P0)

- **Prepare:** Two projects and a candidate editable in session A; snapshot its state and revision.
- **Steps:** Load A, delay its response, switch to B and then release A's response. Separately change the candidate in another session before submitting/merging the stale view; attempt a forced request with changed candidate identity.
- **Expect:** B never receives A's drafts, values or assignees. Stale/changed identity is rejected using the endpoint's conflict contract; no replacement candidate is silently selected and no partial merge/writeback occurs.
- **Cleanup:** Release delayed requests; remove only owned drafts/candidates through fixture cleanup.

### TDES-FILE-01 — Import validation and revision conflict (P1)

- **Prepare:** Owned config set, known source revision, valid DTS/JSON fixture and a malformed or invalid-value variant.
- **Steps:** Preview both imports; inspect error and mapping details. Cancel and confirm no business apply occurred. Apply the valid path in the owning fixture; change its source revision, then try to activate/write back the stale candidate.
- **Expect:** Preview does not alter current project values/files, though preview records may persist. Invalid data cannot be applied; valid application retains intended syntax/value shape; stale activation/writeback is blocked and retains input for review.
- **Cleanup:** Clean owned preview/import records, file versions and config set through the file fixture. The wizard browser test covers preview; it alone does not prove all apply/conflict assertions.

### TDES-CAT-01 — Release pin, scope and truthful empty states (P0)

- **Prepare:** Catalog integration fixture with installed releases, same-organization project-limited user, organization-wide reader and second organization; record release IDs/digests.
- **Steps:** Read list/detail/history at current and pinned releases. Reload a deep link and use Back/Forward. Request another project's usage, refresh database role bindings, and repeat. Exercise no registrations, no definitions, no filter matches and unavailable projection.
- **Expect:** Identity and release digest stay paired; scope derives from current database grants. Explicit empty scope is true zero; unavailable data is an error/not-ready outcome, not zero usage. No cross-organization fact leaks.
- **Cleanup:** Use the Catalog fixture's owned runtime and database teardown.

### TDES-CAT-02 — Proposal conflict, retry and independent review (P0)

- **Prepare:** Organization proposer, distinct authorized platform reviewer, captured base and ETag, run-specific idempotency key; use the proposal integration/browser fixtures.
- **Steps:** Create draft, submit and review. Repeat an identical request; repeat the key with changed content. Attempt self-review, stale ETag/base and cross-organization access. Inject the fixture's response-phase failure after commit and retry. Refresh conflicted input and explicitly reconfirm.
- **Expect:** Exact retries resolve to the original committed result without duplicate mutation; changed fingerprints conflict. Stale state and unauthorized/self review are refused. Acceptance records publication intent without directly changing Catalog definitions; UI preserves conflicted input and requires reconfirmation.
- **Cleanup:** Remove only owned proposal/governance fixture state. See [proposal workflow](../../server/modules/parameter-governance/proposals/workflow.integration.test.ts) and [governance browser](../../e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts).

### TDES-CAT-03 — Page-size and projection-failure budget (P1)

- **Prepare:** The root batch-query fixture and its declared inventory sizes/SQL counter; pin the release.
- **Steps:** Run nonempty and empty pages, registration filtering before pagination, invalid limits, and injected usage/registration projection failures.
- **Expect:** Enforce the exact statement budgets asserted by the fixture; no per-row business-query growth, no cross-tenant projected state, no silent fallback after projection failure. Capture query counts separately from latency.
- **Cleanup:** Stop the fixture server and close/remove its owned database. This local query-budget check is not a target-capacity pass.

### TDES-LOG-01 — Upload, evidence and archive (P1)

- **Prepare:** Owned log domain and the supported/unsupported fixtures; API worker active.
- **Steps:** Execute manual flow D: upload, ask about charging foldback, observe stages, open a cited line, submit feedback, archive and reload; upload the unsupported file.
- **Expect:** Supported input reaches a report with traceable real lines and honest source/degradation labels; unsupported input produces a readable failure. Archive affects the default list and retains authorized history.
- **Cleanup:** Use log-fixture cleanup for owned records, jobs, feedback and object keys.

### TDES-LOG-02 — Grounding, tool legality and degradation (P1)

- **Prepare:** Scripted models from the behavior eval; both `loop` and `single-shot` kernels.
- **Steps:** Exercise unavailable provider, malformed output, nonexistent cited lines, illegal tools/arguments, insufficient evidence, and exhausted step/token budget.
- **Expect:** No invented line references or write-capable tool action; configured retries remain bounded; fallback exposes its reason/source; early convergence caps confidence where specified. Harness negative controls must detect known-bad outputs.
- **Cleanup:** Reset injected models/config and owned eval artifacts. `logs:eval` is behavioral proof; quality evaluation uses the annotated corpus and its own baseline rules.

### TDES-LOG-03 — Worker redelivery and stale lease (P0)

- **Prepare:** Isolated job/worker fixture with known lease and terminal-state predicates.
- **Steps:** Deliver the same job again, force processing failure/retry, expire/reclaim a lease, then let the old worker attempt progress or completion.
- **Expect:** PostgreSQL claim/lease rules govern mutation; an obsolete worker cannot overwrite the current result; terminal/retry/dead-letter evidence follows the worker contract and does not claim success from dispatch alone.
- **Cleanup:** Stop fixture workers before cleaning their jobs and object keys; durable Redis behavior needs its separate queue gate.

### TDES-DBG-01 — Safe write, alternate observation and rollback (P0)

- **Prepare:** Simulator fixture; record initial writable value, read-only node and the alternate-readback probe.
- **Steps:** Execute manual flow E; read `3000`, write `3100`, inspect snapshot and observation. Write probe `2` and observe `1`. Try read-only/unauthorized writes via UI and forced API. Restore the owned initial snapshot using the supported surface.
- **Expect:** Successful command remains successful despite a different observation; forbidden writes cause no device effect; snapshot, operation and audit are traceable; restored value returns to baseline. If rollback is API-only, record that boundary rather than claiming UI coverage.
- **Cleanup:** Restore owned simulator state and remove fixture records. These sample values belong to the simulator, not arbitrary hardware.

### TDES-DBG-02 — Reload preflight and honest device evidence (P0)

- **Prepare:** Owned reload fixture, pinned DTS toolchain, fake Bridge and baseline digest; real-device variant requires lab readiness.
- **Steps:** Fail compile/capability/confirmation/permission preconditions and verify no deploy. Then deploy the valid fixture, inspect snapshot, kernel evidence and observation state; exercise residue and restore-baseline.
- **Expect:** Failed preflight cannot write the device; missing behavioral proof remains unverifiable; library values stay unchanged by deploy; failed restore preserves truthful residue/outcome. Sensitive and Agent paths follow the current trusted policy.
- **Cleanup:** Finish fixture restore before teardown; retain failed device/run evidence. Fake-Bridge and real HDC/ADB results are separate records.

### TDES-AUTH-01 — Tenant, activation and role enforcement (P0)

- **Prepare:** Two organizations, project-scoped roles and inactive account; local auth fixture or explicit OIDC target variant.
- **Steps:** Open allowed and denied routes, issue the denied API directly, substitute another organization's resource ID, deactivate the user/change its database role and repeat. For OIDC, run wrong issuer/audience/expiry/signature checks using the identity gate.
- **Expect:** Denial is server-enforced without exposing scoped data; database role/active changes affect subsequent requests; token claims alone do not grant administration. Record each endpoint's specified 401/403/hidden-resource behavior.
- **Cleanup:** Restore only fixture roles and activation. Local HMAC/dev sessions do not prove deployed OIDC.

### TDES-AUTH-02 — Account deletion and retained history (P0)

- **Prepare:** Real PostgreSQL deletion fixture with account-owned state, retained history and a non-self target; snapshot relevant row counts and nullable references.
- **Steps:** Reject non-Admin, self-deletion and unauthorized platform-admin deletion; delete the allowed target as Admin, inspect response/UI and query all foreign-key categories.
- **Expect:** Successful API deletion is `204`; account-owned rows cascade, retained history survives with nullable identity, Agent correlation is retained under the trusted-attribution contract, and deletion audit contains no unnecessary PII. Failed attempts leave state unchanged.
- **Cleanup:** Teardown the owned database; never recreate a deleted real account as test cleanup.

### TDES-AGENT-01 — Approval is necessary and revalidated (P0)

- **Prepare:** Deterministic Xiaoze fixture with read tool, approval-required mutation and persisted before-state.
- **Steps:** Execute a scoped read; request mutation, reject it and inspect unchanged business state. Create a new approval, change its scope/arguments or user's permissions before approval, then approve/replay through the real endpoint.
- **Expect:** No mutation before approval; rejected/stale/unauthorized approval cannot write. Accepted edits are revalidated; replay cannot duplicate effects. Audit retains Agent provenance and correlation rather than relabeling it as human.
- **Cleanup:** Finish/cancel owned pending approvals and clean fixture conversations/business records; no live-provider claim.

### TDES-AGENT-02 — Durable interrupt and isolated resume (P0)

- **Prepare:** Dedicated PostgreSQL checkpoint database, unique organization/user/thread identity.
- **Steps:** Run the linked durable-checkpoint integration case: interrupt a planning agent, create a fresh saver/agent instance and resume the same namespace. Separately exercise endpoint authorization using another user/organization or revoked permission.
- **Expect:** Committed interruption is readable across instances; current endpoint authorization still applies on resume. The checkpoint test uses a fake approval resolver, so it proves persistence/resume mechanics, not the complete production approval chain; pair it with TDES-AGENT-01.
- **Cleanup:** Close saver pools and remove only the owned checkpoint database. Missing database configuration means skipped/blocked.

### TDES-KB-01 — Publication, scope and search degradation (P1)

- **Prepare:** Owned draft, published and archived entries plus a second organization; index fixture and embedding-unavailable variant.
- **Steps:** Create/revise/publish, search and open citations, archive and repeat; attempt cross-organization access. Exercise text-only fallback and index retry through the existing harness.
- **Expect:** Retrieval exposes only authorized published revisions with valid citations; drafts/archived entries do not leak through search; fallback remains explicit and does not fabricate semantic results.
- **Cleanup:** Clean owned revisions, chunks, links and object keys with the knowledge fixture.

### TDES-FEEDBACK-01 — Submission and Admin triage (P1)

- **Prepare:** Member and Admin sessions, owned feedback marker and permitted image fixture.
- **Steps:** Submit sidebar feedback with attachment, reload, triage/close as Admin; force the Admin API as a member.
- **Expect:** Content and attachment association persist; status changes remain traceable; non-Admin triage is refused in UI/API.
- **Cleanup:** Remove only the fixture's feedback, notes and attachment objects.

### TDES-NOTIF-01 — Scoped inbox and read persistence (P1)

- **Prepare:** Owned notifications for two users and a recorded unread count.
- **Steps:** Open the panel, follow a permitted deep link, mark read/all read, reload; attempt another user's notification through API.
- **Expect:** Only authorized inbox data is exposed; unread counts and read state persist; linked destinations reapply their own authorization. The linked browser spec is a starting point; validate any missing cross-user assertion at service/API level.
- **Cleanup:** Delete owned notification fixtures and restore no unrelated user's read state.

### TDES-UI-01 — Core navigation and state usability (P1)

- **Prepare:** API-mode roles and loading/error/empty/populated fixtures for affected routes.
- **Steps:** Navigate, reload/deep-link, search/filter, open/close dialogs, use keyboard focus, submit and recover from errors at `1440x900`, `768x1024`, `390x844`; collect snapshots/screenshots and inspect console/network.
- **Expect:** No unintended horizontal overflow, obstructed action, unreadable text or lost input; loading, forbidden, error and empty states remain distinguishable. Only expected negative API responses are allowed.
- **Cleanup:** Reset fixture interceptions and browser sessions. Use the existing UI checklist and quality gates for detailed criteria.

### TDES-OPS-01 — Readiness, recovery and release evidence (P0)

- **Prepare:** Choose a local fault-injection harness or authorized isolated target drill; record source/deployed version, recovery point and resource ownership.
- **Steps:** Inject a required dependency failure, compare live/ready results, restore the dependency. For upgrade/backup/restore/rollback, execute the existing runbook against the explicitly selected environment and verify database plus object consistency.
- **Expect:** Liveness does not hide dependency/readiness failure; failed upgrade/restore is not marked successful; candidate or recovered state satisfies the runbook's invariants. Target capacity uses declared workload/metrics and existing thresholds.
- **Cleanup:** Follow runbook phase-specific recovery and resource ownership. Local script assertions cannot close target OIDC, Redis, storage, hardware, provider or release gates.

## Boundary and Nonfunctional Coverage

For value/file/API changes, partition valid, empty, malformed, absent, duplicate and oversized inputs; test range/shape boundaries from the owning schema. For lists, test zero/one/multiple pages, filters before pagination, opaque identifiers, stale cursors/release pins, and cross-scope rows. For writes, cover duplicate request, changed idempotency fingerprint, concurrent state change and failure before/after commit.

Capacity criteria come from [reliability targets](../RELIABILITY.md) and the target capacity gate, with dataset size, concurrency, duration, percentile latency and errors recorded. Do not invent a measured SLA from a local timing. Accessibility, visual and responsive checks complement business assertions; device timeout/offline/unsupported observations and provider budget failures must retain actionable outcomes.

## Execution Selection and Outcome

Use the verification matrix for exact commands. During implementation, select focused suites from the map above; broaden only at the owning integration stage. Documentation-only changes run `npm run docs:check` and `git diff --check`. This documentation delivery does not run product suites, mutate fixtures or generate acceptance evidence.

Before accepting a test run:

- Required cases are collected and executed; required skipped tests or zero collected tests block that claim.
- Report passed, failed, skipped, blocked and not-run separately. State which design assertions the selected tests actually covered.
- Persist source SHA/run identity, command, role, route, environment, assertions, expected/actual outcomes, redacted API/DB/audit summaries and artifact paths.
- Keep focused runs separate from full runs; do not overwrite `latest-full.json` with partial evidence. Gate0 owns full local acceptance and its resource/artifact safety protocol.
- Defects include reproduction, expected/actual result, affected design/operation, severity, environment and evidence. Rerun the fix's affected checks; do not relabel historical passes as new proof.
- Existing automated coverage without a fresh result remains **not run** for this delivery. Hardware, live-model quality, expert log annotation, target OIDC/recovery/capacity and unautomated assertions remain explicit verification dependencies, not claims that implementation is missing.

## Specialist and Historical References

Style contract tests use [cssAssertions.ts](../../src/test/cssAssertions.ts), not raw CSS text formatting; rendered behavior belongs to component/browser gates.

Log evaluation has a deterministic behavior layer (`npm run logs:eval`) and a quality layer (`npm run logs:eval:quality`). The latter's baseline counts only eligible `realLog: true` annotated cases; synthetic cases demonstrate format and harness behavior. Prompt/model changes must follow the [corpus rules](../../eval-cases/logs/README.md).

User deletion must preserve the trusted attribution rules in the [account-deletion plan](../exec-plans/active/2026-08-28-user-account-deletion.md); PostgreSQL tests, including migration constraints and prohibited identity reconstruction, own detailed predicates.

Topology rounds below are retained historical test rationale and fixture counts, not a current release status or instruction to cut over a shared database. Their implementation context is in the completed [round 4](../exec-plans/completed/2026-07-16-parameter-topology-round4-review-blockers.md), [round 5](../exec-plans/completed/2026-07-16-parameter-topology-round5-review-blockers.md) and [round 6](../exec-plans/completed/2026-07-16-parameter-topology-round6-review-blockers.md) plans. Current execution selection is owned by the verification matrix above.

## Parameter Topology (round 4)

Round 4 closes parent-agent review blockers on branch `fix/parameter-topology-round4-review-blockers`. **TD-042 remains a BLOCKER** — these gates prove local/temp-DB behavior, not production cutover readiness.

| Area | Tests / command | Proves |
| --- | --- | --- |
| Vendor dt-schema | `server/modules/dts/goldenPowerFixture.test.ts`, `scripts/vendorDtSchemaGenerator.test.ts` | Deterministic linux-bindings from property specs; golden DTBs pass real `dt-validate`; negative fixtures fail with expected diagnostics |
| Golden counts | `goldenPowerFixture.test.ts` (parsed topology), `seedM1DtsFiles.test.ts` (`dts_properties`), `matcher.test.ts` (120 matched after structural exclusion), `ingestService.test.ts` (176 occurrences) | Locked **176 occurrences / 120 matched / 684 seed rows** |
| Stage → finalize | `server/modules/parameter-topology/migration.test.ts` (temp PostgreSQL, reconnect, inject-fail) | Durable `stage-review` transaction; atomic `finalize`; cutover rejects non-`finalized` runs |
| Exact writeback | `server/modules/parameter-topology/editService.test.ts`, merge workflow tests | Occurrence-locked merge/writeback; immutable base; stale identity → `409` |
| Matcher / review scope | `server/modules/parameter-specs/matcher.test.ts`, `matcherScope.integration.test.ts` | Override isolation by node locator fingerprint; `blocker_scope` honored on validate/release |
| Manifest gates | `server/modules/parameter-topology/manifestBackfillMigration.test.ts`, `configRevisionManifest.test.ts`, `editService` needs_review paths | Backfill from `dts_config_revision_members`; `needs_review` fail-closed on edit/validate/release/writeback |
| Global-spec hotspots | `server/modules/parameters/dashboard/postCutoverDashboard.integration.test.ts` | Tenant projects include `organization_id IS NULL` vendor specs |
| Unmatched review | `server/modules/parameter-specs/service.test.ts`, `routes.test.ts` | `createSpec` + `confirmPropertyMismatch` with governance audit |
| Browser acceptance | `e2e/acceptance/parameter-topology.acceptance.spec.ts` | `PARAM-SPEC-GOVERN-001` through `PARAM-CONFIG-PUBLISH-GATE-001`; `PARAM-ENABLE-*` stubs registered (ADR-0003); no teaching fallback in API mode |

Toolchain gate before topology release work:

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameter-topology/migration.test.ts server/modules/parameter-specs/matcherScope.integration.test.ts --run
```

## Parameter Topology (round 5)

Round 5 closes parent-agent review blockers on branch `fix/parameter-topology-round5-review-blockers`. **TD-042 remains a BLOCKER** — these gates prove local/temp-DB behavior, not production cutover readiness.

| Area | Tests / command | Proves |
| --- | --- | --- |
| Immutable base vs candidate | `postCutoverWorkflow.integration.test.ts`, `editService.test.ts` | Base binding revision unchanged after merge/writeback; merged value on candidate revision only |
| Fail-closed writeback | `parameters/service` merge path, `writebackService`, `editService` toolchain gates | Missing `objectStore`, project scope, write lock, or toolchain fails closed; no `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` production bypass |
| Phase audit + run linkage | `migration.test.ts` (`parameter_identity_migration_phases`, `migration_run_id`) | Immutable `stage-review`/`finalize` phase rows; inferred tasks linked to staged run; cutover rejects forged status |
| Tenant-owned resolve | `parameter-specs/repository` `validateSpecReviewTenantEvidence`, cross-tenant PG tests | Resolve rejects cross-tenant evidence; 0055 does not trust raw evidence IDs |
| Draft→activate→resolve | `draftSpecWorkflow.integration.test.ts`, `parameter-specs/service.test.ts`, `routes.test.ts` | `createSpec` draft only; `activate` requires Admin + complete shape; resolve rejects draft specs |
| Acceptance fixture honesty | `e2e/acceptance/helpers/acceptanceTaskLookup.ts`, `semanticFixtureCleanup.ts`, topology/files/dts acceptance specs | No `items[0]` fallbacks; prefix-scoped FK-complete cleanup; draft→activate→resolve covered |

Round 5 toolchain gate (same as round 4):

```bash
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts server/modules/parameter-topology/migration.test.ts --run
```

### Parameter topology Round 6 review blockers

Round 6 closes remaining parent-agent review blockers on branch `fix/parameter-topology-round6-review-blockers`. **TD-042 remains a BLOCKER.**

| Area | Tests / command | Proves |
| --- | --- | --- |
| Evidence-only scope reconcile | `0058_*.sql`, `specReviewTenantEvidence.integration.test.ts` | Polluted historical FKs rebuilt/cleared from proven evidence; unproven resolved → open; idempotent + rollback |
| Lossless spec identity | `specIdentity.test.ts`, `draftSpecWorkflow.integration.test.ts` | `vendor,limit` ≠ `vendor-limit`; sanitize not in hash; collision audit fail-closed |
| Global activate authz | `globalSpecActivate.authz.test.ts` | Org Admin activate global draft → 403; org draft OK; read/bind global still allowed |
| Full valueShape activate | `DraftSpecActivatePanel.test.tsx`, `specCompleteness.ts` | gpio_int cellsPerGroup=3 preserved; incomplete shape blocks |
| Integrated DTS workbench | `ParametersPage.test.tsx`, `DtsParameterWorkbench.test.tsx`, `DtsTopologyNavigator.test.tsx`, `DtsBindingDetailDialog.test.tsx`, `DtsBindingDraftTray.test.tsx` | Mature `WorkbenchLayout` + nested semantic navigation, search/filter, raw value/shape/provenance detail, current edits, project-safe typed submission, and responsive accessibility; no legacy recommendation/teaching fallback |
| Tenant-scoped cleanup | `semanticFixtureCleanup.isolation.test.ts` | Same-name Config Sets in other org/project untouched |
| Submit→review→merge acceptance | `parameter-topology.acceptance.spec.ts`, `disposablePostCutoverRuntime.ts` | Drives the integrated DTS workbench through semantic search/tree/detail/current-edits, then automatically creates a disposable DB, applies migrations+identity cutover, verifies marker/run identity, and proves real set/delete role chains, writeback, candidate AST/tombstone, reload, and base immutability before dropping the DB. Delete authoring/submission uses public APIs because no delete UI control exists; role decisions and merge remain UI operations. |
| Assignee/review UI acceptance | `parameters-negative.acceptance.spec.ts`, `parameters.acceptance.spec.ts` | Three visible selectors use API-scoped eligible users; production HMAC browser identities perform each hardware/software/merge UI action. DB role queries or one Admin token cannot replace these operations. |
| Project switch isolation | `ApiProjectTopologyWorkspace.test.tsx` rerender + deferred-response regressions, browser interaction | A project-A candidate/draft/messages cannot influence project B; B starts at `current`; late project-A draft responses are ignored and cannot load B assignees. |
| Evidence run isolation | `check-operation-evidence.test.ts`, `run-browser-acceptance.test.ts` | Full records/artifacts share one run+commit namespace; focused runs preserve `latest-full`; mixed runs fail closed. |
| Binding submission identity | `routes.test.ts`, `postCutoverWorkflow.integration.test.ts`, migrations `0059`–`0063` | HTTP keeps draft/binding/spec/action and returns the exact candidate ID. Two real PG connections prove candidate status mutation waits while submission holds draft+candidate locks; submission promotes `draft -> pending_approval` and persists the ID on item/request. Merge rejects missing/changed candidate status, set value, or delete proof. Upgrade tests cover 0061 all-origin invalidation and 0063 transactional/idempotent schema application. |
| Typed delete lifecycle | `schemas.test.ts`, `postCutoverWorkflow.integration.test.ts`, `parameter-topology.acceptance.spec.ts` | `delete` requires an empty target, persists through draft/submission/CR/audit, proves candidate binding absence plus matching occurrence effect, writes `/delete-property/`, re-ingests/validates, leaves no replacement binding revision, and reloads absent after real role review/merge. |
| test:all stability | App API-runtime isolation, unique dashboard fixture namespaces, FIFO queries on each transactional PG client | Default `npm run test:all` without ad-hoc worker overrides or global timeout inflation |

Do not cut over a shared developer/acceptance database merely to make the topology acceptance green. The topology spec owns a disposable `wiseeff_acceptance_disposable_*` database and verifies its test marker before destructive cleanup. Keep TD-042 open until the separate clean-snapshot rehearsal is complete.
