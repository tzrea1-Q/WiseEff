# #849/#853 完整闭环 todolist

> English: [English](../../../exec-plans/active/2026-09-16-849-853-closure-todolist.md)

状态：**T2.2-OPS 本地候选完成。** T1.1 仍是未提交脏候选。T1.2–T2.2-OPS 仍是同一 Scratch 树上的额外脏工作。T2.2-OPS：[回执](849-inventory/t22-ops-operations-consumers-acceptance.md)。无 commit、正式 SEALED、PR、合并或 Issue 关闭。用户已解除剩余项之间的逐项「确认」；commit／PR／目标机／破坏性删除／Issue 仍需单独授权。
基线：T1.1 重新拉取的 `origin/main@46b6068693942b95f7cba28ee5de6748a97170fa`；P0/T0.6 改动完整保留于新 Scratch 分支。
规格：[#849](https://github.com/tzrea1-Q/WiseEff/issues/849)。唯一执行状态：[#853](https://github.com/tzrea1-Q/WiseEff/issues/853)。本文件细化执行顺序和验收条件；每项交付后同步 Issue 及中英版本。

用户在明确本任务测试库范围后，已明确接受[四项修复契约](849-inventory/source-occurrence-review-repair-design.md)，包括修订未发布 Scratch 0151。现有任务 lane／receipt 和原冻结证据继续保留；不授权外部部署、重写已应用 checksum、PR／合并或开始下一 todo。

## 执行约定

T1.1 记录：[来源身份威胁矩阵及已确认决策](849-inventory/source-occurrence-threat-matrix.md)。用户接受实例生命周期、未解回填整体中止策略，并授权 R1–R4、R5／R6 修复。本地解析、迁移、有界初始化、真实鉴权 DTS／JSON 来源流程、独立评审及 PC 观察完成此本地 todo。未执行正式 exact-SHA 封板或交付，不等同所有 todo、S1／S2 或目标验收。Issue 同步留待另获授权的交付动作，本地停止不发布 GitHub 变更。

用户于 2026-09-16 明确修订本项目：浏览器验收统一为 **单 PC 1440x900**。它替代 #849/#853 及关联计划中所有面向后续工作的三视口要求，包含专项浏览器矩阵。既有平板／手机结果保留为历史证据。全部路由、角色、操作、键盘／焦点、截图／snapshot、console/network 和 S1/S2 要求继续有效。T0.6 同步本项目专属自动化视口用例和覆盖描述；其他项目的测试不在本次调整范围。

主智能体负责集成，一次推进一个 todo。完成后报告实际候选／提交／PR 状态、验证、产物和剩余限制，**等待用户确认后再开始下一项**。用户确认、实现完成和合并完成分别记录。等待确认时，不让后台子智能体提前实施下一项。

所有子智能体，包括独立评审者，均使用 **`gpt-5.6-luna`、当前支持的最高推理档**（本运行时为 `max`，历史记录使用 `xhigh`）。检查派发结果；模型不可用时如实报告，不静默替换。任务包写清结果、路径归属、契约和停止边界；仅主智能体在用户授权内发布／合并。必需的 Spec／Standards 评审保持与实现者独立。

T0.1–T0.5 已分别通过 #869、#870、#872、#876、#875 交付，另有 main-red 修复 #873；证据仍绑定原候选，后续保留回归覆盖，不重新开发。#847 已关闭，复用已有工作区；#824 仍为 partial Draft，不计作已具备交付证据。TD-124 的八项 YAML/TOML/ENV 支持继续延期，明确格式拒绝与厂商 YAML 元数据支持仍在本轮范围内。

## 按序推进清单与完成条件

每个未勾选条目都是一个确认节点。先检查并复用已有实现，再补缺口。条目内包含实施、相关测试、必要独立评审和证据记录。本地候选完成后仍须如实记录其 PR／Hosted／合并状态。

- [x] **P0 — 创建完整清单并记录单 PC 修订。** 建立中英清单，将用户修订同步到 #849/#853，并链接已有计划；执行文档和 diff 检查，提交本准备项供用户确认。不据此关闭 T0.6。
- [x] **T0.6 — 当前文档与验收定义对账。** 按最新 main 和合并 PR 核对三份 active 文档，解决 B1/B4/B5、源文件、归档、S2、Hosted 的矛盾叙述，保留带日期的历史证据。把本项目的视口循环、需求／操作 ID 和中英覆盖地图同步为单 PC；执行受影响检查、`docs:check`、`git diff --check`。后续 schema 工作前重新核对 migration/ADR/TD 编号（0150 已存在）。后续 todo 继续遵守文档同步门禁。
- [x] **T1.1 — B1 来源身份与 DTS/JSON 完整流程。** schema 实施前完成威胁矩阵与独立 Spec 评审。按已决方案增加 source-occurrence identity，DTS 原位回填且不改变既有 Binding ID，覆盖 observations/matches、`resolve_current_binding()`、`protect_binding_identity()`，证明过渡读取等值后切换。版本 pin 保持属于 ProjectValue；校准 SQL/ACL 与触发器顺序，在完整矩阵通过前保留 `logical_node_id`；JSON ingest 归属 `parameter-files`，DTS ingest 归属 `parameter-topology`。验证 instance/config-set/file 隔离及精确 JSON Pointer/DTS locator，通过真实鉴权、专用 PostgreSQL 和源存储走完 import preview → candidate → 真实草稿 → 提交／审批／生效 → 源重解析 → 导出／重导入。重复／歧义键、不支持语法、缺失／过期定位、危险写回均被拒绝；保留标量、精度、数组／cells、字面点号／斜线键、重复节点及无关源内容。序列化变化可审阅，延期格式继续明确拒绝。
- [x] **T1.2 — B4 capability v4 与 charging_core 主体。** 能力实施前完成 R3 威胁矩阵与独立 Spec 评审。 支持递归／嵌套数组、mixed item schema、数组 description 和元数据声明的 min/max 基数，限定深度／容器容量并对未知关键词 fail-closed；发布受审 NodeType 主体。v1/v2/v3 历史含义不变，v3 consumer 在写入前拒绝 v4。不从示例／观测行数推导约束，不扁平化 cell matrix。通过编译器、准入、运行时、历史发布及真实 PostgreSQL 检查和独立评审。仅本地候选；见 [capability-v4-acceptance.md](849-inventory/capability-v4-acceptance.md)。
- [x] **T1.3 — 完整 successor、真实源与 B2 物化。** 逐输入记录 source digest、精确 locator、旧／正式身份、preserve/transform/merge/exclude 处置及 predecessor lineage；结构项／歧义夹具显式排除，当前范围字段／身份未解决或存在不明遗漏时阻止发布，TD-124 不产生活动绑定／值。对齐全部 125 项输入：113 厂商＋4 个本轮 DTS/JSON＋8 个 TD-124 延期项；保留语义字段、来源以及各项目初始／推荐值。每个板级业务出现都对应受审真实声明，用实测身份解释历史悬空目标计数差异。证明 `buildCompleteSuccessor` 携带 ConfigurationSchema，退役 acme 主体／别名／定义的新选择入口，保留身份、历史发布及回执。取得受审 `csub_drv_sc8562` Driver placement 容量，缺容量时 B6 继续 fail-closed。项目归属缺失／歧义时阻止目标计划，沿用真实审阅／授权、初始化锁和单一 in-flight 约束，不用直接 SQL 或伪造批准初始化；执行前后捕获非参数身份／字段／关系／共享对象 checksum 的精确快照。经真实 publisher/installer 和初始化模块证明 Atlas/Aurora/Nebula **各 124、合计 372 的精确 Binding identity set**；验证确定性、顺序无关、无不明遗漏、完成重放无操作、普通启动／升级／发布不重置用户值，自定义项目／非参数数据保持完整。本地初始化不算目标执行。仅本地候选；剩余 P2 见 [t13-complete-successor-acceptance.md](849-inventory/t13-complete-successor-acceptance.md)。
- [x] **T2.4 — 真实 DTS 工具链。** T1.3 后，以真实 `dtc`、`fdtoverlay` 验证所有最终 demo 基底；消除持久 dangling-anchor stub，证明源／主体归属。保留演示标识及工具／产物证据，在 UI／目标验收前修复实际源缺陷。仅本地候选；剩余 P2 见 [t24-real-dts-toolchain-acceptance.md](849-inventory/t24-real-dts-toolchain-acceptance.md)。
- [x] **T2.1 — canonical 真数据完整参数 UI。** T1.3 后，集成 #847 和 canonical pending-draft adapter；验证创建／编辑／删除／重载、理由／合格角色选择、驳回／撤回／重提、角色分离、审批／生效、源 diff、历史／比较／基线／导出／重导入。覆盖定义／模块导航、搜索／过滤／分页／计数、注册、初始化、诚实空态／错误态。在真实服务、单 PC 1440x900 下覆盖全部所需角色和 DTS/JSON 操作，留存截图／snapshot、键盘／焦点与 console/network 证据。保留归档提示关闭／不可编辑、授权 gone 与跨组织隐藏 404，禁止归档信息泄漏；通过既有 observation/authoring 流程修复未知导入行的误导预览。仅本地候选；剩余 P2 见 [t21-parameter-ui-acceptance.md](849-inventory/t21-parameter-ui-acceptance.md)。

T1.3 后串行完成下列十一项 T2.2 子任务。每项包含该族 runtime route、client、job/script 和 mock port；逐条归类为 canonical current、精确 canonical history 或 archived notice。复用共享 ratchet，先修行为再移除 allowance，执行相关测试及可见变更的 PC 验收并记录实测减少量。历史 3513 是需要复测的 allowance 基线，不代表每项都是生产调用。

- [x] **T2.2-CGH — 目录／治理消费者：** 注册、生命周期、定义身份、搜索／详情／计数及发布引用。仅本地候选；剩余 P2 见 [t22-cgh-catalog-governance-acceptance.md](849-inventory/t22-cgh-catalog-governance-acceptance.md)。
- [x] **T2.2-TOP — 拓扑消费者：** 精确 binding/source occurrence 归属，结构／节点启用意图与值草稿分离。仅本地候选；剩余 P2 见 [t22-top-topology-consumers-acceptance.md](849-inventory/t22-top-topology-consumers-acceptance.md)。
- [x] **T2.2-PRJ — 项目消费者：** 已初始化／未初始化／自定义项目状态、配置实例和 canonical 值。仅本地候选；剩余 P2 见 [t22-prj-project-consumers-acceptance.md](849-inventory/t22-prj-project-consumers-acceptance.md)。
- [x] **T2.2-FIL — 文件消费者：** candidate/source/version/config-set 成员关系、canonical 历史、比较、基线、导出。仅本地候选；剩余 P2 见 [t22-fil-file-consumers-acceptance.md](849-inventory/t22-fil-file-consumers-acceptance.md)。
- [x] **T2.2-AGT — Agent 消费者：** canonical 读取与受治草稿，可信调用／来源、组织／项目鉴权和人类批准；旧 checkpoint/tool 参数不能复活 legacy 写入。仅本地候选；剩余 P2 见 [t22-agt-agent-consumers-acceptance.md](849-inventory/t22-agt-agent-consumers-acceptance.md)。
- [x] **T2.2-LOG — 日志消费者：** 推荐使用 canonical current 引用，保留历史分析记录与归档引用展示。仅本地候选；剩余 P2 见 [t22-log-log-consumers-acceptance.md](849-inventory/t22-log-log-consumers-acceptance.md)。
- [x] **T2.2-DBG — 调试消费者：** 观测与项目配置值分离，身份精确绑定，批准后的 promotion 创建 canonical 草稿。仅本地候选；剩余 P2 见 [t22-dbg-debug-consumers-acceptance.md](849-inventory/t22-dbg-debug-consumers-acceptance.md)。
- [x] **T2.2-DTS — 重载消费者：** 真实绑定的 handoff、selection、verify、promotion、residue 替代 skipped placeholder，保留 binding/source pin，软件文件不进入设备 overlay 路径。仅本地候选；剩余 P2 见 [t22-dts-reload-consumers-acceptance.md](849-inventory/t22-dts-reload-consumers-acceptance.md)。
- [x] **T2.2-KNW — 知识消费者：** canonical 当前引用、原始历史记录、授权旧链接仅提示归档、跨组织不泄漏。仅本地候选；剩余 P2 见 [t22-knw-knowledge-consumers-acceptance.md](849-inventory/t22-knw-knowledge-consumers-acceptance.md)。
- [x] **T2.2-MOD — 模块消费者：** 显式 placement/subject kind、注册／容量行为、canonical 模块搜索／计数。仅本地候选；剩余 P2 见 [t22-mod-module-consumers-acceptance.md](849-inventory/t22-mod-module-consumers-acceptance.md)。
- [x] **T2.2-OPS — 运维消费者：** 调度／后台／脚本和重启路径使用 canonical 模块，不重装种子或复活归档当前状态。仅本地候选；剩余 P2 见 [t22-ops-operations-consumers-acceptance.md](849-inventory/t22-ops-operations-consumers-acceptance.md)。
- [ ] **T1.4 — 最终退出 legacy，并验收 T2.2 总体结果。** 十一族完成后证明 legacy allowance 为零，不弱化 checker 或隐藏引用；继任契约满足后清除 fallback/mixed read/dual-write 并关闭 TD-125。证明生产角色、HTTP、worker 均拒绝旧当前数据读写；按重建 epoch 屏蔽受影响的旧草稿、批准、成员关系、队列、cache/checkpoint，保留无关作业／历史，重启后仍拒绝旧重放。
- [ ] **T2.3a — 归档处置／恢复决策与独立评审。** 枚举参数专属关系、FK/trigger/view 闭包、源字节、嵌入历史引用、最小 stub 与共享保留例外。对账归档图／计数／字节／digest，定义在线残留检查、离线保管／保留期／授权取阅及包含切换后写入处理的整套恢复。独立评审精确删除范围和恢复证据；执行前向用户提交具体破坏性操作，取得单独批准。
- [ ] **T2.3b — 实现并验证获批处置。** 按 T2.3a 处置表接通先验证归档再删除及可重放／续跑阶段记录；证明归档损坏／缺失和源／对象失败时拒绝推进，无悬空引用、非参数级联删除或未授权在线旧正文。破坏性执行需上述批准；保留历史／共享例外并保留离线归档。
- [ ] **T3.1 — 完整 S1 与全量 server 门禁。** 在集成候选上覆盖独立鉴权会话、过期 value/definition/source pin、草稿与当前值分离、真实逐项批量结果、禁止自审／越权、提交后响应丢失和幂等恢复。注入对象准备失败、对象持久化后 DB/audit 失败和引用对象缺失，验证重启后当前指针／历史／流程／审计一致及孤立 blob 可回收。使用真实 publication manager/installer。运行完整 `test:server`、所需 build/contracts/schema/ratchet，记录准确 passed/failed/skipped。
- [ ] **T3.2 — 全套本地 acceptance。** 在候选上执行 quality、smoke、local-non-HDC、target-synthetic-acceptance、minimal-upgrade 及各套件既有必需的 Gate0/runtime 归属、需求覆盖、operation evidence、产物安全检查；补齐所需场景，不能把 skipped placeholder 算通过。适用浏览器场景用单 PC 1440x900，保留全部非视口断言。独占 frontend/API 进程，使用空闲且允许的端口和专用 lane DB，不复用其他任务 mock 服务。分别记录命令、角色、产物和缺失的目标／硬件证据。
- [x] **T3.3a — 完整 S2 控制器与 Docker 彩排。** 补齐现有 plan/execute/inspect/recover 及 export/import rehearsal 入口。固定 target/database/image/schema/release/seed/scope/archive 身份，拒绝漂移或不完整库存。证明真实流量／写屏障、worker/queue 排空、publication freeze，以及 PostgreSQL／对象存储／Redis 恢复点。仅在独占授权下临时解冻发布，验证激活回执，成功／失败均重新冻结。逐持久阶段注入中断，证明续跑或隔离的 recovery-required、整套恢复、非参数保留、安全恢复服务，以及两个工作目录均输出脱敏诊断。本地候选：[t33a-s2-rehearsal.md](849-inventory/t33a-s2-rehearsal.md)。未 SEALED。
- [ ] **T3.4a — 固定单一候选与独立评审。** T3.1/T3.2/T3.3a 后，将 S1/S2、schema、seed、release、browser、consumer、恢复证据绑定到一个精确候选和真实环境；完成独立 Standards／Spec 评审、最终 seed/release fixture 评审及 seal 检查，准备可审核的目标计划和恢复证据。后续变化使相关证据失效，须重新 seal。
- [ ] **T3.3b — 获授权的目标彩排／执行证据。** 使用已 seal 候选和具体目标计划，取得所需单独目标／破坏性授权后，运行约定目标静默、归档／重建、保留与重启后探针，记录目标结果及恢复边界。本地 Docker/synthetic 通过不能完成此项。缺目标授权／环境时保持未完成并报告阻塞。
- [ ] **T3.4b — 集成 PR、Hosted、合并。** 按最新 main 校准精确候选，重新检查共享编号，变基后重跑相关门禁。完成 PR/Hosted/merge，将证据绑定实际集成候选；若集成改变运行时或迁移语义，重新做相关目标验收。保留必需独立评审并记录所有 skipped 条件。
- [ ] **T3.5 — 最终文档、交付回执与 Issue 关闭。** 同步中英计划／矩阵／报告、覆盖地图和 runbook，执行最终 docs/diff 门禁。核对 PR、merge SHA、分支清理、最新 main、指定工作树洁净度。把 #849 所有用户故事／实现决策／测试决策与本清单及证据逐项对账，包含部分完成／跳过／目标边界。全部满足后先关 #853，再关 #849，汇报后等待最终确认。

## 契约覆盖与依赖

| #849 契约 | 负责 todo |
| --- | --- |
| 模型、精确身份、源格式；实现决策 1–6、11–16 | T1.1、T1.2、T2.1、T1.4、T3.1 |
| 库存、语义、真实 demo 源、精确种子和初始化；决策 7–10、13、17 | T1.3、T2.4、T3.1 |
| 十一消费者、旧链接、历史保留、重放屏障；决策 18–22 | T2.1、全部 T2.2、T1.4、T2.3a/b |
| 归档控制器、限定 sunset 例外、发布隔离、恢复；决策 20–27 | T2.3a/b、T3.3a/b、T3.4a/b |
| 交付、全部 13 项测试决策及 62 项用户故事（故事 60 改为 PC） | T0.6、T3.1–T3.5 及上述实施任务 |

按显示顺序串行执行并逐项确认。T1.1/T1.2 技术上可独立开发，但不据此越过用户确认点。T1.3 依赖二者及已交付 B6。最终切换依赖全部消费者；删除依赖评审批准；目标工作依赖已 seal 候选和已测恢复；最终集成／关闭依赖完整实际证据。

## Git & PR Workflow

P0 分支：`codex/849-853-closure-todolist`，隔离工作树 `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-closure-todolist`，基线如上。后续每项从实时拉取的 main 创建隔离分支，遵守既有专项门禁，记录实际 base/head。主智能体负责集成，子智能体不开／合 PR；每个确认节点停止。P0 创建文档、同步明确修订的 Issue 契约，不执行产品、schema、部署或删除变更。

## 文档影响矩阵

T0.6 执行记录：分支 `codex/849-853-t06-alignment`，沿用同一隔离工作树，基线为新拉取的 main `4010a600f` 加保留的、尚未合入的 P0 提交 `aa258f289`。这是显式堆叠，准备集成时不得丢掉 P0 文档。采用根 `AGENTS.md`（编辑目录中无 `AGENTS.override.md` 或更近的作用域指南），已读相关工作流、验证与 R1 协议章节。主智能体对账六份活动文档；`t06_pc_acceptance`、`t06_workbench_pc` 分别负责不重叠的验收文件／覆盖元数据；`t06_status_audit` 做独立只读评审。全部子智能体使用 `gpt-5.6-luna`／`xhigh`。不包含产品／schema／目标变更，也不实施下一项 todo。

| 区域 | 动作 | 归属 |
| --- | --- | --- |
| 计划 | 新增中英清单与索引；旧 plan/matrix/report 链接新顺序和 PC 修订 | P0 |
| Issue 契约 | 更新 #849 视口及 #853 执行约定，保留其他要求和待完成状态 | P0 |
| 历史／当前对账 | 修复旧叙述，调整 PC 测试循环及需求／操作覆盖 | T0.6 |
| 架构/API/schema/安全/runbook | 随相应实现同步最近的中英文档 | T1/T2/T3 |
| 最终证据 | 对账所有状态，实际完成后才归档计划 | T3.5 |

## 文档更新门禁

T0.6 独立 R1 复核：`t06_status_audit` 评审 `30452f5a9` 相对 `aa258f289`，未发现业务／键盘／API／数据库／审计断言被误删；唯一 P2 是页面几何证据描述过宽，已在 `7903fee8a` 按建议收窄六处中英文描述，主智能体逐行核对关闭。代码／测试候选由 `2a4887178` 与后续两次描述修正组成。继承的 coverage 缺口、未实跑边界不变。本地完成不等于已合入 main；下一项需用户另行确认。

T0.6 有界检查（2026-09-16）：覆盖／操作矩阵检查器的 `test:scripts` 为 35/35 通过；typecheck 与 build 通过（保留浏览器 externalization／chunk-size 警告）。Playwright `--list --reporter=list` 收集 13 个专项文件的 74 个用例，加 1 个 runtime-warmup（合计 75），没有执行用例。基线与候选对比确认这 13 个文件全部 acceptance／operation marker 未变，均声明文件级 1440x900 默认视口。操作矩阵检查通过；文档治理与 diff 检查通过，pgvector schema 子检查跳过。完整 `acceptance:coverage` 未通过：仅收集的报告含未执行用例，且未修改 main 与本候选的静态对比均存在相同两个孤立映射 ID（`PROJ-REVIEW-READINESS-001`、`PROJ-REVIEW-ROLES-001`）。不得删行或称为运行时覆盖通过；T3.2 须处理该继承缺口。本项未产生浏览器／API／数据库实跑、最终 Hosted 或目标证据。最终独立 R1 评审记录于 #853 完成回执。

P0、T0.6 执行 `npm run docs:check` 和 `git diff --check`，schema 子检查跳过须明确记录。后续任务保留适用的原生测试／构建／浏览器及独立评审门禁，T3.5 刷新最终文档。完成／确认回执记录在 #853，绑定对应 commit/PR 和产物路径。

P0 验证（2026-09-16）：文档治理通过；数据库 schema 子检查因本地 PostgreSQL 缺少 pgvector 跳过。`git diff --check` 通过；中英文清单的 28 个编号及顺序一致。GitHub 两个 Issue 正文回读与准备的更新完全一致，均保持 OPEN。这是文档／计划结果，不新增产品、迁移、Hosted 或目标验收结论。
