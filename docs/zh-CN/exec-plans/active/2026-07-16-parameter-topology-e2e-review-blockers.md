# 参数拓扑端到端 Review 阻断修复计划

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-e2e-review-blockers.md)
> 设计: [面向拓扑与 Schema 的参数精细化管理](../../superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)
> 原实现计划: [2026-07-16-parameter-topology-schema-management.md](./2026-07-16-parameter-topology-schema-management.md)

**目标：** 把已审拓扑/Schema 实现从局部单元与教学数据路径，修成真正贯通的生产链路：Config Set ingest → Schema 匹配 → 稳定身份/binding → 类型化编辑 → fail-closed 工具链 → 审核/发布 → reload 持久化；迁移/cutover 与浏览器验收必须针对同一真实业务操作。

**架构：** 保留 `0048` 语义影子模型与已审模块布局。修复生产调用点，使 ingest、validate、edit、前端、审核队列与迁移共享同一身份契约。不压平已审历史；在从 `main` 创建并 merge 已审实现的新分支上按阶段提交修复。

**技术栈：** TypeScript 5.9、Node.js/tsx、PostgreSQL 16、Zod、React 19/Vite、Vitest、Playwright、dtc/fdtoverlay 1.8.1、dtschema 2026.6。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| **实现智能体** | 从本地 `main` 建分支，无 squash merge 已审实现，实现/测试/提交 |
| **实现智能体** | 不得 push、开 PR、合并 PR 或快进本地 `main` |
| **父智能体** | Review、开 PR、合并后同步 `main` |

**必用分支：** `fix/parameter-topology-e2e-review-blockers`  
**已审基线：** `a55b8d82`（保留其全部实现提交，不得重写/压平）

## 全局约束

- API 模式禁止教学数据 fallback；release/validate fail-closed。
- 不得放宽断言、mock compiler，或以 `failOnSchema:false` 作为通过策略。
- dry-run 必须只读；无干净快照证据不得宣称生产 cutover 就绪。
- 使用 `apply_patch`；禁止破坏性 git；每提交只处理一个明确问题。

## 阶段提交顺序

1. ingest + matcher + 稳定 binding  
2. mapping resolution 事务化  
3. fail-closed validation + 工具链钉扎（已完成）  
4. typed edit / writeback API（已完成）  
5. 前端真实数据接通（已完成）  
6. 规格审核队列（已完成）  
7. 迁移 / cutover（已完成；干净快照演练见 TD-042 BLOCKER）  
8. 验收 / 文档 / 终态门禁  

任务细节、文件清单与验证命令见英文计划正文。

## 文档影响矩阵与更新门禁

与英文计划中的 Documentation Impact Matrix / Documentation Update Gate 一致；中英文成对更新。结束前运行 `npm run docs:check`。
