# 浏览器验收覆盖图

> English: [English](../../developer/browser-acceptance-coverage-map.md)

这是日常开发文档，帮助开发者完成本地启动、环境配置、验证选择和验收覆盖判断。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：developer。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 当前覆盖重点

- `AUTH-RUNTIME-001`：API mode 浏览器运行时与本地 dev auth 契约一致。
- `NOTIF-INBOX-001`：TopBar 通知铃铛可打开收件箱面板，且 `/api/v1/notifications` 与未读数 API 对当前用户可用（`e2e/acceptance/notifications.acceptance.spec.ts`）。
- `NOTIF-READ-001`：通知可通过后端 mark-all-read API 标记已读（`e2e/acceptance/notifications.acceptance.spec.ts`）。
- `PFB-SUBMIT-001`：活跃用户从侧边栏提交产品反馈，包含描述和可选截图；API 持久化，UI 展示成功提示（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-ADMIN-001`：Admin 在 `/feedback-admin` 列表打开详情，将反馈从 `open` 推进到 `in_progress` 再到 `closed`，并写入处理备注（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-AUTHZ-001`：非 Admin 无法访问产品反馈管理 API 或 `/feedback-admin` 页面（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `DEBUG-SIM-001`：模拟器读、写、回读不一致、回滚与审计路径，包含复杂 JSON 值元数据。
- `DEBUG-ADMIN-001`：API mode 下调试管理后台可新增、编辑、归档、恢复，并维护 HDC/ADB binding 与复杂值元数据。
- `BRIDGE-WIN-001`：`/node-debugging` 的 Windows 优先本地 Bridge 面板可覆盖缺失安装、未配对、未启动、在线无设备与在线目标状态，并展示同源 Windows 下载入口。
- `BRIDGE-TOOLS-001`：Bridge 已连接但 `tools.adb.available: false` 时，Step ③ 显示缺少 ADB 与 **安装调试工具** CTA（非「Bridge 未安装」）。覆盖：`src/NodeDebuggingPage.test.tsx`。
- `PARAM-HOME-001`：`/parameter-home` 通过 `ParameterDashboardRepository` 加载 summary/hotspots API 数据，并支持页面内时间窗口与热榜维度切换（`e2e/acceptance/parameter-home.acceptance.spec.ts`）。
- `XIAOZE-PERCEPTION-001`：小泽 P0 感知验收——基于页面上下文与只读感知工具回答有权限范围内的项目问题。
- `XIAOZE-PERCEPTION-AUTHZ-001`：越权项目问题返回安全、不泄露数据的回答。
- `XIAOZE-PLAN-MULTISTEP-001`：多步计划在批准后 checkpoint resume，并报告观察到的执行结果（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `XIAOZE-PROACTIVE-001`：opt-in 主动建议为只读、受 authz 限制；关闭时不展示（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-001`：Admin 创建嵌套参数模块、将参数挂到子模块，并按父模块筛选时包含子树（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-002`：Admin 移动参数模块到新父节点，循环移动被拒绝（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-DEBUG-001`：Admin 创建嵌套调试节点模块，父模块筛选包含子模块下的节点（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-AUTHZ-001`：非 Admin 不能变更模块树；删除非空模块返回 409（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `PARAM-FILE-ADMIN-001`：Admin 上传项目参数文件、列出版本、手动同步生成 `file_sync` 草稿，并在 `/parameter-admin/projects` 打开参数文件面板（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-CONFLICT-001`：Admin 裁决 file/UI 草稿冲突，可选择保留文件值或 UI 值（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-IMPORT-DTS-FULL-001`：完整 `.dts` 经 `parse-dts` 产出带 `@address` 的 module 路径；`/include/` 被拒绝；向导显示服务端解析提示（`e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts`）。
- `PARAM-IMPORT-REVIEW-META-001`：带 `reviewMetadata.skippedRows` 的导入预览写入 `batch-import` 审计 metadata（`e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts`）。
- `PARAM-SPEC-GOVERN-001`：Admin 在 `/parameter-admin` 检索参数规格、打开详情，并决议规格审核任务（含治理审计）（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-BROWSE-001`：用户在 `/parameters` 切换源树/生效树，搜索两个 `gpio_int` 绑定并打开详情，不以路径作身份（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-EDIT-001`：类型化绑定编辑展示 Schema 诊断，并拒绝过期/缺失 revision（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-001`：未解析覆盖目标与身份映射任务可观测并可决议，含审计证据（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-CONFIG-PUBLISH-GATE-001`：编辑/编译诊断阻断发布；干净 revision 可校验并通过审计；刷新后语义绑定 id 持久（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
