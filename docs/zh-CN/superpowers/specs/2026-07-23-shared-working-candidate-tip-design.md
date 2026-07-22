# 本轮草稿共用工作 tip — 设计

> 日期：2026-07-23  
> 状态：设计已批准，待实现计划  
> English: [`docs/superpowers/specs/2026-07-23-shared-working-candidate-tip-design.md`](../../../superpowers/specs/2026-07-23-shared-working-candidate-tip-design.md)  
> 关联：`DtsBindingDraftTray`、`createBindingDraft`（`editService.ts`）、`ApiProjectTopologyWorkspace`、binding-draft 提交路径

## 1. 背景

每次类型化 binding 编辑都会创建一个新的 **candidate config revision** tip。工作台会把 `preferredRevision` 推进到该 tip，使下一次编辑能叠在上面，但每条草稿行仍保留**创建当下**的 `candidateRevisionId`。

连续改参数 A 再改 B 后：

| 草稿 | `candidateRevisionId` |
|---|---|
| A | candidate₁ |
| B | candidate₂（以 candidate₁ 为 base，内容含 A+B） |

`DtsBindingDraftTray.candidateBlocker` 要求托盘内草稿共用同一个 candidate id，于是批量提交失败，并出现：

> 本轮修改属于不同 candidate revision，当前不能批量提交；请仅保留同一 candidate 的草稿。

用户心智里的「本轮修改」是一个袋子；系统却把每次编辑当成独立 tip 指针。拦截文案还把内部术语 `candidate revision` 暴露给用户。

服务端 `submitParameterChanges` 按草稿各自持久化的 candidate 加载，当前并不强制共享 tip——托盘门禁是主要体验故障。对「一轮审核」而言，本轮未提交草稿仍应指向**包含全部变更的同一 tip**。

## 2. 目标 / 非目标

### 目标

- 每个 **用户 × 项目** 仅有一个 **工作 tip**，覆盖**全部未提交**类型化草稿（含刷新后 hydrate）。
- 后续编辑必须叠在该 tip 上；每次创建成功后，将兄弟未提交草稿的 candidate **指针推进（rebase）** 到新 tip。
- 本轮可批量提交，无需用户删草稿或理解 candidate。
- UI 使用业务语言（「本轮 / 工作版本」）；用户可见拦截中不出现 `candidate revision`。
- 客户端使用过期 `baseRevisionId`（≠ 当前工作 tip）时返回明确 409。

### 非目标

- 不做多轮并行草稿批次（A/B 托盘卡片隔离）。
- 不改审核角色、合入/writeback、规格映射。
- 不把 mock 模式「本地草稿 → 本轮已修改表」双阶段再做成并行产品路径。
- 不做跨用户共享本轮（tip 仅限当前用户 × 项目）。
- 不对无法 heal 的脏多 tip 历史做完整三方合并（仅阻断 + 提示清空/重开）。

## 3. 产品规则

1. **本轮范围** = `(organization, project, user)` 下全部未提交类型化 binding 草稿。
2. **本轮第一次编辑**：`baseRevisionId` = 当前已发布/工作区 tip；创建工作 tip `T₁`；草稿挂在 `T₁`。
3. **后续编辑**：`baseRevisionId` **必须等于** 当前工作 tip `Tₙ₋₁`；叠出 `Tₙ`；新草稿挂在 `Tₙ`。
4. **推进兄弟草稿**：成功创建 `Tₙ` 后，将该轮其它未提交草稿的 `candidate_config_revision_id` 全部更新为 `Tₙ`。因 base 为 `Tₙ₋₁`，内容已包含先前编辑。
5. **同 binding 再改**：保持现有 upsert 同一 `draftId`；tip 推进；兄弟一并 rebase。
6. **清空本轮**：移除/清空最后一条未提交草稿后解除工作 tip；下次编辑重新开一轮。
7. **提交成功**：草稿离开未提交集合；审核/candidate 提升走既有路径。
8. **脏多 tip 数据**：创建前若未提交草稿无法归到可 heal 的单一 tip 链路，则拒绝并给出可行动中文文案（保留一组或清空重开）。若草稿已在同一线性 tip 链上，优先自动 heal。

## 4. 后端

主改动面：`server/modules/parameter-topology/editService.ts` 的 `createBindingDraft`（经 `service.ts` / routes / schemas 接线）。

### 4.1 解析工作 tip

Ingest 前：

- 加载当前用户 × 项目的未提交类型化草稿（与 list drafts / 可提交资格一致的过滤）。
- 工作 tip = 这些草稿 `candidate_config_revision_id` 在单一线性链上的最新 tip；若无草稿则无 tip。

### 4.2 Base 门禁

