# 设计文档索引

> English: [English](../../design-docs/index.md)

这是架构与设计文档，说明系统边界、领域模型、API 合同、测试、部署和安全治理。

## 当前技术与测试入口

[技术文档合集](full-stack-architecture.md)和[测试策略与设计](testing-strategy.md)于 2026-09-06 对照源码 `67d4a77325b6009b77c2373bd788298a6d022bcf` 核对，并融入既有文档体系：

- 技术合集：13 章正文与 22 张 Mermaid 图，覆盖运行时、模块与接口、对象关系、调用时序、并发、异常恢复和运维。
- 测试入口：风险、环境与数据、20 个可执行设计场景、自动化追踪和结果规则。
- 专题页面保留自身内容归属，历史设计继续保留。锁定契约说明应满足的不变量，不能仅凭标签判定其全部已实现或全部未实现；部署、切换和目标证据须另行验证。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：architecture。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/design-docs/index.md](index.md)
- [参数目录验证、升级与退出门禁——锁定决策](parameter-catalog-verification-upgrade-retirement-gates.md)
- [Catalog 编写与发布控制面——CP-00 锁定合同](catalog-authoring-and-publication-control-plane.md)
- [docs/zh-CN/design-docs/core-beliefs.md](core-beliefs.md)
- [docs/zh-CN/design-docs/full-stack-architecture.md](full-stack-architecture.md)
- [docs/zh-CN/design-docs/domain-model.md](domain-model.md)
- [Catalog Kernel 接口与事务边界——锁定目标合同](catalog-kernel-interface-and-transaction-boundary.md)
- [docs/zh-CN/design-docs/api-contract.md](api-contract.md)
- [参数目录 API 与 legacy 标识符迁移——锁定决策](parameter-catalog-api-transition.md)
- [docs/zh-CN/design-docs/testing-strategy.md](testing-strategy.md)
- [docs/zh-CN/design-docs/deployment-operations.md](deployment-operations.md)
- [自托管一键升级——本地实现，目标演练待完成](2026-08-20-self-hosted-one-command-upgrade-design.md)
- [参数目录切换、归档与回滚——锁定决策](parameter-catalog-cutover-archive-rollback.md)
- [docs/zh-CN/design-docs/security-governance.md](security-governance.md)
- [docs/zh-CN/design-docs/2026-06-17-audit-center-design.md](2026-06-17-audit-center-design.md)
- [DTS 可管参数面边界 RFC](2026-07-21-dts-parameter-surface-boundary-rfc.md)
- [DTS 能力裁剪矩阵](2026-07-21-dts-capability-cut-matrix.md)
- [项目主 DTS 契约 RFC](2026-07-21-project-primary-dts-contract-rfc.md)
- [项目配置工作台——锁定设计](2026-08-06-project-configuration-workbench-design.md)
- [知识库——锁定设计](2026-08-12-knowledge-base-design.md)
- [组织管理——锁定设计](2026-08-19-organization-administration-design.md)
- [参数治理延期问题——2026-08-18 锁定（英文）](../../design-docs/2026-07-30-parameter-governance-deferred-questions.md)
- [表格列多选筛选 UX](ux-table-column-filter.md)
- [UI 设计系统](ui-design-system.md)
