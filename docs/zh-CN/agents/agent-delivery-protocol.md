# 智能体交付执行协议

> English: [English](../../agents/agent-delivery-protocol.md)

本协议约束由父级总指挥、实现智能体和审查智能体共同完成的目标型交付。它与[多工作区协调规则](../../agents/fleet-coordination.md)互补：协调规则处理多个 worktree 的冲突，本协议决定何时设计、审查、封印、运行 CI、合并和解锁。

## 权威顺序与不变量

规则按以下顺序适用：

1. 安全、权限、破坏性操作和人工审批边界。
2. 已验收的 Issue、ADR、实现规格和精确证据合同。
3. 本交付协议。
4. 当前 program 登记的 run profile。

下层不能豁免上层。发生冲突时，父会话必须先记录冲突并停止，再请求决策。证据层继续严格区分：文档/静态、本地 pure/fake、真实本地 PostgreSQL、browser-real、Hosted/CI、target-host、release、production approval 彼此不能推导。

## 核心概念

- **Scratch**：没有打开 PR 的可变实现 worktree/branch，用于 Red -> Green 和审查驱动的迭代。
- **Threat matrix**：在封印高风险不变量之前，穷举成功、失败、并发、血缘、回滚和伪造场景的有限矩阵。
- **Seal**：首个计划保持字节、血缘、生成物和 fingerprint 不变直至集成的候选。
- **Delivery candidate**：提交给最终独立审查和 Hosted 的精确 commit。
- **Lane**：一个 node 及其 worktree、智能体、所有权路径、证据和合并位置。
- **Frontier**：native blocker、body-only gate、attestation 和 label 全部满足的 ready nodes。

优化目标是：**一次封印、一次最终审查轮次、一次 Hosted**。这是预算，不是跳过必要证据的授权。

## 风险分级

父会话必须在派发前为每个 node 分级。多个等级同时适用时取最高等级。

| 等级 | 常见变更 | 必需的设计处理 |
| --- | --- | --- |
| R1 — 有界 | 文档、生成元数据、机械 adapter、隔离测试 | 精确路径、focused test、有界审查 |
| R2 — 行为 | 领域逻辑、公开 API、UI workflow、持久化 adapter | 状态/合同用例、production seam focused test、独立 Standards 与 Spec 审查 |
| R3 — 封印 | 安全、授权、migration、并发、恢复、破坏性操作、provenance、checksum、release gate | 实现前 threat matrix、对抗 Red 用例、封印前独立 Standards 与 Spec 审查、环境专属证据 |
| Temporal | 兼容窗口、遥测窗口、多 release 退役、生产审批 | 可以完成代码；真实时间和 release 证据出现前 program 仍保持开放 |

R3 应只覆盖真正高风险的窄 seam，不能自动扩散到整个 program。宽任务应拆分，普通 consumer 不继承封印成本。

## 状态机

每条 lane 在任意时刻只有一个状态，父会话的进度报告必须明确写出该状态。

| 状态 | 进入条件 | 完成标准 |
| --- | --- | --- |
| `PREFLIGHT` | 用户范围和停止边界明确 | Goal 状态、精确 `origin/main`、clean worktree、Issue readiness、blocker、路径和 run profile 已记录 |
| `THREAT-READY` | R3 node 已完成 preflight | threat matrix 每行都定义 expected observation，并有可执行 Red 或明确的不可执行证据 owner |
| `SCRATCH` | R1/R2 preflight 完成，或 R3 node 已为 `THREAT-READY` | reproducer 为 red，focused check 下实现为 green |
| `PRESEAL-REVIEW` | Scratch 候选本地 green | 所有并行审查 finding 已汇总为一个 disposition |
| `SEALED` | 封印前 finding 已闭环 | 精确候选、基线、路径、血缘、fingerprint、证据命令已冻结 |
| `INTEGRATION-READY` | 已确定前序合并位置 | 候选已刷新到当前 main；顺序编号和受影响 focused checks 通过 |
| `HOSTED` | 精确候选已打开最终 PR | 必需 jobs 在该 SHA 完成；skip 仍按 skip 记录 |
| `MERGED` | 审查与 Hosted 通过 | GitHub 返回精确 merge SHA，并按规则删除 feature branch |
| `ATTESTED` | merge 已在 `origin/main` 可见 | 下游 CF slots、证据边界、Issue 状态和本地 main 同步均已验证 |
| `CLOSED` | attestation 完整 | 已重算 frontier；只有另行授权的 ready-label mutation 才能执行 |

