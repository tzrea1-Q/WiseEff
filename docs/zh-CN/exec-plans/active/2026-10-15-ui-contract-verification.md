# 共享 UI 契约与开发验证闭环

> English: [English](../../../exec-plans/active/2026-10-15-ui-contract-verification.md)
> 状态：基线已冻结；下文记录实施候选检查点；完整 CI、受信诊断激活及效果指标待验收。#1187/#1199 保持开启。
> 归属：[#1187](https://github.com/tzrea1-Q/WiseEff/issues/1187)；基线 [#1188](https://github.com/tzrea1-Q/WiseEff/issues/1188)。观测日期：2026-10-15 UTC。

## 冻结范围与剩余工作

已重新检查 GitHub `main` 为 `68f79c59702d5a914a734c9dd02dc6c7b7ec942e`，包含 [#1186](https://github.com/tzrea1-Q/WiseEff/pull/1186)，其最终 head 为 `edb67dc74edb386088ebd927c084df2b24b156b8`，与合并提交的 tree 相同。这是基线，不授权重置后续工作。已接受方案规定需求；本配对文档只冻结初始清单与测量，不建立新的逐次运行台账。

| 已有能力，必须保留 | 具体剩余缺口 / 归属 |
| --- | --- |
| Radix 单选、共享菜单/筛选样式、带轮廓行按钮；60 处原生下拉迁移及节点编辑合并已交付 | 仍依赖手工弹窗层级参数及调用方知识。#1189 自动归属/尺寸试点，#1190/#1191 兼容迁移，#1192 删除旧接口；不重做 #1186。 |
| API 浏览器一致性已检查下拉对齐、反馈工具栏、顶栏及节点筛选几何 | 在现有场景补真实弹窗点击、Escape/焦点及已有嵌套弹层；不扩成路由 × 主题 × 状态矩阵。#1189–#1192。 |
| 共享交互准备已等待同步横幅消失 | 横幅消失是 CSS 代理，尚非显式加载/就绪/错误契约；等待结束不能证明过渡本身安全。#1193。 |
| 已有影响选择、保守回退、隔离浏览器、阶段计时及基线审核 | 补 CSS/夹具/跨路由依赖，并暴露变更文件实际静态覆盖。#1194/#1196；本地选择仍非 CI 权威。 |
| 现有 lint/UI 棘轮和真实 Merge bar | #1195 拦截已迁移页面重新新增原生下拉；不以语法判断审美，不减少 CI 覆盖。 |
| 不可变脱敏证据及仅含工作流上下文的引导诊断 | #1197 与 #828 协调受信紧凑索引/发布，#1198 接通导航/状态；不向引导诊断复制候选控制的原始文本。 |
| PostgreSQL 会话归属、受控第三克隆及失败清理回归 | 源码复核未发现需要重写数据库的新行为缺口。证据边界如下；只为具体复现扩展。 |

## 消费者归属

冻结 tree 中有 31 个生产 TSX 模块提及 `withinModal`，包含基础组件及转发包装，并非 JSX 调用次数。下表为发现的 SelectControl/DebugAdminSelectControl、RowActionMenu、ModuleTreeSelect、MultiSelectDropdown 及直接 Select 基础组件消费者分配归属。实施时重扫，新发现调用方归所属业务域。文件名指已有模块，不表示新增抽象。

| 归属 | 消费者 / 依赖 |
| --- | --- |
| #1189 共享扩展；#1192 收缩 | common 的 `SelectControl`、`RowActionMenu`、`ModuleTreeSelect`；`MultiSelectDropdown`；UI `select`、`dialog`、`sheet`；common `ModalDialog`；layout `AdminListPage`。Radix Select/Menu portal 与 ModuleTreeSelect 可选 body portal 必须跨 portal 继承归属；MultiSelectDropdown 为内联；ModalDialog 也 portal 至 body。保留关闭、背景 inert、焦点和滚动行为。 |
| #1190 根页面/账户/初始化 | `App`、`NodeDebuggingPage`、`UserPermissionsPage`、`ProjectParameterInitializationWizard`。项目初始化归此票，参数导入归 #1191。 |
| #1190 管理页与包装 | admin 的 `AuditWorkspace`、`CreateDebugParameterDialog`、`DebugAdminSelectControl`（别名）、`DebugModuleManagementDialog`、`DebugModuleMoveDialog`、`DebugNodeEditorDialog`、`DebugParameterBindingsDialog`、`DebugParameterDefinitionDialog`、`DebugParameterLibraryTable`、`LibrarySelectFilter`、`ModuleDefinitionForm`、`ModuleManagementRowActions`、`ModuleManagementTreeRows`、`ProjectAdminFormDialog`、`ReloadConfigurationAdminPanel`。转发包装在两批完成前保持兼容。 |
| #1190 日志/反馈 | `LogsPage`、`FeedbackAdminDrawer`、`FeedbackAdminPage`、`FeedbackDialog`。 |
| #1191 参数/治理 | `ParametersPage`；Catalog 的 `CatalogPage`；governance 的 `DefinitionEditorBody`、`ProposalPanel`、`PublicationDialog`、`RegistrationDialog`、`ReviewResolutionDialog`；review 的 `CanonicalBatchSubmitDialog`、`CanonicalMemberRemovalSubmitDialog`、`ReviewInbox`；parameter-home 的 `AnalysisContextControls`（直接 UI Select）。 |
| #1191 导入/拓扑 | Import 的 `ImportReviewCard`、`steps/StepSourceAndProject`；topology 的 `DtsBindingCompareDialog`、`DtsBindingDraftTray`、`DtsNodeEnablementDialog`、`ModuleAttributionTree`、`ModuleMoveDialog`、`ValueShapeFields`；parameter-admin-next 的 `CanonicalSubjectPlacementPanel`；`DtsReloadPage`。 |
| #1191 配置工作台 | `ProjectConfigurationWorkbench`、`WorkbenchCandidateActivateDialog`、`WorkbenchCanonicalConflictDecision`、`WorkbenchCanonicalManualSyncDialog`、`WorkbenchCommandBar`、`WorkbenchInspectorPanel`、`WorkbenchRevisionGate`、`WorkbenchSourceRollbackDialog`、`WorkbenchSourceTree`。 |

样式/DOM 依赖随迁移处理：共享 `select-control.css`、`row-action-menu.css`、全局/pilot 样式、`data-slot="select-trigger"`、`.dropdown-trigger`、`.row-action-menu` 及旧 modal 类。#1192 最终删除共享废弃选择器；业务票先更新自己的消费者，不破坏另一批。

现有夹具/测试归属：

- #1189/#1192：common SelectControl/RowActionMenu/ModuleTreeSelect/MultiSelectDropdown/selectionMenus、`compactControls`、共享一致性样式测试；quality 一致性采集器及可访问性/视觉/紧凑场景。复用夹具和阶段计时。
- #1190：初始化向导、管理模块样式、行操作、项目表布局、日志上传/主操作夹具；debugging-admin/simulator、日志和通知验收。样式夹具必须加载共享 CSS；键盘辅助在继续前关闭菜单。
- #1191：参数导入源/审核夹具；parameter-home、parameters、DTS 导入/向导验收及配置工作台场景；保留跨路由和角色流程。
- #1193：共享 `prepareInteractionSurface` 及所有现有导航/刷新消费者（debugging-admin/simulator、日志、通知、parameter-home、parameters、DTS 导入及导入向导）；有意测试加载/错误的用例分开。Quality 就绪辅助是应检查的兄弟消费者，不授权用统一等待替换其业务就绪。
- #1196：影响/浏览器映射及隔离运行器；`quality-consistency`/视觉掩码 scripts 测试和用户指南截图依赖共享 DOM/quality 行为。UI/CI 策略不变。

## 冻结 CI 观测

沿用方案定义：`T_green` 为创建至真实必需 Merge bar 及任务要求的作业/产物成功；`T_exec` 从首个必需作业开始；`R_total` 累加所有 attempt 的非跳过作业执行时间，含失败/取消。并行重叠是计算成本，不能称为墙钟时间。下列运行均为 attempt 1、`ubuntu-latest` 标签。未知缓存/镜像保持未知，不能据此声称冷/热匹配。

| 分组 / run | Head | 结果 | 初始排队 / T_exec / T_green（秒） | R_total（作业秒） |
| --- | --- | --- | --- | --- |
| Full-acceptance PR [38710188830](https://github.com/tzrea1-Q/WiseEff/actions/runs/38710188830) | `edb67dc74edb` | 成功 | 2 / 1300 / 1302 | 8659 |
| 普通 PR [38668145955](https://github.com/tzrea1-Q/WiseEff/actions/runs/38668145955) | `0184fee20355` | 成功 | 3 / 670 / 673 | 4165 |
| Main [38675798011](https://github.com/tzrea1-Q/WiseEff/actions/runs/38675798011) | `3b399cb2361c` | 成功 | 3 / 1109 / 1112 | 8388 |
| 当前 main [38713055282](https://github.com/tzrea1-Q/WiseEff/actions/runs/38713055282) | `68f79c59702d` | 失败 | 2 / 至失败门禁 1326 / 不可用 | 8477 |
| 较早普通 PR [38664065226](https://github.com/tzrea1-Q/WiseEff/actions/runs/38664065226) | `e391fd9cc787` | 成功，调度变更参考 | 3 / 809 / 812 | 4524 |
| 较早 main [38659845353](https://github.com/tzrea1-Q/WiseEff/actions/runs/38659845353) | `1cff8a639139` | 成功，质量均衡前 | 3 / 1209 / 1212 | 8201 |
| 较早 nightly [38618073666](https://github.com/tzrea1-Q/WiseEff/actions/runs/38618073666) | `88136adda68f` | 成功，后端/质量均衡前 | 4 / 1279 / 1283 | 8910 |

前三项是候选参考，不能混合：普通 PR 跳过原生 L2 workers；full PR/main 执行四个原生分片、两个后端分片、四条 quality lane，以及 smoke/L1 和必需汇总。Minimal-upgrade、target-host 跳过，不构成验证。#1186 增加了源码/测试清单。成功 full PR 的 base 为 `3b399cb2361c365b57842bdeb28de68e17219625`；当前 main 第一父提交为该 base，第二父提交为 PR 最终 head。较早调度变更不能与当前拓扑混合。当前拓扑参考数：普通 PR 1、full PR 1、main 1、nightly 0；冷/热及精确选择清单仍需匹配。不成立描述性中位数（至少 5）或 P95（两侧各至少 20）。

有限日志证实 full PR 的关键原生分片 3、当前 main 的失败原生分片 1 均有 npm、DTS-toolchain 和 Playwright Chromium 1.59.1 **缓存命中**。其他 workers、lint 缓存及较早记录未分类，局部观测不能将全 run 称为热缓存。复取 Actions run/jobs API（`per_page=100`），保留 run/attempt/head、作业标签及全部步骤时间戳，累计前检查 attempt 数。实施 PR 补记其他缓存命中/未命中、runner 镜像及原生 receipt/选择清单；不能因安装快而推断热缓存。Quality 报告已有 navigation/readiness/axe/capture 附件，本票未下载或声称其内部阶段总数。本次冻结未取大产物，也未触发新 CI。

### 准备、执行与收尾参考

Full PR 38710188830 创建于 09:04:00Z；Detect 09:04:02Z 开始；关键原生分片 3 于 09:04:50Z 开始、09:25:18Z 完成；Merge bar 于 09:25:42Z 完成。工作流元数据终态更新为 09:25:43Z（1303 秒），不同于 `T_green` 1302 秒。关键分片：至 Gate0 开始的准备 83 秒；受管 Gate0 1119 秒（含其运行时准备）；安全检查/最终封装 15 秒；完整上传 5 秒；诊断发布/结算 1 秒；余下 post/清理/终态区间 5 秒。分片完成至 Merge bar 的 24 秒含汇总/排队，非测试执行。后续作业的排队已包含墙钟，本票不声称独立测得全舰队排队。

Quality gate 步骤按 visual / accessibility / consistency-1 / consistency-2 为 **228 / 422 / 448 / 704 秒**。依赖安装 20/26/14/26 秒，Chromium 安装 10/13/11/13 秒，迁移/种子 61/64/55/64 秒，证据上传 2/1/2/4 秒。Static/build 作业：build 71 秒、UI 棘轮 1 秒、lint 43 秒。这些步骤区间并非仅浏览器测试时间；≤30 秒子预算应使用已有阶段报告。以上都是历史单点，不是性能承诺。

### 失败、取消与交付成本

#1186 从 07:36:44Z 进入 CI 至 09:25:42Z 成功，计 **6538 秒**。7 个逻辑运行各 1 attempt，共 **36935 作业秒**，含四次取消的 **10826 作业秒**。最终成功仅占 8659 作业秒，两次失败占 17450 作业秒。保留成本，不能仅报告最后一次成功。墙钟区间重叠，不应相加。Actions 无法测得用户决策等待与主动/本地工作的拆分，本票保持未知。

| 较早 run | 结果 | R_total（作业秒） |
| --- | --- | --- |
| [38699919019](https://github.com/tzrea1-Q/WiseEff/actions/runs/38699919019) | 取消 | 59 |
| [38699920829](https://github.com/tzrea1-Q/WiseEff/actions/runs/38699920829) | 取消 | 392 |
| [38700106097](https://github.com/tzrea1-Q/WiseEff/actions/runs/38700106097) | 取消 | 9163 |
| [38702320985](https://github.com/tzrea1-Q/WiseEff/actions/runs/38702320985) | 取消 | 1212 |
| [38702778746](https://github.com/tzrea1-Q/WiseEff/actions/runs/38702778746) | 失败 | 8507 |
| [38706323333](https://github.com/tzrea1-Q/WiseEff/actions/runs/38706323333) | 失败 | 8943 |

当前 main 失败是独立、有限的证据：[job 116349220710](https://github.com/tzrea1-Q/WiseEff/actions/runs/38713055282/job/116349220710) 为原生分片 1/4，canonical-dashboard 用例 “counts active bindings and follows draft, rejection, approval and deletion” 在 `toHaveURL` 断言失败。第二条清单为浏览器命令失败的传播，不是独立第二缺陷。L1、quality 成功，原生汇总和 Merge bar 失败。缺少受控复现/trace，产品还是测试原因仍为 **unknown**；不能证明是新的就绪缺陷、偶发误报或健康 main。未进行无关修复或重跑。#1199 保留风险并排除成功统计。

## 保留数据库证据

当前 `server/testing/testDatabase.test.ts` 使用唯一 `PGAPPNAME` 限定 advisory lock 观测归属，持有合法第三个真实克隆并检查回调归属，用 `Promise.race` 传播就绪失败，并在 `Promise.allSettled` 清理前释放两个 gate。独占克隆的独立用例验证回调/连接准备失败的清理；锁辅助已有受控借用 lease/竞争者用例。保留已交付断言；错误的“全局不存在锁”假设不是新的产品锁缺陷。

#1186 最终 CI 后端分片 2 成功；此前本地报告记录 32 个 PostgreSQL 测试。这些均为 **历史通过**。本票只检查当前源码及 CI 元数据，未重跑 PostgreSQL，也不声称新数据库/浏览器验收。复核触及的用例/辅助未发现已证实的额外归属缺口。后续具体复现可支持窄范围扩展；没有新运行不等于新通过。

## 统一累计预算与报告契约

| 指标 | 全专项固定上限 |
| --- | --- |
| 匹配 T_green 中位数 | 增幅 ≤5% **且** ≤60 秒；描述性比较需至少 5 次成功 |
| 匹配 T_green P95 | 增幅 ≤10% **且** ≤120 秒；两侧各 ≥20 次；采用 nearest rank `ceil(0.95 × n)` |
| 全覆盖 R_total 中位数 | 增幅 ≤5%；另列失败/替换成本 |
| 新增浏览器 / 静态工作 | 既有受影响 quality lane 的浏览器执行 ≤30 秒；既有作业的 static/scripts 执行 ≤10 秒 |
| 安全失败索引 | 每个失败分片本地处理 ≤5 秒且 ≤256 KiB；保留受信发布限制 |

各票对比同一冻结 profile 的累计净开销，不以前票增加后的额度复利。复用正常候选 CI、热场景和现有报告，在 PR 记录匹配阶段差值及额外本地验证时间；元数据/日志读取不增加 CI 作业和 runner 秒。本票未执行测试。**全专项** 至多一次专门 base/head 全量成对比较，本票未使用。沿正常运行采样，不开展采样重跑。缓存/清单/拓扑未知或样本不足时为 provisional/observation-pending；不得声称统计预算达标或豁免。保留必需检查、断言、重试/超时、清理和逐图人工批准。

在已有实施 PR/报告分列三个独立状态：**effect-approved**（具体人工批准）、**affected-regression-complete**（实际命令/数量及缺失证据）、**merge-ready**（当前 head 的必需检查/产物/审查）。效果批准不是合入证据；实施已合并不是指标完成。#1199 负责正常运行的质量/效果窗口，单列未解决 main 验收。不新增批准服务或逐次证据台账。

## 实施效果检查点 — 2026-10-15

#1188–#1198 已在 integration 分支形成候选源码实现，本检查点之前为 `f686ee0f9da7ff8dc547f55d8138c87945dacbfc`。控件自动推断弹层归属，消费者不再传入废弃参数，就绪显式且按域独立，正常入口检查实际变更文件覆盖。紧凑索引与导航（#1197/#1198）已有实现；accepted-base 受信发布/激活及两分钟正向可用性仍为 **pending**。这不表示完整方案已验收；必需效果证据不足时，#1199 与父 #1187 必须保持开启。

| 指标 / 防护 | 原始实施前 → 候选观测 | 验收状态 / 最小后续动作 |
| --- | --- | --- |
| Full PR T_green / R_total | 冻结 1302 秒 / 8659 作业秒，历史单点 → 尚无完整候选 CI | `observation-pending`；对审查后的最终候选正常运行一次 CI，在 PR 记录真实必需门禁/产物，再累积可比自然样本。 |
| 普通 PR / main / nightly 统计 | 冻结参考数 1 / 1 / 0，缓存/清单尚未匹配 → 无新增应用覆盖成功样本 | 无匹配中位数/P95。纯文档 [run 38723428695](https://github.com/tzrea1-Q/WiseEff/actions/runs/38723428695) attempt 1 成本 115 作业秒（6 执行/9 跳过），门禁墙钟 97 秒（元数据更新 98 秒）；应用/后端/浏览器跳过，保留交付成本但不能填充这些分组。 |
| 新节点质量防护 | 相同路由/主题：命令 14.169 秒 → 15.341 秒；不含 warmup 的用例执行 6.003 秒 → 7.941 秒（+1.938 秒） | 仅暂定本地子预算证据，不是 lane/CI 验收。最终契约检查 3 通过/14.4 秒（warmup 2.6、light 4.0、dark 4.3 秒）。 |
| 实际新增静态/UI 防护 | `22ba53d7` 安静环境的 89 文件检查 8.076 秒；UI 棘轮 0.547 秒 → 1.065 秒（+0.518 秒）；暂定合计 8.594 秒 | 对 ≤10 秒的有界本地诊断观测；之后清单增长，最终范围/Hosted 成本仍待检查，不按票复利额度。 |
| 完整原生命令无缓存 lint | 基线 16.03 秒 → 候选 28.016 秒（原始 +11.986 秒） | 暂定观测，不能证明整体 CI 预算达标。保留原生工作，在正常 CI 匹配最终清单/profile。 |
| 资源竞争的测量成本 | 与 API 并行时总计 53.31 秒 / helper 18.879 秒；原生 lint 阶段本身约 34.43 秒，并观察到约 10.4 GiB swap | 因已观察到竞争排除匹配延迟比较，仍保留为额外本地测量成本；未创建 CI 采样运行。 |
| 就绪 / 反馈 / 导入 API | 新 pointer/加载/错误/重试回归 3.017 秒，加 warmup 1.877 秒，命令 34.449 秒；既有反馈 2 通过/21.138 秒；导入 2 通过/32.461 秒 | 真实隔离本地 API 证据。新指针用例穿过完成时刻，严格诊断保留；不构成 Hosted/设备验证。 |
| 真实隔离选测入口 | `8ab465af` 的 UserPermissionsPage 选择：静态 1.898 秒；quality 61 通过，含准备/种子/收尾 162.946 秒；acceptance 43 通过、4 跳过，111.101 秒 | 仅选定源码。四个密码能力用例及 macOS 下 Linux visual 明确跳过。全分支仍保留两个 full-fallback 标志，不替代全分支验收。 |
| 安全索引成本 / 激活 | ≤256 KiB 及失败/拒绝契约已有聚焦 scripts 检查；尚无激活的 accepted-base 发布测量 | ≤5 秒处理及两分钟导航效果待合法受信发布；不提升候选控制的诊断为受信证据。 |
| 首轮全量成功率 / 修复循环 | 一个历史 #1186 交付，7 次运行；当前正常全量候选交付 0 | 不足 ≥20 个交付窗口；≥80% 成功率 / ≤0.3 次已确认 harness 修复循环及改善比较均待观测。 |

补充有限基线日志确认 full PR 静态作业 116339697048 使用 Ubuntu 24.04 镜像 `20261004.327.1`，npm 与 ESLint 均为主缓存键命中。候选 ESLint 配置改变缓存键，因此应读取实际 CI 日志确认缓存 profile，不能假设可比；未触发专门基线成对运行。

长标签 API 检查在 **PR 全量 CI 前检出了产品焦点缺陷**：依赖数据异步加载导致触发器在 Radix 焦点归还前禁用（本地 2 失败/1 通过，命令 33.2 秒）。共享延后焦点归还修复保留用户主动移动的焦点，无逐调用方 busy 补丁。最终 light/dark 截图已按 1440×900 检查。这是源码防护证据，不是 CI-only 缺陷或已确认 harness flake。此前新增就绪用例曾因测试定位不唯一、故意传输故障未声明而失败；已改为精确声明的 GET/503，不放宽诊断。这些本地尝试保留成本，不能据此断言统计误报。

当前 main 验收仍为冻结 `68f79c5` 的 run 38713055282 失败，根因 unknown；PR/draft 或部分本地成功不能改变该状态。独立审查、最终 build 与最终 head CI 在本检查点仍为协调者负责的待补证据。没有生产/设备执行；不可用本地 Bridge 只验证了无设备降级。并行 worker 的本地验证总时间未完整采集：在现有 PR/报告保留可获得原始时长，明确总数缺失，不能相加重叠命令墙钟作为交付耗时。

小型纯函数 `ci-outcomes` scripts 辅助只对输入观测作算术：累加所有作业 attempt（含失败/取消），缺失/非法时间保持未知，按事件/覆盖/runner/拓扑/缓存分组，两侧均满足 5/20 样本门槛才比较。P95 使用冻结 nearest-rank，偶数中位数取中间两项均值。分组信息未知时不比较；成本缺失使 R_total 汇总及其中位比较为空，不记为零。辅助不采集运行，也不授予验收；固定输入测试不是实际 CI 样本。未新增采集器、看板、CLI、逐次台账、benchmark 流水线或采样活动。全专项专门全量 CI 成对比较额度未使用。

最终源码审查后的自然 CI 观测记录在实施 PR/报告，不为把运行编号提交进本冻结检查点而再次滚动 CI。预算超限应在保持清单的前提下减少重复或优化调度，不能放宽阈值、断言、重试/超时或覆盖。

## 文档影响矩阵

| 文档 | 影响 / 归属 |
| --- | --- |
| 本英中计划配对及 Plans 索引 | #1188 冻结范围、归属、观测和共同预算；#1199 增加效果汇总，不改写历史结果。 |
| 英中前端指南、UI 检查表 | #1189/#1192 更新组件契约/示例，#1193 更新就绪；保留 PC/API 义务。 |
| 英中验证矩阵、贡献/工作流指南 | #1194/#1196 更新覆盖/选择用法；#1198 更新状态/诊断导航；保留 #828 受信边界及 shadow 禁用策略。 |

## 文档更新门禁

英中配对同步维护，提交前检查相对链接和现有文档治理。本文档基线不要求应用 build、浏览器、新 PostgreSQL 运行、新工作流或镜像文案的测试。#1188 在源码清单、运行身份、未知项及固定预算已记录并检查后可解锁前沿，不要求制造 5/20 个样本。实施和效果指标仍为独立待验收状态。
