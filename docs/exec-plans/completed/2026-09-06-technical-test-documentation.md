# Technical and Test Documentation Consolidation

> Chinese: [Chinese](../../zh-CN/exec-plans/completed/2026-09-06-technical-test-documentation.md)

Status: Completed local documentation delivery (2026-09-06); user-confirmed scope.
Historical status: implemented documentation consolidation; no product runtime changes.
Residual ownership: product, target-environment and release verification remain with their existing gates; this plan does not close that work.

## Goal and Scope

Maintain one documentation system with two entry points: `docs/design-docs/full-stack-architecture.md` for engineering handover and `docs/design-docs/testing-strategy.md` for test design and execution planning. Cover the implemented product, including parameter management, logs, debugging, and shared capabilities. Reuse domain/API/security/runbook owners rather than creating parallel manuals. Preserve historical decisions and generated coverage records. Maintain equivalent new content in separate English and Chinese files.

Source baseline: `67d4a77325b6009b77c2373bd788298a6d022bcf`; clean worktree before this change. Source inspection establishes implementation presence, not passing tests, live GitHub state, target readiness, or release authorization.

## Tasks and Success Criteria

- [x] Inspect runtime composition, business seams, test sources, and existing documentation.
- [x] Consolidate the technical entry: ownership, code map, workflows, data, failure handling, and maintenance impact.
- [x] Consolidate test design: risks, fixtures, traceability, executable core/negative cases, automation pointers, cleanup, and outcome rules.
- [x] Correct verified stale descriptions and route indexes to the existing authoritative pages.
- [x] Verify bilingual additions, referenced files and anchors, `npm run docs:check`, and `git diff --check`; archive this plan with observed results.

## Git & PR Workflow

This documentation-only task uses `codex/docs-technical-test-design` from the user-provided detached baseline in this worktree. There is no implementation subagent or runtime change. Stop after locally reviewable documentation and checks. No commit, push, PR, merge, production mutation, test-code changes, full product suite, or target-environment execution is part of this task.

## Documentation Impact Matrix

English paths below include their existing `docs/zh-CN/` companion.

