# 智能体开发与验证效率优化

> English: [English](../../../exec-plans/active/2026-09-13-agent-delivery-efficiency.md)
> 状态：**活跃观察——截至 #840 的十一个有界 PR 已合入。自然 main 运行后另行领取前端测试同步调查。所有模块保持 shadow/observation-pending，B/C 和完整 main 成功尚未成立。**
> 日期：2026-09-13。真实跟踪 Issue：[#828](https://github.com/tzrea1-Q/WiseEff/issues/828)。
> 2026-09-13 重新 fetch 后的真实 accepted base：`1059acb57379bd120d0d2b1a4b4733d4c2e02901`。它恰好等于附件的历史参考值，不构成强制回退后续工作的授权。

## 目标与设计权威

按用户提供的 2026-09-13 工程方案分批实现：安全失败诊断、等价 L1 并行、可解释的验证计划影子模式、统一执行与摘要、任务路由，以及有测量依据的测试和浏览器优化。附件是设计输入；授权来自用户当前请求，并受[交付协议](../../agents/agent-delivery-protocol.md)、[计划规则](../../PLANS.md)和[验证矩阵](../../developer/verification-matrix.md)约束。本中英文文件对是维护中的设计事实源；工作代理仅接收任务包与相关小节。

`EFF-00`—`EFF-09` 是工作包，`EFF-T01`—`EFF-T58` 是回归观察项，不是 GitHub Issue、验收 operation ID 或 ADR。每包映射真实 Issue #828 及随后真实创建的波次 PR/证据；尚未创建的 PR/run ID 保持 pending。不得重命名、重开或解锁 Catalog/Wayfinder 冻结节点。[已完成的 2026-08-18 CI feedback-loop 计划](../completed/2026-08-18-ci-feedback-loop-optimization.md)及 #523—#525 保持历史完成状态。

| 交付层级 | 完成含义 | 当前状态 |
| --- | --- | --- |
| A：工具与流程 | 诊断、等价调度、影子计划、执行/摘要与路由已审查、验证并交付 | 最小实现及有界浏览器修复已分十个 PR 合入，最终文档另由 #840 合入；随后 main-red 夹具调查保持有界并单独交付。 |
| B：模块启用 | 每个明确模块独立满足观察与审查门槛 | 无已启用模块；`observation-pending` |
| C：效果验证 | 同类真实任务/CI 样本支持墙钟、资源与 usage 结论 | 样本不足；token usage 为 `unknown` |

A 可先交付，B/C 继续开放。不得制造样本，也不能因工具合入就宣称整个项目全面完成。

## 交付后的 main 观察与有界夹具领取——2026-09-14

最终文档 [PR #840](https://github.com/tzrea1-Q/WiseEff/pull/840) 合入为已接受 main `720b61476c1a04c6af4f59876db0fea57e219fed`，tree `bf23559e04952cc813593b29802caf9ad7d2c7f8`。base `e45dc3ab941fb081ff0d6edb07668c63fffb7cc0` 和独立已审 head `02e41c33f81e52035ef0a1ad1f9dd067bcab9724` 是 [run34801076313](https://github.com/tzrea1-Q/WiseEff/actions/runs/34801076313) attempt1 实际 checkout `a071bc020edcdd414d40ff89131f0a317e4f3915` 的有序双亲。实际 docs-only 选中 Detect changed paths、Build and test、Merge bar 并通过；九个运行时 job 未选中而 skipped，没有原生测试。workflow72秒、已执行job时长之和1.05分钟是单次观察，不是账单或受控收益。独立R1接受修正文档；另行机械审查核实最终53文件源码并集及ZIP SHA256 `d5dedfe1bd024404296de6477aa6247d387579a83b9a6b35e7f62fb67ea7bca3`，无删除/重命名或私有运行产物。#828继续OPEN；封板中的MERGED状态属于PR #840。

已结束的工程main [run34799403948](https://github.com/tzrea1-Q/WiseEff/actions/runs/34799403948) attempt1 执行e45/treeb587，accepted base017。L1、Quality和visual通过；L2/Merge失败，记录44项浏览器清单失败，原archive-size安全门禁拒绝完整产物。最小诊断10331867127（666字节）上传成功，已核实run/base/head/执行/tree/attempt及ZIP SHA256 `0ed900df9b424d8bc58132449b5bc43b9de2ba2fe852be1ba233d42c34c89aea`。详细原生数量和清理终态仍unknown。workflow2515秒、已执行job时长之和71.1833分钟不能证明相对前驱58项失败的受控收益。没有原始目录后备上传或失败状态覆盖。

最终main自然运行 [run34801295912](https://github.com/tzrea1-Q/WiseEff/actions/runs/34801295912) attempt1 在L2结束前暴露一项前端失败（3410通过/1失败，441文件）。原同项目shared-working-tip场景轮询缓存节点的`aria-selected`；保存证据显示false和版本working-tip-1，但不能证明缓存节点是否仍连接。组件异步加载能够替换工作台，支持一个具体测试生命周期假设，尚不能证明flaky或产品缺陷。十一项EFF PR未修改相关源码blob；调度归因也未证明。

父代理检查竞争领取后，已[领取](https://github.com/tzrea1-Q/WiseEff/issues/828#issuecomment-5658576831)基于720的独立R1 Scratch任务包。目标是观察原重载/选择顺序，仅修复已证明的测试同步缺陷。实现者唯一源码路径为`src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx`，父代理文档范围是本互链计划文件对。使用既有deferred/repository接口和相同受控Red/Green顺序，保留全部两次create、草稿、版本、提交及角色断言。本包不授权产品/Catalog/Wayfinder、超时、重试、sleep、skip或exclude修改。若已稳定且连接的当前节点仍失败，停止夹具修复并报告实际产品边界。独立原场景、整个原文件、未改动build、直接文档治理、acceptance元数据、独立合并R1审查、精确完整源码包及原选中Hosted门禁均须在正常集成前完成。现有A交付保留；模块证据、B/C和完整main验收继续分别判断。

原获取顺序的受控复现证明缺少同步。首个探针通过并保留记录，说明快速重载不一定替换节点。下一输入通过既有repository接口和公开加载状态，让首次effective working-tip-1加载可见。节点仍在原首次tray等待后获取，点击时连接，重载后断开，原选择断言失败且当前节点未选中。这是本地受控复现，不是Hosted实际事件顺序的证明。最终最小fixture在Red/Green中使用相同释放顺序：仅移除拟增加的首次tip等待时失败（0通过/1失败/24项过滤跳过，exit1，6.054580583秒），加回后通过（1通过/0失败/24项过滤跳过，exit0，4.202227959秒）。对应源码SHA256为 `7577f95c5d685fdc7bc84e09cf6e6a7b75813ba29566620f4377e37d96bc02d2` 和 `c0c8f3bfe341e1877afd7530bdf9f1b73447d72beb564488c536758d24060bde`，基于base720/treebf235；明确属于dirty-source诊断变体，不是已提交最终验收。console探针和冗余已resolve deferred均已删除，原全部尾部断言和角色/草稿夹具保留。最终候选仍需父代理精确head上的整个文件/build/docs检查、独立R1和Hosted交付。

该Green之后，测试唯一差异是编译擦除的显式`vi.fn<ParameterTopologyRepository["getTopology"]>`类型注解。最终测试源码SHA256为 `dd0e7ea1506e65852a9851e16ad5ab033f09bbb018c6f851c22023b6b704d73b`，没有将此前聚焦Green改称执行这些字节。父代理整个文件和build证据必须绑定已提交的含类型注解候选。

## 较早交付结算——2026-09-14

已接受的实现 main 为 `e45dc3ab941fb081ff0d6edb07668c63fffb7cc0`，tree `b58755ee3b9a94cbc76169caed9dc95d42a93f72`。[58 项回归台账](2026-09-13-efficiency-regression-ledger.md) 将每个实现 PR 绑定真实 base/head/checkout/tree/merge/run/attempt，区分已证明、部分证明、接口拒绝、未采用和待观察场景。十个实现 PR 为 #830、#829、#833、#831、#834—#839。本 EFF-09 四文件文档切片及最终源码包在 [#828](https://github.com/tzrea1-Q/WiseEff/issues/828) 另行记录自身独立 R1、Hosted 和精确合入证明，不改变运行时或策略。下方历史检查点保留当时状态，不覆盖本结算。

| 工作包 | 已交付边界与剩余条件 |
| --- | --- |
| EFF-00 | 真实首次 fetch 基线1059、既有脏文件/工作树保护、实际权限/领取和失败归因；#829 登记，独立授权夹具 #830 与前置修复 #833。历史设计 SHA 从未强制回退后续工作。 |
| EFF-01 | #829 上下文最小诊断、与完整产物分离及原失败保留。未声称详细报告读取或未实演的 runner 丢失/双故障场景。 |
| EFF-02 | #831 四组等价 L1 保留原30条命令、原生凭据、稳定门禁名称/来源及严格聚合，没有选择性裁剪。 |
| EFF-03 | #834 干净已提交树预览与 #835 有界 CI 影子观察已合入。未知/不安全 Git 拒绝计划，完整原生要求保留；脏树规划、任意适配器和强制裁剪不可用。 |
| EFF-04 | #836 两个固定新鲜任务和明确未验证新鲜度的历史读取器已合入；原生发现/数量、生命周期、所有权、原子发布及拒绝检查通过，memo 关闭。 |
| EFF-05 | 下方四模块均 observation-pending。缺失类别、10/3/6、完整 main 或审查是依赖条件，不是可以虚构的代码任务。 |
| EFF-06 | 保留原有状态 Quality 和共享浏览器套件串行。#839 修复已观察夹具不匹配，没有实现或声称分片/隔离收益及等价性。 |
| EFF-07 | #838 复用编译阶段提供编辑反馈，最终仍需完整 build；#839 保留真实模拟器行为。没有采用猜测性的 Node/jsdom、纯测试/PG、worker/heap 或超时/重试调整。 |
| EFF-08 | #837 精简任务包、实际 cwd 路由、真实命令链接、历史三类恢复及诚实 usage 边界已合入，没有全局配置或工具权限变化。 |
| EFF-09 | 本互链计划/台账记录 A/B/C、精确交付、main 失败、指标、资源和回退。最终文档 SHA/run/merge/源码包在真实结算后外部记录，不写入自身被测源码。 |

| 已提交注册表模块 | 当前执行 | enforce / memo | 启用证据 |
| --- | --- | --- | --- |
| `feedback-domain` | full + shadow | disabled / disabled | observation-pending |
| `feedback-client` | full + shadow | disabled / disabled | observation-pending |
| `feedback-ui` | full + shadow | disabled / disabled | observation-pending |
| `feedback-server` | full + shadow | disabled / disabled | observation-pending |

#835 四份命令凭据不等于四个模块样本。每模块仍需至少10次实质真实变更、3次 Hosted、6个适用独立反例、全部必需类别、独立启用审查和可用完整 main 结果，并修复或证实相关 main-red 无关。没有已启用模式观察，也不声称漏选为零。由未来真实工作提供样本，不安排空提交或重复 Hosted 凑数。

[PR #839](https://github.com/tzrea1-Q/WiseEff/pull/839) 通过独立 Standards/Spec 和 run34798669471 attempt1，实际 checkout `060ffc04ff56bc55a389afc762de135105579fb5`，随后合入上述实现 main。精确 head `1aca4c6aeb6569a4ea237db3ed97e4202f5ba6dc` 的自有运行 `full-20260914t015738338z-1aca4c6aeb65-0d16c94d` 通过包括原预热在内的六项原场景，零失败/跳过/flaky，retry0。原生67.582662秒和外层127.086795秒是不同口径；原生报告 SHA256 为 `bcc8ee43b5b888280d1050e22b7f649f162d5c16a2e78fdc4de0f867313af3ea`，根及嵌套终态清理完整。build22.8290秒、元数据和直接文档检查通过。Hosted 前端3411、脚本1560加21既有可选跳过、bridge134加4平台跳过、后端4180且零跳过、Quality100、Smoke4通过，完整 schema 已检查。L2/target/minimal 未选中而跳过，不是通过；这些结果不证明全部共享 helper 调用方或完整 main 成功。

最新已结束前驱 [main run34797424920](https://github.com/tzrea1-Q/WiseEff/actions/runs/34797424920) attempt1 执行 `01703ba69f883b22e8b819182223c5fd35b90184`，tree `83db9a1accf309b9164325592f97d7e0b004fa30`，前驱 base 为 `b3ec95a4c9e327d384ce482be05c92ca0227e63a`。L1/Quality/visual 通过，L2/Merge 失败，记录58项浏览器失败且原 archive-size 门禁拒绝完整产物。诊断10330966621的 ZIP SHA256 已核实为 `f77510a4d9de06a6ea9a21a76016bf0bdca6247e917442308703eba114dab9c5`。快照保留清理/原生完整数量 unknown、自身上传 pending，实际诊断上传成功未覆盖两项失败。workflow2767秒、已执行 job 时长之和80.3833分钟，与账单分开。当前实现 e45 的 [main run34799403948](https://github.com/tzrea1-Q/WiseEff/actions/runs/34799403948) 在本封板前检查点仍运行中，不能从本地6/6或 PR 绿灯推断；最终 #828 证明刷新当前 main，较早 b3/0dd/aed 失败保留各自身份。

剩余 main-red 仍需有界诊断：历史 Knowledge POST/GET500、DTS deploy500 和 Xiaoze 持久化结果症状尚无已确认的当前根因；冻结 Catalog 定位器和符合角色权限的前置条件依赖外部 #824/启动证据。六项修复不能关闭这些类别，同数量失败也不证明同根因。#828 保留 EFF 观察责任，并链接现有开放 [TD-075/076/118](../../../exec-plans/tech-debt-tracker.md) 跟踪治理/夹具/共享浏览器债务；TD-122 保持关闭。不为获得绿灯绕过权限、环境、目标/设备/Catalog 启用或完整产物安全边界。

下表每个已接受 PR 仅 N=1，范围变化且 runner 波动未受控。workflow 时长为 updated−created，含结算；已执行 job 时长之和排除未选中任务，既不是墙钟，也不是账单。失败/拒绝候选及 main 运行另行保留，因此本表不是全项目成本，不支持受控百分比收益。

| 已接受 PR / run | Workflow 秒 | 已执行 job 分钟之和 |
| --- | --- | --- |
| [#830](https://github.com/tzrea1-Q/WiseEff/actions/runs/34760791346) | 1056 | 30.9833 |
| [#829](https://github.com/tzrea1-Q/WiseEff/actions/runs/34762290769) | 1061 | 30.8500 |
| [#833](https://github.com/tzrea1-Q/WiseEff/actions/runs/34784471686) | 1094 | 29.6667 |
| [#831](https://github.com/tzrea1-Q/WiseEff/actions/runs/34786627881) | 719 | 34.0333 |
| [#834](https://github.com/tzrea1-Q/WiseEff/actions/runs/34788103778) | 607 | 31.6167 |
| [#835](https://github.com/tzrea1-Q/WiseEff/actions/runs/34791485027) | 694 | 33.7833 |
| [#836](https://github.com/tzrea1-Q/WiseEff/actions/runs/34794729894) | 734 | 34.3667 |
| [#837](https://github.com/tzrea1-Q/WiseEff/actions/runs/34796067544) | 110 | 1.0500 |
| [#838](https://github.com/tzrea1-Q/WiseEff/actions/runs/34796686417) | 615 | 32.6667 |
| [#839](https://github.com/tzrea1-Q/WiseEff/actions/runs/34798669471) | 656 | 32.4000 |

精确9f的两个新鲜命令分别为外层2.7528秒、运行记录区间1.422秒（10/1），以及外层4.0240秒、记录区间2.853秒（29/5）。差值1.3308秒/1.1710秒包括 npm/Node 启动、Git/依赖核验、存储准备和最终发布，不是受控的直接运行基线；≤5%开销和 P50 目标尚未验证。下方历史类型 N=3 冷暖分组支持提供窄编辑入口，不证明完整交付节省。W1 的 Quality 成为最长选中 job（659秒），单次观察不足以支持未经证明的分片。全项目 token usage、子代理 usage 完整覆盖和真实计费 runner-minutes 均 unknown。

02:32:14UTC，在最后六项消费者结束后，停止并移除最后自有容器 `d1bfe7dd8f3d107b5abc54a7f8dbc09c743dbb228a4aa05d55522e1dd8fae9a5`，owner label 为 `bede0fa3-8179-47e2-b482-da4ad1dfd603`，精确 ID 不存在已核实。其 tmpfs 数据库存储随容器销毁，私有0600密码文件核验 owner/inode 后移除。较早自有夹具/诊断容器也已处置。源码工作树/分支、描述符、有界日志、失败取证产物、共享镜像和用户既有资源保留。最终文档仅移除自身临时依赖链接并按 lockfile 独立执行 `npm ci`，借用目标目录未改动。

十个已接受 PR 的源码并集为 e45/treeb587 上的51个完整文件，ZIP SHA256 `7d88448361764684d065faa71a1ad8f42646a22349693dc3dffb5b4ec0aeb39d`，含逐 PR 身份及完整字节/hash/mode 验证，无删除/重命名、日志/凭据/数据库或无关上游路径。最终文档新增两个台账文件，精确53文件总包须在合入后打包并证明。按工作包通过普通独立审查 PR 和原选中 CI 回退，优先保留完整覆盖，必要时恢复原串行调度。bypass、force-push 或重写失败历史都不是回退方式。

## 执行入口接受与路由集成——2026-09-14

[PR #836](https://github.com/tzrea1-Q/WiseEff/pull/836) 在修正 head 的 [run 34794729894](https://github.com/tzrea1-Q/WiseEff/actions/runs/34794729894) attempt 1 中，九项原有选中检查均由 GitHub Actions 返回成功后，合入为 `0dd8157682393df0514b10625660fe4cd91a406f`。base `aed7e54686e7642655b3b8c30369b9c4ad07f771` 与 head `9f8639542be150b74812a3b62c4bb56f63c21cfe` 是实际 checkout `75ada0ee7d8b6770b6bc7d8f57688640a72dbb5a` 的有序双亲；候选、执行、合入 tree 均为 `d6a9e6858a00a4d2da35d37ca4fe85cbe1f6711d`。前端 3411/441 文件、脚本 1560/110 加 21 项既有可选跳过、bridge 134/21 加 4 项平台跳过、后端 4180/539 且零跳过、Quality 100、Smoke 4 通过。冷启动夹具保留全部断言后通过，独立 Standards/Spec 均通过；十文件完整源码包 SHA256 为 `5dd698781a97184f2eeeeec543f10dca946463e0ef423e7c7fa33d5cb0f6c030`，无删除/重命名。远端分支不存在、本地 main 干净同步均已核实。

同 head 的本地 102/5 窄测试、原 build、元数据/文档均通过；新鲜任务 10/1 与 29/5、零跳过，UUID 为 `432ae04f-845f-4e9d-980a-9a00a8ffc8e9`、`d6c8cac1-30ba-42a4-8c41-4a1743ba30dc`，历史读取器仍标记新鲜度未验证。Hosted 近似墙钟 734 秒、已执行 job 时长总和 34.3667 分钟，不是账单或受控收益。此前 aed7 main 完整运行 34792256282 通过 L1/Quality/visual，但记录 58 项浏览器失败；原 archive-size 门禁拒绝完整产物，最小诊断上传成功。该次墙钟 2664 秒、job 时长总和 73.15 分钟，原生完整数量/清理细节仍 unknown；新 main 完整验收独立 pending。

路由已正常集成该 accepted main，四个原指令/协议文件保留已审 `5418af9474415fec111994accda5e46250e6271b` 的差异，现有矩阵维护实际 plan/run/report 命令范围。最终路由检查、一次独立 R1 合并审查、六文件完整源码包及单独文档 PR 在本检查点仍 pending。模块启用与 memo 关闭；下方历史记录保留原身份。

## fresh 执行器 Hosted 夹具前置条件——2026-09-14

[PR #836](https://github.com/tzrea1-Q/WiseEff/pull/836) 首次 [run 34793079528](https://github.com/tzrea1-Q/WiseEff/actions/runs/34793079528) attempt 1 实际 checkout 为 `988f978074362f0f86ace8d295aba3ba35d387b3`，有序双亲为 base `aed7e54686e7642655b3b8c30369b9c4ad07f771` 与 head `55b86395bde604b0851db58598781e667738f2b6`，tree `e38161fdf8c343c14c31e2c04568d0ec4be07077` 与候选一致。脚本 job 在 110 文件中通过 1559 项、失败一项、保留 21 项既有可选跳过；bridge 未执行。foreign-root 测试在父目录创建前调用 `mkdtemp`，因 `ENOENT` 在拒绝/marker 断言之前失败。其他夹具调用已经使用所属父目录初始化函数。这是干净 checkout 的夹具前置条件，不是已证明的运行时防护失败。首次失败继续保留，其余 job 终态单独结算。

修正仅将该调用接入已有 `testRunsDirectory()`，保留目录/owner/mode 校验及全部运行时、marker、拒绝断言。本地命名测试一项通过、24 项未选中，耗时 1.5699 秒；其父目录原已存在，故原始冷启动条件须由新鲜 Hosted checkout 验证。早先准确 55b 候选通过 102/5 窄测试、完整构建、元数据/文档，然后完成新鲜原生任务 10/1 与 29/5，零跳过，UUID 分别为 `91b9437a-9f2b-4ffd-8fd0-d37b91b1c35c`、`1410fc89-85cc-4e56-a138-f5ef95c7874a`，保存报告均明确标注新鲜度未验证。这些仍绑定 55b。此检查点的修正 head 窄测试/构建/文档、独立审查、两组新鲜任务和有效 Hosted 均待完成。不重试相同 head，不删除目录、不放宽断言，不改变门禁或运行时代码。

## CI shadow 接受与 fresh 执行集成——2026-09-14

[PR #835](https://github.com/tzrea1-Q/WiseEff/pull/835) 的修正 head [run 34791485027](https://github.com/tzrea1-Q/WiseEff/actions/runs/34791485027) attempt 1 通过全部九项原有选中 GitHub Actions 检查后，合入为 `aed7e54686e7642655b3b8c30369b9c4ad07f771`。accepted base `4ef53e5c1551747d76350cd324068fb413d462c2` 与已审 head `32d14b7e93d306dfcf905b71d7ed503e7a6d4a52` 是实际 checkout `e3dbfff629ea91c7777a7f5728f31a74dfb22efc` 的有序双亲；执行、候选和合入 tree 均为 `513f0967be7d9ebe9863acfbde4b89bd690a0fd1`。前端 3411/441 文件、脚本 1525/108 加 21 项既有可选跳过、bridge 134/21 加 4 项平台跳过、后端 4180/539 且无跳过、Quality 100、Smoke 4 均通过。四组新鲜原生观察均为 observed/full-required，完整回退且没有启用资格。独立 Standards/Spec 通过完整 14 路径候选。完整源码包 SHA256 为 `e95760c8b1148ec5ce078c6a1d7d499eba978d1ed847d7fb9c3309479e96c8d5`，无删除或重命名。已核验远端分支移除及 clean 本地 main 同步。

工作流近似墙钟 694 秒，已执行 job 时长总和 33.7833 分钟；账单及项目总 token 为 unknown。修改策略的本 PR 不计模块启用样本。此次合入前最新完成的完整 main 证据是 `4ef53e5c1551747d76350cd324068fb413d462c2` 的 push run 34789007486：L1/Quality 通过，登记 58 个浏览器失败，原有归档大小检查拒绝完整上传。诊断 artifact 10328261976 已校验摘要及身份；详细清理和原生总数仍为 unknown。完整 main 验收在该版本仍失败，单独记账。

EFF-04 代码 `56df0b6e06785503fd30ea0bf54dfe06d7b3c88f` 在关闭进程/日志结算、精确发布所有权及首错保持问题后，获得独立 Standards/Spec PASS。永久组合夹具有 19 个实际合成场景，不是 19 个新模块观察。本候选正常合并 accepted main，仅提供下文记录的两个固定 fresh 本地任务和明确标注未验证新鲜度的记录读取。此检查点的集成窄测试/构建/文档检查、最终独立审查、预期 10/1 和 29/5 的两组新鲜原生任务、自有 PR/Hosted 与合入仍待完成。下方较早检查点均为历史记录。

## 预览接受与 CI shadow 集成——2026-09-14

[PR #834](https://github.com/tzrea1-Q/WiseEff/pull/834) 在 [run 34788103778](https://github.com/tzrea1-Q/WiseEff/actions/runs/34788103778) attempt 1 的九项原有选中检查全部由 GitHub Actions 返回成功后，合入为 `4ef53e5c1551747d76350cd324068fb413d462c2`。base 为 `915f70a04c674c9d9634b72960f036be1defa486`，head 为 `84f3033f327615351e3b977cd04379c92168f2be`，实际 checkout 为 `742e70fc887718b2d15199ece33ee560ee8b28fc`；执行、候选及合入 tree 均为 `f7340bdcd81a03c7474295a0f3f5f5573275e0d7`。原生结果：前端 3411/441 文件、脚本 1432/107 加 21 项既有可选跳过、bridge 134/21 加 4 项平台跳过、后端 4180/539 且无跳过、Quality 100、Smoke 4。独立 Standards 与 Spec 均通过。工作流墙钟 607 秒，已执行 job 时长总和 31.6167 分钟；仅为观察值，不是账单或受控效果比较。11 文件完整源码包 SHA256 为 `f753dbdbb02ee286066de9894151e07019076441940a618a5a0ef6d72e1b59b5`，无删除或重命名。本地 main 已同步，远端特性分支已移除。

CI shadow 无冲突集成上述真实 accepted main。独立已审代码检查点 `4b9393617a49928e95980898f09cc22a377aff39` 在原生门禁通过后增加三个明确观察状态：适用且新鲜的 `observed`、证据失败的 `unavailable`、纯文档/非 PR 的 `not-applicable`。仅 `observed` 允许 `planValid:true`，两种拒绝状态均不选择模块或报告非零选择计数；unavailable 可保留已验证的原生完整数量。适用性由原生 Detect 决定，原生失败保留原退出码。全部原命令继续执行，四模块保持 observation-pending，enforce/memo 关闭。此文档检查点的最终集成测试、独立审查、PR 与 Hosted 尚待完成。永久原生夹具及 29 个 CLI 反例属于故障注入证据，不计启用样本。

main 验收单独记录。较早 `60f2752e78b3dc45466836b4f7b3233f0e908a2a` 的 push run 34785552162 通过 L1/Quality/visual，但列出 58 个浏览器失败。原有归档大小检查拒绝完整产物；最小诊断上传成功并未覆盖两类失败，该通道中的原生详细总数和清理仍为 unknown。工作流墙钟 2442 秒，已执行 job 时长总和 66.9667 分钟。后续 W1 main 运行继续单独跟踪。未增加原始目录后备上传、扫描放宽或重试。

### 首次 shadow Hosted 失败与输入读取修正

[PR #835](https://github.com/tzrea1-Q/WiseEff/pull/835) 首次 [run 34789687505](https://github.com/tzrea1-Q/WiseEff/actions/runs/34789687505) attempt 1 在 head `11bf5f871c46a49c74b5f6ee5fdd2770c3d41105` 失败；实际合并 checkout `792eca13758c655fdcf3b48b250b3524f676d9ff` 的 tree 为 `fb486a18a8d12d10fd074fc900c8b5acb64b0c76`，父节点依次为真实 base/head。脚本 1524 项通过、21 项既有可选跳过、一项原生 shadow 夹具失败；bridge 因此前失败未执行。前后端、Quality、Smoke 通过，Build and test/Merge bar 失败。解析后的前后端观察均为 `SHADOW_ADAPTER_FAILED`，脚本和 bridge 观察缺失。墙钟 707 秒，已执行 job 时长总和 34.75 分钟，不是计费 usage 或效果比较。

本地 Linux Node 22.21.1 管道探针复现了重开 `/dev/stdin` 时的 `ENXIO`，读取描述符 `0` 则返回相同 JSON。隔离容器禁用网络、只读运行，结束后已移除并确认不存在。这证明了匹配的传输反例；Hosted 适配器 stderr 原本被抑制，故其精确栈不可得。修正直接读取继承的描述符，保留 256 KiB 输入检查、全部原生验证和拒绝语义。现有 `readFileSync` 类型声明增加实际支持的数字描述符；`a798e07aa10b4b3d4d9e250ff0230f72e56280aa` 的编译 Red 证明需要这一行类型修正。原生夹具保留 observed 断言并保存有界诊断信息，没有放宽断言、排除、门禁、重试策略或依赖。

修正后的运行时代码 `a798e07aa10b4b3d4d9e250ff0230f72e56280aa` 通过六文件 199 项测试及 acceptance 元数据检查；类型修正完整的 `49bc60e97e9ec325c37bd72044c152d8e8635a7c` 通过原有构建（22.0427 秒）及直接文档检查。此检查点的最终独立审查和修正 head 的 Hosted 尚待完成。早先失败运行继续保留，不混同身份或证据层级，也不声称启用或完整 main 已通过。

## W1 接受与已提交树预览集成——2026-09-14

[PR #831](https://github.com/tzrea1-Q/WiseEff/pull/831) 经 [Hosted 34786627881](https://github.com/tzrea1-Q/WiseEff/actions/runs/34786627881) attempt1 的全部选中原 GitHub Actions 门禁通过后，合入为 `915f70a04c674c9d9634b72960f036be1defa486`。base `60f2752e78b3dc45466836b4f7b3233f0e908a2a` 与独立已审 head `425c5d0958a6dc8e565e973b0b3d6fbd63330297` 是实际 checkout `2eeb1cb6598ec176f5c51a1c1ce2cc786bef66fc` 的两个有序父提交，其 tree `8cddbc12cb00582dec3697c87cda45064b654f68` 与合入 tree 相同。前端/scripts/bridge/后端通过3411/1410/134/4180，skip 为0/21项既有可选/4项平台/0；Quality100、Smoke4通过，未选中 L2/目标/minimal 仍为 skipped。完整集成已获 Standards/Spec PASS，12文件完整源码包已交付，远端分支已不存在，干净的专用本地 main 已同步。main 完整验收另行判断。

工作流近似耗时719秒，实际执行 job 耗时合计34.0333分钟；这是一次观察，不是计费或统计验证的收益。后端403秒是最长 L1 组，之后汇总9秒；Quality659秒成为整体关键路径。#833 和 #831 的候选/runner 不同，不构成受控性能配对。Quality 保持串行，直到真实隔离、原生清单、安全产物契约及可比自有环境证据支持改变。全项目 token 与计费 runner-minutes 仍为 unknown。

本次独立 EFF-03 预览将已审 `7286c02ed9d25b75a8cf020aa614e9c26cfc843c` 集成到 accepted W1。`npm run verify:plan -- --base <full-sha> [--head <full-sha>]` 为干净且已提交的仓库根目录生成有大小上限、不执行任务的 JSON。Git 元数据先于 filter/status/diff 校验；无法解析、dirty、浅历史、partial、sparse、未合并索引、gitlink、外部根目录或不安全配置事实均拒绝有效计划。dirty 工作区计划不属于本次最小配置。未知/删除/共享/策略影响保守扩大，全部17项原任务仍必需，四个 feedback 模块均为 observation-pending，memo/enforce 关闭。计划不安装依赖、不初始化数据库、不改变 CI 选择；另行 run/report 候选合入前继续使用已有执行命令。三类手工历史差异核验仍绑定其实际提交，不作为新 Hosted 或启用证据。新的定向检查、构建、直接文档治理和独立集成审查先于本预览自身的 PR/Hosted。

CI shadow `4b9393617a49928e95980898f09cc22a377aff39` 已获独立 Standards/Spec 代码 PASS，含29场景实际 CLI 收尾表，尚未合入。执行器修正已真实复现并解决三个具体生命周期/发布失败，其余组合矩阵与最终审查仍待完成。浏览器夹具 `fff3807b6783bbe3aa08b348050c23e359050ab4` 已就另行记录的2/2代表性运行获得独立双审代码 PASS，不代表完整浏览器验收。以下旧条目均为历史检查点，不覆盖当前状态。

## 前置合入与等价 L1 刷新——2026-09-14

[PR #833](https://github.com/tzrea1-Q/WiseEff/pull/833) 经 [Hosted 34784471686](https://github.com/tzrea1-Q/WiseEff/actions/runs/34784471686) attempt1 成功后合入为 `60f2752e78b3dc45466836b4f7b3233f0e908a2a`。accepted base 为 `9dc751690a615b162bb41feef6392289b2ca7f6a`，已审 head 为 `a7841dc64d3f9a1b5e34ead72fa3d5f5eb68241a`；实际 checkout `087e82df4555a0b6abc76e8cb38b66d5a2719d82` 的两个有序父提交正是该 base/head，tree `7c105b5cc510f30f5d227da1acee3ad268632c64` 与合入 tree 相同。所有原有选中 GitHub Actions 门禁通过。前端/scripts/bridge/后端原生 pass 为3411/1349/134/4180，skip 分别为0/21项既有可选/4项平台/0；Quality100、Smoke4 通过。schema/docs、边界、contract、log evaluation 成功；未选中 L2/目标/minimal 仍为 skipped。独立代码 Standards/Spec 与最终双语文档审查通过。远端功能分支已不存在，origin/main 和干净的专用本地 main 已同步。

Build and test 在原20分钟上限内用时1037秒。工作流近似耗时1094秒，实际执行 job 耗时合计29.6667分钟，不是计费或已验证优化收益。两个 skipped job 的 API 时间戳倒置，未计入 runner 时长。GitHub 重新打开 PR 时还产生旧 head 事件34784471274，6秒后取消、未执行测试步骤，不计验证或观察样本。全项目 token 和计费 runner-minutes 仍为 unknown。

W1 现将 accepted main `60f2752e78b3dc45466836b4f7b3233f0e908a2a` 集成到另行审查通过的 `51aaa732e93b31d3e047b72d568581b7b4d90ab0` 候选。仅中英文当前状态段落冲突，两边历史台账均保留。原30命令映射及固定四组等价执行不变，不启用测试选择。刷新后的定向检查、build、文档及独立增量审查完成后，才执行关闭中的 PR #831 已获准的第二轮 Hosted。main 完整验收单独判定，不能由 #833 选中 PR 门禁建立。四个 feedback 模块均 observation-pending，enforce/memo 关闭，有状态 Quality 保持串行。

CI shadow 候选 `2fb1403217e2bb4dbad4547d4cf5e7234148e976` 在六文件通过199/199项及 build/验收元数据/直接文档治理，最终复审仍要求完整永久 CLI 矩阵。执行器 `3da80962e469b372971c35ffa90a51f9c568ad3f` 虽通过80项定向检查，但正常记录发布和部分日志打开生命周期路径被独立审查拒绝，不能据此封板。语义夹具候选 `fff3807b6783bbe3aa08b348050c23e359050ab4` 在新自有运行时通过原上传/列表/同步场景加 warmup 共2/2，产物验证和清理完成；这不建立完整浏览器验收。以下早期检查点保留为历史。

## 最终前置身份跟进——2026-09-14

最终检查在 push 前拒绝了 `fc776086a9c163ec048a231133cc6292bbfbda8c`：已审测试事务包装还移动了 29 个已有出现位置身份。[独立固定身份决定](../../agents/catalog-runtime-boundary-relocation.md#post-cutover-测试身份跟进) 保留每个原始切片、allowance 和原 39 对记录。实现 `135a4edada7fcff307136496619813c2e6f66769`、tree `5388cb81093c3a2810331f757e14431343748219` 通过 93 项定向测试、3513 条 allowance 与 68 对 relocation 的直接检查、build 及直接文档治理；新增 29-record 契约先证明了真实断言失败。五文件增量不修改后端源码，下述完整 4180 项后端证据仍绑定 `69fd38c152108f610786b269e9337e57f73a24bc`。

父代理已收齐精确五文件代码增量的独立 Standards、Spec PASS，包括有限畸形输入反例及独立重算的记录/blob/端点证据。原候选与后端增量也已分别通过两个独立角色审查；最终中英文文档单独复核。尚无第二轮 Hosted 或合入。PR #833 在新候选封板前仍保持关闭及原远端 head，已接受的一次第二轮 Hosted 例外尚未使用。刷新 origin/main 后仍为 `9dc751690a615b162bb41feef6392289b2ca7f6a`；实际保护查询没有受保护分支配置或有效规则。父代理仍要求全部原有选中门禁成功，不使用 bypass，不将 skipped/missing/cancelled 算作通过。

CI shadow 第二轮审查拒绝了将 unavailable 观察判为有效的布尔结算。新候选 `170399645bc781ec2c37de974f38afed6c9f4653` 使用原生 Detect 权威和 observed/unavailable/not-applicable 三态，待独立审查。执行器 `a0c51833052bbdea1b7f1dbe8dc1427e0b11a1e8` 被真实延迟关闭反例拒绝，现按独立质询过的有限生命周期/存储设计实现。两者均留在 Scratch。另一路语义浏览器夹具诊断在修复草稿读取后暴露缺少显式 coverage；随后尝试读取实际 review DTO 不存在的字段，仍为 2 项中 1 项失败，均不是浏览器验收通过。处理这些问题未删除断言、golden、安全限制或必需检查。

## 后端前置修复跟进——2026-09-14

[PR #833](https://github.com/tzrea1-Q/WiseEff/pull/833) 在 Scratch 修复期间保持关闭。首轮 [Hosted 34778960993](https://github.com/tzrea1-Q/WiseEff/actions/runs/34778960993) attempt1 实际 checkout 为 `33c15d4c43e86dac5a20648a18e0618222fa5750`、tree 为 `bd9f8d0491579a325f8315af0cac3dab5138905f`，父提交为 main `9dc751690a615b162bb41feef6392289b2ca7f6a` 与已审 head `1daf8bd52ab5b56902adff379a6f30fe631e95d4`。它在出现六项明确后端失败后被原有 Build and test 20 分钟上限取消。前端3411、scripts1338（21项既有可选跳过）、bridge134（4项平台跳过）、schema、Quality、Smoke 通过；后端没有完整终态计数，contract/log evaluation 未完成，Merge bar 失败。工作流耗时1284秒、job 耗时合计34.7667分钟是观察值，不是计费或收益。

[已领取的跟进](https://github.com/tzrea1-Q/WiseEff/issues/828#issuecomment-5655955231) 在原 head 上复现6失败、0通过、66项定向未执行。独立源码诊断确认夹具前提缺口：auth 查询断言遗漏新增 capability 查询；受限 Agent 登录缺少读取 `roles(id, permissions)` 的权限；四处写回测试向既有 AuditTx 契约传入了根 Database。另一静态误报来自固定 Catalog schema 与表名分开书写。限定候选保留全部原有安全断言，增加精确 auth 查询断言，使用既有事务包装，仅授予夹具所需两列读取，并将原来三张固定授权表写成完整限定名。原扫描器、allowances、生产 auth/事务代码、权限集合、workflow 和 timeout 不变。Catalog/Wayfinder 冻结节点及 #824 未改动。

代码 `69fd38c152108f610786b269e9337e57f73a24bc`、tree `4c5fe2bd5f72cb63b619ba942d723907699361ca` 通过完整原有后端集合：**4180/4180项、539文件、零失败/跳过**，配置两 worker，进程墙钟277.6545秒。该集合包含五份失败文件及两份既有 provisioner/ACL 文件。原生报告 SHA256 为 `c7f4d303f892e8ed3533a6f8f42c3b0a85bda7ee37a6131bb9c2e34b85d57083`。build 与直接文档治理通过。独立设计和 Standards 代码审查通过；本检查点的最终 Spec/封板及新 Hosted 仍待完成。早期诊断控制器设置了未被读取的 worker 变量，实际使用本机默认4；其计数/耗时真实，但不构成 worker 对比。临时 PG 仅为自有本地 pgvector 容器及一次性原生测试夹具，不构成生产/目标操作证据。

父代理依据用户解决阻塞的授权，接受一项限定 run-profile 修订：继承的夹具失败取得完整本地后端证据和独立双审后，允许 #833 的第二次最终 Hosted。首轮取消导致后续后端结果未知，但六项失败本身并非只能在 Hosted 观察。此项是修复候选的明确例外，不是盲目重试或第三轮许可。成本仍受原有 job 上限和完整验证范围约束，后续记录实际 job 耗时。再次失败则退回 Scratch 诊断。

CI shadow 返工 `bec050199d1f9af7fb25f78047cd0ac20aa85176` 在首次双审 FAIL 后进入独立复审。Fresh 执行器 `0a111f62befc5e2c1c9c86a193f493e9f04a3e0f` 同样双审失败：取消/管道收尾、存储、依赖复核和必要反例测试需要修复；其10/29项原生通过不能证明这些约束。两者均未合入。路由候选 `5418af9474415fec111994accda5e46250e6271b` 另在自有夹具上通过此前 blocked 的四文件后端路由检查24/24、零跳过、3.2427秒；这不是完整后端证据。

收集修复代码 `07be2ecddba7614724728c7bf05dae1826793034` 的自有本地 Gate0 诊断终态失败：browser95通过/58失败/43跳过，visual16通过/4失败，均无 flaky。完整产物收尾达到 ZIP 条目数量安全上限，没有上传原始目录兜底。API/frontend 已停止，随后移除了自有容器和临时连接凭据，保留私有取证文件。独立侧栏定位器候选 `fd9804d753ec1cca1e4c1368cb8525bbec606235` 在新的自有运行时通过原有三个 feedback 场景加 warmup 共4/4，清理完成；后续夹具改动不能继承该 SHA 的通过。当前 main 仍为9dc且完整验收失败。这些失败不授权更新 golden、重试或遗漏必需场景。

四个 feedback 模块均保持 `observation-pending`，预期为 shadow/full，enforce 和 memo 关闭。两次历史观察中 Quality 比 L1 提前322秒/517秒完成，因而 W1 之前的浏览器分片没有已证明的关键路径收益；保留有状态 Quality 串行，等待已接受 W1 的观察支持限定试验。计费 runner-minutes 和全项目 token usage 仍为 `unknown`。以下旧检查点保留原有证据边界。

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

### W0 交付核验与 W1 刷新

PR #829 于 2026-09-13 合入为 `ef88c0964e158d7effbd0ce6062260e5eb1c5a21`。accepted base 为 `75f3514b213f07f177773a077021e1485f9f173b`，head 为 `fb6087f1fdb352953f63b46ca711cee5775e2607`，该 head 的独立 Standards、Spec 审查通过。刷新后的 [run 34762290769](https://github.com/tzrea1-Q/WiseEff/actions/runs/34762290769) attempt 1 中，所有选中的原有 GitHub Actions 检查成功。实际 checkout `41de2cbb95d788168d97d7b8e52711ffbd0dfa63` 的 tree 为 `652590339d4a16415d935b624753fa7c68421a11`，两个父提交精确对应 base/head。完整 schema 文档在自有 Hosted pgvector 上核实为 current。原生前端/scripts/bridge/后端分别为 3411/1279/134/4168 pass，仅保留既有 scripts 21 个、bridge 4 个可选或平台 skip。未选中的 L2/target/minimal 任务仍为 skipped。

工作流耗时近似值为 1061 秒，各已完成 job 耗时之和为 30.85 分钟；计费 runner-minutes 和总 token 仍为 unknown。远端特性分支已不存在，origin/main 和干净的专用本地 main 已同步，Issue #828 保持开放。新 main [run 34763446467](https://github.com/tzrea1-Q/WiseEff/actions/runs/34763446467) 正在执行；本 PR 结果不构成完整 main 验收，也未执行 L2 诊断。

W1 使用 accepted main `ef88c0964e158d7effbd0ce6062260e5eb1c5a21` 刷新。唯一文本冲突合并受审的四组 L1 矩阵行和已接受的 W0 诊断 L2 行。完整 L1 `docs:check` 仍映射至 `l1-server`，在其自有 pgvector 前置步骤后运行；本地刷新仅直接执行文档治理。自动合并后的运行时代码和测试必须通过窄检查及两项独立增量审查，才可创建 PR。选择器、memo 和浏览器分片均未启用。

### W1 首轮 Hosted 失败与有界恢复

[PR #831](https://github.com/tzrea1-Q/WiseEff/pull/831) 在 82 项 focused、build 和两项独立审查通过后，以 `4da08326b4ab34ab25347f740df7c73f1ff95d84`、tree `eca3dc042446cc897190efcc9a4009ae6e21f71c` 创建。[Run 34763864420](https://github.com/tzrea1-Q/WiseEff/actions/runs/34763864420) attempt 1 失败；实际 checkout `d17cec6878d2ed9790a326482cfec148cd877ce0` 的 tree 及 base/head 双亲一致。前端 3411、后端 4168 项通过，后端 schema 文档为 current；scripts 为 1330 pass/21 个既有 skip/1 failure，bridge 未运行。Quality、Smoke 成功，两项稳定聚合门禁正确失败。工作流耗时近似值 664 秒、各 job 耗时之和 33.2833 分钟，不构成等价成功的性能样本。

父代理收齐两个失败后再完成最终修正：一个工作流守卫仍在旧聚合 job 中寻找可信基线 checkout 深度；GitHub 还在两个有 service 的 job 的 `steps` 上下文中加入匿名平台步骤，导致严格回执拒绝本已成功的后端调用。PR #831 已关闭并返回 Scratch。`462ae0243a25cf13b6484f872a58e98cac15a24a` 将工程守卫限定在真实的 `l1-static` job，全部 75 个断言及可信基线要求保留；没有修改 Catalog 业务、source-lock、allowlist、夹具或冻结节点。

独立 R3 设计挑战通过后，`5591b788f5cab80699abc1c7e65293fe8a757fe3`、tree `21ed4ab41e6f85beaacce47473a4e0c310965c39` 在四组工作流回执中显式投影全部 30 个命名步骤。运行时校验器字节不变；结构守卫拒绝缺失、多余及错误来源的投影项，所选 child 失败仍阻止聚合。该干净代码候选的四个 focused 文件 114 项通过、无 skip，验收元数据、build 和直接文档治理通过。本检查点仅追加文档；最终独立审查及精确候选 Hosted 仍必需。平台上下文失败支持重新封板后的第二轮 Hosted 例外，首轮 run 保留且不重试；本修正包不授权第三次 Hosted push。

W2 的 `fbc550c7be65f723087fae2d576daf9260e1a98a` 再次未通过两项独立审查，问题涉及原生证据真实性、项目 npm 配置，以及空分组、纯任务容器探测和 advisory 处理。同不变量 P1 熔断使其返回 THREAT-READY。新设计已独立挑战：执行与汇总共用原生校验，绑定 invocation/run/plan，拒绝不受控 npm 配置和零执行，限制 advisory 例外；仅在此设计内重新实现。本地工具为 W2a，CI shadow 投影另作 W2b PR，在 W3 集成前完成。memo 仍关闭。

EFF-06 在有实际测量的有界评估未通过独立隔离设计挑战后，保留 Quality 串行。双 runtime 生命周期、共享生成文件收尾、精确安全 ZIP、原生测试身份及同环境配对成本证据仍未建立。两份各 100 项通过的历史观察支持热点调查，不支持启用分片，也不是无收益结论。本评估未启动新的 runtime/DB/browser 资源。

Main [run 34761775820](https://github.com/tzrea1-Q/WiseEff/actions/runs/34761775820) attempt 1 实际执行 `75f3514b213f07f177773a077021e1485f9f173b`、tree `6887ac7b8c43048fb1ba93dde047083cdb7ed172`，L2 失败：visual 成功，browser 报告 57 个 inventoried failures，完整 ZIP 超过未改变的安全限制。缺少完整产物，单项浏览器原因仍为 unknown；失败总数相同不能证明原因相同。本检查点时 W0 main run 34763446467 的 L1/Quality 成功，L2 仍执行中；完整 main 验收和模块启用尚未成立。

### 当前 main 刷新与诊断实际交付

外部 [PR #832](https://github.com/tzrea1-Q/WiseEff/pull/832) 将 main 推进至 `9dc751690a615b162bb41feef6392289b2ca7f6a`，tree `a0edd814abc6fd73b03d0470641e416b04031195`。父代理接受此真实基线、保留全部新增修改，并快进干净的专用本地 main。W1 在 `e34b8942345c6b5adc9e32669df608f498d35de9` 无冲突合入该基线。这不代表其验收通过。

两份独立审查针对 W1 `3ff42ee3399d2f45aaf22b158d13351cd1111726` 发现同一项 P2：删除命名步骤 JSON 投影中的所有空白会改变键名语义。`docs` → `do cs` 变异逃过结构守卫，但未改变的运行时仍会拒绝。Luna 仅修复结构守卫及其测试，在 `f1c047166887daac26074fcc3a28cc8750ac9268`、tree `57d5d6e8ac50e95f3364652c69950d2837b5766c` 改为规范文本比较并仅 trim 首尾。Red 为 1 失败/36 未选用例；Green 工程检查为三文件 91 通过。验收元数据、build 和直接文档治理通过。已知失败的 Catalog 清单测试没有重复运行，也没有算作通过。本检查点仅新增中英文计划，仍须新的独立审查与封板。已关闭的 PR #831 没有第二次 Hosted push。

当前 main [run 34764166242](https://github.com/tzrea1-Q/WiseEff/actions/runs/34764166242)、attempt 1 失败。拓扑 ingest 控制流与 Binding DTO 修改后，脚本清单守卫出现 16 个未许可 occurrence 和 16 个陈旧许可。只读 checker 在精确 main 上复现；原有 23 条已审精确 relocation 仍通过。token 切片相同不构成周边语义变化或新增例外的授权。独立审查结论：须由 Catalog owner 按其交付流程解决源码与守卫契约，EFF 不得初始化或放宽冻结白名单。同一运行的浏览器收集因新隔离交付 spec 在模块加载时要求 `WISEEFF_CATALOG_DELIVERY_EVIDENCE` 而失败。原生 suites 和全部测试计数为零，并含顶层收集错误；Gate 0 和 Merge bar 正确失败。脚本失败后 backend、bridge、contract 与 log 检查未执行。Quality 和 visual 通过。两项外部失败阻塞后续 EFF Hosted，本地工作继续；不增加 exclude 或伪造环境证据。

最小诊断已在自然 main 运行中实际触发。W0 main [run 34763446467](https://github.com/tzrea1-Q/WiseEff/actions/runs/34763446467)、attempt 1 执行 `ef88c0964e158d7effbd0ce6062260e5eb1c5a21` / tree `652590339d4a16415d935b624753fa7c68421a11`：L1/Quality/visual 通过，browser 记录 57 个失败，完整产物被既有 ZIP 体积上限拒绝。独立诊断产物 `10320930710` 上传成功（665 字节；SHA256 `a503fdd9d59ac4a8e55e892e3dbe71f872cc760727dfce3721300a0589cebd83`）。当前 main run 34764166242 同时上传了安全完整产物和诊断 `10319754232`（664 字节；SHA256 `bd0cff4f934d0b93164cb99b35fb204c50628b20048a938f06b54c2632f34c5b`）。父代理核验了归档摘要和诊断中的 run/attempt/base/head/执行 SHA/tree；上传终态来自 job steps，不改写不可变诊断中如实保留的上传前 `pending`。主执行失败仍是失败；上下文诊断中的清理和详细测试计数仍为 unknown。未为观察重试任何一次运行。历史相同的 57 个失败总数不能证明具体原因相同。

上述两次 main 的 job elapsed 求和分别为 71.9333 和 22.9667 分钟；这是资源持续时间观察，不是计费分钟，也不是可比优化收益。Actions timing API 对此前五次已结束的本项目运行报告 billable 毫秒为零，仓库为公开仓库；这是 API 字段，不是零资源消耗或已审账单的证明。全程 token 仍为 `unknown`。Gate 0 报告失败的 Hosted runtime 资源被保留，不能推断本地有清理所有权。

重新设计的 W2 本地候选 `c5936a99683ecf306f549e579afb02aee6740edf`、tree `d066686a85ecf96f5ef16e6433ffe351fbd5426c` 在执行和保存结果聚合时复用固定 W1 原生验证器。开发者报告 24 个聚焦测试、build 与文档治理通过，另实跑纯脚本 10 测试/1 文件和 UI client 29 测试/5 文件。Backend 两个任务及 Quality 一个任务仍因资源所有权未证明而 blocked。两份独立审查尚待完成，这些观察不构成 W2 封板或完整验收。W1 helper 在其合入前仍是已披露的只读未跟踪依赖。

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

经独立威胁审查的 W0 最小实现已由 #829 合入。输入限定为 `workflow-context-only`：workflow 内嵌 `/usr/bin/python3 -I` 发布器不读候选报告，在 checkout 后、npm 前记录真实 SHA/tree，未观察的阶段、清理和测试数量保持 unknown。精确候选 `fb6087f1fdb352953f63b46ca711cee5775e2607` 通过 77 项窄测试、build、元数据/文档、独立双审和选中 Hosted run 34762290769 attempt 1。后续 main 自然失败另行证明：完整归档被拒绝时，安全最小诊断仍能上传；这不证明详细报告投影。L2 新增身份记录 1 分钟和生成/兜底/上传/结算 4 分钟，原必需预算下限 146 变为 151，总 job 预算变为 155 分钟；不缩短任何旧步骤预算。详细报告读取如有需要仍是单独审查的扩展，回归台账保留未实演的失败注入限制。

原始 stderr、环境、请求响应、DB URL、浏览器 HTML/storage、令牌、代理认证和工作站绝对路径不得进入投影。标题、路径、异常文本均不可信。默认 JSON ≤64 KiB、人读摘要 ≤4 KiB、失败 ID ≤20；可选摘录每条 ≤1,200 字符，仅在专用白名单/脱敏校验后输出。优先不用自由文本；安全无法确认仅输出固定码。

候选诊断必须通过 accepted policy 校验。生成器/校验器失败，以可信 workflow run/attempt/job 和固定 `DIAGNOSTIC_REJECTED` 收尾，不回显拒绝字节。限时收尾尽力上传最小结果；完整证据仍须既有安全 finalizer。摘要上传成功不改变执行/清理失败；SIGKILL、runner 丢失、收尾超时可导致 incomplete。反例覆盖合成凭据、ANSI/标题注入、超大/损坏/缺报告、越界/symlink、双失败、超时和清理失败，禁止使用真实秘密。

### D2 — 等价 L1 拆分（EFF-02）

首批固定 `static-build`、`frontend-tests`、`backend-tests`、`scripts-bridge-tests`，与既有 Quality/Smoke 并行。建立逐项旧步骤→新组台账，包括 `acceptance:ci`、DTS toolchain、advisory seed compile、build、docs、UI ratchet、lint、frontend、pgvector、scripts、trusted-base boundary、bridge、backend、contract、logs eval。只保留原有 advisory 例外，不扩散。逐个追踪 Scripts/docs/schema/contract 的 PG/工具链依赖，独立配置环境，不能共享可变数据库。

对外保留 `Build and test` 严格聚合及 `Merge bar`。始终结算、显式依赖全部必需组，核对预期组身份/报告完整性，要求每个选中组 `success`。未选择为 `not-selected`；required skipped/neutral/missing/cancelled/timed_out 不通过。Detect/plan 失败不能生成空绿。保留 full/manual/Quality/Smoke/L2 关系。报告最长路径和测试清单；并行墙钟改善不自动等于 runner-minutes/token 减少。

### D3 — 可解释影子计划（EFF-03/05）

已实现的最小 profile 使用以下准确命令。原方案中的 edit profile、任意计划输入、分组选项、输出路径/格式选项及 enforce 尚未实现。其他任务继续使用验证矩阵中的原生命令：

| 已实现命令 | 契约 |
| --- | --- |
| `npm run verify:plan -- --base <40-hex-SHA> [--head <40-hex-SHA>]` | 对 clean 已提交根目录输出有界只读 JSON，保留完整必需任务集和验收待完成状态。不执行测试、不探测环境、不自动 fetch。 |
| `npm run verify:run -- --base <40-hex-SHA> --task <ci-changed-paths\|feedback-frontend-client> [--force]` | 重新发现并执行一个固定手工任务，记录准确身份、本地原生证据及有界终端输出。`--force` 也始终重新执行，不执行或替代完整计划。 |
| `npm run verify:report -- --run <UUID>` | 读取 `work/verification-runs/<UUID>` 中的所属记录，标注 recorded-local-data/freshness-unverified。不隐式重跑、复用结果、授予验收或调用模型。 |

薄入口 `scripts/verify.ts` 分派原有预览及独立的 `scripts/verification/run.ts`、`report.ts`。固定任务定义复用原生 Vitest 调用、报告校验与所属进程清理。PG、浏览器、Hosted 和目标环境保持原生入口，memo 与模块 enforce 继续关闭。下文较大设计属于未来契约，不代表已经实现 dirty 计划或任意适配器。

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

### EFF-08 检查点——2026-09-14 路由与恢复

[English checkpoint](../../../exec-plans/active/2026-09-13-agent-delivery-efficiency.md#eff-08-checkpoint--2026-09-14-routing-and-recovery)

本次有界路由候选位于 `codex/efficiency-w3`，base 为 `aed7e54686e7642655b3b8c30369b9c4ad07f771`，HEAD 为 `66e093a58ca599541e7c3cb9f9112947feca2cbd`，tree 为 `03437e2517706981f89686122d93ea6f0c2a1c61`；本次文档改动前 worktree clean。四文件路由增量是 `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`、`docs/agents/agent-delivery-protocol.md`、`docs/zh-CN/agents/agent-delivery-protocol.md`。从仓库根到真实任务 cwd 的实际链路中，每层依次检查 `AGENTS.override.md`、`AGENTS.md`、已配置 fallback 名称，并选取首个非空文件；已检查候选和选中路径必须写入交付记录。这是可观察的发现链，不声称从根目录启动会自动加载所有深层指令。

任务/恢复 packet 限制为 ≤6 KiB，携带精确 cwd、branch、base/head/tree、所有权、可编辑路径、范围引用、命令/预期 exit、证据级别、结果引用、缺失证据、阻塞者/负责人和下一状态。完整日志、凭据、数据库、原始工具内容和私有推理留在 packet 外。每个有界单元最多记录一个运行时报告的数值 usage；本检查点没有已验证 token 或节省总量，缺失、重复或子任务 usage 均保持 `unknown` 并注明覆盖范围。

保留的恢复证据是历史且有界独立证据：在 `636ebbd093ab89e3c8b760dcec134fe7d6ca4b60`，三个 UI 文件覆盖 15 个观察、两个脚本覆盖 54 个观察；后续 PostgreSQL 切片在 `5418af9474415fec111994accda5e46250e6271b` 覆盖 24/4 且零失败。这些是历史恢复观察，不是本次新执行，也不证明模块已启用。PR #835 已合入，#836 Hosted/最终集成仍 pending；本检查点不新增 PostgreSQL、启用或最终合入声明。父协调者仍需在合入后完成精确源码包及其有界检查。

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

## 编辑期类型反馈候选——2026-09-14

本候选正常集成路由 [PR #837](https://github.com/tzrea1-Q/WiseEff/pull/837)，accepted main 为 `b3ec95a4c9e327d384ce482be05c92ca0227e63a`。其 head `0138b450af9116cde25b28096ff9f3ee569bb017`、base `0dd8157682393df0514b10625660fe4cd91a406f` 已通过独立 R1 合并审查及 [run 34796067544](https://github.com/tzrea1-Q/WiseEff/actions/runs/34796067544) attempt 1；实际 checkout `b3d37c067023f12337cc8eb63c03c3b6a6bbe4af` 与合入 tree `56096bff648856c5f93b5d2f121b81263d47a27f` 一致。原生 Detect 判定 docs-only，三项选中 GitHub Actions 门禁成功，九个运行时 job 保持未选中/跳过；该文档 PR 未执行原生测试。六文件完整源码包 SHA256 为 `56095b5ee40afc48417ef1bd1d361a418a8cbe6bf9dbe67284ad4e5e85b2887d`，无删除/重命名；远端分支处置及本地 main 干净同步已核实。近似墙钟 110 秒、已执行 job 时长总和 1.05 分钟仅为文档观察，不是运行时节省。独立类型候选仍需新鲜编译/构建检查及自身审查/Hosted；当前 main 全量验收单独报告。

EFF-07 新增 `npm run typecheck`，内容精确等于原 build 的 4096 MiB `tsc -b` 阶段。完整 `npm run build`、Vite 阶段、项目引用、依赖、测试环境与最终门禁均不变；互链验证矩阵区分编辑反馈与完整构建证据。已审代码 `40b32b19b754d108855884db8973e4cc1f1ad2ad` 仅含一个 package 入口和两种语言各一行。两个引用的 TypeScript 项目分别植入真实临时类型错误后，两入口均拒绝；Green 前已移除夹具。最终 main 集成、编译/构建检查、独立合并审查及单独 PR/Hosted 在本检查点仍待完成。

历史测量身份为 `66e572a4c45bd5d4db164380a2200e7ee6c10ac4`，tree `26b7acc0e03a07922e57fe688ca285eb6a741346`，Node 22.22.3。十二次成功观察来自每命令三次冷、三次热运行，与两个项目的 Red/Green 检查分开。build 冷中位数 24.9584 秒（范围 19.7086—48.0473）、热 27.9905（19.0264—39.0767）；类型阶段冷中位数 10.0697（9.9535—22.7207）、热 12.7272（9.4969—36.0767）。冷仅移除两个自有增量编译缓存，OS/依赖缓存仍热，并发宿主负载未受控。这些各 N=3 的分组支持提供窄命令，不能证明当前 head 的提升、CI 节省或 C 层完成。token 与计费 runner-minutes 为 unknown；不据此采用 DOM/pure-PG 拆分、worker/heap 调优或浏览器分片。

## 测量与最终报告

目标尚属假设：同类普通产品 L1 反馈 ≥25% 改善（历史总 CI 参考目标约 11—12 分钟）；成熟选择性 PR 5—8 分钟；纯测试/组件 P50 ≤60 秒；计划 P50 ≤10 秒；run/report 附加开销 ≤5%，短任务同时报告绝对开销；取得真实 usage 后争取非缓存输入/重复工具返回下降 ≥20%。单次 runner 资源增加 >20% 需解释，shadow 额外开销单列。已知反例漏选为零；出现一次即回退，不宣称数学无缺陷。

主要变更类别争取 ≥10 个真实样本；N<20 报中位数/范围/N，不用 P95 掩饰不足。冷/热、类别/范围/runner、队列分别统计。job elapsed = completed−started；workflow updated−created 是含结算延迟的近似端到端观察，不等于计费。并行 job 相加只可称明确口径的 runner-time，不能称墙钟；真实计费 runner-minutes 必须有实际来源，无 usage/cost 填 unknown。等待/日志量不换算 token。

最终列出真实 Issue/PR/base/head/executed tree/merge/run/attempt；已运行/未运行/blocked/not-selected 检查；独立 reviewer/范围/结论；local、Hosted、target 证据；wall/runner/token 口径和样本充分性；本轮自有临时资源处置；精确源码包和回退方式。当前 main 的相关完整验收独立报告，不能从 focused、历史、synthetic 或 PR 结果推断。历史结果只追加更正与新记录。

## 浏览器夹具交付候选——2026-09-14

本候选正常集成已接受的类型反馈 [PR #838](https://github.com/tzrea1-Q/WiseEff/pull/838)，合入为 `01703ba69f883b22e8b819182223c5fd35b90184`。base `b3ec95a4c9e327d384ce482be05c92ca0227e63a` 与已审 head `7fc675e13fe88888c998ae12297428f50764a48d` 是 [run 34796686417](https://github.com/tzrea1-Q/WiseEff/actions/runs/34796686417) attempt 1 实际 checkout `56717e28ecdfa73593b817736112717df7f89ca6` 的有序双亲；执行/候选/合入 tree 为 `83db9a1accf309b9164325592f97d7e0b004fa30`。九项原有选中 GitHub Actions 检查均通过：前端 3411/441 文件、脚本 1560/110 加 21 项既有可选跳过、bridge 134/21 加 4 项平台跳过、后端 4180/539 且零跳过、Quality 100、Smoke 4。未选中 L2/target/minimal 仍 skipped。独立 R1 Standards/Spec 均通过，同 head 本地 typecheck 与原完整 build 通过；五文件完整源码包 SHA256 为 `c46c50556c119b94e831b4ec2164b91e45bb058e52f5853b7a27df0c0e1eb494`，无删除/重命名。远端分支不存在、本地 main 干净同步已核实。近似工作流墙钟 615 秒、已执行 job 时长总和 32.6667 分钟仅为一次观察，不是账单或受控收益。本独立浏览器候选仍需新鲜六项原生证据、build/docs、独立双审及自身 Hosted；main 全量验收单独报告。

本 EFF 阻塞修复仅涉及三个测试/夹具路径。反馈入口将具名按钮限定到实际导航侧栏，保留原三项场景和 28 个断言。共享语义夹具以治理视图打开草稿，通过原 store/事务 helper 读取精确持久化 review task，以非空 compatible 值提供原 API 要求的显式 overlay 覆盖声明；不改 DTO、SQL、ACL、生产服务或规范 Catalog 启用。代码 `fff3807b6783bbe3aa08b348050c23e359050ab4` 已通过独立 Standards/Spec；自有运行 `full-20260913t213711774z-fff3807b6783-85fe78c8` 的上传/列表/同步代表项加 warmup 为 2/2，无跳过/flaky，原生 8.1232 秒，嵌套及外层清理完成。这不能证明所有调用方或关闭所有历史语义失败。

原模拟器测试的整行否定正则在回读成功后命中了参数名称/描述中的刻意文本“Readback mismatch probe”。自有新鲜 Red 位于 `22d2c0bfe738f129771dfcf20912a968fbd866b1`，运行 `full-20260914t002830662z-22d2c0bfe738-ab41d2ed`：warmup 通过、原场景失败，原生 48.0234 秒；失败资源按既有策略保留。修正 `7c6511d9224214245953be2d520ae6af417c9087` 检查真实状态单元格，并独立断言没有匹配的 `.node-row-error`；原正则、全部写入/回读/回滚/审计断言保留，字面断言数由 50 增至 51。新鲜 Green `full-20260914t003458715z-7c6511d92242-1abc7470` 为 2/2，无跳过/flaky，原生 39.3822 秒，清理完成；原生报告 SHA256 为 `6f0fc2d4e3fa04aa27562a8e8f441746d01bb94a370ecffe51e25c243a3294b5`。仅使用自有模拟器，不涉及目标数据库、真实设备、恢复或冻结节点操作。

最终接受 main 刷新后，此独立候选仍需执行验证矩阵中的六项原生集合、原 build、元数据/文档、独立双审及自身选中的 Hosted 检查，不复用旧 PG/browser 通过。main 完整验收独立报告；冻结 Catalog 前置条件和根因未明的 Knowledge/DTS/Xiaoze 失败不会因这些夹具修正而关闭。不引入浏览器分片、更大超时、重试、exclude、golden 变化或收益声明。

## 文档影响矩阵

| 领域 | 状态 | 精确路径与处置 |
| --- | --- | --- |
| 仓库入口 | #837 已更新 | `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`：实际 cwd 发现、精简任务包和完整源码交付，保留原安全规则。 |
| 计划治理 | #829 及最终文档切片更新 | `docs/PLANS.md`、`docs/zh-CN/PLANS.md` 已链接本活跃计划。本计划文件对维护当前状态，新互链回归台账记录 58 项观察。B/C 保持活跃，无需移入完成目录或重写索引。 |
| 产品规格 | No change | `docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/product-spec.md`：仅工程交付，无产品行为/启用变化。 |
| 架构 | No change | `ARCHITECTURE.md`、`docs/zh-CN/root/ARCHITECTURE.md`：既有 runtime/port 边界保留。 |
| 质量/测试 | 已更新 | 两份验证矩阵维护已实现命令、严格数量、full/shadow 和夹具证据；两份 testing-strategy 在 #831 更新等价组及原有前置条件。不增加重复验证手册。 |
| 可靠性/运行手册 | 已审查，无变化 | `docs/runbooks/manual-acceptance.md`、`docs/zh-CN/manual-acceptance.md` 及两份 local-development 保留原 Gate 0、环境和所有权程序；EFF 复用这些程序，命令/诊断增量记入现有矩阵。没有运维或目标环境程序变化。 |
| 安全/治理 | 已更新/审查 | 两份交付协议由 #837 更新。`docs/SECURITY.md`、`docs/zh-CN/SECURITY.md` 没有 EFF 差异，上游既有修改保留；所有权、脱敏、源码锁和独立审查权威不变。 |
| main-red 身份前置修复 | 已更新 | 独立互链的 `docs/agents/catalog-runtime-boundary-relocation.md` 及中文文件记录独立接受的 16 对身份范围、原清单保留、收集隔离及回退；原 23 对决定不变。 |
| 前端/设计 | No change | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`docs/design-docs/ui-design-system.md`：无界面重设计；真实浏览器要求保留。 |
| 生成物 | 已审查，无变化 | `docs/generated/acceptance-operation-evidence.md`、`docs/generated/db-schema.md` 没有 EFF 差异，不制造 operation 证据或 schema 输出。工程 PR 的选中 Hosted job 在其自有 PostgreSQL 前置条件下执行完整 schema 检查。 |
| 参考 | No change | `docs/references/productization-api-contract-draft.md`：无 API 变化，不另建重复工程手册。 |
| 余留 | 已审查，保留已有开放责任 | 现有 [TD-075/TD-076/TD-118](../../../exec-plans/tech-debt-tracker.md) 覆盖验收治理、夹具债务和共享浏览器下限，中文 tracker 另有互链。本计划及 #828 维护 EFF 观察条件；不新增债务编号、裁剪套件或重开已关闭 TD-122。 |

## 文档更新门禁

完成工作包/计划前运行真实 `npm run docs:check`，明确 schema 部分已执行还是缺 PG/pgvector 跳过。CI 变化加 `npm run acceptance:ci`；Quality 元数据变化加 `npm run acceptance:quality`，元数据不等于浏览器通过。核验命令存在、路径和执行数量真实。封板前同一候选完成中英文及受影响索引；`verify:*` 入口未存在前不得写成已实现。

归档前每个 Update/Review 行必须更新或明确记录“无变化及证据”，真实余项进入既有技术债。B/C 未满足不把全项目标 completed。源码不得提交原始日志、令牌、完整环境/会话/rollout、数据库 dump 或大型运行报告。

首次 R1 登记修改本文件对和两份计划索引各一条链接，保留为历史。最终 EFF-09 文档仅修改本计划对和互链回归台账对。父协调者在 A 交付收口前，将最终 clean head/tree、直接 `node_modules/.bin/tsx scripts/check-doc-governance.ts`、`npm run acceptance:ci`、独立 R1 审查和选中 Hosted 结果记入 #828 证明。直接本地文档治理不冒充 `docs:check` 的 schema 证明，也不探测无所有权的默认端口数据库。最近工程 PR 的完整 Hosted schema 证据单独标识，文档 PR 不重跑，也不将它算作新执行。最终源码存在后在外部记录源码包身份，避免为写入自身结果而改变已测源码。