`SEALED` 前任何字节变更都回到 `SCRATCH`。`SEALED` 后任何字节变更都会使 seal、review、fingerprint 和 Hosted 证据全部失效；lane 回到 `SCRATCH`，不能直接再跑一次最终 CI。

## 步骤 1：Goal 与容量预检

派发前，父会话记录：

- 用户授权的结果和停止边界；
- durable Goal 是 active、paused、complete 还是 blocked；
- 精确 `origin/main`、Issue IDs、native dependencies、CF/ID/RE gates 和当前 frontier；
- 可用 agent slots、development WIP、review capacity 和确定的 merge order；
- 每条 lane 需要的 evidence levels；
- deadline lower bound。

用户可以授权在 paused Goal 下执行一轮有界工作，但父会话必须说明这不是可自动续跑的 Goal，不能通过创建重复 Goal 掩盖状态。

承诺截止时间前必须计算可行性下界。下界包含 critical path、不可重叠 review、最终 Hosted 时长、target/release 窗口和 integration refresh。Temporal programs 与 code-complete nodes 分开报告。请求期限低于下界时，应提供更小的代码/证据里程碑，不能静默接受不可能完成的承诺。

### 必需控制记录

父会话为 wave 保留一份紧凑持久记录，并为每条 lane 保留一份记录。状态需要跨会话存续时优先写入仓库 plan 或 Issue comment；临时协调可使用当前 task state。

```text
Wave: goal, accepted-main, stop-boundary, deadline-lower-bound,
      lanes-in-merge-order, shared-resources, development-WIP,
      review-slots, next-Hosted-lane
Lane: node, issue, risk, state, base, head, editable/read-only/forbidden paths,
      threat-matrix, focused/local/PG/browser/Hosted/target/release gates,
      repair-cycles, fingerprint-count, PR/CI state, blocker, next-transition
Seal: base, head, tree/path-set, lineage, generated hashes, fingerprint,
      completed reviews, evidence commands/results, explicit skips
```

智能体只报告状态转换、blocker 与最终结构化证据，不流式播报常规过程，也不粘贴成功的完整日志。父会话通过 cursor 或有界事件等待 task/CI 更新，不轮询未变化状态。失败报告只包含命令、exit status、最小必要片段、分类和 next owner。

## 步骤 2：先规划 wave，再启动 lane

父会话选择一个有界 wave，并冻结：

1. lane 成员和风险等级；
2. 精确 editable、read-only、generated 和 forbidden paths；
3. migration number、generated schema、fixture、UI registry 等共享资源；
4. merge order；
5. 哪条 lane 可以打开下一个 PR 并运行 Hosted；
6. 后续每条 lane 在前序 merge 后需要的 refresh。

为 integration 与 review 预留容量。共享 migration、generated schema、OpenAPI 或 fingerprint 的 Foundation/R3 默认 development WIP=2。路径不相交的 R1/R2，以及不共享这些文件的 R3，在仍有 review capacity 时可将 development WIP 提到 4。R2/R3 lane 进入 pre-seal review 时，已完成实现的智能体释放 slot，使 Standards 与 Spec review 能够并行。Hosted 运行期间，父会话必须派发或继续至少一条不相交 Scratch/review lane，或记录当前没有不相交工作。

只有下一个 merge lane 可以进入 `HOSTED`。后续 lane 在该 Hosted 进行时继续走 `SCRATCH`、`PRESEAL-REVIEW` 和 `SEALED`，并在自己的 Hosted 前立即 refresh，而不是空转到前序合入。这样既避免绿色 CI 立即过期，也不冻结开发。

## 步骤 3：在 Scratch 中开发

实现智能体收到的任务包必须包含：

- 精确 Issue 和 accepted base；
- 风险等级与 threat-matrix 要求；
- allowed/read-only/forbidden paths；
- public seam 与 Red -> Green 描述；
- 必需 focused commands 和 evidence levels；
- branch/worktree、model/reasoning profile 和停止边界；
- 明确禁止创建 PR、修改 main、修复无关问题和派发下游。

Scratch branch 可以 push 用于持久备份，但不能打开 PR。实现循环只运行能让当前 Red 变 Green 的最窄真实检查。仅当变更 seam 需要时加入 typecheck、build、真实 PostgreSQL 或 browser-real；不把 broad suite 当 inner loop。

遇到无关失败，只允许一次 isolated rerun 或 current-main 对照来分类。本 lane 的 focused evidence 不受影响时，记录后继续；没有单独 claim 时不得顺手修复 unrelated main-red。

