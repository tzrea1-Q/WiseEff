# Xiaoze Thread Persistence Design

> Chinese: [Chinese](../zh-CN/design-docs/xiaoze-thread-persistence.md)

Date: 2026-06-24  
Status: Approved for implementation planning

## Context

Xiaoze chat history is currently **browser-local only** (`localStorage` key `wiseeff.xiaoze.threads.v1`). CopilotKit passes a client-generated `threadId` to `POST /api/v1/agent/xiaoze`, and LangGraph planning uses that id with an in-memory `MemorySaver` checkpointer (TD-029). Neither path gives **cross-device**, **auditable**, or **long-term** conversation history.

The M4 agent schema already defines durable tables:

- `agent_sessions` — session metadata, org/user scope, title, status
- `agent_messages` — append-only messages with citations
- `agent_tool_calls` / `agent_approvals` / `agent_run_traces` — execution and audit adjacency

Today Xiaoze only creates an `agent_sessions` row **lazily** when a mutating tool needs the orchestrator approval bridge. Ordinary chat turns are not persisted.

## Goals

- Users see the same Xiaoze conversation history on any device after login.
- Every persisted thread and message is scoped to **organization + actor user**, enforceable server-side.
- History survives API restarts and meets retention/audit expectations (soft delete for UX, hard retention per org policy).
- CopilotKit `threadId` remains the canonical server id (no second id space).
- Reuse existing orchestrator audit patterns; do not bypass authz or approval chains.

## Non-Goals

- Replacing LangGraph checkpoint storage in this design (see TD-029; same `threadId`, different payload).
- Exposing other users' threads to admins in v1 (admin audit views use existing audit APIs).
- Real-time multi-device live sync (WebSocket); v1 is pull on load + append on turn completion.
- Migrating WiseAgent (`/api/v1/agent/sessions`) UI to this API.

## Terminology

| Term | Meaning |
| --- | --- |
| **Thread** | A Xiaoze chat conversation. Stored as one `agent_sessions` row with `page_key = 'xiaoze'`. |
| **threadId** | Client-generated UUID from CopilotKit; equals `agent_sessions.id`. |
| **Draft thread** | Active `threadId` with no persisted session row yet (no user messages). |
| **Historical thread** | Session with at least one persisted user or assistant message. |

## Architecture Decision: Reuse M4 Tables

Create **no** parallel `xiaoze_threads` table in v1.

| Concern | Choice |
| --- | --- |
| Identity | `agent_sessions.id` = CopilotKit `threadId` |
| Discriminator | `page_key = 'xiaoze'` |
| Actor scope | `actor_user_id = auth.user.id`, `organization_id = auth.organization.id` |
| Lifecycle | `status`: `active` (visible) \| `archived` (user deleted, retained) |
| Messages | `agent_messages` rows; roles `user`, `assistant`, `reasoning` |
| Tool/approval adjacency | Existing rows link to same `session_id` when mutating tools run |

Rationale: approval bridge, tool calls, run traces, and audit already key off `agent_sessions.id`. A second table would duplicate scope checks and complicate joins.

### Session `context` JSON (Xiaoze-specific)

```json
{
  "path": "/parameters",
  "pageKey": "parameters",
  "projectId": "aurora",
  "roleId": "editor",
  "xiaoze": {
    "preview": "Last assistant snippet…",
    "source": "copilotkit",
    "lastRunId": "uuid"
  }
}
```

`title` remains a first-class column (derived from first user message, editable via PATCH).

## Data Flow

```
Frontend (CopilotKit threadId)
    │
    ├─ GET /threads ─────────────► list agent_sessions (page_key=xiaoze, active)
    │
    ├─ POST /agent/xiaoze (SSE) ─► planning graph (MemorySaver, TD-029)
    │         │
    │         └─ on turn complete ─► upsert session + append messages (same transaction)
    │
    └─ select thread ────────────► GET /threads/:id + hydrate CopilotKit messages
```

