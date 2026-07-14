# DTS 配置集 · 发布基线 · 校验门禁（P2）Implementation Plan

> **For agentic workers:** 逐任务执行「写失败测试 → FAIL → 实现 → PASS → 提交」。仅在特性分支提交，不开/合 PR。任务间有依赖，务必顺序执行。
>
> 隶属主计划：[DTS 参数管理结构化重构 · 主计划](2026-07-14-dts-management-program.md)。前置：**P1 已合并**（结构化解析器 `server/modules/dts/` + `dts_nodes/dts_properties/dts_phandle_refs` + CST 无损回写/序列化已可用）。背景见[现状评估](../../design-docs/2026-07-14-dts-parameter-management-assessment.md)。

**Goal:** 落地主计划的顶层管理粒度「**项目 → 板级配置集（可构建单元）+ 发布基线**」，并把**dtc/schema 校验**做成合入前的**阻断式门禁**，同时提供与权威源等价的**无损导出**供软件人员手动 Git 提交。使 WiseEff 从「单文件结构化管理」升级为「可构建配置单元 + 可发布基线」的权威配置源。

**Architecture:**
- **配置集（`dts_config_set`）**：项目下的可构建单元，聚合一组 `project_parameter_files`（成员带角色 base/overlay/charging/thermal…）+ 变体/派生关系（`derived_from`）。向后兼容：每个已有项目在迁移时归入一个**隐式默认配置集**，现有单文件上传/同步/回写 API 不变。
- **发布基线（`dts_release_baseline`）**：对某配置集**全量冻结**——把每个成员文件的**当前版本**钉住成一份快照；支持「基线 vs 当前工作区」对比、**原子整体回滚**、发布标记（tag/notes）。
- **校验门禁（`DtcValidator` 端口）**：合入/发布配置集前调用 dtc 编译（含 overlay/`&label` 解析检查）+ 可选 dt-schema 绑定校验，作为**阻断门禁**；无 dtc 二进制时降级为「警告 + 人工确认」可配置模式（特性开关）。
- **无损导出**：复用 P1 `serializeDts`，从权威 CST 导出等价 `.dts`/`.dtsi`；配置集级导出为多文件 bundle（清单 + 内容）。
- 所有结构化写（配置集变更、基线创建/回滚、门禁结果、导出）必须写 `audit_events`（主计划跨期决策 #5）。

**Tech Stack:** Node/tsx, PostgreSQL migration, Vitest；dtc 通过**受限子进程**调用（超时 + 临时目录 + 无网络），封装在端口后便于测试替身与降级。

**Scope:** 服务端配置集/基线/门禁/导出 + HTTP 路由 + RBAC + 审计。**不含** Git 提交集成（后续独立立项）、前端结构化编辑/差异/检索/影响分析 UI（P3）、phandle 引用完整性深检（P3）。

**Branch:** `feat/dts-config-set-baseline`（P1 合并后从最新 `main` 拉出）。

---

## Locked Decisions（本期锁定，避免开发智能体返工）

| # | 决策点 | 结论 |
| --- | --- | --- |
| A | 配置集与现有文件的关系 | 在 `project_parameter_files` 增列 `config_set_id`（迁移期可空 + 隐式默认集回填）；**不**改动现有上传/同步/回写路径的语义。 |
| B | 基线快照粒度 | 基线钉「成员文件 → 具体 `file_version_id`」，**不复制 blob**（版本不可变，引用即冻结）。 |
| C | 回滚语义 | **原子整体回滚**：在一个事务内把每个成员文件的 `current_version_id` 指回基线钉住的版本（不删历史；若目标版本非线性最新，创建 `origin='rollback'` 的新版本指针，保留可追溯）。 |
| D | dtc 沙箱选型 | **受限子进程**调用系统 `dtc`（`timeout`、独立 `tmpdir`、不继承敏感 env、无网络假设）；封装为 `DtcValidator` 端口。dt-schema（python 绑定校验）**可选**、默认关闭，作为后续增强。 |
| E | 无 dtc 环境降级 | 特性开关 `DTS_VALIDATION_MODE = block \| warn \| off`（默认 `block`；自托管无 dtc 时可设 `warn` 走「人工确认」）。门禁结果一律入审计。 |
| F | 导出格式 | 单文件导出 = `serializeDts(权威版本 CST)` 逐字节等价源；配置集导出 = `{ manifest.json（集/成员/角色/版本号/校验状态）+ 各成员 .dts/.dtsi 内容 }`。 |
| G | 兼容旧流 | 未归属显式配置集的项目通过隐式默认集运作；`parsed_index` 与 M1 参数流保持可用。 |

