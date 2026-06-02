# M5.12 Staging Synthetic CI Evidence Archiving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run deterministic WiseEff acceptance gates in CI and target synthetic environments, then archive browser and quality evidence as reviewable artifacts.

**Architecture:** Keep Playwright as the deterministic browser engine and reuse the existing `acceptance:browser`, `acceptance:models`, and M5.11 quality gates. Add a workflow metadata checker so CI cannot silently drop PostgreSQL, synthetic modes, or artifact archiving, and document which gates run on PRs, manual target runs, and full-pilot external runs.

**Tech Stack:** GitHub Actions, Playwright Test, TypeScript, Vitest, PostgreSQL service containers, WiseEff acceptance evidence generators.

---

## Scope

M5.12 covers CI and synthetic evidence wiring only:

- PR/push CI runs a local non-HDC acceptance suite backed by a PostgreSQL service.
- Manual or scheduled target synthetic runs can probe an already-running target environment with `--mode target-non-hdc --no-start-runtime`.
- Full-pilot remains an explicit manual workflow input that requires HDC and external dependencies; it must not become a default PR gate or be faked as passing.
- CI uploads Playwright reports, traces, screenshots, generated browser evidence, generated operation evidence, and quality-gate artifacts.

M5.12 does not add new product UI behavior, AI exploratory QA, new HDC automation, or production infrastructure provisioning.

## Files

- Create: `scripts/check-acceptance-ci.ts`
- Create: `scripts/check-acceptance-ci.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Modify after verification: `docs/exec-plans/completed/README.md`

## Task 1: CI Metadata Gate

- [x] Write `scripts/check-acceptance-ci.test.ts` before implementation.
- [x] Require a dedicated acceptance CI job in `.github/workflows/ci.yml`.
- [x] Require a PostgreSQL service for local non-HDC CI acceptance.
- [x] Require Playwright browser installation before acceptance browser/quality gates.
- [x] Require PR/push local non-HDC browser acceptance.
- [x] Require manual target non-HDC synthetic acceptance with `--no-start-runtime`.
- [x] Require manual full-pilot mode to stay non-default and externally gated.
- [x] Require upload artifacts for Playwright acceptance report/results, operation evidence, browser evidence, and quality artifacts.
- [x] Run `npm test -- scripts/check-acceptance-ci.test.ts` and confirm the test fails before implementation.

## Task 2: Implement Acceptance CI Checker

- [x] Implement `scripts/check-acceptance-ci.ts` with pure string/regex checks against the workflow text and package scripts.
- [x] Add `acceptance:ci` to `package.json`.
- [x] Run `npm test -- scripts/check-acceptance-ci.test.ts`.
- [x] Run `npm run acceptance:ci`.

## Task 3: GitHub Actions Acceptance Jobs

- [x] Update `.github/workflows/ci.yml` with `workflow_dispatch` inputs for `acceptance_mode`.
- [x] Add an `acceptance-local-non-hdc` job for PR/push and default manual runs.
- [x] Add a `target-synthetic-acceptance` job for manual `target-non-hdc` and `full-pilot` runs.
- [x] Configure the local job with a PostgreSQL service and local deterministic environment variables.
- [x] Install Chromium with `npx playwright install --with-deps chromium`.
- [x] Run `npm run acceptance:ci`, `npm run acceptance:models`, `npm run acceptance:quality`, `npm run acceptance:a11y`, `npm run acceptance:visual`, `npm run acceptance:responsive`, and `npm run acceptance:browser -- --mode local-non-hdc`.
- [x] Upload acceptance and quality artifacts even when a gate fails.
- [x] Keep full-pilot gated behind explicit manual workflow input and target secrets.

## Task 4: Documentation Updates

- [x] Update verification matrix with `npm run acceptance:ci` and CI/synthetic modes.
- [x] Update testing strategy with M5.12 CI artifact archiving and target synthetic rules.
- [x] Update manual acceptance guide with where CI artifacts appear and how full-pilot remains external-gated.
- [x] Update quality score docs with M5.12 evidence archiving.
- [x] Update roadmap M5.12 completion details.

## Task 5: Verification And Completion

- [x] Run `npm test -- scripts/check-acceptance-ci.test.ts`.
- [x] Run `npm run acceptance:ci`.
- [x] Run `npm run docs:check`.
- [x] Run `git diff --check`.
- [x] Run broader build/test gates appropriate to package and workflow changes.
- [x] Move this plan to `docs/exec-plans/completed/` and update completed plan index.
- [ ] Commit, push, and create a PR.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | No map change expected; CI commands remain discoverable through verification docs. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan, `docs/exec-plans/completed/README.md` | Add M5.12 completion gate and archive this plan after verification. |
| Product specs | No change | `docs/product-specs/` | No product workflow behavior changes. |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | CI wiring reuses existing runtime architecture. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add acceptance CI, artifacts, and synthetic mode guidance. |
| Reliability/runbooks | Update | `docs/runbooks/manual-acceptance.md` | Explain CI artifact review and target/full-pilot synthetic runs. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/` | Secrets remain GitHub Actions secrets; no permission model change. |
| Frontend/design docs | No change | `docs/FRONTEND.md`, `docs/DESIGN.md` | No UI behavior or design-system change. |
| Generated artifacts | Review | `docs/generated/acceptance-*`, `test-results/`, `playwright-report/` | Generated evidence is archived by CI, not committed as fresh local output. |
| References | No change | `docs/references/` | No compact reference change needed. |
| Chinese developer docs | Review | `docs/zh-CN/` | Existing manual acceptance Chinese page should remain valid; update only if the English runbook gains developer-critical new steps not elsewhere covered. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Every `Update` row must be updated in this branch.
- Every `Review` row must be either unchanged with evidence or updated if implementation changes expose durable behavior.
- Deferred documentation work must be added to `docs/exec-plans/tech-debt-tracker.md`.

## UI Interaction Automation Review

M5.12 changes CI and evidence archiving only. It does not change user-facing interaction behavior.

- Affected acceptance specs: existing `e2e/acceptance/*.acceptance.spec.ts` are run in CI; no product spec behavior changes.
- Acceptance requirement IDs: existing IDs in `docs/developer/browser-acceptance-coverage-map.md` continue to apply.
- Operation IDs: existing IDs in `docs/developer/user-operation-coverage-matrix.md` continue to apply.
- Evidence: `npm run acceptance:browser` and `npm run acceptance:evidence` outputs are now archived as CI artifacts.

If CI wiring exposes a product UI failure that requires a code fix, that fix must update the relevant acceptance requirement, operation row, and browser evidence before this plan is completed.
