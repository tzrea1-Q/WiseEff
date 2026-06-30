# WiseEff Xiaoze Thread Persistence — Implementation Plan

**Status:** Completed 2026-06-30.

**Goal:** Persist Xiaoze chat threads and messages in Postgres with a dedicated REST API so history is cross-device, auditable, and long-lived; replace browser-only `localStorage` as the source of truth in API runtime mode.

**Architecture:** Reuse M4 `agent_sessions` / `agent_messages` with `page_key = 'xiaoze'` and `threadId = session.id`. Add `threadRepository`, REST routes under `/api/v1/agent/xiaoze/threads`, and a persistence hook in `agUiEndpoint` after each successful run. Frontend adds `xiaozeThreadsClient` and rewires `XiaozeThreadContext` for API mode while keeping localStorage for mock mode.

**Tech Stack:** TypeScript, Postgres migrations, Zod, existing audit helper, React/Vite, Vitest, Playwright.

---

## Task 1: Migration and Repository

- [x] Add partial index on `agent_sessions` for Xiaoze list queries.
- [x] Implement `listXiaozeThreads`, `getXiaozeThread`, `upsertXiaozeSessionOnTurn`, `archiveXiaozeThread`, `appendXiaozeMessagesIdempotent`.
- [x] `npm run test:server -- threadRepository` — PASS.

## Task 2: REST Routes

- [x] Zod schemas + route tests (401, 404 wrong owner, list, patch title, soft delete).
- [x] Register routes in `registerXiaozeRoutes`.
- [x] `npm run test:server -- threadRoutes` — PASS.

## Task 3: AG-UI Persistence Hook

- [x] `persistXiaozeTurn` with audit events; invoke after successful AG-UI run/resume.
- [x] `npm run test:server -- threadPersistence agUiEndpoint` — PASS.

## Task 4: Frontend API Client and Context

- [x] `xiaozeThreadsClient.ts` + tests.
- [x] `XiaozeThreadContext.tsx` API mode; mock mode unchanged on localStorage.
- [x] `npm test -- xiaozeThreadsClient` — PASS.

## Task 5: Contract, Docs, Verification

- [x] API contract docs updated (EN + zh-CN).
- [x] OpenAPI artifact via route manifest / `contract:check`.
- [x] TD-030 closed in `tech-debt-tracker.md`.

## Verification Evidence

```bash
npm run test:server -- threadRepository threadRoutes threadPersistence
npm test -- xiaozeThreadsClient
```

## Expected Outcomes (met)

- Authenticated users list and reopen Xiaoze threads from any browser after login (API mode).
- Each completed chat turn is stored in `agent_messages` with audit events.
- User delete hides thread from list (`archived`) without physical purge.
- Mock mode demos continue to work offline with localStorage.
