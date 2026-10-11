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

需要已发布 Catalog 的新建本地或演示数据库，应使用 `npm run db:seed:all`，而不是分别执行四个 seed 命令。它在 M0 与 M1 之间安装 Catalog；单独执行 M1 只会同步已发布的 Catalog。默认种子发布为 `crel_vendor_catalog_3`（版本 `1.2.1`），提供中文显示名与说明，并保留原有 Acme 和 vendor 1/2 发布。临时语义 Binding 辅助函数在该精确种子上安装 `crel_acceptance_bindings_1`（版本 `1.3.0`），从已编译种子派生前驱 pin 和下一发布序号；重放仍须经过安装器校验。`schemas/dts/catalog-release/vendor-catalog-1.yaml` 固定原始编译源，避免重写历史 digest 和修订。

种子展示内容写在 `schemas/dts/vendor/wiseeff/*.yaml` 的属性 `displayName` 与 `documentation` 字段中。`displayName` 可选，缺省时仍使用原属性键；非法名称由 Catalog 内容或发布 schema 拒绝。使用 `npx tsx scripts/enrich-vendor-property-docs.ts` 刷新 `catalog.json`，再执行 `npm run catalog:compile-vendor -- --localized --out /tmp/vendor-catalog-zh.json` 编译。中文后继发布只改变展示内容，不改变属性键、主体、值 schema、单位、匹配规则、Binding 或 Project value。保留的退役 Acme 样例，其中文展示内容在编译器的种子内容中定义，历史夹具不变。已接管或运行中的 Catalog 仍须通过正常的 typed ChangeSet 与受审发布路径改名，不得重新 seed 或直接修改数据库行。

真实小泽本地配置使用原子的 `XIAOZE_LLM_API_BASE_URL` / `XIAOZE_LLM_MODEL` / `XIAOZE_LLM_API_KEY` 三键组；旧别名仅在三键全部缺席时作为迁移输入，设置向导与模板只写规范键。规范组任一键存在时，空值也是显式配置，不能回退旧别名。

生产发布失败关闭依赖完整工具链：`npm run dts:toolchain:check`。参数语义身份切换仅在维护窗口执行，见 `docs/runbooks/parameter-identity-cutover.md`；`--apply` 失败后禁止部分继续。

保留演示和测试所用模拟运行时。生产业务必须使用 API、服务端授权和校验、事务写入与审计。本地跳过或模拟通过不能支持目标环境、试点或发布就绪声明。

## 计划与文档

跨会话、多团队、架构变更、高风险发布或明确契约要求的工作使用 `docs/exec-plans/active/` 持久计划；其他有界工作可使用任务或 PR 摘要。既有计划门禁不变，除 `development-roadmap.md` 外的活动实施计划继续包含文档影响矩阵与文档更新门，并在完成前运行 `npm run docs:check`。

仓库技能按任务需要使用，外部技能包不是前置条件，见[技能与客户端配置](../agents/skill-maintenance.md)。

## 验证

编辑期间运行定向测试，交接前按受影响范围扩大验证；TypeScript、路由、Vite、共享类型变更保留 `npm run build`。文档变更仍运行 `npm run docs:check` 与 `git diff --check`。

### 测试数据库隔离

设置 `WISEEFF_TEST_DATABASE_PREFIX` 后，一次性切换后浏览器测试使用 `<prefix>_disposable_…`；未设置时保留 `wiseeff_acceptance_disposable_…`。手动运行可用 `WISEEFF_ACCEPTANCE_NESTED_API_PORT` 和 `WISEEFF_ACCEPTANCE_NESTED_FRONTEND_PORT` 固定嵌套 API/前端监听端口（1–65535 范围内的不同整数），canonical DTS reload 测试也遵循这两个覆盖变量。复用手动运行的端口时，设置 `WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true`，使用 `--no-deps` 仅运行嵌套测试，不要同时在这些端口启动父运行时。受控设备的回环 socket 仍由测试独占并使用临时端口。CI 不设置端口覆盖，继续使用自动分配的隔离端口。

PostgreSQL 测试工具（`server/testing/testDatabase.ts`）依次使用非空的 `TEST_DATABASE_URL`、`DATABASE_URL`，最后回退到本地 Compose 默认连接。同一集群上的并行工作树应在启动各自测试进程前设置不同的 `WISEEFF_TEST_DATABASE_PREFIX`。前缀会去除首尾空白；未设置或为空时默认 `wiseeff`。有效格式为 `^[a-z][a-z0-9_]{0,15}$`：1–16 个字符，以小写 ASCII 字母开头，后续仅允许小写 ASCII 字母、数字或下划线。无效前缀会在数据库准备前报错。

该前缀用于迁移模板（`<prefix>_test_tpl_…`）、临时模板构建（`<prefix>_test_tplbuild_…`）与 worker/临时数据库（`<prefix>_test_wk_…`）。提供该变量时，托管实例测试使用 `<prefix>_m…`；未设置时保留 `wiseeffm…`。旧模板和孤立 worker 清理仅匹配所选模板/worker 前缀，下划线按字面匹配；worker 收尾清理还匹配当前运行标识。使用工作树独占的前缀（例如 `review_fixes`），避免一次清理选中其他工作树的测试数据库。该设置不改变连接 URL、不授予权限，也不取消共享集群角色目录锁。

WiseEff 以 PC 为主，可见修改默认验证受影响页面和状态的 `1440x900` 视口，不要求三设备走查。具体布局风险才补充较窄 PC 窗口；平板和手机按需启用。真实浏览器证据及专门验收边界见[界面质量检查清单](../developer/ui-quality-checklist.md)。

## 同类中文文档

- [智能体指南](AGENTS.md)
- [仓库说明](README.md)
- [架构地图](ARCHITECTURE.md)
- [文档索引](../README.md)
- [前端开发](../frontend.md)
- [执行计划](../PLANS.md)
- [质量标准](../QUALITY_SCORE.md)
