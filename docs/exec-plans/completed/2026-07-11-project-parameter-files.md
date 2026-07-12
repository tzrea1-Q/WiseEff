# 项目参数文件（DTS/JSON）维护与参数来源 Implementation Plan

> **Status:** Completed 2026-07-12 via PR #171 (`feat/project-parameter-files`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为每个项目维护多个 DTS/JSON 参数文件（内部托管 + 版本历史），实现文件↔DB 双向同步（文件 diff 自动草稿、审阅合入自动回写）、参数来源字段展示，以及 file/UI 草稿冲突的人工裁决。

**Architecture:** 新增 `server/modules/parameter-files/` 子域（repository + sync + writeback + conflicts），复用 `ObjectStore` 存文件字节、PostgreSQL 存元数据与 `parsed_index`。解析层扩展现有 `parseJson` / `parseDtsFragment` 为服务端 `buildParsedIndex`；合入钩子在 `reviewChange` merge 成功后调用 `WritebackService`。前端在 `ParameterAdminProjectsPage` 增加项目文件 Tab，在参数列表增加来源列与冲突面板。

**Tech Stack:** Node/tsx, PostgreSQL migrations, Zod, Vitest, React 19, 现有 `ObjectStore`（`server/modules/logs/objectStore.ts`）、M1 参数审阅流。

**Design spec:** `docs/superpowers/specs/2026-07-11-project-parameter-files-design.md`

**Scope:** **P1 only** — 内部托管、多文件、JSON 全量同步、DTS fragment 同步、来源字段、冲突裁决、JSON 写回、DTS 文本 patch 写回。P2（TD-035 完整 DTS / AST 写回）记入 tech-debt。

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/migrations/0041_project_parameter_files.sql` | 新表 + `project_parameter_values` / `parameter_drafts` 扩展 |
| `server/modules/parameter-files/types.ts` | DTO、枚举、`ParsedIndexEntry` |
| `server/modules/parameter-files/repository.ts` | files / versions / conflicts CRUD |
| `server/modules/parameter-files/parseIndex.ts` | JSON + DTS → `parsed_index` |
| `server/modules/parameter-files/pathMapper.ts` | `nodePath` → `name` + `module` |
| `server/modules/parameter-files/syncService.ts` | diff → `file_sync` 草稿 + 来源绑定 |
| `server/modules/parameter-files/conflictService.ts` | 冲突检测、冻结、裁决 |
| `server/modules/parameter-files/writebackService.ts` | merge 后 patch 文件 → 新版本 |
| `server/modules/parameter-files/service.ts` | upload / list / download / sync 编排 |
| `server/modules/parameter-files/routes.ts` | HTTP 路由 |
| `server/modules/parameter-files/schemas.ts` | Zod 校验 |
| `server/modules/parameters/service.ts` | `saveDraft` 扩展 origin；`reviewChange` merge 后写回钩子 |
| `server/modules/parameters/repository.ts` | 列表/详情返回 `source_file_name` / `source_node_path` |
| `server/app.ts` | 注册 parameter-files 路由 |
| `src/domain/parameters/types.ts` | `ParameterRecord` 来源字段 |
| `src/application/ports/ParameterFileRepository.ts` | 前端 port |
| `src/infrastructure/http/parameterFileClient.ts` | API client |
| `src/components/admin/ProjectParameterFilesPanel.tsx` | 项目文件 Tab |
| `src/components/admin/ParameterFileConflictPanel.tsx` | 冲突裁决面板 |
| `src/ParameterAdminProjectsPage.tsx` | 嵌入文件 Tab |
| `src/ParametersPage.tsx` | 来源列 |
| `src/styles.css` | `.project-parameter-files*` / `.parameter-file-conflict*` |

---

## Git & PR Workflow

- Branch: `feat/project-parameter-files` from latest `main`
- Implementation agent: commit on feature branch only; do not open/merge PR
- Parent agent: verify (`npm run test:server`, targeted `npm test`, `npm run build`, `npm run docs:check`), open PR, merge, sync `main`

---

## Task 1: Database migration

**Files:**
- Create: `server/migrations/0041_project_parameter_files.sql`
- Test: `server/modules/parameter-files/migration.test.ts`

- [x] **Step 1: Write migration**

```sql
-- server/migrations/0041_project_parameter_files.sql
create table if not exists project_parameter_files (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  file_name text not null,
  format text not null check (format in ('dts', 'json')),
  module_hint text references parameter_modules(id),
  current_version_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, file_name)
);