| Area | Disposition | Paths and evidence required |
| --- | --- | --- |
| Repository maps | Update | `docs/README.md`, `docs/design-docs/index.md`: two reading paths and content ownership. Review `ARCHITECTURE.md` for current Catalog composition. |
| Planning | Update | This plan and `docs/PLANS.md`; retain unrelated active plans. |
| Product | Review | `docs/product-specs/index.md`, `src/appConfig.ts`: scope and route coverage; no product behavior change. |
| Architecture | Update | `docs/design-docs/full-stack-architecture.md`; review `docs/design-docs/domain-model.md`, `docs/design-docs/api-contract.md`, `server/app.ts`, domain services. |
| Quality/testing | Update | `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md`; review `docs/developer/verification-matrix.md` and acceptance specs for executable mappings. |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/manual-acceptance.md`, `docs/runbooks/README.md`: reuse detailed procedures; correct stale routes only if directly verified. |
| Security/governance | Review | `docs/SECURITY.md`, `docs/security/user-permission-design.md`, trusted-invocation implementation: link existing rules; no new authorization policy. |
| Frontend/design | Review | `docs/FRONTEND.md`, `src/app/routes.tsx`: code pointers only; no visible product changes or browser verification obligation. |
| Generated artifacts | No change | `docs/generated/db-schema.md`, `docs/developer/user-operation-coverage-matrix.md`, `e2e/acceptance/operationMatrix.ts`: reference without hand-editing or inventing coverage. |
| References | Review | Existing API transition, kernel boundary, ADR and historical plan references; distinguish normative targets from observed implementation. |

## Documentation Update Gate

Completion requires every Update/Review row resolved, English/Chinese links and new content aligned, all local references checked, and both documentation-only gates passing. Test designs and source-inspected test files are explicitly not fresh execution evidence. No deferred implementation is introduced by this documentation task.

## Verification

- `npm ci --ignore-scripts`: installed locked dependencies for local documentation tools. The initial check could not start because `tsx` was absent; it was rerun after installation.
- `npm run docs:check`: exit 0; documentation governance passed. The database-schema subcheck skipped because pgvector is unavailable locally; generated schema was not verified against migrations.
- `git diff --check`: passed.
- Final local paths, anchors, and incoming-anchor check for 24 changed Markdown files: 447 links, zero errors, including navigation and archived-plan links. No non-document tracked files changed.
- English/Chinese design cases: 20 each, matching ordered IDs; each contains preparation, steps, expectations and cleanup.
- No product tests, browser runs or target drills executed; no commit, push or PR.

## Documentation Impact Disposition

- Maps, full-stack architecture, testing strategy, quality dashboard and plan indexes updated. The two existing entries retain technical/test ownership; no parallel handbook was added.
- API, domain and security Review rows were corrected for actual composition, project scope and trusted-context construction. No authorization policy changed and no TD-068/Catalog program closure was asserted.
- Manual acceptance received only the test-design link, current members route and discovery-scope correction; it remains the ordinary workflow owner. A–H and target procedures were not copied into another manual.
- Product index, runbook index, reliability, permission design and frontend conventions were read and retained unchanged. `src/appConfig.ts`, `src/domain/workflowDiscovery.ts` and `server/app.ts` establish current entry points. No product requirement or operational procedure is changed by this task.
- Generated schema, operation matrix and machine-readable coverage source remain unchanged. Design IDs do not claim automated coverage. Topology rounds 4–6 remain historical content; duplicate command inventories now refer to the verification matrix.
- Historical ADRs, contracts and unrelated plans remain. All new or changed technical/test/status content has its independent English/Chinese companion and checked links.

## Format and Depth Revision — 2026-09-06

The user superseded the Word delivery direction and requested a maintained Markdown compendium with substantially more detail and editable diagrams. The user also requested a strictly monochrome Excel test-case workbook.

The existing English/Chinese full-stack architecture pages now contain 13 integrated chapters and 22 Mermaid diagrams per edition: context/runtime/module architecture, real interface excerpts, conceptual ER relationships, source-to-writeback flow, workflow sequences, state machines, deployment and recovery. Prose expands revision identity, typed values, transaction/external-effect boundaries, concurrency, idempotency, authorization, leases, durable approvals, observations and recovery. The same pages remain authoritative; no competing Markdown handbook was added. Earlier Word output is a historical artifact and is no longer the maintained technical format.

The existing Excel workbook retains its 79 cases, 20 design IDs, four sheets, formulas, filters, frozen panes and execution dropdown. All applied cell colors are black, white or gray. Colored conditional formatting and row banding were removed. All cases remain unexecuted; no result was manufactured.

Revision verification:

- Mermaid 11.15.0 rendered all 44 English/Chinese diagrams in headless Chromium. All 22 Chinese figures were visually reviewed; three wide flows were changed to vertical layout and one English sequence syntax error was fixed.
- Read-only XLSX inspection matched all 79 case rows to the original case data, preserved 237 lookup formulas, five filtered tables, the status dropdown and frozen panes. The summary remains 79 unexecuted with zero passes/failures; no formula errors or conditional-format rules remain.
- Local reference validation checked 379 links across the 24 changed Markdown files with zero errors; both editions have matching diagram types and chapter counts.
- `npm run docs:check`: exit 0, documentation governance passed; the database-schema subcheck still skipped because pgvector is unavailable locally.
- `git diff --check`: passed. Browser use here rendered documentation diagrams only; no product UI acceptance, product tests or target drills were performed. At the time of this revision, commit/push/PR delivery had not yet been performed; a later explicit user request authorizes the delivery PR.

These results supersede the earlier link-count snapshot for the revised files. The earlier consolidation history remains below/above as a record of its own stage.