**Write timing:** persist at end of each successful AG-UI run (including approval resume runs), not on every SSE token. User message is taken from the request; assistant/reasoning from agent result. Failed runs do not append assistant content.

**Empty threads:** do not insert `agent_sessions` until the first non-empty user message (matches current frontend rule).

**Idempotency:** AG-UI supplies stable message ids; `appendAgentMessage` uses `ON CONFLICT (id) DO NOTHING` (new migration) so retries do not duplicate rows.

## REST API

Base path: `/api/v1/agent/xiaoze/threads`  
Auth: same bearer session as other `/api/v1` routes.  
Errors: structured envelope per `docs/api/errors.md`.

### `GET /api/v1/agent/xiaoze/threads`

List current user's active Xiaoze threads (non-empty only).

Query:

| Param | Default | Notes |
| --- | --- | --- |
| `limit` | 30 | Max 50 |
| `cursor` | — | Opaque; sort `updated_at desc, id desc` |

Response:

```json
{
  "items": [
    {
      "id": "uuid",
      "title": "aurora 项目里和 charge…",
      "preview": "和 charge 相关的参数有…",
      "createdAt": "2026-06-24T08:00:00.000Z",
      "updatedAt": "2026-06-24T08:05:00.000Z",
      "messageCount": 4
    }
  ],
  "nextCursor": null
}
```

Authz: `organization_id` + `actor_user_id` + `page_key = 'xiaoze'` + `status = 'active'`, exclude sessions with zero messages.

### `POST /api/v1/agent/xiaoze/threads`

Optional explicit thread creation for clients that want a server-acknowledged id before first message.

Body (optional):

```json
{
  "id": "client-uuid",
  "context": { "path": "/", "pageKey": "home", "projectId": "aurora" }
}
```

Response `201`: `{ "thread": { "id", "title": "新对话", "createdAt", "updatedAt" } }`

Does **not** insert a list-visible row until first user message unless `POST` is used with immediate first message (future). Default: return id only in memory on client; server insert deferred to first AG-UI turn.

### `GET /api/v1/agent/xiaoze/threads/:threadId`

Returns thread metadata + ordered messages for hydration.

Response:

```json
{
  "thread": {
    "id": "uuid",
    "title": "…",
    "preview": "…",
    "createdAt": "…",
    "updatedAt": "…",
    "context": { "pageKey": "parameters", "projectId": "aurora" }
  },
  "messages": [
    { "id": "…", "role": "user", "content": "…", "createdAt": "…" },
    { "id": "…", "role": "assistant", "content": "…", "citations": [], "createdAt": "…" },
    { "id": "…", "role": "reasoning", "content": "…", "createdAt": "…" }
  ]
}
```

Authz: 404 if thread missing or not owned.

### `PATCH /api/v1/agent/xiaoze/threads/:threadId`

Body: `{ "title": "自定义标题" }` (1–80 chars).

Updates `title`, `updated_at`. Audit: `agent-session` / `updated`.

### `DELETE /api/v1/agent/xiaoze/threads/:threadId`

Soft delete: set `status = 'archived'`. Rows remain for audit retention. Audit: `agent-session` / `archived`.

Does not delete LangGraph checkpoint blobs (TD-029 follow-up).

## Server Module Layout

| File | Responsibility |
| --- | --- |
| `server/modules/agent/xiaoze/threadRepository.ts` | List/get/upsert/archive; message append with idempotency |
| `server/modules/agent/xiaoze/threadSchemas.ts` | Zod request/response schemas |
| `server/modules/agent/xiaoze/threadRoutes.ts` | Register REST handlers |
| `server/modules/agent/xiaoze/threadPersistence.ts` | Called from `agUiEndpoint` after run |
| `server/modules/agent/xiaoze/agUiEndpoint.ts` | Invoke persistence hook |
| `server/migrations/00xx_xiaoze_thread_indexes.sql` | Indexes + optional `reasoning` role note |

