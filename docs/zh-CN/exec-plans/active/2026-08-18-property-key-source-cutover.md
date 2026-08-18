# 有引用的属性键改名是源文件改写 cutover

> 状态：**进行中** — 第 2/3 批垂直切片（start + finalize）。prepare 只重分类；不暂存文件候选/CR，也无编辑器入口。TD-117 保持 **Open**。  
> 日期：2026-08-18  
> 分支：`feat/td-117-property-key-cutover-finalize`  
> English: [`docs/exec-plans/active/2026-08-18-property-key-source-cutover.md`](../../../exec-plans/active/2026-08-18-property-key-source-cutover.md)  
> 锁定决策：[ADR-0034](../../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md)  
> 追踪表：[TD-117](../tech-debt-tracker.md)（本 PR 只读；索引由会话 0 维护）

## 目标

把绑错过的 `property_key` 做成**专用分阶段 cutover**：先在每个 binding 的**源文件**里改写属性名（草稿 / 变更请求，走现有评审），再在 **finalize** 时改 catalog 三元组（`property_key` + 派生的 `specification_key` / `schema_namespace`），使 ingest 只认已经改完的源。

本计划**不宣称**整条产品作业已完成。#544 已合入锁定架构与只读预检。本分支交付可运行的 **start →（源已改写）→ finalize** 垂直切片：按预检位置持久化 run，对 `triple-collision` / `open-version-cutover` 失败关闭，仅当活源已是新键后才改 catalog 三元组。prepare **尚未**暂存文件候选 / CR 草稿。

## 已锁定（不要重开）

以 ADR-0034 为准。不要改该文件的 Locked 结论。

| 已否决 | 原因 |
| --- | --- |
| 永远禁止且无后续 | 零引用改名已覆盖便宜路径；有引用需要迁移，不是死胡同 |
| 编辑器行内改名 + 确认框 | 确认不会改写 DTS，保存后 catalog 与源会分叉 |
| catalog alias（ingest 同时认新旧键） | 掩盖项目是否真的迁完；回写时只能猜发出哪个名字 |
| 废弃 + 重建 | 第二个身份、引用数被拆开、错键行仍可解析发布（ADR-0011 / ADR-0017） |
| 并进版本 cutover（ADR-0032 / ADR-0014 表） | 改标识 ≠ 改语义内容；finalize 写入不同 |

零引用改名仍走 `POST /api/v2/parameter-specs/:specId/rename-property-key`。`referenceCount > 0` 时该路由保持 `409` `{ parameterSpecId, referenceCount }`，编辑器「修正属性键」保持**禁用**，直到 finalize 落地。

## 架构

形态上对标 ADR-0014 版本 cutover（prepare items → ready → 原子 finalize），但**不复用**其表，也不共享爆炸半径。

```text
Admin 启动 run（from_key / to_key）
        │
        ▼
Prepare：按 binding tip 暂存源文件改名
         （旧键 → 新键，raw value 不变）
         走结构化编辑 / binding 草稿 + CR
         catalog 三元组不变
        │
        ▼
人走现有变更请求合入
        │
        ▼
Finalize（同一事务）：改 catalog 三元组
         使之与已改写的源对齐
         审计：spec-property-key-cutover-finalized
```

1. **Start**（本刀）。Admin（平台全局行要 `platform-admin`，否则组织 Admin）对 `referenceCount > 0` 的定义启动作业：提议 `propertyKey` + `reason`。新三元组冲突（含已废弃阻挡方）、同一定义上已有开放**版本** cutover、或已有开放属性键 cutover → 拒绝。run 上持久化 `from_key` / `to_key`，并按预检位置为每个 binding 建项（复用现有 binding / occurrence 身份）。
2. **Prepare — 只重分类**（本刀，薄实现）。重读活源位置，将项标为 `pending` / `skipped` / `incompatible`。**不**创建文件候选或变更请求草稿。catalog 三元组不变。
3. **未清除则 incompatible**。`conflict`、`missing-from-source`、`no-occurrence` 保持 incompatible。禁止「跳过并让旧键留在源里」。
4. **只允许诚实 skip**。binding 已不在，或源里已是新键且没有旧键。
5. **按项目评审**（本刀未做）。经文件候选 / CR 暂存可合入源改写仍属后续。run 不自动合入、不写调试值、不绕过评审。
6. **Finalize**（本刀）。仅当每个活位置都是 `already-new-key` 或诚实 skip。即使项看起来 ready，`triple-collision` / `open-version-cutover` 仍失败关闭。同一事务重写 `property_key` 与派生列。finalize 之后 ingest 只认新键。不设常驻 alias。