---

## Contracts（本期锁定的核心契约）

### 配置集
```
ConfigSet     { id, projectId, name, description?, derivedFromId?, createdAt, updatedAt }
ConfigSetFile { configSetId, fileId, role: "base"|"overlay"|"charging"|"thermal"|"misc", sortOrder }
```
- 一个 `project_parameter_files` 至多属于一个配置集（`config_set_id` 唯一归属）。
- `derivedFromId` 表达变体/派生（如「A 板 = B 板 + overlay」），仅记录关系，本期不做自动继承合并（留 P3 影响分析）。

### 发布基线
```
ReleaseBaseline       { id, configSetId, name, notes?, status:"draft"|"released", createdBy, createdAt }
ReleaseBaselineMember { baselineId, fileId, fileVersionId, versionNumber }
```
- 创建基线 = 快照配置集当前所有成员的 `current_version_id`。
- `compareBaseline(baselineId)` → 每成员：`unchanged | version_changed | file_added | file_removed`；对 dts 成员进一步给**结构化差异**（基于 resolver `normalizedValue` 的节点/属性级增删改，类型感知、无假 diff）。

### 校验门禁
```
DtcValidator.validate(files: {name, content}[], opts) → {
  ok: boolean;
  mode: "block"|"warn"|"off";
  diagnostics: { file, line?, severity:"error"|"warning", message }[];
  compiler: "dtc"|"unavailable";
}
```
- `mode=block` 且存在 `error` → **阻断**合入/发布，写审计，返回 409。
- `mode=warn` 或 `compiler=unavailable` → 放行但标记「未校验/仅警告」，需人工确认标志，写审计。

### 无损导出
```
exportConfigSet(configSetId) → { manifest, files: {name, format, content}[] }
```
- dts 成员 `content === serializeDts(该版本 CST)`；对权威版本满足往返幂等（复用 P1 序列化）。

---

## File Map

| File | Responsibility |
| --- | --- |
| `server/migrations/0043_dts_config_set_baseline.sql` | `dts_config_set` / `project_parameter_files.config_set_id` / `dts_release_baseline` / `dts_release_baseline_members` + 隐式默认集回填 |
| `server/modules/parameter-files/configSetRepository.ts` | 配置集/成员 CRUD |
| `server/modules/parameter-files/configSetService.ts` | 建集、加/移成员、角色、派生关系、隐式默认集 |
| `server/modules/parameter-files/baselineRepository.ts` | 基线/成员 CRUD |
| `server/modules/parameter-files/baselineService.ts` | 创建快照、对比、原子回滚 |
| `server/modules/parameter-files/baselineDiff.ts` | 基于 resolver 的结构化差异（节点/属性级、类型感知） |
| `server/modules/parameter-files/dtcValidator.ts` | `DtcValidator` 端口 + 子进程实现 + 降级/开关 |
| `server/modules/parameter-files/validationGate.ts` | 门禁编排（调用 validator、判定、审计、错误映射） |
| `server/modules/parameter-files/exportService.ts` | 单文件 + 配置集 bundle 无损导出 |
| `server/modules/parameter-files/routes.ts`（增补） | 配置集/基线/校验/导出 HTTP 路由 |
| `server/modules/parameter-files/schemas.ts`（增补） | 上述路由的 Zod schema |
| `server/modules/parameter-files/*.test.ts` | 各单元 + 集成 |

> 复用 P1 `server/modules/dts/`（`parseDts`/`resolveDts`/`serializeDts`）与教学 fixture 作为正确性基准。**禁止 import `src/`。**

---

## Git & PR Workflow

- Branch: `feat/dts-config-set-baseline` from latest `main`（P1 合并后）。
- 开发智能体仅在分支提交；架构师评审、验证、开 PR、合并、同步 `main`。

---

## Task 1: 迁移（配置集 + 基线表 + 回填）

**Files:** `server/migrations/0043_dts_config_set_baseline.sql` + `migration.test.ts` 增补

- [ ] **Step 1: 写迁移**

