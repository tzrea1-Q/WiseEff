# EFF 回归证据台账

> English: [English](../../../exec-plans/active/2026-09-13-efficiency-regression-ledger.md)
> 计划：[智能体交付与验证效率](2026-09-13-agent-delivery-efficiency.md)
> 已接受实现快照：main `e45dc3ab941fb081ff0d6edb07668c63fffb7cc0`，tree `b58755ee3b9a94cbc76169caed9dc95d42a93f72`，截至 #839 的十个实现 PR 均已合入。本文档候选在 Issue #828 单独接受精确 head 审查、Hosted、合入和最终源码证明。

本表将设计的 58 个场景映射到有界证据，每行只说明列出的观察及限制，不表示全部场景、模块启用或当前 main 全量验收通过。不为填表增加执行。

PASS 表示所述有限行为有相符证据，PARTIAL 表示仅有部分证据。REFUSAL ONLY 与 NOT ADOPTED 区分已拒绝和未采用的接口；NOT VERIFIED、NOT OBSERVED、UNKNOWN、BLOCKED 保留缺失证明或前置条件。HISTORICAL ONLY 不证明当前源码；OBSERVATION-PENDING 保持禁用，PENDING 等待后续交付结算。

## 已接受的实现身份

所有行均属于 [Issue #828](https://github.com/tzrea1-Q/WiseEff/issues/828)。所链 Hosted 均为 attempt 1，在表列实际 checkout 上成功，tree 与已审 head 及合入 tree 一致。#837 只选择三个文档门禁，没有执行原生测试；其余行通过各自原有选中工程门禁。既有可选/平台跳过及未选中 L2/target/minimal 任务仍单列。上游 #832 与开放草稿 #824 不属于 EFF 交付行。

| PR / 范围 | Accepted base | 已审 head | 实际 checkout | Tree | 合入 | Hosted |
| --- | --- | --- | --- | --- | --- | --- |
| [#830](https://github.com/tzrea1-Q/WiseEff/pull/830) / 授权夹具修复 | `1059acb57379bd120d0d2b1a4b4733d4c2e02901` | `27320fdfdc38e92193faf9799f70e11f7cb37368` | `d24340b3bcce9cd27c7837fb3bd09cab0eaee983` | `6887ac7b8c43048fb1ba93dde047083cdb7ed172` | `75f3514b213f07f177773a077021e1485f9f173b` | [34760791346](https://github.com/tzrea1-Q/WiseEff/actions/runs/34760791346) |
| [#829](https://github.com/tzrea1-Q/WiseEff/pull/829) / EFF-00/01 | `75f3514b213f07f177773a077021e1485f9f173b` | `fb6087f1fdb352953f63b46ca711cee5775e2607` | `41de2cbb95d788168d97d7b8e52711ffbd0dfa63` | `652590339d4a16415d935b624753fa7c68421a11` | `ef88c0964e158d7effbd0ce6062260e5eb1c5a21` | [34762290769](https://github.com/tzrea1-Q/WiseEff/actions/runs/34762290769) |
| [#833](https://github.com/tzrea1-Q/WiseEff/pull/833) / main 前置修复 | `9dc751690a615b162bb41feef6392289b2ca7f6a` | `a7841dc64d3f9a1b5e34ead72fa3d5f5eb68241a` | `087e82df4555a0b6abc76e8cb38b66d5a2719d82` | `7c105b5cc510f30f5d227da1acee3ad268632c64` | `60f2752e78b3dc45466836b4f7b3233f0e908a2a` | [34784471686](https://github.com/tzrea1-Q/WiseEff/actions/runs/34784471686) |
| [#831](https://github.com/tzrea1-Q/WiseEff/pull/831) / EFF-02 | `60f2752e78b3dc45466836b4f7b3233f0e908a2a` | `425c5d0958a6dc8e565e973b0b3d6fbd63330297` | `2eeb1cb6598ec176f5c51a1c1ce2cc786bef66fc` | `8cddbc12cb00582dec3697c87cda45064b654f68` | `915f70a04c674c9d9634b72960f036be1defa486` | [34786627881](https://github.com/tzrea1-Q/WiseEff/actions/runs/34786627881) |
| [#834](https://github.com/tzrea1-Q/WiseEff/pull/834) / EFF-03 预览 | `915f70a04c674c9d9634b72960f036be1defa486` | `84f3033f327615351e3b977cd04379c92168f2be` | `742e70fc887718b2d15199ece33ee560ee8b28fc` | `f7340bdcd81a03c7474295a0f3f5f5573275e0d7` | `4ef53e5c1551747d76350cd324068fb413d462c2` | [34788103778](https://github.com/tzrea1-Q/WiseEff/actions/runs/34788103778) |
| [#835](https://github.com/tzrea1-Q/WiseEff/pull/835) / EFF-03 影子观察 | `4ef53e5c1551747d76350cd324068fb413d462c2` | `32d14b7e93d306dfcf905b71d7ed503e7a6d4a52` | `e3dbfff629ea91c7777a7f5728f31a74dfb22efc` | `513f0967be7d9ebe9863acfbde4b89bd690a0fd1` | `aed7e54686e7642655b3b8c30369b9c4ad07f771` | [34791485027](https://github.com/tzrea1-Q/WiseEff/actions/runs/34791485027) |
| [#836](https://github.com/tzrea1-Q/WiseEff/pull/836) / EFF-04 | `aed7e54686e7642655b3b8c30369b9c4ad07f771` | `9f8639542be150b74812a3b62c4bb56f63c21cfe` | `75ada0ee7d8b6770b6bc7d8f57688640a72dbb5a` | `d6a9e6858a00a4d2da35d37ca4fe85cbe1f6711d` | `0dd8157682393df0514b10625660fe4cd91a406f` | [34794729894](https://github.com/tzrea1-Q/WiseEff/actions/runs/34794729894) |
| [#837](https://github.com/tzrea1-Q/WiseEff/pull/837) / EFF-08 | `0dd8157682393df0514b10625660fe4cd91a406f` | `0138b450af9116cde25b28096ff9f3ee569bb017` | `b3d37c067023f12337cc8eb63c03c3b6a6bbe4af` | `56096bff648856c5f93b5d2f121b81263d47a27f` | `b3ec95a4c9e327d384ce482be05c92ca0227e63a` | [34796067544](https://github.com/tzrea1-Q/WiseEff/actions/runs/34796067544) |
| [#838](https://github.com/tzrea1-Q/WiseEff/pull/838) / EFF-07 类型入口 | `b3ec95a4c9e327d384ce482be05c92ca0227e63a` | `7fc675e13fe88888c998ae12297428f50764a48d` | `56717e28ecdfa73593b817736112717df7f89ca6` | `83db9a1accf309b9164325592f97d7e0b004fa30` | `01703ba69f883b22e8b819182223c5fd35b90184` | [34796686417](https://github.com/tzrea1-Q/WiseEff/actions/runs/34796686417) |
| [#839](https://github.com/tzrea1-Q/WiseEff/pull/839) / EFF-06/07 夹具 | `01703ba69f883b22e8b819182223c5fd35b90184` | `1aca4c6aeb6569a4ea237db3ed97e4202f5ba6dc` | `060ffc04ff56bc55a389afc762de135105579fb5` | `b58755ee3b9a94cbc76169caed9dc95d42a93f72` | `e45dc3ab941fb081ff0d6edb07668c63fffb7cc0` | [34798669471](https://github.com/tzrea1-Q/WiseEff/actions/runs/34798669471) |

各行均已收集独立 Standards/Spec 通过结果。R1 的 #837/#838 使用一次独立合并审查；其余实现行分别审查。最终 #839 由 `eff_main_red_design` 做 Standards、`eff09_browser_remaining_luna` 做 Spec，独立于父实现者。具体审查文件与历史失败保留在父证据目录及所链 #828 证明中。后续纯文档 head 须经过自身独立审查和选中 Hosted，再在外部结算身份。

## 固定证据引用

除另注明提交外，下方源码行号绑定执行器候选 `9f8639542be150b74812a3b62c4bb56f63c21cfe`，tree `d6a9e6858a00a4d2da35d37ca4fe85cbe1f6711d`。C 为 `scripts/ci-required-results.test.ts`，A 为 `scripts/check-acceptance-ci.test.ts`，R 为 `scripts/verification/run.test.ts`，Q 为 `scripts/verification/report.test.ts`。

- **L**：精确 9f 的窄命令，102 项/五文件、零跳过、exit 0；包括 C 的 44 项、R 的 25 项、Q 的 10 项，A 不在此窄命令中，其余 23 项来自另两个文件。完整私有日志保留在所属执行器 Scratch 的 `work/efficiency/cold-fixture-correction/final/`。
- **H**：历史 [PR #831 run 34786627881](https://github.com/tzrea1-Q/WiseEff/actions/runs/34786627881) attempt 1，head `425c5d0958a6dc8e565e973b0b3d6fbd63330297`，checkout `2eeb1cb6598ec176f5c51a1c1ce2cc786bef66fc`。原 L1 各组均通过，当时 C/A 各 37 项；后加 shadow 测试不记入这次运行。私有聚合证据位于父目录 `work/efficiency/hosted/pr-831-second/`。
- **N**：精确 9f 的新鲜任务 10/1、29/5，零跳过，UUID 为 `432ae04f-845f-4e9d-980a-9a00a8ffc8e9`、`d6c8cac1-30ba-42a4-8c41-4a1743ba30dc`；历史读取器明确新鲜度未验证。**M** 是 R 中一个永久测试内的 19 个合成场景，不是额外 19 个 Vitest 测试或模块样本。
- [PR #836 修正运行 34794729894](https://github.com/tzrea1-Q/WiseEff/actions/runs/34794729894) attempt 1 的九项选中检查均通过；实际 checkout `75ada0ee7d8b6770b6bc7d8f57688640a72dbb5a` 与合入 `0dd8157682393df0514b10625660fe4cd91a406f` 同为 9f tree。首次冷启动夹具失败仍保留为失败历史。
- [PR #835 run 34791485027](https://github.com/tzrea1-Q/WiseEff/actions/runs/34791485027) 的四个完整原生命令观察不等于四个模块启用样本；四个具名反馈模块均 observation-pending，enforce 与 memo 关闭。
- 历史类型计时绑定 `66e572a4c45bd5d4db164380a2200e7ee6c10ac4`/`26b7acc0e03a07922e57fe688ca285eb6a741346`：十二次观察，每命令/冷暖分组 N=3，与两项目 Red/Green 分开。路由 [PR #837](https://github.com/tzrea1-Q/WiseEff/pull/837) 已合入，三项文档选中检查通过，九个运行时 job 跳过；历史 UI/脚本/PG 恢复结果未重跑。
- 当前 main 全量验收是独立证据通道。aed7 的 [run 34792256282](https://github.com/tzrea1-Q/WiseEff/actions/runs/34792256282) 记录 58 项浏览器失败，原 archive-size 门禁拒绝完整产物；最小诊断成功没有覆盖这两项失败，原生完整数量及清理细节仍 unknown。后续 main 运行必须另报。

## 场景映射

| 场景 | 状态 | 具体证据 | 限制或剩余条件 |
| --- | --- | --- | --- |
| EFF-T01 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:55-67` 实际执行 `acceptance_diagnostic` 工作流步骤，检查主执行失败、未知清理、生成诊断、归档失败、跳过上传和已抑制细节。 | 证据仅限 `workflow-context-only`，不是当前完整验收执行；最终索引仍须绑定精确 base/head/run。 |
| EFF-T02 | PARTIAL | W0 记录了验收失败与完整失败的区分，以及有界诊断。 | 尚无当前端到端证据同时覆盖原始产物包拒绝和完整受控失败路径。 |
| EFF-T03 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:83-94` 使用合成 token、Cookie、DB URL 和 authorization 执行工作流诊断，并验证生成的文本/摘要不含这些值；该步骤明确为 `workflow-context-only`，不读取候选报告或原始日志。 | 这只证明诊断步骤的有界脱敏，不证明完整的候选报告/原始日志拒绝路径；其余工作流行为不作声明。 |
| EFF-T04 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:83-94` 提供 ANSI/title/path-injection 文本，`:96-102` 拒绝格式错误或超大的 status 且不反射。 | 未证明原始验收场景完整的不执行/路径校验行为；仅保留诊断边界证据。 |
| EFF-T05 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:96-102` 拒绝 70,000 字符的 status，`:83-94` 检查输出字节上限。 | 超量失败/日志及全流程截断未由这些 `workflow-context-only` 测试独立证明。 |
| EFF-T06 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:111-116` 执行保守回退生成，并检查固定的 `DIAGNOSTIC_REJECTED` 输出不反射合成输入。 | 没有读取缺失或损坏的候选报告；要求的报告校验场景仍未验证。 |
| EFF-T07 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:96-102` 证明格式错误的 status 以固定的 `DIAGNOSTIC_REJECTED` 拒绝；`:141-152` 证明诊断上传失败会以失败状态收敛。 | 没有读取或执行候选诊断验证器失败；不得提升为完整验证器场景。 |
| EFF-T08 | UNKNOWN | 审计要求区分清理和上传，但接受包没有独立观察内部清理/上传失败。 | 在获得有界失败产物前，不声称原始结果得到保留，也不强行重演。 |
| EFF-T09 | NOT OBSERVED | 没有保留有效的 runner 终止或最终化超时注入。 | 不完整/已取消仍视为未完成；本台账不执行进程终止。 |
| EFF-T10 | PASS | `scripts/ci-required-results.test.ts:73` 检查每个固定命令/报告使用同一 run、attempt、SHA、tree；L（`work/efficiency/cold-fixture-correction/final/process.json`）记录正向原生回执夹具，H（`work/efficiency/hosted/pr-831-second/summary.json`，run `34786627881`）记录四个 L1 分组和两个稳定聚合结果全部通过。 | L 是一个原生回执夹具，H 是历史 Hosted L1 证据；不代表当前 main 或模块启用。 |
| EFF-T11 | PASS | `scripts/ci-required-results.test.ts:82` 拒绝带伪造 `green receipt` 的失败已选子任务；`:250` 的 CLI 矩阵中，`native-failure` 位于 `:305`，由 L 覆盖，并在 `shadow` 消费前退出。 | 没有 Hosted 兄弟任务失败实验；PASS 仅针对该具体拒绝路径。 |
| EFF-T12 | PARTIAL | `scripts/ci-required-results.test.ts:73` 配合 `:80` 的 selected `skipped` 及 `:305` 的 `native-skipped` CLI 行由 L 覆盖，并拒绝 skipped 证据。 | 这些文件没有显式的 `neutral` 行；不得声称执行 `neutral`。 |
| EFF-T13 | PARTIAL | `scripts/ci-required-results.test.ts:30` 即使对未选中的 job 也拒绝该状态，`:73` 覆盖回执身份，`:250`/`:305` 的 `native-cancelled` 由 L 覆盖取消、缺失和空结果拒绝。 | 没有显式的 `timed_out` 行，也没有 Hosted 取消证明。 |
| EFF-T14 | PASS | `scripts/ci-required-results.test.ts:50` 拒绝 unknown event、mode、failed Detect 和 unmapped job；C flags 在 `:33`，`shadow` 抑制在 `:137`，L 的原生结果覆盖五个 unknown flag、failed Detect、invalid event/mode/job 及抑制。 | 这是索引中的拒绝集合，不证明所有可能的无效计划。 |
| EFF-T15 | PASS | `scripts/ci-required-results.test.ts:24` 接受带稳定 `Build and test` 的 docs-only，`:27` 检查 required gate，`:109` 拒绝伪造回执；L 含 `:310` CLI 行，H 记录相应的原生 L1 执行。 | H 本身不是 docs-only PR；证据范围限于已测试的选择/回执行为。 |
| EFF-T16 | PARTIAL | `scripts/ci-required-results.test.ts:36` 检查完整 main L1、Quality、L2，`:42` 保留手动触发要求，`:59` 检查标签，`scripts/check-acceptance-ci.test.ts:178` 检查路由；C 由 L 覆盖，原始 C/A 行为由 H 覆盖。 | 这些是夹具和历史 L1 证据，不是当前 main/nightly/manual/target 运行；L2/target/minimal 不作声明。 |
| EFF-T17 | PASS | `scripts/check-acceptance-ci.test.ts:75` 拒绝 required set 中的 skip、missing needs、altered source identity 和 npm installation；H 记录 aggregate mutation 和稳定 check name。 | 这是原生契约/聚合证据，不是新的远程保护设置审计。 |
| EFF-T18 | PASS | `scripts/check-acceptance-ci.test.ts:31` 将每个原始 L1 命令/前置条件映射到四个 job 和严格聚合；投影在 `:97`，移除在 `:34`，H 记录清单、投影、移除及完整 L1 执行。 | 此处没有独立重新计数所谓的 30 条命令清单，也没有基于计时的无重复证明。 |
| EFF-T19 | PARTIAL | EFF03 审查了规划器选择、直接测试和显式消费者；#835 提供真实 Hosted `shadow` 运行。 | 四个模块仍是观察策略，不是已启用的强制执行；最终源身份待绑定。 |
| EFF-T20 | PARTIAL | 审查的规划器路径和原生证据包含共享消费者选择。 | 没有对所有 DTO/API 路径建立新的宽消费者运行证据。 |
| EFF-T21 | PARTIAL | auth/RBAC/migration/kernel 风险采用按风险选择。 | 有界 EFF03 包没有一致证明所有必需的真实环境检查。 |
| EFF-T22 | PARTIAL | Hosted 摘要保留相关前端 Quality/Smoke 覆盖。 | 没有覆盖每个全局 CSS/提供方变更；强制执行仍关闭。 |
| EFF-T23 | NOT VERIFIED | 允许读取的 `plan.test.ts`/`selection.test.ts` 中，没有专门执行依赖包、锁文件、工具链或测试配置变更回退的有界测试。 | 保守规则保持未验证，直到绑定具体测试/命令。 |
| EFF-T24 | PARTIAL | `scripts/verification/plan.test.ts:188-202` 实际覆盖换行路径和删除时完整回退；规划器仍有固定 registry/consumer 模型。 | 未证明所有删除模块/测试消费者场景，保持 PARTIAL。 |
| EFF-T25 | PARTIAL | `scripts/verification/plan.test.ts:188-202` 实际覆盖换行路径保持和删除处理。 | 重命名、间距以及完整的新旧并集覆盖尚未全部证明。 |
| EFF-T26 | PARTIAL | `scripts/verification/selection.test.ts:14-29` 绑定 unknown/deletion/registry-missing 和共享路径完整回退场景。 | 原始要求还包括空 diff；本索引没有证明精确的空 diff 夹具，因此保持 PARTIAL。 |
| EFF-T27 | PARTIAL | `scripts/verification/plan.test.ts:218-246` 检查精确的有序合并身份并拒绝浅克隆。 | 完整行还要求基础不可用时拒绝；此处只绑定浅克隆/合并身份部分。 |
| EFF-T28 | REFUSAL ONLY | `scripts/verification/plan.test.ts:71-78` 对 tracked、staged、untracked 输入验证 `DIRTY_WORKTREE`。 | 脏规划明确未实现/被拒绝；这不是原始脏源码场景的 PASS。 |
| EFF-T29 | PARTIAL | 审查契约对 dynamic import、fixture、SQL、runtime-config 风险有显式映射/回退。 | 当前限定证据不能证明每条运行时路径都被正确选择。 |
| EFF-T30 | NOT VERIFIED | 允许的有界测试证明合并身份与 registry/路径选择，但本包没有直接执行 PR 编辑策略（旧的最小集合加候选新增项）的当前测试/命令。 | 策略声明保持未验证；EFF05 启用与其分开。 |
| EFF-T31 | NOT VERIFIED | `scripts/verification/plan.test.ts:265-279` 验证 unknown committed registry module 被拒；`scripts/verification/selection.test.ts:14-29` 验证 unknown/shared path 扩大到完整集合。registry 是固定的，限定证据中没有依赖图/循环依赖测试或实现。 | 不得声称一般依赖循环/未声明模块覆盖；只保留 unknown-registry/path 回退事实。 |
| EFF-T32 | PASS | M 的 `discovery-zero`、`native-zero`、`all-skipped` 行在 `727-729`，以及原生验证器 `scripts/ci-required-results.test.ts:369`，由 L 的组合 CLI/原生验证器结果覆盖，并拒绝不完整失败记录。 | 这证明索引中的拒绝/保护场景；完整失败记录不算通过，也不能由此推断 Hosted 运行时路径结果。 |
| EFF-T33 | BLOCKED | 缺少 PostgreSQL 时，既有 PG-required 路径正确失败/阻塞。 | 新 runner 没有 PG adapter；不得改写为全跳过成功，也不要在本台账添加 adapter。 |
| EFF-T34 | NOT ADOPTED | memo/reuse 明确关闭，pure 的相同输入复用没有启用。 | 不得声称 local-reuse PASS；继续作为可选/延期项。 |
| EFF-T35 | PARTIAL | M 的 `success/failure-metadata-drift` 与 `success/failure-entry-drift` 行在 `735-738` 由 L 覆盖；依赖元数据/入口漂移阻止完整性，并保留首个错误。 | source/fixture/config/mode 的重跑组合没有全部由该有界产物证明。 |
| EFF-T36 | PARTIAL | `scripts/verification/run.test.ts:379` 将重建环境只传给实际子任务并拒绝 unknown mode；`:312` 的环境变量/参数检查及 M 漂移行由 L 覆盖。 | 没有保留锁文件/操作系统/工具版本组合或缓存失效证明。 |
| EFF-T37 | PASS | M 的空/缺失/过期/损坏报告行及 `scripts/verification/report.test.ts:170` 的嵌套阶段校验由 L 覆盖；`:232` 覆盖伪造记录，并使自洽 green 声明保持未验证。 | 不证明每一种缺失日志或损坏输入组合。 |
| EFF-T38 | PARTIAL | `scripts/verification/run.test.ts:300` 只接受一个固定任务和完整 base SHA，拒绝 unknown task 与 `--reuse`；L 覆盖该边界，N（`work/efficiency/cold-fixture-correction/native-tasks/process.json`）以新鲜任务执行两个受支持任务。 | 没有 PG/browser/migration/Hosted adapter 运行，也没有四请求复用矩阵。 |
| EFF-T39 | PASS | `scripts/verification/run.test.ts:300` 拒绝 unknown/duplicate argument，`:312` 拒绝启动注入；`scripts/verification/report.test.ts:136` 只接受严格 UUID 选择器。L 覆盖 unknown/duplicate 参数、`NODE_OPTIONS` 注入、路径遍历拒绝及固定前端堆参数。 | 这是索引中的参数/路径拒绝集合，不是所有 shell 元字符组合。 |
| EFF-T40 | PARTIAL | `scripts/verification/run.test.ts:581` 拒绝不安全祖先并保留替换锁，`:596` 不覆盖已有最终记录，M 的存储/取消及主任务 `:502` 由 L 覆盖；N 提供不同的 UUID。 | 没有保留同时多工作树负载或资源基准。 |
| EFF-T41 | OBSERVATION-PENDING | #835 在 full-required 策略下提供四个原生命令观察；它们不是四个模块启用样本，强制执行仍关闭。 | 若 `shadow` 发现相关未选失败，应扩大 full/`shadow` 并阻塞启用；当前没有已启用模块运行。 |
| EFF-T42 | OBSERVATION-PENDING | 没有限定证据证明每个模块已有所需的 10/3/6 个样本/类别；原生命令数量不能替代这些样本。 | 保持 `shadow`，不制造样本。 |
| EFF-T43 | NOT ADOPTED | enforce/rollback 启用关闭；保守完整并集仍是安全回退。 | 不得声称 omission=0 或已启用 rollback PASS。 |
| EFF-T44 | NOT ADOPTED | 没有并发 Quality 分片实现；串行是当前接受的选择。 | 没有隔离的 DB/对象存储/端口/运行时/报告证据。 |
| EFF-T45 | NOT OBSERVED | 没有分片启动/播种/执行失败数据包。 | 有界清理仍只是未验证策略，不是执行证据。 |
| EFF-T46 | NOT ADOPTED | 没有分片清理实现，也没有标记/未知 PID/DB 拒绝运行。 | 不要为了填行添加全局 kill/drop。 |
| EFF-T47 | NOT ADOPTED | 没有分片报告聚合实现，也没有重复或错误 SHA 拒绝运行。 | 串行证据不能替代分片报告聚合。 |
| EFF-T48 | PARTIAL | 既有 Quality/Smoke 证据保留串行 UI 基线。 | 分片预热、字体、视口和截图基线保持没有实现或重跑。 |
| EFF-T49 | NOT ADOPTED | 原串行清单继续作为保守回退。 | 没有分片与串行等价性证据。 |
| EFF-T50 | NOT ADOPTED | 当前切片没有采用 Node/jsdom 拆分。 | DOM/提供方测试保持现有环境；不得声称已经拆分。 |
| EFF-T51 | NOT ADOPTED | 提议的 pure/PG 拆分没有采用。既有 PG-required 覆盖在没有 PostgreSQL 时失败/阻塞，新 runner 也没有 PG adapter，但这不等于实现了该拆分。 | 保持原后端环境边界；pure/PG 不得标为 PASS。 |
| EFF-T52 | PASS（契约）；HISTORICAL ONLY（计时） | 两个被引用的 TypeScript 项目都在两条命令入口中产生 TS2322 Red，随后恢复 Green。PR #838 的 head `7fc675e13fe88888c998ae12297428f50764a48d` 的本地 `typecheck` 为 11.5993s、未改动 `build` 为 24.5690s；独立 R1 审查与 Hosted 的 9 项门禁分别通过（run `34796686417` attempt 1），并合入 `01703ba69f883b22e8b819182223c5fd35b90184`。`work/efficiency/eff07-observation/type-feedback-evaluation.json` 绑定 head `66e572a4c45bd5d4db164380a2200e7ee6c10ac4`、tree `26b7acc0e03a07922e57fe688ca285eb6a741346` 的 12 次历史冷/暖计时观察。 | `alias` 保留原 `compiler phase` 和 `full-build` 要求；不受控的主机负载与小样本分组不能证明当前 head 速度、CI 节省、global C 或当前 main 全量验收。计时属于历史 N=3 分组，与两个项目的 Red/Green 检查分开。 |
| EFF-T53 | NOT ADOPTED | 没有采用 worker 数量、堆内存或夹具性能优化。 | 不得声称已改善内存耗尽、连接耗尽或残留状态问题。 |
| EFF-T54 | NOT ADOPTED | 没有采用计时/重试/等待调整。 | 更大的超时或忽略失败不构成就绪证明。 |
| EFF-T55 | PARTIAL | PR #837 head `0138b450af9116cde25b28096ff9f3ee569bb017` 保留了在 `5418af9474415fec111994accda5e46250e6271b` 审查的四个路由/协议内容块；实际从 root 到 cwd 的发现过程在没有覆盖指令时选中 root 的 `AGENTS.md`，并检查三个已实现入口。独立 R1 审查和三个选中的 docs-only 门禁通过，合入 `b3ec95a4c9e327d384ce482be05c92ca0227e63a`。 | 这是已观察的发现路径，不是所有覆盖指令/模块组合；历史 UI/scripts/PG 恢复结果未重放，九个运行时 job 未选中/跳过。 |
| EFF-T56 | PARTIAL | 已审查精简任务包、协议和恢复文档中的新会话恢复路径。 | 未保留最终候选上无需全量重读即可恢复的新执行证明。 |
| EFF-T57 | UNKNOWN | 有限使用量证据不覆盖整个项目，也不足以证明重复终态去重和缺失子代理计数。 | 全项目 token 使用量和节省保持 unknown，不估算或重复计数。 |
| EFF-T58 | PASS（已接受实现并集）；最终文档外部证明 | 十个已接受 PR 在 `e45dc3ab941fb081ff0d6edb07668c63fffb7cc0` 汇总51个完整文件，ZIP SHA256 `7d88448361764684d065faa71a1ad8f42646a22349693dc3dffb5b4ec0aeb39d`；完整字节/hash/mode 及逐 PR 身份已验证并交付，无删除/重命名、日志/凭据/数据库或无关源码。自有容器/密码处置记入父计划。 | 最终53文件总包新增本台账对，绑定之后真实文档合入，存在后在 #828 外部记录 hash。不声称自引用源码/hash，也不打包整个仓库。 |

## 交付边界

最终源码并集身份、逐 PR 审查/Hosted/合入记录、自有资源处置和最新 main 全量状态由父检查点及 [Issue #828](https://github.com/tzrea1-Q/WiseEff/issues/828) 承载；原失败保留为历史。可选 memo、分片和未采用的拆分不能改写为 PASS。A 交付不代表 B/C 完成；本表不授权空提交、重复 Hosted 凑样本、放宽断言或原始产物兜底上传。

## 文档影响矩阵

| 领域 | 处置 |
| --- | --- |
| 回归证据 | 同步更新本台账及互链英文文件，保留具名源码身份和限制。 |
| 项目与其他文档 | 互链父计划维护完整影响矩阵、当前状态、余项责任与最终交付门禁；本台账不增加运行时、schema、产品或策略变化。 |

## 文档更新门禁

按父最终文档任务包验证双语链接、58 个唯一 ID、精确源码/证据引用、直接文档治理与验收元数据。父协调者在合入前要求独立 R1 审查和实际选中的 Hosted 结果；数据库 schema 与当前 main 完整验收是独立证据。本台账不能关闭仍活跃的 B/C 观察项目。
