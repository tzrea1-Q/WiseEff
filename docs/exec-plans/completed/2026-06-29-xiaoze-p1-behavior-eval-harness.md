# Xiaoze P1 — Behavior Eval & Golden Gate (TD-009 / TD-017)

> **Status:** Completed 2026-06-29 on branch `feature/xiaoze-p1-behavior-eval-harness`.
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or superpowers:subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Branch & PR:** Work on a feature branch from `main` only. Do NOT open or merge a GitHub PR; the parent agent reviews and merges. See `docs/PLANS.md` § Git Branch & PR Workflow.

**Goal:** Turn Xiaoze's safety/grounding promises — which today live only in the system prompt plus streaming heuristics — into **measurable, regression-gated** behavior. Build an offline eval harness (golden tests) over the planning graph using the deterministic/fake model seam, asserting: correct intent→tool routing, FORBIDDEN refusal, no hallucinated writes (no "已提交/已写入" without an approved mutating tool), grounding (citations present when tool data is used), and approval-gating of mutating tools. Add a versioned, traceable system prompt. This addresses **TD-009** (AI behavior not exercised/validated) and **TD-017** follow-up (broader eval coverage).

---

## Task 1: Prompt versioning module

- [x] **Step 1:** Create `xiaozePrompt.ts` exporting the exact current prompt text as `XIAOZE_SYSTEM_PROMPT` and `XIAOZE_PROMPT_VERSION = "2026-06-29.1"`.
- [x] **Step 2:** Replace the inline `SYSTEM_PROMPT` in `planningGraph.ts` with the import (verify no whitespace/behavior drift).
- [x] **Step 3:** Add `promptVersion` to the `promptDebug` snapshot; update `promptDebug` tests.
- [x] **Step 4:** Run `npm run test:server -- planningGraph promptDebug` — Expected: PASS.

## Task 2: Expectation evaluators

- [x] **Step 1:** Write failing unit tests for each evaluator (routing match, forbidden-substring detector, hallucinated-write detector, citation presence, approval-gate).
- [x] **Step 2:** Implement evaluators as pure functions over a normalized run result.
- [x] **Step 3:** Run `npm run test:server -- expectations` — Expected: PASS.

## Task 3: Scenario runner

- [x] **Step 1:** Implement the runner with injected fakes.
- [x] **Step 2:** Author scenarios from the categories (9 graph scenarios + 1 meta negative check).
- [x] **Step 3:** `runEval.test.ts` runs all scenarios and asserts zero unmet expectations.
- [x] **Step 4:** Run `npm run test:server -- runEval` — Expected: PASS.

## Task 4: CLI report + gate wiring

- [x] **Step 1:** Implement CLI; writes `docs/generated/xiaoze-eval.json` + `.md`.
- [x] **Step 2:** Add `xiaoze:eval` script; Vitest gate included in `test:server` via `runEval.test.ts`.
- [x] **Step 3:** Run `npm run xiaoze:eval` and `npm run test:server`; commit the generated report.

## Task 5: Docs + gates

- [x] **Step 1:** Update docs per the matrix; run `npm run docs:check`.
- [x] **Step 2:** Update `docs/exec-plans/tech-debt-tracker.md` (TD-009 progress) and move this plan to `completed/`.

## Documentation Update Gate

- [x] All `Update` rows applied or recorded unchanged with evidence.
- [x] `npm run docs:check` passes.
- [x] `npm run xiaoze:eval` passes and report is committed.
- [x] Plan moved to `docs/exec-plans/completed/` after verification.

## Verification Commands (executed)

```bash
npm run test:server -- xiaozePrompt expectations runEval planningGraph promptDebug  # 25 passed
npm run xiaoze:eval                                                                 # 9/9 scenarios + 1 meta PASS
npm run test:server                                                                 # 866 passed
npm run docs:check
```

## Outcomes

- Offline golden gate at `server/modules/agent/xiaoze/eval/`; prompt version `2026-06-29.1`.
- Reports: `docs/generated/xiaoze-eval.{json,md}`.
- TD-009: Xiaoze offline eval done; live-model eval for non-deterministic providers remains open.