```sql
create table if not exists dts_config_set (
  id text primary key,
  organization_id text not null references organizations(id),
  project_id text not null references projects(id),
  name text not null,
  description text,
  derived_from_id text references dts_config_set(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

alter table project_parameter_files
  add column if not exists config_set_id text references dts_config_set(id),
  add column if not exists config_set_role text,
  add column if not exists config_set_sort_order integer not null default 0;

create table if not exists dts_release_baseline (
  id text primary key,
  organization_id text not null references organizations(id),
  config_set_id text not null references dts_config_set(id) on delete cascade,
  name text not null,
  notes text,
  status text not null default 'draft' check (status in ('draft','released')),
  created_by_user_id text references users(id),
  created_at timestamptz not null default now(),
  unique (config_set_id, name)
);

create table if not exists dts_release_baseline_members (
  id text primary key,
  baseline_id text not null references dts_release_baseline(id) on delete cascade,
  file_id text not null references project_parameter_files(id),
  file_version_id text not null references project_parameter_file_versions(id),
  version_number integer not null,
  unique (baseline_id, file_id)
);

create index if not exists dts_config_set_project_idx on dts_config_set(organization_id, project_id);
create index if not exists project_parameter_files_config_set_idx on project_parameter_files(config_set_id, config_set_sort_order);
create index if not exists dts_release_baseline_set_idx on dts_release_baseline(config_set_id, created_at desc);
create index if not exists dts_release_baseline_members_baseline_idx on dts_release_baseline_members(baseline_id);
```

- [ ] **回填**：为每个已有 `project_id` 建一个隐式默认配置集（`name='default'`），把该项目现有 `project_parameter_files` 的 `config_set_id` 指向它（幂等、可重跑）。
- [ ] **`origin` 扩展**：`project_parameter_file_versions.origin` 增加 `'rollback'`（若约束为 CHECK，需 `alter` 放宽；参见 0041 origin 约束风格）。
- [ ] **Step 2: smoke test**（断言表名/关键列/回填后无孤儿文件）→ **Step 3:** `npm run db:migrate` → **Step 4: PASS** → 提交。

---

## Task 2: 配置集仓储 + 服务

**Files:** `configSetRepository.ts`, `configSetService.ts` + tests

- [ ] **Step 1: 失败测试**
  - 建集、按项目列集、加/移成员并设角色、`ensureDefaultConfigSet(projectId)` 幂等返回隐式默认集。
  - 一个文件加入第二个集应报冲突（唯一归属，决策 A）。
  - `derivedFromId` 记录变体关系，读回正确。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（事务、`canAdminParameters` 授权、审计 `config_set.created/updated/member_changed`）→ **Step 4: PASS** → 提交。

---

## Task 3: 基线快照仓储 + 创建

**Files:** `baselineRepository.ts`, `baselineService.ts`（创建部分）+ tests

- [ ] **Step 1: 失败测试**
  - `createBaseline(configSetId, name, notes)`：钉住配置集所有成员的 `current_version_id` 到 `dts_release_baseline_members`（成员数/版本号正确）。
  - 无当前版本的成员应报错（配置集不完整不可基线）。
  - 同集重名基线报冲突。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（事务快照、审计 `baseline.created`）→ **Step 4: PASS** → 提交。

---

## Task 4: 基线对比 + 原子回滚

**Files:** `baselineDiff.ts`, `baselineService.ts`（对比/回滚）+ tests

- [ ] **Step 1: 失败测试**
  - `compareBaseline(baselineId)`：构造「基线后又回写产生新版本」的场景 → 该成员 `version_changed`，未变成员 `unchanged`，新增/移除文件 `file_added/file_removed`。
  - dts 成员结构化差异：改一个属性值 → 差异定位到 `nodePath/prop`，等价重排（hex 大小写/多组展平）**不**产生差异（复用 P1 `normalizedValue`）。
  - `rollbackToBaseline(baselineId)`：事务内把每个成员 `current_version_id` 指回基线版本；回滚后 `compareBaseline` 全 `unchanged`；审计 `baseline.rolled_back`。回滚为原子（任一失败整体回退）。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（对比走 `resolveDts` 逐节点/属性；回滚复用 `setCurrentVersion`，非线性目标建 `origin='rollback'` 指针版本）→ **Step 4: PASS** → 提交。

---

## Task 5: dtc 校验端口（子进程 + 降级 + 开关）

**Files:** `dtcValidator.ts` + test

