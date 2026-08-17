# Parameter-Topology editService 拆分：writeLock + overlayWriteback（架构评审候选项 6）

> Status: **Completed**（经 PR #327 于 2026-08-12 合入）。文档门禁于 2026-08-17 关闭。binding/enablement 去重仍为未排期的非目标。
> Date: 2026-08-12
> Branch: `refactor/topology-writelock-writeback`（自 `main` @ `8ab19113` 创建）
> English: [`docs/exec-plans/completed/2026-08-12-topology-writelock-writeback.md`](../../../exec-plans/completed/2026-08-12-topology-writelock-writeback.md)

## 背景

2026-08-12 架构评审将 `server/modules/parameter-topology/editService.ts`（候选项 6）标记为大杂烩：2,912 行、15 个导出，把草稿创建、四个近乎重复的写锁函数、两条复制出来的 binding/enablement 回写管线、DTS 文本操作和对象存储 I/O 混在一个文件里。候选项 1–2 由 `2026-08-12-app-shell-decomposition.md` 负责；候选项 3–4 由数据库层深化计划负责；本计划执行候选项 6，做逐字（verbatim）、零行为变化的提取。

## 目标

从 `editService.ts` 提取两个内聚模块，所有被移动的函数体逐字节保持一致（唯一允许的差异是给原先模块私有的共享辅助函数加上 `export`）：

- `server/modules/parameter-topology/writeLock.ts` —— 写锁解析/校验（`resolveBindingWriteLock`、`verifyBindingWriteLock`、`resolveEnablementWriteLock`、`verifyEnablementWriteLock`）、`BindingWriteLockFields` / `BindingWriteLockContext` / `EnablementWriteLockFields` / `EnablementWriteLockContext` 类型，以及这些函数依赖的共享写目标解析辅助（`loadBindingContext`、`loadRevisionMembers`、`resolveWriteTarget`、`resolveTargetRef`、`firstLabel`、`locatorLeafLabel`、`loadLogicalNodeEnablementContext`，含 `BindingContextRow` / `RevisionMemberRow` / `EffectRow` 行类型）。
- `server/modules/parameter-topology/overlayWriteback.ts` —— 加锁回写管线（`applyLockedOverlayWriteback`、`applyLockedEnablementWriteback` 及其 Input/Result 类型）、`ensureOverlayProperty` 与其私有 CST 区间辅助（`findAllOverlayNodesByRef`、`findPropertyByExactSpan`、`findNodeByExactSpan`、`propertyStatementSpan`、`insertAfterNodeOpenBrace`、`resolveInsertTargetNode`）、`loadFileContentFromVersion`，以及共享候选门禁辅助（`checksumOf`、`throwIfManifestNeedsReview`、`loadCandidateSemanticGateCounts`、`ensureCandidateKeepStatus`、`candidateGateError`）。

`editService.ts` 保留草稿创建（`createBindingDraft`、`createNodeEnablementDraft`）、草稿 DTO 类型、`resolveInitializationSuggestion`、`unchangedSourceBytes`（仅测试用的草稿结果断言辅助——已核实不属于回写管线）、`assertCandidateToolchainRelease` 及仅草稿使用的私有辅助，并从两个新模块导入被移走的部分。

共享辅助函数下沉进新模块（而非留在原处），以保证运行时依赖无环：`editService → overlayWriteback → writeLock →（repository、shared）`。合并当时唯一指回 `editService.ts` 的引用是编译期擦除的 `import type` 行（`BindingDraftWriteTarget`、`BindingEditAction`、`CreateBindingDraftDeps`）——这也是 `loadLogicalNodeEnablementContext` 必须移入 `writeLock.ts` 而非留在原文件的原因。

**后续已完成（2026-08-12，`refactor/parameters-repository-split-2`）：** 三个类型已迁至新家——`BindingDraftWriteTarget` 移入 `writeLock.ts`（经 `resolveWriteTarget` 生产它的模块），`BindingEditAction` 与 `CreateBindingDraftDeps` 移入 `overlayWriteback.ts`（主要消费方）。`writeLock.ts` 与 `overlayWriteback.ts` 不再从 `editService.ts` 导入任何内容；`editService.ts`、`parameter-topology/service.ts`、`parameter-files/writebackService.ts` 均改从新位置导入这些类型。类型依赖图与运行时依赖图一致：`editService → overlayWriteback → writeLock`，无回向引用。

不设兼容性 re-export：所有导入方一并改指向。更新的导入位置：

- `server/modules/parameters/service.ts` —— `verifyBindingWriteLock`、`verifyEnablementWriteLock`、`loadLogicalNodeEnablementContext` 改从 `writeLock` 导入；`resolveInitializationSuggestion` 仍从 `editService`（仅改 import 语句行）。
- `server/modules/parameters/repository.ts` —— `BindingWriteLockFields` / `EnablementWriteLockFields` 类型导入改指 `writeLock`（仅一行 import；无其他改动）。
- `server/modules/parameter-files/writebackService.ts` —— `applyLocked*` 改从 `overlayWriteback`；`resolve*WriteLock` 与四个锁类型改从 `writeLock`；`BindingEditAction` 仍从 `editService`。
- `server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts` 与 `server/modules/parameter-topology/editService.test.ts` —— 仅改导入路径。