## 步骤 4：R3 封印前冻结 threat matrix

R3 必须由 Spec reviewer 在生产实现开始前挑战不变量。矩阵覆盖所有适用维度：

- 初始状态与 owner/scope 组合；
- 成功、重复、重试、lost response、idempotent replay；
- partial failure、rollback、cleanup failure、recovery；
- 并发、stale、重排、多 parent 历史；
- 缺失、malformed、ambiguous、forged、cross-boundary 输入；
- fresh、populated、upgrade、downgrade/restore、zero-data；
- Git 血缘属于可信证据时的 direct、shallow、Hosted merge 和 later full-history execution。

每行都要写 observable result 和 evidence owner。可执行用例在 Scratch 中先为 red。矩阵完成前不得创建 checksum、lock、migration 或 release report。此阶段发现的 counterexample 必须先变成永久测试，再生成最终 fingerprint。

## 步骤 5：封印前审查与熔断器

R2/R3 的 Standards 与 Spec 针对同一个 Scratch SHA 并行审查。R1 默认使用一次有界 combined review，除非 accepted contract 明确要求更多。提示词包含精确 base/head、accepted contract、path policy、固定 checklist、允许执行的命令和 evidence boundary。Reviewer 返回 `PASS`，或返回带 severity、invariant、path/line、reproducer/proof 和 minimum correction 的编号 actionable findings。审查不能扩散到相邻研究，但任何能推翻声明不变量的具体 counterexample 始终属于范围。

父会话必须等待全部 required reviews 返回，再发出一个合并、去重后的修复任务；R2/R3 的第二位 reviewer 尚未完成时，不能对第一份结果立即返工。

熔断规则：

- 同一不变量出现第二轮 P1/P0，停止补丁式修改，回到 threat-matrix 设计。
- Hosted 前生成超过两个 fingerprint/lock，说明封印过早；应从已审查 Scratch 字节重建 delivery candidate。
- Reviewer 在约定预算内无法说明当前检查或结论时，收窄或停止，不能静默扩大测试计划。
- broad suite flaky failure 不得反复全量重跑；isolated 一次、完成分类、保留输出。

## 步骤 6：只封印一次

普通 R1/R2 将审查后的 commit 作为 seal。R3 provenance/checksum 使用两层流程：

1. 在无 PR、无最终 fingerprint 的 Scratch branch 自由迭代。
2. threat matrix 与 pre-seal reviews 通过后，在 clean delivery branch 按要求的精确 commit topology 一次性落下已批准字节，只生成一次 fingerprint 和一次 external lock。

Seal record 包含 base SHA、candidate SHA、tree/path set、必要的 file modes、生成物 hashes、contract fingerprint、focused results、review results 和已知 skipped evidence。封印后任何字节或血缘变化都必须创建新 seal record，并消耗 exceptional rework budget。

## 步骤 7：按 merge order 刷新

创建 PR 前立刻 fetch 当前 `origin/main`，按仓库集成方式刷新。重新检查 migration/ADR/TD 编号和 generated artifacts；刷新后运行 typecheck 与受影响测试。Migration/schema lane 必须在拥有该证据的环境重新生成 schema 文档，并重跑 focused real-PostgreSQL checks。

若另一条 lane 必须先 merge，本 lane 还不能运行最终 Hosted。无冲突 refresh 不是语义证据，但也不自动要求 broad local suite：只重跑受影响 seam，以及 accepted run profile 没有交给 exact-candidate Hosted 的明确 node gate。

## 步骤 8：最后才打开 PR

只有 lane 达到 `INTEGRATION-READY` 且最终 review 为 green 时，父会话才能打开 PR。PR body 记录精确 candidate/base、Issue、risk class、focused/environment evidence、skip/not-run evidence，以及预计运行的 Hosted jobs。

目标是一次 PR creation、零次 synchronize event 和一次 Hosted。只有 Hosted 独有故障或 mandatory post-main-refresh candidate 才可例外允许一次 synchronize event 与第二次 Hosted。新 push 意外使已有 run 过期时，立即 cancel 旧 run。Code/spec failure 必须回到 Scratch；修复期间关闭 PR，新 seal 审查完成后再 reopen。

CI annotation 按 changed path 和 reproducer 分类。既有或无关 warning 只报告，不在 lane 内修复。Skipped job 永远不能写成 passed。

## 步骤 9：合并、attest、推进

只有父会话可以 merge。Merge 后验证：

