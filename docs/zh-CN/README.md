# WiseEff 中文开发者文档

本目录为中文开发者阅读路径。它面向需要参与 WiseEff 开发、联调、验收、运维准备和后续规划的人，不替代现有英文详细文档，而是提供可以独立阅读的中文入口和日常开发参考。

当前英文文档仍是许多历史细节、完整 API 约定和执行计划的详细来源。中文文档优先覆盖开发者最常读、最容易影响交付判断的内容：架构边界、前后端运行方式、数据库和运行时依赖、安全可靠性、测试门禁、计划治理。

## 推荐阅读顺序

1. [架构总览](architecture.md)：系统边界、模块划分、数据和治理原则。
2. [前端开发](frontend.md)：React/Vite 结构、mock/API runtime、端口和测试。
3. [后端与运行环境](backend-runtime.md)：API、PostgreSQL、worker、对象存储、设备网关、Agent provider。
4. [安全与可靠性](security-reliability.md)：auth、RBAC、审计、设备写入、Agent 工具、backup/restore、pilot gate。
5. [质量门禁与计划治理](quality-and-plans.md)：测试命令、验收口径、计划文件和文档更新规则。
6. [本地开发与验证](developer-setup.md)：`.env.example`、数据库 seed、服务启动、验证命令。
7. [运维与安全阅读路径](operations-security.md)：runbook、安全审计、HDC、backup/restore、rollback、Agent provider。

## 与英文文档的关系

- 产品规格仍从 [docs/product-specs/index.md](../product-specs/index.md) 开始阅读。
- 完整架构细节仍在 [docs/design-docs/index.md](../design-docs/index.md)。
- 当前质量分数和风险看 [docs/QUALITY_SCORE.md](../QUALITY_SCORE.md)。
- 当前 release/pilot 证据看 [docs/generated/m5-pilot-acceptance.md](../generated/m5-pilot-acceptance.md)。
- 当前 active/completed 计划看 [docs/PLANS.md](../PLANS.md) 和 [docs/exec-plans/](../exec-plans/)。
- 开发者本地启动和验证看 [docs/developer/README.md](../developer/README.md)。
- 运维 runbook 看 [docs/runbooks/README.md](../runbooks/README.md)。
- API 使用看 [docs/api/README.md](../api/README.md)。
- 安全审计看 [docs/security/README.md](../security/README.md)。

## 维护规则

当后续变更影响开发者需要理解的架构、运行模式、安全、可靠性、质量门禁或计划治理时，需要同步更新本目录中对应中文页面，或者在计划/PR 中明确记录“中文文档无需更新”的原因。
