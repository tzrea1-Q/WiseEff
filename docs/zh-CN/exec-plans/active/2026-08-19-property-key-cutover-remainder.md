# 属性键 cutover 余量按接受残留关账

> 状态：**进行中** — 文档关账。锁定选项 1：跨页人工合入是 ADR 正确的残留，不是缺一台 cutover 机器。  
> 日期：2026-08-19  
> 分支：`feat/td-117-remainder-plan`  
> English: [`docs/exec-plans/active/2026-08-19-property-key-cutover-remainder.md`](../../../exec-plans/active/2026-08-19-property-key-cutover-remainder.md)  
> 父方案：[`2026-08-18-property-key-source-cutover.md`](2026-08-18-property-key-source-cutover.md)  
> 锁定决策：[ADR-0034](../../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md)  
> 追踪表：[TD-117](../tech-debt-tracker.md)（索引由会话 0 维护；本分支不关该行）

## 目标

在工作台手顺（#555）合入后，记录 TD-117 余量决策。

cutover 机器已在 `main`：预检、启动、暂存（仅文件候选）、工作台深链、再预检门禁、finalize。日常仍要离开定义编辑器去激活，再回来预检后才能完成切换。这是**导航**，不是迁移没做完。本方案被接受后，会话 0 把 TD-117 标为接受残留，并把父方案与本文件一并归档。

本 PR 只交付决策记录和父方案一行指针。不改产品代码、ADR-0034、追踪表或 `docs/PLANS.md`。

## 锁定决策

**选项 1 — 将 TD-117 按接受残留关闭。**

ADR-0034 已经写明人工合入：项在成为可合入候选后就绪；人走现有审阅 / 激活路径；cutover 作业不得自动合入、不得写现行源。仅当现行源已经是新键之后，finalize 才改 catalog 三元组。

#555 让这条路径可找到。`PropertyKeyCutoverPanel` 列出每个已暂存的 `file-candidate`，展示实况，并用 `formatPropertyKeyCutoverWorkbenchHref` 生成 SPA 深链（`configSet` + `file` + `node` + `sourceMode=candidate` + `candidate` + `inspector=file`），经 `handleSpaLinkClick` 跳转。激活仍归工作台（`POST /api/v1/projects/:projectId/parameter-file-candidates/:candidateId/activate`、影响 ConfirmDialog、`configSetId`、状态失败关闭）。面板经 `GET .../property-key-cutover` / `loadOpenRun` 恢复。再预检全部为 `already-new-key` 之前，完成切换保持禁用。`referenceCount > 0` 时行内「修正属性键」保持禁用。

追踪表已把余量写成：同页激活（超出 ADR-0034 范围）**或**把跨页回路当作产品。核对面板与现有激活缝之后，没有挡住作业完成的产品缺口。mock 上 start / prepare / finalize 仍 `FORBIDDEN` 只是演示残留，不足以改架构。

## 否决备选

**选项 2 — 编辑器内人工合入，不自动激活。** 继续用现有激活 API 与工作台不变量。操作者可在定义编辑器面板里显式确认激活已暂存的 `file-candidate`，不必再找草稿；仍是一次人工点击，作业本身仍不写现行源，catalog 仍只在现行源已是新键后的 finalize 改写。否决原因：#555 已经去掉「找不到草稿」；剩下的只是离开 `ParameterSpecDetailDialog` 再回来。这是便利，不是缺机器。若后续产品评审证明人无法在现有路径上做完合入 + finalize（`loadOpenRun` 也恢复不了的上下文丢失），会话 0 可以推翻本锁定。推翻后只做一条可选 UX，接现有激活缝，不新开 cutover 作业。

## 拒绝实现

- 从 prepare、finalize 或面板自动激活 / 自动合入现行源。
- 在 `referenceCount > 0` 时启用行内「修正属性键」。
- 为属性**名**另造参数值变更请求。
- catalog 仅 alias、废弃+重建、或并进版本 cutover。
- 新开 ADR。ADR-0034 保持锁定。

**不属于本方案**的残留：mock 的 start / prepare / finalize 仍 `FORBIDDEN`；仅 `.dts`。它们不挡住本次关账。

## 接受后会话 0 要记的内容

会话 0 做，本分支不做：

1. 在中英追踪表把 TD-117 标为**接受残留**：日常仍是编辑器 → 工作台合入 → 回来再预检 → finalize；同页激活已否决。
2. 更新 `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md`，由本余量方案接管未完成项，再把 2026-08-18 父方案与本文件一并迁入 `completed/`（同名文件不得留在 `active/`）。
3. 不要重开 ADR-0017 或 ADR-0034。不要启用行内改键。