- 若已有工作 tip 且 `input.baseRevisionId !== workingTip` → `409 CONFLICT`，结构化 reason（如 `stale-working-tip` / 复用既有 stale-revision 形态），文案引导：刷新后基于本轮最新工作版本继续编辑。
- 若无工作 tip → 仅走既有 base 有效性检查。

### 4.3 新 tip `Tₙ` ingest 之后

- 按现有逻辑持久化新/更新草稿（含同 binding upsert）。
- 对其余本轮未提交草稿：`UPDATE … SET candidate_config_revision_id = Tₙ`。
- 可选：校验 tip 仍匹配各兄弟草稿的 action/目标值（复用提交时的 `candidateValueMatchesDraft` / action-proven 思路）；若不再匹配则 fail-closed，禁止静默错提。

### 4.4 响应 DTO（增量）

扩展创建草稿响应（及前端 `BindingDraftResult`）：

| 字段 | 含义 |
|---|---|
| `candidateRevisionId` | 新 tip `Tₙ`（被编辑草稿语义不变） |
| `workingCandidateRevisionId` | 与 tip 相同（显式别名） |
| `rebasedDraftIds` | 被推进 candidate 指针的兄弟草稿 id |

若路由已登记，同变更更新 OpenAPI / contract registry。

### 4.5 提交断言

在 `submitParameterChanges` 中：一批 exact binding 草稿的 `candidateConfigRevisionId` 必须全部相同且非空；否则 `409` + 业务中文文案（无英文黑话）。以 rebase 后的 DB 为准，避免仅靠托盘前端硬拦。

## 5. 前端

| 区域 | 改动 |
|---|---|
| `ApiProjectTopologyWorkspace` | 继续用返回 tip 设置 `preferredRevision`；创建成功后按 `rebasedDraftIds` 对齐本地托盘 `candidateRevisionId`（hydrate 以服务端为准）。 |
| `DtsBindingDraftTray` | 删除或降级展示 `candidate revision` 的 `candidateBlocker`；若仍见多 tip，改为可行动中文提示。状态文案：`本轮 N 项 · 同一工作版本`。 |
| Ports / HTTP client / 测试 | 接受新可选响应字段；断言多 binding 创建后共用 tip 且可提交。 |

提交 wire item 形状不变（`draftId`、binding、spec、action、value、reason、assignees）。

## 6. 文案

| 场景 | 方向 |
|---|---|
| 健康托盘 | `本轮 N 项 · 同一工作版本` |
| base 过期 / 不在 tip | `请刷新后基于本轮最新工作版本继续编辑。` |
| 无法 heal 的多 tip | `本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。` |
| 禁止 | 用户主说明中出现 `candidate revision` 或以 revision UUID 当主解释 |

## 7. 验收标准

1. 同一用户、同一项目连续修改 **≥2 个不同 binding**，托盘可直接「提交审核」，不再出现多 candidate 类拦截。
2. 刷新后 hydrate 的未提交草稿仍属同一轮；再改第三个参数，三条仍共享同一 tip 且可批量提交。
3. 同 binding 重复编辑仍 upsert 同一 `draftId`；tip 推进后兄弟草稿一并跟上。
4. `baseRevisionId ≠` 工作 tip 时创建草稿 → `409` + 刷新引导。
5. 托盘拦截路径无用户可见 `candidate revision`；健康态展示共用工作版本文案。
6. 相关单测 + 一条关键集成/验收路径通过。

## 8. 测试计划（设计级）

- `editService.test.ts`：两个不同 binding → `candidateRevisionId` 相同；第三次仍相同；base≠tip → 409；同 binding 替换仍一行。
- `submitParameterChanges` / service：混合 candidate 拒绝；共享 tip 接受。
- 前端工作区/托盘：连续创建更新兄弟 tip；不再被旧文案挡住提交。
- 可选验收：多参数编辑 → 提交本轮（复用既有 topology acceptance helpers）。

## 9. 文档影响

- 若 `docs/FRONTEND.md`（及 zh-CN 镜像）仍写「一次编辑一个孤立 candidate 才能提交」，随实现一并修正。
- 本文件为设计真相；实现计划在本文件获准进入规划后写入 `docs/superpowers/plans/`（及对应 zh-CN 镜像）。

## 10. 决策摘要

| 决策 | 选择 |
|---|---|
| 产品方案 | 共用工作 tip（方案 A） |
| 本轮范围 | 用户 × 项目下全部未提交草稿（范围 A） |
| Base 规则 | 已有 tip 时必须等于当前工作 tip |
| 兄弟更新 | 每次创建后由服务端推进 candidate 指针 |
| 托盘多 candidate 门禁 | 删除/替换；提交时由服务端断言共享 tip |
| 术语 | 不对用户暴露 |
