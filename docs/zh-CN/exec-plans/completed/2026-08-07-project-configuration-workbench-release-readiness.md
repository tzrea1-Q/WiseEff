# 项目配置工作台 — 服务端发布就绪与源码 remediation（#237）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-release-readiness`
> Issue：[#237](https://github.com/tzrea1-Q/WiseEff/issues/237)，父 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#234](https://github.com/tzrea1-Q/WiseEff/issues/234)、[#235](https://github.com/tzrea1-Q/WiseEff/issues/235)、[#236](https://github.com/tzrea1-Q/WiseEff/issues/236)（已关闭）
> 英文：[English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-release-readiness.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §10.5 / §11.3 / PCW-D7
> 起点：`2e74829f87448894e4ee1dd183e3eee85f399834`（含 #250/#251 的 `origin/main`）

## 目标

为选中的配置集引入**唯一服务端权威的发布就绪结果**，并将每条证据连接到可纠正的源码上下文。命令栏汇总整体就绪度；Issues 任务坞按序列出阻断项与警告（含目标定位与 remediation）；基线创建与发布在门禁被阻断、不可用或过期时**失败关闭**。

## 范围与成功标准

1. 就绪契约返回整体 level、有序 blockers/warnings、稳定的文件/节点/属性/源码目标、remediation，以及 gate revision/token。
2. 服务端评估覆盖：缺失主/成员版本、服务端可见待处理变更、开放冲突、硬校验错误、发布阻断治理任务、策略允许的警告。
3. 前端渲染权威结果，**不**用无关客户端计数重建发布权限。
4. 本机会话变更保持可见区分，并阻止在未保存工作仍在上下文中时启动快照/发布。
5. 选中阻断项或警告会打开对应任务证据并定位相关源码或检查器上下文。
6. 阻断或不可用时禁用基线创建与发布，并提供作用域重试；永不假定就绪。
7. 策略允许的警告可审阅，并携带后续发布动作所需的确认状态。
8. 基线/发布写入拒绝过期门禁证据，即使 UI 曾显示 ready。
9. 真实库/API 集成覆盖各级门禁、过期 token、授权与目标定位；浏览器验收 `PROJ-CONFIG-READINESS-001` 覆盖摘要、remediation、失败关闭与部分加载。

## 非目标

- #238 / Phase 5：基线历史/对比/导出/恢复完整命令流。
- #240：切换与遗留对话框拆除。
- 客户端用会话草稿/冲突/校验计数拼凑就绪度。

## 架构与测试缝

与英文计划同构：`evaluateReleaseReadiness` → 基线写门禁 → HTTP/端口 → 工作台 UI → `PROJ-CONFIG-READINESS-001`。

## 任务

### 0. 注册计划

- [x] 创建双语活跃计划并写入 EN/ZH `PLANS.md`。
- [x] 认领 #237。
- [x] 锁定 TDD 缝（见英文计划）。

### A–E

与英文计划同构：服务端评估 → 失败关闭的创建/发布 → ports/mock/HTTP → 工作台命令栏与 Issues 坞 → 验收与文档完成门禁。

## 浏览器验收映射

| 需求 | 操作 | 行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-READINESS-001` | `PROJ-CONFIG-READINESS-001` | Admin 看到服务端就绪摘要；Issues 坞列出有序阻断/警告与 remediation；选中打开源码证据；阻断/不可用/过期或本机会话脏时创建/发布失败关闭；前端不用客户端计数发明权限；部分加载保留重试 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-release-readiness/` |

## Documentation Impact Matrix / Update Gate

细节与英文计划一致；中英文成对维护。结束前运行 `npm run docs:check`。

## 结果 / 残余风险

2026-08-07 在 `feat/project-configuration-workbench-release-readiness` 完成。

**已交付**：服务端权威发布就绪契约、基线创建/发布失败关闭、工作台命令栏摘要与 Issues 坞、`PROJ-CONFIG-READINESS-001`、OpenAPI 登记。

**残余**：#238 基线历史命令流、#240 遗留对话框切换不在本票范围。

