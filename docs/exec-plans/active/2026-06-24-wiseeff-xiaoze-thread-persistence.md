# WiseEff Xiaoze Thread Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Xiaoze chat threads and messages in Postgres with a dedicated REST API so history is cross-device, auditable, and long-lived; replace browser-only `localStorage` as the source of truth in API runtime mode.

**Architecture:** Reuse M4 `agent_sessions` / `agent_messages` with `page_key = 'xiaoze'` and `threadId = session.id`. Add `threadRepository`, REST routes under `/api/v1/agent/xiaoze/threads`, and a persistence hook in `agUiEndpoint` after each successful run. Frontend adds `xiaozeThreadsClient` and rewires `XiaozeThreadContext` for API mode while keeping localStorage for mock mode.

**Tech Stack:** TypeScript, Postgres migrations, Zod, existing audit helper, React/Vite, Vitest, Playwright.

---

## Source Spec

- `docs/design-docs/xiaoze-thread-persistence.md`
- `docs/zh-CN/design-docs/xiaoze-thread-persistence.md`
- Prerequisite: Xiaoze P0–P2 (AG-UI endpoint, approval bridge, planning graph)

## Scope

### In scope

- DB index migration + idempotent message append
- Server thread repository, schemas, routes, AG-UI persistence hook
- OpenAPI / contract artifact updates for new endpoints
- Frontend HTTP client + `XiaozeThreadContext` API mode
- Unit tests (server + frontend)
- Browser verification for history UX
- Bilingual design doc (done) + API contract notes

### Out of scope

- Postgres LangGraph checkpointer (TD-029)
- Admin UI to browse all users' Xiaoze chats
- Real-time multi-tab sync
- Bulk import of legacy localStorage threads (optional follow-up)
- WiseAgent session API changes

## File Structure

### Create

- `server/migrations/00xx_xiaoze_thread_indexes.sql`
- `server/modules/agent/xiaoze/threadRepository.ts`
- `server/modules/agent/xiaoze/threadRepository.test.ts`
- `server/modules/agent/xiaoze/threadSchemas.ts`
- `server/modules/agent/xiaoze/threadRoutes.ts`
- `server/modules/agent/xiaoze/threadRoutes.test.ts`
- `server/modules/agent/xiaoze/threadPersistence.ts`
- `server/modules/agent/xiaoze/threadPersistence.test.ts`
- `src/infrastructure/http/xiaozeThreadsClient.ts`
- `src/infrastructure/http/xiaozeThreadsClient.test.ts`

### Modify

- `server/modules/agent/xiaoze/agUiEndpoint.ts` — call persistence after successful run/resume
- `server/modules/agent/xiaoze/agUiEndpoint.test.ts` — assert DB writes
- `server/modules/agent/types.ts` — add `reasoning` to message role union
- `server/modules/agent/repository.ts` — optional `appendAgentMessageIdempotent` or extend append
- `server/modules/agent/xiaoze/agUiEndpoint.ts` (`registerXiaozeRoutes`) — register thread routes
- `src/features/agent/XiaozeThreadContext.tsx` — API-backed store
- `src/features/agent/XiaozeThreadController.tsx` — hydrate on thread select if needed
- `docs/design-docs/api-contract.md` + `docs/zh-CN/design-docs/api-contract.md` — endpoint table
- OpenAPI artifact under `docs/generated/` or project contract path (run `contract:check`)

---

## Task 1: Migration and Repository

**Files:** migration, `threadRepository.ts`, tests

- [ ] **Step 1:** Add partial index on `agent_sessions` for Xiaoze list queries.
- [ ] **Step 2:** Write failing tests for `listXiaozeThreads`, `getXiaozeThread`, `upsertXiaozeSessionOnTurn`, `archiveXiaozeThread`, `appendXiaozeMessagesIdempotent`.
- [ ] **Step 3:** Implement repository with org + actor filters; exclude zero-message sessions from list; update `title`/`preview`/`updated_at` on turn.
- [ ] **Step 4:** Run `npm run test:server -- threadRepository` — Expected: PASS.

## Task 2: REST Routes

**Files:** `threadSchemas.ts`, `threadRoutes.ts`, tests

- [ ] **Step 1:** Define Zod schemas for list/get/patch/delete bodies and DTOs.
- [ ] **Step 2:** Write failing route tests (401, 404 wrong owner, list pagination, patch title, soft delete).
- [ ] **Step 3:** Register routes in `registerXiaozeRoutes`; wire auth via existing `getCurrentAuthContext`.
- [ ] **Step 4:** Run `npm run test:server -- threadRoutes` — Expected: PASS.

## Task 3: AG-UI Persistence Hook

