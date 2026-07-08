# Product Feedback (Internal Beta 问题反馈) Design

Date: 2026-07-08  
Status: **Approved for implementation planning**

## Summary

Wire the existing sidebar **问题反馈** (`FeedbackDialog`) to a real backend and storage, including multi-image attachments, and add an admin-only **轻量工单** review page at `/feedback-admin`. This feature is **independent** of log-analysis quality feedback (`log_feedback` / `logs:feedback`).

## Decisions

| Decision | Choice |
| --- | --- |
| Scope | End-to-end product feedback: submit + persist + admin triage |
| Approach | New `product-feedback` module (not audit-only, not `log_feedback`) |
| Screenshots | Persist in ObjectStore from day one; **multiple images per submission** |
| Admin UX | Lightweight workflow: list + detail + status + optional admin note |
| Submit authz | Any authenticated **active** user |
| Review authz | **Admin only** (`admin:access`), matching existing admin pages |
| Status model | `open` (待处理) → `in_progress` (处理中) → `closed` (已关闭); forward-only |
| Navigation | Utility item next to 审计中心; page key `feedback-admin` |

## Boundary: not log feedback

| Concern | Product feedback | Log analysis feedback |
| --- | --- | --- |
| UI | Sidebar「问题反馈」/ Internal Beta Feedback | 「反馈分析质量」on log report / admin drawer |
| Domain | `product_feedback` + attachments | `log_feedback` |
| Permission | Active user submit; `admin:access` review | `logs:feedback` |
| Audit kinds | `product-feedback-create` / `product-feedback-update` | `log-feedback` |

Do not extend `log_feedback`, `logs:feedback`, or `LogAnalysisFeedbackDialog` to carry sidebar beta feedback.

## Data Model

### `product_feedback`

| Column | Notes |
| --- | --- |
| `id` | UUID PK |
| `organization_id` | Org scope from auth; not client-supplied |
| `submitter_user_id` | Authenticated user |
| `page_path` | e.g. `/parameters`; max **500** |
| `page_title` | Display title at submit time; max **200** |
| `feedback_type` | `experience` \| `data` \| `export_submit` \| `feature` (UI: 体验问题 / 数据问题 / 导出/提交异常 / 功能建议) |
| `description` | Required; max **4000** characters |
| `status` | `open` \| `in_progress` \| `closed`; default `open` |
| `admin_note` | Optional; max **2000**; admin-writable |
| `created_at` / `updated_at` | Timestamps |

### `product_feedback_attachments`

| Column | Notes |
| --- | --- |
| `id` | UUID PK |
| `feedback_id` | FK → `product_feedback` |
| `organization_id` | Denormalized for isolation checks |
| `storage_key` | ObjectStore key |
| `file_name` | Sanitized original name |
| `content_type` | `image/png` \| `image/jpeg` \| `image/webp` |
| `size_bytes` | Positive integer |
| `checksum` | Store digest from ObjectStore put |
| `sort_order` | 0-based order as submitted |
| `created_at` | |

ObjectStore key convention: `{organizationId}/product-feedback/{feedbackId}/{checksum}-{fileName}`.

Do **not** reuse `log_file_objects` row semantics for these attachments.

### Attachment limits

- Max **5** images per feedback
- Max **5MB** per image
- Max **15MB** total attachment payload per submit
- MIME whitelist only: PNG, JPEG, WebP

### Status transitions

Allowed only:

- `open` → `in_progress`
- `in_progress` → `closed`

Disallowed in v1: backward transitions, reopen, skip (`open` → `closed` directly). Reject illegal transitions with **`400`** and a clear validation message.

## API Surface

