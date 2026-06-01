# M5.11 Accessibility / Visual / Responsive Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic non-AI browser quality gates for accessibility, visual stability, and responsive usability.

**Architecture:** Keep Playwright as the main browser automation engine. Add focused M5.11 Playwright configs/specs for a11y, visual, and responsive checks so they can run independently from the heavier acceptance workflow and still reuse the same API-mode runtime conventions.

**Tech Stack:** Playwright Test, `@axe-core/playwright`, TypeScript, Vite API-mode runtime.

---

## Scope

M5.11 covers quality gates that catch “feature works, but the user cannot comfortably use it” failures:

- Accessibility scans for core pages and key interactive states.
- Visual regression snapshots for stable shell/page regions.
- Responsive viewport checks for desktop, tablet, and mobile widths.

M5.11 does not introduce AI exploratory QA, staging synthetic jobs, CI artifact upload, or new product behavior. M5.12 owns staging/CI evidence archiving.

## Files

- Create: `playwright.quality.config.ts`
- Create: `e2e/quality/a11y.quality.spec.ts`
- Create: `e2e/quality/visual.quality.spec.ts`
- Create: `e2e/quality/responsive.quality.spec.ts`
- Create: `scripts/check-quality-gates.ts`
- Create: `scripts/check-quality-gates.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify after verification: `docs/exec-plans/completed/README.md`

## Task 1: Plan And Gate Metadata Tests

- [x] Add this active plan with the required Documentation Impact Matrix and Documentation Update Gate.
- [x] Write `scripts/check-quality-gates.test.ts` before implementation.
- [x] Test that `evaluateQualityGateConfiguration()` fails when required scripts are missing.
- [x] Test that the required scripts are `acceptance:a11y`, `acceptance:visual`, and `acceptance:responsive`.
- [x] Test that the checker requires a11y, visual, and responsive spec files.
- [x] Run `npm test -- scripts/check-quality-gates.test.ts` and confirm it fails before the checker exists.

## Task 2: Quality Gate Runner And Scripts

- [x] Install `@axe-core/playwright` as a dev dependency.
- [x] Add package scripts:
  - `acceptance:a11y`
  - `acceptance:visual`
  - `acceptance:responsive`
  - `acceptance:quality`
- [x] Implement `scripts/check-quality-gates.ts` as a metadata gate that validates package scripts and quality spec files.
- [x] Run `npm test -- scripts/check-quality-gates.test.ts`.
- [x] Run `npm run acceptance:quality`.

## Task 3: Accessibility Gate

- [x] Create `e2e/quality/a11y.quality.spec.ts`.
- [x] Scan core routes: `/parameters`, `/parameter-review`, `/parameter-admin`, `/logs`, `/debugging`, `/user-permissions`.
- [x] Scan key interaction states: parameter detail dialog, log upload dialog, debugging node sheet, user add dialog, and Agent panel.
- [x] Use `AxeBuilder` with WCAG A/AA tags.
- [x] Fail on violations and attach the violation summary for review.
- [x] Run `npm run acceptance:a11y`.

## Task 4: Visual Gate

- [x] Create `e2e/quality/visual.quality.spec.ts`.
- [x] Use Playwright `toHaveScreenshot()` for stable regions only.
- [x] Cover shell/home, parameters table, logs workbench, debugging simulator, user permissions, and Agent panel.
- [x] Mask dynamic regions such as timestamps, counters, IDs, and live status text where needed.
- [x] Run `npm run acceptance:visual -- --update-snapshots` once to create snapshots, then run `npm run acceptance:visual`.

## Task 5: Responsive Gate

- [x] Create `e2e/quality/responsive.quality.spec.ts`.
- [x] Establish viewport matrix:
  - desktop: `1440x900`
  - tablet: `834x1112`
  - mobile: `390x844`
- [x] Cover core routes and assert no horizontal document overflow.
- [x] Assert primary headings, main content, action controls, and dialogs remain visible and usable.
- [x] Run `npm run acceptance:responsive`.

## Task 6: Documentation And Completion

- [x] Update verification and testing docs with the new quality scripts.
- [x] Update manual acceptance docs to explain when to run a11y/visual/responsive gates.
- [x] Update roadmap M5.11 completion gate.
- [x] Run final verification.
- [x] Move this plan to `docs/exec-plans/completed/` and update completed plan index.
- [ ] Commit, push, and open a PR stacked on the current M5.9 PR branch.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | No top-level map change expected. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/completed/README.md` | Add M5.11 gate and archive plan after verification. |
| Product specs | No change | `docs/product-specs/` | No product workflow behavior changes. |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | Quality gates reuse existing frontend/API runtime architecture. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add a11y/visual/responsive gate definitions. |
| Reliability/runbooks | Update | `docs/runbooks/manual-acceptance.md` | Add quality gates to manual acceptance automation list. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/` | No authz/security policy change. |
| Frontend/design docs | Review | `docs/FRONTEND.md`, `docs/DESIGN.md` | No stable selector or design-system policy change expected. |
| Generated artifacts | Review | Playwright snapshots under `e2e/quality/*-snapshots/` | Visual snapshots are committed only for stable masked regions. |
| References | No change | `docs/references/` | No compact LLM reference change. |
| Chinese developer docs | Update | `docs/zh-CN/manual-acceptance.md` | Add Chinese note for quality gates. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Every `Update` row must be updated in this branch.
- Every `Review` row must be either unchanged with evidence or updated if implementation changes expose durable behavior.
- Deferred documentation work must be added to `docs/exec-plans/tech-debt-tracker.md`.

## UI Interaction Automation Review

M5.11 adds browser quality automation but does not change product interaction behavior. It supplements existing acceptance coverage:

- Specs affected: new `e2e/quality/*.quality.spec.ts` only.
- Existing acceptance specs remain unchanged: `e2e/acceptance/*.acceptance.spec.ts`.
- Requirement IDs: no new product requirement IDs needed.
- Operation IDs: no new operation IDs needed.
- Evidence: this phase does not change operation evidence; `npm run acceptance:evidence` remains owned by M5.10.

If an M5.11 test exposes and fixes a UI behavior bug, that fix must add or update the relevant acceptance requirement and operation coverage before completion.
