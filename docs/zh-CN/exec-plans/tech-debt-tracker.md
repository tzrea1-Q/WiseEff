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

- **TD-043（DTS 工具链 UX）：** 参数维护优先程序已将 `dtc` 移出编辑/合入热路径与工作台治理噪声。可选 Admin「完整工具链校验」专用面板尚未建设；`dts:seed:generate` 仍可选用 `synthetic-power-base.dts`。详见英文版 Open 表。
- **TD-038（模块树后续）：** 多层级模块已落地后，仍需删除过渡 `module` 文本列、收敛 `project_modules` 与组织级 `parameter_modules` 单一真相源，并评估 dashboard 热榜的层级聚合。
- **TD-039（项目参数文件，程序主体已关闭）：** DTS 程序与硬化收口已归档。路径派生身份退役由活跃计划 `2026-07-16-parameter-topology-schema-management.md` 承接（语义规格/绑定 + 原子切换）。残余 fallback 仅在 cutover 前存在。
- **TD-040（DTS 配置集/门禁后续）：** (1)(2)(3)(4) 状态见英文版；生产失败关闭 Schema/工具链校验由拓扑计划 Task 8/10/17 承接。
- **TD-042（参数身份 cutover）：** Phase 7、第四轮与第五轮已完成既有语义迁移、状态门禁、不可变 base/candidate 和 fail-closed writeback。**第六轮**补齐 0058 scope、无损手工身份、global authz、完整 valueShape、真实角色 UI/merge、租户 cleanup/test 隔离、跨 origin candidate-less draft 失效和持久 `set|delete`；新增 0063，使 submission 锁定并推进 exact candidate、在 item/request 上持久化其 ID，merge 再次锁定复核。带 marker 的可丢弃库已覆盖实现链路，但它仍是空 legacy 合成库，不是生产近似快照或恢复演练。**缺少合法干净非客户快照与维护窗口**，尚未执行 apply→cutover→整库恢复→旧 API smoke，因此 TD-042 继续为 BLOCKER，不得宣称生产 cutover 就绪。
- **TD-044（节点启停 e2e）：** `PARAM-ENABLE-GATE-001` / `VISIBLE-001` / `TOGGLE-001` / `GUARD-001` 已登记为 skipped stub；产品行为与单测/集成已在 `2026-07-27-dts-node-enablement` 落地。待补齐 Playwright 验收与 operation evidence。详见英文版 Open 表。
- **TD-048（参数定义多版本模型未启用）：** `version` 列唯一且 binding 指向版本行，但激活是就地 UPDATE，实际每个定义只有一行 version=1；mock 却在激活时递增版本，与 API 语义不一致。下一轮决策见 `docs/design-docs/2026-07-30-parameter-governance-deferred-questions.md` D1/D2。
- **TD-049（生命周期排序把 deprecated 与 draft 同等降权）：** 八处排序查询使用 `case when lifecycle = 'active' then 0 else 1 end`，但只有 `draft` 不可发布，软下线后该排序可能让草稿盖过绑定实际使用的已废弃定义。见 D6。
- **TD-050（结构性属性借用了「废弃」）：** 迁移 `0068` 批量废弃 `status` 属性以将节点启停移出定义库（ADR-0003），但「废弃」意为不再推荐、而非「不是定义」。见 D7。
- **TD-051（已 resolved 的节点对应任务无反向回滚）：** `applyReviewedIdentityMapping` 已重写绑定身份且无逆操作，选错逻辑节点只能靠重新上传 DTS 补救。见 D3。
- **TD-052（定义数与实测处数未拆分）：** `aggregateSubtreeParameterCounts` 只上卷单一 `parameterCount`；驱动组直接持有定义后两个事实已分岔，废弃引用数又引入第三个计数。见 D4（承接 ADR-0010 的 out of scope）。
- **TD-053（overlay 停用无接班约束、superseded 无组织侧呈现）：** 停用会直接撤走解析覆盖；被平台晋升后置为 `superseded` 的组织行在其自身治理界面没有定义好的呈现方式。见 D5、D8。
- **TD-056（参数文件版本无法回滚、操作人只有 ID）：** 版本历史已补齐版本号、来源、时间、操作人与逐版本下载（POD-C6），但没有「回滚到该版本」：`ParameterFileRepository` 缺少把某版本设为当前版本的操作；操作人展示的是原始用户 ID，因为端口只带 `createdByUserId`。下一步：在参数文件 API 与端口上补 promote/rollback 版本操作，并把用户 ID 解析成显示名，同轮扩展版本列表。
- **TD-057（项目运营页缺少真实配置修订来源）：** 为落实 POD-C1，`ConfigSetBaselinePanel` 不再校验凭空构造的 `revision-teaching-1`，因此项目运营页暂不提供「校验修订」：该页没有任何地方选择配置修订，mock `getTopology` 也只是回显传入的 revision key。影响：修订门禁（含发布前 `requiresConfirmation` 拦截）只能在参数工作台触发，而不是在真正发布基线的界面。下一步：通过拓扑接缝给配置集视图接入真实修订列表/选择，再按该 ID 恢复门禁入口。
- **TD-059（其余弹窗尚未迁到共享原语）：** `ModalDialog` / `ConfirmDialog`（`src/components/common/`）已承载弹窗契约——焦点陷阱与归还、背景 `inert`、只有最上层响应 Escape、遮罩关闭成对判定、统一 z-index 刻度——但目前只有 `ProjectAdminFormDialog`、`DeleteProjectDialog` 与治理确认框接入，其他参数后台、工作台与调试弹窗仍各自处理 keydown 与遮罩点击。影响：POD-F1–F5 记录的焦点、层叠与关闭故障在未迁移的弹窗上依然存在，并且容易再长出一套偏离契约的实现。下一步：各自按计划迁移，先从 `ParameterSpecDetailDialog`（`2026-08-03-parameter-spec-editor-fidelity.md` 第 19–23 项）开始。
- **TD-062（PCW 壳 stretch 800–1000）：** Wave-3（#273–#278）已满足软门禁（`ProjectConfigurationWorkbench.tsx` = 1496 行）并关闭 #258；stretch 目标 800–1000 仍为残余债。勿重开 #258；下次改壳时再抽 bootstrap effects / MainStage bindings。
- **TD-055（产品作用域策略目标面未建）：** 定义编辑器与 `PATCH /api/v2/parameter-specs/:specId` 已按 SE-D1 移除 `policyTarget` 写入；`parameter_policy_targets` 表与三处只读 join 仍在，但无生产写入。初始化仍优先 `policyTarget ?? schemaDefault`。后续要么建产品作用域治理面，要么用 ADR 正式退役表与读者。
- **TD-033（遗留调试 catalog 表）：** `debugging_parameters` / `debugging_parameter_node_bindings` 仍为审计/历史保留。`parameter_reload_bindings` 已在迁移 `0037` **删除**，不得再写成存活 schema；`/debugging` 参数重载保持产品下线，且与 `/dts-reload`（DTS 重载）不是同一概念。详见英文版 Open 表。
- **TD-063（调试值晋升为库变更请求）：** `/dts-reload` 按 ADR-0019 不回写参数库；已验证的调试值仍需另建治理变更请求。**负责人：Product / Debugging platform。**
- **TD-064（工作台交接至 `/dts-reload`）：** 从参数工作台携带选中 binding 进入重载页被延后。**负责人：Product / Frontend。**
- **TD-065（超出已支持值形态）：** 目前已支持 u32/u8/u16 cell（含 `/bits/ 8`）、单字符串、string list、GPIO 风格 phandle-cells；布尔、empty、裸 phandle list（如 `<&gic>`）、mixed、属性删除仍拒绝。**负责人：Debugging platform。**
- **TD-066（产物保留清理）：** 90 天下载 `410` 门禁之外，对象存储 blob 自动 GC 未建。**负责人：Debugging platform / Ops。**
- **TD-067（多副本桥接路由）：** 桥接 WebSocket 单进程亲和；进程内 DTS 重载部署（ADR-0020）依赖持有 socket 的副本。**负责人：Platform / Reliability。**
- **TD-068（DTS 重载 Agent actorType 信任边界）：** 闸门依赖调用方传入的进程内 `actorType`，非 `AuthContext` 已认证身份；持用户 HTTP token 的 Agent 与人类不可区分（与参数 `SensitiveWriteActorType` 相同）。**负责人：Security / Backend。** 见 `docs/SECURITY.md`（#304）。
- **TD-080（拓扑工作区测试隔离）：** `ApiProjectTopologyWorkspace.test.tsx` 在 jsdom 中发出真实 HTTP 请求；本机 `127.0.0.1:8787` 有开发 API 时套件不稳定（20 例中 8–9 例被真实数据打挂）。P0 美学提升验证期间发现。应注入可替换的 repository/fetch 接缝,测试不得拨真实端口。**负责人：Frontend。**
- **TD-081（拓扑树元信息文字色）：** `.topology-tree__item small` 把近白的表面令牌 `var(--muted)` 当文字色,树上元信息几乎不可见（既有缺陷,P0 令牌审计浮出）。P1 原语收敛时改为 `var(--text-muted)` 并加结构化样式断言。**负责人：Frontend。**
- **TD-084（确认对话框超高不可达）：** `ConfirmDialog`/`ModalDialog` 内容超过视口高度时页脚按钮鼠标不可达（`.governance-confirm-dialog` 无 max-height/overflow）。TD-069 浏览器验证在 1440×900 发现：`/dts-reload` 补偿性恢复部署确认（残留横幅 + 基线值 + Overlay 源码）把确认/取消挤出视口且无滚动；键盘焦点仍可达。属既有缺陷，`main` API 模式同内容可复现。应在共享模态层加 `max-height` + 内部滚动（页脚固定），随美学提升的原语收敛落地，不做逐对话框补丁。**负责人：Frontend / UI primitives。**
- **TD-085（日志分析置信度显示口径）：** LLM 分析器返回模型自估置信度，规则回退沿用确定性查表置信度，二者共用同一 UI 数字，除来源徽标外没有校准语义区分。需按 `analysisSource` 决定显示口径（标注、分档或在效果层评测校准前隐藏 LLM 置信度）。**负责人：Log analysis / Product。**
- **TD-086（域治理错误透出）：** `/log-admin` 域治理的创建/更新失败只弹通用通知；服务端 `INVALID_LOG_FORMAT_PROFILE` 的 Zod 字段级细节没有映射回表单，行内仅有客户端 JSON 预检。需把 API 错误码与校验细节映射为表单行内错误。**负责人：Frontend / Log analysis。**
- **TD-087（selfhost required-keys 纳管 `LOG_ANALYSIS_*`）：** `check-self-hosted-config.ts` 的必填键覆盖 `LOG_ANALYSIS_QUEUE_*` 但不含 P1 LLM 家族（`LOG_ANALYSIS_API_BASE_URL` / `LOG_ANALYSIS_MODEL` / `LOG_ANALYSIS_API_KEY` / `LOG_ANALYSIS_API_TIMEOUT_MS` / `LOG_ANALYSIS_TOKEN_BUDGET` / `LOG_ANALYSIS_DETERMINISTIC`），部署可能通过 `selfhost:check` 却未配置 LLM。需纳入必填键检查（并决定 deterministic 模式是否豁免 API key）与对应测试。**负责人：Ops / Log analysis。**
- **TD-089（确定性 rubric judge 桩过于保守）：** 效果层评测的确定性 judge 桩对 `expectedActions` 的 token 重叠匹配几乎恒 0，把确定性演示分数拉低，可能误导在真模型+真实案例基线建立前对比运行的读者。需校准桩的匹配规则（同义/词干容差或结构化动作匹配）；真模型 judge 路径不受影响。**负责人：Log analysis / Eval。**
- **TD-090（`read_domain_knowledge` 严格限定模式）：** 工具当前把检索严格限定在业务域已关联的知识条目内（无关联时才退化为组织级通用检索）；计划措辞允许"限定或加权"。关联稀疏的域可能漏掉组织级相关知识。若专家反馈严格模式导致检索饥饿，加"关联条目加权 + 组织级补充召回"的融合模式。**负责人：Log analysis / Knowledge platform。**
- **TD-091（小泽悬浮提示遮挡抽屉操作）：** `xiaoze-toggle-hint` 浮层（role=status）在抽屉打开时可拦截底部靠右按钮的点击（如 `/log-admin` 记录抽屉的反馈/导出草稿），P3a 浏览器验证发现，部分视口下真实用户同样受影响。需调整浮层 z-index/位置策略或在抽屉/对话框打开时避让，并加布局断言。**负责人：Frontend / Agent surface。**
- **TD-092（反馈归因粒度）：** `feedback-insights` 把反馈归因到日志**当前 run** 的报告；频繁重析后旧反馈会跟随新结论的来源/提示词版本，按版本的质量读数可能被扭曲。需给 `log_feedback` 加 `run_id`（additive 迁移）与回填策略，存在时按 run 归因。**负责人：Log analysis。**
- **TD-093（上传预检与服务端支持集不一致）：** 前端 API 模式预检接受 `.log/.txt/.csv/.json/.gz/.zip`，但服务端拒绝 `.json`（mock 模式反而支持）；P3a 只追加了归档扩展未动存量口径。用户可能选中通过预检却被服务端拒绝的文件,且 mock/API 行为分叉。需一次性对齐三方口径（决定 `.json` 转正还是移出预检）。**负责人：Log analysis / Frontend。**
- **TD-095（CI 波动：checkpointer 恢复测试与 /logs 视觉基线）：** 2026-08-12/13 并行代理车队期间观察到两类同代码不同结果：(a) `durableCheckpointer.integration.test.ts › resumes an interrupted plan from a fresh agent instance on the same thread` 在同一 commit `f71744bc` 的两次 CI 运行中一红一绿（PR 运行 31621021416 失败、push 运行 31621018056 通过，相隔 3 秒），重跑通过；(b) `/logs` 视觉基线（`e2e/quality/visual.quality.spec.ts`）在 #336 的 merge-ref 运行（31607966985 attempt 1）失败——该 PR 不改任何前端文件、相同前端内容在 `main` 上是绿的——attempt 2 原样通过。同代码运行结果分叉迫使「重跑碰运气」，在繁忙车队里每次合入都排在非确定性门禁后面。下一步：稳定 checkpointer 恢复测试的同步时序；审计 /logs 基线页面的非确定性内容（时间戳/相对时间）并冻结或遮罩。**负责人：Agent platform / QA。**
- **TD-096（仓储测试仍断言 SQL 文本，收敛中）：** 由重复编号的 TD-079 于 2026-08-13 改号而来。slice 1–4 已把 parameters 家族、debugging、jobs、agent、product-feedback、logs 等模块的 fake-db / SQL 文本套件迁到 `createInMemoryTestDatabase()` 行为测试；**slice 5（2026-08-13）收掉 Remaining 清单**：`audit/repository`、`debugging/debugNodeModuleRepository`（后代 `parent_id` 移动语义留给 #418 断言）、`logs/domainsService`、`parameter-files/releaseReadinessService`（7 个仓储级 `vi.mock` 换成真实种子行；validation gate 仍是注入的工具链端口）、`parameter-modules/{ensureAttributionModuleForBinding,resolveModuleForBinding}`、`parameter-specs/driverSchemaOverlayRepository`，全部改为真实行回读 + 双租户隔离 + 过滤诱饵行。仅剩 `dts-reload/deploy.test.ts`，保留给专门切片。详见英文版 Open 表。**负责人：Backend / Testing。**
- **TD-097（HCI Wave 2–3 遗留）：** 信任修复审计的剩余延期范围。**已交付**：权限拒绝页中文化 + 错误话术接缝 + 审计搜索下推/时间窗/CSV 导出（PR #411，计划已完成）；检视阶段的评审批量通过（`feat/hci-review-batching`——复选框列、聚合确认对话框、串行推进 + 单条失败汇总 toast；合入阶段因需逐条合入链接保持单条操作）。**剩余**：术语清洗（中英混排、AI 输出中文化——agent 模块）、macOS 快捷键约定、详情深链、a11y 系统化（对话框之外的焦点管理、landmark/heading 审计）、表格/工具栏响应式收敛、导出中的审计事件类型中文化。需继续切片推进；审批链计划进行期间避免改动 agent 模块的服务端。**负责人：Frontend。**
- **TD-100（HDC 真机验证欠账）：** 审批流浏览器走查已于 2026-08-13 完成（证据 `work/ui-checks/td100/`）：审批卡在聊天打开时正常渲染、批准/拒绝点击可达、带理由拒绝零错误走通，并由新增验收 `XIAOZE-APPROVAL-CARD-001` 自动守护。剩余：批量高风险设备写入仍缺 HDC 真机手工验证（聚合确认、写入/跳过记账）。**负责人：QA。**
- **TD-102（审批执行失败后聊天死路）：** 2026-08-13 实机走查发现：批准后工具执行被服务端拒绝（如工作版本陈旧、overlay 目标不可解析）时，聊天内**没有任何 assistant 失败反馈**——只有 CopilotKit 默认的底部错误横幅（含英文 "Show Details"），服务端原文英文透出；且 interrupt 保持 pending，后续任何消息都报 "Thread has 1 pending interrupt(s) not addressed by resume"，「新对话」按钮也无法逃出，只有整页刷新才能恢复。一次失败的批准 = 该会话的小泽永久瘫痪且用户不知原因。需在 resolve 执行失败时发出聊天内中文失败消息（带原因）、清除或重新呈现 pending interrupt、并让「新对话」真正脱离卡死线程。**负责人：Agent platform。**
- **TD-101（验收覆盖 id 补登）：** 信任修复计划承诺的新验收 requirement id（聊天打开时审批卡可用、草稿移除跨刷新持久、置信度按百分比渲染）只做了既有 spec 适配，覆盖图未扩展。三个信任关键行为没有命名验收 id 守护。需按 UI 交互自动化规则补登到 `e2e/acceptance/` 与覆盖图。**负责人：QA / Frontend。**
- **TD-102（Webhook 至多一次投递语义）：** 结果回调的重试链在进程内（fire-and-forget + in-flight 集合），进程崩溃会丢失当次剩余重试；集成指南已写明 Webhook 是通知通道、REST API 才是事实来源。若真实消费方需要更强保证，把投递落库为 outbox（复用通知 outbox 范式）由 worker 循环排空。**负责人：Log analysis。**
- **TD-103（Webhook 签名密钥明文存储）：** `log_domains.webhook_secret` 明文存库（HMAC 需原文），API 只写不读、响应/审计仅含已配置态与末四位；数据库泄露将允许伪造投递签名。平台具备 KMS/信封加密基础设施后升级静态加密并轮换。**负责人：Security / Log analysis。**
- **TD-104（验收 webServer 冷启动级联超时）：** playwright 验收的 webServer 首次 tsx/vite 编译可把首条用例逼近 90s 超时并级联误报（P3b 验证首轮 9 条假失败,预热重跑全绿）。加 ready 后预热请求（先编译入口路由）或放宽首条用例超时。**负责人：Quality / Acceptance tooling。**
- **TD-105（投递记录无保留策略）：** `log_webhook_deliveries` 每次尝试一行、无清理机制,投递量大的域将无限增长。真实投递量出现后加保留策略（按域保留最近 N 条或按天龄清理,可挂 worker 循环或定时任务）。**负责人：Log analysis / Ops。**

