# WiseEff Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Code changes must follow `superpowers:test-driven-development` where behavior is user-visible or security-sensitive.

**Goal:** Replace the static TopBar「通知」placeholder with a durable, backend-backed notification center that surfaces actionable workflow events (parameter review, handoffs, imports, debugging outcomes, user governance) to the right users, with unread counts, read state, and deep links.

**Architecture:** Introduce a `notifications` backend module with PostgreSQL persistence, idempotent event producers wired from existing domain services (parameters, logs, debugging, users), and optional outbox/queue delivery through M6.4 transport. The frontend replaces the prototype `state.notifications` toast-only path in API mode with a TopBar inbox panel fed by `/api/v1/notifications`. Audit events remain the forensic source of truth; notifications are a user-facing projection optimized for attention and navigation.

**Tech Stack:** PostgreSQL migrations, TypeScript API module (repository/service/routes/schemas/tests), React TopBar panel + port/client, Vitest, Playwright acceptance, optional BullMQ worker for fan-out.

---

## Problem Statement

Today the TopBar renders a non-functional button:

```tsx
<Button aria-label="通知" ...>
  <MessageSquareText />
  <span className="notification-dot" />  {/* always visible; not tied to data */}
</Button>
```

There is no `onClick`, no panel, and no backend API. Prototype workflows instead push strings into `state.notifications` via `ADD_NOTIFICATION`, and the UI shows only the latest message in a bottom toast (`logs-feedback-toast`). This split creates three gaps:

1. **UX gap:** Users see a red dot that implies unread messages but cannot open an inbox.
2. **Durability gap:** Notifications disappear on refresh and are not scoped per user or organization.
3. **Product gap:** High-value workflow events (review queue, assignee handoff, import conflicts, debug write failure, user-governance changes) have no unified delivery surface.

## Scope Boundary

This plan includes:

- Notification domain model, persistence, list/mark-read APIs, authorization, and audit of admin-only operations if any.
- TopBar inbox UX: unread badge, panel/drawer, empty state, deep links, keyboard/a11y.
- Event producers for MVP workflow categories (see **Event Catalog**).
- API-mode frontend integration; mock mode may keep lightweight local notifications until parity tests exist.
- Browser acceptance coverage for open inbox, unread badge, mark-read, and deep-link navigation.
- Documentation, OpenAPI route manifest entry, and tech-debt registration.

This plan excludes:

- Email, SMS, or mobile push (record as Phase 4 follow-up).
- Cross-organization notification federation.
- Replacing audit center or workflow state (`workflowTrail`).
- Real-time WebSocket delivery in Phase 1 (polling is acceptable).

## Relationship To Other Systems

| System | Role | Notification plan stance |
| --- | --- | --- |
| **Audit center** (`docs/design-docs/2026-06-17-audit-center-design.md`) | Forensic, immutable-ish event log | Notifications may link to audit rows but must not duplicate full audit payloads |
| **`ADD_NOTIFICATION` / prototype reducer** | Ephemeral demo toasts | Deprecate for API mode; keep mock/demo path until migration complete |
| **M6.4 durable queue** (`2026-06-02-wiseeff-m6-4-durable-queue.md`) | Async job transport | Phase 3 uses queue for fan-out/retries; Phase 1 may write synchronously in the same transaction as domain mutation |
| **Review / parameter APIs** | Source events | Producers emit on submit, review advance/reject, merge, import apply |
| **Debugging APIs** | Source events | Producers emit on write failure, rollback, lease conflict (optional MVP) |
| **User governance APIs** | Source events | Producers emit on role change, deactivation (Admin + affected user) |

## Target UX

```text
TopBar
  [页面操作…]  [项目 ▼]  [🔔 3]  [用户 ▼]
                         └─ click opens NotificationPanel (Popover or right Drawer)

NotificationPanel
  ┌──────────────────────────────────────────┐
  │ 通知                          全部标为已读 │
  ├──────────────────────────────────────────┤
  │ ● 参数审阅  Aurora · 充电策略              │
  │   韩启 提交了 3 项修改，等待硬件审阅         │
  │   2 分钟前                    [查看审阅队列] │
  │ ─────────────────────────────────────── │
  │ ○ 调试写入  Node debugging               │
  │   Fast charge current 写入失败（设备离线）   │
  │   1 小时前                    [打开调试页]   │
  └──────────────────────────────────────────┘

Empty state: 「暂无通知」+ muted icon, no red dot
Error state: panel shows retry; TopBar badge hidden or stale with tooltip
```

