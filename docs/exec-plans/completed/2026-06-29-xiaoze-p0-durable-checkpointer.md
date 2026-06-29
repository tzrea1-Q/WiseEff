# Xiaoze P0 — Durable Postgres Checkpointer (TD-029)

> **Status:** Completed 2026-06-29. Evidence: `docs/generated/xiaoze-checkpointer-evidence.md`.

**Goal:** Replace the process-local LangGraph `MemorySaver` with a durable, Postgres-backed checkpointer so Xiaoze multi-step plans and HITL (interrupt/approve→resume) state survive API restarts and work across multiple API replicas. This closes **TD-029**.

## Task 1: Dependency + Postgres saver module

- [x] **Step 1:** Installed `@langchain/langgraph-checkpoint-postgres@^1.0.4`.
- [x] **Step 2:** Failing tests for factory + idempotent `ensureSetup()`.
- [x] **Step 3:** Implemented `durableCheckpointer.ts`.
- [x] **Step 4:** `npm run test:server -- durableCheckpointer` — PASS.

## Task 2: Checkpointer factory mode selection

- [x] **Step 1:** Tests for default memory, injected saver, env resolution.
- [x] **Step 2:** Options-based `createXiaozeCheckpointer` + `resolveXiaozeCheckpointerFromEnv`.
- [x] **Step 3:** `npm run test:server -- checkpointer` — PASS.

## Task 3: Env + wiring

- [x] **Step 1:** `XIAOZE_CHECKPOINTER` + production guard in `env.ts`; env tests updated.
- [x] **Step 2:** Wired in `createXiaozeAgentFactory` / `registerXiaozeRoutes`.
- [x] **Step 3:** `agUiEndpoint` wiring tests added.
- [x] **Step 4:** `npm run test:server -- env agUiEndpoint` — PASS.

## Task 4: Setup-on-migrate

- [x] **Step 1:** `scripts/migrate.ts` calls `setupXiaozeCheckpointerTables` when mode is postgres.
- [x] **Step 2:** Local Postgres: `db:migrate` ensured tables; evidence in `docs/generated/xiaoze-checkpointer-evidence.md`.

## Task 5: Durability proof + docs + gates

- [x] **Step 1:** `durableCheckpointer.integration.test.ts` (gated on test DB URL).
- [x] **Step 2:** `npm run test:server` — 866 passed, 1 skipped; TypeScript check PASS (full `npm run build` blocked by unrelated untracked P1 `eval/` files in worktree).
- [x] **Step 3:** Documentation matrix applied; `npm run docs:check` — see below.
- [x] **Step 4:** TD-029 closed; plan moved to `docs/exec-plans/completed/`.

## Documentation Update Gate

- [x] All `Update` rows applied (see git diff + evidence file).
- [x] `npm run docs:check` passes.
- [x] TD-029 marked Closed with evidence.
- [x] Plan in `docs/exec-plans/completed/`.