新表（名称示意；**迁移号在合入时按舰队协调规则认领**）：run 表 + item 表，平行于 `parameter_spec_version_cutover_*`，不要往那些表加状态列。

### 第一刀缝（#544 已合入）

`POST /api/v2/parameter-specs/:specId/property-key-cutover/preview` 只读。列出 binding tip 位置，分类（`would-rewrite` / `already-new-key` / `missing-from-source` / `no-occurrence` / `conflict`），并报告启动阻挡（`triple-collision`、`open-version-cutover`、`open-property-key-cutover`）。`writesCatalog` 与 `writesSource` 恒为 `false`。

### 本刀缝

- `POST .../property-key-cutover/start` — 按预检持久化 run + 项；拒绝阻挡；不改 catalog。
- `POST .../property-key-cutover/prepare` — 按活源重分类；**不**暂存草稿/CR，不写 DTS。
- `POST .../property-key-cutover/finalize` — 阻挡或源未改写则失败关闭；然后改 catalog 三元组。审计：`spec-property-key-cutover-finalized`。

## 非目标（本计划与本 PR）

- 在 `referenceCount > 0` 时启用编辑器行内「修正属性键」。
- catalog alias、废弃+重建、或并进版本 cutover。
- 经文件候选 / 变更请求暂存源改写（prepare 只重分类）。
- 提供**启动作业**的 Admin 界面（本刀只有 API）。
- 新开 ADR 号（ADR-0034 已在 `main`）。
- TD-049 ranking SQL、TD-052 树计数、TD-063 promote-to-drafts。
- 改 `docs/PLANS.md`、`docs/exec-plans/tech-debt-tracker.md`（任一语言）或 `.github/workflows/ci.yml`。PLANS 索引与追踪表备注归会话 0。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 从最新 `origin/main` 建隔离 worktree；在 `feat/td-117-property-key-cutover-finalize` 提交；`git push -u origin HEAD`；不合入 |
| 父代理 / 会话负责人 | 评审；若子代理未开 PR 则开 PR；评审后再合入，然后同步本地 `main` |

分支：`feat/td-117-property-key-cutover-finalize`。一计划一支。不要 push `main`，不要 `--no-verify`，不要改写已发布历史。

合入时（舰队协调）：对照刷新后的 `origin/main` 复核 ADR / 迁移 / TD 编号。本分支**不得**新开 ADR。若后续批次加迁移，编号在合入时认领。

## 批次

### 第 0 批 — 方案产物（本 PR）

1. 新增本计划中英对照，含目标、架构、Git 与 PR、影响矩阵、更新门禁、验收与诚实非目标。
2. **不要**在本 PR 把计划挂进 `docs/PLANS.md`（会话 0）。

### 第 1 批 — 只读预检 + 行内改名回归（本 PR）

1. `referenceCount > 0` 时 `rename-property-key` 保持 `409`（服务端与 mock 已有；本套件再断言 catalog 未变）。
2. `usageCount > 0` 时「修正属性键」保持禁用；点击不得打开行内改名对话框。
3. 新增 `previewPropertyKeySourceCutover`（新模块）与 `POST .../property-key-cutover/preview`。
4. 在 api-contract 中英页写预检路由，并重新生成 `docs/generated/openapi.json`。

### 第 2 批 — Start / 源草稿 prepare（本 PR：start + 薄 prepare）

run + item 表（`0113_parameter_spec_property_key_cutover.sql`；合入时复核编号）。start 拒绝冲突与开放版本 cutover。prepare 按活源重分类。**未做：** 暂存文件候选 / CR 草稿。

### 第 3 批 — Finalize catalog 三元组（本 PR：改 catalog）