create table if not exists project_parameter_file_versions (
  id text primary key,
  file_id text not null references project_parameter_files(id) on delete cascade,
  version_number integer not null,
  storage_key text not null,
  checksum text not null,
  size_bytes bigint not null,
  parsed_index jsonb not null default '{}'::jsonb,
  origin text not null check (origin in ('upload', 'writeback')),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  unique (file_id, version_number)
);

alter table project_parameter_files
  add constraint project_parameter_files_current_version_fk
  foreign key (current_version_id) references project_parameter_file_versions(id);

alter table project_parameter_values
  add column if not exists source_file_name text,
  add column if not exists source_node_path text;

alter table parameter_drafts
  add column if not exists origin text not null default 'manual'
    check (origin in ('manual', 'file_sync')),
  add column if not exists origin_file_version_id text
    references project_parameter_file_versions(id);

create table if not exists parameter_file_sync_conflicts (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  project_parameter_value_id text not null references project_parameter_values(id),
  parameter_definition_id text not null references parameter_definitions(id),
  file_version_id text not null references project_parameter_file_versions(id),
  file_draft_id text not null references parameter_drafts(id),
  ui_draft_id text not null references parameter_drafts(id),
  file_value text not null,
  ui_draft_value text not null,
  status text not null default 'open' check (status in ('open', 'resolved_file', 'resolved_ui')),
  resolved_by_user_id text references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists project_parameter_files_project_idx
  on project_parameter_files (organization_id, project_id);
create index if not exists project_parameter_file_versions_file_idx
  on project_parameter_file_versions (file_id, version_number desc);
create index if not exists parameter_file_sync_conflicts_project_open_idx
  on parameter_file_sync_conflicts (project_id, status)
  where status = 'open';
create index if not exists project_parameter_values_source_idx
  on project_parameter_values (project_id, source_file_name, source_node_path)
  where source_file_name is not null;
```

- [x] **Step 2: Write migration smoke test**

```typescript
// server/modules/parameter-files/migration.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("0041_project_parameter_files migration", () => {
  it("defines required tables and columns", () => {
    const sql = readFileSync(
      path.resolve("server/migrations/0041_project_parameter_files.sql"),
      "utf8"
    );
    expect(sql).toContain("project_parameter_files");
    expect(sql).toContain("source_file_name");
    expect(sql).toContain("parameter_file_sync_conflicts");
  });
});
```

- [x] **Step 3: Run migration locally**

Run: `npm run db:migrate`  
Expected: `Applied 1 migration(s): 0041_project_parameter_files` (或包含该文件)

- [x] **Step 4: Run test**

Run: `npm run test:server -- server/modules/parameter-files/migration.test.ts --run`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/migrations/0041_project_parameter_files.sql server/modules/parameter-files/migration.test.ts
git commit -m "feat(parameters): add project parameter files schema"
```

---

## Task 2: Server types and file repository

**Files:**
- Create: `server/modules/parameter-files/types.ts`
- Create: `server/modules/parameter-files/repository.ts`
- Create: `server/modules/parameter-files/repository.test.ts`

- [x] **Step 1: Write failing repository test**

```typescript
// server/modules/parameter-files/repository.test.ts
import { describe, expect, it } from "vitest";
import { insertProjectParameterFile, listProjectParameterFiles } from "./repository";

describe("parameter-files repository", () => {
  it("inserts and lists project files", async () => {
    const db = makeTestDb(); // 复用 server/modules/parameters/repository.test.ts 中的 helper 模式
    await seedProject(db, { id: "proj-1", organizationId: "org-1" });
    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "proj-1",
      fileName: "battery.dtsi",
      format: "dts"
    });
    const items = await listProjectParameterFiles(db, { organizationId: "org-1", projectId: "proj-1" });
    expect(items).toHaveLength(1);
    expect(items[0]?.fileName).toBe("battery.dtsi");
  });
});
```