- [ ] **Step 1: 失败测试**
  - `DtcValidator` 端口：注入「假 dtc」返回 error/warning → 诊断映射正确（file/line/severity/message）。
  - `compiler='unavailable'`（找不到二进制）→ `ok` 依 `mode` 决定：`block` 下视为需人工确认，`off` 直接放行。
  - 子进程实现：受限执行（超时、tmp 目录写入、清理）。以 mock/stub 覆盖，不依赖 CI 装 dtc。
- [ ] **Step 2: FAIL** → **Step 3: 实现** — 端口 + 真子进程实现（`spawn dtc -I dts -O dtb`，overlay 用 `-@`/`/plugin/` 场景做解析检查）+ 降级；`DTS_VALIDATION_MODE` 开关读取。→ **Step 4: PASS** → 提交。

> **沙箱决策（已锁定为默认，见决策 D/E）：** 受限子进程 + 端口抽象；若后续要更强隔离（容器）再迭代，不阻塞本期。dt-schema 绑定校验为可选扩展点，本期仅预留端口参数，默认关闭。

---

## Task 6: 校验门禁编排

**Files:** `validationGate.ts` + test

- [ ] **Step 1: 失败测试**
  - `runValidationGate(configSetId)`：聚合配置集成员内容 → 调 `DtcValidator` → `mode=block` 且有 error → 抛 `ApiError('CONFLICT', ..., 409, {code:'dts-validation-failed', diagnostics})`；`mode=warn` → 放行但返回 `requiresConfirmation:true`；一律写审计 `validation.gate`（含结果/模式/诊断计数）。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（门禁在「创建基线 / 标记 released / 导出前」可挂载；本期至少挂 **基线 released 前**）→ **Step 4: PASS** → 提交。

---

## Task 7: 无损导出

**Files:** `exportService.ts` + test

- [ ] **Step 1: 失败测试**
  - `exportFile(fileId)`：dts 成员导出 `=== serializeDts(parseDts(源))`，对教学 fixture 逐字节等价。
  - `exportConfigSet(configSetId)`：返回 `manifest`（集/成员/角色/版本号/校验状态）+ 各成员内容；成员数/内容正确。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（读版本 blob → dts 走序列化往返校验、json 原样；组装 bundle）→ **Step 4: PASS** → 提交。

---

## Task 8: HTTP 路由 + Schema + RBAC

**Files:** `routes.ts`（增补）, `schemas.ts`（增补）+ route test

- [ ] **Step 1: 失败测试**（route 级）
  - `POST /projects/:id/config-sets`、`POST .../config-sets/:id/files`、`GET .../config-sets`。
  - `POST .../config-sets/:id/baselines`（创建）、`GET .../baselines/:id/compare`、`POST .../baselines/:id/rollback`、`POST .../baselines/:id/release`（触发门禁）。
  - `GET .../config-sets/:id/export`。
  - 授权：均要求 `canAdminParameters`；越权返回 403；校验失败返回 409（含 diagnostics）。
- [ ] **Step 2: FAIL** → **Step 3: 实现**（Zod 校验入参/出参，复用现有错误映射与审计）→ **Step 4: PASS** → 提交。

---

## Task 9: 集成 E2E + 文档

**Files:** `configSetBaseline.integration.test.ts` + 文档更新

- [x] **Step 1: 端到端**（对 fixture）
  - 建集 → 加两个 dts 成员 → 上传/回写产生新版本 → 建基线 → 再回写 → 对比出 `version_changed` + 结构化差异 → 回滚 → 对比。**实测行为偏离本条描述的字面表述**：回滚（决策 C）为受影响成员生成新的 `origin='rollback'` 版本指针（用于可追溯性，不复用基线版本 id），因此回滚后 `compareBaseline` 报告该成员仍为 `version_changed`（版本 id 不同），但其**结构化差异为空**（内容与基线逐属性等价）；未受影响成员保持 `unchanged`。集成测试断言的是这一实测行为，而非全 `unchanged` 的字面表述。
  - `mode=block` + 注入含错 dts → release 被门禁阻断（409，`error.details.code='dts-validation-failed'`）；改 `mode=warn` → 放行且 `gate.requiresConfirmation=true`。
  - 配置集导出 bundle → dts 成员与 `serializeDts(parseDts(源))` 往返等价。
- [x] **Step 2:** 文档更新（见下 Documentation Impact Matrix）。**无可见 UI 变更**——本期纯 API/服务端交付；结构化配置集/基线管理 UI 主体在 P3。
- [x] **Step 3:** `npm run test:server -- server/modules/parameter-files --run` + `npm run build` + `npm run docs:check` → PASS → 提交。