仅当每个活位置都是 `already-new-key` 或诚实 skip 后，原子改 catalog。`triple-collision` / `open-version-cutover` 失败关闭。审计 `spec-property-key-cutover-finalized`。**未做：** 启动作业的 Admin 界面。

## 成功标准（本刀）

- start 按预检位置持久化 run，不写 catalog、不写源。
- 仅当源已是新键后，finalize 才改 `parameter_specs.property_key` 与派生列。
- start / finalize 对 `triple-collision` 与 `open-version-cutover` 失败关闭；catalog 不变。
- `referenceCount > 0` 时行内改名仍拒绝/禁用。
- `npm run docs:check`、相关测试、`npm run contract:check`、`npm run build` 通过。
- PR 正文写明 TD-117 仍 Open：prepare 不暂存草稿/CR；无启动作业 UI。

## 验收命令

```bash
npx vitest run \
  server/modules/parameter-specs/propertyKeyCutover.test.ts \
  server/modules/parameter-specs/propertyKeyCutover.integration.test.ts \
  server/modules/parameter-specs/specIdentityCorrection.integration.test.ts \
  server/modules/contracts/routeParity.test.ts \
  src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx \
  src/infrastructure/mock/mockParameterTopologyRepository.test.ts
npm run contract:check
npm run docs:check
npx tsc -b
npm run build
```

不要跑完整浏览器验收。本刀只加 Admin API；编辑器行内改名路径未变。

## 界面交互自动化审查

无新的用户可感知交互。编辑器在 `usageCount > 0` 时仍禁用「修正属性键」。本刀只加 Admin API。不新增验收需求 ID 或操作 ID。不要把 Playwright 加进共享 CI 套件。

## Documentation Impact Matrix

| 范围 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 复核 | `AGENTS.md`、`ARCHITECTURE.md` — 无运行时模式或地图变更。未改。 |
| 规划 | 更新 | 本计划 + 英文对照。**`docs/PLANS.md` / `docs/zh-CN/PLANS.md` 留给会话 0。** 不改追踪表对照页。 |
| 产品规格 | 复核 | `docs/product-specs/product-spec.md`（含中文）— 行内身份纠错仍是零引用。本刀不改产品规格。 |
| 领域 / 词汇 | 复核 | `CONTEXT.md`、`docs/design-docs/domain-model.md`（含中文）— 「仅零引用可改属性键」对行内路径仍成立。cutover 作业词条等第 2/3 批。 |
| 设计文档 / ADR | 复核 | [ADR-0034](../../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) Locked 原文不动。`docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md` 已指向此处。 |
| API | 更新 | `docs/design-docs/api-contract.md`（含中文）：预检 + start + prepare + finalize 路由。 |
| 前端 / 设计系统 | 复核 | `docs/FRONTEND.md`、`docs/design-docs/ui-design-system.md` — 无视觉或交互变更。 |
| 安全 | 复核 | start / prepare / finalize 是 Admin 门禁的写；审计 `spec-property-key-cutover-started` / `-prepared` / `-finalized`。无新密钥。 |
| 可靠性 / runbook | 不变 | 无目标环境或运维规程。 |
| 开发者环境 | 不变 | 无新环境变量。 |
| 质量 / 验收 | 复核 | 既有身份编辑器单测 + 禁用回归。不改浏览器验收地图。 |
| 生成物 | 更新 | `docs/generated/openapi.json`（`npm run contract:openapi`）。迁移 `0113` + `docs/generated/db-schema.md`。 |
| 参考 | 复核 | 产品化 API 草稿不是现行契约。 |
| 技术债 | 不变 | TD-117 保持 **Open**。本 PR 不得改追踪表。 |

## Documentation Update Gate

一批次不得宣称完成，除非：

1. 该批次影响矩阵里每个「更新 / 复核」行已改过，或有证据记录为未变。
2. 中英追踪表行**不得**被悄悄关掉。TD-117 在 finalize 落地前保持 Open。
3. `npm run docs:check` 通过。PLANS 索引由会话 0 加；本分支缺索引是预期。
4. 已审查界面交互覆盖（第 1 批：无新交互）。
5. 计划迁入 `completed/` 时，同名文件不得留在 `active/`（中英皆然）。

未完成工作留在 `tech-debt-tracker.md`；不要从本分支删除该行。