## 近期关闭项

- **TD-098（通知双轨收敛）：** **2026-08-13 关闭**（`feat/hci-notify-convergence`）。收敛为单一 toast 渲染器：`AppToastLayer` 改为无 DOM 桥，把 reducer `state.notifications` 队列逐条倾倒进设计系统 `ToastProvider`（词法推断 tone：失败词汇 → danger/alert、完成词汇 → success、其余 info），并经 `DISMISS_NOTIFICATION` 消费队列。`ToastCard` 增加带 aria-label 的手动关闭按钮（与旧层 a11y 对齐）与 `app-toast` testid；`.app-toast` 样式删除，`.toast-viewport` 本就位于 `--z-toast` 层；视觉门的 `settleAppToasts` 辅助改用 `.toast` 选择器。
- **TD-099（审批层级规则冗余 + jsdom 守卫测试 skip）：** **2026-08-13 关闭**（`feat/hci-trust-followups`）。审批层级收敛为 data 属性选择器一套（`:has` 对），wave-0 的 `.xiaoze-approval-*` 类及组件接线删除，样式测试钉住幸存规则并断言旧类不存在。「jsdom 双渲染」之谜在分发栈探针下瓦解：被 skip 用例的第三段仍在驱动旧手写 backdrop（对话框卡片上 `mouseDown`），观察到的状态翻转其实是它自己点击「继续填写」；改写为 ModalDialog backdrop 的成对 pointer-down/up 并解除 skip（23/23 绿）。
- **TD-069（`DtsReloadPage.tsx` 体积）：** 已于 2026-08-13 经 #372（`refactor/dts-reload-run-session`）关闭——该行自身的关闭条件「拆分分支合入后关闭」已满足。页面 **2,597 → 917** 行（纯渲染层）：调试值校验在 `src/domain/dtsReload/debugValue.ts`（表驱动测试），编排状态机在 `src/application/dts-reload/dtsReloadRunSession.ts`（含确认令牌门控测试），展示辅助在同目录 `dtsReloadPresentation.tsx`，mock `DtsReloadRepository` 适配器恢复 ADR-0002 双运行时一致性。浏览器验证中发现的确认框溢出缺陷仍以 TD-084 跟踪。计划已归档：`docs/exec-plans/completed/2026-08-13-dts-reload-run-session.md`。详见英文版 Completed 表。
- **TD-083（知识检索 pgvector 后装与 CI 向量覆盖）：** 已于 2026-08-13 在 `fix/knowledge-pgvector-td083` 关闭。启动 ensure（`server/modules/knowledge/indexing/vectorEnsure.ts`，在 `server/index.ts` 中先于索引 worker 运行）在 pgvector 后装后自动创建扩展、补 `knowledge_chunks.embedding` 列并全量重建入队（专用 advisory lock，双会话集成测试证明多副本 exactly-once；无扩展服务器静默 no-op，权限拒绝诚实记日志并保持 FTS-only）。CI postgres 服务镜像切换为 `pgvector/pgvector:pg16`（build-and-test 与 acceptance 两个 job），`vectorSearch.integration.test.ts` 与新增 `vectorEnsure` 套件在 CI 真实运行；真正无扩展的环境仍保留带原因跳过。自托管 runbook 英中两版改为「重启自动补装」，手动 SQL 降为参考。详见英文版 Completed 表。
- **TD-088（focused 验收运行缺一等证据校验）：** 已于 2026-08-13 在 `feat/log-analysis-p3a-monitoring-annotation-intake`（P3a）关闭。`check-operation-evidence.ts` 新增一等 focused 模式：`npm run acceptance:evidence -- --run <运行目录> [--require <操作ID列表>]` 校验指定运行目录内的证据记录（司法元数据 + 声明断言必须有对应载荷；`--require` 可强制要求覆盖指定操作），并把 `evidence-check.{md,json}` 写进该运行目录；缺省全量行为与 docs/generated 索引不变。已写入验证矩阵；`scripts/check-operation-evidence.test.ts` 覆盖 focused 用例。详见英文版 Completed 表。
- **TD-058（冲突裁决批量处理与可读版本标签）：** 已于 2026-08-07 经 #235（`feat/project-configuration-workbench-conflict-arbitration`）关闭。冲突列表 DTO 含 `baseValue` 与可读 `fileVersionLabel`；裁决可写 `reason` 进审计；`bulk-preview` / `bulk-resolve` 落地 API/端口/工作台冲突坞并带影响预览；验收 `PROJ-CONFIG-CONFLICT-001`。详见英文版 Completed 表。
- **TD-015（节点调试快照回滚 UI）：** 已于 2026-08-05 在 `feat/node-debugging-ui-closure`（C2）关闭。会话事件 hydrate、回滚 UI 与高风险写确认已落地。详见英文版 Completed 表。
- **TD-060（项目参数初始化）：** 已于 2026-08-05 在 `feat/project-parameter-initialization`（C1）关闭。迁移 `0091` + draft/review API；语义 binding 合并/物化；Port/HTTP/mock；API hydrate + 锁；设计修订告别扁平 `recommendedValue` SSOT。详见英文版 Completed 表。
- **TD-061（参数后台审计提示）：** 已于 2026-08-05 在 `feat/parameter-admin-audit-hints`（C3）关闭。去掉 `PUSH_AUDIT_HINT`；后台最近审计条为 `listAuditEvents` 投影。详见英文版 Completed 表。
- **TD-047（规格 driverModule 身份分裂）：** 已于 2026-08-01 PR2 / D-AG-03 关闭。无物理 `driver_module` 列；新写入一律 `buildSubjectScopedManualSpecIds`；迁移 `0088` 对无法解析主体的身份行 fail-closed；列表筛选改为 `attributionSubjectId`；API `driverModule` 仅作主体展示。
- **TD-054（openapi listPromotionCandidates）：** 已于 2026-08-01 经 #216 关闭。`schemaRegistry` 已登记 `parameterSpecs.listPromotionCandidates`；`openapi.test.ts` 10/10 通过。收口计划已归档至 `docs/exec-plans/completed/2026-08-01-governance-platform-closeout.md`。
- **TD-046（归属放置启发式）：** 已于 2026-08-01 在 `feat/attribution-registration-placement` 关闭（D-AG-04）。迁移 `0089` 增加注册默认业务分类；auto 放置/回放 API；关键词启发式降级为 seed/bootstrap-once。见 `docs/exec-plans/active/2026-08-01-attribution-deferred-implementation.md` PR3。
- **TD-035（参数批导完整 DTS / reviewMetadata）：** 已于 2026-07-15 关闭。计划归档：`docs/exec-plans/completed/2026-07-15-parameter-import-wizard-td035.md`。
- **TD-041（结构化编辑回路）：** 已于 2026-07-15 在 P3.1 关闭。编辑→变更集→`submitStructuredEdits`→既有 CR 审阅合入→CST 回写已打通；回写载荷用 `rawText`。计划归档：`docs/exec-plans/completed/2026-07-14-dts-p31-structured-edit-loop.md`。
- **TD-037（多层级模块）：** 已于 2026-07-09 在 `feat/hierarchical-modules` 分支关闭。参数域与调试域独立模块树、`module_id` 外键、子树筛选、`ModuleTreeSelect` UI 与 MOD-TREE 验收已交付。计划归档：`docs/exec-plans/completed/2026-07-09-wiseeff-hierarchical-modules.md`。
- **TD-045（脚手架模块残留）：** 已于 2026-07-30 在 `feat/attribution-taxonomy-not-topology` 关闭（ADR-0010 / 迁移 `0080`）。脚手架模块离开产品树，binding 重放到组织未分类根。

