# 有引用的属性键改名是源文件改写 cutover

> 状态：**已完成 2026-08-19** — preview / start / finalize / prepare / 工作台手顺已在 `main`（#544 / #549 / #553 / #555）。TD-117 已按接受残留关闭（#558）。  
> 余量：决策记在 [`2026-08-19-property-key-cutover-remainder.md`](2026-08-19-property-key-cutover-remainder.md)（选项 1 已接受；选项 2 已否决）。  
> 日期：2026-08-18  
> 分支：已由 #555 合入（`feat/td-117-property-key-workbench-handoff`）  
> English: [`docs/exec-plans/completed/2026-08-18-property-key-source-cutover.md`](../../../exec-plans/completed/2026-08-18-property-key-source-cutover.md)  
> 锁定决策：[ADR-0034](../../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md)  
> 追踪表：[TD-117](../tech-debt-tracker.md)（已按接受残留关闭）

## 目标

把绑错过的 `property_key` 做成**专用分阶段 cutover**：先在每个 binding 的**源文件**里改写属性名（草稿 / 变更请求，走现有评审），再在 **finalize** 时改 catalog 三元组（`property_key` + 派生的 `specification_key` / `schema_namespace`），使 ingest 只认已经改完的源。

本计划**不宣称**整条产品作业已完成。#544 已合入锁定架构与只读预检。#549 已合入 start + finalize。#553 已合入 prepare 暂存（文件候选，不激活现行源）与最小 Admin 面板。本分支交付**工作台手顺**：暂存后，每个 `file-candidate` 都是现有配置工作台候选审阅的可操作深链，并诚实展示候选实况；再预检确认源已是新键才能完成切换。作业仍不自动激活、不合入现行源。不另造参数值 CR——那条缝改不了属性名。

## 已锁定（不要重开）

以 ADR-0034 为准。不要改该文件的 Locked 结论。

| 已否决 | 原因 |
| --- | --- |
| 永远禁止且无后续 | 零引用改名已覆盖便宜路径；有引用需要迁移，不是死胡同 |
| 编辑器行内改名 + 确认框 | 确认不会改写 DTS，保存后 catalog 与源会分叉 |
| catalog alias（ingest 同时认新旧键） | 掩盖项目是否真的迁完；回写时只能猜发出哪个名字 |
| 废弃 + 重建 | 第二个身份、引用数被拆开、错键行仍可解析发布（ADR-0011 / ADR-0017） |
| 并进版本 cutover（ADR-0032 / ADR-0014 表） | 改标识 ≠ 改语义内容；finalize 写入不同 |

零引用改名仍走 `POST /api/v2/parameter-specs/:specId/rename-property-key`。`referenceCount > 0` 时该路由保持 `409` `{ parameterSpecId, referenceCount }`，编辑器「修正属性键」保持**禁用**。

## 架构

形态上对标 ADR-0014 版本 cutover（prepare items → ready → 原子 finalize），但**不复用**其表，也不共享爆炸半径。

```text
Admin 启动 run（from_key / to_key）
        │
        ▼
Prepare：按 binding tip 暂存源文件改名
         （旧键 → 新键，raw value 不变）
         走现有参数文件候选
         catalog 三元组不变
        │
        ▼
人在配置工作台激活文件候选
        │
        ▼
Finalize（同一事务）：改 catalog 三元组
         使之与已改写的源对齐
         审计：spec-property-key-cutover-finalized
```

1. **Start**（本刀）。Admin（平台全局行要 `platform-admin`，否则组织 Admin）对 `referenceCount > 0` 的定义启动作业：提议 `propertyKey` + `reason`。新三元组冲突（含已废弃阻挡方）、同一定义上已有开放**版本** cutover、或已有开放属性键 cutover → 拒绝。run 上持久化 `from_key` / `to_key`，并按预检位置为每个 binding 建项（复用现有 binding / occurrence 身份）。
2. **Prepare — 暂存文件候选**（本刀）。重读活源。对 `would-rewrite` 经现有参数文件候选 API 写入改名后的属性（raw value 不变）。**不**激活现行源。catalog 三元组不变。暂存前检查敏感节点规则。
3. **未清除则 incompatible**。`conflict`、`missing-from-source`、`no-occurrence` 保持 incompatible。禁止「跳过并让旧键留在源里」。
4. **只允许诚实 skip**。binding 已不在，或源里已是新键且没有旧键。
5. **按项目评审**。人在配置工作台激活文件候选（现有 Admin 审阅）。run 不自动合入、不写调试值、不绕过评审。不另造参数值 CR；那条缝不能改属性名。
6. **Finalize**（本刀）。仅当每个活位置都是 `already-new-key` 或诚实 skip。即使项看起来 ready，`triple-collision` / `open-version-cutover` 仍失败关闭。同一事务重写 `property_key` 与派生列。finalize 之后 ingest 只认新键。不设常驻 alias。

