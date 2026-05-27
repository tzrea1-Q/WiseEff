# WiseEff M1 Parameter Management MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把参数管理做成 WiseEff 第一个真实可持久化、可审计、可刷新保留状态的业务闭环。

**Architecture:** 延续 M0 的单仓库结构，在现有 `server/` 模块化后端内新增 `parameters` 模块，不做目录大迁移。后端以 PostgreSQL 为参数源 of truth，内部使用稳定英文状态码，API DTO 在 M1 继续返回现有前端可消费的中文状态标签。前端保留 mock mode，同时在 api mode 通过 `ParameterRepository` HTTP 实现加载、提交、审阅、合入和导入参数数据。

**Tech Stack:** TypeScript, Node HTTP server, PostgreSQL, Zod, React 19, Vite, Vitest, Testing Library, Playwright smoke tests.

---

## Scope Boundary

M1 includes:

- 项目、模块、参数定义、项目参数值、参数历史的数据库模型和 seed。
- 参数列表、详情、历史、草稿、提交轮次、变更请求、审阅推进、打回、合入 API。
- 批量导入最小能力：前端读取 JSON/CSV 文本后提交 API，后端生成预览、校验冲突、应用入库、写审计。
- 前端 api mode 下 `/parameter-home`、`/parameters`、`/parameter-review`、`/parameter-admin` 读取真实 API 数据。
- 参数变更闭环的后端集成测试、前端 repository/页面测试、Playwright smoke。

M1 does not include:

- 对象存储式文件上传。导入文件在浏览器端解析为 JSON payload 后提交后端。
- Agent 后端编排。Agent 在 M1 只能调用现有前端确认动作，不直接写生产状态。
- 设备网关、日志分析 worker、SSO/OIDC、多租户隔离增强。
- monorepo 目录重组。M1 结束后再评估 `apps/` 和 `packages/` 拆分。

## Success Criteria

- `VITE_WISEEFF_RUNTIME_MODE=api` 时，参数工作台刷新页面后仍显示合入后的真实值。
- 合入成功会同时更新 `project_parameter_values`、新增 `parameter_history_entries`、新增 `parameter_review_decisions`、写入 `audit_events`。
- 同一项目同一参数不能存在多个未完成变更请求。
- 高风险参数不能绕过硬件和软件审阅直接合入。
- 普通用户不能审阅，Guest 不能提交，缺少 admin 权限不能应用导入。
- `npm run test:all` 和 `npm run build` 通过。
- Playwright smoke 覆盖：查询参数、提交变更、推进审阅、合入、查看历史、审计里看到合入事件。

## Status Mapping

Backend stores stable status codes. M1 DTOs map them to the existing frontend labels to avoid a broad UI rewrite.

| Backend status | Frontend label | Meaning |
| --- | --- | --- |
| `submitted` | `待审阅` | 变更已提交，未进入指定审阅槽位 |
| `hardware_review` | `硬件Committer检视` | 等待硬件 Committer 审阅 |
| `software_review` | `软件Committer检视` | 等待软件 Committer 审阅 |
| `software_merge` | `软件User合入` | 等待软件 User 合入 |
| `merged` | `已合入` | 参数值已写入当前项目值 |
| `rejected` | `已打回` | 变更被打回 |
| `withdrawn` | `已撤回` | 提交人撤回整轮提交 |
| `stashed` | `已暂存` | 草稿已保存但未提交 |

## File Structure

Create:

- `server/migrations/0002_m1_parameters.sql`
- `scripts/seed-m1-parameters.ts`
- `server/modules/parameters/types.ts`
- `server/modules/parameters/status.ts`
- `server/modules/parameters/policy.ts`
- `server/modules/parameters/schemas.ts`
- `server/modules/parameters/repository.ts`
- `server/modules/parameters/service.ts`
- `server/modules/parameters/routes.ts`
- `server/modules/parameters/repository.test.ts`
- `server/modules/parameters/service.test.ts`
- `server/modules/parameters/routes.test.ts`
- `src/infrastructure/http/parameterDtos.ts`
- `src/infrastructure/http/parameterDtos.test.ts`
- `src/infrastructure/http/parameterClient.ts`
- `src/infrastructure/http/parameterClient.test.ts`
- `src/application/parameters/parameterRuntime.ts`
- `src/application/parameters/parameterRuntime.test.ts`
- `e2e/parameter-management.api.spec.ts`
- `playwright.config.ts` if the repository still has no Playwright config when Task 12 starts.

Modify:

- `server/shared/http/router.ts`
- `server/shared/http/router.test.ts`
- `server/shared/http/server.ts`
- `server/shared/database/client.ts`
- `server/shared/database/client.test.ts`
- `server/app.ts`
- `server/index.ts`
- `server/config/env.ts`
- `src/application/ports/ParameterRepository.ts`
- `src/infrastructure/http/dto.ts`
- `src/infrastructure/http/apiClient.ts`
- `src/infrastructure/mock/mockParameterRepository.ts`
- `src/App.tsx`
- `src/app/routes.tsx`
- `src/ParametersPage.tsx`
- `src/ParameterAdminPage.tsx`
- `src/ParameterManagementHomePage.tsx`
- `src/App.test.tsx`
- `src/ParametersPage.test.tsx`
- `src/ParameterAdminPage.test.tsx`
- `src/ParameterManagementHomePage.test.tsx`
- `docs/design-docs/api-contract.md`
- `docs/generated/db-schema.md`
- `docs/FRONTEND.md`
- `docs/SECURITY.md`
- `docs/QUALITY_SCORE.md`
- `README.md`
- `package.json`
- `.github/workflows/ci.yml`

---

### Task 1: Upgrade HTTP And Database Foundations