- [x] **Step 2: Run test — expect FAIL**

Run: `npm run test:server -- server/modules/parameter-files/repository.test.ts --run`

- [x] **Step 3: Implement types + repository**

```typescript
// server/modules/parameter-files/types.ts
export type ParameterFileFormat = "dts" | "json";
export type ParameterFileVersionOrigin = "upload" | "writeback";

export type ParsedIndexEntry = {
  value: string;
  line?: number;
};

export type ParsedIndex = Record<string, ParsedIndexEntry>;

export type ProjectParameterFileDto = {
  id: string;
  projectId: string;
  fileName: string;
  format: ParameterFileFormat;
  moduleHint?: string;
  enabled: boolean;
  currentVersionId?: string;
  currentVersionNumber?: number;
  updatedAt: string;
};

export type ProjectParameterFileVersionDto = {
  id: string;
  fileId: string;
  versionNumber: number;
  checksum: string;
  sizeBytes: number;
  origin: ParameterFileVersionOrigin;
  createdAt: string;
  createdByUserId?: string;
};
```

实现 `insertProjectParameterFile`, `listProjectParameterFiles`, `insertFileVersion`, `setCurrentVersion`, `getFileVersionContentMeta`, `getFileByName` — 遵循 `server/modules/product-feedback/repository.ts` 的 SQL 风格。

- [x] **Step 4: Run test — expect PASS**

- [x] **Step 5: Commit**

```bash
git add server/modules/parameter-files/types.ts server/modules/parameter-files/repository.ts server/modules/parameter-files/repository.test.ts
git commit -m "feat(parameters): add parameter file repository"
```

---

## Task 3: Parsed index builders (JSON + DTS)

**Files:**
- Create: `server/modules/parameter-files/parseIndex.ts`
- Create: `server/modules/parameter-files/parseIndex.test.ts`
- Modify: 从 `src/application/parameters/import/parseJson.ts` 与 `parseDtsFragment.ts` 提取可共享逻辑到 `packages/` 或 `server/modules/parameter-files/` 内独立实现（**不要**在 server 直接 import `src/`）

- [x] **Step 1: Write failing tests**

```typescript
// server/modules/parameter-files/parseIndex.test.ts
import { describe, expect, it } from "vitest";
import { buildJsonParsedIndex, buildDtsParsedIndex } from "./parseIndex";

describe("buildJsonParsedIndex", () => {
  it("flattens nested keys to slash paths", () => {
    const index = buildJsonParsedIndex(JSON.stringify({ battery: { temp_max: 85 } }));
    expect(index["battery/temp_max"]?.value).toBe("85");
  });
});

describe("buildDtsParsedIndex", () => {
  it("maps property assignments to node paths", () => {
    const source = `battery {\n  temp_max = <85>;\n};`;
    const index = buildDtsParsedIndex(source);
    expect(index["battery/temp_max"]?.value).toBe("<85>");
  });
});
```

- [x] **Step 2: Run test — expect FAIL**

- [x] **Step 3: Implement parseIndex**

```typescript
// server/modules/parameter-files/parseIndex.ts
import type { ParsedIndex } from "./types";

export function buildJsonParsedIndex(source: string): ParsedIndex {
  const root = JSON.parse(source) as unknown;
  const index: ParsedIndex = {};
  walkJson(root, [], index);
  return index;
}

function walkJson(value: unknown, path: string[], index: ParsedIndex): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkJson(child, [...path, key], index);
    }
    return;
  }
  if (path.length === 0) return;
  index[path.join("/")] = { value: stringifyLeaf(value) };
}

function stringifyLeaf(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function buildDtsParsedIndex(source: string): ParsedIndex {
  // 复用 parseDtsFragment 的 property 读取算法，输出 nodePath → value
  // P1: 支持 fragment 级节点；完整 .dts 文件按 TD-035 后续增强
  return parseDtsProperties(source);
}
```