## 非目标

- 任何产品、API 或 schema 变更。
- 同页激活（选项 2），除非会话 0 推翻上面的锁定。
- 本分支改 `docs/PLANS.md`、任一追踪表、`.github/workflows/ci.yml` 或 ADR-0034。
- mock cutover 写入、非 `.dts` 文件、新验收 ID。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 从最新 `origin/main` 建隔离 worktree；在 `feat/td-117-remainder-plan` 提交；`git push -u origin HEAD`；不开 PR；不合入 |
| 父代理 / 会话负责人 | 评审，开 GitHub PR，评审后再合入，然后同步本地 `main`。接受后由会话 0 更新 PLANS 索引与追踪表。 |

一计划一支。不要 push `main`，不要 `--no-verify`，不要改写已发布历史。

## 批次

### 第 0 批 — 决策记录（本 PR）

1. 新增本计划中英对照，含锁定选项、否决备选、影响矩阵、更新门禁与验收。
2. 在父方案中英页头各加一句余量归属。不要改写父方案正文。
3. **不要**在本 PR 把计划挂进 `docs/PLANS.md`（会话 0）。

### 第 1 批 — 会话 0 关账（不在本分支）

关追踪表、改 PLANS 索引、归档父方案与本余量方案。

## 成功标准

- 余量决策为选项 1，并写明选项 2 以便推翻。
- 父方案页头指向此处；父方案架构正文除此之外不改。
- 本分支上 TD-117 保持 **Open**。
- `npm run docs:check` 通过。
- 不改产品文件。

## 风险

把追踪表标成残留，不能被读成可以启用行内改键或自动激活。若后续证明人无法在现有路径上做完，推翻到选项 2 —— 仍是对现有激活 API 的一次人工点击。

## 验收命令

```bash
npm run docs:check
```

不跑应用构建。不加新测试。不跑浏览器验收，也不跑 playwright-cli —— 本刀只有文档。

## 界面交互自动化审查

无面向用户的交互变更。不新增验收需求 ID 或操作 ID。面板与工作台激活覆盖维持 #553 / #555 已合入的范围。

## Documentation Impact Matrix

| 范围 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 不变 | `AGENTS.md`、`ARCHITECTURE.md` — 无运行时模式或地图变更。 |
| 规划 | 更新 | 本计划 + 英文对照。2026-08-18 父方案中英页头各加一句。**`docs/PLANS.md` / `docs/zh-CN/PLANS.md` 留给会话 0。** 不改追踪表对照页。 |
| 产品规格 | 复核 | `docs/product-specs/product-spec.md`（含中文）— 行内身份纠错仍是零引用。未改。 |
| 领域 / 词汇 | 复核 | `CONTEXT.md`、`docs/design-docs/domain-model.md`（含中文）— 行内改键仍仅零引用。未改。 |
| 设计文档 / ADR | 复核 | [ADR-0034](../../../adr/0034-referenced-property-key-rename-is-a-source-cutover.md) Locked 原文不动。无中文 ADR 对照页。 |
| API | 不变 | 预检 / start / prepare / GET / finalize 已有文档。无新路由。 |
| 前端 / 设计系统 | 复核 | `docs/FRONTEND.md`（含中文）已描述跨页手顺与 SPA 链接。本刀无界面变更。 |
| 安全 | 不变 | 无新写路径或密钥。 |
| 可靠性 / runbook | 不变 | 无目标环境或运维规程。 |
| 开发者环境 | 不变 | 无新环境变量。 |
| 质量 / 验收 | 复核 | 无新交互。不改浏览器验收地图。 |
| 生成物 | 不变 | 不改 OpenAPI 或 schema。 |
| 参考 | 复核 | 产品化 API 草稿不是现行契约。未改。 |
| 技术债 | 不变 | 本分支上 TD-117 保持 **Open**。接受后由会话 0 关闭。 |

## Documentation Update Gate

一批次不得宣称完成，除非：

1. 该批次影响矩阵里每个「更新 / 复核」行已改过，或有证据记录为未变。
2. 中英追踪表行**不得**在本分支被悄悄关掉。本方案被接受后，才由会话 0 关闭 TD-117。
3. `npm run docs:check` 通过。PLANS 索引由会话 0 加；本分支缺索引是预期。
4. 已审查界面交互覆盖（本刀：无新交互）。
5. 计划迁入 `completed/` 时，同名文件不得留在 `active/`（中英皆然）。会话 0 同一次归档 2026-08-18 父方案。

未完成工作留在 `tech-debt-tracker.md`，直到会话 0 记下关闭；不要从本分支删除该行。