- PR state 与 merge SHA；
- `origin/main` 与专用 clean local main worktree；
- remote feature branch 状态；
- 精确 Issue state 与 labels；
- 必需 downstream CF attestation slots；
- unrelated worktrees 未变化；
- 重算后的 frontier。

关闭 producer 不代表获得启动 consumer 的授权。Ready-label mutation 与新派发是独立 frontier transition。用户停止边界按以下方式执行：

- **Stop now**：不再执行外部 mutation，只报告当前安全状态。
- **Stop after current merge**：仅完成已经批准的 PR、attestation、Issue closure、branch cleanup 和 main sync；不得刷新另一个 PR、修改 frontier 或派发工作。
- **Stop after wave**：只完成冻结 wave 已命名的 lanes，不加入刚解锁的 node。

## 验证调度

| 时点 | 执行内容 |
| --- | --- |
| 每次实现修改 | 仅运行最窄 Red/Green focused check |
| Scratch 本地 green | 受影响 typecheck/build，以及必需 PG/browser/environment seam |
| Pre-seal | 固定 adversarial matrix 和审查 focused checks |
| Integration refresh | 受影响 focused checks 与编号/生成物检查 |
| 精确 delivery candidate | 每个明确要求的本地 evidence level 各一次 |
| 打开 PR | 一次 exact-candidate Hosted |
| Target/release | 只运行真实 target/release procedure；不能从 local/Hosted 推导 |

Issue 明确要求的命令保持 mandatory，除非 accepted amendment 显式 remap。只有 run profile 写明 exact Hosted job 运行相同命令或已证明的 superset，且不把 Hosted 伪装成本地证据时，才能避免重复执行。不能仅为了得到两份日志而在同一 tree 上运行两次 `test:all`。

## 运行指标与轮次报告

只要运行时可观测，父会话就记录：

- merged、sealed、reviewing、blocked nodes；
- active development、review wait、CI wait、integration wait；
- repair cycles，以及按发现阶段区分的 P0/P1/P2；
- fingerprint 生成次数；
- CI started/cancelled/failed/passed 与 runner-minutes；
- focused、full、PG、browser、Hosted、target、release 证据分别统计；
- 仅在运行时能提供有界数据时记录 token use。

不能编造缺失的 token 或 timing telemetry。每轮必须报告 next frontier 和最大可避免等待。吞吐按 merged nodes 与可复用 sealed candidates 衡量，不按 commit/test 数量衡量。

## 默认预算

以下预算用于触发重新设计，不用于降低质量：

- development WIP：共享 migration、generated schema、OpenAPI 或 fingerprint 时为 2；路径不相交时为 4；
- open final feature PR：program-wide 1 个；只有 accepted run profile 明确标识独立 merge waves 时才可增加；
- 纯流程 PR（协议、操作规则、文档、不修改 launch-node 产品路径的 helper 脚本）：独立 merge wave，可与当前功能 Hosted PR 并存；
- final Hosted：1 次，仅 Hosted-only failure 或 mandatory refresh 可例外到 2 次；
- 同一不变量的 P0/P1 repair cycles：2，之后回到 threat matrix；
- final fingerprint generation：1，例外最多 2；
- unrelated full-suite rerun：0；
- Hosted 等待期间既无其它已派发 lane、也未记录“没有不相交工作”：0；
- 用户 stop boundary 后的 downstream dispatch：0。

Program 只有在 accepted run profile 中事先记录成本与理由，才能覆盖预算。

## 效率不变量

这些规则用于在不削弱证据层的前提下减少墙钟等待。

1. **合入串行，开发不串行。** 只有下一条功能 merge lane 打开 PR 并运行 Hosted。其它 ready lanes 继续在 Scratch 中实现、审查和封印。
2. **Hosted 只做确认，不做发现。** PostgreSQL 或 RBAC 节点必须在预检时使用专用 lane 数据库，并以 Hosted 将使用的 Catalog 角色跑过 Issue 点名命令。默认 compose 应用库 `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff` 不能作为 catalog-lane evidence。收集到 0 个测试文件是硬失败。
3. **盘点一次锁定。** occurrence 计数、allow-list、schema fingerprint 和 lock 文件在 `THREAT-READY` 对受信基线完整扫描后锁定。同一不变量的第二次补丁触发 circuit breaker。若只有一个选项能通过 Hosted，父会话记录该选择并继续。
4. **无关 flake 只隔离重跑一次。** 使用一次 `gh run rerun --failed`。不得在本 lane 修补无关测试。
5. **Catalog launch nodes** 同时遵守[目录 launch 操作规则](catalog-launch-operating-rules.md)。
