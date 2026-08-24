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

- `SHELL-FOOTER-001`：纳入范围的路由、两个有意保留的 `NoEntryPage` 与权限拒绝结果显示一个页面末尾版权/版本页脚及当前页反馈入口；首页仍只有一个 footer landmark；空白或非法联系方式隐藏，已配置 `https:`/`mailto:` 保持安全属性；认证、启动骨架、服务故障、下载交接与全高配置工作台保持原有排除边界（`e2e/acceptance/shell-navigation.acceptance.spec.ts`、`src/config/appFooterConfig.test.ts`、`src/components/common/AppFooter.test.tsx`、`src/App.test.tsx`）。
- `SHELL-DISCOVERY-001`：侧栏和首页发现面只提供 allowlist 上的工作流（第一次是参数管理和调试）；日志分析和知识库不在发现面，直达仍可用（单元测试 + `work/ui-checks/workflow-discovery/`）。
- `AUTH-RUNTIME-001`：API mode 浏览器运行时与本地 dev auth 契约一致。
- `AUTH-LOCAL-PASSWORD-001`：已登录本地用户在个人资料改密；当前会话保持，其它会话退出（单元测试；浏览器 e2e 为 planned）。
- `AUTH-LOCAL-ADMIN-RESET-001`：Admin 在 `/organization/members` 重置成员密码并吊销该用户全部会话（单元测试；浏览器 e2e 为 planned）。
- `AUTH-LOCAL-SELF-REGISTER-001`：关闭自助注册后认证页隐藏「注册」，API 拒绝 `POST /api/v1/auth/register`（单元测试；浏览器 e2e 为 planned）。
- `AUTH-LOCAL-BOOTSTRAP-HINT-001`：没有本地 Admin 时认证页显示 `npm run admin:bootstrap` 提示（单元测试；浏览器 e2e 为 planned）。
- `NOTIF-INBOX-001`：TopBar 通知铃铛可打开收件箱面板，且 `/api/v1/notifications` 与未读数 API 对当前用户可用（`e2e/acceptance/notifications.acceptance.spec.ts`）。
- `NOTIF-READ-001`：通知可通过后端 mark-all-read API 标记已读（`e2e/acceptance/notifications.acceptance.spec.ts`）。
- `PFB-SUBMIT-001`：活跃用户从侧边栏提交产品反馈，包含描述和可选截图；API 持久化，UI 展示成功提示（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-ADMIN-001`：Admin 在 `/feedback-admin` 列表打开详情，将反馈从 `open` 推进到 `in_progress` 再到 `closed`，并写入处理备注（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `PFB-AUTHZ-001`：非 Admin 无法访问产品反馈管理 API 或 `/feedback-admin` 页面（`e2e/acceptance/product-feedback.acceptance.spec.ts`）。
- `LOG-DOMAIN-001`：Admin 在 `/log-admin` 业务域治理区注册业务域（名称、描述、格式画像 JSON），上传时绑定该域，结论卡展示业务域标签（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-DEGRADED-001`：模拟 provider 故障后分析降级到规则引擎，结果显著标注「降级分析 · 规则回退」与 provider-unavailable 原因，绝不静默冒充完整分析（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-DOMAIN-KNOWLEDGE-001`：Admin 在 `/log-admin` 业务域治理区打开「知识条目」编辑器，仅能选择已发布的知识条目，保存关联集合（整组替换语义），变更落到 API、关联表与审计事件（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-FEEDBACK-INSIGHTS-001`：提交日志反馈后，`/log-admin`「分析质量」区按业务域 × 分析来源 × Prompt 版本聚合展示所选时间窗口内的有帮助率，数据来自 `GET /api/v1/logs/feedback-insights`（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-EVAL-DRAFT-001`：Admin 在已完成记录的抽屉中导出评测案例草稿：弹层展示脱敏清单，下载物为 schema 对齐的 `case.yaml`（realLog: true、deIdentified: false、rootCauseCategory TODO、预填证据行号/建议动作）与 `log.txt`（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-ARCHIVE-UPLOAD-001`：经上传对话框上传的 `.gz` 压缩日志由服务端解压并端到端完成分析，证据行号锚定解压后的文本行（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-DOMAIN-WEBHOOK-001`：Admin 在 `/log-admin` 业务域治理区配置结果 Webhook（https 或本地联调 URL、只写密钥仅显示末四位、启用开关，写 `log-domain-webhook-config` 审计）；域绑定分析完成后向接收端投递 HMAC 签名载荷（签名可验、不含原始日志内容），最近投递列表显示已送达尝试（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `LOG-DOMAIN-MODEL-001`：Admin 通过 `/log-admin` 域表单设置按域模型覆盖（placeholder 注明留空使用全局模型）；覆盖在域 API/DB 持久化、域列表可见，域绑定分析的报告 `model` 溯源记录该覆盖名（`e2e/acceptance/log-analysis.acceptance.spec.ts`）。
- `KB-READ-001`：组织成员在 `/knowledge` 浏览知识条目列表，搜索只命中 `published` 条目（draft 和 archived 不进检索结果），并打开已发布条目详情（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-EDIT-001`：编辑者创建 markdown 知识条目、发布、就地修订产生新的不可变修订，并把历史修订恢复为新修订（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-FILE-001`：编辑者经对象存储上传文件型知识条目，并在条目上看到文本提取状态（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-ASK-001`：组织成员在 `/knowledge`（仅 API 模式）使用问知识库入口打开小泽；确定性小泽运行经 `knowledge.search` 落地回答并携带指向已发布条目的引用深链。浏览器部分覆盖入口与引用深链；确定性落地循环在 SSE API 层断言（与 `XIAOZE-PERCEPTION-001` 同模式），并由 `knowledge-grounding` eval 场景兜底——当前小泽完整浏览器循环尚无确定性浏览器验收（`e2e/acceptance/knowledge.acceptance.spec.ts`；`server/modules/agent/xiaoze/eval/scenarios.ts`）。
- `KB-INDEX-001`：知识管理员在 `/knowledge-admin` 查看逐条目检索索引健康（状态、失败原因、已索引修订）与诚实的检索模式横幅（语义 vs 仅全文），可单条重试或全量重建（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-DISTILL-001`：编辑者在日志分析结果页把已完成的分析结论一键沉淀为预填知识草稿（标题取自结论；正文由结论、影响、严重度、证据行引用与建议处置组装；条目上保存来源关联），经条目深链交接到 `/knowledge` 草稿编辑器审阅后发布（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-DISTILL-002`：编辑者在 `/dts-reload` 运行历史/详情面把终态 DTS 重载运行（行为已验证 / 不可验证 / 行为矛盾 / 部署失败）一键沉淀为预填知识草稿（标题取运行目的 + 设备上下文；正文组装参数集基线 → 调试值、每参数验证结局、诚实陈述的运行终态、产物摘要与以运行为证据主体的内核日志摘录引用；条目上保存 `source_reload_run_id` 来源关联），经条目深链交接到 `/knowledge` 草稿编辑器审阅后发布（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-ADMIN-001`：经审批门控工具 `action.createKnowledgeDraft` 创建的 Agent 知识草稿（确定性小泽先中断、后批准——同 `XIAOZE-ACTION-APPROVE-001` 在 SSE API 层断言，另有 `knowledge-agent-draft` eval 场景兜底）进入 `/knowledge-admin` 的 Agent 草稿发布队列（含创建人、会话来源、来源分析链接）；审阅者发布其一、归档拒绝其一，Agent 草稿在发布前不进入检索（`e2e/acceptance/knowledge.acceptance.spec.ts`；`server/modules/agent/xiaoze/eval/scenarios.ts`）。
- `KB-REC-001`：已完成的日志分析记录展示由存储的结论/影响文本推导的「相关知识」区块：相关已发布条目带 `/knowledge?entryId=…` 引用深链出现，草稿与归档条目永不出现，区块诚实标注实际运行的检索模式，无相关条目时展示诚实空态（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `KB-XREF-001`：编辑者在知识条目上管理参数定义的结构化引用（添加/移除有审计，绑定 `parameter_specs.id` 代理键）；定义详情的「相关知识」列表显示已发布的引用条目而草稿条目对任何调用者都不出现，废弃该定义后知识侧 chip 存续并带如实「已废弃」徽章（`e2e/acceptance/knowledge.acceptance.spec.ts`）。
- `DEBUG-SIM-001`：模拟器读、写、回读不一致、回滚与审计路径，包含复杂 JSON 值元数据。
- `DEBUG-ADMIN-001`：API mode 下，Admin 新增、编辑、禁用/恢复逻辑调试节点，维护 HDC/ADB binding，经生产接口导出节点目录并导入由其派生的单节点文档，同时核对数据库与 `debug-node-catalog-export` / `debug-node-catalog-import` 两类审计。这是确定性目录治理证据，不是 HDC 真机证据。
- `DTS-RELOAD-DEPLOY-001`：经假本地设备桥部署已校验的重载 overlay（mount / pushFile / trigger）至 `unverifiable`；浏览器证据 `work/ui-checks/285-*`。
- `DTS-RELOAD-KERNEL-001`：触发后内核日志采集保持为未判定证据；浏览器证据 `work/ui-checks/286-*`。
- `DTS-RELOAD-VERIFY-001`：触发成功后经 `debug.readNode` 核对绑定参数，升级为 verified/contradicted 或保持 unverifiable。验收 spec 仅断言无绑定路径（不调用 `debug.readNode`、保持 unverifiable）；升级判定由服务端测试断言。人工浏览器证据 `work/ui-checks/287-*`。
- `DTS-RELOAD-RESIDUE-001`：设备写后终端记录残留。验收 spec 断言残留已记录且可读；补偿性恢复运行与"仅成功时清除"规则由服务端测试断言。人工浏览器证据 `work/ui-checks/288-*`。
- `DTS-RELOAD-DEPLOY-HW-001`：真实 HDC 目标经已配对本地桥部署重载 overlay（条件覆盖，非阻塞）。
- `DTS-RELOAD-HANDOFF-001`：参数工作台把已选 binding 集带到 `/dts-reload?project=&bindingIds=`，工程师不必重搜；重载页过滤候选且不自动填入本轮托盘（单元覆盖已有；浏览器自动化待补）。
- `DTS-RELOAD-PROMOTE-001`：已验证或经确认的不可验证普通重载运行，把所选已存调试值写成 `parameter_drafts` 后停止；不创建变更请求（单元覆盖已有；浏览器自动化待补）。
- `BRIDGE-WIN-001`：`/node-debugging` 的 Windows 优先本地 Bridge 面板可覆盖缺失安装、未配对、未启动、在线无设备与在线目标状态，并展示同源 Windows 下载入口。
- `BRIDGE-TOOLS-001`：Bridge 已连接但 `tools.adb.available: false` 时，Step ③ 显示缺少 ADB 与 **安装调试工具** CTA（非「Bridge 未安装」）。覆盖：`src/NodeDebuggingPage.test.tsx`。
- `PARAM-HOME-001`：`/parameter-home` 通过 `ParameterDashboardRepository` 加载 summary/hotspots API 数据，并支持页面内时间窗口与热榜维度切换（`e2e/acceptance/parameter-home.acceptance.spec.ts`）。
- `PARAM-ADMIN-003`：Admin 项目清单在刷新、`popstate`、后退与前进后恢复 `q`/`status`/`sort`，支持分页、键盘进入行且行操作不冒泡；390px 为字段完整的卡片，768px 为 1080px 宽表格加 16px 常显横向滚动条，1440px 完整显示且页面不横向溢出。自动化见 `e2e/acceptance/parameter-admin-projects.acceptance.spec.ts`。
- `PARAM-INIT-WIZARD-001`：创建者完成项目参数初始化（选源 + 勾选）并进入待审阅（单测 wizard/reducer；服务端 `initializationService`；playwright-cli 见 `work/ui-checks/param-init/`）。
- `PARAM-INIT-EMPTY-001`：显式空库初始化可批准为 `initialized` 且零 binding（mock Port + 服务端单测）。
- `PARAM-INIT-REVIEW-001`：Admin 批准初始化后解锁项目并按快照物化 binding（服务端物化/审计；App Port 接线；playwright-cli 审阅页见 `work/ui-checks/param-init/review-*`）。
- `PARAM-INIT-REJECT-001`：Admin 带原因驳回后创建者可修订再提交（reducer + 服务端）。
- `PARAM-INIT-LOCK-001`：未 `initialized` 的项目不能提交常规 typed binding 变更轮次（`ParametersPage` 锁 + `assertProjectAllowsParameterSubmit`）。
- `PROJ-OPS-001`：已被 `PROJ-CONFIG-CUTOVER-001` 取代——旧深链重定向到等价配置工作台上下文；未知项目 ID 仍显示 not-found（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；页面/cutover 单测）。
- `PROJ-OPS-002`：已被 `PROJ-CONFIG-READ-001` / `PROJ-CONFIG-CUTOVER-001` 取代——三视口工作台布局无截断、无页面级横向溢出。
- `PROJ-OPS-003`：已被 `PROJ-CONFIG-BASELINE-001` / `PROJ-CONFIG-OPS-001` / `PROJ-CONFIG-CONFLICT-001` 取代——基线、成员与冲突确认均在工作台源码上下文中完成。
- `PROJ-CONFIG-READ-001`：Admin 从项目清单进入规范项目配置路由，优先恢复有效 URL 配置集、否则确定性选择默认配置集；树区分成员/未编组文件并展示角色与活跃版本身份，经 API ports 读取选中活跃 DTS 源码；源码主导桌面布局、响应式 sheet 以及空/加载/失败恢复状态均可用（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/端口/服务端测试；证据见 `work/ui-checks/project-configuration-workbench-readonly/`）。
- `PROJ-CONFIG-SOURCE-001`：在开关后的配置工作台中，Admin 选择节点/属性以滚动并高亮源码 span，执行按文件分组的统一搜索并可跨文件跳转且保留配置集上下文，恢复 `node`/`property`/`sourceMode` 深链，树与源码独立加载/重试，并使用不覆盖浏览器快捷键的键盘搜索/下一结果/行跳转/焦点（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/port/服务端测试；`work/ui-checks/project-configuration-workbench-source-nav/`）。
- `PROJ-CONFIG-INSPECT-001`：在开关后的配置工作台中，Admin 检查配置集/文件/节点/属性上下文，沿检查器回退并保留源码选择，浏览不可变文件历史并按版本下载，进入历史/unified/side-by-side 源码模式且退出后恢复，区分工作配置/文件版本/候选占位/发布基线身份，并在源码画布仍 ≥640px 时使用叠层或常驻检查器（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件测试；`work/ui-checks/project-configuration-workbench-inspector-history/`）。
- `PROJ-CONFIG-CANDIDATE-001`：在开关后的配置工作台中，Admin 上传候选、在候选源码/检查器中审查文本与结构影响、覆盖/冲突/阻断，放弃 ready/blocked/failed 候选，并证明工作配置与配置集成员不变（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件测试；`work/ui-checks/project-configuration-workbench-candidate-upload/`）。
- `PROJ-CONFIG-EDIT-001`：在开关后的配置工作台中，Admin 选中可编辑属性打开类型化检查器，会话变更与树/装订线共享属性身份，在共享预 cutover 验收库上经 `submitStructuredEdits` 校验并部分提交，源码画布保持只读；权限不足或提交失败时草稿保留由组件/端口测试覆盖（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/端口测试；`work/ui-checks/project-configuration-workbench-structured-edit/`）。
- `PROJ-CONFIG-DRAFT-001`：在开关后的配置工作台中，Admin 的会话草稿按用户/组织/项目/配置集/文件/基线作用域可恢复；基线匹配时刷新后还原，基线过期时仍可检查但阻断校验/提交（e2e 以 localStorage 改写 base 证明），退出登录清空；脏草稿离开经 ConfirmDialog；跨用户隔离由组件/存储测试覆盖（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/存储测试；`work/ui-checks/project-configuration-workbench-session-drafts/`）。
- `PROJ-CONFIG-ACTIVITY-001`：在开关后的配置工作台中，Admin 从命令栏打开活动检查器（无常驻审计横幅），以产品用语阅读项目范围服务器审计投影，可定位事件恢复工作台上下文或优雅失败，变更 toast + 时间线刷新，并保持叠层/常驻检查器行为（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件测试；`work/ui-checks/project-configuration-workbench-activity-timeline/`）。
- `PROJ-CONFIG-ACTIVATE-001`：在开关后的配置工作台中，Admin 对既有/新文件 ready 候选做影响确认后以 expected-current-version CAS 激活；过期基保留工作配置并要求重算；blocked/failed/abandoned/stale 不可激活（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/集成测试；`work/ui-checks/project-configuration-workbench-candidate-activation/`）。
- `PROJ-CONFIG-OPS-001`：在开关后的配置工作台中，Admin 创建/配置配置集（含校验与重名处理）、以角色与顺序增删成员并经 ConfirmDialog 确认影响范围、未编组文件保持在工作配置/发布就绪度之外直至编入、手动同步写入任务证据、从命令栏导出配置集；空配置集给出聚焦的上传/编入路径且不自动激活；非管理员拒绝变更但保留只读上下文（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件测试；`work/ui-checks/project-configuration-workbench-file-config-ops/`）。
- `PROJ-CONFIG-CONFLICT-001`：在开关后的配置工作台中，Admin 从任务坞打开源码定位的三方冲突裁决；两侧等权结果经确认并可写审计原因；队列在源码上下文中前进；合格批量裁决需影响预览；开放冲突阻断候选激活；空队列保持冲突坞折叠（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/集成测试；`work/ui-checks/project-configuration-workbench-conflict-arbitration/`）。
- `PROJ-CONFIG-READINESS-001`：在开关后的配置工作台中，Admin 看到服务端发布就绪摘要；Issues 坞列出有序阻断/警告与 remediation；选中打开源码证据；阻断/不可用/过期或本机会话脏时创建/发布失败关闭；前端不用客户端计数发明权限（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/集成测试；`work/ui-checks/project-configuration-workbench-release-readiness/`）。
- `PROJ-CONFIG-BASELINE-001`：在开关后的配置工作台中，Admin 创建不改源文件的草稿基线快照，在统一/并排源码模式对比，确认警告后带影响确认发布并刷新 tip，恢复时预览 blast radius 且不改已发布 tip，并刷新就绪（`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；组件/集成测试；`work/ui-checks/project-configuration-workbench-release-baselines/`）。
- `PROJ-CONFIG-REVISION-GATE-001`：Admin 经拓扑接缝列出所选配置集的真实配置修订、选择列表中的 id（不发明教学兜底 id）、运行修订校验；当校验返回 `requiresConfirmation` 时，发布基线 ConfirmDialog 须勾选确认才能继续（工作台/session/mock/HTTP/服务端单测；playwright-cli 证据 `work/ui-checks/td-057-config-set-revision-gate/`；阻断 Playwright 等 TD-079）。
- `PROJ-CONFIG-CUTOVER-001`：旧 `/files` `/config-sets` `/structure` `/conflicts` 深链重定向到等价工作台上下文并保留焦点；新链接只使用 `/configuration`；三视口证明能力不丢失；自动化归属 `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`；证据见 `work/ui-checks/project-configuration-workbench-cutover/`。
- `PARAM-ADMIN-DIALOG-001`：参数后台弹窗（项目编辑、项目删除、治理确认框）打开时焦点进入弹窗、Tab 不会离开、Escape 只关闭最上层、关闭后焦点回到触发元素、按下在内松开在外不关闭，并且 portal 渲染后仍保留参数后台的按钮与动作条样式（`src/components/common/ModalDialog.test.tsx`、`src/components/common/ModalDialog.styles.test.ts`；证据 `desktop-project-edit.png`、`desktop-project-delete.png`）。
- `PARAM-ASSIGNEE-001/002`：binding-centric 提交面板的三类可见处理人下拉框默认选择项目作用域内的活跃合格用户，并精确排除 inactive、guest、仅 Admin 与角色不匹配用户（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-HAPPY-001`：在融合后的成熟 `/parameters` 工作台中检索语义 binding、查看本轮修改区、创建 typed draft、选择可见处理人并 submit，按真实角色 review 后执行 semantic merge/writeback、reload、持久化和审计闭环（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `XIAOZE-PERCEPTION-001`：小泽 P0 感知验收——基于页面上下文与只读感知工具回答有权限范围内的项目问题。
- `XIAOZE-PERCEPTION-AUTHZ-001`：越权项目问题返回安全、不泄露数据的回答。
- `XIAOZE-ACTION-APPROVE-001`：共享 CI 验收库由 `e2e/acceptance/xiaoze-action.acceptance.spec.ts` 覆盖（binding id + DTS cell；无 `project_parameter_value_id` 回退）。额外隔离在 `e2e/acceptance/xiaoze-action-semantic.acceptance.spec.ts` 的可丢弃 cutover 库上。
- `XIAOZE-APPROVAL-EXEC-FAIL-001`：批准后工具执行失败时，聊天应出现中文 assistant 失败回合（`操作未能完成` + 原因），线程仍可用，「新对话」不被 pending interrupt 卡住。本切片以图与 AG-UI 装配测试为阻断门禁；浏览器路径需要陈旧工作版本 / overlay 夹具，登记为诚实的 `@acceptance-planned` 桩（`e2e/acceptance/xiaoze-action.acceptance.spec.ts`）。
- `XIAOZE-PLAN-MULTISTEP-001`：多步计划在批准后 checkpoint resume，并报告观察到的执行结果（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `XIAOZE-PROACTIVE-001`：opt-in 主动建议为只读、受 authz 限制；关闭时不展示（`e2e/acceptance/xiaoze-planning.acceptance.spec.ts`）。
- `PERM-GOV-001` / `PERM-USER-MGMT-001`：`/organization/members` 的 Admin 成员治理与非 Admin 拒绝（`e2e/acceptance/permissions.acceptance.spec.ts`）。
- `ORG-ADMIN-RENAME-001`：Admin 在 `/organization` 改名 + 审计 + 非 Admin `PATCH` 403（`e2e/acceptance/permissions.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-001`：Admin 创建嵌套参数模块、将参数挂到子模块，并按父模块筛选时包含子树（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-PARAM-002`：Admin 移动参数模块到新父节点，循环移动被拒绝（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-DEBUG-001`：Admin 创建嵌套调试节点模块，父模块筛选包含子模块下的节点（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-TREE-AUTHZ-001`：非 Admin 不能变更模块树；删除非空模块返回 409（`e2e/acceptance/hierarchical-modules.acceptance.spec.ts`）。
- `MOD-ATTR-QUEUE-001`：未分类 compatible 队列只列非 scaffolding、未忽略项，并显示参数/项目数；忽略与恢复均写审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-CLASSIFY-001`：归类时展示影响预览，确认后按范围应用并回收空未分类桶（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-BULK-001`：勾选多个 compatible，一次确认归入同一业务分类（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-TREE-001`：树操作按 kind 分级；实例不可删；重命名自动模块即纳入（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-IMPORTANCE-001`：业务分类重要性被驱动组/实例继承并驱动工作台筛选（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `MOD-ATTR-CREATE-KIND-001`：归属树按类型新建空业务/驱动组/实例/逻辑节点（父级规则、驱动组必填 compatible、空 curated 未实测）（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PLAT-ROLE-001`～`003`：平台超级管理员控制台与跨租户访问边界（`e2e/acceptance/permissions-matrix.acceptance.spec.ts` 自动化）。
- `DRV-PROMOTE-001`～`005`：overlay 晋升/遮蔽/拒绝编写与控制台晋升撤销（手工/补充证据，见 `2026-08-01-governance-platform-closeout`）。
- `SPEC-DEPRECATE-001` / `SPEC-RESTORE-001` / `SPEC-EDIT-DIFF-001`：定义软废弃/恢复/活性编辑 diff（已登记；Playwright 待跟进）。
- `IDMAP-NEWID-001` / `IDMAP-HISTORY-001` / `IDMAP-REOPEN-001`：身份映射新身份/历史/重开（已登记）。
- `MOD-QUEUE-RESTORE-001` / `OVERLAY-RETIRE-001` / `MOD-ATTR-SORT-001`：未归类恢复、overlay 停用影响、模块排序（已登记）。
- `DRV-REG-001`：上传前登记驱动；树上出现带解析覆盖徽标的未实测 curated 驱动组（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-REG-002`：从队列或模块树认领已观测未登记驱动，origin 变为 curated（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-REG-003`：DTS 上传后一次性摘要报告已登记匹配与新观测未登记 compatible（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-REG-004`：编辑 driverNature / instanceCardinality；组织 Admin 不能改平台主体；platform-admin 组织侧编辑进入组织审计；改为 singleton 仅刷新发布阻断任务（`e2e/acceptance/parameter-topology.acceptance.spec.ts`；单元/服务端已覆盖；playwright-cli 证据 `work/ui-checks/attribution-deferred/`；阻断 Playwright 等 TD-079）。
- `DRV-REG-005`：Admin 设置注册默认业务分类并执行「从注册回放放置」；auto 驱动组重挂，curated 冻结（`e2e/acceptance/parameter-topology.acceptance.spec.ts`；`ModuleEditDialog.test.tsx`；mock 仓储；playwright-cli 证据 `work/ui-checks/attribution-deferred/`）。
- `DRV-SCHEMA-001`：Admin 对解析未覆盖的驱动组配置并激活组织级解析，覆盖徽标变为「组织级解析覆盖」（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-002`：仅组织叠加层声明的 compatible 上传后绑定类型化属性，且不进入未匹配审核（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-003`：钉扎 schema 已覆盖时激活叠加层被拒绝并说明原因（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `DRV-SCHEMA-004`：激活叠加层时就地升级已有 provisional spec，无需重传（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-FILE-ADMIN-001`：Admin 上传项目参数文件、列出版本、手动同步生成 `file_sync` 草稿，并在 `/parameter-admin/projects` 打开参数文件面板（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-CONFLICT-001`：Admin 裁决 file/UI 草稿冲突，可选择保留文件值或 UI 值（`e2e/acceptance/parameter-files.acceptance.spec.ts`）。
- `PARAM-FILE-ROLLBACK-001`：Admin 把历史文件版本恢复为当前（插入 `origin=rollback` 指针版本，不倒带历史），版本列表展示操作者显示名（工作台/mock/服务端单测；playwright-cli 证据 `work/ui-checks/param-file-rollback/`；阻断 Playwright 等 TD-079）。
- `PARAM-IMPORT-DTS-FULL-001`：完整 `.dts` 经 `parse-dts` 产出带 `@address` 的 module 路径；`/include/` 被拒绝；向导显示服务端解析提示（`e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts`）。
- `PARAM-IMPORT-REVIEW-META-001`：带 `reviewMetadata.skippedRows` 的导入预览写入 `batch-import` 审计 metadata（`e2e/acceptance/parameter-import-dts-td035.acceptance.spec.ts`）。
- `PARAM-ADMIN-IA-001`：组织子导航仅「参数定义管理」「模块管理」；定义管理内嵌匹配审核；节点对应嵌套于 specs 且在有任务时出现；旧 `/spec-review`、`/identity-mapping` 重定向并保留 query（单测 `parameterAdminOrganizationPath.test.ts`、`ParameterAdminNextPage.test.tsx`）。
- `PARAM-ADMIN-AUDIT-RECENT-001`：服务端已审计的 Admin 变更后，项目运营最近条带来自 `listAuditEvents` 的投影，不依赖本地 `PUSH_AUDIT_HINT`（单测 `parameterAdminRecentAudits.test.tsx`、`refreshParameterAdminRecentAudits.test.ts`；playwright-cli 证据见 `work/ui-checks/param-admin-audit-recent/`）。
- `PARAM-SPEC-GOVERN-001`：Admin 在 `/parameter-admin` 检索 ingest 后的规格（sc8562/mt5788 两个不同 `gpio_int`），打开详情并决议审核任务（含治理审计）（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-SPEC-EDIT-001`：Admin 在启用态定义上改单位、约束、示例值与说明，保存后再打开，各值往返；删除约束键即删除，清空单位即清空（组件往返测试 `ParameterSpecDetailDialog.test.tsx`、载荷单测 `ParameterSpecDetail.test.ts`；服务端 `specLifecycle.integration.test.ts`）。
- `PARAM-SPEC-EDIT-002`：定义编辑器在 1440×900 / 768×1024 / 390×844 下动作可达（含小泽 FAB 时不被挡住）；打开时焦点进入弹窗，关闭后回到触发器（`ModalDialog.test.tsx`；playwright-cli 证据 `work/ui-checks/param-spec-editor-batch4/`）。mock 无 FAB，层叠由刻度 1100 < 1150 < 1200 闭合。
- `PARAM-SPEC-IDENTITY-001`：管理员在库中纠正一条定义的归属主体，重新打开后声明主体已更新，生命周期与引用数保留，同一属性不会出现第二条定义（组件 `ParameterSpecDetailDialog.test.tsx`；mock/HTTP 接缝；playwright-cli 证据 `work/ui-checks/param-spec-identity/`）。
- `PARAM-SPEC-IDENTITY-002`：零引用定义上提供改属性键，有引用时带明确原因拒绝；与既有定义（含废弃）冲突时展示阻挡方（`ParameterSpecDetailDialog.test.tsx`、`presentError.test.ts`、`mockParameterTopologyRepository.test.ts`；playwright-cli 证据 `work/ui-checks/param-spec-identity/`）。
- `PARAM-TOPOLOGY-BROWSE-001`：在融合 DTS 工作台中切换真实源树/生效树，选择嵌套上下文（`amba` → `i2c@FDF5E000` → `sc8562@6E`），搜索两个 `gpio_int` 语义行，并在成熟详情弹窗查看完整路径、raw 值、shape 和 provenance；topology API 必须 200 且含预期节点（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-TOPOLOGY-EDIT-001`：类型化 drafts 返回 Schema cell-count 诊断、过期 revision 返回 409，并对临时 Config Set 走 fail-closed 编译/工具链校验（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-001`：未解决身份映射阻断 validate（`open-mapping`）；决议后清除阻断并写治理审计（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-IDENTITY-MAP-ADMIN-001`：Admin 在 `/parameter-admin` 决议身份映射任务，并通过受保护 re-resolve 安全更正已应用的选择（含候选证据与治理审计）（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-CONFIG-PUBLISH-GATE-001`：真实工具链 validate 在黄金/候选 Config Set 上成功（status=okay + vendor linux-bindings；不以 schema-failed 冒充成功）；刷新后 bindingId 与 provenance 从 DB 持久（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-GATE-001`：已自动化。结构属性（含 `status`）不产生规格审核任务、不阻塞候选晋级与迁移 finalize；存量结构任务以系统性原因驳回。证据为 disposable 拓扑运行时的 API+DB（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-VISIBLE-001`：已自动化。`/parameters` 工作台（`DtsParameterWorkbench`）在禁用父节点下的参数行显示「所属节点不可达」、在自身禁用节点行显示「所属节点已禁用」。本页不挂载 `TopologyTree`（`aria-label="生效拓扑树"`）；树模型证据为 `GET .../topology?view=effective` 的 `enablement.selfEnabled === false` / `reachable === false`。模块导航无启停徽标；选中带 enablement 的节点时可断言「节点启用」对话框（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-TOGGLE-001`：已自动化。禁用需理由与二次确认；启停草稿持久化并写独立 `enablement-changed` 审计；与 binding 同轮提交不触发 `mixed-working-tips`（API 层证明；工作台同轮会与 `preferredRevision` 重载竞态）（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。
- `PARAM-ENABLE-GUARD-001`：已自动化。非标准 `status = "reserved"` 只读；二级覆盖入口「仍要修改」须显式确认后方可写入（`e2e/acceptance/parameter-topology.acceptance.spec.ts`）。

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
