# Product Feedback (Internal Beta 问题反馈) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prefer `superpowers:test-driven-development` for behavior and security-sensitive code.

**Goal:** Persist sidebar **问题反馈** (multi-image) via a new `product-feedback` API module, and ship an admin-only lightweight triage page at `/feedback-admin`.

**Architecture:** New backend module (`routes → schemas → policy → service → repository`) with tables `product_feedback` and `product_feedback_attachments`, reusing the shared logs `ObjectStore` for image bytes. Frontend extracts `FeedbackDialog`, adds `ProductFeedbackRepository` + HTTP/mock clients, and a LogAdmin-style `/feedback-admin` DataTable + Sheet. Keep **log analysis feedback** completely separate.

**Tech Stack:** PostgreSQL migration, TypeScript API (Vitest), React + Radix Dialog/Sheet, Vite frontend ports/clients, Playwright acceptance / `playwright-cli` UI verification.

**Design spec:** [`docs/superpowers/specs/2026-07-08-product-feedback-design.md`](../../superpowers/specs/2026-07-08-product-feedback-design.md)

---

## File Map

| Path | Responsibility |
| --- | --- |
| `server/migrations/0038_product_feedback.sql` | Tables + indexes |
| `server/modules/product-feedback/types.ts` | Domain types / DTO shapes |
| `server/modules/product-feedback/schemas.ts` | Zod create/list/patch bodies |
| `server/modules/product-feedback/policy.ts` | Active-user submit; `admin:access` for admin routes |
| `server/modules/product-feedback/repository.ts` | SQL insert/list/get/patch + attachments |
| `server/modules/product-feedback/service.ts` | Authz, ObjectStore put, limits, status machine, audit |
| `server/modules/product-feedback/routes.ts` | HTTP handlers + binary content response |
| `server/modules/product-feedback/*.test.ts` | Unit/route tests |
| `server/modules/contracts/routeManifest.ts` | Register 5 routes |
| `server/app.ts` | `registerProductFeedbackRoutes(..., { db, objectStore, getAuth })` |
| `src/domain/productFeedback/types.ts` | Frontend domain types + UI label maps |
| `src/application/ports/ProductFeedbackRepository.ts` | Port interface |
| `src/infrastructure/http/productFeedbackClient.ts` | API client (base64 like logs) |
| `src/infrastructure/mock/mockProductFeedbackRepository.ts` | In-memory mock |
| `src/features/product-feedback/FeedbackDialog.tsx` | Extracted + multi-image submit UI |
| `src/features/product-feedback/FeedbackAdminPage.tsx` | Admin list + drawer |
| `src/features/product-feedback/FeedbackAdminDrawer.tsx` | Detail / status actions / images |
| `src/App.tsx` | Mount extracted dialog; remove inline stub |
| `src/appConfig.ts`, `src/app/routes.tsx`, `src/app/permissions.ts` | Route + admin gate |
| Docs / OpenAPI / coverage maps | Per Documentation Impact Matrix |

**ObjectStore note:** Do **not** extend `ObjectStore.put` for nested paths. Call existing `put({ organizationId, fileName, contentType, bytes })` and persist the returned `storageKey` / `checksumSha256` on attachment rows. Spec path convention is aspirational; storage keys from the shared store are authoritative.

---

## Git & PR Workflow

| Role | Branch | Actions |
| --- | --- | --- |
| **This plan + design** | Already on `main` (design commit) / plan docs branch if split | Docs only |
| **Implementation** | `feat/product-feedback` from latest `main` | All code + docs updates |
| **Implementation subagents** | Same feature branch | Commit on branch; **must not** open/merge PRs or push to `main` |
| **Parent agent** | — | Review, `gh pr create`, merge, sync local `main` |

One feature branch for the full vertical slice (backend + Dialog + admin page) unless size forces a backend-first PR then frontend PR on the same branch series.

---

## Implementation Tasks

### Task 0: Branch + register plan