- [x] **Step 4: Run tests — expect PASS**

Run: `npm run test:server -- server/modules/parameter-files/parseIndex.test.ts --run`

- [x] **Step 5: Commit**

---

## Task 4: Path mapper

**Files:**
- Create: `server/modules/parameter-files/pathMapper.ts`
- Create: `server/modules/parameter-files/pathMapper.test.ts`

- [x] **Step 1: Write failing test**

```typescript
import { nodePathToParameterIdentity } from "./pathMapper";

it("derives name and module from node path", () => {
  expect(nodePathToParameterIdentity("battery/temp_max")).toEqual({
    name: "temp_max",
    module: "battery"
  });
});
```

- [x] **Step 2–4: Implement + verify**

```typescript
export function nodePathToParameterIdentity(nodePath: string): { name: string; module: string } {
  const segments = nodePath.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error(`Invalid node path: ${nodePath}`);
  }
  return {
    name: segments.at(-1)!,
    module: segments.slice(0, -1).join("/")
  };
}
```

- [x] **Step 5: Commit**

---

## Task 5: File upload service + object store

**Files:**
- Create: `server/modules/parameter-files/service.ts`
- Create: `server/modules/parameter-files/schemas.ts`
- Create: `server/modules/parameter-files/service.test.ts`

- [x] **Step 1: Write failing upload test**

测试 `uploadProjectParameterFile`：给定 `Buffer` + `battery.dtsi`，应创建 file + version + `parsed_index`，并设置 `current_version_id`。

- [x] **Step 2: Implement upload**

关键逻辑：

```typescript
export async function uploadProjectParameterFile(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: { projectId: string; fileName: string; bytes: Buffer }
) {
  const format = detectFormat(input.fileName);
  const parsedIndex = format === "json"
    ? buildJsonParsedIndex(input.bytes.toString("utf8"))
    : buildDtsParsedIndex(input.bytes.toString("utf8"));

  const stored = await objectStore.put({
    organizationId: auth.organization.id,
    fileName: input.fileName,
    contentType: format === "json" ? "application/json" : "text/plain",
    bytes: input.bytes
  });

  // insert file (if new) + version v1 or v(n+1)
  // update current_version_id
  // if origin=upload: await syncFileVersion(db, auth, { fileId, versionId })
}
```

文件大小 P1 上限：**2MB**（超出抛 `VALIDATION_ERROR`）。

- [x] **Step 3: Run tests — PASS**

- [x] **Step 4: Commit**

---

## Task 6: Sync engine (diff → file_sync drafts)

**Files:**
- Create: `server/modules/parameter-files/syncService.ts`
- Create: `server/modules/parameter-files/syncService.test.ts`
- Modify: `server/modules/parameters/repository.ts` — `upsertFileSyncDraft`, `bindParameterSource`

- [x] **Step 1: Write failing sync test**

场景：项目已有参数 `temp_max` / `battery`，`current_value=80`；上传文件 index 中 `battery/temp_max=85` → 应创建 `origin=file_sync` 草稿，`target_value=85`。

- [x] **Step 2: Implement syncService**

```typescript
export async function syncFileVersion(
  db: Queryable,
  auth: AuthContext,
  input: { fileId: string; versionId: string }
) {
  const file = await loadFile(db, auth.organization.id, input.fileId);
  const version = await loadVersion(db, input.versionId);
  if (version.origin === "writeback") return { skipped: true, reason: "writeback" };

  for (const [nodePath, entry] of Object.entries(version.parsedIndex)) {
    const identity = nodePathToParameterIdentity(nodePath);
    const valueRow = await resolveProjectValue(db, auth.organization.id, file.projectId, {
      sourceFileName: file.fileName,
      sourceNodePath: nodePath,
      name: identity.name,
      module: identity.module
    });
    if (!valueRow) continue; // 新增候选 P1: 记入 sync summary，不自动建定义

    if (valueRow.currentValue === entry.value) {
      await bindParameterSource(db, valueRow.id, file.fileName, nodePath);
      continue;
    }

    await upsertFileSyncDraft(db, {
      organizationId: auth.organization.id,
      projectId: file.projectId,
      projectParameterValueId: valueRow.id,
      userId: auth.user.id, // 系统同步使用上传者或 service account
      targetValue: entry.value,
      reason: `文件同步：${file.fileName}@v${version.versionNumber}，节点 ${nodePath}，${valueRow.currentValue} → ${entry.value}`,
      originFileVersionId: version.id
    });
    await bindParameterSource(db, valueRow.id, file.fileName, nodePath);
    await detectAndOpenConflict(db, auth, valueRow.id);
  }
}
```

