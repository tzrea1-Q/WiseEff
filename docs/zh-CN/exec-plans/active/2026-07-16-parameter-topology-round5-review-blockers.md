# 参数拓扑第五轮 Review 阻断修复

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-round5-review-blockers.md)
> 上一轮：[第四轮](./2026-07-16-parameter-topology-round4-review-blockers.md)

**目标：** 关闭父智能体第四轮 Review 阻断：base binding revision 不可变、merge/writeback 真 fail-closed、stage/finalize 不可变 phase 审计、租户拥有校验、createSpec 草稿→激活→裁决、验收去掉 fallback。

**分支：** `fix/parameter-topology-round5-review-blockers`  
**保留基线：** Round4 `8a6971bd`（`--no-ff` 合并）。**TD-042 仍为 BLOCKER — 非 production cutover ready。**

## 第五轮已落地修复（实现证据）

| 修复项 | 证据 |
| --- | --- |
| 不可变 base 与 candidate binding revision | `applyLockedOverlayWriteback` 仅在 candidate config revision upsert binding revision；`postCutoverWorkflow.integration.test.ts` 证明 base 仍为 `<1>`、candidate 为 `<9>` |
| Fail-closed 回写依赖 | `parameters/service` 合并在缺 `objectStore`/项目/write lock 时拒绝；真实 DTC 经 `assertCandidateToolchainRelease`；无 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` 生产路径 |
| 不可变 phase 审计与运行关联 | `migration.test.ts` — `parameter_identity_migration_phases` 仅追加；推断任务带 `migration_run_id`；cutover 拒绝仅 staged/伪造运行 |
| 租户拥有校验 resolve | `validateSpecReviewTenantEvidence` 租户 join；跨租户 PG 负向测试；0055 加固 |
| 手工规格 draft→激活→resolve | `draftSpecWorkflow.integration.test.ts`；`POST /api/v2/parameter-specs/:specId/activate`；`DraftSpecActivatePanel` + `ParameterSpecLibrary` |
| 验收 fixture 诚实化 | `acceptanceTaskLookup.ts`、`semanticFixtureCleanup.ts`；拓扑验收 draft→activate→resolve；无 `items[0]` fallback |

## 成功标准

1. Merge 不得 UPDATE 锁定 base config revision 对应的 binding revision；新值只在 candidate revision。
2. 缺 objectStore / projectId / write lock / 真实 DTC 时 fail-closed；删除生产路径上的 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN`。
3. stage 与 finalize 保留独立 phase 审计；cutover 只接受成功 finalize 的逻辑运行。
4. resolve 用租户级 join 校验 org/project/revision/occurrence/logical node；0055 不信任 raw evidence。
5. createSpec 只建 org draft（从 AST 推断类型）；激活需 Admin；仅 active+完整约束可 resolve。
6. Acceptance 去掉 `items[0]` fallback；清理按前缀且 FK 完整。
7. `git diff --check main...HEAD` 通过；双语文档更新；TD-042 不关闭。

## 任务依赖

```text
计划
  → T1 不可变 merge / fail-closed 失败测试
  → T2 P0-1 不可变 base binding
  → T3 P0-2 真 fail-closed writeback
  → T4 stage/finalize 审计失败测试
  → T5 P1-1 phase 审计与 run 关联
  → T6 跨租户证据失败测试
  → T7 P1-2 租户 resolve + 0055
  → T8 createSpec 草稿失败测试
  → T9 P1-3 draft→activate→resolve
  → T10 P2 acceptance fixture
  → T11 文档与全量门禁
```

## 测试矩阵

| 领域 | 命令 / 焦点 |
| --- | --- |
| 不可变 merge | `postCutoverWorkflow.integration.test.ts` |
| Fail-closed writeback | service/writeback；环境变量不得绕过 |
| Stage/finalize | `migration.test.ts` phase、并发、inject-fail |
| 租户证据 | 真实 PG 跨租户负向测试 |
| Draft createSpec | reviewApply/service + UI |
| Acceptance | topology 聚焦 + browser/evidence |
| 工具链 | `dts:toolchain:check`、`dtc:seed:compile` |

## Documentation Impact Matrix

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | Update | 本计划；`docs/zh-CN/PLANS.md` / `docs/PLANS.md` |
| 领域模型 | Update | `docs/design-docs/domain-model.md` + 中文 |
| API 合同 | Update | `docs/design-docs/api-contract.md` + 中文 |
| 测试策略 | Update | `docs/design-docs/testing-strategy.md` + 中文 |
| 验证矩阵 | Update | `docs/developer/verification-matrix.md` + 中文 |
| Cutover runbook | Update | `docs/runbooks/parameter-identity-cutover.md` + 中文 |
| 技术债 | Review | TD-042 保持 BLOCKER |
| 前端 | 视 UI Update | `docs/FRONTEND.md` + 中文 |

## Documentation Update Gate

完成前：所有 Update/Review 行已更新或记录不变；`npm run docs:check` 通过；不得关闭 TD-042。

## Git 与 PR

- 从本地 `main` 建分支，`--no-ff` 合并 Round4。
- 实现智能体只提交到功能分支；**不得** push / 开 PR / 合并 `main`。
- 父智能体负责 Review、PR、合并与同步 `main`。

## 明确不宣称

- 不执行生产 cutover；不用客户库。
- 非 production ready；非 cutover ready；未经父 Review 不得宣称可合并。
