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

- `DEBUG-SIM-001`：模拟器调试验收先覆盖模块子树导航，再执行读写，并记录复杂 JSON 的 `valueKind`、digest 与 preview 元数据。
- `DEBUG-ADMIN-001`：调试管理后台验收覆盖复杂值类型与格式元数据的创建和编辑。
- `DTS-RELOAD-DEPLOY-001` / `KERNEL-001` / `VERIFY-001` / `RESIDUE-001`：假桥自动化验收（见英文操作矩阵）；浏览器证据 `work/ui-checks/285-*`–`288-*`。
- `DTS-RELOAD-DEPLOY-HW-001`：真实 HDC 条件覆盖（非阻塞）。
- `DTS-RELOAD-HANDOFF-001`：工作台 → `/dts-reload` 深链交接（planned；`required: false`）。
- `DTS-RELOAD-PROMOTE-001`：成功普通运行晋升为参数草稿（planned；`required: false`；不建 CR）。

## 当前操作重点

- `SHELL-FOOTER-001`：Admin 在纳入范围的路由到达页面末尾版权/版本信息并打开当前页反馈；首页不重复 footer landmark，全高配置工作台不减少工作高度。`coverage: automated`，见 `e2e/acceptance/shell-navigation.acceptance.spec.ts`。
- `AUTH-LOCAL-PASSWORD-001`：已登录用户在个人资料改密并吊销其它会话。`coverage: future`（单元测试；共享验收仍注入 HMAC smoke，不走本地登录表单）。
- `AUTH-LOCAL-ADMIN-RESET-001`：Admin 在 `/organization/members` 重置成员密码并吊销该用户全部会话。`coverage: future`。
- `AUTH-LOCAL-SELF-REGISTER-001`：关闭自助注册后隐藏「注册」且 API 拒绝注册。`coverage: future`。
- `AUTH-LOCAL-BOOTSTRAP-HINT-001`：无本地 Admin 时显示 bootstrap 提示。`coverage: future`。
- `SHELL-DISCOVERY-001`：侧栏和首页发现面只提供 allowlist 工作流；隐藏工作流可直达。`coverage: future`（单元测试 + playwright-cli）。
- `DTS-RELOAD-DEPLOY-001`：经假本地设备桥部署已校验 overlay（mount / pushFile / trigger）至 `unverifiable`；`coverage: automated`。
- `DTS-RELOAD-KERNEL-001`：触发后内核日志为未判定证据；`coverage: automated`。
- `DTS-RELOAD-VERIFY-001`：经 `debug.readNode` 行为核对；`coverage: automated`。验收 spec 只覆盖无绑定路径，升级判定由 `server/modules/dts-reload/deploy.test.ts` 断言。
- `DTS-RELOAD-RESIDUE-001`：残留记账与恢复基线；`coverage: automated`。验收 spec 只覆盖残留已记录可读，补偿运行与清除规则由 `residue.test.ts` / `restoreBaseline.test.ts` 断言。
- `DTS-RELOAD-DEPLOY-HW-001`：真实 HDC 目标条件部署；`coverage: conditional`。
- `DTS-RELOAD-HANDOFF-001`：从 `/parameters` 工作台「带到参数调试」携带 `?project=` 与 `?bindingIds=`；`coverage: future`。
- `DTS-RELOAD-PROMOTE-001`：从成功普通重载运行把已存调试值写成参数草稿后停止（不建 CR、不自动提交）；`coverage: future`。
- `PARAM-ADMIN-003`：Admin 在 `/parameter-admin/projects` 搜索、状态筛选、排序与分页；刷新、`popstate`、后退与前进都恢复 `q`/`status`/`sort`；键盘进入行且编辑/删除不冒泡，并自动断言 390/768/1440 三档布局。`coverage: automated`，见 `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`。
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
- `PROJ-CONFIG-REVISION-GATE-001`：Admin 在配置工作台经拓扑接缝列出/选择真实配置修订并运行校验；`requiresConfirmation` 时发布确认框须勾选风险确认（单元/服务端 + playwright-cli `work/ui-checks/td-057-config-set-revision-gate/`；阻断 Playwright 等 TD-079）。
- `PROJ-CONFIG-CUTOVER-001`：旧 `/files` `/config-sets` `/structure` `/conflicts` 深链重定向到等价工作台上下文并保留焦点；新链接只使用 `/configuration`；三视口证明能力不丢失；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；证据见 `work/ui-checks/project-configuration-workbench-cutover/`。
- `PARAM-ADMIN-DIALOG-001`：Admin 打开项目编辑、项目删除与治理确认框，检查焦点进入、Tab 受限、叠层 Escape、焦点归还与按下在内松开在外；共享弹窗原语的单元测试加 playwright-cli 证据先行。
- `PARAM-ASSIGNEE-001/002`：Software User 在 `/parameters` 的 binding-centric 提交面板中看到三类项目作用域候选人；默认值非空，候选集合精确排除 inactive、guest、仅 Admin 与角色不匹配用户。自动化归属 `e2e/acceptance/parameter-topology.acceptance.spec.ts`。
- `PFB-SUBMIT-001`：Admin 在 `/parameters` 通过侧边栏提交产品反馈，断言覆盖 UI、API、DB、audit 和截图证据（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-ADMIN-001`：Admin 在 `/feedback-admin` 查看反馈列表与详情，推进状态并保存备注，断言覆盖 UI、API、DB、audit 和截图证据。
- `PFB-AUTHZ-001`：Hardware User 访问产品反馈管理 API 和 `/feedback-admin` 时被拒绝，断言覆盖 UI、API、DB 和截图证据。
- `LOG-DOMAIN-001`：Admin 在 `/log-admin` 业务域治理区注册业务域并在 `/logs` 上传时绑定该域，断言覆盖 UI、API、DB 和 audit（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-DOMAIN-KNOWLEDGE-001`：Admin 在 `/log-admin` 业务域治理区为业务域关联已发布知识条目（只列已发布条目、整组替换保存），断言覆盖 UI、API、DB 和 audit（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-DEGRADED-001`：上传含确定性故障标记的日志触发 provider 故障，分析降级为规则回退并在 UI 显著标注来源与原因，断言覆盖 UI、API 和 DB（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-FEEDBACK-INSIGHTS-001`：Admin 提交日志反馈后在 `/log-admin`「分析质量」区看到按业务域 × 分析来源 × Prompt 版本聚合的有帮助率，断言覆盖 UI、API 和 DB（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-EVAL-DRAFT-001`：Admin 在 `/log-admin` 已完成记录抽屉中导出评测案例草稿（脱敏清单弹层 + case.yaml/log.txt 下载内容校验），断言覆盖 UI（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-ARCHIVE-UPLOAD-001`：在 `/logs` 上传 `.gz` 压缩日志，服务端解压后分析端到端完成，断言覆盖 UI、API 和 DB（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-DOMAIN-WEBHOOK-001`：Admin 在 `/log-admin` 业务域治理区配置结果 Webhook 并触发域绑定分析，接收端收到签名载荷、最近投递列表展示尝试，断言覆盖 UI、API、DB 和 audit（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `LOG-DOMAIN-MODEL-001`：Admin 在 `/log-admin` 域表单设置模型覆盖，覆盖持久化并成为域绑定分析报告的 `model` 溯源，断言覆盖 UI、API、DB 和 audit（`e2e/acceptance/log-analysis.acceptance.spec.ts`；`coverage: automated`）。
- `KB-READ-001`：Hardware User 在 `/knowledge` 浏览条目列表并搜索，检索只返回 `published` 条目，断言覆盖 UI、API、DB（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-EDIT-001`：Hardware User 在 `/knowledge` 创建 markdown 条目、发布、就地修订并恢复历史修订，断言覆盖 UI、API、DB、audit（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-FILE-001`：Hardware User 在 `/knowledge` 经对象存储上传文件条目并查看提取状态，断言覆盖 UI、API、DB、audit（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-ASK-001`：Hardware User 在 `/knowledge`（仅 API 模式）打开问知识库入口进入小泽，并以确定性 SSE 运行证明 `knowledge.search` 落地与引用深链，断言覆盖 UI、API（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-INDEX-001`：Admin 在 `/knowledge-admin` 查看逐条目索引健康与检索模式横幅，执行单条重试与全量重建，断言覆盖 UI、API、DB（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-DISTILL-001`：Hardware User 在 `/logs` 把已完成的日志分析结论沉淀为预填知识草稿，经深链交接到 `/knowledge` 草稿编辑器并发布，断言覆盖 UI、API、DB、审计（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-DISTILL-002`：Hardware Committer 在 `/dts-reload` 把终态重载运行（已验证 / 不可验证 / 矛盾 / 失败）沉淀为带诚实结局措辞的预填知识草稿，经深链交接到 `/knowledge` 草稿编辑器并发布（条目保存 `source_reload_run_id`），断言覆盖 UI、API、DB、审计（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-ADMIN-001`：Admin 经确定性小泽审批流创建 Agent 知识草稿后，在 `/knowledge-admin` 的 Agent 草稿发布队列审阅（创建人、会话来源、来源分析链接）、发布其一并归档拒绝其一，断言覆盖 UI、API、DB、审计（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-REC-001`：Hardware User 在 `/logs` 查看已完成分析的「相关知识」区块（仅已发布条目、引用深链进入 `/knowledge`、草稿与归档永不出现），断言覆盖 UI、API、DB（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-XREF-001`：Hardware User 在 `/knowledge` 管理条目的参数定义引用并在定义详情看到已发布的引用条目（草稿永不出现；废弃后 chip 存续带「已废弃」徽章），断言覆盖 UI、API、DB、审计（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `PARAM-HOME-001`：Admin 在 `/parameter-home` 加载 dashboard summary/hotspots API，并切换页面内时间窗口与热榜维度（`e2e/acceptance/parameter-home.acceptance.spec.ts`）。
- `DEBUG-ADMIN-001`：Admin 在 `/debugging-admin/nodes` 通过 API mode 完成调试节点新增、编辑、禁用/恢复、HDC/ADB binding 维护，以及节点、binding、operation 历史的级联永久删除，断言覆盖 UI、API、DB 和 audit。
- `XIAOZE-PERCEPTION-001`：Admin 在 `/parameters` 向小泽提问，验收基于页面上下文与感知工具的只读 grounded 回答（`e2e/acceptance/xiaoze-perception.acceptance.spec.ts`）。
- `XIAOZE-PERCEPTION-AUTHZ-001`：Guest 用户询问无权限项目时，小泽返回安全非数据回答，不泄露越权内容。
- `XIAOZE-POPUP-MOVE-001`：Admin 在 `/parameters` 关闭态拖动悬浮球、展开态整体移动悬浮球和非模态弹窗，并继续覆盖缩放、复位、恢复、业务页面操作和切换；手机保持全屏，自动化归属 `e2e/acceptance/xiaoze-popup-layout.acceptance.spec.ts`。
- `XIAOZE-ACTION-APPROVE-001`：Admin 批准小泽参数变更。共享 CI 验收库走 `e2e/acceptance/xiaoze-action.acceptance.spec.ts`（binding id + DTS cell）；额外隔离由 `e2e/acceptance/xiaoze-action-semantic.acceptance.spec.ts` 在可丢弃 cutover 库上证明。
- `XIAOZE-APPROVAL-EXEC-FAIL-001`：批准后工具执行失败时，用户应看到中文失败气泡、线程仍可继续，且「新对话」清掉 CopilotKit pending interrupt。浏览器自动化待补（`coverage: future`）；阻断证明是图与 AG-UI 装配测试。
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
- `DRV-REG-004`：编辑驱动性质/基数；组织 Admin 不能改平台主体；platform-admin 编辑进入组织审计；singleton 仅刷新发布阻断（`e2e/acceptance/parameter-topology.acceptance.spec.ts`；服务端单测已覆盖；playwright-cli 证据 `work/ui-checks/attribution-deferred/`；阻断 Playwright 等 TD-079）。
- `DRV-REG-005`：设置注册默认业务分类并「从注册回放放置」；auto 重挂、curated 冻结（单元/mock + playwright-cli 证据 `work/ui-checks/attribution-deferred/`；阻断 Playwright 等 TD-079）。
- `DRV-SCHEMA-001`：Admin 配置并激活组织级解析，覆盖徽标变为「组织级解析覆盖」（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-002`：仅叠加层声明的 compatible 上传后类型化绑定（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-003`：钉扎已覆盖时拒绝激活叠加层（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-004`：激活时就地升级 provisional，无需重传（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-FILE-UPLOAD-001`：Admin 在 `/parameter-admin/projects` 上传 JSON 参数文件并列出文件与版本（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-SYNC-001`：Admin 手动同步参数文件，当解析值与 DB 当前值不一致时创建 `file_sync` 草稿（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-RESOLVE-001`：Admin 通过 API 裁决 file/UI 草稿冲突（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-ROLLBACK-001`：Admin 在配置工作台版本历史经确认框把某版本恢复为当前；插入新回滚指针版本且不倒带历史；操作者显示名而非原始用户 ID（单元/服务端 + playwright-cli `work/ui-checks/param-file-rollback/`；阻断 Playwright 等 TD-079）。
- `PARAM-SPEC-GOVERN-001`：Admin 检索 ingest 后的规格并决议审核任务（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-SPEC-VIEW-001`：Admin 默认打开生效目录，显式切换到治理历史，URL 保留所选投影，详情使用同一投影；单测与三视口 playwright-cli 证据先行，共享验收 marker 暂缓。
- `PARAM-SPEC-EDIT-001`：Admin 编辑启用态定义的单位/约束/示例/说明并往返；组件与服务端覆盖先行，共享 CI 验收库 Playwright 标记暂缓（TD-079）。
- `PARAM-SPEC-EDIT-002`：三视口下编辑器动作可达、焦点进入与归还；`ModalDialog` 单测加 playwright-cli 证据先行。
- `PARAM-SPEC-IDENTITY-001`：Admin 从库纠正归属主体，再打开时声明主体已更新；生命周期与引用数保留；组件与 mock/HTTP 覆盖先行，共享 CI 验收库 Playwright 标记暂缓（TD-079）。
- `PARAM-SPEC-IDENTITY-002`：零引用可改属性键，有引用拒绝并说明原因；与既有（含废弃）定义碰撞展示阻挡方；RTL / presentError / mock 与 playwright-cli 证据先行，阻断 Playwright 暂缓（TD-079）。
- `PARAM-ADMIN-IA-001`：组织子导航两入口、定义管理内嵌审核、节点对应嵌套与旧路由重定向（单测覆盖；Playwright 标记暂缓）。
- `PARAM-TOPOLOGY-BROWSE-001`：融合工作台中的真实源/生效嵌套树、语义行、详情 shape/provenance 与 topology API 200（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-EDIT-001`：drafts Schema 诊断、409 与编译失败关闭（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-001`：`open-mapping` 阻断 validate 与决议审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-ADMIN-001`：Admin 在 `/parameter-admin` 决议身份映射任务，并通过受保护 re-resolve 更正已应用的选择，覆盖 UI、API、DB 与治理审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-CONFIG-PUBLISH-GATE-001`：真实工具链 validate 与 DB reload 持久化（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-GATE-001`：已自动化。结构属性闸门与迁移 finalize 驳回（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-VISIBLE-001`：已自动化。工作台不生效提示 + 拓扑 API enablement；`TopologyTree` 不在 `/parameters` 默认面上（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-TOGGLE-001`：已自动化。禁用需理由与确认；启停草稿同轮提交不触发 `mixed-working-tips`；独立 `enablement-changed` 审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-GUARD-001`：已自动化。非标准 status 只读与二级确认（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PERM-GOV-001` / `PERM-USER-MGMT-001`：Admin 在 `/organization/members` 创建、更新或永久注销非本人账号；注销会级联清理账号自有数据并将历史用户引用置空，随后在 `/knowledge-admin` 与 `/parameter-review` 验证“已注销用户”归属；非 Admin 拒绝；`coverage: automated`。
- `ORG-ADMIN-RENAME-001`：Admin 在 `/organization` 改本组织显示名称，写 `organization-update` 审计；非 Admin `PATCH` 返回 403；`coverage: automated`。
- `PLAT-ROLE-002`：普通 Admin 在 `/organization/members` 看不到平台超级管理员授予控件，API 拒绝自授。

## Canonical Parameter definitions operations（#668 / OP-08）

本附录同步 `e2e/acceptance/operationMatrix.ts` 中已正式登记的 15 个 `coverage=automated` operation。每行都有完整 assertions，以及指向已存在 owner 文件的 `specFiles`。CatalogPage 已挂载；OP-08（#810）在本地 Catalog lane 上以可观察断言执行这些 ID。英文 companion 由 `npm run acceptance:operations` 生成。这是本地证据，不是 Hosted 或目标机证据。

| Operation ID | Priority | 状态 | Requirement | 路由/角色/交互 | 三视口 | 必需 API / DB / audit / screenshot 证据 | Spec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PCAT-CATALOG-DISCOVER-001` | P0 | automated | PCAT-UI-01 | `/parameter-admin/specs`；全角色进入唯一目录 | 1440x900、768x1024、390x844 | catalog/list 200；current-release DB fingerprint；zero read mutation；entry/list screenshots | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-CATALOG-DEEP-LINK-001` | P0 | automated | PCAT-UI-02 | User/Org Admin；reload/Back/Forward opaque selection | 三视口 | pinned API/cursor；selected-ID DB；无 audit；restored-selection screenshots | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-DEFINITION-DETAIL-001` | P0 | automated | PCAT-UI-03 | User/Org Admin；选择 Subject/Definition/current+pinned revision | 三视口 | detail/revision API；owner/head DB；无 audit；pane/sheet screenshots | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-REVIEW-RESOLVE-001` | P0 | automated | PCAT-UI-04 | Org Admin；ETag/release/idempotency 下 resolve 四种 variant | 三视口 | atomic API；Resolution/Registration/Placement/Proposal DB；success/refusal audit；前/确认/后截图 | `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts` |
| `PCAT-TIMELINE-001` | P1 | automated | PCAT-UI-05 | authorized reader；稳定分页 timeline | 三视口 | composite cursor API；pinned DB facts；无 read audit；timeline screenshots | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-READY-ACTIONS-001` | P0 | automated | PCAT-UI-06 | 全角色；对比 ready affordance 与 server denial | 三视口 | role API；denied DB unchanged；refusal audit；role screenshots | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-REGISTRATION-001` | P0 | automated | PCAT-UI-07 | Org Admin + negative roles；显式 default/parent 注册并 reload | 三视口 | release/idempotency API；one Registration/Placement DB；success/denial audit；choice/result screenshots | `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts` |
| `PCAT-CATALOG-STATES-001` | P0 | automated | PCAT-UI-08 | authorized reader；loading/error/四种 emptyReason | 三视口 | state APIs；fixture DB；零 mutation/audit；全部状态截图 | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-RETIRED-HISTORY-001` | P1 | automated | PCAT-UI-09 | reader/Admin negative；读 retired/deprecated 并尝试禁止 mutation | 三视口 | lifecycle API+409；retained DB；refusal audit；badge/disabled screenshots | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-CONFLICT-RECONFIRM-001` | P0 | automated | PCAT-UI-10 | Org/Platform Admin；触发四类 conflict 并保留输入重确认 | 三视口 | exact 409；no-partial DB；refusal/no-success audit；conflict screenshots | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| `PCAT-LEGACY-LINK-001` | P0 | automated | PCAT-UI-11 | authorized/scope-hidden；mapped/410/409/404 | 三视口 | status+headers；mapping-head/Archive DB；必要 operator audit；outcome screenshots | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| `PCAT-AGENT-READONLY-001` | P0 | automated | PCAT-UI-12 | Agent；scoped read + 所有治理 mutation/spoof probe | 三视口 | scoped 200/403；zero DB mutation；trusted refusal audit；read-only screenshots | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| `PCAT-ADAPTER-PARITY-001` | P1 | automated | PCAT-UI-13 | 全角色；API/mock 重放相同 state/authority | 三视口 | real API digest；API-half DB/audit；mock no-extra-authority；paired screenshots | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` |
| `PCAT-RESPONSIVE-001` | P0 | automated | PCAT-UI-14 | reader/Admin；全 page/dialog/drawer layout+focus | 三视口 | critical API；DB/audit N/A；snapshot+screenshot；console/page/request failure=0 | `e2e/acceptance/parameter-catalog.acceptance.spec.ts` |
| `PCAT-GOVERNANCE-JOURNEY-001` | P0 | automated | PCAT-UI-15 | Org/Platform Admin + negative roles；完整 navigation/register/review/proposal/conflict/deep-link journey | 三视口 | request ledger；final DB；每个 mutation/refusal audit；checkpoint screenshots/trace/report/runtime pins | `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts` |

这些行现在是 registry 中的 automated 覆盖，并已在本地 Catalog lane 上以真实断言执行。planned/skip 不再满足这些 ID。`npm run acceptance:evidence` 要求每个 automated P0/P1 都有同一 full run/source/runtime 的 role、route、assertions、API、DB、audit、screenshots/artifacts、trace/report 和 reproduction steps。本地 OP-08 运行不是 Hosted 或目标机证据。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