Prefix: `/api/v1`. Org scoping follows logs/debugging: body/query do **not** pass `organizationId`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/product-feedback` | Active user | Create feedback + optional base64 attachments |
| `GET` | `/product-feedback` | `admin:access` | List with filters + cursor pagination |
| `GET` | `/product-feedback/:id` | `admin:access` | Detail including attachment metadata |
| `GET` | `/product-feedback/:id/attachments/:attachmentId/content` | `admin:access` | Binary image content (org-checked) |
| `PATCH` | `/product-feedback/:id` | `admin:access` | Update `status` and/or `adminNote` while status is `open` or `in_progress`; **reject writes when `closed`** |

### Create body (conceptual)

```json
{
  "pagePath": "/parameters",
  "pageTitle": "项目参数用户工作台",
  "feedbackType": "experience",
  "description": "...",
  "attachments": [
    {
      "fileName": "shot-1.png",
      "contentType": "image/png",
      "contentBase64": "..."
    }
  ]
}
```

`attachments` optional; empty array or omit allowed. Response `{ item }` includes attachment metadata **without** base64.

### List query

- `status`, `feedbackType`
- `q` — search description / page path / page title
- `pagePath` — optional **prefix** match for triage by route group (e.g. `/parameters` matches `/parameters` and nested paths if any)
- time window: `createdFrom` / `createdTo` (ISO)
- cursor pagination + stable sort (newest first)

### Audit

On create and status/note update, emit `createAuditEvent` with:

- `app`: `product-feedback`
- `kind`: `product-feedback-create` \| `product-feedback-update`
- `targetType`: `product-feedback`
- `targetId`: feedback id
- metadata: type, status (after), pagePath, attachmentCount; note excerpts only if size-safe

## Backend Architecture

New module: `server/modules/product-feedback/`

```
routes → schemas (zod) → policy → service (tx + ObjectStore + audit) → repository (SQL)
```

Mirror the logs write stack. Register in `server/app.ts` with shared `db` and `objectStore`. Update route manifest / OpenAPI freshness.

Policy:

- Submit: authenticated + active user (no new submit permission id in v1)
- Admin routes: `admin:access` + active

No new `feedback:manage` permission in v1.

## Frontend Architecture

### Submit UI

- Keep current dialog layout and copy; upgrade paste zone to **multi-image** grid (add/remove; cap at 5 with inline limit messaging)
- On submit: `ProductFeedbackRepository.submit` via HTTP client (base64 encode files like log upload)
- Loading / disable double-submit; retain form on error; success clears content and shows confirmation
- Extract `FeedbackDialog` out of `App.tsx` into a focused module
- Mock runtime: in-memory store for demos/tests when `VITE_WISEEFF_RUNTIME_MODE=mock`

### Admin UI

- Route `/feedback-admin`, `PageKey: feedback-admin`, group utility next to 审计中心
- Visible only to admin (frontend gate + backend enforcement)
- Pattern: insight bar (e.g. open count) + filters + `DataTable` + Sheet drawer detail
- Columns: status, type, page title/path, description snippet, submitter, attachment count, createdAt
- Drawer: full fields, image preview (fetch content endpoint), edit `adminNote`, actions:
  - open → 「开始处理」→ `in_progress`
  - in_progress → 「关闭」→ `closed`
  - closed: read-only

Frontend wiring: `application/ports` → `infrastructure/http/productFeedbackClient` → page/actions; pages must not own raw `fetch`.

## Error Handling

| Case | Behavior |
| --- | --- |
| Inactive / unauthenticated submit | 401/403 |
| Attachment over limit / bad MIME | 400; dialog shows field-level message |
| Non-admin list/patch/content | 403 |
| Illegal status transition | 400 with explicit validation message |
| Cross-org id guessing | **404** (same as missing id); never leak another org’s content |

## Testing

- Unit: schemas, policy, status machine, repository inserts, service audit + ObjectStore put
- Frontend: dialog multi-image + submit success/error; admin filter + status update + image preview
- Browser (`playwright-cli` / acceptance as appropriate): submit from a real page, confirm row + images in `/feedback-admin`, console clean on changed routes; desktop viewport minimum; follow AGENTS frontend verification matrix when implementing UI

## Documentation Impact

Same change should update:

- `docs/design-docs/api-contract.md` (+ zh-CN)
- `docs/design-docs/domain-model.md` (+ zh-CN)
- Brief product-scope note that Internal Beta feedback is a supported platform utility
- Generated schema / OpenAPI as produced by existing pipelines

## Out of Scope (v1)

- Assignee, priority, comment threads, notifications
- Status reopen / reverse transitions
- Non-admin reviewers (`feedback:manage`)
- Guest / anonymous submit
- Using Audit Center as the sole review UI
- Non-image attachments (video, logs as files, etc.)
- Changing log-analysis feedback behavior

## Success Criteria

1. Active users can submit feedback with 0–5 images; rows and bytes persist in DB + ObjectStore.
2. Admins can list, filter, view detail/images, advance status, and set notes on `/feedback-admin`, with audit events.
3. Non-admins cannot see the admin entry and cannot call admin APIs successfully.
4. Existing log feedback paths remain unchanged.
