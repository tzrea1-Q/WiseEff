# M5.10 Evidence-Grade Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Upgrade automated browser operation evidence from screenshot-level proof into auditable, reproducible records that include request, API, DB, audit, runtime, trace/report, and failure reproduction context.

**Architecture:** Keep Playwright as the deterministic acceptance engine and extend the existing M5.7 operation evidence contract. The checker enforces richer evidence only for operations whose matrix assertions require `api`, `db`, or `audit`, while UI-only operations remain lightweight but still carry runtime and replay metadata.

**Tech Stack:** TypeScript, Playwright Test, Vitest, PostgreSQL acceptance helpers, existing `acceptance:browser` and `acceptance:evidence` scripts.

---

## Scope

In scope:

- Extend operation evidence records with `api`, `db`, `audit`, `trace`, `report`, `runtime`, and `reproduction` fields.
- Enforce required evidence summaries based on `e2e/acceptance/operationMatrix.ts` assertion types.
- Add request IDs from API responses where Playwright/API calls are already available.
- Add focused DB and audit summaries to high-risk P0/P1 operations that already claim DB/audit assertions.
- Regenerate machine-readable and human-readable operation evidence indexes.
- Document the M5.10 gate and its effect on future UI/API interaction changes.

Out of scope:

- AI exploratory QA or AI browser agents.
- New operation coverage beyond M5.8.
- Visual, accessibility, responsive, staging synthetic, or CI artifact changes; those remain M5.11/M5.12.
- Real HDC evidence. `HDC-LAB-001` remains conditional.

## Affected Operation IDs

M5.10 upgrades evidence depth for the existing automated P0/P1 matrix:

- API summary required: every operation whose assertions include `api`.
- DB summary required: `PARAM-HAPPY-001`, `PARAM-DRAFT-EDIT-001`, `PARAM-REJECT-001`, `LOG-HAPPY-001`, `LOG-REANALYZE-001`, `DEBUG-SIM-001`.
- Audit summary required: `PARAM-HAPPY-001`, `PARAM-ADMIN-001`, `PARAM-REJECT-001`, `LOG-HAPPY-001`, `LOG-REANALYZE-001`, `DEBUG-SIM-001`, `AGENT-APPROVAL-001`, `AGENT-UNAUTH-001`.
- `PARAM-DRAFT-EDIT-001` is API/DB-backed because the final submitted draft is persisted, but draft edit/remove itself does not emit a production audit event.
- `PERM-USER-MGMT-001` is intentionally UI-only until durable backend user-governance mutation/audit APIs are added; see TD-021.
- UI-only operations still require artifacts plus runtime/replay metadata.

## Files

- Modify: `e2e/acceptance/helpers/operationEvidence.ts`
- Modify: `scripts/check-operation-evidence.ts`
- Modify: `scripts/check-operation-evidence.test.ts`
- Modify: `e2e/acceptance/*.acceptance.spec.ts` where evidence records are emitted
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Regenerate: `docs/generated/acceptance-operation-evidence.md`
- Regenerate: `docs/generated/acceptance-operation-evidence/index.json`

---

## Task 1: Evidence Contract Gate

- [x] **Step 1: Write failing tests**

Add tests in `scripts/check-operation-evidence.test.ts` proving:

- records with `api` assertions fail without API summaries.
- records with `db` assertions fail without DB summaries.
- records with `audit` assertions fail without audit summaries.
- every passed record must include runtime, reproduction, and report/trace metadata.
- generated Markdown renders request IDs and audit targets.

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts
```

Expected: fail before implementation.

- [x] **Step 2: Implement schema and validator**

Extend `OperationEvidenceRecord` and `RecordOperationEvidenceInput` with:

- `api?: Array<{ method; path; status; requestId?; responseSummary? }>`
- `db?: Array<{ table; predicate; observed; rowCount? }>`
- `audit?: Array<{ id?; kind; action?; targetId?; requestId?; metadataSummary? }>`
- `trace?: { mode; path?; note? }`
- `report?: { path; format }`
- `runtime?: { mode; apiBaseUrl; seed?; envSummary? }`
- `reproduction?: { steps; seed? }`

Update `evaluateOperationEvidence` to report typed validation gaps instead of one generic invalid list.

- [x] **Step 3: Verify unit gate**

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts scripts/run-browser-acceptance.test.ts
```

Expected: pass.

## Task 2: Helper Defaults And Redaction

- [x] **Step 1: Write failing helper tests**

Add tests proving `recordOperationEvidence` supplies runtime, trace/report, and reproduction defaults and redacts token/key/authorization-like text from notes and response summaries.

- [x] **Step 2: Implement helper defaults**

Make `recordOperationEvidence` add:

- screenshot artifact as today.
- `trace.mode = "retain-on-failure"` with the Playwright report path.
- `report.path = "playwright-report/acceptance/index.html"`.
- runtime mode and API base URL from env.
- reproduction steps from operation title, route, role, and artifact paths.

- [x] **Step 3: Verify helper tests**

Run:

```bash
npm test -- scripts/check-operation-evidence.test.ts
```

Expected: pass.

## Task 3: High-Risk Operation Instrumentation

- [x] **Step 1: Add API summaries**

For API-backed acceptance specs, capture response status, `x-request-id`, and a compact response summary.

- [x] **Step 2: Add DB summaries**

