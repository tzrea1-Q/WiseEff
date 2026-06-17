# Audit Center Design

> Chinese: [Chinese](../zh-CN/design-docs/2026-06-17-audit-center-design.md)

This document defines the WiseEff audit experience: evidence model, information architecture, API expectations, and phased delivery. It supersedes the audit sections in `2026-05-10-parameter-admin-redesign-design.md` for current implementation work.

## Problem

The current parameter-admin audit modal shows a flat timeline (severity, one-line action, actor, relative time). It does not expose structured metadata, trace linkage, filters, or API-backed events. Backend services already write audit records for parameters, logs, debugging, users, and Agent actions, but the product surface does not help operators investigate them.

## Goals

| Goal | Description |
| --- | --- |
| Completeness | Surface all production writes and high-risk reads already recorded server-side |
| Investigability | Filter by actor, project, app, kind, severity, target, trace, and time |
| Understandability | Render structured diffs and business labels per event kind |
| Traceability | Link submit → review → merge → import → debug write → rollback chains |
| Compliance readiness | Align with `docs/security/audit-retention.md` retention and export guidance |

## Non-Goals (this design)

- Immutable WORM storage or scheduled export jobs (Phase M3)
- Cross-organization audit federation
- Event-level undo (remains separate from audit evidence)
- Replacing workflow state (`workflowTrail`) with audit rows

## Experience Layers

```text
L1 Context Audit   — embedded in parameter, submission, log, debug, and Agent pages
L2 Module Audit    — parameter-admin / logs-admin / debugging-admin / user-permissions audit entry
L3 Org Audit Center — /audit unified search for Admin (Phase M2)
```

Phase M1 delivers an upgraded **L2 module audit** for parameter admin with API integration and detail drill-down. Phase M2 adds `/audit`. Phase M3 adds export and retention operations.

## Information Architecture

### Parameter admin (M1)

- Toolbar **审计** opens a modal (not a permanent drawer).
- Modal layout: filter bar + selectable event list + detail panel.
- Mock mode: `app=parameter-admin` mock events.
- API mode: `GET /api/v1/audit-events?app=parameter-management&projectId=...`.
- Legacy `?audit=open` deep link continues to open the modal.

### Org audit center (M2)

| Route | Role | Scope |
| --- | --- | --- |
| `/audit` | Admin | All apps in organization |
| Module pages | Module admin | Scoped by app and project |

Master-detail layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ Audit · Parameter Management                    [Export M3] │
├─────────────────────────────────────────────────────────────┤
│ [Search] [Time▼] [Severity▼] [Kind▼] [Project▼] [Actor▼]    │
├──────────────────────┬──────────────────────────────────────┤
│ Virtual event list   │ Detail: diff, metadata, trace chain  │
└──────────────────────┴──────────────────────────────────────┘
```

## Event Model

### Storage (existing)

`audit_events` columns: `organization_id`, `project_id`, `actor_user_id`, `actor_type`, `app`, `kind`, `action`, `severity`, `target_type`, `target_id`, `metadata`, `trace_id`, `created_at`.

### UI view model

Frontend renders `AuditEventView` (display layer), mapped from:

- API `AuditEventDto` (+ optional `actorName`)
- Mock `AuditEvent` (prototype/demo)

Key fields: `id`, `app`, `kind`, `action`, `severity`, `actor`, `actorType`, `createdAt`, `traceId`, `targetType`, `targetId`, `metadata`.

### App taxonomy

| App | Examples | Typical targets |
| --- | --- | --- |
| `parameter-management` | submit, review, merge, import | change-request, import-batch |
| `parameter-admin` | definition update/delete, bulk ops | parameter-definition (mock/admin CRUD) |
| `log-analysis` | upload, rerun, archive, feedback | log-record |
| `debugging` | read, write, rollback, session | debug-parameter, snapshot |
| `agent` | tool request, approval, execution | tool-call, session |
| `user-governance` | create, role replace, activation | user |

**Naming rule:** API writes use `parameter-management` for workflow events. Mock admin CRUD uses `parameter-admin`. UI filters must include both where relevant.

### Metadata by kind (render hints)

| Kind | Required metadata for High/Medium |
| --- | --- |
| `parameter-merge` | `fromStatus`, `toStatus`, optional `note` |
| `parameter-review-advance` / `parameter-review-reject` | status transition, `note` |
| `batch-import` | `summary` (`added`, `updated`, `skipped`), `batchId` |
| `debug-node-write` | `previousValue`, `readbackValue`, `nodePath`, `snapshotId`, `verified` |
| `user-role-replace` | `roles` or role diff |
| Mock `parameter-update` | `previousValue`, `newValue` |

## API Design

### List (M1 extension)

```http
GET /api/v1/audit-events?projectId=&app=&apps=&kind=&severity=&targetType=&targetId=&traceId=&from=&to=&cursor=&limit=
```

Response:

```json
{
  "items": [ { "...AuditEventDto", "actorName": "Wang Jie" } ],
  "nextCursor": "2026-05-25T08:00:00.000Z"
}
```

Defaults: `limit=50`, max `100`, sort `created_at desc`, cursor = ISO timestamp of last row.

### Permissions (M1)

- `admin:access` — full list (current behavior).
- Module-scoped read (`parameter.admin`, etc.) — Phase M2.

### Indexes (existing + recommended)

Existing: `(project_id, created_at desc)`, `(actor_user_id)`, `(kind)`.

Recommended for M2: `(organization_id, created_at desc)`, `(trace_id)`, `(target_type, target_id, created_at desc)`.

## User Journeys

### Investigate a high-risk parameter merge

1. Open parameter admin → 审计 → filter **高**.
2. Select merge event → detail shows status transition and trace id.
3. (M2) Open related events by `traceId` or submission round metadata.

### Trace import batch

1. Filter kind `batch-import`.
2. Detail shows added/updated/skipped counts and batch id.
3. Jump to import preview when batch UI exists.

### Debug write rollback

1. Filter `debug-node-write` in debugging admin audit (M2).
2. Detail shows node path, before/after, readback, snapshot id.
3. Related rollback event linked by `sessionId` (M2).

## Security

- Never store secrets, raw log payloads, or full prompts in metadata.
- Every write must include `traceId` (= HTTP `requestId`).
- High-severity events must be reconstructable from metadata alone.
- See `docs/security/audit-retention.md` for retention and export gaps.

## Phased Delivery

| Phase | Scope |
| --- | --- |
| **M1** | Parameter admin modal: API fetch, filters, detail panel, extended list API |
| **M2** | `/audit` center, L1 embeds, module-scoped permissions, trace/submission linking |
| **M3** | CSV/JSON export, retention config, immutable export, review workflow |

## Acceptance (M1)

- API mode: parameter submit/review/merge/import events visible in modal with metadata.
- Click event → detail shows diff or status transition.
- Severity and text filters work client-side; API filters work server-side.
- Mock mode unchanged for demos.
- Tests: audit repository/routes, audit client, AuditTimeline/Detail, ParameterAdminPage.
- Browser: desktop/tablet/mobile modal with snapshot + screenshot.

## Related Documents

- `docs/design-docs/security-governance.md`
- `docs/security/audit-retention.md`
- `docs/design-docs/domain-model.md`
- `docs/exec-plans/active/2026-06-17-wiseeff-audit-center-m1.md`