- [x] **Step 3: Extend saveDraft** — `origin` 默认 `manual`（`server/modules/parameters/service.ts`）

- [x] **Step 4: Run tests — PASS**

- [x] **Step 5: Commit**

---

## Task 7: Conflict detection and resolution

**Files:**
- Create: `server/modules/parameter-files/conflictService.ts`
- Create: `server/modules/parameter-files/conflictService.test.ts`

- [x] **Step 1: Write failing conflict test**

同参数有 `file_sync` 草稿 + `manual` 草稿且值不同 → 创建 `parameter_file_sync_conflicts`，双方草稿标记 `frozen`（通过查询时过滤或增加 `frozen` 标志；P1 在 `submitParameterChanges` 中拒绝 frozen 草稿）。

- [x] **Step 2: Implement detect + resolve**

```typescript
export async function resolveParameterFileConflict(
  db: Database,
  auth: AuthContext,
  input: { conflictId: string; resolution: "file" | "ui" }
) {
  return db.transaction(async (tx) => {
    const conflict = await loadOpenConflict(tx, auth.organization.id, input.conflictId);
    requireCanReview(auth); // 与 parameter review 权限对齐

    if (input.resolution === "file") {
      await deleteDraft(tx, conflict.uiDraftId);
    } else {
      await deleteDraft(tx, conflict.fileDraftId);
    }
    await closeConflict(tx, conflict.id, input.resolution, auth.user.id);
    await insertAudit(tx, "parameter-file-conflict-resolve", conflict);
  });
}
```

- [x] **Step 3: Block submit when conflict open** — 在 `submitParameterChanges` 检查该 `project_parameter_value_id` 是否有 open conflict

- [x] **Step 4: Run tests — PASS**

- [x] **Step 5: Commit**

---

## Task 8: Writeback service + merge hook

**Files:**
- Create: `server/modules/parameter-files/writebackService.ts`
- Create: `server/modules/parameter-files/writebackService.test.ts`
- Modify: `server/modules/parameters/service.ts` — merge 后调用写回

- [x] **Step 1: Write failing writeback tests**

JSON fixture：`{ "battery": { "temp_max": 80 } }`，合入值 `85` → 新版本内容 `temp_max: 85`，`origin=writeback`。

- [x] **Step 2: Implement writeback**

```typescript
export async function writebackMergedParameterValue(
  db: Database,
  objectStore: ObjectStore,
  auth: AuthContext,
  input: {
    projectId: string;
    parameterDefinitionId: string;
    mergedValue: string;
  }
) {
  const source = await loadParameterSource(db, auth.organization.id, input.projectId, input.parameterDefinitionId);
  if (!source?.sourceFileName || !source.sourceNodePath) return { skipped: true };

  const file = await getFileByName(db, auth.organization.id, input.projectId, source.sourceFileName);
  const current = await loadCurrentVersionBytes(db, objectStore, file.id);
  const patched = file.format === "json"
    ? patchJsonValue(current, source.sourceNodePath, input.mergedValue)
    : patchDtsProperty(current, source.sourceNodePath, input.mergedValue);

  await uploadProjectParameterFileVersion(db, objectStore, auth, {
    fileId: file.id,
    bytes: patched,
    origin: "writeback"
  });
}
```

- [x] **Step 3: Hook merge in reviewChange**

