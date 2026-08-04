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
- **TD-055（产品作用域策略目标面未建）：** 定义编辑器与 `PATCH /api/v2/parameter-specs/:specId` 已按 SE-D1 移除 `policyTarget` 写入；`parameter_policy_targets` 表与三处只读 join 仍在，但无生产写入。初始化仍优先 `policyTarget ?? schemaDefault`。后续要么建产品作用域治理面，要么用 ADR 正式退役表与读者。

## 近期关闭项

- **TD-047（规格 driverModule 身份分裂）：** 已于 2026-08-01 PR2 / D-AG-03 关闭。无物理 `driver_module` 列；新写入一律 `buildSubjectScopedManualSpecIds`；迁移 `0088` 对无法解析主体的身份行 fail-closed；列表筛选改为 `attributionSubjectId`；API `driverModule` 仅作主体展示。
- **TD-054（openapi listPromotionCandidates）：** 已于 2026-08-01 经 #216 关闭。`schemaRegistry` 已登记 `parameterSpecs.listPromotionCandidates`；`openapi.test.ts` 10/10 通过。收口计划已归档至 `docs/exec-plans/completed/2026-08-01-governance-platform-closeout.md`。
- **TD-046（归属放置启发式）：** 已于 2026-08-01 在 `feat/attribution-registration-placement` 关闭（D-AG-04）。迁移 `0089` 增加注册默认业务分类；auto 放置/回放 API；关键词启发式降级为 seed/bootstrap-once。见 `docs/exec-plans/active/2026-08-01-attribution-deferred-implementation.md` PR3。
- **TD-035（参数批导完整 DTS / reviewMetadata）：** 已于 2026-07-15 关闭。计划归档：`docs/exec-plans/completed/2026-07-15-parameter-import-wizard-td035.md`。
- **TD-041（结构化编辑回路）：** 已于 2026-07-15 在 P3.1 关闭。编辑→变更集→`submitStructuredEdits`→既有 CR 审阅合入→CST 回写已打通；回写载荷用 `rawText`。计划归档：`docs/exec-plans/completed/2026-07-14-dts-p31-structured-edit-loop.md`。
- **TD-037（多层级模块）：** 已于 2026-07-09 在 `feat/hierarchical-modules` 分支关闭。参数域与调试域独立模块树、`module_id` 外键、子树筛选、`ModuleTreeSelect` UI 与 MOD-TREE 验收已交付。计划归档：`docs/exec-plans/completed/2026-07-09-wiseeff-hierarchical-modules.md`。
- **TD-045（脚手架模块残留）：** 已于 2026-07-30 在 `feat/attribution-taxonomy-not-topology` 关闭（ADR-0010 / 迁移 `0080`）。脚手架模块离开产品树，binding 重放到组织未分类根。

- **TD-029（小泽 checkpoint 持久化）：** 已于 2026-06-29 关闭。生产/自托管使用 `XIAOZE_CHECKPOINTER=postgres`；证据见 `docs/generated/xiaoze-checkpointer-evidence.md`。详情见英文版 Completed 表。
- **TD-030（小泽聊天历史）：** 已于 2026-06-30 关闭。API 模式通过 `/api/v1/agent/xiaoze/threads` 与 `XiaozeThreadContext` 持久化线程；mock 模式仍用浏览器 localStorage。
- **TD-032（参数调试平台重构）：** 已于 2026-07-01 关闭。完成节点/重载绑定拆分、reload 运行时、Admin 分 Tab 与 `/debugging` 恢复。详情见英文版 Completed 表。
- **TD-036（产品问题反馈）：** 已于 2026-07-08 在 `feat/product-feedback` 分支关闭。侧边栏「问题反馈」已接入 `/api/v1/product-feedback` 持久化、多图片对象存储附件和 `/feedback-admin` Admin 处理页；文档、合同和 schema 覆盖见英文版 Completed 表及本分支提交。

## 同类中文文档

- [docs/zh-CN/exec-plans/development-roadmap.md](development-roadmap.md)
- [docs/zh-CN/exec-plans/tech-debt-tracker.md](tech-debt-tracker.md)
