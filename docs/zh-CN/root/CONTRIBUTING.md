# 贡献指南

> English: [English](../../../CONTRIBUTING.md)

WiseEff 的变更应保持产品可用、可测试、可审计。先读智能体入口，再按任务需要查阅索引和相关章节，不把文档目录作为强制通读清单。

## 使用方式

- 普通开发遵循[开发工作流](../agents/development-workflow.md)，运行环境和验证命令查阅对应开发者文档。
- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；若文档与源码或测试冲突，在同一变更中修正。

## 运行与安全边界

首次运行 M1 seed 前执行 `npm run dtc:bootstrap` 与 `npm run dtc:check -- --required`。`db:seed:m1` 会先真实编译三份项目 DTS，再写入参数库、项目值与结构化数据。

真实小泽本地配置使用原子的 `XIAOZE_LLM_API_BASE_URL` / `XIAOZE_LLM_MODEL` / `XIAOZE_LLM_API_KEY` 三键组；旧别名仅在三键全部缺席时作为迁移输入，设置向导与模板只写规范键。规范组任一键存在时，空值也是显式配置，不能回退旧别名。

生产发布失败关闭依赖完整工具链：`npm run dts:toolchain:check`。参数语义身份切换仅在维护窗口执行，见 `docs/runbooks/parameter-identity-cutover.md`；`--apply` 失败后禁止部分继续。

保留演示和测试所用模拟运行时。生产业务必须使用 API、服务端授权和校验、事务写入与审计。本地跳过或模拟通过不能支持目标环境、试点或发布就绪声明。

## 计划与文档

跨会话、多团队、架构变更、高风险发布或明确契约要求的工作使用 `docs/exec-plans/active/` 持久计划；其他有界工作可使用任务或 PR 摘要。既有计划门禁不变，除 `development-roadmap.md` 外的活动实施计划继续包含文档影响矩阵与文档更新门，并在完成前运行 `npm run docs:check`。

仓库技能按任务需要使用，外部技能包不是前置条件，见[技能与客户端配置](../agents/skill-maintenance.md)。

## 验证

编辑期间运行定向测试，交接前按受影响范围扩大验证；TypeScript、路由、Vite、共享类型变更保留 `npm run build`。文档变更仍运行 `npm run docs:check` 与 `git diff --check`。

WiseEff 以 PC 为主，可见修改默认验证受影响页面和状态的 `1440x900` 视口，不要求三设备走查。具体布局风险才补充较窄 PC 窗口；平板和手机按需启用。真实浏览器证据及专门验收边界见[界面质量检查清单](../developer/ui-quality-checklist.md)。

## 同类中文文档

- [智能体指南](AGENTS.md)
- [仓库说明](README.md)
- [架构地图](ARCHITECTURE.md)
- [文档索引](../README.md)
- [前端开发](../frontend.md)
- [执行计划](../PLANS.md)
- [质量标准](../QUALITY_SCORE.md)