在 `mergeChangeRequest` 成功后、`createParameterReviewAudit` 之后：

```typescript
await writebackMergedParameterValue(tx, context.objectStore, auth, {
  projectId: request.projectId,
  parameterDefinitionId: request.parameterDefinitionId,
  mergedValue: merged.targetValue
});
```

`ServiceContext` 扩展 `objectStore?: ObjectStore`；`server/app.ts` 注入。

- [x] **Step 4: Run tests — PASS**

- [x] **Step 5: Commit**

---

## Task 9: HTTP routes

**Files:**
- Create: `server/modules/parameter-files/routes.ts`
- Create: `server/modules/parameter-files/routes.test.ts`
- Modify: `server/app.ts`

- [x] **Step 1: Write route test** — `POST /api/v1/projects/:projectId/parameter-files` multipart 上传返回 201

- [x] **Step 2: Implement routes**（对齐 design spec §11.2）

权限：`canAdminParameters(auth)` 用于上传/同步/裁决；`canViewParameters` 用于列表/下载。

- [x] **Step 3: Register in app.ts**

- [x] **Step 4: Run `npm run test:server -- server/modules/parameter-files/routes.test.ts --run`**

- [x] **Step 5: Commit**

---

## Task 10: Expose source fields in parameter list API

**Files:**
- Modify: `server/modules/parameters/repository.ts` — `listParameters` / `getParameterById` SELECT 增加 `source_file_name`, `source_node_path`
- Modify: `server/modules/parameters/types.ts`（或现有 DTO 文件）
- Test: `server/modules/parameters/repository.test.ts`

- [x] **Step 1: Extend DTO + SQL**

- [x] **Step 2: Assert in existing list test**

- [x] **Step 3: Commit**

---

## Task 11: Frontend port + HTTP client

**Files:**
- Create: `src/application/ports/ParameterFileRepository.ts`
- Create: `src/infrastructure/http/parameterFileClient.ts`
- Modify: `src/domain/parameters/types.ts`

- [x] **Step 1: Extend ParameterRecord**

```typescript
export type ParameterRecord = {
  // ...existing
  sourceFileName?: string;
  sourceNodePath?: string;
};
```

- [x] **Step 2: Define port + client** — `listFiles`, `uploadFile`, `listVersions`, `downloadVersion`, `syncFile`, `listConflicts`, `resolveConflict`

- [x] **Step 3: Unit test client URL mapping**

- [x] **Step 4: Commit**

---

## Task 12: Project parameter files panel UI

**Files:**
- Create: `src/components/admin/ProjectParameterFilesPanel.tsx`
- Create: `src/components/admin/ProjectParameterFilesPanel.test.tsx`
- Modify: `src/ParameterAdminProjectsPage.tsx` — 项目行展开或详情抽屉含「参数文件」Tab
- Modify: `src/styles.css`

- [x] **Step 1: Write render test** — 显示文件列表、上传按钮、版本号

- [x] **Step 2: Implement panel**

功能：文件列表（名称、格式、当前版本、启用开关）、上传 `.json`/`.dts`、版本历史列表、下载、手动「同步」按钮、最近同步摘要（草稿数/冲突数）。

- [x] **Step 3: Wire API mode only**（mock 模式显示占位说明）

- [x] **Step 4: Run `npm test -- src/components/admin/ProjectParameterFilesPanel.test.tsx --run`**

- [x] **Step 5: Browser verify** — `/parameter-admin/projects`，桌面/平板/手机 viewport，`snapshot` + `screenshot`

- [x] **Step 6: Commit**

---

## Task 13: Parameters source column + conflict panel

**Files:**
- Modify: `src/ParametersPage.tsx`
- Create: `src/components/admin/ParameterFileConflictPanel.tsx`
- Create: `src/components/admin/ParameterFileConflictPanel.test.tsx`
- Modify: `src/ParameterAdminPage.tsx` 或 TopBar — 冲突徽章

- [x] **Step 1: Add source column**

显示规则：`{sourceFileName} → {sourceNodePath}` 或 `手动`。

