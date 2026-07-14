# 技术债追踪

> English: [English](../../exec-plans/tech-debt-tracker.md)

这是计划治理文档，说明路线图、技术债和计划完成门禁。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：planning。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 进行中

- **TD-038（模块树后续）：** 多层级模块已落地后，仍需删除过渡 `module` 文本列、收敛 `project_modules` 与组织级 `parameter_modules` 单一真相源，并评估 dashboard 热榜的层级聚合。
- **TD-039（项目参数文件 P1+P2）：** P1（结构化 DTS 核心，`feat/dts-structural-model`）与 P2（配置集/发布基线/`dtc` 校验门禁，`feat/dts-config-set-baseline`，待评审合并）均已落地。仍待办：source-path 绑定证明后移除 `(name, module)` 兼容 fallback；结构化管理 UI 是 P3——当前没有可见 UI。详见英文版 Open 表；P2 专属后续见 TD-040；与 TD-035 对齐。
- **TD-040（DTS 配置集/门禁后续，P2）：** 四项已知后续：(1) 默认配置集回填只对迁移 `0043` 执行时已存在的项目生效，之后新建项目必须显式调用 `ensureDefaultConfigSet`/`createConfigSet`；(2) 门禁目前只跑 `dtc` 编译检查，尚未实现 `dt-schema`（`.yaml` binding）校验；(3) `dtc` 目前以受限子进程方式运行（临时目录、最小环境、超时；见 `docs/SECURITY.md`），而非容器化沙箱；(4) `dts_config_set.project_id` 外键没有 `on delete cascade`，回填后几乎每个项目都会有配置集，导致 `deleteProject` 删除仍有配置集/基线的项目时可能抛出外键错误。详见英文版 Open 表。

## 近期关闭项

- **TD-037（多层级模块）：** 已于 2026-07-09 在 `feat/hierarchical-modules` 分支关闭。参数域与调试域独立模块树、`module_id` 外键、子树筛选、`ModuleTreeSelect` UI 与 MOD-TREE 验收已交付。计划归档：`docs/exec-plans/completed/2026-07-09-wiseeff-hierarchical-modules.md`。

- **TD-029（小泽 checkpoint 持久化）：** 已于 2026-06-29 关闭。生产/自托管使用 `XIAOZE_CHECKPOINTER=postgres`；证据见 `docs/generated/xiaoze-checkpointer-evidence.md`。详情见英文版 Completed 表。
- **TD-030（小泽聊天历史）：** 已于 2026-06-30 关闭。API 模式通过 `/api/v1/agent/xiaoze/threads` 与 `XiaozeThreadContext` 持久化线程；mock 模式仍用浏览器 localStorage。
- **TD-032（参数调试平台重构）：** 已于 2026-07-01 关闭。完成节点/重载绑定拆分、reload 运行时、Admin 分 Tab 与 `/debugging` 恢复。详情见英文版 Completed 表。
- **TD-036（产品问题反馈）：** 已于 2026-07-08 在 `feat/product-feedback` 分支关闭。侧边栏「问题反馈」已接入 `/api/v1/product-feedback` 持久化、多图片对象存储附件和 `/feedback-admin` Admin 处理页；文档、合同和 schema 覆盖见英文版 Completed 表及本分支提交。

## 同类中文文档

- [docs/zh-CN/exec-plans/development-roadmap.md](development-roadmap.md)
- [docs/zh-CN/exec-plans/tech-debt-tracker.md](tech-debt-tracker.md)
