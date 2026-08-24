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
- `exec-plans/completed/2026-08-24-compact-application-footer.md`：已为普通登录后路由增加随内容滚动的紧凑页脚，并在现有首页大型页脚增加信息行；版权所有者、版本和联系方式使用构建期配置；复用带当前页上下文的产品反馈入口；明确排除认证/故障/全高工作台；应用壳、响应式、无障碍和中英文文档门禁均已验证。
- `exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout.md`：确定性并行收口经 #575 / #576 / #577 关闭 TD-071 / TD-073 / TD-059。
- `exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-2.md`：第二批确定性并行收口经 #580 / #582 / #583 / #585 关闭 TD-109 / TD-018 / TD-077 / TD-114。
- `exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-3.md`：第三批经 #588 / #589 / #591 / #592 关闭 TD-072 / TD-110 / TD-031 / TD-112；TD-003/012/075/076 与其它无关前端余量继续 Open。
- `exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md`：#598–#607 完成后归档；TD-067、TD-105、TD-014、TD-122 按 merged evidence 关闭，TD-005 有界治理切片完成但 TD-005 诚实保持 Open，陈旧 hotspot 计划归档且不虚构 tracker 关闭项。
- `exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`：TD-122 在最终 clean `main@493a257a1` 上完成 owned/fresh Gate0：visual 20/20、browser 127 expected / 29 planned skipped / 0 unexpected、operation evidence 完整、nested 11/11 清理、root 精确清理、artifact 0 violation，并发布合法 `latest-full.json`。
- `exec-plans/completed/2026-08-22-xiaoze-run-timeline-streaming-metadata-closeout.md`：已补 assistant message 的 `runSteps` / `runId` metadata 中英设计说明，并归档误用 TD-031 编号的旧 timeline 计划。
- 2026-08-23 的有界计划治理清单已归档 organization administration（#560）、local evaluation auth hardening（#563）、node-only debugging 与 DTS parameter workbench，并逐项补充实施/取代元数据。它不是 repo-wide inventory，因此 TD-005 继续 Open。
- `exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md`：精确四维 API 合同、中英 successor 文档与 API-mode Parameter Home 浏览器门禁完成后，热点计划已归档。
- 当前仍有剩余工作的计划：

### 路线图

- `docs/exec-plans/active/development-roadmap.md`：长期交付路线图；不受 feature plan 归档元数据约束，也不属于本轮 TD-005 有界清单。

### 等待外部输入或目标环境

- `exec-plans/active/2026-08-12-agent-log-analysis-system.md`：P1–P3b 已在 `main`。剩下的是专家标注金标准案例、第二个试点域、以及人工 judge 校准记录——不是开放 PR。残留 TD-090 / TD-103 / TD-116；TD-105 retention 已由 Wave 4 #599 独立关闭。
- `exec-plans/active/2026-07-16-parameter-topology-schema-management.md`：语义身份实现已落地；**TD-042** 在干净快照演练完成前仍阻断“生产 cutover 就绪”声明。各轮 review 计划已在 `completed/`。
- `exec-plans/active/2026-05-29-wiseeff-m5-2-staging-pilot-evidence-execution.md` 与 `2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md`：M5.2 目标环境证据。
- `exec-plans/active/2026-06-02-wiseeff-m6-2-identity-user-governance.md` 至 `2026-06-02-wiseeff-m6-6-release-rollback-capacity-gate.md`：自托管身份、备份、队列、可观测、发布/回滚/容量证据（TD-019–025）。

### 自托管操作体验

- `exec-plans/active/2026-08-20-self-hosted-one-command-upgrade.md`：成熟的源码 checkout 升级入口——锁定唯一目标、停机前构建、停止队列/写入、验证 PostgreSQL/对象存储/Redis 恢复点、保留数据地完整重建服务、健康门禁、继续与显式恢复。实现已包含部署用户权限、历史镜像恢复、持久构建诊断、Node 基础镜像离线准备，以及受限网络代理/npm 源/组织批准 CA 契约；无法安装 CA 的主机另有两把钥匙控制的仅构建期 insecure TLS fallback。干净的非客户前向/恢复和无 CA 目标机证据仍待完成。
- `exec-plans/active/2026-08-18-self-hosted-setup-wizard.md`：OpenClaw/Hermes 风格的终端配置向导——只问人必须决定的项、自动生成密钥、分段重配、doctor。实现分支 `cursor/selfhost-setup-wizard-24de`。
- `exec-plans/active/2026-08-18-self-hosted-ip-lab-profile.md`：无域名 IP 实验室 profile——自动生成密钥、HTTP 或 Caddy 自签证书、一键 bootstrap，以及管理员可见的 ChargeLab 演示数据。配置向导的前置条件。

### 仍待做的产品与 UX

- `exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`：上线窗口可关闭、且不需要 HDC / 专家日志 / 目标环境的技术债收口。批次 1 已归档归属证据并把 `2026-08-01-attribution-deferred-implementation.md` 移到 `completed/`；批次 2 已关闭 TD-056（参数文件回滚 / 操作者显示名）；批次 3 已合入 `main`——TD-057 经 #513，TD-079 hierarchical-modules 经 #511，import-wizard 经 #512。批次 4 已于 2026-08-18 合入：工作台夹具 #516、语义 file-sync #519、dts-reload 交接/形态 #517、DTO 校验 #515、render harness #518、治理 ADR #520。**TD-079 已关闭**（`fix/td-079-flip-ci-acceptance`，共享 CI 验收为 post-cutover）。TD-082 已由 #507 合入 `main`。第二波 H–N（2026-08-18）：TD-013 经 #529 关闭，TD-066 经 #531 关闭；TD-075 / TD-097 仍为**部分**开放，TD-014 后续已在第四波经 #600 关闭。第一批确定性收口经 #575 / #576 / #577 关闭 TD-071 / TD-073 / TD-059，reload workflow sheet 不属于 TD-059；第二批经 #580 / #582 / #583 / #585 关闭 TD-109 / TD-018 / TD-077 / TD-114，TD-003/012 与 TD-075/076 仍 Open。第三批随后经 #588 / #589 / #591 / #592 关闭 TD-072 / TD-110 / TD-031，以及限定为 `/parameter-admin/projects` Admin list 的 TD-112。
- **TD-068 交付图：** ADR-0038 与父规格 #609 已定义安全模型。#610 建立共享可信上下文、策略和审计 seam；#611–#615 依次重建 Xiaoze 持久溯源、迁移 DTS 重载、贯通参数提交/治理/回写溯源，并收紧 legacy actor label 与验收证据。上述迁移票据落地前，TD-068 继续 Open。相邻的 debugging device-write 审计缺陷仍由 TD-123 单列，避免本工作膨胀为平台级审计重构。
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