- [x] **Step 2: Conflict panel** — 列表 open conflicts，「保留文件值」「保留 UI 值」按钮

- [x] **Step 3: Tests + browser verify**

- [x] **Step 4: Commit**

---

## Task 14: Documentation

**Files:**
- Modify: `docs/design-docs/domain-model.md`
- Modify: `docs/design-docs/api-contract.md`
- Modify: `docs/superpowers/specs/2026-07-11-project-parameter-files-design.md` — 状态改为「实现中」
- Modify: `docs/exec-plans/tech-debt-tracker.md` — TD-039 P2 DTS full parse + AST writeback
- Regenerate: `docs/generated/db-schema.md`（若仓库有生成脚本则运行）

- [x] **Step 1: Update domain model** — 增加 §ProjectParameterFile

- [x] **Step 2: Update API contract** — 新增 routes 表

- [x] **Step 3: Run `npm run docs:check`**

- [x] **Step 4: Commit**

---

## Task 15: Integration verification gate

- [x] **Step 1: Server integration test** — 端到端：上传 JSON → 草稿 → 提交 → 审阅 → 合入 → 文件版本 +1

创建：`server/modules/parameter-files/integration.test.ts`

- [x] **Step 2: Run server tests**

```bash
npm run test:server -- server/modules/parameter-files --run
```

- [x] **Step 3: Run frontend tests**

```bash
npm test -- src/components/admin/ProjectParameterFilesPanel.test.tsx src/components/admin/ParameterFileConflictPanel.test.tsx --run
```

- [x] **Step 4: Build**

```bash
npm run build
```

- [x] **Step 5: Commit + handoff to parent for PR**

---

## Documentation Impact Matrix

| Document | Action | Notes |
| --- | --- | --- |
| `docs/design-docs/domain-model.md` | Update | 新增 ProjectParameterFile 实体 |
| `docs/design-docs/api-contract.md` | Update | parameter-files routes |
| `docs/generated/db-schema.md` | Update | 迁移后重新生成 |
| `docs/superpowers/specs/2026-07-11-project-parameter-files-design.md` | Review | 状态同步 |
| `docs/exec-plans/tech-debt-tracker.md` | Update | TD-039 P2 项 |
| `docs/product-specs/product-spec.md` | Review | 可选补充文件维护描述 |
| `docs/PLANS.md` | Update | 登记本 active plan |
| `ARCHITECTURE.md` | No change | |
| `docs/SECURITY.md` | Review | 文件上传大小/类型校验 |
| `docs/FRONTEND.md` | Review | 新 UI 入口 |
| `docs/developer/browser-acceptance-coverage-map.md` | Update | 新增参数文件操作 requirement ID |
| `docs/developer/user-operation-coverage-matrix.md` | Update | 新增 upload/sync/resolve operation ID |

## Documentation Update Gate

- [x] 所有 `Update` 行已完成或记录未变更理由
- [x] `npm run docs:check` 通过
- [x] UI 变更已记录 acceptance requirement / operation ID
- [x] 计划完成后移至 `docs/exec-plans/completed/`

---

## Spec Coverage Self-Review

| Spec 要求 | Task |
| --- | --- |
| 多文件托管 + 版本历史 | Task 1, 5, 9, 12 |
| 文件 → 自动草稿 | Task 6 |
| 来源字段 | Task 1, 10, 11, 13 |
| 合入 → 写回 | Task 8 |
| writeback 不触发草稿 | Task 6 (`origin=writeback` skip) |
| 冲突裁决 | Task 7, 13 |
| 审计 | Task 5–8 各 service 插入 audit |
| JSON + DTS 解析 | Task 3 |
| P1 非目标（Git/在线编辑） | 未纳入 task |

---

## Open Question Defaults (locked for P1)

1. **新增候选**：库无定义时不自动创建，仅记入 `sync-summary`；Admin 手动走现有「新增参数」流程。
2. **冲突裁决权限**：`canReviewParameters`（与 Committer 审阅一致）。
3. **文件大小上限**：2MB。
