# 执行计划治理

> English: [English](../PLANS.md)

这是核心入口文档，帮助开发者理解仓库地图、运行模式、治理规则和下一步阅读路径。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 同一计划文件名不得同时出现在 `active/` 和 `completed/`（中英目录均适用）；`docs:check` 会拦截。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：core。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 已完成实现见 `docs/exec-plans/completed/`（含工作流发现面可见性 `2026-08-18-workflow-discovery-visibility.md`，#556；2026-08-18 属性键源文件 cutover 与余量方案 `2026-08-18-property-key-source-cutover.md`、`2026-08-19-property-key-cutover-remainder.md`，#544/#549/#553/#555/#558；TD-117 已按接受残留关闭；2026-08-18 CI 反馈环 `2026-08-18-ci-feedback-loop-optimization.md`，#523–#525；2026-08-17 归档的路径可达 C1–C4、产品反馈、拓扑 review 第 3–6 轮、通知中心、配置工作台缺陷修复、以及小泽审批失败恢复 TD-102 / TD-094；2026-08-17 第二轮归档的已落地 DTS 工作台/种子、归属/驱动注册/overlay、参数后台 UX/IA、批导/Excel、日志组织解耦、个人总览、ADB/HDC、调试后台、Device Bridge 阶段 1/2、小泽回合 UX、CORS bootstrap；定义身份纠错 `2026-08-04-parameter-definition-identity-correction.md`，#504；以及 2026-08-17 归档的归属 deferred D-AG-01–04 证据收口 `2026-08-01-attribution-deferred-implementation.md`）。不要把那些计划重新当成活跃工作。
- 当前仍有剩余工作的计划：

### 等待外部输入或目标环境

- `exec-plans/active/2026-08-12-agent-log-analysis-system.md`：P1–P3b 已在 `main`。剩下的是专家标注金标准案例、第二个试点域、以及人工 judge 校准记录——不是开放 PR。残留 TD-090 / TD-103 / TD-105 / TD-116。
- `exec-plans/active/2026-07-16-parameter-topology-schema-management.md`：语义身份实现已落地；**TD-042** 在干净快照演练完成前仍阻断“生产 cutover 就绪”声明。各轮 review 计划已在 `completed/`。
- `exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md` 与 `2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`：M5.2 目标环境证据。
- `exec-plans/active/2026-06-02-wiseeff-m6-2-identity-user-governance.md` 至 `2026-06-02-wiseeff-m6-6-release-rollback-capacity-gate.md`：自托管身份、备份、队列、可观测、发布/回滚/容量证据（TD-019–025）。

### 自托管操作体验

- `exec-plans/active/2026-08-18-self-hosted-setup-wizard.md`：OpenClaw/Hermes 风格的终端配置向导——只问人必须决定的项、自动生成密钥、分段重配、doctor。实现分支 `cursor/selfhost-setup-wizard-24de`。
- `exec-plans/active/2026-08-18-self-hosted-ip-lab-profile.md`：无域名 IP 实验室 profile——自动生成密钥、HTTP 或 Caddy 自签证书、一键 bootstrap，以及管理员可见的 ChargeLab 演示数据。配置向导的前置条件。

### 仍待做的产品与 UX

- `exec-plans/active/2026-08-19-local-eval-auth-hardening.md`：本地评估账号加固——用户改密、Admin 重置、自助注册开关、登录/注册限流、失败登录审计、认证页说明。实现分支 `cursor/local-eval-auth-hardening-5336`。
- `exec-plans/active/2026-08-19-organization-administration.md`：组织管理（D1–D11 / ADR-0037），实现分支 `feat/organization-administration`。延期：邀请 TD-119、组织目录 TD-120、项目成员 TD-121。
- `exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`：上线窗口可关闭、且不需要 HDC / 专家日志 / 目标环境的技术债收口。批次 1 已归档归属证据并把 `2026-08-01-attribution-deferred-implementation.md` 移到 `completed/`；批次 2 已关闭 TD-056（参数文件回滚 / 操作者显示名）；批次 3 已合入 `main`——TD-057 经 #513，TD-079 hierarchical-modules 经 #511，import-wizard 经 #512。批次 4 已于 2026-08-18 合入：工作台夹具 #516、语义 file-sync #519、dts-reload 交接/形态 #517、DTO 校验 #515、render harness #518、治理 ADR #520。**TD-079 已关闭**（`fix/td-079-flip-ci-acceptance`，共享 CI 验收为 post-cutover）。TD-082 已由 #507 合入 `main`。第二波 H–N（2026-08-18）：TD-013 经 #529 关闭，TD-066 经 #531 关闭；TD-014 / TD-075 / TD-097 / TD-112 仍为**部分**开放（dts-reload 网格经 #550）；TD-059 仍为**部分**（Draft/Detail/Compare 经 #538/#540/#551；剩余 HistoryDiff / NodeEnablement / reload）。
- `exec-plans/active/td-031-xiaoze-run-timeline-streaming.md`：时间线/流式已落入 `xiaozeTurnStream`（TD-070 已关）；本文件残留是设计文档 metadata 门禁。
- `exec-plans/active/2026-07-08-project-hotspot-scoring-redesign.md`：实现已在 `main`；残留是 API 合同 review 行。
- `exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md`：不要重开隐藏 `/debugging`；后续 DTS reload 已恢复参数调试表面。

### 仍在 `active/`、待后续归档核对

下面这些文件先留在 `active/`，等下一轮确认残余范围；不是施工顺序。完整路径以英文版 `docs/PLANS.md` 为准。

- `development-roadmap.md`
- `2026-07-19-dts-parameter-workbench-redesign.md`：原工作台重设计勾选未完成；后续项目配置工作台计划已在 `completed/` 取代这次重写。不要当全新工作台重开。

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