新表（名称示意；**迁移号在合入时按舰队协调规则认领**）：run 表 + item 表，平行于 `parameter_spec_version_cutover_*`，不要往那些表加状态列。

### 第一刀缝（#544 已合入）

`POST /api/v2/parameter-specs/:specId/property-key-cutover/preview` 只读。列出 binding tip 位置，分类（`would-rewrite` / `already-new-key` / `missing-from-source` / `no-occurrence` / `conflict`），并报告启动阻挡（`triple-collision`、`open-version-cutover`、`open-property-key-cutover`）。`writesCatalog` 与 `writesSource` 恒为 `false`。

### 本刀缝

- `POST .../property-key-cutover/start` — 按预检持久化 run + 项；拒绝阻挡；不改 catalog。
- `GET .../property-key-cutover` — 读开放 run（界面恢复）。
- `POST .../property-key-cutover/prepare` — 对 `would-rewrite` 暂存文件候选；`triple-collision` / `open-version-cutover` 失败关闭；**不**激活现行源。
- `POST .../property-key-cutover/finalize` — 阻挡或源未改写则失败关闭；然后改 catalog 三元组。审计：`spec-property-key-cutover-finalized`。

## 非目标（本计划与本 PR）

- 在 `referenceCount > 0` 时启用编辑器行内「修正属性键」。
- catalog alias、废弃+重建、或并进版本 cutover。
- 为属性**名**改写另造参数值变更请求（文件候选才是现有源草稿缝）。
- prepare 自动激活候选或合入现行源。
- 新开 ADR 号（ADR-0034 已在 `main`）。
- TD-049 ranking SQL、TD-052 树计数、TD-063 promote-to-drafts。
- 改 `docs/PLANS.md`、`docs/exec-plans/tech-debt-tracker.md`（任一语言）或 `.github/workflows/ci.yml`。PLANS 索引与追踪表备注归会话 0。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 从最新 `origin/main` 建隔离 worktree；在 `feat/td-117-property-key-workbench-handoff` 提交；`git push -u origin HEAD`；不合入 |
| 父代理 / 会话负责人 | 评审；若子代理未开 PR 则开 PR；评审后再合入，然后同步本地 `main` |

分支：`feat/td-117-property-key-workbench-handoff`。一计划一支。不要 push `main`，不要 `--no-verify`，不要改写已发布历史。

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

### 第 2 批 — Start / 源草稿 prepare（本 PR：prepare 暂存文件候选）

run + item 表（`0113` 已在 `main`）。start 拒绝冲突与开放版本 cutover。**本刀：** prepare 写入参数文件候选（旧键 → 新键），项标 `ready` 并带 `stagedRewrite`。不激活现行源。

### 第 3 批 — Finalize catalog 三元组（#549 已合）+ Admin 面板（#553 已合）

仅当每个活位置都是 `already-new-key` 或诚实 skip 后，原子改 catalog。`triple-collision` / `open-version-cutover` 失败关闭。审计 `spec-property-key-cutover-finalized`。定义编辑器最小面板：预检 → 启动 → 暂存 → 完成切换。行内改键保持禁用。

### 第 4 批 — 工作台手顺（本 PR）

暂存后，定义编辑器把每个已暂存的 `file-candidate` 做成可操作的配置工作台入口（现有路由 + 候选审阅 UI）。展示候选实况（已暂存 / 已合入现行源 / 已放弃 / 已不可用），并引导再预检后才能完成切换。prepare / finalize / 面板仍**不**激活候选、不写现行源。

## 成功标准（本刀）

