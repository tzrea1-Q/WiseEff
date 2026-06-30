# WiseEff Dead Code & Legacy Cleanup Plan

**Status:** Completed 2026-06-30.

**Goal:** Remove confirmed dead M4/M5 Agent code, fix broken acceptance mappings, and align product/docs with Xiaoze-only runtime.

**Branch:** `chore/dead-code-cleanup`

---

## Phase 1 — Low-risk fixes

- [x] Fix `scripts/run-browser-acceptance.ts` workflow G → `xiaoze-*.acceptance.spec.ts`
- [x] Update `scripts/run-browser-acceptance.test.ts` fixtures
- [x] `playwright.config.ts`: ignore `acceptance/**` in default `test:e2e`
- [x] `git rm --cached work/ui-checks/*.png` (97 tracked artifacts)

## Phase 2 — Delete confirmed dead code

- [x] Delete `server/modules/agent/providerEvidence.ts` + test
- [x] Delete `server/modules/agent/schemas.ts` + test
- [x] Remove `createAgentRunTrace` from `repository.ts` + test case
- [x] Delete `src/infrastructure/device/hdcGateway.ts` + test

## Phase 3 — Product consistency

- [x] Replace `createAgentPlan` with `getXiaozeContextSummary(path)`
- [x] WiseAgent strings → 小泽; LogAdmin handoff opens Xiaoze in API mode
- [x] Remove disabled utility item「Agent 能力」

## Phase 4 — Config & dependencies

- [x] Remove `MOCK_RUNTIME_ENABLED`
- [x] Remove unused deps: `shadcn`, `@langchain/core`, `ioredis`

## Phase 5 — Documentation & debt

- [x] Update README, docs/README, api/examples, monitoring-alerting, m5 runbook
- [x] Update zh-CN backend-runtime, deployment-operations, monitoring-alerting
- [x] Close TD-030; align TD-018/022; move thread-persistence plan to completed

## Verification

```bash
npm run docs:check          # pass
npm run test:server -- repository env threadRepository  # pass
npm test -- appConfig LogAdminPage run-browser-acceptance  # pass
npx tsc -b                  # pass
```