**Files:**
- Create: this plan under `docs/exec-plans/active/` and `docs/superpowers/plans/`
- Modify: `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, `docs/exec-plans/tech-debt-tracker.md` (+ zh-CN)

- [ ] **Step 1: Create feature branch from main**

```bash
git fetch origin
git checkout main
git pull origin main
git checkout -b feat/product-feedback
```

- [ ] **Step 2: Link plan in `docs/PLANS.md` Current Active Plan list**

Add:

```markdown
- `exec-plans/active/2026-07-08-product-feedback.md`: Internal Beta 问题反馈 — persist sidebar feedback with multi-image ObjectStore attachments and admin triage at `/feedback-admin`.
```

Mirror in `docs/zh-CN/PLANS.md`.

- [ ] **Step 3: Register TD-036**

In `docs/exec-plans/tech-debt-tracker.md` Open table:

```markdown
| TD-036 | Product Feedback | Sidebar「问题反馈」is UI-only fake submit; no admin triage page. | Internal beta reports are lost; operators cannot track 待处理→处理中→已关闭. | Implement `docs/exec-plans/active/2026-07-08-product-feedback.md` on `feat/product-feedback`. |
```

Mirror zh-CN tracker.

- [ ] **Step 4: Commit plan registration**

```bash
git add docs/exec-plans/active/2026-07-08-product-feedback.md \
  docs/superpowers/plans/2026-07-08-product-feedback.md \
  docs/PLANS.md docs/zh-CN/PLANS.md \
  docs/exec-plans/tech-debt-tracker.md docs/zh-CN/exec-plans/tech-debt-tracker.md
git add -f docs/superpowers/plans/2026-07-08-product-feedback.md
git commit -m "$(cat <<'EOF'
docs: add product feedback implementation plan

Register TD-036 and active plan for Internal Beta 问题反馈 persistence
and /feedback-admin triage.

EOF
)"
```

---

### Task 1: Migration + repository (TDD)

**Files:**
- Create: `server/migrations/0038_product_feedback.sql`
- Create: `server/modules/product-feedback/types.ts`
- Create: `server/modules/product-feedback/repository.ts`
- Test: `server/modules/product-feedback/repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { insertFeedback, listFeedback, getFeedbackById, updateFeedback, insertAttachments } from "./repository";

function auth() {
  return {
    organization: { id: "org-1" },
    user: { id: "user-1", isActive: true },
    permissions: ["admin:access"]
  } as const;
}