Register routes in `registerXiaozeRoutes` alongside AG-UI and suggest endpoints.

## Audit Events

| Event | kind | action | target |
| --- | --- | --- | --- |
| First message creates session | `agent-session` | `started` | `agent_session` |
| User/assistant turn persisted | `agent-message` | `appended` | `agent_message` (metadata: sessionId, roles) |
| Title edit | `agent-session` | `updated` | `agent_session` |
| User deletes from history | `agent-session` | `archived` | `agent_session` |

Tool approvals continue using existing `agent-tool` audit events on the same `session_id`.

## Frontend Integration

| Area | Change |
| --- | --- |
| `src/infrastructure/http/xiaozeThreadsClient.ts` | New port: list, get, patch, delete |
| `src/features/agent/XiaozeThreadContext.tsx` | API-backed store in `api` runtime mode |
| `src/features/agent/xiaozeThreadStorage.ts` | Keep for `mock` mode + one-time import helper |
| CopilotKit | Continue passing `threadId`; on select thread, preload messages from GET |

**Runtime modes:**

- `VITE_WISEEFF_RUNTIME_MODE=api` (default): server is source of truth; localStorage used only for optional one-time migration banner.
- `mock`: unchanged localStorage behavior.

**Migration UX (optional v1):** on login, if localStorage has threads and server list empty, offer import (POST turns or bulk endpoint deferred).

## Security

- All queries filter `organization_id` and `actor_user_id`; no cross-user access.
- Message content is org-scoped confidential data; same classification as agent sessions in `docs/security/`.
- DELETE is soft-only; hard purge is ops/retention job, not user API.
- Persist hook runs only after auth succeeds on AG-UI handler (same as today).

## Relationship to TD-029 (LangGraph Checkpoint)

| Layer | Storage | Purpose |
| --- | --- | --- |
| Chat history (this design) | Postgres `agent_messages` | User-visible transcript, cross-device |
| Planning checkpoint (TD-029) | Postgres LangGraph saver (future) | Mid-plan graph state after interrupt |

Both use the same `threadId`. Implementations must not conflate checkpoint JSON with message rows.

## Database Migration (v1)

1. Index for list queries:

```sql
create index if not exists agent_sessions_xiaoze_actor_idx
  on agent_sessions (organization_id, actor_user_id, page_key, status, updated_at desc)
  where page_key = 'xiaoze';
```

2. Idempotent message insert support (application-level `ON CONFLICT DO NOTHING` on `agent_messages.id`).

3. Extend `AgentMessageDto.role` type to include `"reasoning"` (no DB constraint today).

## Verification

- Server: `npm run test:server -- threadRepository threadRoutes threadPersistence agUiEndpoint`
- Frontend: `npm test -- src/features/agent src/infrastructure/http/xiaozeThreadsClient`
- Contract: update OpenAPI artifact; `npm run contract:check`
- Browser: history list, switch thread, new conversation, delete, cross-session reload (`playwright-cli` per AGENTS.md)
- Docs: `npm run docs:check`

## Open Questions (defaults for v1)

| Question | Default |
| --- | --- |
| Max threads per user | 30 (match current localStorage cap) |
| Max messages per thread | 500 (truncate oldest with audit note in TD if needed) |
| Admin visibility of user chats | Out of scope; audit API only |
| Bulk localStorage import | Optional follow-up endpoint |

## References

- M4 schema: `server/migrations/0008_m4_agent.sql`
- AG-UI handler: `server/modules/agent/xiaoze/agUiEndpoint.ts`
- Frontend thread UX: `src/features/agent/xiaozeThreadStorage.ts`
- Xiaoze agent design: `docs/superpowers/specs/2026-06-24-xiaoze-agent-design.md`
- TD-029: `docs/exec-plans/tech-debt-tracker.md`