测试策略：被移函数的测试块保留在 `editService.test.ts`，仅更新导入。`applyLockedOverlayWriteback` 的 describe 块（46 行）以及 `resolveBindingWriteLock` 的调用点与约 490 行共享 fixture（`seedGraph`、`seedConfigAndBinding`、`makeAuth`、工具链替身）深度耦合，四个 describe 共用这些 fixture；搬走它们需要复制或重构 fixture，diff 更大且覆盖零收益。

## 非目标

- **不做 binding/enablement 去重。** binding 与 enablement 变体（锁、回写、草稿管线）之间的近似重复被明确推迟；合并它们需要单独的等价性证明。
- **不做共享内核迁移。** 后端文件对 `../../../src/domain/*` 的导入（12 个后端文件导入 `src/domain`）原样保留；共享内核重新安置是单独的延期任务。
- **零行为变化。** 不重命名、不改签名、不改逻辑、不引入接口或依赖注入类型。

## 验证

- 机械逐字校验：迁移前 `editService.ts` 的全部 58 个顶层声明与迁移后位置逐字节比对（仅允许新增 `export ` 前缀）——全部一致。
- 每个提交处 `npx tsc -b` 通过。
- `npm run test:server` 范围运行：`server/modules/parameter-topology/*` 20 个文件中 19 个通过（238 个测试通过）；`server/modules/parameters/service.test.ts` 通过；`server/modules/parameter-files/*` 37 个文件中 32 个通过。失败项——`parameter-topology/migration.test.ts`（9 个测试，`relation "parameter_definitions" does not exist`）与 13 个 `parameter-files/*.integration.test.ts` 测试——在干净 `main` 上以完全相同的方式失败（经 stash / detached-HEAD 运行核实），属于与本变更无关的环境 schema 问题。
- `npm run docs:check` 通过。

## UI 交互自动化审查

纯后端逐字重构：路由、表单、表格、上传、弹窗、审批、导航、客户端、权限、设备行为均无变化。不影响任何验收需求 ID 或操作 ID；既有浏览器验收用例继续原样覆盖相关流程。

## Git 与 PR 工作流

- 单一分支：`refactor/topology-writelock-writeback`，自 `main` @ `8ab19113`。提交顺序：writeLock 提取、overlayWriteback 提取（每个提交 `tsc -b` 通过），最后是本计划文档。
- 实现代理只在特性分支提交；父代理负责评审、创建 GitHub PR、通过后合并并同步本地 `main`。

## Documentation Impact Matrix

| 文档 | 路径 | 影响 |
| --- | --- | --- |
| 仓库地图 | `AGENTS.md` | No change（`server/modules/parameter-topology/` 内部的模块布局低于地图粒度） |
| 架构 | `ARCHITECTURE.md` | No change（模块边界与数据流不变；文件拆分在单一模块内部） |
| 架构（中文） | `docs/zh-CN/architecture.md` | No change（同上镜像） |
| 全栈架构 | `docs/design-docs/full-stack-architecture.md` | No change（无缝隙或分层变化） |
| 领域模型 | `docs/design-docs/domain-model.md` | No change（无实体或状态机变化） |
| 计划索引 | `docs/PLANS.md` | 收口时已登记为 completed（#327） |
| 计划索引（中文） | `docs/zh-CN/PLANS.md` | 收口时已同步中文索引行 |
| 技术债 | `docs/exec-plans/tech-debt-tracker.md` | 收口时确认：binding/enablement 去重仍为未排期非目标；共享内核已由 `2026-08-12-parameters-repository-split.md` slice 4–4b 落地 |
| 产品规格 | `docs/product-specs/*` | No change（无产品行为变化） |
| API 文档 | `docs/api/*` | No change（无端点/DTO 变化） |
| 质量/测试 | `docs/QUALITY_SCORE.md`、`docs/design-docs/testing-strategy.md` | No change（测试文件与覆盖不变；仅改导入行） |
| 可靠性/运行手册 | `docs/RELIABILITY.md`、`docs/runbooks/*` | No change |
| 安全 | `docs/SECURITY.md`、`docs/security/*` | No change（鉴权/审计路径未触及） |
| 前端 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | No change（纯后端） |
| 生成物 | `docs/generated/*` | No change（无 schema 变化） |
| 参考 | `docs/references/*` | No change |

## Documentation Update Gate

本计划已于 2026-08-17 移入 `completed/`。binding/enablement 去重仍为未排期的非目标；共享内核安置已由 `2026-08-12-parameters-repository-split.md` slice 4–4b 落地。

## 预期结果

- `editService.ts` 1,242 行（原 2,912）：仅保留草稿创建与面向草稿的辅助。
- `writeLock.ts` 796 行：锁解析/校验及共享写目标解析。
- `overlayWriteback.ts` 930 行：加锁回写管线、CST 修补辅助、对象存储文件加载、候选门禁。
- 零行为变化：被移函数体逐字节一致；所有导入方改指向；无兼容性 re-export;运行时模块图无环。
