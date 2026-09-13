# 智能体开发与验证效率优化

> English: [English](../../../exec-plans/active/2026-09-13-agent-delivery-efficiency.md)
> 状态：**活跃——PR #830、#829 已合入。当前 main 的 checker/收集修复正封板审查；W1 和 Git 预览有独立审查通过的本地候选。CI shadow 在 Scratch，执行/摘要需新的设计审查。不声称裁剪启用或性能改善。**
> 日期：2026-09-13。真实跟踪 Issue：[#828](https://github.com/tzrea1-Q/WiseEff/issues/828)。
> 2026-09-13 重新 fetch 后的真实 accepted base：`1059acb57379bd120d0d2b1a4b4733d4c2e02901`。它恰好等于附件的历史参考值，不构成强制回退后续工作的授权。

## 目标与设计权威

按用户提供的 2026-09-13 工程方案分批实现：安全失败诊断、等价 L1 并行、可解释的验证计划影子模式、统一执行与摘要、任务路由，以及有测量依据的测试和浏览器优化。附件是设计输入；授权来自用户当前请求，并受[交付协议](../../agents/agent-delivery-protocol.md)、[计划规则](../../PLANS.md)和[验证矩阵](../../developer/verification-matrix.md)约束。本中英文文件对是维护中的设计事实源；工作代理仅接收任务包与相关小节。

`EFF-00`—`EFF-09` 是工作包，`EFF-T01`—`EFF-T58` 是回归观察项，不是 GitHub Issue、验收 operation ID 或 ADR。每包映射真实 Issue #828 及随后真实创建的波次 PR/证据；尚未创建的 PR/run ID 保持 pending。不得重命名、重开或解锁 Catalog/Wayfinder 冻结节点。[已完成的 2026-08-18 CI feedback-loop 计划](../completed/2026-08-18-ci-feedback-loop-optimization.md)及 #523—#525 保持历史完成状态。

| 交付层级 | 完成含义 | 当前状态 |
| --- | --- | --- |
| A：工具与流程 | 诊断、等价调度、影子计划、执行/摘要与路由已审查、验证并交付 | EFF-01 已合入；EFF-02/03-preview/07/08 有本地已审候选；EFF-03 CI shadow 在 Scratch，EFF-04 待设计质询 |
| B：模块启用 | 每个明确模块独立满足观察与审查门槛 | 无已启用模块；`observation-pending` |
| C：效果验证 | 同类真实任务/CI 样本支持墙钟、资源与 usage 结论 | 样本不足；token usage 为 `unknown` |

A 可先交付，B/C 继续开放。不得制造样本，也不能因工具合入就宣称整个项目全面完成。

## 继续执行检查点——2026-09-14

用户再次授权完成项目并解决阻塞。最新 accepted main 为 `9dc751690a615b162bb41feef6392289b2ca7f6a`，tree `a0edd814abc6fd73b03d0470641e416b04031195`，不授权回退初始基线。PR #830 已合入为 `75f3514b213f07f177773a077021e1485f9f173b`。W0 [PR #829](https://github.com/tzrea1-Q/WiseEff/pull/829) 的 head 为 `fb6087f1fdb352953f63b46ca711cee5775e2607`，经 [Hosted 34762290769](https://github.com/tzrea1-Q/WiseEff/actions/runs/34762290769) attempt 1 成功后合入为 `ef88c0964e158d7effbd0ce6062260e5eb1c5a21`。实际执行 checkout 为 `41de2cbb95d788168d97d7b8e52711ffbd0dfa63`，tree `652590339d4a16415d935b624753fa7c68421a11`。前端/scripts/bridge/后端原生 pass 数为 3411/1279/134/4168，对应 skip 为 0/21 个既有可选/4 个平台/0；未选中 L2 和目标工作保持 skipped。工作流耗时 1061 秒，job 耗时之和 30.85 分钟，均非计费 usage 或已证实收益。

[已领取的 main-red 前置修复](https://github.com/tzrea1-Q/WiseEff/issues/828#issuecomment-5655466658) 仅修复 [16 对精确已有边界身份及 M1 收集隔离](../../agents/catalog-runtime-boundary-relocation.md)。代码 head `e31226b6cc06c2278230b810bb1becd8dbc1f32a`、tree `d55df1260ea99a60fa38a3101a5e9f5af7c29fc8` 保持业务字节和原 allowance。边界定向测试 82/82、收集运行器测试 53/53 通过。在已提交收集修复 `07be2ecddba7614724728c7bf05dae1826793034`，原生收集列出 39 个文件中的 196 项；单独缺证据的 M1 按要求 1/1 失败。build 和直接文档治理通过。本检查点的最终代码双审和 Hosted 仍待完成。

W1 本地 head `51aaa732e93b31d3e047b72d568581b7b4d90ab0` 修复首轮 Hosted 工程失败后，通过独立 Standards/Spec；旧 PR #831 已关闭，待前置刷新及已审第二候选。Git 预览 `7286c02ed9d25b75a8cf020aa614e9c26cfc843c`、tree `645a764b9252f67ec1c461d6dfa5e37ea1f15da3` 通过两项独立审查、22 项定向测试和 build；它仅为不可执行的本地预览，尚未合入。此前被拒执行器/摘要候选保持拒绝。独立 CI shadow Scratch 仅复用已审 W1/预览依赖，不能在前置合入前发布合并大 PR。

当前 main `9dc751690a615b162bb41feef6392289b2ca7f6a` 的 [push 34764166242](https://github.com/tzrea1-Q/WiseEff/actions/runs/34764166242) 和 [schedule 34775305726](https://github.com/tzrea1-Q/WiseEff/actions/runs/34775305726) 均为 Build and test、local non-HDC acceptance、Merge bar 失败，Quality 成功。收集失败与更早的浏览器失败、归档大小失败分别记录。一次自有本地 Gate 0 正在收集修复候选上诊断，不冒充 main 或 Hosted 验收。四个 feedback 模块均为 shadow/observation-pending，enforce、memo 关闭。完整 main 验收、效果、计费 runner-minutes 和全项目 token 仍未建立或 unknown。以下保留历史检查点。

## 交付台账——2026-09-13 检查点

本追加检查点记录已观察候选，不替后续 tree 作验收。父协调者在下一检查点记录刷新后的封板和合入证据。用户补充模型要求后的开发派遣均显式使用 `gpt-5.6-luna`、`xhigh`；独立审查者按角色标识。

| Lane | 精确本地候选／远端证据 | 状态与证据边界 |
| --- | --- | --- |
| 基线夹具前置修复 | `27320fdfdc38e92193faf9799f70e11f7cb37368`，tree `6887ac7b8c43048fb1ba93dde047083cdb7ed172`；[PR #830](https://github.com/tzrea1-Q/WiseEff/pull/830)、[run 34760791346](https://github.com/tzrea1-Q/WiseEff/actions/runs/34760791346)，attempt 1 | 用户明确例外仅允许 publication store 测试的 `89600` → `89900`。44 个断言和业务代码不变。在自有本地 pgvector 集群固定 PID 1033，base 为 5 pass/1 failure，候选为 6 pass/0 skip。build、文档/schema 检查及独立 Standards/Spec 通过，Hosted 待完成。 |
| EFF-01／W0 | `66e572a4c45bd5d4db164380a2200e7ee6c10ac4`，tree `26b7acc0e03a07922e57fe688ca285eb6a741346`；[PR #829](https://github.com/tzrea1-Q/WiseEff/pull/829)、[run 34758486310](https://github.com/tzrea1-Q/WiseEff/actions/runs/34758486310)，attempt 1 | 本地独立 Standards/Spec、30 项 focused、47 项 sanitizer/finalizer 和 build 通过。Hosted 前端 3411 pass；scripts 1279 pass/21 个既有可选 skip；bridge 134 pass/4 个平台 skip；后端 4167 pass/1 个夹具失败。Build and test 与 Merge bar 失败，Quality/Smoke 通过，未选中 L2/target 为 skipped。实际 merge 执行 SHA `4eaf0ae4df5a0d80a76c642389f2e43dd91bf1e9` 的 tree 与候选一致。本 PR 未执行 L2 最小诊断上传。 |
| EFF-02／W1 | `4d3e8ab29cc403773a6341a59cc1d741ef3a5bb7`，tree `4a467e83122fe1938c71a1b1eb4535b52985172c` | 恢复 backend 子任务中完整 PG-backed docs 检查后，本地独立 Standards/Spec 通过。64 项 focused、验收元数据和 build 通过。无 PR/Hosted/合入，W0 后刷新。 |
| EFF-03/04／W2 | 计划器检查点 `25435360f01fc016931785c6cd650215ecb5e145`；执行器/摘要仍可变 | 仅 Scratch。四个 feedback 模块均为 shadow/observation-pending，memo 关闭，候选和完整检查仍必需。无最终独立审查或 Hosted 结论。 |
| EFF-08／W3 | `805edbed4a68eea9f45d4d61e08ce2fc67f3fcec`，tree `f1ff3cdba6aafc93c3d26fc16bf5ae600d46e1e1` | R1 独立合并审查通过；使用真实 W2 命令的路由演练及集成文档检查待完成。无 PR/Hosted/合入。 |

保留失败的 W0 run，不重试。前置修复后的强制 main 刷新使用协议例外允许的第二轮 Hosted，不授权无关广域失败重跑。夹具算术穷举完整 1200 周期，修改前 300 个余数碰撞、修改后为零；它不是实测 flaky 频率。初次零测试 CLI 配置失败未计入 Red。自有夹具 PostgreSQL 已停止并核实不存在，临时连接凭据已移除，本地证据保留。

观察与效果分开：本地一次完整前端运行在 441 个文件中通过 3411 项测试，进程墙钟 78.211 秒。最慢三个套件均为 DOM 集成，仅此不足以支持 pure 拆分。两次同源码 Quality 观察各通过 100 项，原生耗时 506.951 和 502.668 秒；隔离与收益未经证明前，共享状态继续串行。类型反馈对每条命令各测三次 cold 和三次 warm，cold 仅清除自有编译增量缓存。并发主机负载下，完整构建 cold/warm 中位数为 24.958/27.991 秒，原样类型阶段为 10.070/12.727 秒。这支持评估 edit-only 入口，不构成 CI 节省声明。计费 runner-minutes 和全项目 token usage 仍为 unknown。

### 前置合入后的集成检查点

PR #830 已合入为 `75f3514b213f07f177773a077021e1485f9f173b`；origin/main 和干净的专用本地 main 已同步，远端特性分支已核实不存在。run 34760791346 attempt 1 的 Detect、Build and test、Quality、Smoke、Merge bar 成功，未选中的 L2/target/minimal probe 保持 skipped。实际 checkout `d24340b3bcce9cd27c7837fb3bd09cab0eaee983` 的 tree 为 `6887ac7b8c43048fb1ba93dde047083cdb7ed172`。原生计数：前端 3411 pass；scripts 1261 pass/21 个可选 skip；bridge 134 pass/4 个平台 skip；后端 4168 pass/0 skip。工作流端到端近似值 1056 秒，各已完成 job 耗时之和 30.9833 分钟，均非计费口径或优化收益声明。[Attestation](https://github.com/tzrea1-Q/WiseEff/issues/828#issuecomment-5653792520) 保持 Issue #828 开放。新 main [run 34761775820](https://github.com/tzrea1-Q/WiseEff/actions/runs/34761775820) 正在执行，尚未建立完整 main 验收结论。

W0 在 `8a28db47050fc1c84386b4498ad60f62748ae6ef` 将前置修复合入 Scratch lineage。本次刷新运行时检查点文档有 dirty；四个 focused 文件 77 项全通过、无 skip，验收元数据、原完整 build 和直接文档治理检查通过。W0 运行时代码相对首个受审候选未变。精确刷新候选的 Hosted 将在 `Build and test / Documentation governance` 的 job 自有 pgvector 上执行完整 `docs:check`；本地文档治理不冒充 schema 证据。此前一次清空环境变量的本地 docs 调用仍对默认数据库做了只读扩展探测，并跳过 schema 验证；它不计为 schema 成功，也不再重复。

W2 检查点 `61e3e5638248b3b9e528bb2f999a675dfb4eed4d` 未通过两项独立审查。有边界的纯 fixture 暴露了 discovery 参数覆写临时测试、shadow 文件裁剪、不完整证据被判 complete、环境及 PG 边界缺口；实验未修改候选源码或外部数据库。合并返工包使 W2 保持 Scratch。原 Standards 审查者编写过早期 planner，已更换为覆盖完整候选的独立审查者，不计自审。EFF-07 类型入口候选 `d3872b68f25e21851d71d23b9ec426b27243cd3d` 已通过独立 R1 合并审查、两个 TS 引用项目的真实类型错误 Red/Green、完整 build 与文档治理；尚无 PR/Hosted/合入。

## EFF-00 真实事实与待补证据

以下为父协调者本轮核验结果；原始审计保留于本地波次证据目录，集成前刷新易变事实：

| 观察项 | 真实记录与影响 |
| --- | --- |
| 工作区与所有权 | 父工作区初始为 clean detached，随后建立 `codex/efficiency-w0`；初始审计发现 143 个既有 worktree 及 1 个新 worktree，11 处有 dirty，全部保留。本次文档 lane 为从 accepted base 新建的 clean `codex/efficiency-plan`。 |
| 重复领取 | 创建并领取 #828 前，未发现同目标开放 Issue/PR 或活跃计划；唯一开放 PR 为 #824，W0 与其无共同业务路径。每波重新核验。 |
| 实际保护 | main protection API 返回 `404 Branch not protected`，`rules/branches/main` 返回 `[]`。这是当前配置事实，不是削弱检查或 bypass 的授权；保留门禁名称与来源。 |
| 当前汇总限制 | 现有 `Merge bar` 检查 failure/cancelled 及 Detect success，尚未证明每个必需组确实成功。EFF-02 必须补 required skipped/missing 防假绿，不把目标语义写成已有实现。 |
| 已有实现 | 分层 CI、取消过时 PR、Quality/L2 分离、DTS 工具缓存、路径分类、后端模板/worker 数据库、Gate 0 与安全不可变归档已存在；复用实际 seam。 |
| 本地环境 | macOS 26.5.1 arm64、10 CPU、24 GiB；Node 22.22.3、npm 10.9.8、Codex CLI 0.148.0；`.nvmrc` 要求 Node 22。lockfile 解析为 Vitest 4.1.5、Playwright 1.59.1、TypeScript 5.9.3、Vite 7.3.2。锁定版本不等于二进制已安装可运行。 |
| 最新相关 main 运行 | [34744323465](https://github.com/tzrea1-Q/WiseEff/actions/runs/34744323465) 为 failed。归档超过既有 256 MiB ZIP 安全上限；57 项浏览器失败的根因仍 unknown。归档与浏览器原因分开，不声称当前完整验收成功。 |
| 样本覆盖 | 父本地 `work/efficiency/eff00-audit/` 台账含 N=10 次真实近期运行，但成功 PR 仅 N=2，所采样 3 次 main 均失败，不足以得出裁剪启用或性能改善结论。 |
| 历史性能参考 | 附件记录 PR #827 的 [34743588364](https://github.com/tzrea1-Q/WiseEff/actions/runs/34743588364)：工作流约 17m03s、L1 16m07s、前端 5m32s、后端 5m38s、scripts 1m31s、build 1m03s、install 21s；Quality 10m44s，其中运行 8m29s。这些是待 EFF-00 样本台账复核的历史单次观察，不是 P50/P95 或当前改善证明。 |

EFF-00 在本地输出 `baseline.json` 与 `baseline.md`，包含来源、base/head/tree、run/attempt、事件、job/step 耗时、采样口径、缺失值和所有权。检查约 10 次可比近期运行、实际工具、数据库/扩展、工具链及网络/代理可用性，不记录凭据。失败分类为 `product/code`、`fixture`、`environment`、`timeout`、`artifact`、`pre-existing`、`unknown`，允许多原因。无关问题修复先领取；缺少远端事实仅阻塞对应声明，不阻塞独立纯工具。

## 不变量与范围

- 保留 required-check 名称、来源与严格预期语义；不删除检查、修改保护、bypass、force-push，不把 required skipped/neutral/missing/cancelled/timed_out 算成功，不用 `continue-on-error` 或末尾成功命令掩盖失败。
- 等价拆分保留原 L1 每条必需命令、环境、断言与测试。选择器先 shadow；策略/workflow/registry 修改不能用自己的新规则跳过验证。未知影响扩大；未知提交/差异事实使计划无效。
- 保留 main/nightly/full-acceptance/manual 与有状态 L2 取消语义；不自动取消在途 main L2、不引入 merge queue、不修改 label 触发。若执行时已存在队列，遵循真实 `merge_group` 契约。
- 最小诊断和完整证据分开；保留脱敏、扫描、资源所有权。finalizer 失败不上传原始目录；诊断成功不得覆盖执行、清理、归档或上传失败。
- 所有结果绑定 accepted base、PR head、实际 executed SHA/tree、dirty 输入、run/attempt。选中任务零测试或必需用例全部 skipped 必须失败；必需 PG/扩展/工具链缺失记 blocked/failed。
- 不新增通用平台、远端结果缓存、常驻 daemon，不迁移包管理器、升级框架主版本、重构邻近业务、增加 exclude、减少断言、自动更新 golden/截图、放宽扫描或大规模重试。
- 复用数据库模板、Gate 0、任务入口和证据契约。共享状态继续串行；浏览器先隔离再分片。
- 不操作生产/目标数据库、cutover/启用、真实设备、恢复/清理/切流，不改全局 Codex 设置或工具权限。诊断/usage 不公开秘密、完整会话或私有推理。
- 保留他人 dirty 和未知资源。子代理仅有 Scratch 限定路径；父代理统一审查、封板、PR、合入与 attestation。未独立审查必须如实说明。

## Git & PR Workflow

本计划明确使用多个从最新 accepted main 建立的 `codex/efficiency-*` Scratch 分支。W0 父分支为 `codex/efficiency-w0`，R1 文档登记 lane 为 `codex/efficiency-plan`。后续 lane 的路径/base 在编辑前写入任务包。初始合入顺序：W0 → W1 → W2 → W3 → 独立 W4 切片 → 满足条件的 W5 启用/报告。实现子代理只 commit，不开/合 PR、不操作 main。

R3 经过 `PREFLIGHT → THREAT-READY`，再进入 `SCRATCH → PRESEAL-REVIEW → SEALED → INTEGRATION-READY → HOSTED → MERGED → ATTESTED → CLOSED`。R1 采用有边界的独立合并审查；R2/R3 对同一 Scratch SHA 并行进行独立 Standards/Spec 审查，父代理统一处置。R3 实现前先独立质询威胁矩阵。封板后字节或 lineage 改变即使原封板与证据失效。

共享 CI/registry/report 核心初始实现 WIP ≤2；每 worktree 同时最多 1 个重任务，父协调者最多 2 个重型本地 lane，并预留审查/集成容量。Hosted 期间继续不冲突 Scratch/审查；无独立工作时记录原因。预算目标为一次 seal、一次最终审查、一轮 Hosted，例外遵循原协议限制。通过事件/持续等待/合理退避获取状态，不反复轮询或反复跑广域测试造证据。

每个约 ≤6 KiB 任务包写明目标/非目标、真实 Issue、base/head、风险/不变量、可写/只读/禁止路径、相关文档小节/源码 seam、Red/Green、真实命令及证据层、停止/回退和下一状态；超出时拆包，不截掉安全要求。诊断/门禁/选择器/资源 R3 seam 与 R1 文档分开；纯 memo 至少 R2，触及结果真实性按 R3。

每次 PR 前 fetch 最新 main，检查冲突与修改，完成 focused 和必需本地证据，汇集所有独立审查，统一返工，刷新后重跑受影响检查和编号/生成物检查，再封板开 PR。检查实际 Hosted 任务/身份，必需结果有效才合入；核实 merge SHA、main 可见性、Issue、分支处置和专用 clean main。无远端权限则交付完整本地候选并明确未创建/未合入。无法解析的高风险冲突、缺少授权或外部证据只阻塞依赖项。

## 技术设计

### D1 — 最小失败诊断（EFF-01）

从既有结构化运行器/Gate 0 阶段事实投影 `execution / cleanup / diagnostic / archive / upload` 五种独立状态，保留全部失败与首个已知失败阶段；首批不改完整归档格式或资源生命周期。允许字段：schema version、可信 run/attempt/job ID、候选 SHA/tree、枚举 phase/status、exit/signal、起止时间、注册 task/test ID、已校验相对源码位置、规范化错误/拒绝码、清理投影、suppressed/truncated。缺失为 unknown。

首个已独立威胁审查的 W0 实现将输入限定为 `workflow-context-only`：workflow 内嵌 `/usr/bin/python3 -I` publisher 不读候选报告，在 checkout 后、npm 前记录真实 SHA/tree，未观察的 phase/cleanup/test-count 保持 unknown，尚不声称详细报告投影。父本地验证进行中（本文档集成前 28 项 focused、`acceptance:ci`、build 已通过），不冒充同候选 Hosted 或合入证据。L2 新增 identity 1 分钟及 generation/fallback/upload/settlement 4 分钟，原必需预算下限 146 变为 151，总 job 预算变为 155 分钟；不缩短任何旧步骤预算。详细报告读取如有需要，作为 EFF-01 独立审查扩展。

原始 stderr、环境、请求响应、DB URL、浏览器 HTML/storage、令牌、代理认证和工作站绝对路径不得进入投影。标题、路径、异常文本均不可信。默认 JSON ≤64 KiB、人读摘要 ≤4 KiB、失败 ID ≤20；可选摘录每条 ≤1,200 字符，仅在专用白名单/脱敏校验后输出。优先不用自由文本；安全无法确认仅输出固定码。

候选诊断必须通过 accepted policy 校验。生成器/校验器失败，以可信 workflow run/attempt/job 和固定 `DIAGNOSTIC_REJECTED` 收尾，不回显拒绝字节。限时收尾尽力上传最小结果；完整证据仍须既有安全 finalizer。摘要上传成功不改变执行/清理失败；SIGKILL、runner 丢失、收尾超时可导致 incomplete。反例覆盖合成凭据、ANSI/标题注入、超大/损坏/缺报告、越界/symlink、双失败、超时和清理失败，禁止使用真实秘密。

### D2 — 等价 L1 拆分（EFF-02）

首批固定 `static-build`、`frontend-tests`、`backend-tests`、`scripts-bridge-tests`，与既有 Quality/Smoke 并行。建立逐项旧步骤→新组台账，包括 `acceptance:ci`、DTS toolchain、advisory seed compile、build、docs、UI ratchet、lint、frontend、pgvector、scripts、trusted-base boundary、bridge、backend、contract、logs eval。只保留原有 advisory 例外，不扩散。逐个追踪 Scripts/docs/schema/contract 的 PG/工具链依赖，独立配置环境，不能共享可变数据库。

对外保留 `Build and test` 严格聚合及 `Merge bar`。始终结算、显式依赖全部必需组，核对预期组身份/报告完整性，要求每个选中组 `success`。未选择为 `not-selected`；required skipped/neutral/missing/cancelled/timed_out 不通过。Detect/plan 失败不能生成空绿。保留 full/manual/Quality/Smoke/L2 关系。报告最长路径和测试清单；并行墙钟改善不自动等于 runner-minutes/token 减少。

### D3 — 可解释影子计划（EFF-03/05）

以下入口在 accepted base **尚未实现**；EFF-03/04 合入前使用验证矩阵中的真实已有命令：

| 拟新增命令 | 契约 |
| --- | --- |
| `npm run verify:plan -- --base <ref> --profile <edit\|candidate\|pr\|full> --mode <shadow\|enforce> --out <file>` | 只读计算事实/计划，不安装依赖、启动数据库或编辑源码；仅向显式指定的受控非源码位置写出计划。 |
| `npm run verify:run -- --plan <file> [--group <name>] [--force]` | 校验身份，通过参数数组执行已审查任务；完整日志流式落本地，返回有限摘要。 |
| `npm run verify:report -- --run <dir> --format <summary\|json>` | 聚合已有结果，不隐式重跑、不调用模型。 |

优先薄入口 `scripts/verify.ts` 与小型 `scripts/verification/` 边界，复用 TypeScript/Zod、GitHub Actions/Vitest/Playwright 和 Gate 0。这里是拟议落点，不是已存在文件声明；实现选定真实路径后同步本计划。不建立通用 DAG 引擎或新规则语言。

CI 绑定不可变 base/PR head/实际 checkout SHA/tree。本地 edit/candidate 合并 merge-base 分支变化、staged、unstaged 与允许范围 untracked 源码，包含内容、删除、文件模式。NUL name-status 无损解析；重命名旧新路径并集，删除用 base 归属/消费者。校验 refs/路径，不拼接 shell。必要时有限 fetch 补历史；base/diff 无法确认阻止有效计划。空/未知路径广域回退，不误判 docs-only。用户输入只能扩大覆盖，不能压低风险。

已审查模块模型含稳定 ID、路径、依赖、显式消费者、测试任务、浏览器页面/角色/操作/成功拒绝链路、环境、风险升级、shadow/启用状态和批准。先发现真实路径/测试。选择集合 = 直接归属 + 反向依赖闭包 + 显式消费者 + 关键浏览器链路 + 风险 + 事件强制项。按 task ID/config/选择参数去重并保留全部理由。静态 import/`related` 仅作线索；动态 import、SQL、fixture、模板、路由、环境和跨进程 API 必须显式映射或扩大。

| 变化边界 | 默认要求 |
| --- | --- |
| 真正惰性文档 | 原文档/链接规则；可执行 fixture 或 source-lock 文档不是惰性。 |
| 独立 UI/后端模块 | 模块、消费者、必要类型/构建/契约、真实 PG 和相关浏览器；独立启用后才裁剪。 |
| 共享 UI/routes/CSS/token/root provider | 全前端与相关 Quality/Smoke。 |
| DTO/OpenAPI/auth/RBAC/database/schema/migrations/kernel/Catalog core | 全 L1 + Quality/Smoke + 指定高风险集成；明确要求时前移 L2。不做首批试点。 |
| package/lock/toolchain/TS/Vite/Vitest/Playwright/CI/policy/registry | 广域 L1 与相关浏览器/工程回归，不自我跳过。 |
| delete/rename/动态依赖不明/未知路径 | 扩大到边界或全套。 |
| main/nightly/full-acceptance | 保留既有全量语义。 |

计划字段：`schemaVersion`、`acceptedBase`、`prHead`、`executedSha`、`tree`、`dirtyInputDigest`、`diffBase`、profile/mode、policy version/digest、registry digest、变更状态/路径、模块、风险、selected tasks、required groups、not-selected reasons、fallback reasons、环境、时间与内容摘要。digest 只关联和失效记录，不是签名，也不替换 Catalog source-lock/fingerprint。

不信任 PR 任意 plan JSON。accepted-base 规则决定最低要求；候选策略对本 PR 只能增加要求。base 尚无 planner 时保留旧全量执行并仅输出 shadow。无需 `pull_request_target`、高权限 token，也不声称脚本可防御任意 workflow 写权限。

shadow 计算“本来会选”的集合，实际仍跑旧全套必需任务；从同一完整报告取选中覆盖/耗时，不重复执行制造样本。历史回放绑定当时提交/策略/diff，不能把今日图套回历史宣称精确。

每模块启用须 ≥10 次有实质内容的真实变更（可含可重建历史候选）、≥3 次真实 Hosted、覆盖直接/消费者/test-fixture/边界或删除重命名类别、≥6 个独立适用强制规则反例、零未解释漏选/零测试/依赖缺口、独立审查，以及 ≥1 份可用完整 main 集成结果，相关 main-red 已修复或证实无关。数量不替代类别。故障注入仅在隔离夹具/一次性分支，不合入故意错误、不用空提交或重复 Hosted 凑数。未满足则 `observation-pending`、shadow/full。启用记录含模块/范围/策略/样本/反例/审查/回退；一次漏选、不明假绿、未知必需组或相关主线回归即退回 shadow/full，自动转换只能扩大覆盖。

### D4 — 执行、本地去重与结果（EFF-04）

开发内循环只跑最窄 Red/Green；候选就绪运行必需类型/构建/PG/浏览器，刷新后重算受影响集合，最终候选运行新鲜 required Hosted。Issue 指定证据优先于通用 planner。依赖缺失/失配才按 lockfile 安装，不借用兄弟 worktree 可变 `node_modules`。

命令来自已审查白名单、用参数数组，拒绝任意 shell 字符串和不安全输出路径。`--force` 仅重跑选中任务，不绕过身份/安全、不启用策略。日志流式写唯一 gitignored `work/verification/<run-id>/` 或已校验等价路径；摘要包括任务/状态/耗时/数量/首个有效失败 ID/日志位置/注册下一条命令。原子完成结果；半份或中断 JSON 不算成功。全部选中任务须有匹配完整结果，不能只看最后一条命令。

先关闭 memo，正确性成立后只允许同工作站/workspace 白名单无副作用纯测试。PG、浏览器、迁移、清理、备份恢复、设备、外部 API、最终 Hosted、目标证据不复用成功。key 包含源码内容（dirty/untracked/删除/mode）、测试/fixture/config、lockfile、实际工具、OS/架构、命令 ID/参数、策略和非秘密环境。依赖无法枚举则摘要全部受控源码或禁用；不能只用 HEAD。依赖秘密值的任务禁用 memo，秘密及其稳定 hash 不记录。构建/类型使用原生增量并检查真实产物，不用 receipt 替代。

有效命中记 `reused-local` 并链接原 run，不冒充新 passed。失败、取消、超时、未知环境、缺报告/日志、损坏/不完整结果、task version/worktree 变化均失效；审查者可要求重跑。每任务结果含身份/group/理由/环境/起止/exit/signal/status/数量/reportRefs/log/reusedFrom/missingEvidence；状态为 `passed/failed/blocked/cancelled/not-selected/reused-local`，未知数量为 null 并说明。base/head/executed SHA/tree 分开，报告不写 source-lock 路径，持久文档在封板前完成。

### D5 — 浏览器与真实热点（EFF-06/07）

保留真实受影响 route、角色、关键操作、成功/拒绝路径的 browser-real 证据；backend/API/auth 变化即便不改 `src/` 也可能涉及浏览器。前端可见改动保持 playwright-cli snapshot/screenshot、交互、console/network，并覆盖 1440×900、768×1024、390×844。从真实测试/矩阵定位 acceptance/operation ID，不用 EFF 伪造产品覆盖。

剖析最慢 Top 20 文件与初始化阶段：测试正文、transform/import、DOM/provider、fixture、DB template/clone/migration、浏览器启动/等待。使用安装版本支持的 reporter 字段。首批最多处理 Top 3 高价值热点，每 PR 的变量可归因。候选包括真正纯 Node/jsdom 分层、后端 pure/PG 分层、减重 import、fixture、状态就绪等待、原生类型/构建分层、既有 DB 模板复用、有数据的 heap/worker。保留 test ID/断言/错误发现、TS references 与冷构建；不增 exclude、不把集成改 mock、不暗中 skip PG、不凭猜测改 heap。每项等输入冷/热各 ≥3 次，观察内存/连接/进程清理；明确无收益也是有效结论。

Quality 是首个隔离/分片试点，完整 Gate 0 重构不默认纳入。每组独立 PG/object store/端口或 runner/seed/API/frontend/report，保留有效 warmup、固定浏览器/字体/OS/viewport/截图。共享状态串行。每 shard 初始 1 worker，先看文件分布，不假设巨型 spec 自动均分；拆场景须证明 beforeAll/fixture 等价。汇总所有预期 shard 的匹配 run/attempt/SHA/config，缺失或重复报告失败；blob/trace 经安全处理再上传/合并，不为 merge-reports 上传原始目录。

证明正常、测试/启动/seed 失败、响应丢失、超时/取消后的清理；run marker、所有权记录、资源名称同时一致才操作。未知 PID/DB/path 拒绝清理，不全局 kill/drop。复用 Gate 0 证明。隔离/收益不成立保留串行并记录原因；回退到原串行/单 worker，保留安全诊断/测量。

### D6 — 任务路由、usage 与交付（EFF-08/09）

根入口保持简短：不变量、目录路由、已实现命令与证据边界。模块/验证/协议只在受影响处更新、双语互链，不把本计划全文塞入 AGENTS，不改全局配置。核验真实 Codex 版本、cwd/override/discovery/大小行为，不假设根启动自动加载深层指令。模型/推理沿用用户配置，不硬编码价格/型号。至少演练 UI、backend、工程脚本各一任务及从紧凑状态恢复新会话。

只采集官方可观察 usage 数值、task/model/version、session-turn 终态身份和时间，以唯一终态去重。缺 usage/子代理记 unknown 并说明覆盖；cached-input 属于 input 子集，reasoning/output 按实际语义避免双算。不把未公开内部结构当稳定 API，不公开私有推理/完整工具内容，不把等待或日志字节换算 token。

每次代码交付提供全部授权修改代码文件的完整内容，优先精确候选源码包，附真实路径、摘要、文件 digest、新增/修改/删除/重命名清单。仅含授权提交变更，排除凭据、`.env`、运行日志、数据库和无关源码；删除显式列清单，不造空文件。完整源码交付与反复把所有文件灌入审查上下文分开。

## 工作包与波次门禁

每行均映射 Issue #828；真实 PR/base/head/merge/run/reviewer 由父协调者追加。计划登记时 EFF-01 首版处于本地验证，其余实现项 pending。每项开始前先写精确可写路径和真实命令任务包；这里的拟议路径族不是无限编辑授权。

| 工作包 / 波次 / 风险 | 目标、边界与必需 Red → Green | 门禁、停止与回退 |
| --- | --- | --- |
| EFF-00 / W0 / R1 | 新鲜 baseline/所有权/保护/环境/run 台账；调查既有红与重复领取；登记本计划对/索引。未知明确保留，不编证据。 | 本地基线与可追溯时间；main-red 不明仅阻塞相关启用；不操作生产/全局配置。 |
| EFF-01 / W0 / R3 | D1 的 CI/Gate 0/finalizer 安全诊断 seam；先 EFF-T01—T09，再有限投影/拒绝码/上传。 | 既有 sanitizer/finalizer/CI 相关测试、`acceptance:ci`、受影响 build/docs、隔离失败演练与真实 Hosted。潜在泄露撤新诊断接线，绝不回退原始上传。 |
| EFF-02 / W1 / R3 | D2 逐项台账、4 固定组、严格稳定聚合真值表与 EFF-T10—T18；仅 CI/ratchet/测试和对应文档。 | 各组实际执行、CI 脚本回归、docs、完整等价 Hosted L1；无漏测或隐性重复。聚合不等价恢复串行。 |
| EFF-03 / W2 / R3 | D3 planner/model/registry、兼容路径分类适配与 shadow；EFF-T19—T31、确定性事实、人工复核 ≥3 类真实历史 diff。 | 实际仍全量；计划不联网安装/起库；非法策略/diff 阻止计划。回退移除新计划消费，保留旧分类。 |
| EFF-04 / W2 / R2—R3 | D4 run/report、环境/数量防护、原子结果与 EFF-T32—T40；pure memo 独立小切片，正确性证明前关闭。 | 精确输入正确失效，无 PG/browser/Hosted 复用或 shell/path 注入；usage unknown 可接受。回退关 memo/直接用原脚本。 |
| EFF-05 / W5 / R3 | EFF-02/03/04 与 D3 门槛满足后启用明确普通 UI/内部后端小白名单；启用态重跑 EFF-T19—T31，加 EFF-T41—T43。 | 启用 PR 用旧全量/保守并集验证；10/3/6、类别、full-main、审查不足保持 `observation-pending`，漏选立即 full/shadow。 |
| EFF-06 / W4 / R3 | D5 实测 Quality 隔离→有限分片→完整安全汇总，EFF-T44—T49。 | 保留 test/角色/viewport 清单、warmup、清理所有权和安全报告；证明收益或保留串行。不稳退原单 worker/项目组合。 |
| EFF-07 / W4 / 实际最高风险 | EFF-00/04 测量后，Top 3 热点拆成可归因 PR，EFF-T50—T54；不等 EFF-05。 | 同清单/断言、冷构建、真实 PG、内存/清理，冷/热各 ≥3 次；无收益撤变量并保留测量。 |
| EFF-08 / W3 / R1，触及风险 seam 则升级 | 新命令实际存在后接入 D6 任务包/路由/协议/矩阵与 usage 摘要；EFF-T55—T58，UI/backend/script 演练。 | 真实 cwd 路由/命令有效，安全要求/独立审查可发现；坏路由回退，不改全局配置。 |
| EFF-09 / W5 / R1 报告，启用另按 R3 | 汇总真实 Issue/PR/SHA/run/审查、模块状态、同类效果、当前 main 广域验收、临时资源与完整源码包。 | 分别报告实现合入、模块 shadow/enforce、效果/样本、main 验收；明确 blocked/not-run，回退也需真实 PR/CI，不 force-push。 |

W0 先补安全诊断；W1 只改等价调度；W2 交付 shadow 和统一执行/摘要；W3 接入任务/文档；W4 用数据分别推进浏览器隔离与热点 PR；W5 仅启用证据足够模块并收口余项。不合成一个超大 PR；普通检查点沿用授权，外部阻塞只停止依赖工作。

## 回归验收矩阵

以下是必须覆盖的行为观察，不要求新增 58 个测试文件。复用/参数化既有测试，保留行为级负向测试；实现时逐项映射真实测试/命令/run。出现在表里不等于测试已通过。

| ID | 触发 → 必须观察 | 工作包 |
| --- | --- | --- |
| EFF-T01 | 主验收失败、扫描通过 → 原验收仍失败；最小诊断与受控完整证据可读。 | 01 |
| EFF-T02 | 主验收、完整扫描双失败 → 分开记录，不上传原包，最小诊断可用。 | 01 |
| EFF-T03 | 合成 token/Cookie/DB 凭据 → 拒绝/移除，上传无泄露。 | 01 |
| EFF-T04 | 恶意标题/ANSI/伪造路径 → 不执行、不注入格式、不输出未校验路径。 | 01 |
| EFF-T05 | 巨大日志/过量错误 → 大小/数量受限，明确 truncated/suppressed。 | 01 |
| EFF-T06 | 报告缺失/损坏 → 固定码/unknown，不造 passed。 | 01 |
| EFF-T07 | 诊断校验器失败 → 固定拒绝，不泄露拒绝内容。 | 01 |
| EFF-T08 | 清理/上传失败 → 主结果保留，各终态可追溯。 | 01 |
| EFF-T09 | runner 终止/收尾超时 → incomplete/cancelled 不算完备证据。 | 01 |
| EFF-T10 | 必需组全部成功 → L1/Merge bar 正确成功。 | 02 |
| EFF-T11 | 任一必需组失败 → 聚合失败，其他组仍可诊断。 | 02 |
| EFF-T12 | required skipped/neutral → 不因 GitHub 默认语义假绿。 | 02 |
| EFF-T13 | required cancelled/missing/timed_out → 不成功并明确缺失。 | 02 |
| EFF-T14 | 非法计划/Detect 失败 → 不产生空绿门禁。 | 02/03 |
| EFF-T15 | 合法 docs-only → 必需文档通过，其他组说明 not-selected。 | 02 |
| EFF-T16 | full-acceptance/main/nightly/manual → 原必需集合与目标模式保留。 | 02/05 |
| EFF-T17 | 保护要求 Build and test/Merge bar → 名称/来源/严格语义保留，不删除保护。 | 02 |
| EFF-T18 | 迁移全部旧 L1 → 命令/环境/test inventory 完整，无隐性重复。 | 02 |
| EFF-T19 | 单模块修改 → 直接测试和显式消费者均选中。 | 03/05 |
| EFF-T20 | 共享 DTO/API → 所有登记消费者、契约和关键链路选中。 | 03/05 |
| EFF-T21 | auth/RBAC/migration/kernel → 风险升级，保留关键真实环境。 | 03/05 |
| EFF-T22 | 全局 CSS/shared UI/root provider → 保留全前端相关 Quality/Smoke。 | 03/05 |
| EFF-T23 | package/lock/toolchain/test config → 广域保守回退。 | 03/05 |
| EFF-T24 | 删除模块/测试 → base 旧归属与消费者仍参与。 | 03/05 |
| EFF-T25 | rename/空格/换行路径 → 无损解析，旧新并集。 | 03 |
| EFF-T26 | 空 diff/未知路径 → 保守 full，不误判 docs-only。 | 03 |
| EFF-T27 | 浅历史/base 缺失 → 明确阻塞或在已确认事实扩大，不编 diff。 | 03 |
| EFF-T28 | staged/unstaged/untracked 源码 → 纳入本地计划，身份变化。 | 03/04 |
| EFF-T29 | dynamic import/fixture/SQL/runtime config → 显式映射或扩大。 | 03/05 |
| EFF-T30 | PR 修改策略 → 旧最低要求加候选新增，不自我跳过。 | 03/05 |
| EFF-T31 | 重复/未知任务、依赖环/未声明模块 → 确定性、不选空；非法配置阻止。 | 03 |
| EFF-T32 | 选中却零收集/必需全 skip → 硬失败，定位 runner/路径/前提。 | 04 |
| EFF-T33 | 必需 PG/扩展/工具链缺失 → failed/blocked，不 all-skip 通过。 | 04/07 |
| EFF-T34 | 相同纯测试与输入 → reused-local 关联原 run。 | 04 |
| EFF-T35 | 同 HEAD、source/fixture/config/mode 变 → 失效重跑。 | 04 |
| EFF-T36 | lock/实际工具/OS/环境变 → 失效，环境身份可解释。 | 04 |
| EFF-T37 | 结果坏/未完成/缺日志报告 → 不复用成功。 | 04 |
| EFF-T38 | 请求复用 PG/browser/migration/Hosted → 拒绝并实际执行。 | 04 |
| EFF-T39 | 参数注入/路径越界 → 白名单与 argv 拒绝，不执行任意 shell。 | 04 |
| EFF-T40 | 多 worktree/并行报告 → 独立身份路径、不覆盖、资源受控。 | 04 |
| EFF-T41 | shadow 全量发现相关未选失败 → 记录漏选、阻止启用、补规则反例。 | 05 |
| EFF-T42 | 样本/类别不足 → 保持 shadow，不伪造启用。 | 05 |
| EFF-T43 | enforce 漏选/需回退 → 立即 full/shadow，结果诚实。 | 05 |
| EFF-T44 | Quality 并发分片 → DB/object/port/runtime/report 隔离。 | 06 |
| EFF-T45 | shard 启动/seed/执行失败 → 有诊断、有界自有清理、不误删。 | 06 |
| EFF-T46 | 错 marker/未知 PID/DB → 拒清理，不全局 kill/drop。 | 06 |
| EFF-T47 | shard 报告缺失/重复/错 SHA → 汇总失败。 | 06 |
| EFF-T48 | warmup/font/viewport/截图基线 → 原环境覆盖保留，不自动更新。 | 06 |
| EFF-T49 | serial/shard inventory → 必需测试相同、不意外漏测。 | 06 |
| EFF-T50 | Node/jsdom 分层 → DOM/provider 留正确环境、断言不变。 | 07 |
| EFF-T51 | backend pure/PG 分层 → 集成真连库、缺库失败；纯测试免无用 setup。 | 07 |
| EFF-T52 | 新 type 入口/旧 build → TS references 全覆盖，冷构建查同类错误。 | 07 |
| EFF-T53 | worker/heap/fixture → 无 OOM/连接耗尽/状态残留，收益可重复。 | 07 |
| EFF-T54 | timing/retry/wait → 真就绪，不用加 timeout/忽略失败换绿。 | 07 |
| EFF-T55 | root/module/cwd/override → 约束可发现，不假设全自动加载。 | 08 |
| EFF-T56 | 新会话任务包恢复 → 可恢复当前状态/真实证据，不重读全仓。 | 08 |
| EFF-T57 | usage 缺失/重复终态/缺子代理 → unknown 与覆盖说明，不双算/虚估。 | 04/08 |
| EFF-T58 | 完整源码交付 → 全部完整修改文件匹配候选，无秘密、不只 diff。 | 08/09 |

## 测量与最终报告

目标尚属假设：同类普通产品 L1 反馈 ≥25% 改善（历史总 CI 参考目标约 11—12 分钟）；成熟选择性 PR 5—8 分钟；纯测试/组件 P50 ≤60 秒；计划 P50 ≤10 秒；run/report 附加开销 ≤5%，短任务同时报告绝对开销；取得真实 usage 后争取非缓存输入/重复工具返回下降 ≥20%。单次 runner 资源增加 >20% 需解释，shadow 额外开销单列。已知反例漏选为零；出现一次即回退，不宣称数学无缺陷。

主要变更类别争取 ≥10 个真实样本；N<20 报中位数/范围/N，不用 P95 掩饰不足。冷/热、类别/范围/runner、队列分别统计。job elapsed = completed−started；workflow updated−created 是含结算延迟的近似端到端观察，不等于计费。并行 job 相加只可称明确口径的 runner-time，不能称墙钟；真实计费 runner-minutes 必须有实际来源，无 usage/cost 填 unknown。等待/日志量不换算 token。

最终列出真实 Issue/PR/base/head/executed tree/merge/run/attempt；已运行/未运行/blocked/not-selected 检查；独立 reviewer/范围/结论；local、Hosted、target 证据；wall/runner/token 口径和样本充分性；本轮自有临时资源处置；精确源码包和回退方式。当前 main 的相关完整验收独立报告，不能从 focused、历史、synthetic 或 PR 结果推断。历史结果只追加更正与新记录。

## 文档影响矩阵

| 领域 | 状态 | 精确路径与处置 |
| --- | --- | --- |
| 仓库入口 | Update，EFF-08 | `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`：短路由和实际新命令，保留安全规则。 |
| 计划治理 | Update，EFF-00/09 | `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、本计划与英文对应：基线、波次/PR/状态/观察与真实归档。 |
| 产品规格 | No change | `docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/product-spec.md`：仅工程交付，无产品行为/启用变化。 |
| 架构 | No change | `ARCHITECTURE.md`、`docs/zh-CN/root/ARCHITECTURE.md`：既有 runtime/port 边界保留。 |
| 质量/测试 | Update，EFF-02—08 | `docs/developer/verification-matrix.md`、`docs/zh-CN/developer/verification-matrix.md`、`docs/design-docs/testing-strategy.md`、`docs/zh-CN/design-docs/testing-strategy.md`：等价组、profile/zero-test/full、隔离与证据。 |
| 可靠性/运行手册 | Review，EFF-01/04/06 | `docs/runbooks/manual-acceptance.md`、`docs/zh-CN/manual-acceptance.md`、`docs/developer/local-development.md`、`docs/zh-CN/developer/local-development.md`：仅更新受影响诊断/日志/环境/回退程序。 |
| 安全/治理 | Update/Review | `docs/agents/agent-delivery-protocol.md`、`docs/zh-CN/agents/agent-delivery-protocol.md` 在 EFF-04/08 最小更新；复核 `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md` 的所有权/脱敏权威不变。 |
| main-red 身份前置修复 | 已更新 | 独立互链的 `docs/agents/catalog-runtime-boundary-relocation.md` 及中文文件记录独立接受的 16 对身份范围、原清单保留、收集隔离及回退；原 23 对决定不变。 |
| 前端/设计 | No change | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`docs/design-docs/ui-design-system.md`：无界面重设计；真实浏览器要求保留。 |
| 生成物 | Review，每波 | `docs/generated/acceptance-operation-evidence.md`、`docs/generated/db-schema.md`：保留既有权威；不造 operation 证据或 schema 变化。 |
| 参考 | No change | `docs/references/productization-api-contract-draft.md`：无 API 变化，不另建重复工程手册。 |
| 余留 | Review，EFF-00/09 | `docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md`：main-red/热点/观察余项优先复用既有条目，不重开历史完成计划。 |

## 文档更新门禁

完成工作包/计划前运行真实 `npm run docs:check`，明确 schema 部分已执行还是缺 PG/pgvector 跳过。CI 变化加 `npm run acceptance:ci`；Quality 元数据变化加 `npm run acceptance:quality`，元数据不等于浏览器通过。核验命令存在、路径和执行数量真实。封板前同一候选完成中英文及受影响索引；`verify:*` 入口未存在前不得写成已实现。

归档前每个 Update/Review 行必须更新或明确记录“无变化及证据”，真实余项进入既有技术债。B/C 未满足不把全项目标 completed。源码不得提交原始日志、令牌、完整环境/会话/rollout、数据库 dump 或大型运行报告。

本轮 R1 登记仅修改本文件对和两份计划索引各一条链接，不改变运行命令、门禁、业务流程、acceptance ID 或 operation ID。自身证据仅为文档/静态检查；父验证、独立审查、Hosted/merge 与后续实现证据分开记录。
