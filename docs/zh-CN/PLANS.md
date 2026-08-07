# 执行计划治理

> English: [English](../PLANS.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- `exec-plans/active/2026-08-07-project-configuration-workbench-source-nav.md`：Issue #229 源码定位 DTS 导航——结构 span、统一搜索、URL 深链与工作台源码同步（分支 `feat/project-configuration-workbench-source-nav`）。
- `exec-plans/completed/2026-08-06-project-configuration-workbench-readonly.md`：Issue #228 Phase 1 只读 tracer——开发开关后的规范路由、确定性配置集上下文、成员/未编组源码树、经既有 ports 加载活跃源码，以及源码主导响应式外壳（分支 `feat/project-configuration-workbench-readonly`）。
- 当前活跃计划清单以英文版 `docs/PLANS.md` 为准。`2026-07-16-parameter-topology-round4-review-blockers.md` 为第四轮 Review 阻断修复：真实 dt-validate schema、可运维 stage→finalize、精确锁定 merge 回写、matcher/review 作用域、manifest 门禁、全局规格 hotspot、未匹配创建+不匹配审计、acceptance/浏览器证据（分支 `fix/parameter-topology-round4-review-blockers`）。`2026-07-16-parameter-topology-round5-review-blockers.md` 为第五轮：不可变 base binding、真 fail-closed writeback、stage/finalize phase 审计、租户 resolve、createSpec 草稿→激活、acceptance fixture 诚实化（分支 `fix/parameter-topology-round5-review-blockers`）。TD-042 仍为 BLOCKER。
- `exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md`：第六轮 Review 阻断——历史 scope 校正、无损规格 ID、全局规格激活权限、完整 valueShape、真实 merge 验收、cleanup 租户隔离、稳定 test:all（分支 `fix/parameter-topology-round6-review-blockers`）。TD-042 仍为 BLOCKER。
- `exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`：以成熟参数工作台重新承载 API 模式参数页面，深度融合嵌套 DTS 拓扑、语义 binding 行、来源链、类型化草稿、响应式 UX 和可见验收，不恢复扁平身份。
- `exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`：产品边界纠偏——可管参数面、模块→参数 UX、维护项目 DTS、工具链 L2 离开编辑热路径（见 RFC 与裁剪矩阵；中文摘要 `docs/zh-CN/exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`）。
- `exec-plans/active/2026-07-23-local-post-cutover-seed.md`：本地 `db:seed:m1` / `dev:all` 默认语义-only + 本地 post-cutover，typed binding 可提交审核（分支 `feat/local-post-cutover-seed`）。
- `exec-plans/active/2026-07-23-local-demo-credentials-seed.md`：仅 development 下 M0 为 ChargeLab 演示账号写入固定 username + 共用密码（分支 `feat/local-demo-credentials-seed`）。
- `exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`：退役平台合成基 `wiseeff-power-base.dts`；seed/写回 = 每项目一份项目主 DTS；管理员只维护模块↔驱动（见 RFC；中文摘要 `docs/zh-CN/exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`）。
- `exec-plans/active/2026-07-21-instance-submodule-seed.md`：Type U/N/C 实例子模块 + 驱动组；ingest ensure；未映射驱动 Admin 发现队列（中文摘要 `docs/zh-CN/exec-plans/active/2026-07-21-instance-submodule-seed.md`）。
- `exec-plans/active/2026-07-27-module-attribution-redesign.md`：模块归属重构 —— 模块显式声明 kind/origin 取代名字猜测、废除失效的 driver 匹配、待归类队列可过滤可忽略因而能清空、规则先预览再按范围应用并回收空桶、操作按 kind 分级、重要性由业务分类继承（分支 `feat/module-attribution-model` 与 `feat/module-attribution-ui`；ADR-0004、ADR-0005；中文对照 `docs/zh-CN/exec-plans/active/2026-07-27-module-attribution-redesign.md`）。
- `exec-plans/active/2026-07-30-attribution-tree-is-taxonomy-not-topology.md`：归属树是分类学而非拓扑 —— 废除每实例模块、将 `logical` 更名为 `node-type`、杠杆改为 `compatible` 与 `node-type`、绑定只挂在驱动组与节点类型单元、定义库陈述 `attributionModules` 而非预测、工作台启用 `groupByDevice` 做按实例浏览（分支 `feat/attribution-taxonomy-not-topology`；ADR-0010；部分取代 ADR-0004/0005/0006）。
- `exec-plans/active/2026-07-30-attribution-subjects-and-versioned-specs.md`：归属主体 + 版本化参数定义 —— PR0–PR6 已落地（ADR-0013/0014）；follow-up 与治理 PR 经 #212–#215 合入；收口 #216 已完成；D-AG-* 实现见 `2026-08-01-attribution-deferred-implementation.md`。
- `exec-plans/active/2026-08-01-attribution-deferred-implementation.md`：交付已锁定的 D-AG-01–04 —— PR1 可编辑 nature/cardinality + overlay-only claim；PR2 删除 `driverModule`（TD-047）；PR3 按注册默认分类放置 + auto 回放（TD-046）；中文摘要同路径 zh-CN。
- `exec-plans/active/2026-08-02-parameter-admin-ux-polish.md`：参数管理后台 UX 打磨 —— 修复桌面列宽规则泄漏导致的移动端项目清单破损、把归属筛选移到它所筛选的列、修结构浏览层叠故障、补齐 tab 与表格 ARIA，随后统一四个项目 tab 的容器与空态语言并给项目清单加治理信号（分支 `feat/parameter-admin-ux-polish`；不越出 ADR-0001）；中文摘要同路径 zh-CN。
- `exec-plans/active/2026-08-03-parameter-admin-org-ia-consolidation.md`：组织配置收敛为两入口 —— 参数定义管理（库内嵌定义匹配审核；节点对应确认嵌套且条件出现）与模块管理（不变）；仅规划；分支 `feat/parameter-admin-org-ia`；ADR-0015；中文摘要同路径 zh-CN。
- `exec-plans/active/2026-08-03-parameter-spec-editor-fidelity.md`：让参数定义编辑器与写入契约一致 —— 落库或移除 API 静默丢弃的编辑（策略目标、删除约束键、清空单位、激活路径），删掉只能是占位的字段，给 JSON 编辑框真实的可供性，并修复模态层叠、滚动边界与焦点处理；SE-D1 至 SE-D6 已于 2026-08-03 定案；分支 `feat/parameter-spec-editor-fidelity`；中文摘要同路径 zh-CN。
- `exec-plans/active/2026-08-05-path-reachable-mock-gap-program.md`：A+1 纲领 —— 关闭参数管理/调试中路径可达的仅 mock 与半通缺口，经 C4→C2→C3→C1 四子计划；排除 `/debugging`、reload 410、对比页 NoEntry；中文摘要同路径 zh-CN。
- `exec-plans/active/2026-08-05-mock-honesty-and-dead-residual-cleanup.md`：C4 —— mock 导入诚实 apply、删除死残件 `AI_FEEDBACK`、清理孤儿 reload-bindings 契约；分支 `feat/mock-honesty-dead-residual-cleanup`。
- `exec-plans/active/2026-08-05-node-debugging-ui-closure.md`：C2 —— `/node-debugging` 快照回滚 UI、会话事件 hydrate、高风险写确认；关闭 **TD-015**；分支 `feat/node-debugging-ui-closure`。
- `exec-plans/active/2026-08-05-parameter-admin-audit-hints.md`：C3 —— 本地 `PUSH_AUDIT_HINT` 改为审计中心投影并补齐服务端审计；跟踪 **TD-061**；分支 `feat/parameter-admin-audit-hints`。
- `exec-plans/active/2026-08-05-project-parameter-initialization.md`：C1 —— 语义化项目参数初始化落地（先修订五月设计，再 schema/API/UI）；跟踪 **TD-060**；分支 `feat/project-parameter-initialization`。
- `exec-plans/completed/2026-08-05-project-operations-modal-restore.md`：产品覆盖 POD-D1 —— 在共享 `ModalDialog` 硬化成果之上恢复盖在清单上的深链项目运营弹窗；ADR-0001 修订为「路由可寻址」不等于「只能整页」。
- `exec-plans/completed/2026-08-05-project-operations-dialog-hardening.md`：项目运营界面加固已于 2026-08-05 在 `feat/project-operations-dialog-hardening` 完成 —— **POD-D1 曾把四个视图临时还原为整页路由**；共享 `ModalDialog` / `ConfirmDialog` 原语（焦点陷阱、焦点归还、背景惰性化、仅最顶层响应 Escape、遮罩关闭成对判定、统一 z-index 刻度）已交付，并继续作为剩余弹窗与 `2026-08-03-parameter-spec-editor-fidelity.md` 第 19–23 项的契约；`StructuredValueEditor` 补齐样式；发布/回滚基线、移除成员与冲突裁决均需确认，`requiresConfirmation` 会真正拦截；教学资产与裸内部值已从四个视图移除。未交付范围转入 TD-056 – TD-059。呈现已由 `2026-08-05-project-operations-modal-restore.md` 恢复为深链弹窗；英文对照同路径。
- `exec-plans/completed/2026-08-01-governance-platform-closeout.md`：治理/平台收口已合入（#216）—— 归档三份源计划、关闭 TD-054、Platform 证据、治理 Admin 验收 ID。
- `exec-plans/completed/2026-07-30-parameter-governance-state-machine-completion.md`：参数管理后台状态机收口已合入（#212–#214；ADR-0011/0012）。残留 → 收口 #216；D1–D8 仍在 design-docs。
- `exec-plans/completed/2026-07-31-attribution-governance-follow-up.md`：归属 follow-up PR7–PR9 已合入（#215）。残留 → 收口 #216；D-AG-01–04 已锁定 → `2026-08-01-attribution-deferred-implementation.md`（中文对照 `docs/zh-CN/exec-plans/completed/2026-07-31-attribution-governance-follow-up.md`）。
- `exec-plans/completed/2026-07-30-platform-tier-and-super-admin.md`：platform-admin + schema 平台层已合入（#209–#210；ADR-0009）。残留 → 收口 #216。
- `exec-plans/completed/2026-07-27-dts-node-enablement.md`：把 DTS `status` 当作节点启用状态而非参数 —— 结构键单一事实来源、派生启用与可达性、拓扑树与工作台可见、三态编辑接入共享草稿管线、vendor schema 不再向匹配喂入 `status`（分支 `feat/dts-node-enablement`；ADR-0003；中文对照 `docs/zh-CN/exec-plans/completed/2026-07-27-dts-node-enablement.md`）。
- `exec-plans/completed/2026-07-25-parameter-admin-redesign.md`：参数管理后台产品重设计 —— 以治理作用域为信息架构主轴、项目级路由取代 modal、经拓扑 port 实现 mock/API 对等、identity mapping 治理迁入后台、后台自持状态、旧界面一次性退场（分支 `feat/refactor-parameter-admin`；ADR-0001、ADR-0002；中文对照 `docs/zh-CN/exec-plans/completed/2026-07-25-parameter-admin-redesign.md`）。
- **分支与 PR：** 实现型子智能体只在从 `main` 切出的 feature branch 上开发并本地 commit；不得 push `main`、不得开/合 GitHub PR。由父智能体 review 后提 PR、合并，再 `git pull` 同步本地 `main`。细则见英文版 `docs/PLANS.md` § Git Branch & PR Workflow。
- **Agent 技能：** 使用 Matt Pocock skills（如 `implement`、`tdd`、`to-spec`、`triage`）与 `docs/agents/*`；不要新建/更新 `docs/superpowers/**`，也不要指示调用 `superpowers:*`。进行中实现跟踪仍以 `docs/exec-plans/active/` 为准。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。

## 同类中文文档

- [docs/zh-CN/root/AGENTS.md](root/AGENTS.md)
- [docs/zh-CN/root/README.md](root/README.md)
- [docs/zh-CN/root/CONTRIBUTING.md](root/CONTRIBUTING.md)
- [docs/zh-CN/root/ARCHITECTURE.md](root/ARCHITECTURE.md)
- [docs/zh-CN/README.md](README.md)
- [docs/zh-CN/frontend.md](frontend.md)
- [docs/zh-CN/PLANS.md](PLANS.md)
- [docs/zh-CN/QUALITY_SCORE.md](QUALITY_SCORE.md)
