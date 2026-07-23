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
- 当前活跃计划清单以英文版 `docs/PLANS.md` 为准。`2026-07-16-parameter-topology-round4-review-blockers.md` 为第四轮 Review 阻断修复：真实 dt-validate schema、可运维 stage→finalize、精确锁定 merge 回写、matcher/review 作用域、manifest 门禁、全局规格 hotspot、未匹配创建+不匹配审计、acceptance/浏览器证据（分支 `fix/parameter-topology-round4-review-blockers`）。`2026-07-16-parameter-topology-round5-review-blockers.md` 为第五轮：不可变 base binding、真 fail-closed writeback、stage/finalize phase 审计、租户 resolve、createSpec 草稿→激活、acceptance fixture 诚实化（分支 `fix/parameter-topology-round5-review-blockers`）。TD-042 仍为 BLOCKER。
- `exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md`：第六轮 Review 阻断——历史 scope 校正、无损规格 ID、全局规格激活权限、完整 valueShape、真实 merge 验收、cleanup 租户隔离、稳定 test:all（分支 `fix/parameter-topology-round6-review-blockers`）。TD-042 仍为 BLOCKER。
- `exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`：以成熟参数工作台重新承载 API 模式参数页面，深度融合嵌套 DTS 拓扑、语义 binding 行、来源链、类型化草稿、响应式 UX 和可见验收，不恢复扁平身份。
- `exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`：产品边界纠偏——可管参数面、模块→参数 UX、维护项目 DTS、工具链 L2 离开编辑热路径（见 RFC 与裁剪矩阵；中文摘要 `docs/zh-CN/exec-plans/active/2026-07-21-dts-parameter-surface-mvp.md`）。
- `exec-plans/active/2026-07-23-local-post-cutover-seed.md`：本地 `db:seed:m1` / `dev:all` 默认语义-only + 本地 post-cutover，typed binding 可提交审核（分支 `feat/local-post-cutover-seed`）。
- `exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`：退役平台合成基 `wiseeff-power-base.dts`；seed/写回 = 每项目一份项目主 DTS；管理员只维护模块↔驱动（见 RFC；中文摘要 `docs/zh-CN/exec-plans/active/2026-07-21-retire-synthetic-base-dts.md`）。
- `exec-plans/active/2026-07-21-instance-submodule-seed.md`：Type U/N/C 实例子模块 + 驱动组；ingest ensure；未映射驱动 Admin 发现队列（中文摘要 `docs/zh-CN/exec-plans/active/2026-07-21-instance-submodule-seed.md`）。
- **分支与 PR：** 实现型子智能体只在从 `main` 切出的 feature branch 上开发并本地 commit；不得 push `main`、不得开/合 GitHub PR。由父智能体 review 后提 PR、合并，再 `git pull` 同步本地 `main`。细则见英文版 `docs/PLANS.md` § Git Branch & PR Workflow。
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