- **TD-029（小泽 checkpoint 持久化）：** 已于 2026-06-29 关闭。生产/自托管使用 `XIAOZE_CHECKPOINTER=postgres`；证据见 `docs/generated/xiaoze-checkpointer-evidence.md`。详情见英文版 Completed 表。
- **TD-030（小泽聊天历史）：** 已于 2026-06-30 关闭。API 模式通过 `/api/v1/agent/xiaoze/threads` 与 `XiaozeThreadContext` 持久化线程；mock 模式仍用浏览器 localStorage。
- **TD-032（参数调试平台重构）：** 已于 2026-07-01 **被节点调试 pivot 取代**（见英文版 Completed 表与 `docs/exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md`）。原 TD-032 的参数重载 + `/debugging` 恢复方向已退役；`/debugging` 再次隐藏；运行时 catalog 以 `debug_nodes` 为主。勿将「已关闭」读成「参数重载已上线」。
- **TD-036（产品问题反馈）：** 已于 2026-07-08 在 `feat/product-feedback` 分支关闭。侧边栏「问题反馈」已接入 `/api/v1/product-feedback` 持久化、多图片对象存储附件和 `/feedback-admin` Admin 处理页；文档、合同和 schema 覆盖见英文版 Completed 表及本分支提交。

## 同类中文文档

- [docs/zh-CN/exec-plans/development-roadmap.md](development-roadmap.md)
- [docs/zh-CN/exec-plans/tech-debt-tracker.md](tech-debt-tracker.md)
