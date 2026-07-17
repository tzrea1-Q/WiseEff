# 参数拓扑第六轮 Review 阻断修复

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md)
> 上一轮：[第五轮](./2026-07-16-parameter-topology-round5-review-blockers.md)

**目标：** 关闭父智能体第五轮 Review 阻断：历史跨租户 review task scope 校正、无损手工规格 ID、全局规格激活权限、完整 valueShape 激活 UX、真实 submit→review→merge 验收、租户作用域 fixture 清理、稳定 `npm run test:all`。

**分支：** `fix/parameter-topology-round6-review-blockers`
**保留基线：** Round5 `a2669639`（`--no-ff` 合并）。**TD-042 仍为 BLOCKER — 非 production cutover ready。**

## 成功标准

1. 新增前向迁移（0058+）仅从可信 join 重算 review-task 作用域；污染 FK 清除；歧义行保持 needs-review 并阻断 finalize；从脏 0055 状态升级路径有真实 PG 证明。
2. `vendor,limit` 与 `vendor-limit`（及其他有损 sanitize 对）生成不同稳定 ID；碰撞审计 fail-closed，不静默重写已引用 ID。
3. 组织 Admin 只能激活本组织 draft；global draft 激活服务端拒绝；仍可读取/绑定 active global spec。
4. 激活面板/API 保留完整推断 valueShape；gpio_int 三单元保留；不完整 shape 阻断激活。
5. 拓扑验收走真实 submit→review→merge→writeback→validate（无 repository 伪造状态）；base 不可变；candidate 新建；`writeback.skipped === false`。
6. Fixture 清理按 organizationId+projectId+name 解析 Config Set；跨组织/项目同名数据不受影响。
7. 默认 `npm run test:all` 稳定，无需临时 maxWorkers；从根因隔离 migration/dashboard。
8. 双语文档更新；`npm run docs:check` 通过；TD-042 保持 BLOCKER。

## 任务映射

| 任务 | Finding | 实现焦点 |
| --- | --- | --- |
| T1 | 0057 通过 coalesce 信任污染 FK | 0058 仅信任 evidence join + PG 升级测试 |
| T2 | sanitize 后再哈希碰撞 | 无损 canonical 哈希输入 + 碰撞审计 |
| T3 | 组织 Admin 激活全局草稿 | activate 仅限本组织；global fail-closed |
| T4 | UI 丢失 valueShape 字段 | mapper→detail→panel 完整 shape；服务端复核 |
| T5 | 验收跳过 merge 路径 | 真实 CR 工作流 + writeback 断言 |
| T6 | cleanup 仅按 name 查 Config Set | 租户作用域解析 + PG 隔离测试 |
| T7 | test:all PG 竞态 | 标准 vitest/npm 脚本固化隔离 |
| T8 | 文档/浏览器/证据 | 双语文档 + playwright-cli + 门禁 |

## 任务依赖

```text
计划
  → T1/T2/T3/T6 可并行
  → T4（前端 + 激活校验）
  → T5（验收 merge；依赖 T3/T4 语义）
  → T7（测试隔离）
  → T8 文档 + 浏览器 + 全量门禁
```

## 验证矩阵

| 领域 | 命令 / 焦点 |
| --- | --- |
| Scope reconcile | 从污染 0055 状态升级的 0058 PG 测试 |
| Spec identity | `vendor,limit` ≠ `vendor-limit`；属性化测试 |
| Global authz | activate 服务层 + HTTP/PG 负向 |
| ValueShape | mapper/panel/service + playwright-cli |
| Acceptance merge | topology acceptance submit→merge→reload |
| Cleanup | 跨组织/项目同名 Config Set PG 测试 |
| 稳定性 | 默认配置连续 `npm run test:all` ×3 |
| 工具链 | `dts:toolchain:check`、`dtc:seed:compile` |

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | 更新 | 本计划；`docs/PLANS.md`；中英文配对 |
| 领域模型 | 更新 | `docs/design-docs/domain-model.md` + 中文 |
| API 合同 | 更新 | `docs/design-docs/api-contract.md` + 中文 |
| 测试策略 | 更新 | `docs/design-docs/testing-strategy.md` + 中文 |
| 验证矩阵 | 更新 | `docs/developer/verification-matrix.md` + 中文 |
| Cutover / 身份 runbook | 更新 | `docs/runbooks/parameter-identity-cutover.md` + 中文 |
| 前端 | 更新 | `docs/FRONTEND.md` + 中文 |
| 安全 / 授权 | 审阅/更新 | `docs/SECURITY.md` + 全局规格治理说明 |
| 技术债 | 审阅 | TD-042 保持 BLOCKER |

## 文档更新门禁

计划完成前：每个 Update/Review 行已更新或有证据标明未变；`npm run docs:check` 通过；不得关闭 TD-042。

## 执行检查点（2026-07-17）

- T1/T2 复审项已关闭：污染任务即使 evidence 不含 scope ID 也会重新打开；finalize 阻断该迁移运行的全部 open task；手工实体 ID 与持久化 `specificationKey` 均采用无损摘要，同组织可同时保存两个碰撞样例。
- T4 复审项已关闭：规格或 valueShape 切换时重置激活表单，前后端均拒绝小数 cell 数。
- T5 自动创建并销毁带 marker 校验的 `wiseeff_acceptance_disposable_*` 数据库，执行全部 migration、真实 identity apply+cutover，并跑通 Software User → Hardware Committer → Software Committer → Software User 的正式 submit/review/merge/writeback/reload 链路。candidate binding 保存合法三单元 phandle AST，base config/binding revision 保持不变。
- 曾被弱化的 `PARAM-ASSIGNEE-001/002` 与参数审阅 operation 已恢复可见 UI 操作。API 模式从组织+项目作用域接口读取 eligible assignee；浏览器验收在每个角色 UI 操作前切换 production HMAC 身份。
- 源代码与聚焦验收已提交至 `6fe14cae`。全量 browser/evidence 重新生成及最终门禁仍待执行，因此计划继续 active。TD-042 仍为 BLOCKER：尚未执行干净非客户快照 apply→cutover→整库恢复演练。

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 改哈希破坏 createSpec 幂等 | 先按 org+property 查找既有规格；碰撞审计只报告；不静默改 ID |
| 0058 清除过多作用域 | 仅保留 join 可证明链路；其余 needs_review + 诊断 |
| test:all 隔离拖慢 CI | 优先唯一命名空间 + migration 文件串行，避免全局单 worker |

## Git 与 PR 工作流

- 从本地 `main` 建实现分支，`--no-ff` 合并 Round5（`a2669639`）。
- 实现智能体：仅在特性分支提交；**不得** push、开 PR 或合并 `main`。
- 父智能体：Review、开 PR、合并并同步 `main`。

## 明确不宣称

- 不执行生产 cutover；不使用客户库/快照。
- 非 production ready；非 cutover ready；未经父智能体 Review 不可合并。
- `deviceGateway` / `backups` 等外部阻断如实报告。
- 若无已设计的 platform 治理入口，对 global 规格激活 fail-closed。
