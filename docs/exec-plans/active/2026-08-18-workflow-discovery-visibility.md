# Workflow Discovery Visibility

> Chinese: [`docs/zh-CN/exec-plans/active/2026-08-18-workflow-discovery-visibility.md`](../../zh-CN/exec-plans/active/2026-08-18-workflow-discovery-visibility.md)

> **For agentic workers:** Implement task-by-task using checkbox (`- [ ]`) tracking.
> Prefer Matt skills `implement` and `tdd` where applicable. Follow `docs/PLANS.md` Git Branch & PR Workflow
> (implementation commits on the feature branch; parent opens/merges the PR).

- Date: 2026-08-18
- Status: **Active**
- Branch: `cursor/workflow-discovery-visibility-b895`
- Decision record: grill-with-docs 2026-08-18; [ADR-0036](../../adr/0036-workflow-discovery-uses-a-visible-workflow-allowlist.md)

## ask-matt routing

Grill-with-docs settled the design in one session. This is not a foggy multi-session map (`/wayfinder`). It is wide (several discovery surfaces + test churn) but not multi-session, so the path is **to-spec (this plan) → implement here**. This repository tracks implementation in `docs/exec-plans/active/`, not GitHub to-tickets.

## Goal

Hide unfinished workflows from product discovery surfaces via a visible-workflow allowlist, without retiring routes or shutting APIs.

First allowlist: `parameter-management`, `debugging`. Log analysis and the knowledge base stay off discovery and stay deep-linkable.

## Seam

One public module: workflow discovery visibility (`WorkflowId`, `VISIBLE_WORKFLOWS`, `isWorkflowVisible`, `isDiscoveryGroupVisible`, homepage offer copy). Sidebar and homepage consume that seam. Do not scatter allowlist literals.

## Git & PR Workflow

| Role | Allowed |
| --- | --- |
| Implementation | Commit on `cursor/workflow-discovery-visibility-b895` |
| Implementation | Must not push `main` or merge |
| Parent / cloud session | Review, update the GitHub PR, merge when approved |

## Tasks

- [x] ADR-0036 + glossary terms
- [x] Domain module + tests for the allowlist and homepage offer copy
- [x] Filter sidebar groups through the seam
- [x] Filter homepage cards, flow tabs, header/footer links, and promotional copy
- [x] Update discovery-surface unit tests to assert the allowlisted set
- [x] Keep page catalog and deep-link routes (including `/logs`, `/knowledge`)
- [x] Docs: FRONTEND, product spec, coverage map `SHELL-DISCOVERY-001`
- [x] Targeted tests, `npm run build`, `npm run docs:check`, playwright-cli on `/` at 1440 / 768 / 390

## Testing Decisions

- Test the discovery module through its public functions with literal expected copy.
- Test App sidebar and homepage as users see them (log analysis and knowledge absent).
- Do not change page tests that open `/logs` or `/knowledge` by URL.
- In-page CTAs on those pages (for example 进入智能分析) stay; they are not discovery surfaces.

## Out of Scope

- API or permission changes
- Xiaoze tool hiding
- Courtesy-hiding related-knowledge / distil CTAs
- Per-environment overrides
- `NoEntryPage` for hidden workflows

## Documentation Impact Matrix

| Document / area | Impact | Action |
| --- | --- | --- |
| `CONTEXT.md` | Glossary | **Update** — Workflow, discovery visibility, visible workflow, discovery surface, ADR-0036 |
| `docs/adr/0036-…` / `docs/adr/README.md` | Decision | **Update** |
| `docs/PLANS.md` / zh | Active list | **Update** |
| This plan + zh companion | Spec | **Update** |
| `docs/FRONTEND.md` / `docs/zh-CN/frontend.md` | Sidebar / homepage | **Update** |
| `docs/product-specs/product-spec.md` / zh | Four workflows vs discovery | **Update** |
| `docs/developer/browser-acceptance-coverage-map.md` / zh | New ID | **Update** — `SHELL-DISCOVERY-001` |
| `e2e/acceptance/requirements.ts`, `operationMatrix.ts` | Coverage registration | **Update** |
| `docs/developer/user-operation-coverage-matrix.md` / zh | Generated / companion | **Update** |
| Architecture / API / security / runbooks | Unrelated | **No change** |
| `docs/product-specs/prototype-functional-spec.md` | Review | **Review** — nav lists if they claim logs/knowledge are always in the sidebar |

## Documentation Update Gate

- [x] Every Update/Review row updated or recorded unchanged
- [x] `npm run docs:check` passes
- [x] `SHELL-DISCOVERY-001` registered

## UI Interaction Automation

| ID | Role |
| --- | --- |
| `SHELL-DISCOVERY-001` | Sidebar and homepage offer only allowlisted workflows; deep links to hidden workflows still load |
| `SHELL-DIAG-001` | Unchanged; `/logs` remains a deep-link shell route |

No new Playwright acceptance spec in this slice. Coverage is unit tests plus playwright-cli evidence under `work/ui-checks/workflow-discovery/`.