**Files:** `threadPersistence.ts`, `agUiEndpoint.ts`, tests

- [ ] **Step 1:** Write failing tests: successful run appends user + assistant (+ reasoning); failed run does not append assistant; resume run persists.
- [ ] **Step 2:** Implement `persistXiaozeTurn` with audit events (`agent-session` started, `agent-message` appended).
- [ ] **Step 3:** Invoke from `createXiaozeAgUiHandler` after stream completes (pass message ids from AG-UI body where available).
- [ ] **Step 4:** Run `npm run test:server -- threadPersistence agUiEndpoint` — Expected: PASS.

## Task 4: Frontend API Client and Context

**Files:** `xiaozeThreadsClient.ts`, `XiaozeThreadContext.tsx`, tests

- [ ] **Step 1:** Write failing client tests (list, get, patch, delete mapping).
- [ ] **Step 2:** Implement client using existing HTTP infrastructure / auth headers.
- [ ] **Step 3:** In API mode, load threads on mount; `selectThread` fetches messages; `createNewThread` uses client UUID without server POST until first message; `persistActiveThread` becomes no-op or PATCH title only (server owns messages).
- [ ] **Step 4:** Keep mock mode on localStorage unchanged.
- [ ] **Step 5:** Run `npm test -- xiaozeThreadsClient XiaozeThreadContext` — Expected: PASS.

## Task 5: Contract, Docs, Browser Verification

- [ ] **Step 1:** Update API contract docs (EN + zh-CN) with thread endpoint table.
- [ ] **Step 2:** Update OpenAPI artifact; run `npm run contract:check`.
- [ ] **Step 3:** Run `npm run build`.
- [ ] **Step 4:** Browser verification with `playwright-cli` at `/` (Xiaoze): desktop/tablet/mobile — list history, switch thread, new conversation, delete, reload confirms persistence. Save screenshots under `work/ui-checks/xiaoze-threads-*`.
- [ ] **Step 5:** Run `npm run docs:check`.

---

## Documentation Impact Matrix

| Area | Action | Files | Notes |
| --- | --- | --- | --- |
| Design docs | Update | `docs/design-docs/xiaoze-thread-persistence.md`, `docs/zh-CN/design-docs/xiaoze-thread-persistence.md` | Created in design phase. |
| API contract | Update | `docs/design-docs/api-contract.md`, `docs/zh-CN/design-docs/api-contract.md` | Add Xiaoze thread group. |
| Architecture | Review | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, zh-CN counterparts | Note durable chat vs TD-029 checkpoint. |
| Frontend docs | Update | `docs/FRONTEND.md`, `docs/zh-CN/frontend.md` | API mode thread client. |
| Security | Review | `docs/SECURITY.md`, `docs/zh-CN/SECURITY.md` | Actor-scoped threads, soft delete retention. |
| Product specs | Review | `docs/product-specs/prototype-functional-spec.md` | Xiaoze history behavior if mentioned. |
| OpenAPI / contract | Update | generated contract artifact | New routes. |
| Verification matrix | Update | `docs/developer/verification-matrix.md`, zh-CN | Add thread API test commands. |
| Browser acceptance | Review | `docs/developer/browser-acceptance-coverage-map.md` | Add requirement ID if missing. |
| Runbooks | No change | — | — |
| PLANS index | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md` | List this plan while active. |
| Tech debt | Review | `docs/exec-plans/tech-debt-tracker.md` | Clarify TD-029 vs chat history; optional TD for message cap. |
| References | No change | — | — |
| Generated artifacts | Update | OpenAPI | Via contract check. |
| Repository maps | Review | `AGENTS.md` | Only if new top-level paths warrant mention. |

## Documentation Update Gate

- [ ] All `Update` rows applied or recorded unchanged with evidence.
- [ ] `npm run docs:check` passes.
- [ ] Browser acceptance requirement ID added or existing coverage documented.
- [ ] Plan moved to `docs/exec-plans/completed/` after verification.

## Verification Commands

```bash
npm run test:server -- threadRepository threadRoutes threadPersistence agUiEndpoint
npm test -- xiaozeThreadsClient XiaozeThreadContext XiaozeProvider
npm run contract:check
npm run build
npm run docs:check
```

Browser (with `npm run dev:all`):

```bash
playwright-cli -s=wiseeff-xiaoze-threads open http://127.0.0.1:5173/
# desktop 1440x900, tablet 768x1024, mobile 390x844 — snapshot + screenshot + console error
```

## Expected Outcomes

- Authenticated users list and reopen Xiaoze threads from any browser after login.
- Each completed chat turn is stored in `agent_messages` with audit events.
- User delete hides thread from list (`archived`) without physical purge.
- Mock mode demos continue to work offline with localStorage.
