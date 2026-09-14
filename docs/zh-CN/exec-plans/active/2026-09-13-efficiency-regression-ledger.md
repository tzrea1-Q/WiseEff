# EFF 回归证据台账

> English: [English](../../../exec-plans/active/2026-09-13-efficiency-regression-ledger.md)
> 计划：[智能体交付与验证效率](2026-09-13-agent-delivery-efficiency.md)
> 准备快照：accepted main 为 `b3ec95a4c9e327d384ce482be05c92ca0227e63a`；类型 PR #838、浏览器及最终文档候选仍 pending。最终父检查点及 Issue #828 证明记录取代此准备状态。

本表将设计的 58 个场景映射到有界证据，每行只说明列出的观察及限制，不表示全部场景、模块启用或当前 main 全量验收通过。不为填表增加执行。

PASS 表示所述有限行为有相符证据，PARTIAL 表示仅有部分证据。REFUSAL ONLY 与 NOT ADOPTED 区分已拒绝和未采用的接口；NOT VERIFIED、NOT OBSERVED、UNKNOWN、BLOCKED 保留缺失证明或前置条件。HISTORICAL ONLY 不证明当前源码；OBSERVATION-PENDING 保持禁用，PENDING 等待后续交付结算。

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
| EFF-T01 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:55-67` 实际运行 `acceptance_diagnostic` workflow step，并检查 primary execution failure、unknown cleanup、generated diagnostic、archive failure、skipped upload 及 suppressed details。 | 这是 workflow-context-only 证据，不是当前 full acceptance 执行；最终索引仍需绑定精确 base/head/run。 |
| EFF-T02 | PARTIAL | W0 记录了 acceptance/full 失败分离和有界诊断。 | raw package refusal 与完整受控失败路径还没有一份当前端到端证据。 |
| EFF-T03 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:83-94` 用 synthetic token、Cookie、DB URL、authorization 运行 workflow diagnostic，并验证生成的 text/summary 不含这些值。该步骤明确是 `workflow-context-only`，不读取 candidate report 或 raw log。 | 这只证明 diagnostic step 的有界脱敏，不是完整 candidate-report/raw-log 拒绝路径；其余 workflow 行为保持未声明。 |
| EFF-T04 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:83-94` 提供 ANSI/title/path-injection 文本，`:96-102` 拒绝 malformed/oversized status 且不反射。 | 这些测试没有证明原始 acceptance 场景完整的 no-execution/path-validation 行为；只保留 diagnostic boundary 证据。 |
| EFF-T05 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:96-102` 检查 70,000 字符 status 被拒，`:83-94` 检查输出字节上限。 | 过多失败/日志行为及全流程 truncation 没有由这些 workflow-context-only 测试独立证明。 |
| EFF-T06 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:111-116` 运行 fallback generation，并检查 fixed `DIAGNOSTIC_REJECTED` 输出不反射 synthetic input。 | 它没有读取 missing/corrupt candidate report；请求的 report-validation 场景仍未验证。 |
| EFF-T07 | PARTIAL | `scripts/acceptance-diagnostic.test.ts:96-102` 证明 malformed status 以 fixed `DIAGNOSTIC_REJECTED` 拒绝；`:141-152` 证明失败的 diagnostic upload 会以 failure settle。 | 没有读取或执行 candidate diagnostic-validator failure；不得提升为完整 validator 场景。 |
| EFF-T08 | UNKNOWN | 审计要求区分 cleanup/upload，但接受包没有独立观察内部 cleanup/upload 失败。 | 没有有界失败 artifact 前不得声称保留原始结果；不要强行重演。 |
| EFF-T09 | NOT OBSERVED | 没有保留有效的 runner-kill 或 finalization-timeout 注入。 | incomplete/cancelled 必须继续视为非完成；本台账不执行进程 kill。 |
| EFF-T10 | PASS | `scripts/ci-required-results.test.ts:73` 检查每个固定 command/report 具有同一 run、attempt、SHA、tree；L（`work/efficiency/cold-fixture-correction/final/process.json`）记录正向 receipt fixture，H（`work/efficiency/hosted/pr-831-second/summary.json`，run `34786627881`）记录四个 L1 分组和两个稳定 aggregate 全部通过。 | L 是一个 native receipt fixture，H 是历史 Hosted L1 证据；这不是 current-main 或 module activation 证据。 |
| EFF-T11 | PASS | `scripts/ci-required-results.test.ts:82` 拒绝带伪造 green receipt 的 failed selected child；其 `:250` CLI matrix 的 `native-failure` 在 `:305`，由 L 覆盖，并在 shadow 消费前退出。 | 没有保留 Hosted sibling-failure 实验；PASS 仅针对具体拒绝路径。 |
| EFF-T12 | PARTIAL | `scripts/ci-required-results.test.ts:73` 配合 `:80` 的 selected `skipped` 及 `:305` 的 `native-skipped` CLI 行由 L 覆盖，并拒绝 skipped 证据。 | 这些文件没有显式 `neutral` 行；不得声称执行了 neutral。 |
| EFF-T13 | PARTIAL | `scripts/ci-required-results.test.ts:30` 即使对 unselected job 也拒绝该状态，`:73` 覆盖 receipt identity，`:250`/`:305` 的 `native-cancelled` 由 L 覆盖 cancelled、missing、empty-result 拒绝。 | 没有显式 `timed_out` 行，也没有 Hosted cancellation 证明。 |
| EFF-T14 | PASS | `scripts/ci-required-results.test.ts:50` 拒绝 unknown event、mode、failed Detect、unmapped job；C flags 在 `:33`、shadow suppression 在 `:137`，L 的 native 结果覆盖五个 unknown flag、failed Detect、invalid event/mode/job 及 suppression。 | 这是索引中的拒绝集合，不证明所有可能的 invalid plan。 |
| EFF-T15 | PASS | `scripts/ci-required-results.test.ts:24` 接受带稳定 Build and test 的 docs-only，`:27` 检查 required gate，`:109` 拒绝 fake receipt；L 含 `:310` CLI 行，H 记录相应 native L1 执行。 | H 本身不是 docs-only PR；证据范围是已测试的 selection/receipt 行为。 |
| EFF-T16 | PARTIAL | `scripts/ci-required-results.test.ts:36` 检查 complete main L1、Quality、L2，`:42` 保留 manual-dispatch requirements，`:59` 检查 label，`scripts/check-acceptance-ci.test.ts:178` 检查 routing；C 由 L 覆盖，原始 C/A 行为由 H 覆盖。 | 这些是 fixture 和历史 L1 证据，不是当前 main/nightly/manual/target 运行；L2/target/minimal 仍不声明。 |
| EFF-T17 | PASS | `scripts/check-acceptance-ci.test.ts:75` 拒绝 required set 中的 skip、missing needs、altered source identity、npm installation；H 记录 aggregate mutation 和稳定 check name。 | 这是 native contract/aggregate 证据，不是新的远程 protection-settings audit。 |
| EFF-T18 | PASS | `scripts/check-acceptance-ci.test.ts:31` 将每个原始 L1 command/prerequisite 映射到四个 job 和严格 aggregate；projection 在 `:97`，removal 在 `:34`，H 记录 inventory/projection/removal 及 full L1 执行。 | 此处没有独立重数所称 30-command inventory，也没有基于 timing 的 no-duplication 证明。 |
| EFF-T19 | PARTIAL | EFF03 审查 planner selection、direct tests 和显式 consumers；#835 提供真实 Hosted shadow run。 | 4 个模块仍是 observation policy，不是 enabled enforcement；当前最终源身份待绑定。 |
| EFF-T20 | PARTIAL | 审查 planner 路径和 native 证据包含 shared-consumer selection。 | 没有对所有 DTO/API 路径建立新的宽消费者运行证据。 |
| EFF-T21 | PARTIAL | auth/RBAC/migration/kernel 风险有 risk-aware selection。 | 有界 EFF03 包没有一致证明所有 required real-environment checks。 |
| EFF-T22 | PARTIAL | Hosted 摘要保留相关 frontend Quality/Smoke coverage。 | 没有覆盖每个 global CSS/provider 变更；enforcement 仍关闭。 |
| EFF-T23 | NOT VERIFIED | 允许读取的 `plan.test.ts`/`selection.test.ts` 中没有专门执行 package、lock、toolchain 或 test-config change fallback 的 scoped test。 | 该 conservative rule 保持未验证，直到绑定具体 test/command。 |
| EFF-T24 | PARTIAL | `scripts/verification/plan.test.ts:188-202` 实际覆盖 newline path 和 deletion full fallback；planner 还有固定 registry/consumer 模型。 | 没有证明所有 delete-module/test consumer 场景，保持 partial。 |
| EFF-T25 | PARTIAL | `scripts/verification/plan.test.ts:188-202` 实际覆盖 newline path preservation 与 deletion handling。 | rename、spacing、完整 old/new union coverage 尚未全部证明。 |
| EFF-T26 | PARTIAL | `scripts/verification/selection.test.ts:14-29` 绑定 unknown/deletion/registry-missing 和 shared-path full-fallback 场景。 | 原始要求还包括 empty diff；本索引没有证明该 exact empty-diff fixture，因此保持 PARTIAL。 |
| EFF-T27 | PARTIAL | `scripts/verification/plan.test.ts:218-246` 检查 exact ordered merge identity 并拒绝 shallow clone。 | 完整行还要求 base-unavailable refusal；此处只绑定 shallow/merge identity 部分。 |
| EFF-T28 | REFUSAL ONLY | `scripts/verification/plan.test.ts:71-78` 对 tracked、staged、untracked input 验证 `DIRTY_WORKTREE`。 | dirty planning 明确未实现/被拒绝；这不是原始 dirty-source 场景的 PASS。 |
| EFF-T29 | PARTIAL | 审查 contract 对 dynamic import、fixture、SQL、runtime-config 风险有显式 mapping/fallback。 | 当前限定证据不能证明每条 runtime path 都被正确选择。 |
| EFF-T30 | NOT VERIFIED | 允许的 scoped tests 证明 merge identity 与 registry/path selection，但本包没有直接执行 PR edits policy（old minimum 加 candidate additions）的当前 test/command。 | policy claim 保持未验证；EFF05 activation 与其分开。 |
| EFF-T31 | NOT VERIFIED | `scripts/verification/plan.test.ts:265-279` 验证 unknown committed registry module 被拒；`scripts/verification/selection.test.ts:14-29` 验证 unknown/shared path 扩大到 full。registry 是固定的，限定证据中没有 dependency graph/cycle 测试或实现。 | 不得声称一般 dependency-cycle/undeclared-module coverage；只保留 unknown-registry/path fallback 事实。 |
| EFF-T32 | PASS | M 的 `discovery-zero`、`native-zero`、`all-skipped` 行在 `727-729`，以及 native validator `scripts/ci-required-results.test.ts:369`，由 L 的 composed CLI/native-validator 结果覆盖，并拒绝不完整 failed record。 | 这证明索引中的 refusal/guard 场景；complete failed record 不算 passed，也不从中推断 Hosted runtime-path 结果。 |
| EFF-T33 | BLOCKED | PostgreSQL 缺失时，既有 PG-required 路径正确失败/阻塞。 | 新 runner 没有 PG adapter；不得改写为 all-skip 成功，也不要在本台账添加 adapter。 |
| EFF-T34 | NOT ADOPTED | memo/reuse 明确关闭，pure identical-input reuse 没有启用。 | 不得声称 local-reuse PASS；继续作为 optional/deferred。 |
| EFF-T35 | PARTIAL | M 的 `success/failure-metadata-drift` 与 `success/failure-entry-drift` 行在 `735-738` 由 L 覆盖；dependency metadata/entry drift 阻止 completeness，并保持首个 error。 | source/fixture/config/mode 的 rerun 组合没有全部由该有界 artifact 证明。 |
| EFF-T36 | PARTIAL | `scripts/verification/run.test.ts:379` 将 rebuilt environment 只传给 actual child 并拒绝 unknown mode；`:312` 的 env/argv 检查及 M drift 行由 L 覆盖。 | 没有保留 lockfile/OS/tool-version cross-product 或 cache-invalidation 证明。 |
| EFF-T37 | PASS | M 的 empty/missing/stale/malformed report 行及 `scripts/verification/report.test.ts:170` 的 nested phase validation 由 L 覆盖；`:232` 覆盖 forged record，并使 self-consistent green claim 保持 unverified。 | 不证明每一种 missing-log 或 corrupt-input 组合。 |
| EFF-T38 | PARTIAL | `scripts/verification/run.test.ts:300` 只接受一个 fixed task 和完整 base SHA，拒绝 unknown task 与 `--reuse`；L 覆盖该边界，N（`work/efficiency/cold-fixture-correction/native-tasks/process.json`）fresh 执行两个支持的 task。 | 没有 PG/browser/migration/Hosted adapter run，也没有四请求 reuse matrix。 |
| EFF-T39 | PASS | `scripts/verification/run.test.ts:300` 拒绝 unknown/duplicate argument，`:312` 拒绝 startup injection；`scripts/verification/report.test.ts:136` 只接受 strict UUID selector。L 覆盖 unknown/duplicate args、`NODE_OPTIONS` injection、traversal rejection 及 fixed frontend heap argv。 | 这是索引中的 argv/path refusal 集合，不是所有 shell-metacharacter 组合。 |
| EFF-T40 | PARTIAL | `scripts/verification/run.test.ts:581` 拒绝 unsafe ancestor 并保留 replacement lock，`:596` 不覆盖已有 final record，M 的 storage/cancel 及 leader `:502` 由 L 覆盖；N 提供 distinct UUID。 | 没有保留同时多-worktree workload 或 resource benchmark。 |
| EFF-T41 | OBSERVATION-PENDING | #835 提供 full-required policy 下的 4 个 native command observation；它们不是 4 个 module activation sample，enforcement 仍关闭。 | 若 shadow 发现相关未选失败，应扩大 full/shadow 并阻塞 activation；当前没有 enabled module run。 |
| EFF-T42 | OBSERVATION-PENDING | 没有限定证据证明每个模块已有所需 10/3/6 samples/categories；native command 数量不能替代它们。 | 保持 shadow，不制造样本。 |
| EFF-T43 | NOT ADOPTED | enforce/rollback activation 关闭；conservative full union 仍是安全 fallback。 | 不得声称 omission=0 或 enabled rollback PASS。 |
| EFF-T44 | NOT ADOPTED | 没有 concurrent Quality-shard 实现；serial 是当前接受选择。 | 没有 isolated DB/object/port/runtime/report 证据。 |
| EFF-T45 | NOT OBSERVED | 没有 shard startup/seed/execution failure packet。 | bounded cleanup 仍只是未验证 policy，不是执行证据。 |
| EFF-T46 | NOT ADOPTED | 没有 shard cleanup 实现，亦没有 marker/unknown-PID/DB refusal 运行。 | 不要为了填行添加 global kill/drop。 |
| EFF-T47 | NOT ADOPTED | 没有 shard report aggregation 实现或 duplicate/wrong-SHA rejection 运行。 | serial 证据不能替代 shard aggregation。 |
| EFF-T48 | PARTIAL | 既有 Quality/Smoke 证据保留 serial UI baseline。 | shard warmup、fonts、viewports、screenshot-baseline preservation 没有实现或重跑。 |
| EFF-T49 | NOT ADOPTED | 原 serial inventory 继续作为 fallback。 | 没有 shard-versus-serial equivalence 证据。 |
| EFF-T50 | NOT ADOPTED | 当前切片没有采用 Node/jsdom split。 | DOM/provider tests 保持现有环境；不得声称已 split。 |
| EFF-T51 | NOT ADOPTED | proposed pure/PG split 没有采用。既有 PG-required coverage 在没有 PostgreSQL 时失败/阻塞，新 runner 也没有 PG adapter，但这不等于实现了 split。 | 保持原 backend 环境边界；pure/PG 不得标为 PASS。 |
| EFF-T52 | HISTORICAL ONLY | `work/efficiency/eff07-observation/type-feedback-evaluation.json` 记录了 head `66e572a4c45bd5d4db164380a2200e7ee6c10ac4`、tree `26b7acc0e03a07922e57fe688ca285eb6a741346` 的 12 次 cold/warm timing 观察。这些 timing 与两个 TypeScript-project Red→Green checks 分开。 | type candidate 仍未合并；这不能证明当前 type-entry optimization、global C 或 full-main 结果。 |
| EFF-T53 | NOT ADOPTED | 没有采用 worker/heap/fixture optimization。 | 不得声称有可重复的 OOM/connection/residual-state 收益。 |
| EFF-T54 | NOT ADOPTED | 没有采用 timing/retry/wait change。 | 更大的 timeout 或忽略 failure 不构成 readiness 证据。 |
| EFF-T55 | PARTIAL | EFF08 审查 route `5418af9474415fec111994accda5e46250e6271b`，包括旧 UI/scripts 与后续 PG 证据。 | 这些源没有重跑；当前 routing 与 override 身份仍需最终 source settlement。 |
| EFF-T56 | PARTIAL | 已审查 compact packet/protocol/recovery 文档中的新会话恢复路径。 | 没有保留最终候选的当前、无需完整重读的 recovery execution。 |
| EFF-T57 | UNKNOWN | 有 bounded usage coverage，但 whole-program token usage、duplicate-terminal、missing-subagent accounting 仍不可用。 | token usage 和节省保持 unknown；不得估算或重复计数。 |
| EFF-T58 | PENDING | 已有各 PR source package 和 hash，包括 #835 与 #836。 | 最终 source union、bundle identity、字节/hash 校验、清理以及排除 secrets/logs/DB 仍待完成。 |

## 交付边界

最终源码并集身份、逐 PR 审查/Hosted/合入记录、自有资源处置和最新 main 全量状态由父检查点及 [Issue #828](https://github.com/tzrea1-Q/WiseEff/issues/828) 承载；原失败保留为历史。可选 memo、分片和未采用的拆分不能改写为 PASS。A 交付不代表 B/C 完成；本表不授权空提交、重复 Hosted 凑样本、放宽断言或原始产物兜底上传。

## 文档影响矩阵

| 领域 | 处置 |
| --- | --- |
| 回归证据 | 同步更新本台账及互链英文文件，保留具名源码身份和限制。 |
| 项目与其他文档 | 互链父计划维护完整影响矩阵、当前状态、余项责任与最终交付门禁；本台账不增加运行时、schema、产品或策略变化。 |

## 文档更新门禁

按父最终文档任务包验证双语链接、58 个唯一 ID、精确源码/证据引用、直接文档治理与验收元数据。父协调者在合入前要求独立 R1 审查和实际选中的 Hosted 结果；数据库 schema 与当前 main 完整验收是独立证据。本台账不能关闭仍活跃的 B/C 观察项目。
