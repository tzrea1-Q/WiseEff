# 用户操作覆盖矩阵

> English: [English](../../developer/user-operation-coverage-matrix.md)

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

- `DEBUG-SIM-001`：模拟器调试读写验收会记录复杂 JSON 的 `valueKind`、digest 与 preview 元数据。
- `DEBUG-ADMIN-001`：调试管理后台验收覆盖复杂值类型与格式元数据的创建和编辑。

## 当前操作重点

- `PARAM-ASSIGNEE-001/002`：Software User 在 `/parameters` 的 binding-centric 提交面板中看到三类项目作用域候选人；默认值非空，候选集合精确排除 inactive、guest、仅 Admin 与角色不匹配用户。自动化归属 `e2e/acceptance/parameter-topology.acceptance.spec.ts`。
- `PFB-SUBMIT-001`：Admin 在 `/parameters` 通过侧边栏提交产品反馈，断言覆盖 UI、API、DB、audit 和截图证据（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-ADMIN-001`：Admin 在 `/feedback-admin` 查看反馈列表与详情，推进状态并保存备注，断言覆盖 UI、API、DB、audit 和截图证据。
- `PFB-AUTHZ-001`：Hardware User 访问产品反馈管理 API 和 `/feedback-admin` 时被拒绝，断言覆盖 UI、API、DB 和截图证据。
- `PARAM-HOME-001`：Admin 在 `/parameter-home` 加载 dashboard summary/hotspots API，并切换页面内时间窗口与热榜维度（`e2e/acceptance/parameter-home.acceptance.spec.ts`）。
- `DEBUG-ADMIN-001`：Admin 在 `/debugging-admin` 通过 API mode 完成调试参数新增、编辑、归档、恢复和 HDC/ADB binding 维护，断言覆盖 UI、API、DB 和 audit。
- `XIAOZE-PERCEPTION-001`：Admin 在 `/parameters` 向小泽提问，验收基于页面上下文与感知工具的只读 grounded 回答（`e2e/acceptance/xiaoze-perception.acceptance.spec.ts`）。
- `XIAOZE-PERCEPTION-AUTHZ-001`：Guest 用户询问无权限项目时，小泽返回安全非数据回答，不泄露越权内容。
- `XIAOZE-PLAN-MULTISTEP-001`：Admin 在 `/parameters` 完成多步计划并经批准 resume，验收 checkpoint 恢复与执行结果报告（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `XIAOZE-PROACTIVE-001`：opt-in 主动建议在启用时出现、为只读且受 authz 限制；关闭时不出现（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-001`：Admin 在 `/parameter-admin` 创建嵌套参数模块、将参数挂到子模块，并按父模块筛选时包含子树（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-002`：Admin 移动参数模块到新父节点，循环移动返回 409（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-DEBUG-001`：Admin 在 `/debugging-admin` 创建嵌套调试节点模块，父模块筛选包含子模块节点（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-AUTHZ-001`：Hardware User 不能变更模块树；Admin 删除仍含子模块或参数的模块时返回 409（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `PARAM-FILE-UPLOAD-001`：Admin 在 `/parameter-admin/projects` 上传 JSON 参数文件并列出文件与版本（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-SYNC-001`：Admin 手动同步参数文件，当解析值与 DB 当前值不一致时创建 `file_sync` 草稿（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-RESOLVE-001`：Admin 通过 API 裁决 file/UI 草稿冲突（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-SPEC-GOVERN-001`：Admin 检索 ingest 后的规格并决议审核任务（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-BROWSE-001`：融合工作台中的真实源/生效嵌套树、语义行、详情 shape/provenance 与 topology API 200（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-EDIT-001`：drafts Schema 诊断、409 与编译失败关闭（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-001`：`open-mapping` 阻断 validate 与决议审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-CONFIG-PUBLISH-GATE-001`：真实工具链 validate 与 DB reload 持久化（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
