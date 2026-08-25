# 本地 UI 反馈修复汇总

> English: [English](../../../exec-plans/completed/2026-08-26-ui-fixes-batch.md)

**状态：** 已于 2026-08-26 完成。实现、本地验证、审查和浏览器证据已完成；GitHub 合入仍由父代理负责交付。
**分支：** `codex/ui-fixes-batch-20260825`，基于最新 `main`
**范围：** 将当前已提出的本地界面修复汇总到一个可审查 PR 中。此前已合入 `main` 的 #631、#633 不重复实现。

## 目标

收敛认证、节点调试、调试管理弹窗、产品反馈和 DTS 重载页面的浏览器测试反馈。在不改变 API 契约和操作语义的前提下，使修改后的控件在桌面、平板和移动端均可使用。

## 范围与验收

- 登录页隐藏仅注册页需要的组织提示和用户名格式提示；注册页保留两项提示及无障碍描述。
- `/node-debugging` 增加可复用的模块列和树形筛选器；响应式卡片布局仍可筛选，父模块包含子模块，模块名称单行省略。
- 模块管理“更多”菜单和模块树菜单脱离表格/弹窗裁剪，支持点击外部、Escape 或滚动关闭并保持在视口内。
- 协议绑定弹窗只保留右上角关闭入口和不重复的底部操作；API 只读用户仍可关闭弹窗。
- 反馈弹窗关闭按钮归位到标题区；DTS 重载操作列间距调整；只有勾选 DTS 行复选框才加入本轮调试。
- 既有元数据、权限、设备操作和审计语义保持不变。

## 浏览器验收与操作覆盖

复核了以下既有覆盖责任：认证使用 `AUTH-RUNTIME-001`、`AUTH-LOCAL-SELF-REGISTER-001`、`AUTH-LOCAL-BOOTSTRAP-HINT-001`；节点调试使用 `DEBUG-SIM-001`、`DEBUG-PERM-001`；调试管理使用 `DEBUG-ADMIN-001`、`MOD-TREE-DEBUG-001`；DTS 使用 `DTS-RELOAD-*` 操作族。受影响路由为 `/parameter-home`、`/node-debugging`、`/debugging-admin/nodes`、`/feedback-admin` 和 `/dts-reload`。

既有自动化覆盖责任仍然适用；本轮只改变展示和入口操作，不增加 API 操作或状态迁移。`playwright-cli` 手工回归作为补充，不替代仓库验收套件。

## Git 与 PR 流程

父代理负责审查、提交、创建 GitHub PR、等待 CI、合入以及同步干净的本地 `main`。主工作区中的用户修改必须保持不动；只有本隔离集成工作区允许编辑和提交。

## 验证计划

```bash
npm test -- --run <受影响的聚焦测试>
npm test -- --run
npm run ui:check
npm run lint
npm run build
npm run docs:check
git diff --check
```

浏览器验证在 mock 模式下覆盖 `1440x900`、`768x1024`、`390x844`；认证页面另行使用 API 模式确认预期的未认证探测。每个受影响路由都执行 snapshot、截图、交互、控制台错误检查，以及适用时的网络检查。mock/本地证据不代表部署机真实 HDC/ADB 就绪。

## 文档影响矩阵

本计划的英文版本包含完整的文档影响矩阵和更新门禁；中英文计划保持一一链接，英文版本是门禁字段的规范记录。

## 文档更新门禁

`npm run docs:check` 已通过。仓库地图、产品、架构、API、质量、可靠性、安全、前端/设计、生成物和参考资料均已复核且无需更新；规划文档行由本完成计划满足。未产生延期文档工作。检查报告本机因缺少 pgvector 扩展而跳过 pgvector canonical artifact 校验；该独立数据库工件仍以 CI 为准。

## 完成证据

- 受影响聚焦测试：6 个文件共 85 项通过。
- 全量前端测试：`npm test -- --run` 通过，415 个文件 / 3072 项测试。
- `npm run ui:check` 通过：raw-color 1013、raw-spacing 1244、raw-z-index 46，其余均不超过基线。
- `npm run lint` 通过：0 个错误，300 个既有警告。
- `npm run build` 通过，仅保留既有 `@segment/analytics-node` 浏览器外置和大 chunk 警告。
- `git diff --check` 通过。
- `/`、`/node-debugging`、`/debugging-admin/nodes`、`/feedback-admin`、`/dts-reload` 均在 `1440x900`、`768x1024`、`390x844` 回归；mock 控制台错误/警告为 0，API 认证页展示预期未认证界面且无浏览器控制台错误。
- 最终截图位于 `work/ui-checks/ui-fixes-batch/`，包含节点调试、模块管理、反馈弹窗、DTS 和认证页面证据。
