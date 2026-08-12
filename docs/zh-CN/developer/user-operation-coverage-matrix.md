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
- `DTS-RELOAD-DEPLOY-001` / `KERNEL-001` / `VERIFY-001` / `RESIDUE-001`：假桥自动化验收（见英文操作矩阵）；浏览器证据 `work/ui-checks/285-*`–`288-*`。
- `DTS-RELOAD-DEPLOY-HW-001`：真实 HDC 条件覆盖（非阻塞）。

## 当前操作重点

- `DTS-RELOAD-DEPLOY-001`：经假本地设备桥部署已校验 overlay（mount / pushFile / trigger）至 `unverifiable`；`coverage: automated`。
- `DTS-RELOAD-KERNEL-001`：触发后内核日志为未判定证据；`coverage: automated`。
- `DTS-RELOAD-VERIFY-001`：经 `debug.readNode` 行为核对；`coverage: automated`。验收 spec 只覆盖无绑定路径，升级判定由 `server/modules/dts-reload/deploy.test.ts` 断言。
- `DTS-RELOAD-RESIDUE-001`：残留记账与恢复基线；`coverage: automated`。验收 spec 只覆盖残留已记录可读，补偿运行与清除规则由 `residue.test.ts` / `restoreBaseline.test.ts` 断言。
- `DTS-RELOAD-DEPLOY-HW-001`：真实 HDC 目标条件部署；`coverage: conditional`。
- `PARAM-ADMIN-003`：Admin 在 `/parameter-admin/projects` 确认项目清单在 ≤960px 卡片布局下状态、计数、最近更新、治理信号（冲突/基线）与行操作可见；Batch 1–3 以 CSS + playwright-cli 证据先行，专用 e2e 待后续。
- `PARAM-INIT-WIZARD-001`：创建者完成项目参数初始化（选源 + 勾选）并进入待审阅；单测/服务端已覆盖；playwright-cli 证据见 `work/ui-checks/param-init/`；完整浏览器 e2e 待语义 binding 选择器落地后补。
- `PARAM-INIT-EMPTY-001`：显式空库初始化可批准为 `initialized` 且零 binding（mock Port + 服务端）；专用 e2e 待补。
- `PARAM-INIT-REVIEW-001`：Admin 在 `/parameter-review` 批准初始化后解锁并物化 binding；服务端 + App Port；playwright-cli 审阅页证据见 `work/ui-checks/param-init/review-*`。
- `PARAM-INIT-REJECT-001`：Admin 带原因驳回后创建者可修订再提交（reducer + 服务端）；专用浏览器 e2e 待补。
- `PARAM-INIT-LOCK-001`：未 `initialized` 项目不能提交常规 typed binding 变更轮次（`ParametersPage` 锁 + `assertProjectAllowsParameterSubmit`）。
- `PROJ-OPS-001`：已被 `PROJ-CONFIG-CUTOVER-001` 取代：旧深链重定向到配置工作台等价上下文；未知项目 ID 仍显示 not-found；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-OPS-002`：已被 `PROJ-CONFIG-READ-001` / `PROJ-CONFIG-CUTOVER-001` 取代：三视口工作台布局证据。
- `PROJ-OPS-003`：已被 `PROJ-CONFIG-BASELINE-001` / `PROJ-CONFIG-OPS-001` / `PROJ-CONFIG-CONFLICT-001` 取代：基线/成员/冲突确认在工作台源码上下文。
- `PROJ-CONFIG-READ-001`：Admin 在 API mode 从项目清单进入 `/parameter-admin/projects/:projectId/configuration`，验证配置集解析、成员/未编组树、活跃 DTS 源码、发布身份、恢复状态和三视口布局；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-SOURCE-001`：Admin 在同一规范路由验证结构 span 聚焦、按文件分组统一搜索、跨文件跳转保留配置集、`node`/`property`/`sourceMode` 深链恢复、树/源码独立重试与键盘导航；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-INSPECT-001`：Admin 在同一规范路由验证检查器层级与回退、不可变版本历史与下载、历史/对比源码模式恢复、身份标注与源码 ≥640px 常驻规则；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-CANDIDATE-001`：Admin 在同一规范路由验证候选上传、影响审查、解析失败诊断与放弃，且不改变活跃版本与配置集成员；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-EDIT-001`：Admin 在同一规范路由验证类型化属性编辑、会话变更坞与预 cutover 验收库上的部分提交；权限/失败保留草稿由组件测试覆盖；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-DRAFT-001`：Admin 在同一规范路由验证可恢复会话草稿（按用户/组织/项目/配置集/文件/基线作用域）：刷新后还原、过期基阻断校验/提交仍可检查、离开确认、退出登录清空；跨用户隔离由组件测试覆盖；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-ACTIVITY-001`：Admin 在同一规范路由打开活动检查器、阅读项目范围审计投影、恢复可定位目标或优雅失败，并验证 toast + 刷新且无常驻审计横幅；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-ACTIVATE-001`：Admin 在同一规范路由验证既有/新文件候选激活、影响确认、过期基 CAS 与不可激活状态；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-OPS-001`：Admin 在同一规范路由验证配置集创建/配置、成员增删（角色/顺序/确认框）、未编组可见性与编入、手动同步任务证据、命令栏导出、空集上传/编入路径（不自动激活）以及非管理员只读保留；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-CONFLICT-001`：Admin 在同一规范路由验证源码定位三方冲突裁决（两侧等权、确认+可选审计原因、队列前进）、合格批量预览/裁决、开放冲突阻断候选激活，以及空队列时冲突坞保持折叠；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-READINESS-001`：Admin 在同一规范路由验证服务端发布就绪摘要、Issues 坞 remediation、阻断/不可用/过期或本机会话脏时创建/发布失败关闭，以及前端不用客户端计数发明权限；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-BASELINE-001`：Admin 在同一规范路由验证基线创建/对比/警告确认/发布/恢复预览与原子恢复、已发布 tip 不变与就绪刷新；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`。
- `PROJ-CONFIG-CUTOVER-001`：旧 `/files` `/config-sets` `/structure` `/conflicts` 深链重定向到等价工作台上下文并保留焦点；新链接只使用 `/configuration`；三视口证明能力不丢失；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；证据见 `work/ui-checks/project-configuration-workbench-cutover/`。
- `PARAM-ADMIN-DIALOG-001`：Admin 打开项目编辑、项目删除与治理确认框，检查焦点进入、Tab 受限、叠层 Escape、焦点归还与按下在内松开在外；共享弹窗原语的单元测试加 playwright-cli 证据先行。
- `PARAM-ASSIGNEE-001/002`：Software User 在 `/parameters` 的 binding-centric 提交面板中看到三类项目作用域候选人；默认值非空，候选集合精确排除 inactive、guest、仅 Admin 与角色不匹配用户。自动化归属 `e2e/acceptance/parameter-topology.acceptance.spec.ts`。
- `PFB-SUBMIT-001`：Admin 在 `/parameters` 通过侧边栏提交产品反馈，断言覆盖 UI、API、DB、audit 和截图证据（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-ADMIN-001`：Admin 在 `/feedback-admin` 查看反馈列表与详情，推进状态并保存备注，断言覆盖 UI、API、DB、audit 和截图证据。
- `PFB-AUTHZ-001`：Hardware User 访问产品反馈管理 API 和 `/feedback-admin` 时被拒绝，断言覆盖 UI、API、DB 和截图证据。
- `LOG-DOMAIN-001`：Admin 在 `/log-admin` 业务域治理区注册业务域并在 `/logs` 上传时绑定该域，断言覆盖 UI、API、DB 和 audit（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-DEGRADED-001`：上传含确定性故障标记的日志触发 provider 故障，分析降级为规则回退并在 UI 显著标注来源与原因，断言覆盖 UI、API 和 DB（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `KB-READ-001`：Hardware User 在 `/knowledge` 浏览条目列表并搜索，检索只返回 `published` 条目，断言覆盖 UI、API、DB（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-EDIT-001`：Hardware User 在 `/knowledge` 创建 markdown 条目、发布、就地修订并恢复历史修订，断言覆盖 UI、API、DB、audit（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-FILE-001`：Hardware User 在 `/knowledge` 经对象存储上传文件条目并查看提取状态，断言覆盖 UI、API、DB、audit（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-ASK-001`：Hardware User 在 `/knowledge`（仅 API 模式）打开问知识库入口进入小泽，并以确定性 SSE 运行证明 `knowledge.search` 落地与引用深链，断言覆盖 UI、API（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-INDEX-001`：Admin 在 `/knowledge-admin` 查看逐条目索引健康与检索模式横幅，执行单条重试与全量重建，断言覆盖 UI、API、DB（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `PARAM-HOME-001`：Admin 在 `/parameter-home` 加载 dashboard summary/hotspots API，并切换页面内时间窗口与热榜维度（`e2e/acceptance/parameter-home.acceptance.spec.ts`）。
- `DEBUG-ADMIN-001`：Admin 在 `/debugging-admin/nodes` 通过 API mode 完成调试参数新增、编辑、归档、恢复和 HDC/ADB binding 维护，断言覆盖 UI、API、DB 和 audit。
- `XIAOZE-PERCEPTION-001`：Admin 在 `/parameters` 向小泽提问，验收基于页面上下文与感知工具的只读 grounded 回答（`e2e/acceptance/xiaoze-perception.acceptance.spec.ts`）。
- `XIAOZE-PERCEPTION-AUTHZ-001`：Guest 用户询问无权限项目时，小泽返回安全非数据回答，不泄露越权内容。
- `XIAOZE-PLAN-MULTISTEP-001`：Admin 在 `/parameters` 完成多步计划并经批准 resume，验收 checkpoint 恢复与执行结果报告（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `XIAOZE-PROACTIVE-001`：opt-in 主动建议在启用时出现、为只读且受 authz 限制；关闭时不出现（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-001`：Admin 在 `/parameter-admin` 创建嵌套参数模块、将参数挂到子模块，并按父模块筛选时包含子树（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-002`：Admin 移动参数模块到新父节点，循环移动返回 409（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-DEBUG-001`：Admin 在 `/debugging-admin/nodes` 创建嵌套调试节点模块，父模块筛选包含子模块节点（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-AUTHZ-001`：Hardware User 不能变更模块树；Admin 删除仍含子模块或参数的模块时返回 409（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-ATTR-QUEUE-001`：Admin 在 `/parameter-admin` 浏览未分类 compatible 队列，忽略/恢复并写审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-CLASSIFY-001`：Admin 归类 compatible 时预览影响并按范围应用（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-BULK-001`：Admin 批量勾选 compatible 归入同一业务分类（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-TREE-001`：Admin 在模块归属树执行按 kind 分级的操作（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-IMPORTANCE-001`：Admin 在业务分类设重要性并确认继承到工作台筛选（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-CREATE-KIND-001`：Admin 在归属树按类型新建空模块并确认父级规则与未实测标记（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PLAT-ROLE-001`～`003`：平台控制台入口与授予边界（`permissions-matrix.acceptance.spec.ts` 自动化）。
- `DRV-PROMOTE-001`～`005`：晋升队列、遮蔽/晋升展示、平台覆盖拒绝编写、控制台晋升与撤销（手工/补充证据）。
- `SPEC-DEPRECATE-001` / `SPEC-RESTORE-001` / `SPEC-EDIT-DIFF-001`：定义软废弃/恢复/编辑 diff（future）。
- `IDMAP-NEWID-001` / `IDMAP-HISTORY-001` / `IDMAP-REOPEN-001`：身份映射三态与历史（future）。
- `MOD-QUEUE-RESTORE-001` / `OVERLAY-RETIRE-001` / `MOD-ATTR-SORT-001`：未归类恢复、停用解析影响、模块排序（future）。
- `DRV-REG-001`：Admin 上传前登记驱动并在树上看见未实测与解析覆盖徽标（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-REG-002`：Admin 从队列或模块树认领未登记驱动并使 origin 变为 curated（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-REG-003`：Admin 上传 DTS 后确认摘要报告已登记与新未登记 compatible（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-REG-004`：编辑驱动性质/基数；组织 Admin 不能改平台主体；platform-admin 编辑进入组织审计；singleton 仅刷新发布阻断（`e2e/acceptance/parameter-topology.acceptance.spec.ts`；服务端单测已覆盖，浏览器仍为 future）。
- `DRV-SCHEMA-001`：Admin 配置并激活组织级解析，覆盖徽标变为「组织级解析覆盖」（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-002`：仅叠加层声明的 compatible 上传后类型化绑定（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-003`：钉扎已覆盖时拒绝激活叠加层（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-004`：激活时就地升级 provisional，无需重传（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-FILE-UPLOAD-001`：Admin 在 `/parameter-admin/projects` 上传 JSON 参数文件并列出文件与版本（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-SYNC-001`：Admin 手动同步参数文件，当解析值与 DB 当前值不一致时创建 `file_sync` 草稿（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-RESOLVE-001`：Admin 通过 API 裁决 file/UI 草稿冲突（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-SPEC-GOVERN-001`：Admin 检索 ingest 后的规格并决议审核任务（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ADMIN-IA-001`：组织子导航两入口、定义管理内嵌审核、节点对应嵌套与旧路由重定向（单测覆盖；Playwright 标记暂缓）。
- `PARAM-TOPOLOGY-BROWSE-001`：融合工作台中的真实源/生效嵌套树、语义行、详情 shape/provenance 与 topology API 200（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-EDIT-001`：drafts Schema 诊断、409 与编译失败关闭（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-001`：`open-mapping` 阻断 validate 与决议审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-ADMIN-001`：Admin 在 `/parameter-admin` 决议身份映射任务并写治理审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-CONFIG-PUBLISH-GATE-001`：真实工具链 validate 与 DB reload 持久化（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-GATE-001`：结构属性闸门与迁移 finalize 驳回（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-VISIBLE-001`：拓扑徽标与工作台不生效提示（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-TOGGLE-001`：启停草稿同轮提交与 `enablement-changed` 审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-GUARD-001`：非标准 status 只读与二级确认（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
