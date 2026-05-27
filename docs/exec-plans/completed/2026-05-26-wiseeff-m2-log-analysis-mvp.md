# WiseEff M2 Log Analysis MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持真实日志上传、后台分析任务、阶段进度、证据行号和建议动作展示，完成 WiseEff 日志分析的第一个可持久化闭环。

**Architecture:** 延续 M0/M1 的单仓库结构，在 `server/` 内新增 `logs` 模块、轻量 job 模块和本地对象存储适配层，不做目录大迁移。M2 后端把日志文件、分析记录、run、stage、evidence、feedback 和 archive state 持久化到 PostgreSQL，文件内容在开发环境写入本地 `.wiseeff-object-store/`，生产环境保留对象存储 adapter seam。前端保留 mock mode，同时在 api mode 通过 `LogAnalysisRepository` HTTP 实现驱动 `/logs`、`/log-dashboard`、`/log-admin`。

**Tech Stack:** TypeScript, Node HTTP server, PostgreSQL, Zod, local filesystem object store adapter, in-process worker loop for M2, React 19, Vite, Vitest, Testing Library, Playwright smoke tests.

---

## Scope Boundary

M2 includes:

- 文本日志文件上传、文件对象记录和开发环境本地对象存储。
- 日志记录、分析 run、阶段进度、证据、建议动作、失败原因、归档和反馈的数据库模型。
- 基础任务队列和 worker：M2 使用数据库状态 + in-process worker，保留未来外部队列 seam。
- 文本日志解析器：支持 `.log`、`.txt`、`.csv` 的 UTF-8 文本内容，按稳定行号索引。
- 规则分析器：覆盖温度、充电降流、错误码、超时、重试、设备离线等 MVP 规则。
- 可插拔 AI 分析接口：M2 默认 deterministic rule analyzer，AI adapter 只定义接口和 mock，不接真实模型。
- 任务状态查询和 SSE 事件流。
- 前端 `LogAnalysisRepository` 从 mock 迁移到真实 API，实现列表、详情、上传、重跑、归档、取消归档、反馈。
- 日志分析闭环的后端集成测试、前端 repository/页面测试、Playwright smoke、文档更新。

M2 does not include:

- 大文件分片上传、断点续传、病毒扫描、真实 S3/OSS 凭证签发。
- 真实 LLM 或外部 AI 服务调用。
- 多 worker 分布式调度、外部消息队列、任务优先级和租户级限流。
- 二进制日志格式解析、压缩包批量解析、100MB 以上性能优化。
- 自动关联参数变更闭环。M2 可以保存 `relatedParameterId`，但不自动发起参数草稿或变更请求。

## Success Criteria

- `VITE_WISEEFF_RUNTIME_MODE=api` 时，用户在 `/logs` 上传支持格式日志后能看到真实 `Processing -> Complete` 进度，刷新页面后结果仍保留。
- 上传不支持格式会创建 `Failed` 日志记录，`failureReason` 清楚说明支持的格式和失败原因。
- 完成结果包含 `evidence.lineNumbers`、`inference`、`suggestedAction` 和 `rawLines`，页面点击证据能定位到对应原始日志行。
- `GET /api/v1/jobs/:jobId` 返回阶段、进度、错误；`GET /api/v1/jobs/:jobId/events` 以 SSE 返回同样状态变化。
- `POST /api/v1/logs/:logId/rerun` 能从失败或完成记录创建新 run，保留历史 run。
- archive、unarchive、feedback 写入审计事件，非授权用户不能归档或提交反馈。
- `npm run test:all`、`npm run build` 和 M2 Playwright smoke 通过。

## Status And Stage Mapping

Backend stores stable lowercase status codes. Frontend DTOs map them to existing `LogStatus` and `LogStageId` values.

| Backend status | Frontend status | Meaning |
| --- | --- | --- |
| `uploaded` | `Processing` | 文件已保存，等待创建或领取分析 run |
| `processing` | `Processing` | worker 正在解析或分析 |
| `complete` | `Complete` | 分析成功，证据和报告已生成 |
| `failed` | `Failed` | 上传校验或分析失败 |
| `archived` | current terminal status plus archive flag | 记录已归档，不改变最近 run 的完成或失败状态 |

| Backend stage | Frontend `LogStageId` | Progress |
| --- | --- | --- |
| `parse` | `parse` | 10-30 |
| `pattern` | `pattern` | 30-55 |
| `rootcause` | `rootcause` | 55-80 |
| `report` | `report` | 80-100 |

## File Structure

Create:

- `server/migrations/0003_m2_logs.sql`
- `scripts/seed-m2-logs.ts`
- `server/modules/jobs/types.ts`
- `server/modules/jobs/repository.ts`
- `server/modules/jobs/routes.ts`
- `server/modules/jobs/routes.test.ts`
- `server/modules/logs/types.ts`
- `server/modules/logs/schemas.ts`
- `server/modules/logs/status.ts`
- `server/modules/logs/policy.ts`
- `server/modules/logs/objectStore.ts`
- `server/modules/logs/objectStore.test.ts`
- `server/modules/logs/parser.ts`
- `server/modules/logs/parser.test.ts`
- `server/modules/logs/analyzer.ts`
- `server/modules/logs/analyzer.test.ts`
- `server/modules/logs/repository.ts`
- `server/modules/logs/repository.test.ts`
- `server/modules/logs/service.ts`
- `server/modules/logs/service.test.ts`
- `server/modules/logs/worker.ts`
- `server/modules/logs/worker.test.ts`
- `server/modules/logs/routes.ts`
- `server/modules/logs/routes.test.ts`
- `src/infrastructure/http/logDtos.ts`
- `src/infrastructure/http/logDtos.test.ts`
- `src/infrastructure/http/logClient.ts`
- `src/infrastructure/http/logClient.test.ts`
- `src/application/logs/logRuntime.ts`
- `src/application/logs/logRuntime.test.ts`
- `e2e/log-analysis.api.spec.ts`
- `test-fixtures/logs/charging-foldback.log`
- `test-fixtures/logs/unsupported.bin`

Modify:

- `server/shared/http/router.ts`
- `server/shared/http/router.test.ts`
- `server/shared/http/server.ts`
- `server/shared/database/client.ts`
- `server/shared/database/client.test.ts`
- `server/shared/http/errors.ts`
- `server/config/env.ts`
- `server/config/env.test.ts`
- `server/app.ts`
- `server/index.ts`
- `server/modules/auth/types.ts`
- `server/modules/auth/policy.ts`
- `scripts/migrate.ts`
- `package.json`
- `src/application/ports/LogAnalysisRepository.ts`
- `src/infrastructure/http/apiClient.ts`
- `src/infrastructure/http/apiClient.test.ts`
- `src/App.tsx`
- `src/app/routes.tsx`
- `src/LogAdminPage.tsx`
- `src/logsPage.upload.test.tsx`
- `src/logsPage.test.tsx`
- `src/logsPage.search.test.tsx`
- `src/logsPage.primaryAction.test.tsx`
- `src/logsPage.evidenceLinkage.test.tsx`
- `src/LogDashboardPage.test.tsx`
- `src/LogAdminPage.test.tsx`
- `src/reducer.logAdmin.test.ts`
- `src/mockData.logs.test.ts`
- `docs/design-docs/api-contract.md`
- `docs/design-docs/domain-model.md`
- `docs/design-docs/testing-strategy.md`
- `docs/FRONTEND.md`
- `docs/SECURITY.md`
- `docs/RELIABILITY.md`
- `docs/QUALITY_SCORE.md`
- `docs/generated/db-schema.md`
- `README.md`
- `.gitignore`
- `.github/workflows/ci.yml`

