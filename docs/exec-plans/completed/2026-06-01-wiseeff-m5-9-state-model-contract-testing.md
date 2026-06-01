# M5.9 State Model & Contract-Driven Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic `acceptance:models` gate that uses property/state-model testing to catch workflow drift behind WiseEff browser acceptance flows.

**Architecture:** M5.9 adds an in-memory, API/domain-layer model runner under `scripts/` rather than expanding Playwright UI scripts. The runner uses `fast-check` with fixed seeds and command sequences for parameter review, log analysis, debugging, and permissions; each model records invariant failures with reproducible seed/path/steps.

**Tech Stack:** TypeScript, Vitest, `tsx`, `fast-check`, existing WiseEff role and permission domain helpers.

---

## Scope

M5.9 covers non-AI deterministic state and contract checks:

- Parameter approval states: draft, submitted, hardware review, software review, software merge, rejected, merged.
- Log task states: uploaded, analyzing, complete, failed, feedback, archived, reanalysis.
- Debugging states: detected, read, write, mismatch, rollback.
- Permission states: role changes, visible routes, API eligibility.
- Invariants:
  - Unauthorized roles cannot write.
  - Terminal parameter requests cannot be merged or rejected again.
  - Rollback must require a valid snapshot.
  - Every production write emits audit evidence.
  - UI-visible permissions cannot be stronger than API eligibility.

M5.9 does not add AI exploratory QA, new browser flows, real staging synthetic jobs, or accessibility/visual checks. Those remain M5.11 and M5.12.

## Files

- Create: `scripts/check-acceptance-state-models.test.ts`
- Create: `scripts/check-acceptance-state-models.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `docs/developer/verification-matrix.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/runbooks/manual-acceptance.md`
- Modify: `docs/zh-CN/manual-acceptance.md`
- Modify: `docs/exec-plans/active/development-roadmap.md`
- Move after verification: `docs/exec-plans/active/2026-06-01-wiseeff-m5-9-state-model-contract-testing.md` to `docs/exec-plans/completed/2026-06-01-wiseeff-m5-9-state-model-contract-testing.md`

## Task 1: Red Tests For State Models

- [x] Write `scripts/check-acceptance-state-models.test.ts` before implementation.
- [x] Assert `evaluateAcceptanceStateModels()` returns passed summaries for the default deterministic seeds.
- [x] Assert parameter terminal states reject duplicate terminal transitions and preserve audit requirements.
- [x] Assert log tasks reject archive before terminal completion and require audit for feedback/archive/reanalysis writes.
- [x] Assert debugging rejects write for non-writers and rollback without a valid snapshot.
- [x] Assert permissions keep UI route visibility within API eligibility.
- [x] Assert formatted failures include model name, seed, path, and reproduction steps.
- [x] Run `npm test -- scripts/check-acceptance-state-models.test.ts` and confirm it fails because the model runner is not implemented.

## Task 2: Install And Wire The Model Runner

- [x] Install `fast-check` as a dev dependency.
- [x] Add `"acceptance:models": "tsx scripts/check-acceptance-state-models.ts"` to `package.json`.
- [x] Implement `scripts/check-acceptance-state-models.ts` exports:
  - `acceptanceStateModelDefinitions`
  - `evaluateAcceptanceStateModels`
  - `runAcceptanceStateModels`
  - `formatStateModelFailure`
  - individual reducer helpers for parameter, log, debugging, and permission models
- [x] Use fixed default seeds and `numRuns` so CI and local runs are reproducible.
- [x] Make the CLI print JSON and exit nonzero on failure.

## Task 3: Green The Tests

- [x] Run `npm test -- scripts/check-acceptance-state-models.test.ts`.
- [x] Fix only the implementation needed to pass the test contract.
- [x] Run `npm run acceptance:models`.
- [x] Confirm failure output can identify a model, seed, path, and steps when an invariant fails.

## Task 4: Documentation Updates

- [x] Update `docs/developer/verification-matrix.md` with `npm run acceptance:models`.
- [x] Update `docs/design-docs/testing-strategy.md` to describe the M5.9 model/property layer.
- [x] Update `docs/QUALITY_SCORE.md` to include model-based state coverage and the new gate.
- [x] Update manual acceptance docs to explain that `acceptance:models` complements browser acceptance.
- [x] Update `docs/exec-plans/active/development-roadmap.md` so M5.9 has an explicit completion gate.

## Task 5: Verification And Completion

- [x] Run `npm test -- scripts/check-acceptance-state-models.test.ts`.
- [x] Run `npm run acceptance:models`.
- [x] Run `npm run docs:check`.
- [x] Run `npm run test:all`.
- [x] Run `npm run build`.
- [x] Run `git diff --check`.
- [x] Move this plan to `docs/exec-plans/completed/` only after the verification commands pass or any blocker is documented.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | No route or top-level repository map change expected. |
| Planning docs | Update | `docs/exec-plans/active/development-roadmap.md`, this plan | Add M5.9 gate and move plan to completed after verification. |
| Product specs | No change | `docs/product-specs/` | No product behavior change. |
| Architecture docs | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md` | No architecture boundary change; model runner is a quality gate. |
| Quality/testing docs | Update | `docs/developer/verification-matrix.md`, `docs/design-docs/testing-strategy.md`, `docs/QUALITY_SCORE.md` | Add state model gate and evidence expectations. |
| Reliability/runbooks | Update | `docs/runbooks/manual-acceptance.md` | Add model gate as pre-browser contract check. |
| Security/governance docs | Review | `docs/SECURITY.md`, `docs/security/` | Permission and audit invariants are tested; no new policy. |
| Frontend/design docs | Review | `docs/FRONTEND.md` | No UI interaction behavior changes. |
| Generated artifacts | No change | `docs/generated/` | M5.9 does not generate committed evidence. |
| References | Review | `docs/references/` | No compact agent reference update expected. |
| Chinese developer docs | Update | `docs/zh-CN/manual-acceptance.md` | Mention `acceptance:models` alongside browser acceptance. |

## Documentation Update Gate

- `npm run docs:check` must pass before this plan is moved to completed.
- Every `Update` row above must be changed in the same branch.
- Every `Review` row must either be unchanged because M5.9 only adds a quality gate, or be updated if implementation changes expose durable behavior.
- Any deferred documentation work must be added to `docs/exec-plans/tech-debt-tracker.md`.

## UI Interaction Automation Review

M5.9 does not change user-facing interaction behavior, frontend routes, forms, modals, uploads, approvals, navigation, API responses consumed by visible UI, Agent actions, or device actions. Existing browser acceptance requirement IDs and operation IDs remain unchanged. The affected validation layer is complementary to:

- Specs: `e2e/acceptance/*.acceptance.spec.ts`
- Requirement map: `docs/developer/browser-acceptance-coverage-map.md`
- Operation matrix: `docs/developer/user-operation-coverage-matrix.md`
- Evidence gate: `npm run acceptance:evidence`

No new `@acceptance` or `@operation` marker is required for M5.9 unless implementation scope expands into UI behavior.