- 暂存后，每个文件候选都有中文工作台深链，能打开该项目的候选审阅。
- GET / 恢复作业时候选状态诚实（不是 prepare 当时的过期快照）。
- 激活仍只走现有工作台；再预检全部为 `already-new-key` 之前 finalize 保持 `409`。
- catalog 仍只在 finalize 后变。
- `referenceCount > 0` 时行内改名仍拒绝/禁用。
- `npm run docs:check`、相关测试、`npm run contract:check`、`npm run build` 通过。
- PR 正文写明 TD-117 能否关闭；手顺是否还要跨页；未做项。

## 验收命令

```bash
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-specs/propertyKeyCutover.test.ts \
  server/modules/parameter-specs/propertyKeyCutover.integration.test.ts \
  server/modules/parameter-specs/propertyKeySourceRewrite.test.ts \
  server/modules/contracts/routeParity.test.ts
npx vitest run \
  src/application/parameters/propertyKeyCutoverHandoff.test.ts \
  src/components/parameter-topology/PropertyKeyCutoverPanel.test.tsx \
  src/components/parameter-topology/ParameterSpecDetailDialog.test.tsx \
  src/infrastructure/http/parameterTopologyClient.test.ts
npm run contract:check
npm run docs:check
npx tsc -b
npm run build
```

不要跑完整浏览器验收。新面板只在 `/parameter-admin/specs` 的 Admin 编辑器。不新增验收需求 ID 或操作 ID。不要把 Playwright 加进共享 CI 套件。

## 界面交互自动化审查

`usageCount > 0` 时定义编辑器增加属性键切换面板。暂存后深链到现有配置工作台候选审阅。行内「修正属性键」保持禁用。既有身份编辑器单测加上 `PropertyKeyCutoverPanel.test.tsx` 与 `propertyKeyCutoverHandoff.test.ts` 覆盖新交互。不新增验收需求 ID 或操作 ID。

## Documentation Impact Matrix

| 范围 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 复核 | `AGENTS.md`、`ARCHITECTURE.md` — 无运行时模式或地图变更。未改。 |
| 规划 | 更新 | 本计划 + 英文对照。**`docs/PLANS.md` / `docs/zh-CN/PLANS.md` 留给会话 0。** 不改追踪表对照页。 |
| 产品规格 | 复核 | `docs/product-specs/product-spec.md`（含中文）— 行内身份纠错仍是零引用。本刀不改产品规格。 |
| 领域 / 词汇 | 复核 | `CONTEXT.md`、`docs/design-docs/domain-model.md`（含中文）— 「仅零引用可改属性键」对行内路径仍成立。cutover 作业词条等第 2/3 批。 |
| 设计文档 / ADR | 复核 | [ADR-0034](../../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) Locked 原文不动。`docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md` 已指向此处。 |
| API | 更新 | `docs/design-docs/api-contract.md`（含中文）：预检 + start + prepare（文件候选）+ finalize + GET 开放 run。项带 `fileId`；GET 刷新候选实况。 |
| 前端 / 设计系统 | 更新 | `docs/FRONTEND.md`（含中文）：定义编辑器面板带工作台入口；行内改键保持禁用。 |
| 安全 | 更新 | prepare 在敏感节点检查后暂存文件候选；审计 `spec-property-key-cutover-started` / `-prepared` / `-finalized`。无新密钥。 |
| 可靠性 / runbook | 不变 | 无目标环境或运维规程。 |
| 开发者环境 | 不变 | 无新环境变量。 |
| 质量 / 验收 | 复核 | 既有身份编辑器单测 + 禁用回归。不改浏览器验收地图。 |
| 生成物 | 更新 | `docs/generated/openapi.json`（`npm run contract:openapi`）。迁移 `0113` + `docs/generated/db-schema.md`。 |
| 参考 | 复核 | 产品化 API 草稿不是现行契约。 |
| 技术债 | 不变 | TD-117 保持 **Open**。本 PR 不得改追踪表。 |

## Documentation Update Gate

一批次不得宣称完成，除非：

1. 该批次影响矩阵里每个「更新 / 复核」行已改过，或有证据记录为未变。
2. 中英追踪表行**不得**被悄悄关掉。人审合入 + finalize 成为产品内日常路径前，TD-117 保持 Open。
3. `npm run docs:check` 通过。PLANS 索引由会话 0 加；本分支缺索引是预期。
4. 已审查界面交互覆盖（第 1 批：无新交互）。
5. 计划迁入 `completed/` 时，同名文件不得留在 `active/`（中英皆然）。

未完成工作留在 `tech-debt-tracker.md`；不要从本分支删除该行。