For DB-backed operations, query the final persisted state already asserted by the test and summarize the table/predicate/observed value.

- [x] **Step 3: Add audit summaries**

For audit-backed operations, capture the matched audit event `id`, `kind`, `action`, `targetId`, and trace/request correlation when present.

- [x] **Step 4: Verify targeted acceptance specs**

Run:

```bash
npm run acceptance:e2e -- e2e/acceptance/parameters.acceptance.spec.ts e2e/acceptance/parameters-negative.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/log-analysis.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/debugging-simulator.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/agent.acceptance.spec.ts e2e/acceptance/permissions.acceptance.spec.ts e2e/acceptance/permissions-matrix.acceptance.spec.ts
```

Expected: pass.

## Task 4: Generated Evidence Reports

- [x] **Step 1: Regenerate evidence**

Run:

```bash
npm run acceptance:browser
npm run acceptance:evidence
```

Expected: pass and update generated Markdown/JSON with rich evidence fields.

- [x] **Step 2: Inspect generated artifacts**

Confirm:

- required P0/P1 automated operations are covered.
- API/DB/audit assertions have matching summaries.
- generated JSON is machine-readable.
- generated Markdown is human-readable and includes request/audit context.
- no tokens, keys, or authorization values appear in generated evidence.

## Task 5: Documentation And Completion Gate

- [x] **Step 1: Update developer-facing docs**

Update verification/manual acceptance docs to say M5.10 evidence summaries are blocking for operations that claim API/DB/audit assertions.

- [x] **Step 2: Complete the plan**

Move this plan to `docs/exec-plans/completed/` only after verification passes.

- [x] **Step 3: Run final gates**

Run:

```bash
npm run docs:check
npm run contract:check
npm run test:all
npm run build
git diff --check
```

Expected: all pass. Existing Vite chunk-size warnings remain non-blocking.

## Documentation Impact Matrix

| Area | Files | Action | Reason |
| --- | --- | --- | --- |
| Repository maps | `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, `ARCHITECTURE.md`, `docs/README.md` | Review | M5.10 changes quality evidence, not repository topology. |
| Planning docs | `docs/PLANS.md`, `docs/exec-plans/active/development-roadmap.md`, this plan | Update | Roadmap must reflect M5.10 execution and gate semantics. |
| Product specs | `docs/product-specs/index.md`, `docs/product-specs/product-spec.md`, `docs/product-specs/prototype-functional-spec.md` | Review | No product behavior changes expected. |
| Architecture docs | `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/testing-strategy.md` | Review | Testing strategy may need evidence-grade acceptance mention. |
| Quality/testing docs | `docs/developer/verification-matrix.md`, `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/QUALITY_SCORE.md` | Update | Verification matrix must document `acceptance:evidence` depth. Coverage docs are regenerated/reviewed. |
| Reliability/runbooks | `docs/runbooks/manual-acceptance.md`, `docs/zh-CN/manual-acceptance.md`, `docs/RELIABILITY.md` | Update | Human reviewers need the richer evidence review procedure. |
| Security/governance docs | `docs/SECURITY.md`, `docs/security/README.md`, `docs/security/authorization-model.md` | Review | Evidence redaction touches governance but should not change policy. |
| Frontend/design docs | `docs/FRONTEND.md`, `docs/DESIGN.md` | Review | No UI behavior or design-system change expected. |
| Generated artifacts | `docs/generated/acceptance-operation-evidence.md`, `docs/generated/acceptance-operation-evidence/index.json`, `docs/generated/acceptance-browser-evidence.md` | Update | Generated evidence must be refreshed from the final run. |
| References | `docs/references/*` | Review | Update only if agent-facing references mention old evidence semantics. |
| Chinese docs | `docs/zh-CN/README.md`, `docs/zh-CN/manual-acceptance.md` | Update | Chinese developer/manual acceptance docs must explain evidence review. |

## Documentation Update Gate

- [x] Every `Update` row has been updated.
- [x] Every `Review` row has been checked and recorded as unchanged or updated.
- [x] `docs/generated/acceptance-operation-evidence.md` and `docs/generated/acceptance-operation-evidence/index.json` are regenerated.
- [x] `docs/runbooks/manual-acceptance.md` and `docs/zh-CN/manual-acceptance.md` explain M5.10 evidence review.
- [x] `npm run docs:check` passes.


## Completion Notes

- `npm run acceptance:browser` passed in local non-HDC mode on 2026-06-01 with 33 passed, 1 HDC skipped, 0 blockers, 20 covered operation IDs, and 34 evidence records.
- `npm run acceptance:evidence`, `npm run acceptance:coverage`, and `npm run acceptance:operations` passed after the generated evidence refresh.
- Evidence records now include runtime, trace/report, reproduction, API, DB, and audit summaries where required by operation assertions.
- `PERM-USER-MGMT-001` remains intentionally UI-only until durable backend user-governance mutation/audit APIs are added; this productization gap is tracked as TD-021.
- Final docs, contract, test, build, and whitespace gates must be rerun after moving this plan to `completed/`.

## UI Interaction Automation Rule Review

M5.10 changes acceptance automation/evidence only. It does not change product UI behavior, but it directly strengthens the required operation evidence for existing UI/API interaction coverage. Affected specs are all `e2e/acceptance/*.acceptance.spec.ts` files that call `recordOperationEvidence`. Affected operation IDs are listed in the "Affected Operation IDs" section above.