describe("product-feedback repository", () => {
  it("insertFeedback persists core fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { query } as never;
    await insertFeedback(db, auth() as never, {
      id: "fb-1",
      pagePath: "/parameters",
      pageTitle: "项目参数用户工作台",
      feedbackType: "experience",
      description: "按钮挤在一起",
      status: "open"
    });
    expect(query.mock.calls[0][0]).toContain("insert into product_feedback");
    expect(query.mock.calls[0][1]).toEqual([
      "fb-1",
      "org-1",
      "user-1",
      "/parameters",
      "项目参数用户工作台",
      "experience",
      "按钮挤在一起",
      "open"
    ]);
  });

  it("getFeedbackById returns null when missing", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never;
    expect(await getFeedbackById(db, auth() as never, "missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
npm run test:server -- server/modules/product-feedback/repository.test.ts
```

Expected: fail to resolve `./repository` or exports.

- [ ] **Step 3: Add migration**

```sql
-- server/migrations/0038_product_feedback.sql
create table if not exists product_feedback (
  id uuid primary key,
  organization_id text not null references organizations(id),
  submitter_user_id text not null references users(id),
  page_path text not null,
  page_title text not null,
  feedback_type text not null check (feedback_type in ('experience', 'data', 'export_submit', 'feature')),
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_feedback_org_created_idx
  on product_feedback (organization_id, created_at desc, id desc);

create index if not exists product_feedback_org_status_idx
  on product_feedback (organization_id, status, created_at desc);

create table if not exists product_feedback_attachments (
  id uuid primary key,
  feedback_id uuid not null references product_feedback(id) on delete cascade,
  organization_id text not null references organizations(id),
  storage_key text not null,
  file_name text not null,
  content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes > 0),
  checksum text not null,
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create index if not exists product_feedback_attachments_feedback_idx
  on product_feedback_attachments (feedback_id, sort_order);
```

- [ ] **Step 4: Implement `types.ts` + `repository.ts`**

Domain enums:

```ts
export const feedbackTypes = ["experience", "data", "export_submit", "feature"] as const;
export const feedbackStatuses = ["open", "in_progress", "closed"] as const;
```

Repository functions (minimal): `insertFeedback`, `insertAttachments`, `getFeedbackById` (join attachments ordered by `sort_order`), `listFeedback` (filters + cursor on `(created_at, id)`), `updateFeedback` (`status`, `admin_note`, `updated_at`). Always filter by `organization_id` from auth.

- [ ] **Step 5: Re-run repository tests — expect PASS**

```bash
npm run test:server -- server/modules/product-feedback/repository.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add server/migrations/0038_product_feedback.sql server/modules/product-feedback/
git commit -m "feat(product-feedback): add migration and repository"
```

---

### Task 2: Schemas, policy, service (TDD)

**Files:**
- Create: `server/modules/product-feedback/schemas.ts`, `policy.ts`, `service.ts`
- Test: `schemas.test.ts`, `policy.test.ts`, `service.test.ts`

- [ ] **Step 1: Failing schema tests**

```ts
import { describe, expect, it } from "vitest";
import { createProductFeedbackBodySchema, patchProductFeedbackBodySchema } from "./schemas";

it("rejects more than 5 attachments", () => {
  const attachments = Array.from({ length: 6 }, (_, i) => ({
    fileName: `a${i}.png`,
    contentType: "image/png",
    contentBase64: Buffer.from("x").toString("base64")
  }));
  expect(
    createProductFeedbackBodySchema.safeParse({
      pagePath: "/parameters",
      pageTitle: "t",
      feedbackType: "experience",
      description: "desc",
      attachments
    }).success
  ).toBe(false);
});

it("rejects patch on empty body", () => {
  expect(patchProductFeedbackBodySchema.safeParse({}).success).toBe(false);
});
```

- [ ] **Step 2: Implement schemas**

Create body:

- `pagePath` string 1–500
- `pageTitle` string 1–200
- `feedbackType` enum
- `description` string 1–4000
- `attachments` optional array max 5 of `{ fileName, contentType: png|jpeg|webp, contentBase64 }`

List query: `status`, `feedbackType`, `q`, `pagePath` (prefix), `createdFrom`, `createdTo`, `cursor`, `limit`

Patch body: at least one of `status` | `adminNote` (adminNote max 2000, nullable clear if needed — allow string empty → store null)

- [ ] **Step 3: Policy**

```ts
export function requireProductFeedbackSubmit(auth: AuthContext) {
  if (!auth.user.isActive) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { reason: "inactive" });
  }
}

export function requireProductFeedbackAdmin(auth: AuthContext) {
  if (!auth.user.isActive || !auth.permissions.includes("admin:access")) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403, { permission: "admin:access" });
  }
}
```

- [ ] **Step 4: Service tests (limits + status machine + audit)**

Cover:

1. Inactive submit → 403
2. Non-admin list → 403
3. Create with 2 images → ObjectStore.put ×2, insert attachments, audit `product-feedback-create`
4. Single image > 5MB → 400
5. Total attachments > 15MB → 400
6. `open` → `in_progress` ok; `open` → `closed` → 400; patch when `closed` → 400
7. Cross-org get → null / service throws NOT_FOUND 404
8. Update emits `product-feedback-update` audit

Mock `ObjectStore`:

```ts
const objectStore = {
  put: vi.fn(async (input) => ({
    storageKey: `${input.organizationId}/${input.fileName}`,
    fileName: input.fileName,
    contentType: input.contentType,
    fileSizeBytes: input.bytes.byteLength,
    checksumSha256: "abc"
  })),
  get: vi.fn()
};
```

Status helper:

```ts
const ALLOWED: Record<string, string[]> = {
  open: ["in_progress"],
  in_progress: ["closed"],
  closed: []
};
```

- [ ] **Step 5: Implement service; tests PASS**

```bash
npm run test:server -- server/modules/product-feedback/
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(product-feedback): schemas, policy, and service"
```

---

### Task 3: HTTP routes + manifest + app wiring

**Files:**
- Create: `server/modules/product-feedback/routes.ts`, `routes.test.ts`
- Modify: `server/modules/contracts/routeManifest.ts`, `server/app.ts`
- OpenAPI freshness via existing contract scripts

- [ ] **Step 1: Failing route tests**

Mirror `server/modules/logs/routes.test.ts` pattern: mock service functions, assert:

- `POST /api/v1/product-feedback` → create, returns `{ item }`
- `GET /api/v1/product-feedback` → `{ items, nextCursor? }`
- `GET /api/v1/product-feedback/:id`
- `PATCH /api/v1/product-feedback/:id`
- `GET .../attachments/:attachmentId/content` returns bytes + `Content-Type`

- [ ] **Step 2: Implement routes**

```ts
router.post("/api/v1/product-feedback", async (request) => {
  const auth = await getAuth(request);
  const body = createProductFeedbackBodySchema.parse(await request.json());
  const item = await createProductFeedback(db, auth, body, { objectStore, requestId });
  return json({ item });
});
```

Content route: load attachment metadata (org-scoped) → `objectStore.get(storageKey)` → binary response. Missing → 404.

- [ ] **Step 3: Register in routeManifest**

```ts
{ id: "productFeedback.create", method: "POST", path: "/api/v1/product-feedback", module: "product-feedback", stability: "mvp" },
{ id: "productFeedback.list", method: "GET", path: "/api/v1/product-feedback", module: "product-feedback", stability: "mvp" },
{ id: "productFeedback.get", method: "GET", path: "/api/v1/product-feedback/:id", module: "product-feedback", stability: "mvp" },
{ id: "productFeedback.patch", method: "PATCH", path: "/api/v1/product-feedback/:id", module: "product-feedback", stability: "mvp" },
{
  id: "productFeedback.attachmentContent",
  method: "GET",
  path: "/api/v1/product-feedback/:id/attachments/:attachmentId/content",
  module: "product-feedback",
  stability: "mvp"
},
```

- [ ] **Step 4: Wire `registerProductFeedbackRoutes` in `server/app.ts` with `objectStore`**

- [ ] **Step 5: Run**

```bash
npm run test:server -- server/modules/product-feedback
npm run contract:check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(product-feedback): HTTP routes and contract registration"
```

---

### Task 4: Frontend port + HTTP + mock clients

**Files:**
- Create: `src/domain/productFeedback/types.ts`
- Create: `src/application/ports/ProductFeedbackRepository.ts`
- Create: `src/infrastructure/http/productFeedbackClient.ts` (+ `.test.ts`)
- Create: `src/infrastructure/mock/mockProductFeedbackRepository.ts`
- Wire factory wherever other repositories are chosen (search `createHttpLogAnalysisRepository` / runtime bootstrap)

- [ ] **Step 1: Port interface**

```ts
export type ProductFeedbackSubmitInput = {
  pagePath: string;
  pageTitle: string;
  feedbackType: ProductFeedbackType;
  description: string;
  files: File[]; // 0–5
};

export type ProductFeedbackListQuery = {
  status?: ProductFeedbackStatus;
  feedbackType?: ProductFeedbackType;
  q?: string;
  pagePath?: string;
  createdFrom?: string;
  createdTo?: string;
  cursor?: string;
};

export interface ProductFeedbackRepository {
  submit(input: ProductFeedbackSubmitInput): Promise<ProductFeedback>;
  list(query?: ProductFeedbackListQuery): Promise<{ items: ProductFeedback[]; nextCursor?: string }>;
  get(id: string): Promise<ProductFeedback | null>;
  update(id: string, patch: { status?: ProductFeedbackStatus; adminNote?: string | null }): Promise<ProductFeedback>;
  getAttachmentObjectUrl(feedbackId: string, attachmentId: string): Promise<string>; // blob URL for <img>
}
```

- [ ] **Step 2: HTTP client tests** — assert `POST` body encodes `contentBase64`, list query params, patch path.

Reuse `fileToBase64` pattern from `logClient.ts` (extract shared helper only if trivial; otherwise duplicate the small loop to avoid drive-by refactors).

- [ ] **Step 3: Mock repository** — memory array; `getAttachmentObjectUrl` uses existing blob preview when file still in memory for mock-only, or placeholder data URL.

- [ ] **Step 4: Run**

```bash
npm test -- productFeedbackClient
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(product-feedback): frontend port and HTTP client"
```

---

### Task 5: FeedbackDialog extract + multi-image submit

**Files:**
- Create: `src/features/product-feedback/FeedbackDialog.tsx` (+ test)
- Modify: `src/App.tsx` — import extracted dialog; pass repository or hook
- Update: existing `src/App.test.tsx` feedback cases

- [ ] **Step 1: Failing tests**

1. Pasting two images shows two thumbnails; third… up to 5; 6th blocked with message.
2. Empty description → submit disabled.
3. On submit, repository `submit` called with files; success message shown.
4. On API error, form retained + error text.

- [ ] **Step 2: Implement multi-image Dialog**

- State: `File[]` + object URLs for preview (revoke on remove/unmount)
- Paste handler appends supported images until cap 5
- Map UI labels → API enums (`体验问题` → `experience`, etc.)
- Submit button loading while pending

- [ ] **Step 3: Replace inline `FeedbackDialog` in `App.tsx`

- [ ] **Step 4: Run**

```bash
npm test -- App.test FeedbackDialog
npm run build
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(product-feedback): multi-image FeedbackDialog with API submit"
```

---

### Task 6: Feedback admin page

**Files:**
- Create: `FeedbackAdminPage.tsx`, `FeedbackAdminDrawer.tsx` (+ tests)
- Modify: `appConfig.ts` (`PageKey`, `utilityItems`), `app/routes.tsx`, `app/permissions.ts` (`"feedback-admin": "admin"`)
- CSS: reuse admin patterns; add minimal feature CSS only if needed

- [ ] **Step 1: Failing page tests**

- Renders table rows from repository list
- Filter by status calls list with `status: "open"`
- Drawer 「开始处理」 calls `update(id, { status: "in_progress" })`
- Closed item shows read-only actions
- Non-admin: page not reachable via `canAccessPage` (unit assert permissions map)

- [ ] **Step 2: Implement page**

Pattern from `LogAdminPage.tsx`:

- Insight: count of `open`
- Filters: status, type, q
- Columns: status, type, page, description snippet, submitter id/name if available, attachment count, createdAt
- Drawer: details, note textarea, images via `getAttachmentObjectUrl`, status buttons

Submitter display: until user join exists, show `submitterUserId`; optional follow-up to join users table — YAGNI unless list join is easy in repository (`left join users`).

Prefer repository select joining `users.email` or display name if a common pattern exists; otherwise show user id.

- [ ] **Step 3: Navigation**

```ts
// utilityItems
{ label: "问题反馈", icon: MessageSquareWarning /* or MessageSquarePlus */, path: "/feedback-admin" }
```

```ts
// permissions
"feedback-admin": "admin"
```

- [ ] **Step 4: Run**

```bash
npm test -- FeedbackAdmin
npm run build
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(product-feedback): admin triage page at /feedback-admin"
```

---

### Task 7: Browser verification + acceptance IDs

**Files:**
- Create: `e2e/acceptance/product-feedback.acceptance.spec.ts` (or API+UI hybrid like other modules)
- Modify: `docs/developer/browser-acceptance-coverage-map.md`
- Modify: `docs/developer/user-operation-coverage-matrix.md`
- Modify: `e2e/acceptance/requirements.ts` / `operationMatrix.ts` if required by repo patterns

**Requirement / operation IDs (new):**

| ID | Behavior |
| --- | --- |
| `PFB-SUBMIT-001` | Active user submits feedback with description (+ optional images) from sidebar; API persists; success UI |
| `PFB-ADMIN-001` | Admin lists `/feedback-admin`, opens detail, advances `open → in_progress → closed`, sets note |
| `PFB-AUTHZ-001` | Non-admin cannot open `/feedback-admin`; admin APIs return 403 |

- [ ] **Step 1: Add coverage map rows + matrix rows**

- [ ] **Step 2: Automate at least API-level happy path in acceptance (create + list + patch + audit kind); UI via Playwright where stable**

- [ ] **Step 3: Manual `playwright-cli` gate (required by AGENTS for UI)**

```bash
npm run dev   # + API if needed
playwright-cli -s=product-feedback open http://127.0.0.1:5173/parameters
playwright-cli -s=product-feedback resize 1440 900
# open 问题反馈, type description, submit, screenshot
playwright-cli -s=product-feedback open http://127.0.0.1:5173/feedback-admin
playwright-cli -s=product-feedback snapshot
playwright-cli -s=product-feedback screenshot --filename=work/ui-checks/feedback-admin-desktop.png
playwright-cli -s=product-feedback resize 768 1024
playwright-cli -s=product-feedback screenshot --filename=work/ui-checks/feedback-admin-tablet.png
playwright-cli -s=product-feedback resize 390 844
playwright-cli -s=product-feedback screenshot --filename=work/ui-checks/feedback-admin-mobile.png
playwright-cli -s=product-feedback console error
playwright-cli -s=product-feedback close
```

Record evidence paths in the PR description.

- [ ] **Step 4: Commit**

```bash
git commit -am "test(product-feedback): acceptance coverage for submit and admin triage"
```

---

### Task 8: Documentation gate

**Files:** per Documentation Impact Matrix below.

- [ ] **Step 1: Update English + Chinese docs listed as Update**

- [ ] **Step 2: Update `docs/generated/db-schema.md` for the two new tables**

- [ ] **Step 3: Run**

```bash
npm run docs:check
npm run contract:check
npm run test:server -- server/modules/product-feedback
npm test -- FeedbackDialog FeedbackAdmin productFeedback
npm run build
```

- [ ] **Step 4: Mark TD-036 completed (or leave Open until PR merge — prefer move to Completed with plan link when feature lands)**

- [ ] **Step 5: Commit docs**

```bash
git commit -am "docs: product feedback API, domain, and coverage maps"
```

---

## Verification Matrix

| Gate | Command / evidence |
| --- | --- |
| Server tests | `npm run test:server -- server/modules/product-feedback` |
| Frontend tests | `npm test -- FeedbackDialog FeedbackAdmin productFeedback` |
| Contract | `npm run contract:check` |
| Build | `npm run build` |
| Docs | `npm run docs:check` |
| Browser | `playwright-cli` viewports 1440×900, 768×1024, 390×844 + acceptance IDs above |
| Authz | Non-admin 403 on list/patch/content; inactive submit 403 |

## Success Criteria

1. Active user submit with 0–5 images persists DB + ObjectStore bytes.
2. Admin `/feedback-admin` list/filter/detail/images/status/note + audit events.
3. Non-admin blocked in UI and API.
4. Log feedback behavior unchanged.
5. Docs/contract/coverage maps updated; `docs:check` greppen.

---

## Documentation Impact Matrix

| Area | Status | Files | Notes |
| --- | --- | --- | --- |
| Repository maps | Review | `AGENTS.md`, `docs/README.md` | Mention product-feedback module only if maps list domains; else No change with evidence |
| Planning docs | Update | `docs/PLANS.md`, `docs/zh-CN/PLANS.md`, this plan, tech-debt trackers | TD-036 |
| Product specs | Update | `docs/product-specs/prototype-functional-spec.md` (+ zh-CN if paired) | Sidebar Internal Beta feedback + admin triage |
| Architecture docs | Update | `docs/design-docs/api-contract.md`, `docs/design-docs/domain-model.md`, zh-CN companions; Review `ARCHITECTURE.md` | New endpoint group + entities |
| Quality/testing docs | Update | `docs/developer/browser-acceptance-coverage-map.md`, `docs/developer/user-operation-coverage-matrix.md`; Review `docs/design-docs/testing-strategy.md` | New PFB-* IDs |
| Reliability/runbooks | No change | — | No new ops procedure in v1 |
| Security/governance docs | Update | `docs/SECURITY.md` (+ zh-CN if required pair) | Active submit; admin review; attachment limits; org isolation |
| Frontend/design docs | Update | `docs/FRONTEND.md` (+ zh-CN) | Port, Dialog, `/feedback-admin` |
| Generated artifacts | Update | `docs/generated/db-schema.md`; OpenAPI via contract check | Tables + routes |
| References | No change | — | Unless a compact DTO note is already standard |
| Chinese developer docs | Update | Matching zh-CN pages for every English Update above | Bilingual pair rule |

## Documentation Update Gate

- Blocking: every `Update`/`Review` row addressed before moving plan to `completed/`.
- `npm run docs:check` must pass.
- Security + API contract land on same branch as routes.
- PFB acceptance IDs exist before merge.
- Deferred work (reopen status, `feedback:manage`, notifications on new feedback) → tech-debt entries, not silent scope creep.

## UI Interaction Automation Review

Changes: sidebar Dialog submit, new admin route/list/drawer/status actions.

- **Specs:** `e2e/acceptance/product-feedback.acceptance.spec.ts`
- **Requirement IDs:** `PFB-SUBMIT-001`, `PFB-ADMIN-001`, `PFB-AUTHZ-001`
- **Operation IDs:** same
- **Evidence:** acceptance run + `playwright-cli` screenshots under `work/ui-checks/` for Dialog + admin at three viewports; console error check clean

## Out of Scope (do not implement in this plan)

- Assignee / priority / comments / notifications to admins on submit
- Status reopen or reverse transitions
- `feedback:manage` non-admin reviewers
- Guest-anonymous / unauthenticated submit
- Extending ObjectStore key layout API
- Changing `log_feedback` / logs feedback UI

---

**Plan status:** Active — ready for implementation on `feat/product-feedback`.