**Interaction rules**

- Red dot / numeric badge = unread count from API (`unreadCount`), never hard-coded.
- Clicking a row marks it read (optimistic UI with rollback on failure) and navigates when `actionUrl` is present.
-「全部标为已读」calls bulk mark-read API.
- Panel closes on outside click / Escape; focus trap while open.

## Event Catalog (Phased)

### Phase 1 — MVP producers (must ship)

| Category | Trigger (server) | Primary recipients | Deep link |
| --- | --- | --- | --- |
| `parameter.review.submitted` | Change request submitted | Project reviewers (hardware/software by rules) | `/parameter-review?project=…` |
| `parameter.review.advanced` / `parameter.review.rejected` | Review transition | Submitter + next assignees | Review queue / parameter detail |
| `parameter.import.completed` | Import batch applied | Initiating user | `/parameter-admin?project=…` |
| `debug.node.write.failed` | Node write failed | Session owner | `/node-debugging?project=…` |
| `system.broadcast` | Admin broadcast (optional stub) | All active org users | Configurable |

### Phase 2 — Workflow expansion

| Category | Trigger | Recipients |
| --- | --- | --- |
| `parameter.merge.completed` | Merge to baseline | Submitter, reviewers |
| `log.analysis.completed` / `log.analysis.failed` | Worker terminal state | Log uploader |
| `debug.snapshot.rollback` | Rollback succeeded/failed | Operator |
| `user.role.changed` / `user.deactivated` | M6.2 governance | Affected user, Admins |

### Phase 3 — Delivery hardening

- Outbox table + queue worker for retries and digest grouping.
- Idempotency keys `(sourceKind, sourceId, recipientUserId)`.
- Rate limits and deduplication windows for noisy debug failures.

### Phase 4 — External channels (out of MVP)

- Email/in-app preference center, quiet hours, web push.

## Backend Design

### Data model (PostgreSQL)

```sql
-- migration draft; finalize in implementation
create table user_notifications (
  id uuid primary key,
  organization_id text not null,
  recipient_user_id text not null references users(id),
  category text not null,
  title text not null,
  body text not null,
  severity text not null default 'info', -- info | success | warning | danger
  action_url text,
  source_kind text,          -- e.g. parameter_change_request
  source_id text,
  metadata jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, recipient_user_id, source_kind, source_id, category)
);

create index user_notifications_recipient_unread_idx
  on user_notifications (recipient_user_id, created_at desc)
  where read_at is null;
```

Optional Phase 3:

```sql
create table notification_outbox (
  id uuid primary key,
  payload jsonb not null,
  status text not null,
  attempts int not null default 0,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now()
);
```