---

### Task 1: Upgrade HTTP And Database Foundations For Logs

**Purpose:** M2 endpoints need dynamic params, query strings, DELETE support, transactions, multipart/text body handling, and SSE. Complete the shared foundation before adding log routes.

**Files:**
- Modify: `server/shared/http/router.ts`
- Modify: `server/shared/http/router.test.ts`
- Modify: `server/shared/http/server.ts`
- Modify: `server/shared/database/client.ts`
- Modify: `server/shared/database/client.test.ts`
- Modify: `server/shared/http/errors.ts`
- Modify: `src/infrastructure/http/apiClient.ts`
- Modify: `src/infrastructure/http/apiClient.test.ts`

- [x] **Step 1: Write failing router tests**

Add tests in `server/shared/http/router.test.ts`:

```ts
it("matches dynamic params and query strings", async () => {
  const router = createRouter();
  router.get("/api/v1/logs/:logId/runs", async (request) => ({
    status: 200,
    body: {
      logId: request.params.logId,
      limit: request.query.limit,
      status: request.query.status
    }
  }));

  const response = await router.handle({
    method: "GET",
    path: "/api/v1/logs/log-123/runs",
    params: {},
    query: { limit: "20", status: ["complete", "failed"] },
    headers: {},
    requestId: "req-1",
    body: undefined
  });

  expect(response.body).toEqual({
    logId: "log-123",
    limit: "20",
    status: ["complete", "failed"]
  });
});

it("prefers exact routes over dynamic routes", async () => {
  const router = createRouter();
  router.get("/api/v1/jobs/events", async () => ({ status: 200, body: { exact: true } }));
  router.get("/api/v1/jobs/:jobId", async () => ({ status: 200, body: { exact: false } }));

  const response = await router.handle({
    method: "GET",
    path: "/api/v1/jobs/events",
    params: {},
    query: {},
    headers: {},
    requestId: "req-1",
    body: undefined
  });

  expect(response.body).toEqual({ exact: true });
});
```

Run:

```bash
npm run test:server -- server/shared/http/router.test.ts
```

Expected: FAIL because `RouteRequest` has no `params` or `query`, and the router only performs exact map lookup.

- [x] **Step 2: Implement route matching and query shape**

In `server/shared/http/router.ts`:

- Add `params: Record<string, string>` and `query: Record<string, string | string[]>` to `RouteRequest`.
- Store route entries as an ordered array `{ method, pattern, segments, staticCount, handler }`.
- Sort matching candidates by `staticCount` descending so exact/static routes win over `:param` routes.
- Decode path params with `decodeURIComponent`.
- Preserve `ApiError("NOT_FOUND", "Route not found.", 404, { path })` for misses.

Registration remains:

```ts
router.get("/api/v1/logs/:logId", handler);
router.post("/api/v1/logs/:logId/rerun", handler);
router.get("/api/v1/jobs/:jobId/events", handler);
```

- [x] **Step 3: Parse query strings and upload body variants**

In `server/shared/http/server.ts`:

- Convert `url.searchParams` to `request.query`.
- Keep JSON behavior for `Content-Type: application/json`.
- Add support for `text/plain`, `text/csv`, and `application/octet-stream` by returning a `Buffer` plus metadata:

```ts
export type RawBody = {
  kind: "raw";
  contentType: string;
  bytes: Buffer;
};
```

- Add `sendSse(response, events)` support through a route response variant:

```ts
export type RouteResponse =
  | { status: number; body: unknown }
  | { status: 200; sse: AsyncIterable<{ event: string; data: unknown }> };
```

For M2 tests, it is enough that SSE routes emit `text/event-stream` with lines:

```text
event: job
data: {"id":"job_1","status":"processing"}
```

- [x] **Step 4: Add transaction support**

In `server/shared/database/client.ts`, introduce:

```ts
export type Database = Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
};
```

`createPostgresDatabase` must use `pool.connect()` for transactions so `begin`, work, and `commit` run on the same client. `createDatabase` can provide a test fallback that issues `begin`, calls `fn`, then commits or rolls back.

- [x] **Step 5: Extend API client**

In `src/infrastructure/http/apiClient.ts`, add:

```ts
put: <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", ... }),
delete: <T>(path: string) => request<T>(path, { method: "DELETE", ... }),
upload: <T>(path: string, file: File, fields?: Record<string, string>) => request<T>(path, { method: "POST", body: formData })
```

Tests in `src/infrastructure/http/apiClient.test.ts` must assert that upload uses `FormData`, DELETE sends no JSON body, and errors remain `WiseEffApiError`.

- [x] **Step 6: Run foundation tests**

Run:

```bash
npm run test:server -- server/shared/http/router.test.ts server/shared/database/client.test.ts server/shared/http/errors.test.ts server/app.test.ts
npm test -- src/infrastructure/http/apiClient.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/shared/http/router.ts server/shared/http/router.test.ts server/shared/http/server.ts server/shared/database/client.ts server/shared/database/client.test.ts server/shared/http/errors.ts src/infrastructure/http/apiClient.ts src/infrastructure/http/apiClient.test.ts
git commit -m "feat: support log api routing uploads and jobs"
```

---

### Task 2: Lock M2 Contract, Port, Permissions, And DTO Shape

**Purpose:** Freeze the log API and frontend port before database and UI work so the backend service, frontend repository, and tests do not drift.

**Files:**
- Modify: `docs/design-docs/api-contract.md`
- Modify: `src/application/ports/LogAnalysisRepository.ts`
- Create: `src/infrastructure/http/logDtos.ts`
- Create: `src/infrastructure/http/logDtos.test.ts`
- Create: `server/modules/logs/types.ts`
- Create: `server/modules/logs/schemas.ts`
- Create: `server/modules/logs/status.ts`
- Create: `server/modules/logs/policy.ts`
- Modify: `server/modules/auth/types.ts`
- Modify: `server/modules/auth/policy.ts`

- [x] **Step 1: Expand auth permissions for M2**

Update `server/modules/auth/types.ts` so `BackendPermission` includes:

```ts
| "logs:view"
| "logs:upload"
| "logs:analyze"
| "logs:archive"
| "logs:feedback"
```

Update `server/modules/auth/policy.ts`:

- `guest`: `["parameter:view", "logs:view"]`
- user/committer/admin roles: keep existing permissions and add `logs:view`, `logs:upload`, `logs:feedback`
- admin: add `logs:analyze`, `logs:archive`

Run:

```bash
npm run test:server -- server/modules/auth/policy.test.ts
```

Expected: PASS after updating expected permission lists.

- [x] **Step 2: Expand `LogAnalysisRepository`**

Update `src/application/ports/LogAnalysisRepository.ts`:

```ts
export type LogRunStatus = "queued" | "processing" | "complete" | "failed";

export type LogJobSnapshot = {
  id: string;
  kind: "log-analysis";
  logId: string;
  runId: string;
  status: LogRunStatus;
  progress: number;
  currentStage: LogRecord["stage"];
  error: string | null;
  updatedAt: string;
};

export type LogUploadInput = {
  projectId: string;
  file: File;
  analysisQuestion?: string;
  relatedParameterId?: string;
};

export type LogRerunInput = {
  logId: string;
  analysisQuestion?: string;
};

export type LogFeedbackInput = {
  logId: string;
  rating: "helpful" | "not_helpful";
  note?: string;
};

export interface LogAnalysisRepository {
  listLogs(query?: LogListQuery): Promise<LogRecord[]>;
  getLog(logId: string): Promise<LogRecord | null>;
  uploadLog(input: LogUploadInput): Promise<{ log: LogRecord; job: LogJobSnapshot }>;
  getJob(jobId: string): Promise<LogJobSnapshot>;
  watchJob?(jobId: string, onEvent: (snapshot: LogJobSnapshot) => void): () => void;
  rerunLog(input: LogRerunInput): Promise<{ log: LogRecord; job: LogJobSnapshot }>;
  archiveLog(logId: string): Promise<void>;
  unarchiveLog(logId: string): Promise<void>;
  submitFeedback(input: LogFeedbackInput): Promise<void>;
}
```

Keep `LogListQuery` compatible with current call sites.

- [x] **Step 3: Add DTO mapper tests**

Create `src/infrastructure/http/logDtos.test.ts` with cases:

- `logRecordFromDto` maps backend `complete` to frontend `Complete`.
- `logRecordFromDto` maps backend `failed` to frontend `Failed` and keeps `failureReason`.
- evidence line numbers and `rawLines` are preserved exactly.
- `jobSnapshotFromDto` maps backend job payload to `LogJobSnapshot`.
- `logListFromDto` unwraps `{ items }`.

Run:

```bash
npm test -- src/infrastructure/http/logDtos.test.ts
```

Expected: FAIL because the file does not exist.

- [x] **Step 4: Implement frontend DTO mappers**

Create `src/infrastructure/http/logDtos.ts` with DTO types:

```ts
export type LogRecordDto = {
  id: string;
  reportId: string;
  fileName: string;
  projectId: string;
  source: string;
  fileSizeBytes: number;
  status: "uploaded" | "processing" | "complete" | "failed";
  archiveState: "active" | "archived";
  stage: "parse" | "pattern" | "rootcause" | "report";
  confidence: number;
  conclusion: string;
  impact: string;
  evidence: LogEvidenceDto[];
  suggestedActions: string[];
  severity: "Critical" | "Warning" | "Info";
  rawLines: string[];
  capturedAt: string;
  updatedAt: string;
  submittedBy: string;
  relatedParameterId?: string;
  device?: string;
  failureReason?: string;
  analysisQuestion?: string;
};
```

Export:

- `logRecordFromDto(dto: LogRecordDto): LogRecord`
- `logListFromDto(response: { items: LogRecordDto[] }): LogRecord[]`
- `jobSnapshotFromDto(dto: LogJobDto): LogJobSnapshot`

Set `fileSizeMB = Math.round((fileSizeBytes / 1024 / 1024) * 10) / 10`.

- [x] **Step 5: Add server schemas and status helpers**

Create `server/modules/logs/status.ts`:

```ts
export const logStages = ["parse", "pattern", "rootcause", "report"] as const;
export const logRunStatuses = ["queued", "processing", "complete", "failed"] as const;
export const logRecordStatuses = ["uploaded", "processing", "complete", "failed"] as const;
export const supportedLogExtensions = [".log", ".txt", ".csv"] as const;
```

Create `server/modules/logs/schemas.ts` with Zod schemas:

- `createLogFileBodySchema`: `projectId`, `fileName`, `contentType`, `contentBase64`, optional `analysisQuestion`, optional `relatedParameterId`
- `createLogBodySchema`: `projectId`, `fileObjectId`, `fileName`, optional `analysisQuestion`, optional `relatedParameterId`
- `listLogsQuerySchema`: optional `projectId`, `status`, `timeWindow`, `includeArchived`
- `logFeedbackBodySchema`: `rating` exactly `helpful` or `not_helpful`, optional `note` max 2000 chars
- `rerunLogBodySchema`: optional `analysisQuestion`

Create `server/modules/logs/policy.ts`:

```ts
export function requireLogView(auth: AuthContext) { requirePermission(auth, "logs:view"); }
export function requireLogUpload(auth: AuthContext) { requirePermission(auth, "logs:upload"); }
export function requireLogAnalyze(auth: AuthContext) { requirePermission(auth, "logs:analyze"); }
export function requireLogArchive(auth: AuthContext) { requirePermission(auth, "logs:archive"); }
export function requireLogFeedback(auth: AuthContext) { requirePermission(auth, "logs:feedback"); }
```

Use the existing auth policy style and `ApiError("FORBIDDEN", ...)` conventions.

- [x] **Step 6: Document final M2 endpoint shape**

Update `docs/design-docs/api-contract.md` logs/jobs sections with these exact endpoints:

```text
POST /api/v1/log-files
POST /api/v1/logs
GET  /api/v1/logs
GET  /api/v1/logs/:logId
GET  /api/v1/logs/:logId/runs
POST /api/v1/logs/:logId/rerun
POST /api/v1/logs/:logId/archive
POST /api/v1/logs/:logId/unarchive
POST /api/v1/logs/:logId/feedback
GET  /api/v1/jobs/:jobId
GET  /api/v1/jobs/:jobId/events
```

Document that `POST /api/v1/log-files` accepts JSON base64 in M2 and may later be replaced by signed upload credentials.

- [x] **Step 7: Run contract tests**

Run:

```bash
npm test -- src/infrastructure/http/logDtos.test.ts
npm run test:server -- server/modules/auth/policy.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add docs/design-docs/api-contract.md src/application/ports/LogAnalysisRepository.ts src/infrastructure/http/logDtos.ts src/infrastructure/http/logDtos.test.ts server/modules/logs/types.ts server/modules/logs/schemas.ts server/modules/logs/status.ts server/modules/logs/policy.ts server/modules/auth/types.ts server/modules/auth/policy.ts server/modules/auth/policy.test.ts
git commit -m "feat: define m2 log analysis contract"
```

---

### Task 3: Add M2 Log Schema, Object Store, And Seed Fixtures

**Purpose:** Create persistent storage for uploaded files, records, runs, stages, evidence, feedback, jobs, and local file objects.

