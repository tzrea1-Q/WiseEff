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
- **TD-069（`DtsReloadPage.tsx` 体积）：** 记录时为 **2188** 行（#304）；拆分延后以免淹没本轮安全/助手漂移修复。**负责人：Frontend / Debugging platform。**
- **TD-070（拓扑工作区测试隔离）：** `ApiProjectTopologyWorkspace.test.tsx` 在 jsdom 中发出真实 HTTP 请求；本机 `127.0.0.1:8787` 有开发 API 时套件不稳定（20 例中 8–9 例被真实数据打挂）。P0 美学提升验证期间发现。应注入可替换的 repository/fetch 接缝,测试不得拨真实端口。**负责人：Frontend。**
- **TD-071（拓扑树元信息文字色）：** `.topology-tree__item small` 把近白的表面令牌 `var(--muted)` 当文字色,树上元信息几乎不可见（既有缺陷,P0 令牌审计浮出）。P1 原语收敛时改为 `var(--text-muted)` 并加结构化样式断言。**负责人：Frontend。**

## 近期关闭项

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