**Purpose:** M1 endpoints need query strings, dynamic path params, and real transactions. Do this before adding parameter routes.

**Files:**
- Modify: `server/shared/http/router.ts`
- Modify: `server/shared/http/router.test.ts`
- Modify: `server/shared/http/server.ts`
- Modify: `server/shared/database/client.ts`
- Modify: `server/shared/database/client.test.ts`

- [ ] **Step 1: Write failing router tests**

Add tests proving all existing exact routes still work, plus dynamic params and query parsing:

```ts
it("matches dynamic route params without breaking exact routes", async () => {
  const router = createRouter();
  router.get("/api/v1/parameters/:parameterId/history", async (request) => ({
    status: 200,
    body: {
      parameterId: request.params.parameterId,
      limit: request.query.limit
    }
  }));

  const response = await router.handle({
    method: "GET",
    path: "/api/v1/parameters/aurora-fast-charge-current/history",
    params: {},
    query: { limit: "25" },
    headers: {},
    requestId: "req-1",
    body: undefined
  });

  expect(response.body).toEqual({
    parameterId: "aurora-fast-charge-current",
    limit: "25"
  });
});
```

Run:

```bash
npm run test:server -- server/shared/http/router.test.ts
```

Expected: FAIL because `RouteRequest` has no `params` or `query` and the router only performs exact map lookup.

- [ ] **Step 2: Implement route matching**

In `server/shared/http/router.ts`:

- Add `params: Record<string, string>` and `query: Record<string, string | string[]>` to `RouteRequest`.
- Store route entries as `{ method, pattern, segments, handler }` instead of a single map key.
- Match exact static segments first and `:paramName` segments second.
- Preserve `ApiError("NOT_FOUND", "Route not found.", 404, { path })` for misses.

Keep public registration methods unchanged:

```ts
router.get("/api/v1/parameters/:parameterId", handler);
router.post("/api/v1/parameter-change-requests/:requestId/review", handler);
```

- [ ] **Step 3: Parse query strings in the HTTP server**

In `server/shared/http/server.ts`, convert `url.searchParams` into `request.query`. Repeated params become arrays:

```ts
function parseQuery(searchParams: URLSearchParams) {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (Array.isArray(existing)) query[key] = [...existing, value];
    else if (existing !== undefined) query[key] = [existing, value];
    else query[key] = value;
  }
  return query;
}
```

- [ ] **Step 4: Add transaction support**

In `server/shared/database/client.ts`, introduce:

```ts
export type Database = Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
};
```

`createPostgresDatabase` must use `pool.connect()` for transactions so `begin`, work, and `commit` run on the same client. `createDatabase` can provide a test fallback that issues `begin`, calls `fn`, then commits or rolls back.

- [ ] **Step 5: Run foundation tests**

Run:

```bash
npm run test:server -- server/shared/http/router.test.ts server/shared/database/client.test.ts server/app.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/shared/http/router.ts server/shared/http/router.test.ts server/shared/http/server.ts server/shared/database/client.ts server/shared/database/client.test.ts
git commit -m "feat: support api route params and transactions"
```

---

### Task 2: Lock M1 API Contract And Frontend Port Shape

**Purpose:** Freeze the contract before database and UI work so server DTOs, frontend DTOs, and tests do not drift.

**Files:**
- Modify: `docs/design-docs/api-contract.md`
- Modify: `src/application/ports/ParameterRepository.ts`
- Create: `src/infrastructure/http/parameterDtos.ts`
- Create: `src/infrastructure/http/parameterDtos.test.ts`
- Create: `server/modules/parameters/types.ts`
- Create: `server/modules/parameters/schemas.ts`
- Create: `server/modules/parameters/status.ts`

- [ ] **Step 1: Expand `ParameterRepository`**

Update `src/application/ports/ParameterRepository.ts` to include the M1 surface:

```ts
export type ParameterDraftDto = {
  id: string;
  projectId: string;
  parameterId: string;
  targetValue: string;
  reason: string;
  updatedAt: string;
};

export type ReviewParameterChangeInput = {
  requestId: string;
  decision: "advance" | "reject";
  note?: string;
  expectedVersion?: number;
};

export type ParameterImportPreviewInput = {
  projectId: string;
  sourceName: string;
  items: ParameterImportSourceItem[];
};

export interface ParameterRepository {
  listProjects(): Promise<ProjectSummary[]>;
  listParameters(query?: ParameterListQuery): Promise<ParameterRecord[]>;
  getParameter(parameterId: string): Promise<ParameterRecord>;
  listParameterHistory(parameterId: string): Promise<ParameterHistoryEntry[]>;
  listDrafts(projectId?: string): Promise<ParameterDraftDto[]>;
  saveDraft(input: SaveParameterDraftInput): Promise<ParameterDraftDto>;
  deleteDraft(draftId: string): Promise<void>;
  listChangeRequests(query?: ChangeRequestListQuery): Promise<ChangeRequest[]>;
  listSubmissionRounds(query?: SubmissionRoundListQuery): Promise<ParameterSubmissionRound[]>;
  submitParameterChanges(input: SubmitParameterChangesInput): Promise<ParameterSubmissionRound>;
  reviewChange(input: ReviewParameterChangeInput): Promise<ChangeRequest>;
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<ParameterImportBatchDto>;
}
```

Keep existing methods and return types compatible where current mock tests expect them.

- [ ] **Step 2: Add DTO mapper tests**

In `src/infrastructure/http/parameterDtos.test.ts`, cover:

- project DTO to `ProjectSummary`;
- parameter DTO to `ParameterRecord`;
- change request DTO to `ChangeRequest`;
- submission round DTO to `ParameterSubmissionRound`;
- import preview DTO summary counts.

Run:

```bash
npm test -- src/infrastructure/http/parameterDtos.test.ts
```

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Implement frontend DTO mappers**

Create `src/infrastructure/http/parameterDtos.ts`. Map server responses to existing frontend domain labels. Do not import `src/mockData.ts`; import types from `src/domain/parameters/types.ts` and the port file.

Required DTO names:

- `ProjectDto`
- `ParameterRecordDto`
- `ParameterHistoryEntryDto`
- `ParameterDraftDto`
- `ChangeRequestDto`
- `ParameterSubmissionRoundDto`
- `ParameterImportBatchDto`

- [ ] **Step 4: Add server schemas**

Create `server/modules/parameters/schemas.ts` with Zod schemas for:

- `listParametersQuerySchema`
- `saveDraftBodySchema`
- `submitRoundBodySchema`
- `reviewChangeBodySchema`
- `createImportBatchBodySchema`
- `applyImportBatchBodySchema`

Validation rules:

- `projectId`, `parameterId`, `requestId`, and `batchId` are non-empty strings.
- `targetValue` and `reason` are non-empty on submit.
- `decision` is exactly `advance` or `reject`.
- `expectedVersion` is a positive integer when present.
- import items require `name`, `module`, `risk`, `unit`, `range`, and at least one value field.

- [ ] **Step 5: Document final endpoint shape**

Update `docs/design-docs/api-contract.md` parameter section with these exact M1 endpoints:

```text
GET    /api/v1/projects
GET    /api/v1/projects/:projectId/modules
GET    /api/v1/parameters
GET    /api/v1/parameters/:parameterId
GET    /api/v1/parameters/:parameterId/history
POST   /api/v1/parameter-drafts
GET    /api/v1/parameter-drafts/mine
DELETE /api/v1/parameter-drafts/:draftId
POST   /api/v1/parameter-submission-rounds
GET    /api/v1/parameter-submission-rounds
GET    /api/v1/parameter-change-requests
POST   /api/v1/parameter-change-requests/:requestId/review
POST   /api/v1/parameter-import-batches
POST   /api/v1/parameter-import-batches/:batchId/apply
```

- [ ] **Step 6: Run contract tests**

Run:

```bash
npm test -- src/infrastructure/http/parameterDtos.test.ts src/infrastructure/http/dto.test.ts
npm run test:server -- server/modules/parameters
```

Expected after implementation: frontend DTO tests PASS; server command PASS or reports no parameter tests until Task 4 adds them.

- [ ] **Step 7: Commit**

```bash
git add docs/design-docs/api-contract.md src/application/ports/ParameterRepository.ts src/infrastructure/http/parameterDtos.ts src/infrastructure/http/parameterDtos.test.ts server/modules/parameters/types.ts server/modules/parameters/schemas.ts server/modules/parameters/status.ts
git commit -m "feat: define m1 parameter api contract"
```

---

### Task 3: Add M1 Parameter Schema And Seed Data

**Purpose:** Create the persistent data model and seed it from the current power-management config without importing mock runtime into the production server.

**Files:**
- Create: `server/migrations/0002_m1_parameters.sql`
- Create: `scripts/seed-m1-parameters.ts`
- Modify: `docs/generated/db-schema.md`
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Add migration tests by command**

Run the current migration tests as a baseline:

```bash
npm run test:server -- server/shared/database/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 2: Create migration**

Create `server/migrations/0002_m1_parameters.sql` with these tables and indexes:

```sql
create table if not exists projects (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  code text not null,
  status text not null default 'initialized',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_modules (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  sort_order integer not null default 0,
  unique (project_id, name)
);

create table if not exists parameter_definitions (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  description text not null,
  explanation text not null,
  config_format text not null,
  module text not null,
  default_range text not null,
  unit text not null,
  risk text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists project_parameter_values (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  parameter_definition_id text not null references parameter_definitions(id),
  current_value text not null,
  recommended_value text not null,
  value_version integer not null default 1,
  updated_by_user_id text references users(id),
  updated_at timestamptz not null default now(),
  unique (project_id, parameter_definition_id)
);

create table if not exists parameter_history_entries (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  parameter_definition_id text not null references parameter_definitions(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  version integer not null,
  value text not null,
  changed_by_user_id text references users(id),
  request_id text,
  changed_at timestamptz not null default now()
);

create table if not exists parameter_drafts (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  user_id text not null references users(id),
  target_value text not null,
  reason text not null,
  updated_at timestamptz not null default now(),
  unique (project_id, project_parameter_value_id, user_id)
);

create table if not exists parameter_submission_rounds (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  submitter_user_id text not null references users(id),
  status text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parameter_change_requests (
  id text primary key,
  organization_id text not null references organizations(id),
  submission_round_id text references parameter_submission_rounds(id),
  project_id text not null references projects(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  parameter_definition_id text not null references parameter_definitions(id),
  base_version integer not null,
  current_value text not null,
  target_value text not null,
  status text not null,
  submitter_user_id text not null references users(id),
  assigned_to_user_id text references users(id),
  reviewer_note text,
  reject_reason text,
  fast_track boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists parameter_submission_items (
  id text primary key,
  organization_id text not null references organizations(id),
  submission_round_id text not null references parameter_submission_rounds(id),
  change_request_id text not null references parameter_change_requests(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  current_value text not null,
  target_value text not null,
  reason text not null
);

create table if not exists parameter_review_decisions (
  id text primary key,
  organization_id text not null references organizations(id),
  request_id text not null references parameter_change_requests(id),
  reviewer_user_id text not null references users(id),
  decision text not null,
  from_status text not null,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists parameter_import_batches (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  created_by_user_id text not null references users(id),
  source_name text not null,
  status text not null,
  summary jsonb not null,
  items jsonb not null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
```

Add indexes:

```sql
create index if not exists projects_organization_id_idx on projects(organization_id);
create index if not exists parameter_definitions_org_module_risk_idx on parameter_definitions(organization_id, module, risk);
create index if not exists project_parameter_values_project_idx on project_parameter_values(project_id, updated_at desc);
create index if not exists parameter_history_value_idx on parameter_history_entries(project_parameter_value_id, changed_at desc);
create index if not exists parameter_drafts_user_project_idx on parameter_drafts(user_id, project_id, updated_at desc);
create index if not exists parameter_change_requests_project_status_idx on parameter_change_requests(project_id, status, updated_at desc);
create unique index if not exists parameter_change_requests_open_unique_idx
  on parameter_change_requests(project_id, project_parameter_value_id)
  where status not in ('merged', 'rejected', 'withdrawn');
create index if not exists parameter_submission_rounds_project_created_idx on parameter_submission_rounds(project_id, created_at desc);
create index if not exists parameter_import_batches_project_created_idx on parameter_import_batches(project_id, created_at desc);
```

- [ ] **Step 3: Add seed script**

Create `scripts/seed-m1-parameters.ts`.

Requirements:

- Load `.env` with `dotenv/config`.
- Require `DATABASE_URL`.
- Read `src/config/power-management.json` using `fs/promises`.
- Upsert projects into `projects`.
- Upsert distinct modules into `project_modules`.
- Upsert parameter templates into `parameter_definitions`.
- Upsert each project value into `project_parameter_values` using id `${projectId}-${definitionId}`.
- Insert one initial `parameter_history_entries` row per seeded value if no history exists.
- Do not import `src/mockData.ts`.

Add script:

```json
"db:seed:m1": "tsx scripts/seed-m1-parameters.ts"
```

- [ ] **Step 4: Update generated schema and README**

Update `docs/generated/db-schema.md` with the M1 tables and indexes. Update `README.md` local setup:

```bash
npm run db:migrate
npm run db:seed:m0
npm run db:seed:m1
```

- [ ] **Step 5: Verify migration and build**

Run:

```bash
npm run build
npm run test:server
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/migrations/0002_m1_parameters.sql scripts/seed-m1-parameters.ts docs/generated/db-schema.md README.md package.json
git commit -m "feat: add m1 parameter persistence schema"
```

---

### Task 4: Implement Parameter Status, Policy, And Repository Reads

**Purpose:** Add backend read path for projects, modules, parameters, details, and history.

**Files:**
- Create: `server/modules/parameters/policy.ts`
- Create: `server/modules/parameters/repository.ts`
- Create: `server/modules/parameters/repository.test.ts`
- Modify: `server/modules/parameters/status.ts`
- Modify: `server/modules/parameters/types.ts`

- [ ] **Step 1: Write repository read tests**

In `server/modules/parameters/repository.test.ts`, create a fake `Queryable` that records SQL and returns rows. Cover:

- `listProjects` filters by organization;
- `listParameters` accepts `projectId`, `module`, `risk`, `q`, `limit`;
- `getParameterById` returns `null` when no rows;
- `listParameterHistory` orders by changed time descending.

Run:

```bash
npm run test:server -- server/modules/parameters/repository.test.ts
```

Expected: FAIL because repository functions do not exist.

- [ ] **Step 2: Implement status helpers**

In `server/modules/parameters/status.ts`, export:

```ts
export const parameterStatusLabels = {
  submitted: "待审阅",
  hardware_review: "硬件Committer检视",
  software_review: "软件Committer检视",
  software_merge: "软件User合入",
  merged: "已合入",
  rejected: "已打回",
  withdrawn: "已撤回",
  stashed: "已暂存"
} as const;

export function getNextParameterStatus(status: ParameterChangeStatus) {
  if (status === "submitted" || status === "hardware_review") return "software_review";
  if (status === "software_review") return "software_merge";
  if (status === "software_merge") return "merged";
  return status;
}
```

Add tests in `server/modules/parameters/service.test.ts` in Task 5 for transition rules.

- [ ] **Step 3: Implement backend policy**

In `server/modules/parameters/policy.ts`, export:

- `canViewParameters(auth)`
- `canEditParameters(auth)`
- `canReviewParameters(auth)`
- `canMergeParameters(auth)`
- `canAdminParameters(auth)`

Rules:

- view requires `parameter:view`;
- edit requires active user and `parameter:edit`;
- review requires active user and `parameter:review`;
- merge requires active user and one of role `software-user` or `admin`;
- import apply requires active user and `admin:access`.

- [ ] **Step 4: Implement repository reads**

In `server/modules/parameters/repository.ts`, implement:

- `listProjects(db, { organizationId })`
- `listProjectModules(db, { organizationId, projectId })`
- `listParameters(db, query)`
- `getParameterById(db, { organizationId, parameterId })`
- `listParameterHistory(db, { organizationId, parameterId })`

DTO mapping must return the frontend-shaped `ParameterRecord` fields:

- `id` is `project_parameter_values.id`;
- `name`, `description`, `explanation`, `configFormat`, `module`, `range`, `unit`, `risk` come from `parameter_definitions`;
- `currentValue`, `recommendedValue`, `updatedAtTs` come from `project_parameter_values`;
- `updatedAt` can be an ISO string in M1 API mode;
- `history` is attached for detail endpoint and empty for list rows unless requested.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:server -- server/modules/parameters/repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/modules/parameters/policy.ts server/modules/parameters/repository.ts server/modules/parameters/repository.test.ts server/modules/parameters/status.ts server/modules/parameters/types.ts
git commit -m "feat: add parameter read repository"
```

---

### Task 5: Implement Drafts And Submission Rounds

**Purpose:** Make parameter edits persist as drafts or submitted change requests.

**Files:**
- Modify: `server/modules/parameters/repository.ts`
- Modify: `server/modules/parameters/repository.test.ts`
- Create: `server/modules/parameters/service.ts`
- Create: `server/modules/parameters/service.test.ts`

- [ ] **Step 1: Write service tests**

In `server/modules/parameters/service.test.ts`, cover:

- Guest cannot save draft.
- User can save and list own draft.
- Submitting two items creates one round and two change requests.
- Submitting a parameter with an existing open request throws `ApiError("CONFLICT", ...)`.
- Submit uses the current `value_version` as `baseVersion`.

Run:

```bash
npm run test:server -- server/modules/parameters/service.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 2: Add repository write helpers**

Add repository functions:

- `listDraftsForUser`
- `upsertDraft`
- `deleteDraft`
- `createSubmissionRound`
- `createChangeRequest`
- `createSubmissionItem`
- `listSubmissionRounds`
- `listChangeRequests`
- `findOpenChangeRequest`
- `getProjectParameterForUpdate`

All write helpers receive `organizationId` and use parameterized SQL.

- [ ] **Step 3: Implement service methods**

In `server/modules/parameters/service.ts`, implement:

- `saveDraft(db, auth, input)`
- `deleteDraft(db, auth, draftId)`
- `submitParameterChanges(db, auth, input)`
- `listDrafts(db, auth, query)`
- `listSubmissionRounds(db, auth, query)`
- `listChangeRequests(db, auth, query)`

Submission transaction:

1. Check `canEditParameters(auth)`.
2. Verify all items belong to one `projectId`.
3. For each parameter, reject if an open request exists.
4. Insert `parameter_submission_rounds` status `hardware_review` when assignees exist, otherwise `submitted`.
5. Insert one `parameter_change_requests` row per item.
6. Insert one `parameter_submission_items` row per item.
7. Delete matching user drafts.
8. Write audit event with `kind="parameter-submit"` and `targetType="parameter-submission-round"`.

- [ ] **Step 4: Run service tests**

Run:

```bash
npm run test:server -- server/modules/parameters/service.test.ts server/modules/parameters/repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameters/repository.ts server/modules/parameters/repository.test.ts server/modules/parameters/service.ts server/modules/parameters/service.test.ts
git commit -m "feat: persist parameter drafts and submissions"
```

---

### Task 6: Implement Review, Merge, And Audit State Machine

**Purpose:** Make parameter review a real state machine with conflict checks and audit evidence.

**Files:**
- Modify: `server/modules/parameters/status.ts`
- Modify: `server/modules/parameters/service.ts`
- Modify: `server/modules/parameters/service.test.ts`
- Modify: `server/modules/parameters/repository.ts`
- Modify: `server/modules/parameters/repository.test.ts`

- [ ] **Step 1: Write state machine tests**

Add tests for:

- ordinary user cannot advance review;
- committer advances `hardware_review` to `software_review`;
- committer advances `software_review` to `software_merge`;
- software user can merge `software_merge`;
- high-risk request cannot merge unless prior hardware and software decisions exist;
- merge with stale `expectedVersion` throws `CONFLICT`;
- merge updates parameter value, inserts history, inserts decision, writes audit.

Run:

```bash
npm run test:server -- server/modules/parameters/service.test.ts
```

Expected: FAIL until service is implemented.

- [ ] **Step 2: Implement repository review helpers**

Add:

- `getChangeRequestById`
- `listReviewDecisions`
- `insertReviewDecision`
- `updateChangeRequestStatus`
- `mergeChangeRequest`
- `updateSubmissionRoundStatusFromRequests`

`mergeChangeRequest` must run in a transaction and update `project_parameter_values` only when `value_version = base_version` or the supplied `expectedVersion`.

- [ ] **Step 3: Implement review service**

Implement `reviewChange(db, auth, input)`:

```ts
if (input.decision === "reject") {
  require canReviewParameters(auth);
  update request to rejected;
  insert decision;
  update round status;
  write audit kind parameter-review-reject;
}

if (input.decision === "advance" && current status !== "software_merge") {
  require canReviewParameters(auth);
  move to next status;
  insert decision;
  update round status;
  write audit kind parameter-review-advance;
}

if (input.decision === "advance" && current status === "software_merge") {
  require canMergeParameters(auth);
  verify high-risk review decisions;
  merge value;
  insert history;
  insert decision;
  update round status;
  write audit kind parameter-merge;
}
```

- [ ] **Step 4: Run state machine tests**

Run:

```bash
npm run test:server -- server/modules/parameters/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameters/status.ts server/modules/parameters/service.ts server/modules/parameters/service.test.ts server/modules/parameters/repository.ts server/modules/parameters/repository.test.ts
git commit -m "feat: enforce parameter review and merge workflow"
```

---

### Task 7: Implement Import Preview And Apply

**Purpose:** Replace the admin page's placeholder import action with a governed server-side preview/apply flow.

**Files:**
- Modify: `server/modules/parameters/service.ts`
- Modify: `server/modules/parameters/service.test.ts`
- Modify: `server/modules/parameters/repository.ts`
- Modify: `server/modules/parameters/repository.test.ts`
- Modify: `server/modules/parameters/schemas.ts`

- [ ] **Step 1: Write import tests**

Cover:

- non-admin cannot create or apply import batch;
- invalid item shape returns `VALIDATION_FAILED`;
- preview classifies `added`, `updated`, `unchanged`, `conflict`;
- high-risk updated item with value delta above 20 percent is flagged;
- apply creates definitions and values for added items;
- apply updates recommended/current values for selected updated items;
- apply skips unselected items;
- apply writes audit event with batch id and summary.

Run:

```bash
npm run test:server -- server/modules/parameters/service.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Implement preview logic**

Implement deterministic preview:

- Match existing definitions by `id` when supplied, otherwise by `name`.
- `added`: no existing definition.
- `updated`: existing definition or project value differs.
- `unchanged`: all compared fields match.
- `conflict`: an open change request exists for the target project parameter.
- `riskFlag`: `risk === "High"` and numeric value delta is greater than 20 percent.

- [ ] **Step 3: Persist preview batch**

`createImportPreview` inserts `parameter_import_batches` with:

- `status="previewed"`;
- `summary={ added, updated, unchanged, conflict, highRisk }`;
- `items` as normalized preview item JSON.

- [ ] **Step 4: Apply selected import items**

`applyImportBatch`:

1. Requires `admin:access`.
2. Loads batch with `status="previewed"`.
3. Rejects selected items with `conflict`.
4. Upserts definitions and project values for selected items.
5. Inserts history rows for changed project values.
6. Updates batch to `status="applied"`.
7. Writes audit event `kind="batch-import"`, `targetType="parameter-import-batch"`.

- [ ] **Step 5: Run import tests**

Run:

```bash
npm run test:server -- server/modules/parameters/service.test.ts server/modules/parameters/repository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/modules/parameters/service.ts server/modules/parameters/service.test.ts server/modules/parameters/repository.ts server/modules/parameters/repository.test.ts server/modules/parameters/schemas.ts
git commit -m "feat: add governed parameter import batches"
```

---

### Task 8: Register Parameter Routes

**Purpose:** Expose the M1 service through `/api/v1` and keep auth, validation, errors, and audit consistent.

**Files:**
- Create: `server/modules/parameters/routes.ts`
- Create: `server/modules/parameters/routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Write route tests**

Route tests should use `requestJson` and fake database/service dependencies where needed. Cover:

- `GET /api/v1/projects` returns `{ items }`;
- `GET /api/v1/parameters?projectId=aurora&risk=High` passes filters;
- `GET /api/v1/parameters/:parameterId/history` uses route params;
- missing DB returns `INTERNAL_ERROR`;
- validation failure returns `VALIDATION_FAILED`;
- forbidden submission returns `FORBIDDEN`;
- review route can return merged request after service success.

Run:

```bash
npm run test:server -- server/modules/parameters/routes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 2: Implement route registration**

`registerParameterRoutes(router, { db, getCurrentAuthContext })` registers all M1 endpoints.

Each route:

- checks `options.db`;
- gets auth context;
- parses `request.query`, `request.params`, or `request.body` with schemas;
- calls service/repository;
- returns `{ status, body }`;
- lets `ApiError` propagate to the shared error serializer.

- [ ] **Step 3: Register in app**

Update `server/app.ts`:

```ts
registerParameterRoutes(router, {
  db: options.db,
  getCurrentAuthContext: () => developmentAuthContext
});
```

Update `server/index.ts` so `createWiseEffServer({ db })` receives `createPostgresDatabase(env.DATABASE_URL)` when configured. In development without `DATABASE_URL`, keep health and `/me` usable and let business routes return `INTERNAL_ERROR`.

- [ ] **Step 4: Run backend tests**

Run:

```bash
npm run test:server
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/modules/parameters/routes.ts server/modules/parameters/routes.test.ts server/app.ts server/index.ts
git commit -m "feat: expose parameter management api"
```

---

### Task 9: Implement HTTP ParameterRepository

**Purpose:** Give the frontend a production API implementation that satisfies the same port as mock mode.

**Files:**
- Create: `src/infrastructure/http/parameterClient.ts`
- Create: `src/infrastructure/http/parameterClient.test.ts`
- Modify: `src/infrastructure/http/apiClient.ts`
- Modify: `src/infrastructure/mock/mockParameterRepository.ts`
- Modify: `src/infrastructure/mock/mockParameterRepository.test.ts`

- [ ] **Step 1: Add API client delete/patch support**

`ParameterRepository.deleteDraft` needs DELETE. Add `delete` to `createApiClient`:

```ts
delete: <T>(path: string) =>
  request<T>(path, {
    method: "DELETE",
    headers: { Accept: "application/json" }
  })
```

Test it in `src/infrastructure/http/apiClient.test.ts`.

- [ ] **Step 2: Write HTTP repository tests**

In `parameterClient.test.ts`, mock fetch and assert:

- `listParameters({ projectId: "aurora", risk: ["High"] })` calls `/api/v1/parameters?projectId=aurora&risk=High`;
- paged responses unwrap `items`;
- `submitParameterChanges` posts to `/api/v1/parameter-submission-rounds`;
- `reviewChange` posts to `/api/v1/parameter-change-requests/:requestId/review`;
- `createImportPreview` and `applyImportBatch` use import endpoints;
- errors remain `WiseEffApiError`.

Run:

```bash
npm test -- src/infrastructure/http/parameterClient.test.ts src/infrastructure/http/apiClient.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `createHttpParameterRepository`**

Create `src/infrastructure/http/parameterClient.ts`:

```ts
export function createHttpParameterRepository(
  apiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })
): ParameterRepository {
  return {
    listProjects: async () => projectSummariesFromDto(await apiClient.get("/api/v1/projects")),
    listParameters: async (query) => parameterListFromDto(await apiClient.get(buildParametersPath(query))),
    getParameter: async (parameterId) => parameterRecordFromParameterDto(await apiClient.get(`/api/v1/parameters/${encodeURIComponent(parameterId)}`)),
    listParameterHistory: async (parameterId) => historyFromDto(await apiClient.get(`/api/v1/parameters/${encodeURIComponent(parameterId)}/history`)),
    ...
  };
}
```

Use helper builders for query strings. Do not concatenate unencoded user input.

- [ ] **Step 4: Update mock repository**

Extend `createMockParameterRepository` to implement the expanded port:

- drafts can be stored in `MockRuntimeState`;
- `reviewChange` delegates to existing reducer-equivalent state transition helpers or updates `changeRequests` consistently with `App` reducer;
- import preview/apply returns deterministic mock batch data and updates mock config only in mock mode.

- [ ] **Step 5: Run repository tests**

Run:

```bash
npm test -- src/infrastructure/http/parameterClient.test.ts src/infrastructure/http/apiClient.test.ts src/infrastructure/mock/mockParameterRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/http/parameterClient.ts src/infrastructure/http/parameterClient.test.ts src/infrastructure/http/apiClient.ts src/infrastructure/http/apiClient.test.ts src/infrastructure/mock/mockParameterRepository.ts src/infrastructure/mock/mockParameterRepository.test.ts
git commit -m "feat: add http parameter repository"
```

---

### Task 10: Add Frontend Parameter Runtime Coordinator

**Purpose:** Keep page components mostly unchanged while api mode loads and refreshes parameter data through the repository.

**Files:**
- Create: `src/application/parameters/parameterRuntime.ts`
- Create: `src/application/parameters/parameterRuntime.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/app/routes.tsx`

- [ ] **Step 1: Add runtime coordinator tests**

Test `createParameterRuntimeActions` or equivalent pure factory:

- mock mode calls dispatch with existing reducer actions;
- api mode calls repository then emits `HYDRATE_PARAMETER_RUNTIME`;
- failed api action returns a user-facing notification message and does not mutate local state optimistically;
- refresh loads projects, parameters, change requests, submission rounds, and drafts.

Run:

```bash
npm test -- src/application/parameters/parameterRuntime.test.ts
```

Expected: FAIL.

- [ ] **Step 2: Add hydration action**

In `src/App.tsx`, add:

```ts
| {
    type: "HYDRATE_PARAMETER_RUNTIME";
    projects: ProjectSummary[];
    parameters: ParameterRecord[];
    changeRequests: ChangeRequest[];
    parameterSubmissionRounds: ParameterSubmissionRound[];
  }
```

Reducer effect:

- Replace `state.parameters`, `state.changeRequests`, `state.parameterSubmissionRounds`.
- Rebuild `state.configDraft.projects` from API projects.
- Preserve unrelated local UI state, notifications, logs, debugging data, users, active role, active project.

- [ ] **Step 3: Add runtime services to AppShell**

`AppProps` gains optional:

```ts
parameterRepository?: ParameterRepository;
```

When `runtimeMode === "api"`:

- default to `createHttpParameterRepository()`;
- call `refreshParameterRuntime()` after auth hydration;
- show notification `已连接 WiseEff 参数 API` on first successful load;
- show existing fallback notification on failure.

- [ ] **Step 4: Pass parameter actions through routes**

Add `parameterActions` to `PageProps`:

```ts
export type ParameterPageActions = {
  submitChanges(input: SubmitParameterChangesInput): Promise<void>;
  stashChanges(items: ParameterDraftItem[]): Promise<void>;
  reviewChange(input: ReviewParameterChangeInput): Promise<void>;
  createImportPreview(input: ParameterImportPreviewInput): Promise<ParameterImportBatchDto>;
  applyImportBatch(input: ApplyParameterImportBatchInput): Promise<void>;
  refresh(): Promise<void>;
};
```

In mock mode, these call existing `dispatch` actions and resolve immediately. In api mode, they call the repository and refresh.

- [ ] **Step 5: Run App tests**

Run:

```bash
npm test -- src/application/parameters/parameterRuntime.test.ts src/App.test.tsx src/permissionRouting.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/application/parameters/parameterRuntime.ts src/application/parameters/parameterRuntime.test.ts src/App.tsx src/App.test.tsx src/app/routes.tsx
git commit -m "feat: hydrate frontend parameter runtime from api"
```

---

### Task 11: Wire Parameter Pages To API Actions

**Purpose:** Make user-facing parameter pages persist through M1 API while preserving mock mode behavior.

**Files:**
- Modify: `src/ParametersPage.tsx`
- Modify: `src/ParametersPage.test.tsx`
- Modify: `src/ParameterManagementHomePage.tsx`
- Modify: `src/ParameterManagementHomePage.test.tsx`
- Modify: `src/ParameterAdminPage.tsx`
- Modify: `src/ParameterAdminPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/reducerReview.test.ts`

- [ ] **Step 1: Update workbench submission tests**

In `src/ParametersPage.test.tsx`, add api-action tests:

- clicking submit calls `parameterActions.submitChanges`;
- clicking stash calls `parameterActions.stashChanges`;
- submit button shows pending state while promise is unresolved;
- rejection displays a notification and keeps drafts visible.

Run:

```bash
npm test -- src/ParametersPage.test.tsx
```

Expected: FAIL.

- [ ] **Step 2: Update `/parameters`**

Replace direct dispatch for submit/stash with `parameterActions`:

- `submitChanges({ projectId, items, assignees })`;
- `stashChanges(items)`;
- clear local selected ids and drafts only after action resolves.

Keep local filtering, table sorting, detail dialog, and draft dialog behavior unchanged.

- [ ] **Step 3: Update review page actions**

`ParameterReviewPage` currently lives in `src/App.tsx`. Update advance/reject handlers to call `parameterActions.reviewChange`:

- advance: `{ requestId, decision: "advance", expectedVersion }`;
- reject: `{ requestId, decision: "reject", note: reason }`.

Mock mode still dispatches existing reducer actions through the runtime adapter. Preserve `reducerReview.test.ts` for pure mock reducer behavior.

- [ ] **Step 4: Update admin import UI**

Replace placeholder import buttons in `src/ParameterAdminPage.tsx` with a minimal import dialog:

1. Source step: file input accepts `.json`, `.csv`, `.txt`; paste textarea is allowed.
2. Preview step: calls `parameterActions.createImportPreview`.
3. Review step: shows counts for added, updated, unchanged, conflict, high risk.
4. Apply step: calls `parameterActions.applyImportBatch` with selected preview item ids.

Keep existing parameter library edit/export UI in mock mode. In api mode, show copy:

```text
API 模式下参数库修改通过导入批次或审阅流程写入。
```

Do not allow direct browser-only `fetch("/api/power-management-config")` to be the production save path in api mode.

- [ ] **Step 5: Update parameter home data assumptions**

Ensure `/parameter-home` derives counts from hydrated `state.parameters`, `state.changeRequests`, and `state.parameterSubmissionRounds`. Add a test proving api-hydrated state shows a pending review action after refresh.

- [ ] **Step 6: Run frontend targeted tests**

Run:

```bash
npm test -- src/ParametersPage.test.tsx src/ParameterAdminPage.test.tsx src/ParameterManagementHomePage.test.tsx src/App.test.tsx src/reducerReview.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ParametersPage.tsx src/ParametersPage.test.tsx src/ParameterManagementHomePage.tsx src/ParameterManagementHomePage.test.tsx src/ParameterAdminPage.tsx src/ParameterAdminPage.test.tsx src/App.tsx src/reducerReview.test.ts
git commit -m "feat: persist parameter workflows through api mode"
```

---

### Task 12: Add M1 E2E, CI, And Documentation

**Purpose:** Prove the M1 loop works end-to-end and document how to run it locally.

**Files:**
- Create: `e2e/parameter-management.api.spec.ts`
- Create: `playwright.config.ts` if absent
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `README.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md` if any M1 gap remains

- [ ] **Step 1: Add E2E scripts**

Add:

```json
"test:e2e": "playwright test",
"test:m1": "npm run test:all && npm run build && npm run test:e2e"
```

Playwright config uses:

- frontend dev server: `npm run dev`;
- API dev server: `npm run dev:api`;
- base URL: `http://127.0.0.1:5173`;
- env: `VITE_WISEEFF_RUNTIME_MODE=api`, `VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787`.

- [ ] **Step 2: Write M1 E2E smoke**

`e2e/parameter-management.api.spec.ts` should:

1. Navigate to `/parameters?project=aurora`.
2. Filter high risk parameters.
3. Open a parameter detail and assert history is visible.
4. Create one draft and submit it.
5. Navigate to `/parameter-review`.
6. Advance through hardware review and software review.
7. Merge at software user stage using the seeded development user or test header.
8. Reload `/parameters?project=aurora`.
9. Assert current value equals the submitted target.
10. Navigate to audit/admin view and assert a parameter merge audit event exists.

- [ ] **Step 3: Update CI**

Update `.github/workflows/ci.yml`:

- keep existing `npm test`, `npm run test:server`, `npm run build`;
- add `npm run test:e2e` only if CI has a database service configured;
- otherwise add a named manual workflow note and keep `test:e2e` documented as local/staging gate.

- [ ] **Step 4: Update docs**

Docs updates:

- `README.md`: M1 setup, seed command, API mode verification.
- `docs/FRONTEND.md`: `ParameterRepository` api mode and mock mode responsibilities.
- `docs/SECURITY.md`: parameter write authz/audit guarantees.
- `docs/QUALITY_SCORE.md`: backend score and remaining gaps after M1.
- `docs/exec-plans/tech-debt-tracker.md`: record any deferred work such as generated OpenAPI client if not completed in M1.

- [ ] **Step 5: Final verification**

Run:

```bash
npm run test:all
npm run build
npm run test:e2e
git diff --check
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add e2e/parameter-management.api.spec.ts playwright.config.ts package.json .github/workflows/ci.yml docs/FRONTEND.md docs/SECURITY.md docs/QUALITY_SCORE.md README.md docs/exec-plans/tech-debt-tracker.md
git commit -m "test: add m1 parameter management acceptance"
```

---

## Implementation Order And Review Gates

Recommended execution:

1. Tasks 1 to 3 in one backend foundation branch section.
2. Tasks 4 to 8 as backend parameter API section.
3. Tasks 9 to 11 as frontend API-mode migration section.
4. Task 12 as acceptance and documentation section.

Review after each section:

- Section 1 gate: migration applies, seed script runs, existing M0 tests pass.
- Section 2 gate: backend routes pass permission, conflict, audit, and merge tests.
- Section 3 gate: mock mode tests still pass and api mode can hydrate parameter pages.
- Section 4 gate: E2E proves refresh persistence and audit evidence.

## Risk Controls

- Keep mock mode alive for demos and component tests until API mode reaches parity.
- Do not import `src/mockData.ts` from server runtime. Seed scripts may read `src/config/power-management.json` only.
- Keep frontend page refactors minimal. Move persistence through `ParameterRepository` and runtime actions instead of rewriting page layouts.
- Use server-side permissions for all writes. Frontend permission checks remain UX hints.
- Use transaction wrapper for submit, review, merge, and import apply.
- Treat audit failure as write failure for M1 parameter writes.

## Self-Review

- Spec coverage: M1 roadmap items 1 to 9 are covered by Tasks 3 to 12.
- Placeholder scan: no task is left without files, commands, or expected outcomes.
- Type consistency: backend stores English status codes; frontend DTO mapper returns existing `RequestStatus` labels. `ParameterRepository` is the single frontend port for M1 API behavior.
- Residual risk: generated OpenAPI/client is still not introduced. If Task 12 does not add it, keep TD-003 open and add a follow-up under `docs/exec-plans/tech-debt-tracker.md`.