**Files:**
- Create: `server/migrations/0003_m2_logs.sql`
- Create: `server/modules/logs/objectStore.ts`
- Create: `server/modules/logs/objectStore.test.ts`
- Create: `scripts/seed-m2-logs.ts`
- Create: `test-fixtures/logs/charging-foldback.log`
- Create: `test-fixtures/logs/unsupported.bin`
- Modify: `server/config/env.ts`
- Modify: `server/config/env.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `docs/generated/db-schema.md`
- Modify: `README.md`

- [x] **Step 1: Add migration**

Create `server/migrations/0003_m2_logs.sql`:

```sql
create table if not exists log_file_objects (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null,
  storage_key text not null,
  file_name text not null,
  content_type text not null,
  file_size_bytes bigint not null,
  checksum_sha256 text not null,
  uploaded_by_user_id text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists log_records (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null,
  file_object_id text not null references log_file_objects(id),
  file_name text not null,
  source text not null,
  status text not null,
  archive_state text not null default 'active',
  current_run_id text,
  analysis_question text,
  related_parameter_id text,
  failure_reason text,
  submitted_by_user_id text references users(id),
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists log_analysis_runs (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  status text not null,
  current_stage text not null,
  progress integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table log_records
  add constraint log_records_current_run_fk
  foreign key (current_run_id) references log_analysis_runs(id);

create table if not exists log_analysis_stages (
  id text primary key,
  organization_id text not null references organizations(id),
  run_id text not null references log_analysis_runs(id),
  stage text not null,
  status text not null,
  progress integer not null,
  message text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, stage)
);

create table if not exists log_analysis_reports (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  run_id text not null references log_analysis_runs(id),
  confidence numeric not null,
  conclusion text not null,
  impact text not null,
  severity text not null,
  suggested_actions jsonb not null,
  raw_lines jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists log_evidence (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  run_id text not null references log_analysis_runs(id),
  stage text not null,
  line_numbers integer[] not null,
  inference text not null,
  suggested_action text not null,
  rule_hit text,
  created_at timestamptz not null default now()
);

create table if not exists log_feedback (
  id text primary key,
  organization_id text not null references organizations(id),
  log_record_id text not null references log_records(id),
  user_id text references users(id),
  rating text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id text primary key,
  organization_id text not null references organizations(id),
  kind text not null,
  target_type text not null,
  target_id text not null,
  status text not null,
  progress integer not null default 0,
  current_stage text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists log_records_org_project_status_idx on log_records(organization_id, project_id, status);
create index if not exists log_records_archive_state_idx on log_records(archive_state);
create index if not exists log_analysis_runs_log_record_idx on log_analysis_runs(log_record_id, created_at desc);
create index if not exists log_evidence_run_idx on log_evidence(run_id);
create index if not exists jobs_kind_target_idx on jobs(kind, target_type, target_id);
```

Run:

```bash
npm run test:server -- server/shared/database/migrations.test.ts
```

Expected: PASS.

- [x] **Step 2: Add object store env**

Update `server/config/env.ts`:

```ts
OBJECT_STORE_ROOT: z.string().default(".wiseeff-object-store")
```

Test in `server/config/env.test.ts`:

- default root is `.wiseeff-object-store`;
- explicit `OBJECT_STORE_ROOT` is preserved.

Run:

```bash
npm run test:server -- server/config/env.test.ts
```

Expected: PASS.

- [x] **Step 3: Implement local object store adapter**

Create `server/modules/logs/objectStore.ts`:

```ts
export type StoredObject = {
  storageKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  checksumSha256: string;
};

export interface ObjectStore {
  put(input: { organizationId: string; fileName: string; contentType: string; bytes: Buffer }): Promise<StoredObject>;
  get(storageKey: string): Promise<Buffer>;
}
```

`createLocalObjectStore(rootDir)` must:

- create the root directory if missing;
- write under `rootDir/<organizationId>/<sha256>-<sanitizedFileName>`;
- reject path traversal in `fileName`;
- return SHA-256 checksum and byte length.

Tests in `objectStore.test.ts` cover write/read, checksum, and path traversal rejection.

- [x] **Step 4: Add log fixtures and seed script**

Create `test-fixtures/logs/charging-foldback.log`:

```text
2026-05-25T10:03:12.120Z INFO charger session started device=PACK-A01 mode=fast_charge
2026-05-25T10:03:18.444Z WARN battery_temp_c=47.8 threshold_c=45 action=monitor
2026-05-25T10:03:20.010Z WARN charge_current_ma=3200 requested_ma=5000 reason=thermal_foldback
2026-05-25T10:03:24.990Z ERROR code=E_THERMAL_FOLDBACK module=bms detail="current reduced to protect pack"
2026-05-25T10:03:29.500Z INFO charger session stabilized current_ma=2800
```

Create `test-fixtures/logs/unsupported.bin` as a small binary-ish fixture tracked as text-safe bytes:

```text
WIS EEFF UNSUPPORTED BINARY FIXTURE
```

Create `scripts/seed-m2-logs.ts` that inserts one completed sample log and one failed unsupported-format record for project `aurora` after M0/M1 seeds exist. Add script:

```json
"db:seed:m2": "tsx scripts/seed-m2-logs.ts"
```

- [x] **Step 5: Update ignore and docs**

Add `.wiseeff-object-store/` to `.gitignore`.

Update:

- `docs/generated/db-schema.md` with M2 tables and key relationships.
- `README.md` with `npm run db:seed:m2` and object store root instructions.

- [x] **Step 6: Run schema and object store tests**

Run:

```bash
npm run test:server -- server/modules/logs/objectStore.test.ts server/shared/database/migrations.test.ts server/config/env.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/migrations/0003_m2_logs.sql server/modules/logs/objectStore.ts server/modules/logs/objectStore.test.ts scripts/seed-m2-logs.ts test-fixtures/logs/charging-foldback.log test-fixtures/logs/unsupported.bin server/config/env.ts server/config/env.test.ts package.json .gitignore docs/generated/db-schema.md README.md
git commit -m "feat: add log persistence and local object storage"
```

---

### Task 4: Implement Text Parser And Rule Analyzer

**Purpose:** Build deterministic analysis that can produce stable evidence line numbers and useful MVP recommendations without a real AI dependency.

**Files:**
- Create: `server/modules/logs/parser.ts`
- Create: `server/modules/logs/parser.test.ts`
- Create: `server/modules/logs/analyzer.ts`
- Create: `server/modules/logs/analyzer.test.ts`
- Modify: `server/modules/logs/types.ts`

- [x] **Step 1: Write parser tests**

In `parser.test.ts`, cover:

- UTF-8 `.log` parses into stable 1-based line numbers.
- empty lines are retained in `rawLines` but ignored for rule matching.
- `.csv` and `.txt` are accepted.
- `.bin`, `.zip`, and missing extensions return an unsupported format error.
- invalid UTF-8 or null-byte-heavy content returns a readable failure reason.

Example assertion:

```ts
const parsed = parseLogText({
  fileName: "charging-foldback.log",
  bytes: Buffer.from("INFO start\nERROR code=E_THERMAL_FOLDBACK\n")
});

expect(parsed.ok).toBe(true);
if (parsed.ok) {
  expect(parsed.rawLines).toEqual(["INFO start", "ERROR code=E_THERMAL_FOLDBACK"]);
  expect(parsed.entries[1]).toMatchObject({
    lineNumber: 2,
    severity: "error",
    message: "ERROR code=E_THERMAL_FOLDBACK"
  });
}
```

Run:

```bash
npm run test:server -- server/modules/logs/parser.test.ts
```

Expected: FAIL because parser does not exist.

- [x] **Step 2: Implement parser**

Create `parseLogText(input)` returning:

```ts
type ParseResult =
  | { ok: true; rawLines: string[]; entries: ParsedLogEntry[] }
  | { ok: false; reason: string };
```

Rules:

- Supported extensions: `.log`, `.txt`, `.csv`.
- Decode as UTF-8.
- Reject if more than 5 percent of bytes are `0x00`.
- `ParsedLogEntry` includes `lineNumber`, `timestamp?: string`, `severity: "error" | "warn" | "info"`, `message`, and `tokens`.
- Severity is derived from `ERROR`, `ERR`, `WARN`, `WARNING`, `INFO`; default is `info`.

- [x] **Step 3: Write analyzer tests**

In `analyzer.test.ts`, cover:

- thermal foldback fixture produces Warning or Critical severity, evidence line numbers `[2, 3, 4]`, conclusion mentioning thermal foldback, and at least two suggested actions.
- timeout/retry lines produce rule hit `communication-timeout`.
- device offline lines produce rule hit `device-offline`.
- logs with no findings produce Info severity, confidence under 0.5, and a suggested action to collect more context.
- analysis question is included in report context but does not invent evidence lines.

Run:

```bash
npm run test:server -- server/modules/logs/analyzer.test.ts
```

Expected: FAIL.

- [x] **Step 4: Implement deterministic analyzer and AI seam**

Create:

```ts
export interface LogAnalysisAdapter {
  analyze(input: AnalyzeLogInput): Promise<AnalyzeLogOutput>;
}

export function createRuleBasedLogAnalyzer(): LogAnalysisAdapter
```

MVP rule hits:

- `thermal-foldback`: match `thermal`, `battery_temp`, `foldback`, `E_THERMAL_FOLDBACK`
- `charge-current-reduction`: match `charge_current`, `current reduced`, `requested_ma`
- `communication-timeout`: match `timeout`, `retry`, `E_TIMEOUT`
- `device-offline`: match `offline`, `disconnect`, `DEVICE_UNAVAILABLE`
- `error-code`: match `ERROR` lines with `code=...`

Output:

```ts
{
  confidence: number;
  conclusion: string;
  impact: string;
  severity: "Critical" | "Warning" | "Info";
  evidence: Array<{ stageId: "pattern" | "rootcause"; lineNumbers: number[]; inference: string; suggestedAction: string; ruleHit: string }>;
  suggestedActions: string[];
}
```

Confidence rules:

- `0.85` if thermal or offline plus error evidence exists.
- `0.72` if timeout/retry evidence exists.
- `0.42` if no rule hit.

- [x] **Step 5: Run parser/analyzer tests**

Run:

```bash
npm run test:server -- server/modules/logs/parser.test.ts server/modules/logs/analyzer.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/modules/logs/parser.ts server/modules/logs/parser.test.ts server/modules/logs/analyzer.ts server/modules/logs/analyzer.test.ts server/modules/logs/types.ts
git commit -m "feat: analyze text logs with stable evidence lines"
```

---

### Task 5: Implement Log Repository And Service

**Purpose:** Encapsulate persistence, permissions, audit, status transitions, failed upload behavior, rerun, archive, unarchive, and feedback.

**Files:**
- Create: `server/modules/jobs/types.ts`
- Create: `server/modules/jobs/repository.ts`
- Create: `server/modules/logs/repository.ts`
- Create: `server/modules/logs/repository.test.ts`
- Create: `server/modules/logs/service.ts`
- Create: `server/modules/logs/service.test.ts`
- Modify: `server/modules/logs/types.ts`

- [x] **Step 1: Write repository tests**

In `server/modules/logs/repository.test.ts`, use the existing test database style. Cover:

- `createFileObject` inserts checksum, storage key, file size, and user.
- `createLogRecordWithRunAndJob` creates `log_records`, `log_analysis_runs`, and `jobs` in one transaction.
- `listLogs` excludes archived logs by default and includes them with `includeArchived=true`.
- `getLogDetail` joins current report, evidence, and raw lines.
- `listRuns(logId)` returns newest run first.
- `appendFeedback` persists rating and note.

Run:

```bash
npm run test:server -- server/modules/logs/repository.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement repository DTO mapping**

Create repository functions:

```ts
createFileObject(db, input)
createLogRecordWithRunAndJob(db, input)
markUnsupportedLog(db, input)
listLogs(db, auth, query)
getLogDetail(db, auth, logId)
listRuns(db, auth, logId)
updateRunProgress(db, input)
completeRun(db, input)
failRun(db, input)
archiveLog(db, auth, logId)
unarchiveLog(db, auth, logId)
appendFeedback(db, auth, input)
```

The detail mapper must return the server `LogRecordDto` shape defined in Task 2.

- [x] **Step 3: Write service tests**

In `server/modules/logs/service.test.ts`, cover:

- guest can list logs but cannot upload.
- user with `logs:upload` can upload supported `.log`, creating `Processing` record and queued job.
- unsupported `.bin` creates `Failed` record with `failureReason` and no queued worker job.
- non-admin cannot archive; admin can archive and unarchive.
- feedback requires `logs:feedback` and writes audit.
- rerun requires `logs:analyze` or admin, creates a new run and job, and keeps old run history.

Run:

```bash
npm run test:server -- server/modules/logs/service.test.ts
```

Expected: FAIL.

- [x] **Step 4: Implement service**

Create `server/modules/logs/service.ts` with:

```ts
uploadLogFile(db, objectStore, auth, input)
createLogFromFile(db, auth, input)
listLogRecords(db, auth, query)
getLogRecord(db, auth, logId)
listLogRuns(db, auth, logId)
rerunLogAnalysis(db, auth, input)
archiveLogRecord(db, auth, logId)
unarchiveLogRecord(db, auth, logId)
submitLogFeedback(db, auth, input)
```

Important behavior:

- `uploadLogFile` validates permission and extension before storing bytes when possible.
- Unsupported extension still creates a `log_file_objects` row and `log_records` row with `status="failed"` and `failureReason`.
- Supported upload creates `status="processing"`, run `status="queued"`, job `status="queued"`.
- Every write emits audit event:
  - `log-upload`
  - `log-upload-failed`
  - `log-rerun`
  - `log-archive`
  - `log-unarchive`
  - `log-feedback`
- Use `db.transaction` for multi-table writes.

- [x] **Step 5: Run service and repository tests**

Run:

```bash
npm run test:server -- server/modules/logs/repository.test.ts server/modules/logs/service.test.ts server/modules/audit/repository.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/modules/jobs/types.ts server/modules/jobs/repository.ts server/modules/logs/repository.ts server/modules/logs/repository.test.ts server/modules/logs/service.ts server/modules/logs/service.test.ts server/modules/logs/types.ts
git commit -m "feat: persist log analysis records and actions"
```

---

### Task 6: Implement Log Worker And Job Progress

**Purpose:** Process queued log-analysis jobs, update stage progress in order, persist reports/evidence, and expose a reusable in-process worker for dev/test.

**Files:**
- Create: `server/modules/logs/worker.ts`
- Create: `server/modules/logs/worker.test.ts`
- Modify: `server/modules/jobs/repository.ts`
- Modify: `server/modules/jobs/types.ts`
- Modify: `server/modules/logs/repository.ts`
- Modify: `server/modules/logs/repository.test.ts`

- [x] **Step 1: Write worker tests**

In `worker.test.ts`, cover:

- processing a queued supported log updates stages in order `parse -> pattern -> rootcause -> report`.
- complete job has `progress=100`, run `status="complete"`, record `status="complete"`.
- report and evidence rows are persisted with stable line numbers.
- parser failure marks run/job/record failed with readable error.
- running the worker twice does not duplicate evidence for an already completed run.

Run:

```bash
npm run test:server -- server/modules/logs/worker.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement job claiming and progress repository helpers**

In `server/modules/jobs/repository.ts`, add:

```ts
claimNextJob(db, { kind: "log-analysis" })
getJobSnapshot(db, jobId)
updateJobProgress(db, input)
completeJob(db, input)
failJob(db, input)
```

Claiming rules:

- select the oldest queued job;
- set status to `processing`;
- return `null` when no queued job exists.

In M2 tests this does not need `SKIP LOCKED`; document that distributed locking is M5+.

- [x] **Step 3: Implement `processNextLogAnalysisJob`**

Create `server/modules/logs/worker.ts`:

```ts
export async function processNextLogAnalysisJob({
  db,
  objectStore,
  analyzer = createRuleBasedLogAnalyzer()
}: ProcessLogWorkerOptions): Promise<"processed" | "idle">
```

Processing steps:

1. Claim queued `log-analysis` job.
2. Load log record, file object, run.
3. Mark stage `parse` processing at progress 10.
4. Read bytes from object store and parse.
5. Mark stage `parse` complete at progress 30.
6. Mark stage `pattern` processing at 40 and run analyzer.
7. Mark `pattern` complete at 55.
8. Mark `rootcause` processing at 65 and create root cause evidence.
9. Mark `rootcause` complete at 80.
10. Mark `report` processing at 90 and persist report/evidence/raw lines.
11. Mark job/run/record complete at 100.

Failures call `failRun` and `failJob`, set record `status="failed"`, and preserve `failureReason`.

- [x] **Step 4: Add dev worker loop**

In `server/modules/logs/worker.ts`, add:

```ts
export function startLogWorkerLoop(options, intervalMs = 1000): () => void
```

The loop processes at most one job per tick and returns a cleanup function. Tests use fake timers or direct `processNextLogAnalysisJob`, not a long-running loop.

- [x] **Step 5: Run worker tests**

Run:

```bash
npm run test:server -- server/modules/logs/worker.test.ts server/modules/logs/repository.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/modules/logs/worker.ts server/modules/logs/worker.test.ts server/modules/jobs/repository.ts server/modules/jobs/types.ts server/modules/logs/repository.ts server/modules/logs/repository.test.ts
git commit -m "feat: process log analysis jobs"
```

---

### Task 7: Register Logs And Jobs API Routes

**Purpose:** Expose the M2 service through `/api/v1` with validation, auth, error serialization, job polling, and SSE.

**Files:**
- Create: `server/modules/logs/routes.ts`
- Create: `server/modules/logs/routes.test.ts`
- Create: `server/modules/jobs/routes.ts`
- Create: `server/modules/jobs/routes.test.ts`
- Modify: `server/app.ts`
- Modify: `server/index.ts`

- [x] **Step 1: Write logs route tests**

In `server/modules/logs/routes.test.ts`, cover:

- `POST /api/v1/log-files` accepts JSON base64 and returns `{ fileObject, log, job }`.
- unsupported file returns `201` with failed log and `job: null`.
- `GET /api/v1/logs?projectId=aurora&includeArchived=true` passes filters.
- `GET /api/v1/logs/:logId` uses route params.
- validation failure returns `VALIDATION_FAILED`.
- forbidden archive returns `FORBIDDEN`.
- feedback route writes through service.

Run:

```bash
npm run test:server -- server/modules/logs/routes.test.ts
```

Expected: FAIL.

- [x] **Step 2: Write jobs route tests**

In `server/modules/jobs/routes.test.ts`, cover:

- `GET /api/v1/jobs/:jobId` returns snapshot.
- missing job returns `NOT_FOUND`.
- `GET /api/v1/jobs/:jobId/events` emits at least one SSE event with `event: job`.

Run:

```bash
npm run test:server -- server/modules/jobs/routes.test.ts
```

Expected: FAIL.

- [x] **Step 3: Implement log route registration**

Create `registerLogRoutes(router, { db, objectStore, getCurrentAuthContext })`.

Routes:

```text
POST /api/v1/log-files
POST /api/v1/logs
GET  /api/v1/logs
GET  /api/v1/logs/:logId
GET  /api/v1/logs/:logId/runs
POST /api/v1/logs/:logId/rerun
POST /api/v1/logs/:logId/archive
POST /api/v1/logs/:logId/unarchive
POST /api/v1/logs/:logId/feedback
```

For M2, `POST /api/v1/log-files` body is:

```json
{
  "projectId": "aurora",
  "fileName": "charging-foldback.log",
  "contentType": "text/plain",
  "contentBase64": "...",
  "analysisQuestion": "Why did fast charging fold back?"
}
```

- [x] **Step 4: Implement job route registration**

Create `registerJobRoutes(router, { db, getCurrentAuthContext })`.

`GET /api/v1/jobs/:jobId/events` may emit a finite stream in M2 tests:

1. current snapshot immediately;
2. poll up to 10 seconds in dev runtime;
3. stop when status is `complete` or `failed`.

- [x] **Step 5: Register routes and worker in app/index**

Update `server/app.ts`:

```ts
registerLogRoutes(router, {
  db: options.db,
  objectStore: options.objectStore,
  getCurrentAuthContext: () => developmentAuthContext
});
registerJobRoutes(router, {
  db: options.db,
  getCurrentAuthContext: () => developmentAuthContext
});
```

Update `server/index.ts`:

- create `createLocalObjectStore(env.OBJECT_STORE_ROOT)`;
- pass object store to `createWiseEffServer`;
- start `startLogWorkerLoop` when `DATABASE_URL` exists;
- stop loop on process shutdown.

- [x] **Step 6: Run backend route suite**

Run:

```bash
npm run test:server -- server/modules/logs/routes.test.ts server/modules/jobs/routes.test.ts server/app.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/modules/logs/routes.ts server/modules/logs/routes.test.ts server/modules/jobs/routes.ts server/modules/jobs/routes.test.ts server/app.ts server/index.ts
git commit -m "feat: expose log analysis api and jobs"
```

---

### Task 8: Implement HTTP LogAnalysisRepository

**Purpose:** Give the frontend api mode a production repository matching the expanded log port.

**Files:**
- Create: `src/infrastructure/http/logClient.ts`
- Create: `src/infrastructure/http/logClient.test.ts`
- Modify: `src/infrastructure/http/apiClient.ts`
- Modify: `src/infrastructure/http/apiClient.test.ts`
- Modify: `src/mockData.logs.test.ts`

- [x] **Step 1: Write HTTP repository tests**

Create `src/infrastructure/http/logClient.test.ts`. Mock `fetch` and assert:

- `listLogs({ projectId: "aurora", status: "Complete", includeArchived: true })` calls `/api/v1/logs?projectId=aurora&status=complete&includeArchived=true`.
- `getLog("log-1")` calls `/api/v1/logs/log-1`.
- `uploadLog` base64-encodes file content and posts to `/api/v1/log-files`.
- `getJob` calls `/api/v1/jobs/job-1`.
- `rerunLog` posts to `/api/v1/logs/log-1/rerun`.
- archive/unarchive/feedback hit their expected endpoints.
- API errors throw `WiseEffApiError`.

Run:

```bash
npm test -- src/infrastructure/http/logClient.test.ts
```

Expected: FAIL.

- [x] **Step 2: Implement query and status mapping helpers**

In `logClient.ts`, implement helpers:

```ts
function backendStatus(status: LogRecord["status"]) {
  if (status === "Complete") return "complete";
  if (status === "Failed") return "failed";
  return "processing";
}

async function fileToBase64(file: File) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

Use `URLSearchParams`; never concatenate unencoded user input.

- [x] **Step 3: Implement `createHttpLogAnalysisRepository`**

Create:

```ts
export function createHttpLogAnalysisRepository(
  apiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })
): LogAnalysisRepository
```

Methods:

- `listLogs` -> `GET /api/v1/logs`
- `getLog` -> `GET /api/v1/logs/:logId`, return `null` on `NOT_FOUND`
- `uploadLog` -> `POST /api/v1/log-files`
- `getJob` -> `GET /api/v1/jobs/:jobId`
- `watchJob` -> `EventSource` when available, polling fallback otherwise
- `rerunLog` -> `POST /api/v1/logs/:logId/rerun`
- `archiveLog` -> `POST /api/v1/logs/:logId/archive`
- `unarchiveLog` -> `POST /api/v1/logs/:logId/unarchive`
- `submitFeedback` -> `POST /api/v1/logs/:logId/feedback`

- [x] **Step 4: Preserve mock expectations**

Update any mock tests affected by the expanded port shape. Mock mode can keep existing reducer behavior but must satisfy the new interface through an adapter in Task 9.

- [x] **Step 5: Run repository tests**

Run:

```bash
npm test -- src/infrastructure/http/logDtos.test.ts src/infrastructure/http/logClient.test.ts src/infrastructure/http/apiClient.test.ts src/mockData.logs.test.ts
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/infrastructure/http/logClient.ts src/infrastructure/http/logClient.test.ts src/infrastructure/http/apiClient.ts src/infrastructure/http/apiClient.test.ts src/mockData.logs.test.ts
git commit -m "feat: add http log analysis repository"
```

---

### Task 9: Add Frontend Log Runtime Coordinator

**Purpose:** Keep the current log pages mostly intact while api mode loads, uploads, polls, reruns, archives, and submits feedback through the repository.

**Files:**
- Create: `src/application/logs/logRuntime.ts`
- Create: `src/application/logs/logRuntime.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/App.test.tsx`

- [x] **Step 1: Add runtime coordinator tests**

Create `src/application/logs/logRuntime.test.ts`. Test:

- mock mode upload dispatches existing `SIMULATE_LOG_UPLOAD`.
- api mode `refresh` calls `repository.listLogs` and dispatches `HYDRATE_LOG_RUNTIME`.
- api mode `upload` calls `repository.uploadLog`, dispatches hydration for returned log, then polls `getJob` until terminal status.
- api mode `rerun` calls `repository.rerunLog` and polls.
- archive/unarchive/feedback call repository and refresh.
- failed repository call returns a user-facing notification and does not mutate logs optimistically.

Run:

```bash
npm test -- src/application/logs/logRuntime.test.ts
```

Expected: FAIL.

- [x] **Step 2: Add hydration and job actions**

In `src/App.tsx`, add reducer actions:

```ts
| { type: "HYDRATE_LOG_RUNTIME"; logs: LogRecord[] }
| { type: "UPSERT_LOG_RECORD"; log: LogRecord }
| { type: "LOG_JOB_PROGRESS"; job: LogJobSnapshot }
```

Reducer behavior:

- `HYDRATE_LOG_RUNTIME` replaces `state.logs` only; preserve users, role, project, parameter, debugging, notifications.
- `UPSERT_LOG_RECORD` replaces by id or prepends newest.
- `LOG_JOB_PROGRESS` updates matching log `stage` from `job.currentStage`; terminal result is fetched through repository and `UPSERT_LOG_RECORD`.

- [x] **Step 3: Implement runtime action factory**

Create:

```ts
export type LogRuntimeActions = {
  refresh(query?: LogListQuery): Promise<void>;
  upload(input: LogUploadInput): Promise<void>;
  rerun(input: LogRerunInput): Promise<void>;
  archive(logId: string): Promise<void>;
  unarchive(logId: string): Promise<void>;
  submitFeedback(input: LogFeedbackInput): Promise<void>;
};
```

`createLogRuntimeActions({ mode, repository, dispatch, getState })`:

- mock mode wraps existing dispatch actions;
- api mode calls repository then dispatches hydrate/upsert;
- polling interval in tests is injectable and defaults to 1000ms;
- max poll attempts defaults to 60.

- [x] **Step 4: Wire runtime into app shell**

`AppProps` gains optional:

```ts
logAnalysisRepository?: LogAnalysisRepository;
```

When `runtimeMode === "api"`:

- default to `createHttpLogAnalysisRepository()`;
- call `logActions.refresh()` after auth hydration;
- show one success notification after first load;
- show error notification on failure.

Pass `logActions` through `PageProps` in `src/app/routes.tsx`.

- [x] **Step 5: Run app/runtime tests**

Run:

```bash
npm test -- src/application/logs/logRuntime.test.ts src/App.test.tsx src/permissionRouting.test.tsx
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/application/logs/logRuntime.ts src/application/logs/logRuntime.test.ts src/App.tsx src/App.test.tsx src/app/routes.tsx
git commit -m "feat: hydrate log runtime from api"
```

---

### Task 10: Wire Log Pages To API Actions

**Purpose:** Make `/logs`, `/log-dashboard`, and `/log-admin` use real API actions in api mode while preserving mock mode and current UX.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/LogAdminPage.tsx`
- Modify: `src/logsPage.upload.test.tsx`
- Modify: `src/logsPage.test.tsx`
- Modify: `src/logsPage.search.test.tsx`
- Modify: `src/logsPage.primaryAction.test.tsx`
- Modify: `src/logsPage.evidenceLinkage.test.tsx`
- Modify: `src/LogDashboardPage.test.tsx`
- Modify: `src/LogAdminPage.test.tsx`
- Modify: `src/reducer.logAdmin.test.ts`

- [x] **Step 1: Update upload dialog tests**

In `src/logsPage.upload.test.tsx`, add tests:

- selecting `.log` calls `logActions.upload` with `File`, `projectId`, and `analysisQuestion`.
- unsupported extension shows server failure result in api mode instead of browser-only silent rejection.
- upload button shows pending state while promise is unresolved.
- upload rejection displays notification and keeps dialog open.

Run:

```bash
npm test -- src/logsPage.upload.test.tsx
```

Expected: FAIL.

- [x] **Step 2: Update `LogsPage` upload and rerun**

`LogsPage` currently lives in `src/App.tsx`. Replace direct dispatch with `logActions`:

- upload: `await logActions.upload({ projectId: state.activeProjectId, file, analysisQuestion })`
- rerun/primary action on failed or complete log: `await logActions.rerun({ logId, analysisQuestion })`

Keep local search, filters, selected log, evidence panel, and raw line view behavior unchanged.

- [x] **Step 3: Update evidence linkage tests**

Ensure `src/logsPage.evidenceLinkage.test.tsx` asserts:

- evidence line numbers from API-hydrated log locate the matching `rawLines` row;
- clicking evidence does not assume mock-only line ids;
- duplicate line numbers are de-duplicated for highlight but preserved in data.

- [x] **Step 4: Update dashboard hydration behavior**

`LogDashboardPage` should derive metrics from `state.logs` after API hydration. Update tests so:

- a completed API log increments complete count;
- a failed API log contributes to failure count and failure reason summary;
- archived logs are excluded unless admin view requests them.

- [x] **Step 5: Update admin archive, unarchive, and feedback**

In `src/LogAdminPage.tsx`:

- replace `dispatch({ type: "LOG_ADMIN_ARCHIVE_LOG" })` with `logActions.archive(id)`;
- add unarchive action if page currently only archives;
- send feedback with `logActions.submitFeedback`;
- show pending state per row/action;
- preserve existing mock reducer tests by routing mock mode actions through the runtime adapter.

- [x] **Step 6: Run log frontend targeted tests**

Run:

```bash
npm test -- src/logsPage.upload.test.tsx src/logsPage.test.tsx src/logsPage.search.test.tsx src/logsPage.primaryAction.test.tsx src/logsPage.evidenceLinkage.test.tsx src/LogDashboardPage.test.tsx src/LogAdminPage.test.tsx src/reducer.logAdmin.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/App.tsx src/LogAdminPage.tsx src/logsPage.upload.test.tsx src/logsPage.test.tsx src/logsPage.search.test.tsx src/logsPage.primaryAction.test.tsx src/logsPage.evidenceLinkage.test.tsx src/LogDashboardPage.test.tsx src/LogAdminPage.test.tsx src/reducer.logAdmin.test.ts
git commit -m "feat: persist log workflows through api mode"
```

---

### Task 11: Add M2 E2E, CI, Reliability, And Security Docs

**Purpose:** Prove the M2 loop works end-to-end and document how to operate it locally.

**Files:**
- Create: `e2e/log-analysis.api.spec.ts`
- Modify: `playwright.config.ts` if it exists, otherwise create it.
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/FRONTEND.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/RELIABILITY.md`
- Modify: `docs/QUALITY_SCORE.md`
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/design-docs/testing-strategy.md`
- Modify: `README.md`
- Modify: `docs/exec-plans/tech-debt-tracker.md` if any M2 gap remains.

- [x] **Step 1: Add E2E scripts**

Add scripts if absent:

```json
"test:e2e": "playwright test",
"test:m2": "npm run test:all && npm run build && npm run test:e2e"
```

Playwright config uses:

- frontend dev server: `npm run dev`;
- API dev server: `npm run dev:api`;
- base URL: `http://127.0.0.1:5173`;
- env:

```text
VITE_WISEEFF_RUNTIME_MODE=api
VITE_WISEEFF_API_BASE_URL=http://127.0.0.1:8787
OBJECT_STORE_ROOT=.wiseeff-object-store
```

- [x] **Step 2: Write M2 E2E smoke**

`e2e/log-analysis.api.spec.ts` should:

1. Navigate to `/logs?project=aurora`.
2. Upload `test-fixtures/logs/charging-foldback.log` with question `Why did fast charging fold back?`.
3. Wait until the row reaches `Complete`.
4. Open the log detail/evidence view.
5. Assert conclusion mentions thermal or foldback.
6. Click evidence and assert raw log line 3 or 4 is highlighted.
7. Submit helpful feedback.
8. Archive from admin view.
9. Reload and assert the archived log is not visible in default `/logs`.
10. Upload `test-fixtures/logs/unsupported.bin`.
11. Assert a `Failed` record appears with a readable unsupported format reason.

- [x] **Step 3: Update CI**

Update `.github/workflows/ci.yml`:

- keep `npm test`, `npm run test:server`, `npm run build`;
- add `npm run test:e2e` only if CI has a database service and object store directory configured;
- otherwise document `test:m2` as a local/staging release gate in README and keep CI on unit/integration/build.

- [x] **Step 4: Update docs**

Docs updates:

- `README.md`: M2 setup, `OBJECT_STORE_ROOT`, seed command, API mode log upload verification.
- `docs/FRONTEND.md`: `LogAnalysisRepository` responsibilities in mock and api modes.
- `docs/SECURITY.md`: log upload permissions, archive permissions, feedback audit, unsupported file handling.
- `docs/RELIABILITY.md`: in-process worker limits, retry behavior, object store root, job polling/SSE.
- `docs/QUALITY_SCORE.md`: M2 test coverage and remaining risks.
- `docs/design-docs/domain-model.md`: log archive state and job relationship if final implementation differs from draft.
- `docs/design-docs/testing-strategy.md`: actual M2 commands and fixtures.
- `docs/exec-plans/tech-debt-tracker.md`: record deferred work such as real object storage, distributed worker locks, generated OpenAPI client, AI adapter integration.

- [x] **Step 5: Final verification**

Run:

```bash
npm run test:all
npm run build
npm run test:e2e
git diff --check
```

Expected: all PASS.

- [x] **Step 6: Commit**

```bash
git add e2e/log-analysis.api.spec.ts playwright.config.ts package.json .github/workflows/ci.yml docs/FRONTEND.md docs/SECURITY.md docs/RELIABILITY.md docs/QUALITY_SCORE.md docs/design-docs/domain-model.md docs/design-docs/testing-strategy.md README.md docs/exec-plans/tech-debt-tracker.md
git commit -m "test: add m2 log analysis acceptance"
```

---

## Implementation Order And Review Gates

Recommended subagent order:

1. Task 1: shared HTTP/database/API-client foundation.
2. Task 2: contract, port, auth permission, DTO shape.
3. Task 3: schema, object store, fixtures, seed.
4. Task 4: parser and analyzer.
5. Task 5: repository and service.
6. Task 6: worker and job progress.
7. Task 7: API routes and dev worker registration.
8. Task 8: HTTP frontend repository.
9. Task 9: frontend runtime coordinator.
10. Task 10: page wiring.
11. Task 11: E2E, CI, docs.

Review gates:

- Gate A after Tasks 1-3: migrations apply, local object store works, contract tests pass.
- Gate B after Tasks 4-7: supported and unsupported log backend flows pass route/service/worker tests.
- Gate C after Tasks 8-10: mock mode still passes, api mode can hydrate, upload, poll, rerun, archive and feedback from pages.
- Gate D after Task 11: E2E proves supported upload, evidence line navigation, feedback, archive and unsupported failure.

## Subagent Dispatch Guidance

Use `superpowers:subagent-driven-development` for implementation.

For each task:

- Provide the subagent only the task text, this plan header, and relevant file excerpts.
- Require the subagent to write the failing test first, run it, implement, rerun targeted tests, and commit only the files in that task.
- After implementation, run a spec compliance reviewer subagent first, then a code quality reviewer subagent.
- Do not dispatch multiple implementation subagents in parallel because Tasks 1-7 touch shared backend foundations and route registration.
- If a subagent discovers M1 files already changed in the worktree, it must preserve those changes and coordinate rather than reverting them.

## Risk Controls

- Keep mock mode alive for demos and existing component tests.
- Do not import `src/mockData.ts` from server runtime. Seed scripts can use `test-fixtures/logs/` and explicit insert statements only.
- Treat audit write failure as write failure for upload, rerun, archive, unarchive and feedback.
- Validate file extension before analysis, but still persist unsupported uploads as failed records so the UI can explain them.
- Keep evidence line numbers 1-based and tied to stored `rawLines`.
- Make worker processing idempotent: completed runs are not processed twice and evidence is not duplicated.
- Do not add a real AI provider in M2; use the adapter seam and deterministic analyzer to keep tests stable.
- Keep in-process worker clearly documented as M2 development architecture, not the final production queue.

## Self-Review

- Spec coverage: roadmap M2 items 1-8 are covered by Tasks 3, 5, 6, 7, 8, 9 and 10.
- MVP completion flags are covered: supported upload completes with progress, unsupported format returns explainable failed record, completed result includes evidence line numbers and suggested actions.
- API contract coverage: all logs and jobs endpoints from `docs/design-docs/api-contract.md` are assigned to Tasks 2 and 7.
- Domain model coverage: file object, log record, run, stage, evidence, archive state and feedback are persisted in Task 3 and exercised in Tasks 5-7.
- Test strategy coverage: unsupported file failure, retry/rerun, stage order, evidence line binding and E2E upload loop are covered by Tasks 4, 6, 10 and 11.
- Placeholder scan: no step contains `TBD`, `TODO`, `implement later`, or unspecified edge handling.
- Type consistency: frontend DTO maps backend lowercase status/stage into existing `LogStatus` and `LogStageId`; the expanded `LogAnalysisRepository` is the single frontend port for M2 API behavior.
- Residual risk: real object storage, distributed worker locks, upload scanning, generated OpenAPI client and real AI adapter remain post-M2 work and should be captured in `docs/exec-plans/tech-debt-tracker.md` during Task 11 if still deferred.
