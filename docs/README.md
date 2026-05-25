# WiseEff 产品化文档索引

日期：2026-05-25

本文档目录用于承接 WiseEff 从前端原型进入正式开发阶段的规格、架构、工程和上线设计。当前仓库已经包含 React/Vite/TypeScript 原型、领域类型、应用端口、mock infrastructure、HTTP DTO skeleton 和较完整的前端测试。后续开发应优先复用这些边界，把 mock 状态逐步替换为真实后端、数据库、Agent 网关和设备网关。

## 推荐阅读顺序

1. [产品 Spec](product/spec.md)：定义产品目标、用户角色、业务范围、核心工作流、非功能要求和验收标准。
2. [MVP 范围与版本切分](product/mvp-scope.md)：把正式开发拆成可上线、可测试、可回滚的里程碑。
3. [全栈架构设计](architecture/full-stack-architecture.md)：定义前端、后端、数据、任务、Agent、设备、观测和部署整体结构。
4. [领域模型设计](architecture/domain-model.md)：定义正式数据模型、状态机、关键一致性规则和审计边界。
5. [API 合同设计](architecture/api-contract.md)：定义 REST API、错误模型、权限模型、长任务进度和 Agent/设备网关合同。
6. [开发路线图](engineering/development-roadmap.md)：定义团队如何从当前原型迁移到正式系统。
7. [测试策略](engineering/testing-strategy.md)：定义单元、集成、契约、E2E、安全、性能、AI 和设备模拟测试。
8. [部署与运维设计](engineering/deployment-operations.md)：定义环境、CI/CD、发布、数据库迁移、监控和备份策略。
9. [安全与治理设计](engineering/security-governance.md)：定义身份认证、RBAC、审计、Agent 工具调用、数据隔离和设备安全。

## 文档状态

这些文档是 `v0.1` 产品化基线。它们基于当前原型代码和 `PRD.md` 编写，目标是让后续开发可以按模块推进，而不是一次性重写整个系统。

优先级原则：

- 保留当前前端的领域边界和交互资产。
- 先把参数管理做成可真实使用的闭环，再推进日志分析、设备调试和真实 Agent。
- 所有会改变生产状态的动作必须有权限校验、人工确认、审计记录和可追溯结果。
- 原型模式和生产模式必须隔离，mock 数据只能服务演示和测试。