---

## Verification Matrix

| Check | Command |
| --- | --- |
| 迁移 + 回填 | `npm run db:migrate` + `npm run test:server -- server/modules/parameter-files/migration.test.ts --run` |
| 配置集/基线/对比/回滚 | `npm run test:server -- server/modules/parameter-files --run` |
| dtc 门禁（含降级/开关） | `npm run test:server -- server/modules/parameter-files/dtcValidator.test.ts server/modules/parameter-files/validationGate.test.ts --run` |
| 无损导出往返 | `npm run test:server -- server/modules/parameter-files/exportService.test.ts --run` |
| 集成 | `npm run test:server -- server/modules/parameter-files/configSetBaseline.integration.test.ts --run` |
| Build | `npm run build` |
| Docs | `npm run docs:check` |

---

## Documentation Impact Matrix

| Area | Path | Action |
| --- | --- | --- |
| 主计划 | `docs/exec-plans/active/2026-07-14-dts-management-program.md` | Update（P2 状态） |
| 领域模型 | `docs/design-docs/domain-model.md` | **Update**（配置集 / 发布基线 / 门禁实体与状态机） |
| 领域模型（中文） | `docs/zh-CN/design-docs/domain-model.md` | **Update**（与英文同步） |
| 生成的 schema | `docs/generated/db-schema.md` | **Update**（迁移后重生成） |
| API 契约 | `docs/design-docs/api-contract.md` | **Update**（配置集/基线/校验/导出路由） |
| 环境变量 | `docs/developer/environment-variables.md` | **Update**（`DTS_VALIDATION_MODE`、dtc 可用性） |
| 可靠性/运维 | `docs/RELIABILITY.md` / `docs/runbooks/` | Review（dtc 沙箱与自托管可用性） |
| 安全 | `docs/SECURITY.md` | **Update**（子进程执行不可信输入的资源上限/隔离；导出数据分级） |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | **Update**（隐式默认集回填、dt-schema 可选项、容器化沙箱后续） |
| 计划登记 | `docs/PLANS.md` / `docs/zh-CN/PLANS.md` | **Update** |
| 架构总览 | `ARCHITECTURE.md` | Review（顶层实体链落地：项目→配置集→基线） |

## Documentation Update Gate

移入 `completed/` 前（架构师评审用；开发智能体已在 Task 9 完成以下文档更新，最终移入仍由架构师决定）：
- [x] domain-model（中英）已更新配置集/基线/门禁实体与状态机
- [x] db-schema 已重生成（手动更新，含迁移 `0043` 汇总）
- [x] api-contract 已补配置集/基线/校验/导出路由
- [x] environment-variables 已记录 `DTS_VALIDATION_MODE`
- [x] SECURITY 已记录子进程执行与导出的安全约束
- [x] tech-debt-tracker 记录回填/沙箱后续/dt-schema 可选（TD-039 更新 + 新增 TD-040）
- [x] `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 一致
- [x] `npm run docs:check` 通过

> **UI 交互自动化规则：** P2 仍以服务端与 API 为主，若本期引入任何用户可见的配置集/基线管理入口，则须按 `AGENTS.md` 的 playwright-cli 前端验证规则补充证据并登记 requirement/operation ID；纯 API 交付则在计划中显式说明无可见 UI 变更（结构化管理 UI 主体在 P3）。

---

## Spec Coverage Self-Review（对现状评估问题 / 主计划边界）

| 目标 | 本期解决 | Task |
| --- | --- | --- |
| 顶层粒度：项目→配置集（可构建单元） | ✅ `dts_config_set` + 成员/角色/派生 | 1,2 |
| 发布基线（冻结/对比/原子回滚/发布标记） | ✅ `dts_release_baseline` | 1,3,4 |
| 合入前强制 dtc/schema 校验门禁 | ✅ `DtcValidator` + 门禁（可降级） | 5,6 |
| 无损导出供手动 Git 提交 | ✅ CST 序列化往返导出 | 7 |
| 不破坏 M1 参数流/单文件 API | ✅ 隐式默认集 + 增列兼容 | 1,2 |
| 类型感知差异（无假 diff） | ✅ 对比复用 P1 `normalizedValue` | 4 |

**留待后续（P3）：** 结构化值编辑器、结构化变更集/差异 UI、路径/label/compatible 检索、phandle/compatible 影响分析、节点级 RBAC；Git 提交集成为独立立项。