### API contract (MVP)

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/notifications` | authenticated | Paginated inbox for current user; query: `unreadOnly`, `cursor`, `limit` |
| `GET` | `/api/v1/notifications/unread-count` | authenticated | `{ count: number }` for TopBar badge |
| `POST` | `/api/v1/notifications/{id}/read` | authenticated | Mark one read; 404 if not recipient |
| `POST` | `/api/v1/notifications/mark-all-read` | authenticated | Bulk mark read for current user |

Response shape (list item):

```typescript
type NotificationDto = {
  id: string;
  category: string;
  title: string;
  body: string;
  severity: "info" | "success" | "warning" | "danger";
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
};
```

Authorization:

- Recipients may only read/mark their own notifications.
- Admin cannot read other users' inboxes unless a future Admin support tool is explicitly planned (default: **deny**).

### Producer pattern

```typescript
// server/modules/notifications/service.ts (sketch)
async function notifyUsers(input: {
  organizationId: string;
  recipientUserIds: string[];
  category: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  actionUrl?: string;
  sourceKind?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // upsert by unique key; ignore duplicates
}
```

Wire producers inside existing service transaction boundaries **after** domain state commits successfully (parameters review, import apply, debug write failure handler, etc.).

## Frontend Design

### New components

| File | Responsibility |
| --- | --- |
| `src/components/notifications/NotificationPanel.tsx` | Popover/drawer UI, list, empty/error states |
| `src/components/notifications/NotificationBell.tsx` | TopBar button, badge, open/close |
| `src/application/notifications/notificationRuntime.ts` | Poll unread count, list fetch, mark read |
| `src/infrastructure/http/notificationsClient.ts` | HTTP client + DTO mapping |
| `src/application/ports/NotificationsGateway.ts` | Port for mock/API runtime |

### TopBar integration

Replace static button in `src/App.tsx` `TopBar` with:

```tsx
<NotificationBell
  unreadCount={unreadCount}
  onOpenChange={setPanelOpen}
  panel={<NotificationPanel ... />}
/>
```

API mode: poll unread count every 60s (configurable) and on window focus; refetch list when panel opens.

Mock mode (Phase 1): `NotificationsGateway` may mirror `state.notifications` into panel rows until backend producers cover demo workflows.

### Migration from `ADD_NOTIFICATION`

| Stage | Behavior |
| --- | --- |
| **A** | API mode: keep toast for immediate feedback **and** persist via POST internal helper when backend exists |
| **B** | API mode: toast only for inline form errors; workflow events go to inbox only |
| **C** | Remove prototype `notifications[]` from API hydration path; mock mode retains local array |

## Git & PR Workflow

| Role | Branch | Actions |
| --- | --- | --- |
| **This plan** | `docs/notification-center-plan` | Plan + docs only |
| **Implementation Phase 1** | `feat/notification-center-mvp` from `main` | Backend module + TopBar panel + MVP producers |
| **Implementation Phase 2+** | `feat/notification-center-workflows` | Additional producers, mock parity, acceptance |
| **Parent agent** | — | Review, open/merge PRs, sync `main` |

One phase per PR unless plan explicitly combines tightly coupled backend+frontend MVP.

## Implementation Tasks

### Phase 0 — Plan & debt (this PR)

- [x] Author this plan under `docs/exec-plans/active/`.
- [ ] Register **TD-034** in `docs/exec-plans/tech-debt-tracker.md`.
- [ ] Add plan link to `docs/PLANS.md`.
- [ ] Run `npm run docs:check`.

### Phase 1 — Backend MVP + TopBar inbox

**Branch:** `feat/notification-center-mvp`

#### Task 1.1: Database + module skeleton

- [ ] Write failing tests for repository insert/list/mark-read/unread-count.
- [ ] Add migration `00xx_user_notifications.sql`.
- [ ] Implement `server/modules/notifications/{repository,service,routes,schemas}.ts` + tests.
- [ ] Register routes in `server/index.ts` and `routeManifest.ts`.
- [ ] Run `npm run test:server -- server/modules/notifications`.

#### Task 1.2: MVP producers

- [ ] Write failing service tests: submit → reviewer notification; review reject → submitter notification.
- [ ] Wire producers in `server/modules/parameters/service.ts` (or dedicated hook) post-commit.
- [ ] Optional: debug write failure producer behind feature flag.
- [ ] Run focused server tests for parameters + notifications.

#### Task 1.3: Frontend bell + panel

- [ ] Write failing tests: badge hidden when count=0; panel lists items; mark-read reduces count.
- [ ] Implement `NotificationBell`, `NotificationPanel`, HTTP client, runtime hook.
- [ ] Replace static TopBar button in `src/App.tsx`.
- [ ] Remove unconditional `.notification-dot` from static markup.
- [ ] Run `npm test -- NotificationBell NotificationPanel notificationsClient`.
- [ ] Run `npm run build`.

#### Task 1.4: Browser verification

- [ ] Add acceptance spec `e2e/acceptance/notifications.acceptance.spec.ts` with IDs `NOTIF-INBOX-001`, `NOTIF-READ-001`.
- [ ] Update `docs/developer/browser-acceptance-coverage-map.md` and `user-operation-coverage-matrix.md`.
- [ ] Run `playwright-cli` / acceptance on desktop + tablet + mobile viewports for TopBar panel.

### Phase 2 — Workflow expansion + mock parity

- [ ] Add producers for import, log analysis terminal states, rollback, user governance.
- [ ] Map remaining high-traffic `ADD_NOTIFICATION` call sites to backend notifications in API mode.
- [ ] Add mock `NotificationsGateway` for component demos.

### Phase 3 — Outbox + queue fan-out

- [ ] Add `notification_outbox` + worker job consuming M6.4 queue transport.
- [ ] Retry/backoff, dead-letter metrics, observability dashboards (coordinate with M6.5).

### Phase 4 — External delivery (follow-up plan)

- [ ] User preferences, email templates, opt-out, digest scheduling — separate plan if needed.

## Verification Matrix

| Gate | Command / evidence |
| --- | --- |
| Server unit tests | `npm run test:server -- server/modules/notifications` |
| Frontend unit tests | `npm test -- notifications NotificationBell NotificationPanel` |
| Contract | `npm run contract:check` (new routes in manifest/OpenAPI) |
| Build | `npm run build` |
| Docs | `npm run docs:check` |
| Browser acceptance | `npm run acceptance:browser -- e2e/acceptance/notifications.acceptance.spec.ts` |
| Manual | TopBar badge tracks unread; panel open/mark-read/deep link; no static red dot at zero unread |

## Success Criteria

- TopBar「通知」opens a panel and is keyboard accessible.
- Unread badge reflects backend count; zero unread hides badge/dot.
- At least three MVP event categories deliver notifications in API mode with correct recipient scoping.
- Mark-read persists across refresh.
- No regression to audit event writes; notifications link to audit when useful but do not replace it.
- Static placeholder button behavior is fully removed.

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Update | `AGENTS.md`, `docs/README.md` | Link notifications module when implemented |
| Planning docs | Update | `docs/PLANS.md`, this plan, `docs/exec-plans/tech-debt-tracker.md` | TD-034 tracks placeholder removal |
| Product specs | Update | `docs/product-specs/prototype-functional-spec.md` | Document inbox vs toast behavior |
| Architecture docs | Update | `ARCHITECTURE.md`, `docs/design-docs/full-stack-architecture.md`, `docs/design-docs/api-contract.md` | New module + routes |
| Quality/testing docs | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`, `docs/design-docs/testing-strategy.md` | New acceptance IDs |
| Reliability/runbooks | Review | `docs/RELIABILITY.md`, `docs/runbooks/README.md` | Phase 3 queue failure runbook |
| Security/governance docs | Update | `docs/SECURITY.md`, `docs/security/threat-model.md` | Recipient scoping, no cross-user inbox leakage |
| Frontend/design docs | Update | `docs/FRONTEND.md` | TopBar inbox, polling, deep links |
| Generated artifacts | Review | OpenAPI artifact via `contract:check` | New notification routes |
| References | Review | `docs/references/` | Optional compact DTO note |
| Chinese developer docs | Update | `docs/zh-CN/frontend.md`, `docs/zh-CN/backend-runtime.md` | Inbox UX + API summary |

## Documentation Update Gate

- `npm run docs:check` must pass before moving this plan to `completed/`.
- Security and API contract docs must land in the same branch as backend routes.
- Browser acceptance IDs must exist before Phase 1 merges.
- Phase 4 external delivery requires a new or amended plan; do not expand scope silently.

## UI Interaction Automation Review

This plan changes TopBar interaction behavior.

- **Affected specs:** new `e2e/acceptance/notifications.acceptance.spec.ts`; smoke touch on any spec asserting TopBar layout.
- **Requirement IDs:** `NOTIF-INBOX-001` (open panel, list renders), `NOTIF-READ-001` (mark read updates badge), `NOTIF-DEEPLINK-001` (action navigates).
- **Operation IDs:** `NOTIF-INBOX-001`, `NOTIF-READ-001`, `NOTIF-DEEPLINK-001`.
- **Evidence:** `npm run acceptance:browser` + `playwright-cli` snapshots at 1440×900, 768×1024, 390×844 for panel open/closed states.

## External Inputs Needed

- Recipient resolution rules for review queues (map from project + role to user ids).
- Whether Admins receive all org notifications or only explicit `system.broadcast`.
- Polling interval defaults vs. future SSE preference.
- Retention period for read notifications (align with audit retention guidance).

## Open Questions

1. Should submitting users receive confirmation notifications, or only reviewers/admins on the other side of the workflow?
2. Should debug failure notifications dedupe within a session window to avoid spam during offline polling?
3. Do we show notifications to Guest/demo users in mock mode, or hide the bell entirely?

---

**Plan status:** Active — Phase 0 (documentation). Implementation starts with Phase 1 branch `feat/notification-center-mvp` after plan merge.
