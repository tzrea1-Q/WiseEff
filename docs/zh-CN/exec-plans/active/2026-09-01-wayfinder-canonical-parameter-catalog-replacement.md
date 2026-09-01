# Wayfinder 规范草案：用唯一 canonical definition model 替换参数目录（#668）

> English: [English](../../../exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md)

状态：**待父会话审查的完整规格草案**。在所有者确认模块 seams、实现切片/后续 ticket 粒度和依赖边之前，禁止进入 `/to-tickets`、生产实现、PR 或合并。

基线：`origin/main@406c23bcaf0dcfca284de3135e27bfcd19c29c4e`。本规格描述目标合同，不宣称主线已经实现，不预留 migration 编号，也不构成发布批准。

## Problem Statement

当前参数目录把同一个属性合同分散在 `parameter_specs`、`parameter_spec_versions`、attribution subject、DriverSchema、组织 overlay、模块、review、Binding 和历史行中。组织 draft、subjectless DTS surface、schema root、proposal 或历史版本可能在不同读路径中看起来像第二个当前定义；lazy ingest、overlay precedence、current flags、模块归属和当前版本选择又形成多套结构权威。

目标是一次有界维护窗口内完成替换：Platform 仓库中经过 review 的不可变 Catalog Release 是唯一结构来源；PostgreSQL 是其可验证投影；组织只注册并放置正式 Subject；Observation、ReviewEvidence、Proposal、Binding 和 ProjectValue 各自保留证据与业务职责，不得创建 Catalog 真相。切换必须保留可证明的稳定 ID、完整历史和审计，在 unknown/ambiguous 状态 fail closed，并由真实 PostgreSQL、真实候选 API、browser-real 和 self-hosted 目标证据分层证明。

### 不可变输入

下列 SHA 是规范约束，不是可选背景：

| 决策 | 不可变 SHA | 本规格消费的约束 |
| --- | --- | --- |
| #669 contract inventory | `f982c76a063f3c8bc0a7366d5253243ecba2866f` | 11 类消费者、稳定引用、现有写者/读者、审计和迁移职责 |
| #670 legacy classification | `000f617ba9810adda4798b4bc4b2bdfed95b4c39` | R0–R10 完整关系图分类，禁止弱证据推断 |
| #671 populated rehearsal fixture | `6c3adfc35c0e3be6d5d381013dace9408190380e` | closed-world fixture、R6/R8 twin、真实 PostgreSQL 与 rollback containment |
| #672 canonical relational model | `542c7a8bbce3bd6bb230b0d020d23d10af5182a9` | Catalog/Registration/Placement/Binding/ProjectValue 的关系和约束 |
| #674 Catalog publication | `bef06b341499e99fadddda7cf3db463c01511d55` | 不可变 release bundle、唯一 materializer、同步/回放/缓存 |
| #675 registration/placement | `9fe269d4facc31b49fc1e0535d2d51ba7140644b` | selective registration、exactly-one placement、unknown/ambiguous review |
| #676 DEV-only UX evidence | `9c803557a55803ccca79c20eadd033f57d4729e0` | A+B+C 单页 IA、响应式形态和人工决策；不得合并或当作实现证据 |
| #673 Catalog Kernel | `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb` | 六个语义操作、typed snapshot、事务、错误、权限和缓存边界 |
| #677 API/legacy transition | `c6c08e6e6f208f88160bdbcc610eec9f8e516cc3` | canonical API、角色、并发、legacy ID 和 sunset |
| #678 cutover/archive/rollback | `1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d` | P0–P16、mapping、Archive、P11、rollback 和 recovery |
| #679 verification/upgrade/retirement | `465c07ed60ca7fa6b7b2ff2f2559e8ccf504af9f` | 六类 purpose、report chain、V/D/API/UI、自托管和 retirement gate |

### 冲突与取代规则

- 上述不可变输入之间未发现需要产品裁决的冲突。#679 明确修复 #678 早期 P14 证据循环：P13 后必须新建 attempt 并完整重跑 V01–V17 与 D01–D09；真实 API/browser evidence 只能在 post-retirement runtime pin 通过后产生。
- 主线旧合同与目标合同的不同是迁移输入，不是 blocker。ADR-0008/0009 的组织 overlay、ADR-0013 的组织 shadow subject、ADR-0014 的组织定义 override、ADR-0032 的原地 documentation PATCH、ADR-0039/0127 的全组织 eager placement，均由 #668 与 ADR-0040–0042 的目标合同取代。
- 如果实现阶段发现不可变 SHA 之间出现本规格未覆盖的实质矛盾，立即停止相应 slice，记录双方原文、受影响 invariant 和最小复现；不得按“较新”“较方便”或当前代码行为自行选择。

## Solution

建立且只建立四个对外深模块：**Catalog Kernel**、**Parameter Governance**、**Catalog Cutover**、**Release Verification**。Catalog Kernel 独占 release 编译、materialization 和一致 snapshot；Parameter Governance 是唯一对外治理深模块，在内部拥有 Subject Registration/Placement、Observation/ReviewEvidence/ReviewItem、DefinitionProposal 和 review-resolution transaction coordinator；Catalog Cutover 独占 P0–P16 的 phase 语义、R0–R10、mapping、Archive、checkpoint 与 recovery；Release Verification 独占 purpose/report/approval/runtime-pin。Binding/ProjectValue 是消费这些合同的业务模块，不是第五个治理深模块。HTTP、前端、consumer 和 `upgrade.sh` 只是适配器，不能重新编排内部事务、传递 transaction handle、选择 Definition head、推断 legacy disposition 或豁免 gate。

目标读路径只从一个捕获的 Catalog Release snapshot 解释 Subject、alias、Definition 和 Revision。组织上下文通过独立 composer 加入 Registration/Placement、usage、Review 和 Audit 投影；它不能改变 Platform truth 或在 Kernel 分页后再过滤。目标写路径只允许 synchronizer materialize Catalog；组织与项目写入各自 aggregate；所有 unknown/ambiguous/retired/drift 状态都产生 typed outcome，不以 `null`、空目录、overlay、cache 或“latest”回退。

## User Stories

1. 作为普通用户，我可以在唯一的 Parameter definitions 页面查看当前发布的正式定义，即使本组织尚未注册其 Subject。
2. 作为组织 Admin，我可以显式注册当前 release 中 active 的 Driver 或 NodeType，并明确选择默认未分类位置或合法父位置。
3. 作为组织 Admin，我可以在不改变 Subject、Definition、Binding 或历史 ID 的前提下移动/重命名唯一 retained Placement。
4. 作为组织 Admin，我可以 retire/restore Registration，且两次转换复用同一 Registration 与 Placement ID。
5. 作为组织 Admin，我可以在同页 Review Queue 处理 unknown、ambiguous、placement conflict 和 retired-registration evidence，但不能创建组织定义。
6. 作为组织 Admin，我可以提交 DefinitionProposal；作为不同的 Platform Admin，我可以接受或拒绝它，而 acceptance 只产生 publication intent。
7. 作为 Platform 发布者，我可以发布一个完整、不可变、可重现编译的 Catalog Release，而不是通过 UI 或数据库临时编辑 Catalog。
8. 作为运行时调用者，我在一次请求中只观察一个完整 old 或 new release snapshot，不会混合 membership、alias 或 revision head。
9. 作为项目参数用户，我的 Binding 使用 canonical `definitionId`、`effectiveRevisionId` 和 `currentValueId`；旧 `parameterSpecId` 不再定义业务身份。
10. 作为审计/历史用户，我可以按 exact Catalog Release 和 exact DefinitionRevision 回放，不会被当前 alias、lifecycle 或 head 重新解释。
11. 作为 ingest 系统，我只在 authoritative matcher 唯一证明 active Subject 时自动注册；unknown property 仍只产生 evidence/review，不创建 Binding 或 Definition。
12. 作为 Agent，我只能按调用主体权限读取 Catalog，不能注册、放置、review、proposal 或发布结构真相。
13. 作为外部 legacy client，我在兼容窗口内获得 typed mapping/redirect/gone/conflict/not-found，而不是 property-key 猜测或 Archive payload。
14. 作为部署 Operator，我可以对 fresh 或 populated 数据库使用同一个 phase controller、同一组 verifier 和同一 recovery 模型。
15. 作为 Platform owner，我只能批准绑定 exact report digest 与 purpose 的行为，不能用人工签字覆盖失败 gate。
16. 作为 incident owner，我可以依据不可变 journal 和 Recovery Point 执行合法 resume、forward recovery 或 whole-state restore，并知道 pointer-only rollback 是否已永久关闭。

## Implementation Decisions

<a id="pcat-spec-modules"></a>

### 1. 最终模块边界、所有权与依赖方向

| 四个深模块 | 独占所有权 | 对外 interface | 明确不拥有 |
| --- | --- | --- | --- |
| Catalog Kernel | 编译、验证、安装、pre-traffic switch-back、current/pinned snapshot、matcher、revision history、materialization verification/cache | `CatalogMaintainer`、`CatalogRuntime`、`CatalogVerifier` 三个 role-shaped facet，共六个语义操作 | HTTP 路由、Registration、Proposal、Observation、Binding、release approval |
| Parameter Governance | Registration/Placement、Observation/ReviewEvidence/ReviewItem、DefinitionProposal、review-resolution coordinator、对应成功/拒绝审计 | `GovernanceReader` 与 typed governance commands；review 只能走 `resolveReviewItem` | Catalog materialization、Definition/Revision 写入、Binding/value 写入、caller-owned transaction |
| Catalog Cutover | `planCutover`、`executeCutover`、`inspectCutover`、`recoverCutover`；P0–P16 phase 语义、R0–R10、mapping/Archive、locks/checkpoints、rollback/recovery classification | 四个 maintenance 操作 | Kernel 内部事务、verification approval、HTTP/UI 编排、traffic release authorization |
| Release Verification | gate registry、plan/attempt/report、lineage、purpose approvals、runtime pin、evidence retention | 五个语义操作 + 私有 readiness projection | 修复、migration、sync、Archive 解密、traffic mutation |

| 支持模块/适配器 | 所有权 | 依赖/公开面 | 禁止事项 |
| --- | --- | --- | --- |
| Catalog source/publication | release bundle、manifest/YAML、稳定显式 ID、CI 编译产物 | immutable artifact -> Kernel compiler | PostgreSQL pointer、组织数据、runtime repair |
| Binding & ProjectValue | canonical Binding、effective revision CAS、immutable values、explicit current pointer/history | captured Kernel snapshot + active Registration contract | Definition head 选择、module-as-identity、治理写入 |
| Legacy Mapping & Archive | typed identities、append-only mapping versions/heads、Archive metadata/object refs | Catalog Cutover 私有 adapter；compat/operator exact lookup | 重新分类、普通 Catalog 读取、public Archive enumeration |
| Database current-release guard | migration owner 独占 transaction-local active-membership assertion 与 current-pointer shared/exclusive lock protocol | exact release ID/digest、Subject ID、expected `active` -> success 或 typed failure；Governance 只有私有 execute-only adapter | 返回 Catalog 行、公开 Kernel operation、Catalog 表 SELECT/DML、由 Governance 解释 lifecycle |
| Catalog application/API | 认证、scope、DTO、timeline/composed reads、wire idempotency/ETag mapping | 只调用四个深模块或 Binding/ProjectValue 的 public seam | raw repository、transaction handle、跨模块 writer 编排 |
| Parameter definitions frontend | URL state、单页 UI、application ports、conflict/reconfirm UX | frontend ports -> HTTP adapters | durable rule、raw migration diagnostics、mock-only authority |
| Self-hosted upgrade adapter | host/data-plane orchestration、journal IO、queue/proxy/process adapter | 调用 Cutover/Verification；release-integration package 统一汇合 | 自行选 gate、在 API startup migration/sync、人工 waiver |
| Shared audit/observability/evidence | durable refusal sink、metric/log/evidence stores、retention primitives | 私有 infrastructure adapters | Catalog 或 release 决策 |

依赖只允许如下方向：

```text
Catalog artifact -> Catalog Kernel
HTTP/composers -> Catalog Kernel runtime + Parameter Governance + Binding/ProjectValue
Frontend -> application ports -> HTTP adapters
Parameter Governance -> command 前的 Catalog nominal IDs + captured Kernel snapshot；write UoW 内只 EXECUTE migration-owned database current-release guard
Binding/ProjectValue -> captured Kernel snapshot + Parameter Governance registration read contract
Catalog Cutover -> Kernel maintainer/verifier + private governance/binding migration ports + mapping/archive + recovery
Release Verification -> read-only Kernel verifier + read-only Cutover/API/browser/recovery evidence adapters
upgrade controller -> Cutover + Release Verification
```

Parameter Governance 可以在**自己拥有**的 UnitOfWork 内协调多个内部 aggregate；禁止的是 caller、HTTP、Kernel、Verifier 或另一个模块打开/延长该事务，或分别调用多个 writer 后伪装成原子操作。所有 governance repository、write port、transaction coordinator、database-guard adapter 和 audit writer 都是模块私有；guard function 与 pointer-lock protocol 由 S2-SCH 而不是 Governance 所有。Parameter Governance 不得直接访问、锁定或解释 `catalog_state`、membership relations、其他 Catalog store 表或 Kernel internal store adapter。反向依赖、caller-owned cross-module open transaction、Governance Catalog-table import/query、HTTP 直接读 Catalog 表、Verifier 调 writer、Kernel 调 Governance、Binding 按 module 或 current head 猜测均由静态 ratchet 阻止。现有 routes-less `parameter-kernel` 只保留跨参数工作流 primitive；新的 Catalog Kernel 是独立深模块，不能把旧 legacy identity adapter 当 canonical read seam。

### 2. Catalog Kernel 深模块合同

公开操作固定为：

```text
compilePublishedRelease(source) -> Result<CompiledCatalogRelease, CatalogFailure>
installPublishedRelease(command: bootstrap|advance) -> Result<InstallResult, CatalogFailure>
switchBackBeforeTraffic(command) -> Result<SwitchBackResult, CatalogFailure>
verifyCurrentMaterialization(command) -> Result<VerificationSnapshot, CatalogFailure>
loadCurrentCatalog(expectedPin) -> Result<CurrentCatalogSnapshot, CatalogFailure>
loadPinnedCatalog(exactPin) -> Result<PinnedCatalogSnapshot, CatalogFailure>
```

- `CatalogRuntime` 只能 load current/pinned；`CatalogMaintainer` 只能 compile/install/switch-back；`CatalogVerifier` 只能 compile/verify/load pinned。角色通过组合授予，不靠运行时布尔值。
- Snapshot 捕获 release ID/version/digest/fingerprint 后不可变、无副作用。其同步 read facet 必须提供 Subject get/list/resolve、Definition stable-key/opaque-ID get/list、exact Revision get/list、Catalog publication timeline，并以 `found | unknown | ambiguous | retired | not-published | revision-unavailable` 等 tagged result 返回。
- Kernel 拥有 alias one-hop、Driver-first/NodeType-fallback matcher、lifecycle、head、fixed sort、cursor、selection fingerprint 与 before-pagination intersection。handler 不得 post-filter 一页。
- Catalog timeline 只返回 release/revision publication fact。Proposal、Registration、Binding/value 和 actor history 由授权 History/Audit composer 用 pinned high-water marks 合并。
- `ParameterValueShape`、constraints、units、value、matching metadata 是 closed tagged type，不得用任意 JSON 代替已验证 domain type。
- install 在写事务外先完整编译；事务内取得 exclusive advisory lock 与 singleton row lock，复查 lineage/idempotency，stage 全部 relation，强制 deferred constraints，更新 exact per-release heads，再原子切换 Definition heads 与 current release pointer，并同事务写 success audit/materialization evidence。
- 同 digest 且完整 fingerprint 相等是 read-only no-op；同 ID/version/digest 不同 bytes 为 `digest-conflict`；commit 已成功但响应丢失时，retry 验证后返回 no-op。
- Cache 以 exact release ID/digest/fingerprint 命名。current load 先读 pointer 决定 key；cache miss 只可从验证后的数据库投影重建，不得 parse YAML、远程 fetch、overlay compose、返回空 Catalog 或 runtime repair。
- Catalog failure 至少覆盖 `invalid-release` 的固定 violation、`drift` scope、`release-mismatch`、`digest-conflict`、`unsupported-lineage`、`synchronization-busy`、`historical-release-unavailable`、`switch-back-forbidden`、`invalid-selector`、`permission-denied`、`storage-failure`。

<a id="pcat-spec-governance-uow"></a>

### 3. Parameter Governance 深模块合同与原子事务 owner

Parameter Governance 是唯一对外 governance seam；Registration、Placement、Observation、ReviewEvidence、ReviewItem、ReviewResolution、DefinitionProposal 与 PublicationIntent 是其内部 aggregate/package，不是由 HTTP 拼装的独立 writer。对 Review Queue 的所有 resolution variant 只有一个 typed command：

```text
resolveReviewItem(command: ResolveReviewItemCommand)
  -> Result<ReviewResolutionResult, GovernanceFailure>
```

`ResolveReviewItemCommand` 必含 server-owned `TrustedInvocationContext`、organization/review item nominal ID、captured Catalog Release ID/digest、ReviewItem ETag、`Idempotency-Key`、canonical request fingerprint、reason，以及 closed union `register-subject | restore-registration | mark-out-of-scope | open-definition-proposal`。`register-subject` 还必须带 Subject ID 与显式 `PlacementIntent=use-default|choose-parent`；`restore-registration` 禁止 placement 字段；其他 variant 禁止 Registration payload。结果返回 exact ReviewItem/Resolution、可能存在的 Registration/Placement 或 Proposal、Catalog pin 和新的 ETag；失败是 closed `GovernanceFailure`，不得以 `null` 或部分结果表示。

`register-subject` variant 由 Parameter Governance 自己创建一个 pool-backed database UnitOfWork，并在同一事务中完成以下全部动作：

1. 复核可信 organization/principal/initiator 与 Org Admin 权限；Agent、Platform Admin 和 body/header 自报角色不得替代 Org Admin 的 placement 选择。
2. 预占 `(organization, command-family, Idempotency-Key)`，比较完整 canonical request fingerprint；exact committed replay 直接返回 stored result，不重做 mutation 或 success audit；同 key/different fingerprint 为 `revision-conflict`。
3. 对新 mutation 调用 migration-owned transaction-local current-release guard，输入 exact release ID/digest、Subject ID 与 expected `active`；caller 不向 Kernel 或 Governance 传 transaction handle，Governance 不读或锁 Catalog 表。
4. 锁定 ReviewItem，执行 `If-Match` ETag CAS，验证仍 open、reason/candidates 与 captured evidence 一致。
5. 创建或**精确复用** `(organization,subject)` Registration；只在 status、method/proof 与请求允许的 lifecycle 一致时复用。
6. 创建 exactly-one retained Placement，或证明现有 Placement 精确表达同一 `PlacementIntent`；冲突返回 `placement-conflict`，不得移动现有 Placement 迎合请求。
7. 追加 immutable ReviewResolution、更新 ReviewItem 状态/ETag、写 success audit 与 idempotency result reference。
8. 执行 `SET CONSTRAINTS ALL IMMEDIATE`（或等价 commit-time 强制），再一次 commit；任一步失败时 Registration、Placement、ReviewResolution、ReviewItem、success audit 和 success idempotency result 全部不可见。

#### Transaction-local Catalog current-release guard

Parameter Governance 在事务内唯一可用的 Catalog assertion 是私有 adapter interface：`assertCatalogSubjectActive({ expectedReleaseId, expectedReleaseDigest, subjectId, expectedMembership: "active" }) -> Result<void, CatalogCurrentGuardFailure>`。S2-SCH 独占 migration-owner `SECURITY DEFINER` database function、fixed safe search path、exact scalar input validation、stable SQLSTATE/detail codes 与全仓唯一 current-pointer lock protocol。function 不返回 Catalog row、lifecycle、current identity、candidate 或 membership object。closed failures 是 `PCAT-GUARD-RELEASE-MISMATCH`、`PCAT-GUARD-SUBJECT-NOT-PUBLISHED`、`PCAT-GUARD-SUBJECT-RETIRED`、`PCAT-GUARD-DRIFT`、retryable `PCAT-GUARD-SYNCHRONIZATION-BUSY`；私有 adapter 分别映射为 `release-drift`、`subject-not-published`、`subject-retired`、`catalog-not-ready`、`catalog-not-ready`，不得解析自由文本数据库错误。

新 Governance mutation 调用 guard 时，function 取得 current Catalog pointer 全仓 advisory lock 的 transaction-scoped **shared** mode，再原子断言 exact ID/digest pair 仍 current 且 exact Subject membership 为 active。S3-INS 在 Kernel private store adapter 锁定/复核/推进 `catalog_state` 和 Definition heads 前取得同一 lock protocol 的 **exclusive** mode。两种锁都保持到 commit/rollback。因此 pointer advance 与 Registration/review-registration 只有一个数据库 serialization point，而任一模块都不接收另一个模块的 transaction 或 store adapter。这个窄 guard 不改变 #673：Catalog 编译、store query、membership 解释、pointer mutation 和 Kernel internal adapter 仍归 Catalog Kernel；S2-SCH 只拥有 DDL/grant/guard semantics，Governance 只收到 success 或 typed failure。

`parameter_governance_writer_role` 对该 guard 只有 `EXECUTE`，`PUBLIC` 已 revoke；对 `catalog_state`、Catalog membership 与所有其他 Catalog relation 无 `SELECT`、`INSERT`、`UPDATE`、`DELETE`、sequence、ownership、assume-role 或 create-function 能力。直接 Catalog access 同时是 real-SQL permission failure 与 static import/query ratchet failure。

显式注册、唯一证明的自动注册、review registration 共享同一内部 registration writer 与锁顺序：`idempotency row -> transaction-local Catalog guard(shared) -> optional ReviewItem -> (organization,subject) registration key/row -> requested parent/destination taxonomy key/row -> retained Placement -> deferred constraints`。exact committed idempotency replay 在 guard 前短路，返回 stored release pin、IDs 与 audit reference；这是 response recovery，不是新 mutation。显式/review 注册要求 Org Admin 与 explicit PlacementIntent；自动注册只允许 Trusted System + captured matcher/release proof，落到 reserved default root，不能 restore retired Registration 或替人选择 curated parent；Agent 永无 write capability。同 Subject 不同 placement intent、stale release/ETag、retired membership、wrong-kind/cross-org/cycle 均 fail closed，无 partial write。自动与显式并发时，唯一 `(organization,subject)`、共享 key lock 与 exact-placement comparison 使它们收敛为同一 Registration/Placement，或一个成功、另一个得到 typed conflict；不得产生第二个 Placement。

Placement rename/reparent、Registration retire/restore、Observation ingest、Proposal transition 也只通过 Parameter Governance 的 typed commands；各自拥有内部事务与 idempotency/CAS，不把 repository 暴露给 caller。Observation 与 ReviewEvidence immutable；DefinitionProposal acceptance 只追加 `catalog_publication_intents` 与 trusted audit，绝不写 Catalog Subject/Definition/Revision/head/pointer。成功 audit 与 domain mutation 同事务；authorization、stale、malformed、evidence-conflict 等 refusal audit 通过独立 pool-owned durable sink 写入，不能借 caller transaction，也不能被主事务 rollback 擦除。

测试只从 public commands/query 观察结果，并用真实 PostgreSQL independent sessions 证明 ETag race、explicit/automatic/review race、lost response、key fingerprint conflict、deferred constraint failure、refusal durability 与 guard serialization 全矩阵。guard 必须 Red -> Green 证明：pointer advance 与 registration 相互阻塞且只产生一种合法串行化；若 retirement advance 先赢，新 mutation 返回 `release-drift` 或 `subject-retired` 且 Governance rows 为零；若 registration 先赢，它按 captured release 持久归因，advance 后的后续 mutation 看到 retired current membership；stale ID 或 digest 在 domain write 前失败；pointer transaction rollback 后等待者看到原 release，Governance rollback 释放 shared lock 且零 partial row；response lost 后即使 pointer 已 advance，retry 仍返回 stored result/audit reference。以 `parameter_governance_writer_role` 直接 SELECT/DML `catalog_state` 或 membership 必须得到 expected SQLSTATE。test-only repository、外部 transaction callback、直接插入 ReviewResolution 或分别调用 Registration/Placement writer 均是 static/behavior ratchet failure。

### 4. Release Verification 深模块合同

公开操作固定为：

```text
prepareVerification(subject, purpose, evidenceRequirements) -> VerificationPlan
runVerification(planDigest) -> VerificationAttemptSnapshot
assembleReport(planDigest, typedEvidenceRefs) -> ReleaseVerificationReport
approveReport(reportDigest, approvalCommand) -> ReleaseApprovalRecord
readReport(reportIdOrDigest) -> ReleaseVerificationReport
```

另有仅供 startup readiness 使用的私有 `readApprovedRuntimePin` 投影；它只能返回 exact 当前 P13 状态下最新已通过且已批准的 `post-retirement-runtime` report。startup 不得 prepare/run/approve、sync、migrate 或 repair。

- `purpose` 是 closed enum：`pre-activation`、`post-retirement-runtime`、`isolated-candidate-acceptance`、`public-release`、`legacy-read-sunset`、`p16-cleanup`。调用者不能自选 gate set。
- Plan 固定 application artifact/image、Catalog、database migration ledger、cutover、mapping/Archive、Recovery Point、acceptance、target、verifier 与 purpose/lineage 全部 digest。
- Attempt append-only。相同 plan/state 可重跑，但 deterministic fields 必须相等，否则 `PCAT-REPORT-NONDETERMINISTIC`。
- Report 对适用 registry 中每个 gate 恰有一项：`passed | failed | not-yet-executable | mode-proved-not-applicable`。只有 registry 的确定谓词可标 not applicable；不存在 waiver。
- Approval 是 report digest + purpose 的 append-only record；Operator 与 Platform owner 必须是不同认证主体；verifier signature 不是人的 approval。每个 purpose 单独批准。
- `public-release` report 必须聚合 exact pre-activation、post-retirement-runtime、isolated-acceptance report digests；它不能把 predecessor evidence 伪装为新执行。
- Release Verification 只有 read-only verifier credential；没有 `SET ROLE`、writer role、DDL、Catalog sync、Archive decryption 或 repair 权限。

<a id="pcat-spec-schema"></a>

### 5. Canonical relational schema 与约束

实现采用 PostgreSQL physical relation；下列名称是本规格选择的 canonical 名称。若后续实现 ticket 提议改名，必须证明 OpenAPI、migration、verifier 和文档同时等价，不能改变 key/ownership。

#### 5.1 Platform Catalog

| Relation | 必要列与 key | 不变量 |
| --- | --- | --- |
| `catalog_releases` | `id`, unique `release_version`, unique `release_digest`, restricted `predecessor_release_id`, compiled/toolchain digests | append-only，不 update/delete |
| `catalog_subjects` | `id`, `kind=driver` 或 `node-type`, `canonical_key`; unique `(kind, canonical_key)`、`(id,kind)` | Platform-only，无 organization/lifecycle/current selector |
| `catalog_drivers` / `catalog_node_types` | PK/FK `subject_id` 与 subtype fields | 每个 Subject exactly one matching subtype，xor deferred check |
| `catalog_release_subjects` | PK `(release_id,subject_id)`, lifecycle、selector snapshot/provenance、tombstone | active 时 tombstone null；retired 时 non-null；successor 不得遗漏 predecessor identity |
| `catalog_subject_aliases` | `id`, `subject_id`, selector kind/value；unique normalized selector、`(id,subject_id)` | 永久 owner，不得复用或链式 alias |
| `catalog_release_subject_aliases` | PK `(release_id,alias_id)` + composite owner FKs、lifecycle/provenance/tombstone | active alias 要求同 release active Subject |
| `catalog_state` | singleton PK，non-null `current_catalog_release_id` | 唯一 current release pointer |
| `parameter_definitions` | `id`, `subject_id`, normalized `property_key`, non-null `current_revision_id`; unique `(subject_id,property_key)`、`(id,subject_id)` | 无 organization/module/proposal/observation/content 列 |
| `definition_revisions` | `id`, `definition_id`, positive `revision_number`, `catalog_release_id`, `content_digest`, complete typed content; unique `(definition_id,revision_number)`、`(definition_id,id)` | 每个 persisted content delta（含 docs）新行；不可 update/delete |
| `catalog_release_definition_heads` | PK `(release_id,definition_id)`, composite FK 到 exact revision | exact pinned replay 与 switch-back 不按 max/time 猜 head |
| `catalog_materializations` | release、compiled/database fingerprint、attempt、success audit、installed time | append-only successful projection evidence |

`parameter_definitions.current_revision_id` 使用 deferrable composite FK `(id,current_revision_id) -> definition_revisions(definition_id,id)`。current pointer 切换前 deferred completeness trigger 必须证明 predecessor Subject/alias 全部显式继承或 retire、owner 一致、release heads 完整、active/tombstone 合法。历史 read 直接按 pinned release membership/head 表，不 join `catalog_state`。

#### 5.2 Organization、evidence 与 proposal

| Relation | 必要列与 key | 不变量 |
| --- | --- | --- |
| `organization_subject_registrations` | `id`, organization, subject, `status=active` 或 `retired`, method/proof, non-null `current_placement_id`; unique `(org,subject)`、`(id,org)`、`(id,org,subject)` | retire/restore 保留 ID 与 placement |
| `subject_placements` | `id`, registration, org, taxonomy `module_id`, origin；unique registration、`(registration,id)`、`(org,module)` | exactly one retained placement；same-org 与 kind-correct deferred check |
| `parameter_observations` | immutable source identity、org/project/logical-node/config/source locator、release/matcher pin、evidence fingerprint | 创建后不可变，不能成为 Definition |
| `parameter_observation_matches` | unique observation accepted match，pins registration/definition/revision/binding/release/matcher | 只有完整 provenance + unique active match；unknown/ambiguous 无行 |
| `parameter_review_evidence` | immutable evidence bundle、reason、candidate-safe digest、R class/source graph where applicable | 不包含可公开 raw payload |
| `parameter_review_items` | `id`, `organization_id`, `evidence_fingerprint`, `matcher_revision`, `catalog_release_id`, `reason`, `status=open`/`resolved`/`out-of-scope`, positive `etag_version`; unique active grouping `(organization_id,matcher_revision,evidence_fingerprint)` | group repeated evidence，不制造 identity；resolved 状态必须有 deferred resolution FK |
| `parameter_review_resolutions` | immutable `id`, unique `review_item_id`, `resolution_type`, `before_etag_version`, `after_etag_version`, actor/initiator、captured release、request fingerprint、typed registration/proposal/out-of-scope target | 与 item/Registration/Placement/audit 按 resolution 原子提交；closed union 的非目标列必须为 null，目标列必须恰好一个 |
| `definition_proposals` | `id`, organization/author, base release/revision, status closed enum `draft`/`submitted`/`accepted`/`rejected`/`withdrawn`, non-null current proposal revision、positive ETag；`(id,organization)` unique | 不含 accepted Definition/Revision materialization pointer |
| `definition_proposal_revisions` | immutable `id`, proposal, positive revision number, proposed typed payload/reason/evidence；unique `(proposal_id,revision_number)`、`(proposal_id,id)` | proposal edit 追加 revision；proposal current pointer用 deferrable composite FK |
| `catalog_publication_intents` | immutable `id`, unique accepted proposal, exact proposal revision/base release、repository/publication reference、reviewer/audit | 只表达 intent；无 Catalog table grant；不得携带 Definition head/pointer |
| `governance_command_idempotency` | PK `(organization_id,command_family,idempotency_key)`, request fingerprint, state, typed result ref, committed timestamp | `pending` 只在同一 UoW 内；success exact replay 复读结果；不同 fingerprint 永久冲突 |

Placement 的 `UNIQUE(registration_id)` 证明至多一个，Registration 的 non-null pointer 与 deferrable `(id,current_placement_id) -> subject_placements(registration_id,id)` 证明至少一个。Driver placement 必须落在 `driver-group`；NodeType 落在 `node-type`，父节点遵循已接受 taxonomy 规则。组织创建只建 reserved taxonomy root，Registration 初始为零。

#### 5.3 Binding、ProjectValue、mapping、Archive

| Relation | 必要列与 key | 不变量 |
| --- | --- | --- |
| `project_parameter_bindings` | stable `id`, org/project/logical-node, registration, subject, definition, non-null effective revision、explicit current value、release pin；unique `(project,logical_node,definition)` | 无 `module_id` 身份；composite FKs 证明所有 owner/revision agreement |
| `project_parameter_values` | immutable `id`, binding, definition, exact revision, source/config/value digest、typed value storage | history 不跟随 Definition head；禁止 update/delete |
| `binding_history_events` | binding、old/new pointer、reason、trusted audit、release/mapping pin | append-only；current 不按时间推断 |
| `legacy_identities` | unique `(source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)` | immutable typed source identity |
| `legacy_mapping_versions` | identity、run、checksum、graph fingerprint、R class、exactly one typed target or Archive、optional supersedes | append-only，不 reclassify at read time |
| `legacy_mapping_heads` | one CAS pointer per legacy identity | historical consumer pins version；forward repair 追加并 CAS |
| `parameter_catalog_archives` | archive ID、source/owner/R class/reason、checksums、encrypted object ref、protected refs、run/release/audit/retention | ordinary roles no update/delete/decrypt；不进入 Catalog/public UI |
| `catalog_command_idempotency` | Kernel/Cutover scope、key、request fingerprint、result ref、status | 仅非-governance command；exact replay 返回 stored result；同 key不同 fingerprint 冲突 |

R6 legacy spec 的 production target 是 ReviewEvidence + Archive/mapping evidence；R8 是 DefinitionProposal + Archive/mapping evidence。只有独立、完整的 project/logical-node/source-revision occurrence graph 才可产生 ParameterObservation；两者不得因相同 property key 合并。

#### 5.4 Cutover 与 verification persistence

Cutover 采用 `parameter_catalog_cutover_runs`、append-only `parameter_catalog_cutover_events`、CAS `current_phase`、typed phase checkpoints、classification ledger、comparison corpus/results 和 rollback-closure record。唯一 run tuple 是 `(source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest)`。

Verification 采用 immutable plans、attempts、gate results、reports、report-evidence refs、approvals、runtime pins 与 retention calculations。Report bytes canonicalize 后取 SHA-256；approval 不修改 report。`pointer_rollback_closed_at` 是 first candidate business mutation、first queue business delivery、first accepted public business request 的最早 durable event，一旦写入不可清除，测试数据补偿也不重开。

#### 5.5 角色与权限

- catalog relations 由 non-login migration owner 所有。
- `catalog_synchronizer_role` 只有插入新 immutable rows、column-limited 更新 `catalog_state.current_catalog_release_id` 与 `parameter_definitions.current_revision_id` 的能力；不能 UPDATE/DELETE immutable rows。
- application、proposal、Agent、ordinary API/worker 只有允许的 SELECT 与各自业务 relation 写权；不能 assume synchronizer/migration owner。
- `parameter_governance_writer_role` 只有 governance relation 的必要 DML、success audit append 与窄 current-release guard 的 `EXECUTE`；对所有 Catalog 表无 `SELECT`/DML，也无 Binding、ProjectValue、Cutover、Verification capability。HTTP/Agent composition 不获得其 pool；只有 Parameter Governance composition root 持有。
- proposal capability 只是 Parameter Governance interface 的 role-shaped facet；数据库 grant 只能触及 proposal/publication intent/audit，不能触及 Catalog。
- verifier role read-only，不能 `SET ROLE`、执行有写能力的 function、建立临时 writer function 或取得 Archive key。
- legacy structural tables在 P13 后所有 production role/function/trigger 路径都不可写；P01/P02 用真实 SQLSTATE negative matrix 证明。

### 6. 状态机与事务边界

#### Catalog publication

`uninstalled -> bootstrap-installed -> advanced*`；业务回滚是新的 forward release。pre-traffic switch-back 只在 zero-write/traffic + migration compatibility + previous projection/head map 完整时允许。所有其他回退 `switch-back-forbidden`。

#### Registration/Placement

`unregistered -> active -> retired -> active`。所有 transition 是 Parameter Governance command。explicit 注册要求 Org Admin + release anchor + explicit PlacementIntent；system auto-register 只接受 unique authoritative active match 并使用 reserved default root；review register 只通过 `resolveReviewItem`。三者共享上一节的 UoW、锁顺序、permission/idempotency/lost-response/conflict 合同；Agent 不得写。Observation 不得自动 restore retired Registration。move/rename 更新同一 Placement ID；destination conflict 与 audit 一起回滚。

#### Observation/Review

Observation immutable。matcher outcome 为 matched/unknown/ambiguous/retired/placement-conflict。ReviewItem `open -> resolved|out-of-scope`；resolution 只允许 `register-subject`、`restore-registration`、`mark-out-of-scope`、`open-definition-proposal`，全部穿过 Parameter Governance 的单一 `resolveReviewItem` typed command。`register-subject` 在 Governance-owned UoW 中原子覆盖 ReviewItem ETag CAS + idempotency + Registration + exactly-one Placement + Resolution + success audit；选择 existing Subject 不创建 Definition/Revision/Binding，后续 recognition 走 Binding/ProjectValue 的独立事务。

#### DefinitionProposal

`draft -> submitted -> accepted|rejected`，`draft|submitted -> withdrawn`。这些都是 Parameter Governance 内部 Proposal aggregate；accepted/rejected 要求 Platform Admin，acceptor 与 submitter 不同；stale base 返回 `proposal-stale`。accept 事务只锁 proposal、追加 publication intent 和 trusted audit，绝不 materialize Catalog。

#### Binding/ProjectValue

Recognize-and-bind 在 captured release 下验证 active Subject、Registration、Definition、exact revision 与 owner 后创建/复用 stable Binding。Semantic cutover CAS `effective_revision_id`；documentation-only head 不改 Binding。Change value 锁 Binding/current head，按 effective revision 验证，追加 immutable ProjectValue、CAS current value 并同事务审计。stale CAS 无任何 partial write。

#### Audit 原子性

成功 domain write 与成功 audit 同事务；deny/refusal audit 使用独立 pool-owned sink 以便在被拒事务回滚后保留；step milestone 只在语义上确为已到达的外部阶段时独立提交。所有敏感 mutation 传播同一 server-owned TrustedInvocationContext，不接受 body/header `actorType`。

#### 锁、CAS 与 lost-response 边界

| Aggregate/operation | 并发控制 | Lost response / retry | 冲突行为 |
| --- | --- | --- | --- |
| Catalog install/switch-back | exclusive transaction-scoped current-pointer advisory lock -> private `catalog_state` row lock/recheck -> expected current pin | 按 release digest/fingerprint 复查 committed state，完整则 no-op | stale lineage、split head 或 unknown projection fail closed |
| Explicit/automatic Registration | idempotency -> shared transaction-local Catalog guard -> `(organization,subject)` key/row -> destination key/row -> deferred constraints；Governance-owned UoW | exact committed fingerprint 在 guard 前返回 stored Registration/Placement/release pin/audit ref；lost response 不重复写 | permission/proof/release/retirement/placement conflict 为 typed failure，无 partial Registration |
| Placement move/rename | Registration row + source/destination taxonomy key locks；ETag CAS | exact same mutation 可复读结果 | cycle/kind/org/stale destination 409，move 与 audit 一起回滚 |
| Review resolution | idempotency -> shared transaction-local Catalog guard -> ReviewItem ETag CAS -> Registration/Placement locks -> deferred constraints；只走 `resolveReviewItem` | exact committed replay 在 guard 前返回同一 Resolution/Registration/Placement/Proposal/release pin/audit ref | stale/already resolved/key reuse 为 `revision-conflict`；release/retirement/placement conflict 时 item 保持 unresolved且无 partial row |
| Proposal transition | proposal revision/ETag row lock + exact base release/revision | 已提交同一 transition 返回 stored outcome | stale base `proposal-stale`；self approval 403；无 publication materialization |
| Observation ingest | immutable source occurrence identity + evidence fingerprint uniqueness | identical occurrence is one evidence record/aggregate increment | changed payload under same source identity is evidence conflict，不覆盖 |
| Auto registration | 与 explicit/review 完全相同的 shared registration writer/锁；proof pin 是 captured release + matcher revision；reserved default only | concurrent explicit/auto/review 收敛为 one exact Registration/Placement 或 typed conflict | zero/multiple/retired/conflicting placement 只 review/refusal；绝不 auto-restore |
| Binding create/cutover | unique `(project,logical_node,definition)` + Binding row lock + expected effective revision | exact recognized association idempotent | stale release/revision、owner mismatch 或 CAS loser 无 partial history |
| ProjectValue append | Binding/current-value row lock + expected current value/effective revision | command idempotency record 返回 exact immutable value | stale CAS 无 value、pointer 或 audit partial write |
| Cutover phase | host operation lock + PG cutover advisory lock + phase CAS + source/plan digests | inspect exact checkpoint；known committed phase 可 resume | unknown outcome 先独立分类，不能证明即 `recovery-required` |
| Verification/report | immutable plan/attempt/report IDs；approval unique by report/purpose/principal role | incomplete attempt 标 interrupted 后新 attempt；complete digest-valid report 复用 | nondeterminism、wrong lineage/purpose 或 duplicate-role approval 阻断 |

### 7. Catalog Release 发布、同步与回放

Bundle 必须包含 release ID/version/predecessor digest、exact manifest-listed YAML + per-file digest、显式稳定 Subject/alias/Definition/Revision IDs、完整 as-of memberships、selector/tombstone provenance、complete Definition snapshots、schema/toolchain provenance 和 aggregate digest。文件枚举顺序不得影响编译结果；unlisted file、missing reference、digest mismatch、重复 identity、key/alias reassignment、非法 lifecycle/tombstone、lineage gap 均在写前失败。

发布与 revision 是不同 clock：任何 bundle 变化产生新 release；只有 persisted Definition content 变化产生新 Revision。documentation-only Revision 更新 Definition head，但不动 Binding/ProjectValue。release-only provenance/alias 变化不制造 Revision。Alias 只是一跳 Subject selector alias，不支持 property-key alias、chain、cycle 或 owner reuse。

Self-hosted 顺序必须是 build/offline validate -> quiesce -> verified Recovery Point -> data plane -> one-shot migration -> one-shot Catalog sync -> independent materialization verification；API/worker/web ordinary startup 只 verify packaged digest 与 approved runtime pin，不迁移、不同步、不 repair。

<a id="pcat-spec-api"></a>

### 8. Canonical API、并发和 legacy ID 过渡

所有 canonical Catalog response 包含 `X-WiseEff-Catalog-Release`。collection envelope 固定为 `items/nextCursor/catalogReleaseId`，item envelope 为 `item`；cursor 绑定 release 与 stable sort + opaque ID。依赖当前 publication 的 write 必须回传 release header；mutable org/proposal 还必须带 `If-Match`/ETag；governance command 还带 `Idempotency-Key`。

#### Canonical route set

- `GET /api/v2/catalog`。
- `GET /api/v2/catalog/subjects`、`/{subjectId}`、`/{subjectId}/definitions`。
- `GET /api/v2/catalog/definitions`、`/{definitionId}`、`/{definitionId}/revisions`、`/{definitionId}/revisions/{revisionId}`、`/{definitionId}/timeline`。
- `GET,POST /api/v2/organizations/{organizationId}/subject-registrations`；detail、`retire`、`restore`、`placement GET/PATCH`。
- observations list/detail；parameter-review-items list/detail/resolve。
- definition-proposals list/create/detail/submit/withdraw/accept/reject。
- exact `GET /api/v2/catalog/legacy-identifiers/{legacyType}/{legacyId}`。
- retained project binding/history/compare/draft paths，但 DTO 只用 canonical IDs。
- `/api/v2/operator/parameter-catalog/*` 仅 deployment Operator，public router 不暴露 raw diagnostics。

九个 Catalog read route 只能通过 typed Kernel snapshot facet；Registration/Placement/usage/history 由 composer 提供稳定 ID selection/high-water fingerprint。Timeline composite cursor 同时 pin Catalog release 与每个授权 history stream high-water mark。

`PlacementIntent` 固定为 explicit `use-default` 或 `choose-parent(parentPlacementId,displayName)`。default 不可由 server fallback。Register exact replay 返回同一 stored result；同 key 不同 fingerprint 返回 `revision-conflict`。already-active 只有 placement intent 完全一致时 idempotent，否则 `placement-conflict`。

#### 稳定 HTTP reason

必须实现并在 OpenAPI/客户端按 `details.reason` 分支：`catalog-not-ready` 503；`release-drift`、`subject-retired`、`definition-retired`、`registration-required`、`placement-conflict`、`invalid-placement-parent`、`observation-ambiguous`、`proposal-stale`、`revision-conflict` 为 409；`subject-not-published`、`definition-not-found`、scope-hidden unknown 为 404；`proposal-self-approval-forbidden`、`forbidden` 为 403；`legacy-id-archived`、`legacy-surface-retired` 为 410；`legacy-id-ambiguous` 为 409；`migration-diagnostics-not-public` 为 public 404。客户端不得解析 human message。

legacy resolver allow-list 仅 `parameter-spec`、`parameter-spec-version`、`project-parameter-binding`、`project-parameter-binding-revision`、`parameter-subject`、`parameter-placement`、`parameter-module`。它只读 typed mapping head，不支持 prefix/reverse/candidates/confidence/raw Archive；authorized mapped target 返回 canonical link，Archive 410，ambiguous/blocker 409，unknown/out-of-scope 404。

canonical launch 时所有 legacy structural mutation 与 overlay/promotion write 立即 410。eligible exact reads 最短保留到 canonical launch 后“至少两个 production releases”与“90 天”两者中更晚者，且所有 deployment class 连续 30 天零使用等 exit gates 通过；响应带 `Deprecation`、`Sunset`、successor `Link`、`Warning` 和 legacy contract header。失败只延长 read-only window，不恢复 writer/dual-read。

### 9. 单一 Parameter definitions 页面

canonical 路由为 `/parameter-admin/specs`，导航中只有一个 Parameter definitions entry；不存在 Effective/Governance peer。URL state 使用 opaque Subject/Definition/Review IDs 与 release anchor，支持 list/detail、timeline 与 same-page Review Queue；legacy bookmarks 通过 exact mapping/redirect/gone/conflict/not-found 处理。

- desktop `1440x900`：typed Subject/Placement navigation、Definition list、detail/history 形成清晰 panes；Review Queue 是同页 peer surface 并显示 count。
- tablet `768x1024` 与 mobile `390x844`：同一 IA 分阶段呈现，不另建简化业务规则；返回、selection 与草稿输入保留。
- detail 展示 formal Subject、current/pinned Revision、safe usage、Registration/Placement、Catalog publication + authorized audit timeline；raw migration row/Archive payload 永不出现。
- state 固定为 ready、unregistered、empty（`no-registrations|no-definitions|no-review-work|no-filter-match`）、loading、error、retired/deprecated、conflict。loading 可以标记上一 release stale，但不得启用 write。
- only Org Admin 可注册/放置/review；Platform Admin proposal review 与 org registration 分离；Agent surface 只读。
- conflict 刷新 release/ETag/placement evidence，保留用户输入并要求重新确认；不得 silent retry。
- 前端 ports 至少拆为 CatalogRead、SubjectGovernance、ReviewQueue、DefinitionProposal、DefinitionTimeline、LegacyLink；项目 topology/workbench port 不再兼任 Catalog governance。
- HTTP/mock adapters 满足相同 state machine；mock 无额外治理能力。#676 仅作为 IA/视觉决策，生产组件、测试和 screenshot 必须在实现分支重新构建与验证。

<a id="pcat-spec-p0-p16"></a>

### 10. P0–P16、Archive 与 rollback

| Phase | 直接可实现的 exit contract |
| --- | --- |
| P0 inventory/plan | read-only 固定 target、migration inventory/checksums、source fingerprints、R0–R10/protected counts、read modes、release lineage、stores 与 plan digest |
| P1 offline validate | candidate build 完成；bundle、toolchain、lineage、old/new schema compatibility、fixture evidence 验证；artifact 变更即新 plan |
| P2 quiesce | proxy stop、queue pause/drain、API/worker/web stop、host+PG locks、writer fences、zero active write tx/leased jobs |
| P3 Recovery Point | 同一 quiesced boundary 捕获 PostgreSQL + S3-compatible object store + durable Redis，校验 identities/checksums/restore tool/max age |
| P4 schema expand | dedicated one-shot、append-only、old-binary-compatible migration；API 不是 runner；M01–M04 通过 |
| P5 Catalog install | Kernel bootstrap/advance，exact release/heads atomic switch，same digest verified no-op |
| P6 classify | full graph R0–R10，classifier version、source checksum、graph/protected refs；R0 或 fingerprint drift 停止 |
| P7 typed mapping | 每个 legacy identity 恰有一 primary disposition/version/head；冲突不覆盖 |
| P8 register/place | 只迁移有强证据的 org/subject，active membership、same-org、kind、exact-one；弱证据 review/block |
| P9 Binding/value/history | 完整 operational + historical graph、exact revision/current pointers、source/config/audit；不得 max/time 推 tip |
| P10 Archive | 每个 Archive outcome 与需重建 source graph 的 row 生成 immutable metadata + encrypted payload ref + checksums |
| P11a initial verification | 隔离与 fences 保持；完整 V01–V17、M/P 与 D01–D09，零 unexplained/unqueryable，11 families 全覆盖 |
| P12 read switch | exact approved pre-activation report CAS legacy -> canonical，并绑定 release/mapping/verifier/comparison digests；无 runtime dual-read fallback |
| P13 R-L0 writer retirement | 永久撤销 role/grant/trigger/function/HTTP/Agent/job/script writer；记录 fingerprint |
| P11b post-retirement rerun | 新 attempt 完整重跑 V01–V17 + D01–D09（含 V13/P02）；生成/批准 post-retirement runtime pin |
| P14a verify-only startup | API 只消费最新 runtime pin；随后 worker/web internal checks；queue/proxy/public 仍隔离 |
| P14b isolated acceptance | exact target API real-PG/HTTP/auth/audit + browser-real；任一 business mutation 永久关闭 pointer rollback |
| P14c public release | 新 report 聚合三份 predecessor report + target/recovery/observability，独立 purpose approvals 后才 queue -> proxy -> public |
| P15 observe/accept | 预先声明时间 + 至少一完整 workload cycle；无 drift/unmapped ID/legacy write/archive/pin/placement error |
| P16 R-L3 cleanup | 独立 cleanup release/purpose；sunset/telemetry/dependency/recovery/retention 全通过后移除批准 asset，保留 protected history |

R0 hard blocker；R1 Archive；R2 map to independently published Subject + Archive；R3 ReviewEvidence；R4 Driver Definition/Revision exact map；R5 NodeType exact map；R6 ReviewEvidence + Archive；R7 Archive + policy-review reason；R8 DefinitionProposal；R9 same-kind immutable history mapping；R10 unresolved Archive，若 protected consumer 不能接受则 P11 blocker。

Rollback 边界：P12 前可 abort/合法 pointer switch-back；P12 后 P13 前需同时切 application read pointer + Catalog heads 且证明 zero writes；P13 后 previous projection 还必须在 writer retired 下可运行；candidate API 内部只读检查前仍需 zero mutation；isolated acceptance 的第一笔业务 mutation、queue delivery 或 public request 后 pointer-only rollback 永久禁止，只能 forward repair 或 incident-approved whole-state restore。Whole-state restore 必须同一 manifest 恢复 PostgreSQL/object/Redis，禁止 partial restore。

#### Upgrade controller 的精确动作合同

- `plan` 在线只读且可重复；任何 artifact/target/Catalog/migration/source/recovery/evidence requirement 变化产生新 plan digest，旧 approval 不可复用。
- `apply` 只接受当前、已批准、输入未漂移的 plan，且没有另一个 live run 持有 host/PG lock。P2 前失败恢复已验证 old stack；P4 后未知 partial state 不能猜测。
- `activate-p12` 只接受 exact approved `pre-activation` report；API/browser 项必须是 `not-yet-executable`。缺 Recovery Point、initial full V/D、fence 或 purpose approval 直接拒绝。
- `retire-p13` 只在 P12 后、所有 service/traffic 仍隔离时执行并固化 writer-retirement fingerprint；temporary pre-switch fence 不能充当 P13 证据。
- `approve-runtime-startup` 只接受 P13 后新 attempt 的完整 V01–V17 + D01–D09；只跑 V13/P02、复用 pre-report 或 corpus 不完整均拒绝。
- `start-candidate` 只让 API 以 verify-only runtime pin 启动；worker/web 仅随后做 internal check。任一 pin/fingerprint drift 使进程退出/不 ready，queue/proxy/public 继续隔离。
- `run-isolated-acceptance` 只在 exact target/runtime pin 下运行；mock-only、pre-P13、stale report、public traffic already open 均拒绝。业务 mutation 立即写 immutable rollback-closure。
- `release-public` 只接受 exact `public-release` aggregate report 和该 purpose 的 distinct approvals；activation/runtime/acceptance approval 不能替代。
- `resume` 只允许同 run、同 digest、known commit outcome 的 idempotent phase。若指针、head、checkpoint、audit 不能独立判定 committed/uncommitted，进入 `recovery-required`。
- `recover-candidate` 只用于记录为 post-migration completion failure、Recovery Point 与 candidate/report pins 仍有效且 proxy/queue 已重新隔离的情形；不得 restore data。
- `rollback --restore-data` 只接受 incident-owner approval、run-bound token 和 exact cross-store manifest；任何 partial store、stale manifest 或 target identity mismatch 拒绝。
- `legacy-read-sunset` 与 `p16-cleanup` 只接受各自 passing report/approval；先前 purpose 永不传递权限。

Append-only journal 至少记录 plan/attempt/report/approval IDs/digests 与 predecessor lineage、artifact/image/config/target/host/Compose/volume/bucket、migration inventories/schema fingerprints、Catalog/compiled/materialization fingerprints、P0/source/classifier/recovery、mapping/head/Archive、P11a/P11b V/D counts/digests、P13 fingerprint、runtime pin generation、API/browser/recovery evidence、public report、queue/proxy state、first mutation/delivery/public timestamps、rollback closure、phase events、isolation results，以及 bounded `failed_phase/failure_service/failure_code/failure_summary` 和唯一 executable `next_action`。

<a id="pcat-spec-verification"></a>

### 11. 六类 verification purpose 与 report chain

| Purpose | required-now | 明确不可用 | 通过并批准后唯一授权 |
| --- | --- | --- | --- |
| pre-activation | exact pins、Catalog/materialization、migration、initial V01–V17、D01–D09、Recovery Point、pre-switch fence | API/HTTP/browser/runtime 为 not-yet-executable | P12 read switch |
| post-retirement-runtime | P13 后完整 V/D 重跑、V13/P02、pointer/fingerprint、writer zero、runtime pin | API/browser acceptance 仍 not-yet-executable | API verify-only，然后 isolated worker/web |
| isolated-candidate-acceptance | exact-target API contract/PG/HTTP/auth/audit、三 viewport browser、internal observability、mutation closure record | public approval 不存在 | 无 traffic act；只作为 public report evidence |
| public-release | exact 三 predecessor reports + current target/recovery/observability/rollback | sunset/P16 尚未可用 | queue、proxy、public traffic |
| legacy-read-sunset | public lineage、2 releases + 90 days、每类 30 天零使用、consumer/reference/recovery/approval | P16 deletion | eligible public legacy reads 410 |
| p16-cleanup | 全 canonical/fresh/populated/API/browser/obs/rollback、own Recovery Point/target restore、zero dependency、retention/legal hold | 无 waiver | 列举且批准的 code/schema/role/grant/trigger/view removal |

### 12. Verification gates

#### V01–V17

| ID | Zero/exact invariant | Stable failure code |
| --- | --- | --- |
| V01 | current `(subject,property)` duplicate = 0 | `PCAT-VRF-V01-DUPLICATE-CURRENT-DEFINITION` |
| V02 | 每 Definition exactly one owned head | `PCAT-VRF-V02-CURRENT-REVISION-CARDINALITY` |
| V03 | cross-owner/org refs = 0 | `PCAT-VRF-V03-OWNER-SCOPE-MISMATCH` |
| V04 | current operational ref 均有 active membership | `PCAT-VRF-V04-SUBJECT-MEMBERSHIP-MISSING` |
| V05 | active/retired Registration exact-one valid Placement | `PCAT-VRF-V05-PLACEMENT-CARDINALITY` |
| V06 | Binding/registration/subject/definition/revision agreement | `PCAT-VRF-V06-BINDING-DEFINITION-MISMATCH` |
| V07 | ProjectValue/binding/revision/source ownership agreement | `PCAT-VRF-V07-PROJECT-VALUE-REVISION-MISMATCH` |
| V08 | protected legacy/external IDs mapped = exact | `PCAT-VRF-V08-PROTECTED-ID-UNMAPPED` |
| V09 | P0 source = blocker + unique primary dispositions | `PCAT-VRF-V09-SOURCE-CONSERVATION` |
| V10 | R6/R8 same-key merge = 0 | `PCAT-VRF-V10-R6-R8-IDENTITY-MERGE` |
| V11 | Archive row/graph/object integrity exact | `PCAT-VRF-V11-ARCHIVE-INTEGRITY` |
| V12 | packaged/compiled/DB/head/cache/readiness exact | `PCAT-VRF-V12-CATALOG-MATERIALIZATION-DRIFT` |
| V13 | reachable legacy writers = 0 | `PCAT-VRF-V13-LEGACY-WRITER-REACHABLE` |
| V14 | Binding/value tips + histories conserved | `PCAT-VRF-V14-BINDING-TIP-CONSERVATION` |
| V15 | audit principal/initiator/trace/map/target continuity | `PCAT-VRF-V15-AUDIT-CONTINUITY` |
| V16 | Organization structural Catalog objects/paths = 0 | `PCAT-VRF-V16-ORGANIZATION-STRUCTURAL-CATALOG` |
| V17 | fresh/populated exact mode result | `PCAT-VRF-V17-MODE-RESULT-MISMATCH` |

辅助数据库 gate 固定为 M01 package inventory drift、M02 applied file missing/checksum、M03 ordered suffix/append-only alias ledger、M04 one-shot exact result；P01 证明 production roles 不能写 immutable Catalog，P02 证明 legacy definer/trigger/role writer 不可达。

| ID | Stable failure code |
| --- | --- |
| M01 | `PCAT-MIG-PACKAGE-INVENTORY-DRIFT` |
| M02 | `PCAT-MIG-APPLIED-FILE-MISSING` |
| M03 | `PCAT-MIG-HISTORICAL-ALIAS-INVALID` |
| M04 | `PCAT-SCHEMA-MIGRATION-RESULT-MISMATCH` |
| P01 | `PCAT-PRIV-CATALOG-IMMUTABILITY-BYPASS` |
| P02 | `PCAT-PRIV-LEGACY-WRITER-BYPASS` |

#### D01–D09

D01 Definitions semantics；D02 Subject identity；D03 Registration/Placement；D04 Binding/history；D05 ProjectValue/revision pin；D06 Review/Proposal/Observation disposition；D07 debug/reload/knowledge/import/export protected refs；D08 source/writeback provenance；D09 legacy/operator HTTP outcome。每 case 只能是 `exact-equivalent`、`declared-expected-difference`、`unexplained-difference`、`unqueryable/protected-reference-missing`。通过要求后两类为零，expected difference 恰有 R class + mapping head + typed target/Archive + rule + plan pin，11 consumer families 和所有 protected refs 全覆盖。

| ID | Stable failure code |
| --- | --- |
| D01 | `PCAT-CMP-D01-DEFINITION-SEMANTICS` |
| D02 | `PCAT-CMP-D02-SUBJECT-IDENTITY` |
| D03 | `PCAT-CMP-D03-REGISTRATION-PLACEMENT` |
| D04 | `PCAT-CMP-D04-BINDING-HISTORY` |
| D05 | `PCAT-CMP-D05-PROJECT-VALUE-PIN` |
| D06 | `PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION` |
| D07 | `PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE` |
| D08 | `PCAT-CMP-D08-SOURCE-WRITEBACK` |
| D09 | `PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME` |

Corpus/threshold integrity 另用 `PCAT-CMP-CORPUS-COVERAGE`、`PCAT-CMP-UNEXPLAINED-DIFFERENCE`、`PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE`、`PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE`、`PCAT-CMP-REPORT-INTEGRITY` 阻断。

#### API、浏览器与 self-hosted

- PCAT-API-01–12 全部 blocking：readiness；Subject/Definition reads；exact revisions/timeline；Registration/Placement atomicity；Review；Proposal；typed legacy；legacy 410；role spoof negatives；release/ETag/idempotency；9 routes -> Kernel；project canonical IDs。
- PCAT-UI-01–15 全部 blocking：单页、URL/release anchor、detail、same-page queue、timeline、ready/unregistered/empty/loading/error/retired/conflict、legacy links、Agent read-only、mock parity、三 viewport、真实 interactions。
- Browser bundle 每个相关 state/viewport 都有 snapshot + screenshot、console error、page/request failure 与 WiseEff critical-response check、network summary、interaction record、browser/runtime version、source/API/frontend image/OpenAPI/report/release/target digests和 redaction result。
- Fresh path 证明 zero legacy inventory/maps/Archive/registrations（除显式 seed）且 D01–D09 运行零语料谓词，不是 skip。Populated path 用完整非抽样 corpus，P0 counts 到 V17 完全守恒。
- target-host 必须对 exact artifact/host/data profile 执行 cross-store restore、one-shot ordering、queue/proxy isolation、target verifier/browser/observability；local 或 Hosted 不替代。

### 13. Observability、failure codes、audit 与 retention

Stable family 固定为 `PCAT-ART|MIG|SCHEMA|SYNC|CLASS|MAP|REG|BIND|ARCH|VRF|CMP|API|AUTH|UI|UPG|WRITER|RP|RESTORE|RET-*`。human summary 可改，automation 只依赖 family/code + gate ID。

Metrics 至少包括 verification attempts/duration、release verified、comparison cases、protected refs、legacy writers/reads、Recovery Point age/validity、restore rehearsal、retirement condition。Label 只允许 bounded enum/registered deployment ID；严禁 Definition/Binding/legacy/property/value/DTS/user/org/project/report digest/object key/URL/free text。

Structured logs 含 trace/request、target class、release/run/attempt/report、gate、phase、stable code/result/duration/evidence ref 和 redacted summary。Audit 覆盖 verification prepare/run/refusal/report/approval、P12、P13、runtime pin、isolated acceptance/mutation、public authorization、rollback closure、restore、sunset、P16；保留 authenticated principal 与 trusted initiator。

Retention 取 legal/audit hold、最长 protected/business/Archive/mapping retention、cleanup 后一年、最后支持 restore/old-binary window 后一年、legacy public window 结束的最晚者。failed/interrupted attempt 至少一年，incident/legal hold 更长。Report 不复制 raw dump、Archive payload、parameter value、DTS、credential 或 person data。

### 14. Legacy retirement 与可删除条件

R-L0=P13 writer retirement；R-L1=launch 后 read-only observation；R-L2=purpose-approved public read sunset；R-L3=P16 cleanup release。Catalog-only escape checks、reconcile code、legacy writers/roles/triggers/tables、Effective/Governance projection、migration aliases 各自只在 #679 asset-specific gate 到达时删除。

P16 必须同时满足：至少两次 production release、至少 90 天、每种 supported deployment class 连续 30 天 immutable rollup 零 legacy read、全部 first-party/external/import/export/deep-link disposition、unresolved protected/ambiguous operational mappings 为零、mapping/Archive target restore evidence、recovery 不依赖 legacy schema、HTTP/Agent/jobs/scripts/functions/triggers/roles/grants writer 零、fresh/populated/API/browser/obs/rollback 通过、cleanup 自有 Recovery Point + real target restore、old binary 行为明确、distinct Operator/Platform owner approvals、retention/legal hold 完成。

P16 永不因“非 current”删除 Audit、Archive、mapping versions/heads、Catalog releases、Definition revisions、Bindings、ProjectValues、Proposals、Observations 或 ReviewEvidence。

### 15. Migration 编号与历史不可变策略

- 当前基线最高 prefix 是 `0136`；本规格不抢占 `0137` 或任何具体编号。
- 每个实际 migration slice 开工与 rebase 后重新 fetch `origin/main`，枚举 packaged filenames 与 applied ledger，取当时下一组连续、唯一 prefix；并行 collision 只对尚未应用的本分支文件做 content-preserving renumber。
- 已在任何受支持环境 applied 的 migration 文件名与 bytes 永不修改、删除或伪造。需要修复时新增 append-only migration。
- 历史 rename/alias 只有经显式 append-only alias ledger 才合法；ambiguous alias 失败。不得为缺失 applied file“补一个同名不同 bytes”。
- release manifest 记录 ordered filename/checksum inventory、old/new compatibility 和 target ledger/schema fingerprint。M01–M04 在 migration 前后运行；API startup 证明没有执行 migration。
- 每个 migration 强制 fresh + upgrade-from-supported-floor + populated rehearsal，约束测试必须 `SET CONSTRAINTS ALL IMMEDIATE` 或 COMMIT；并发用 independent sessions。
- `docs/generated/db-schema.md` 由 exact migration tree 重新生成，`npm run docs:check` 必须在计划完成前用真实 pgvector PostgreSQL 路径验证，而不是把 extension skip 当完整 schema evidence。

<a id="pcat-spec-work-packages"></a>

### 16. Ticket-ready work packages（仍不是 Issues）

`S0`–`S14` 只是 workstream 编号，**不等于 ticket**。下表每一行才是一个可交给单一开发智能体、独立分支和独立 merge decision 的 future ticket candidate。本规格不创建这些 ticket；父会话仍需确认 seam、行粒度与阻塞边。

证据缩写：`D`=文档/静态；`L`=local pure/fake；`PG`=真实 local PostgreSQL；`B`=browser-real；`H`=Hosted/CI；`T`=真实 target-host；`R`=release/production purpose report。某行写“无”即不得由别的证据层推导。

编号/ID ownership 的默认值适用于每一行：如果某 node 没有显式写出 migration、ADR、PCAT-API、PCAT-UI、operation、V/M/P/D 或 generated artifact，则它对该类的 ownership 明确为 **none**，不是 ticket metadata 漏写。只有 S2-SCH/S2-RBAC/S10-PER 可分配各自限定的 migration；ADR 号由 G0/父会话拥有；S8-CON 拥有 API registry，route nodes 只拥有列出的 assertion ranges。本 Spec/G0 拥有初始 non-blocking `PCAT-UI-01..15` 与十五条 `future` operation registry entries；S9-BRW 后续唯一拥有把它们切换为 blocking/automated 并重新生成英文 operation matrix 的变更，S9-CAT/S9-GOV/S9-BRW 只拥有各自列出的 acceptance marker/file。

#### S0–S3：合同、bundle、schema 与 Catalog Kernel

| Node | Objective / owning module and public seam | Allowed paths / artifact and ID owner | Inputs -> outputs | Red -> Green | Evidence boundary | Dependencies | Merge gate / parallel conflict surface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S0-ID | 固定 branded nominal IDs、closed enums、failure/gate/purpose/result types；owner=`parameter-catalog-contract` shared package | `server/modules/parameter-catalog-contract/**`；owns ID/enum registry；migration/ADR/API/UI IDs=none | #669–#679 -> compile-time registry | Red primitive-string/cross-kind assignment；Green typecheck + serialization golden | D+L；PG/B/H/T/R 无 | G0(CD) | registry snapshot + no duplicate brand；其他 ticket 禁止并改同一 registry |
| S0-RAT | 建立 legacy writer/raw-read/forbidden-import/route/static ratchets | `scripts/check-parameter-catalog-*.ts`, matching tests, allowlist artifact；owns ratchet manifests | S0-ID + inventory -> deterministic violation list | Red current violations enumerated；Green only named decreasing allowlist | D+L；其余无 | G0(CD), S0-ID(CD) | exact violation golden；与 consumer ticket 只通过 allowlist entry ownership 协调 |
| S0-FIX | 把 #671 checksum-locked populated fixture 接入统一 loader 与 zero-mode fixture contract | `scripts/wayfinder/**`, `docs/references/parameter-catalog-rehearsal-fixture.md`, `docs/zh-CN/references/parameter-catalog-rehearsal-fixture.md`；owns shared fixture/version | #671 artifact -> reusable fresh/populated loader contract | Red checksum/R6-R8 twin/dirty DB failure；Green checked-empty load + cleanup marker | D+L；PG execution 等 S2-PGH；H repeat later；T/R 无 | G0(CD), S0-ID(CF) | fixture digest frozen；S2/S7/S10 只消费不编辑 |
| S1-BND | 定义 immutable Catalog Release bundle schema、manifest、stable-ID/release lineage | `schemas/dts/catalog-release/**`, `docs/generated/parameter-catalog-bundle.schema.json`；owns bundle schema version | ADR-0040/41 + S0-ID -> canonical bundle JSON schema | Red missing/unlisted/reassigned/cycle fixtures；Green schema rejects before compiler | D+L；其余无 | G0(CD), S0-ID(CD) | schema/digest golden freeze；唯一 generated bundle-schema owner |
| S1-CMP | 实现 deterministic offline compiler/validator，无 DB | `server/modules/catalog-kernel/compiler/**`, compiler tests；owns compiled-model schema/toolchain digest | S1-BND -> byte-identical `CompiledCatalogRelease` | Red reorder/duplicate/lineage gaps；Green deterministic compile + exact violations | L；H repeatability later；PG/B/T/R 无 | S1-BND(CD), S0-ID(CD) | compiler contract frozen；不得编辑 PG schema或 runtime reader |
| S2-SCH | 创建 canonical PostgreSQL schema、keys、deferrable constraints/triggers 与 migration-owned current-release guard/lock protocol | 独占本 ticket 分配的 `server/migrations/<next>_canonical_parameter_catalog_schema.sql` 与 schema contract tests；owns physical names、guard signature/failures、shared/exclusive pointer lock | ADR-0040/42 + S0-ID -> fresh/upgrade schema + execute-only guard contract | Red COMMIT constraint、stale pin、retirement、pointer race、rollback；Green typed guard/serialization + zero residue | PG independent sessions required；D ledger；H later；B/T/R 无 | G0(CD), S0-ID(CF) | guard signature/SQLSTATE/lock protocol 在 S3-INS/S4-REG/S5-RSL 前 freeze；同阶段无人编辑该 migration |
| S2-RBAC | 实现 owner/roles/grants/function reachability negative matrix | 独占后续 `server/migrations/<next>_canonical_parameter_catalog_roles.sql`, role tests；owns role/grant manifest | S2-SCH guard/schema contract -> least privilege | Red Governance Catalog SELECT/DML 或 broad function access；Green guard-only EXECUTE + P01/P02 SQLSTATE matrix | PG required；H repeat later；B/T/R 无 | S2-SCH(CF) | revoke PUBLIC；只向 `parameter_governance_writer_role` grant guard EXECUTE；不与 S2-SCH 共用 migration file |
| S2-PGH | 提供 real-PG contract harness、independent sessions、commit/failure injection | `server/testing/parameterCatalog/**`, test scripts；owns PG harness config，不拥有 schema | S0-FIX + S2-SCH -> disposable checked-empty DB harness | Red fake/PGLite accepted or shared-session race；Green real server + independent pools | PG required；H adapter later；B/T/R 无 | S0-FIX(CD), S2-SCH(CF) | pgvector present and exact server version recorded；不得编辑 migration/generated schema |
| S3-RUN | 实现 Kernel public types、current/pinned synchronous read facet 与 exact snapshot | `server/modules/catalog-kernel/interface.ts`, `runtime/**`, tests；owns Kernel public types | S1-CMP contract + S2-SCH contract -> six-operation interface/read snapshots | Red mixed release/null/post-page filter；Green captured typed results + cursor pins | L+PG；B 经 API later；H/T/R 无 | S1-CMP(CF), S2-SCH(CF), S2-PGH(CD) | public types frozen；唯一 interface owner，其他 Kernel tickets只实现 |
| S3-INS | 实现 bootstrap/advance/switch-back Kernel-owned transaction 与 exclusive current-pointer lock | `server/modules/catalog-kernel/install/**`, tests；owns install adapter/exclusive lock order，不暴露 internal store | S1-CMP + S2-SCH guard/lock + S2-RBAC + S3-RUN -> atomic materialization | Red failure/lost response/concurrent install + pointer advance vs registration/retirement/rollback；Green one exclusive serialization + all-or-none/no-op/conflict | PG independent sessions required；H repeat later；B/T/R 无 | S1-CMP(CD), S2-SCH(CF/CD), S2-RBAC(CD), S3-RUN(CF) | lock protocol freeze 后才做 S4-REG/S5-RSL integration；不编辑 public interface |
| S3-VFY | 实现 independent verifier、cache rebuild 和 deterministic failure injection | `server/modules/catalog-kernel/verification/**`, `cache/**`, tests；owns materialization fingerprint/cache format | S3-RUN + S3-INS output -> verifier snapshot/cache | Red stale/poisoned/partial cache and writer credential；Green read-only recompute + exact drift | L+PG；H later；T/R 无 | S3-RUN(CD), S3-INS(CD), S2-RBAC(CD) | verifier credential negative + cache golden；与 S10 仅交换 read-only evidence schema |

#### S4–S6：Parameter Governance 内部 packages 与 Binding/ProjectValue

| Node | Objective / owning module and public seam | Allowed paths / artifact and ID owner | Inputs -> outputs | Red -> Green | Evidence boundary | Dependencies | Merge gate / parallel conflict surface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S4-REG | Parameter Governance 内部 Registration/Placement：explicit/auto/lifecycle/move，统一走 transaction-local guard | `server/modules/parameter-governance/registration/**`；owns private repos、guard adapter/failure mapping、idempotency 后 shared lock order；no API/UI IDs | captured Kernel pin + trusted context + PlacementIntent/proof -> 不读 Catalog row 的 stable result | Red direct Catalog query、double placement、stale/retired pin、pointer race/rollback、auto restore、lost response；Green guard-only serialization + exact replay | L+PG independent sessions；B later；H repeat；T/R 无 | S2-SCH(CF/CD), S2-RBAC(CD), S2-PGH(CD), S3-RUN(CF), S3-INS(CF/ID) | guard freeze 后才与 S4-EVD 并行；不暴露 repo/UoW |
| S4-EVD | Parameter Governance 内部 immutable Observation/ReviewEvidence ingest | `server/modules/parameter-governance/evidence/**`；owns occurrence/evidence fingerprints | captured matcher outcome/source provenance -> immutable evidence | Red weak match/overwrite/same-key R6-R8 merge；Green immutable dedupe/conflict | L+PG；其余 later/无 | S3-RUN(CF), S2-SCH(CD) | fingerprint golden；不创建 Registration/Definition/Binding；与 S4-REG 可并行 |
| S4-REV | Parameter Governance Review Queue grouping/query/state machine，不含 resolution transaction | `server/modules/parameter-governance/review/**` excluding coordinator；owns ReviewItem ETag/query contract | S4-EVD -> grouped open/read model | Red duplicate group/stale candidate/raw payload leak；Green exact grouping/authorized query | L+PG；B later；H repeat；T/R 无 | S4-EVD(CD), S3-RUN(CF) | ReviewItem interface freeze；不写 Resolution/Registration |
| S5-RSL | 实现唯一 `resolveReviewItem` coordinator，通过 S4-REG 私有 guarded writer 原子完成 review-registration | `server/modules/parameter-governance/resolveReviewItem/**`；owns command/result/failure/UoW；不拥有 Catalog adapter/query | S4-REG + S4-REV + captured release -> ReviewResolutionResult | Red HTTP multiwriter、direct Catalog query、ETag/key/pointer race、retirement、rollback、lost response、逐步失败；Green one guarded commit + durable refusal/exact replay | PG independent sessions required；B via S9；H repeat；T/R 无 | S4-REG(CD), S4-REV(CD), S2-SCH(CF), S2-RBAC(CD), S3-RUN(CF), S3-INS(ID) | full matrix + no public tx/repo imports/second guard adapter；S4/S5 workstream不是独立深模块 |
| S5-PRP | Parameter Governance Proposal revisions/workflow/publication intent | `server/modules/parameter-governance/proposals/**`；owns proposal command/results | captured release/revision + trusted roles -> proposal/intention | Red self-accept/stale/materialize Catalog；Green distinct reviewer + intent-only atomic audit | L+PG；B later；H repeat；T/R 无 | S3-RUN(CF), S2-SCH(CD) | no Catalog grant/write proof；与 S5-RSL 可并行，只有 shared interface freeze 协调 |
| S6-BND | Binding stable identity 与 effective DefinitionRevision semantic cutover | `server/modules/parameter-bindings/binding/**`及明确迁移 adapter；owns Binding public types | Kernel + active Registration contract -> stable Binding/CAS | Red module/latest-head identity/cross-owner race；Green composite agreement + stable ID | PG required；B via consumers；H later；T/R 无 | S3-RUN(CD), S4-REG(CF), S2-SCH(CD) | Registration contract必须先 freeze；因此不能与 S4-REG 全程并行 |
| S6-VAL | immutable ProjectValue、explicit current tip、complete history | `server/modules/parameter-bindings/values/**`, history tests；owns value/history contract | S6-BND + exact revision/source -> immutable value/current pointer | Red max-time tip/update/history loss/CAS race；Green append+CAS+audit all-or-none | PG required；其余 later | S6-BND(CD) | current/effective pointer conservation gate；不编辑 consumer adapters |
| S6-WFA | protected workflow adapter contract for binding/history/reference reads；不迁移 11 consumers | `server/modules/parameter-bindings/adapters/**`, contract tests；owns internal canonical adapter DTO | S6-BND/S6-VAL -> protected-reference adapter | Red legacy `parameterSpecId` fallback；Green canonical ID/pin or typed block | L+PG；B/H/T/R by consumers | S6-BND(CD), S6-VAL(CD) | adapter contract freeze；S12 families各自拥有调用点，不能修改此 core |

#### S7–S11：Cutover、API/UI、Verification 与 upgrade

| Node | Objective / owning module and public seam | Allowed paths / artifact and ID owner | Inputs -> outputs | Red -> Green | Evidence boundary | Dependencies | Merge gate / parallel conflict surface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S7-CLS | Catalog Cutover 私有 R0–R10 full-graph classifier | `server/modules/catalog-cutover/classifier/**`; owns classifier version/rule IDs | P0 source graph + S0 fixture -> exactly one primary R class | Red R0 archive-as-success/R6-R8 merge/sample；Green full conservation/block | L+PG populated；H repeat；T later；B/R 无 | S0-FIX(CD), S2-PGH(CD), S3-RUN(CF) | classifier golden/digest；不写 mapping/archive |
| S7-MAP | typed legacy identities、append-only mapping versions/heads/CAS | `server/modules/catalog-cutover/mapping/**`; owns mapping schema version | S7-CLS results -> one typed head per identity | Red reclassification/overwrite/ambiguous head；Green append/no-op/conflict | PG required；T later；其余无 | S7-CLS(CD), S2-SCH(CD) | mapping checksum/conservation；不编辑 Archive adapter |
| S7-ARC | immutable Archive metadata + S3-compatible encrypted object adapter | `server/modules/catalog-cutover/archive/**`; owns Archive manifest/object schema | typed archive outcomes/source graphs -> metadata+object checksums | Red public enumeration/partial object/credential leak；Green atomic reference/integrity/restore read | L+PG + local object store；T required later；H repeat；B/R 无 | S7-CLS(CD), S2-SCH(CD) | object/DB checksum + authz gate；与 S7-MAP 可并行 after classifier |
| S7-ORC | 实现 `plan/execute/inspect/recover` 与 P0–P10、rehearsal/phase rollback containment | `server/modules/catalog-cutover/**` excluding classifier/mapping/archive；`scripts/wayfinder/**` orchestrator tests；owns cutover plan/run schema | S3-INS/S4-REG/S4-EVD/S4-REV/S5-RSL/S5-PRP/S6-BND/S6-VAL/S6-WFA/S7-CLS/S7-MAP/S7-ARC -> P0-P10 checkpoints | Red rerun duplicates/unknown outcome/ad-hoc SQL/rollback drift；Green same-plan resume + byte-equal containment | PG populated required；H repeat；T integration later；B/R 无 | S3-INS(CD), S4-REG(CF), S4-EVD(CF), S4-REV(CF), S5-RSL(CF), S5-PRP(CF), S6-BND(CF), S6-VAL(CF), S6-WFA(CF), S7-CLS(CD), S7-MAP(CD), S7-ARC(CD) | P0-P10 complete + #671 dump equality；P12-15不在此 ticket执行 |
| S8-CON | freeze OpenAPI、route manifest、DTO/error registry、clients | `server/modules/contracts/**`, `docs/generated/openapi.json`, client contract source；owns route manifest/error registry and PCAT-API-01..12 registry | #677 + frozen S3-RUN/S4-REG/S4-REV/S5-RSL/S5-PRP/S6-WFA/S7-MAP/S7-ARC seams -> frozen wire contract | Red missing route/reason/client branch；Green generated parity and stable schemas | D+L；running HTTP由 route tickets；B/H/T/R later | S3-RUN(CF), S4-REG(CF), S4-REV(CF), S5-RSL(CF), S5-PRP(CF), S6-WFA(CF), S7-MAP(CF), S7-ARC(CF) | single generated OpenAPI owner；在 S8-READ/S8-GOV/S8-LEG 与 S9-PRT 前 freeze |
| S8-READ | Catalog read route family，九条 route 全闭合到 Kernel facet | `server/modules/parameter-catalog-api/read/**`, route tests；owns PCAT-API-01..03 read assertions | S3-RUN + S8-CON -> HTTP DTO/envelopes/release cursor | Red raw repo/post-filter/scope leak；Green exact nine-route closure | L+PG+running HTTP；B later；H repeat；T/R 无 | S3-RUN(CD), S4-REG(CF), S6-WFA(CF), S8-CON(CF) | OpenAPI/route parity + release header；不编辑 generated OpenAPI |
| S8-GOV | Governance route family，handlers 只调用 Parameter Governance commands | `server/modules/parameter-catalog-api/governance/**`, tests；owns PCAT-API-04..07 assertions | S4-REG/S4-REV/S5-RSL/S5-PRP + S8-CON -> ETag/idempotent HTTP | Red transaction handle/multiwriter/role spoof/partial write；Green typed one-command mapping | PG+HTTP+audit required；B later；H repeat；T/R 无 | S4-REG(CD), S4-REV(CD), S5-RSL(CD), S5-PRP(CD), S8-CON(CF) | route auth/error/concurrency gate；禁止 imports private repos/UoW |
| S8-LEG | exact legacy resolver/read adapter/410 transition | `server/modules/parameter-catalog-api/legacy/**`, tests；owns PCAT-API-08..10 assertions | S7-MAP/S7-ARC + S8-CON -> mapped/410/409/404 | Red property inference/reverse search/raw Archive/legacy write；Green allowlist exact outcomes | PG+HTTP required；B deep link later；H repeat；T/R 无 | S7-MAP(CD), S7-ARC(CD), S8-CON(CF) | legacy matrix + headers；不 reclassify，不拥有 P12-15 |
| S9-PRT | frontend application ports、domain state、URL/release/ETag/idempotency model | `src/application/ports/ParameterCatalog*.ts`, `src/application/parameter-catalog/**`；owns frontend ports/state，只消费已冻结 operation IDs | S8-CON OpenAPI freeze -> port commands/results/states | Red legacy Effective/Governance/mock extra power；Green HTTP/mock type/state parity | L component/port；B later；PG/API producer later；H/T/R 无 | S8-CON(CF) | port/state freeze；不得编辑 registry/page/acceptance spec |
| S9-CAT | 单页 Catalog list/detail/timeline 与 read states | `src/features/parameter-catalog/**`, page routing slice, `e2e/acceptance/parameter-catalog.acceptance.spec.ts`; owns PCAT-UI-01/02/03/05/06/08/09/14 markers | S9-PRT + running S8-READ -> one-page read UX | Red mixed release/peer view/hidden state/overflow；Green exact route/state/3 viewport | L+B against real API；PG via API；H/T/R later | S9-PRT(CD), S8-READ(ID) | component + browser markers；不编辑 Governance spec/registry |
| S9-GOV | Review/Registration/Placement/Proposal interactions | `src/features/parameter-catalog-governance/**`, `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts`; owns PCAT-UI-04/07/15 markers | S9-PRT + running S8-GOV -> reconfirming governance UX | Red silent retry/Agent write/partial response/proposal materialize；Green exact role+ETag+idempotency interactions | PG+HTTP+B+audit required；H/T/R later | S9-PRT(CD), S8-GOV(ID) | real interactions + audit IDs；不编辑 read/negative spec |
| S9-BRW | responsive/deep-link/negative evidence bundle 与 coverage registry transition | `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts`, `e2e/acceptance/requirements.ts`, `e2e/acceptance/operationMatrix.ts`, 四份 EN/ZH coverage docs；owns PCAT-UI-10..13 markers 与全部十五条 `required=false` -> `true`、`future` -> `automated` transition | S9-CAT + S9-GOV + S8-LEG -> blocking browser suite/evidence schema | Red conflict input lost/deep-link inference/mock divergence/console-network fail；Green all 15 IDs + exact existing spec references + screenshots | B required 3 viewport；PG/API/audit evidence refs；H repeat；T final；R 无 | S9-CAT(ID), S9-GOV(ID), S8-READ(ID), S8-GOV(ID), S8-LEG(ID) | `acceptance:browser/evidence/coverage/operations`；唯一 registry/generated-English-matrix transition owner |
| S10-PER | Release Verification persistence/core、gate registry、purpose applicability | `server/modules/release-verification/core/**`, migrations allocated only to this node if needed；owns Verification gate registry/report schema base 与包含 `readReport` port 的五操作 public types | S0-ID + S2-SCH schema freeze -> plans/attempts/gate results and frozen evidence/report ports | Red waiver/missing gate/mutable attempt；Green closed applicability + append-only | L+PG；H later；B/T/R no | S0-ID(CD), S2-SCH(CF) | registry/schema/public-port freeze；可与 S3-RUN/S4-EVD/S11-RP 提前并行 |
| S10-VMP | V01–V17、M01–M04、P01/P02 real-SQL adapters | `server/modules/release-verification/gates/postgres/**`; owns V/M/P SQL/gate implementation | S2-RBAC/S3-VFY/S7-ORC schema/read outputs -> typed results | Red false zero/skip/privilege bypass；Green exact counts+SQLSTATE | PG required fresh+populated；H repeat；T final；B/R no | S10-PER(CF), S2-RBAC(CD), S3-VFY(CD), S7-ORC(ID) | all gates deterministic；producer完成前 adapter不能声称通过 |
| S10-DCP | D01–D09 complete corpus/comparator/report digest | `server/modules/release-verification/comparison/**`; owns D corpus/result schema | #669 11 families + S7-ORC + consumer adapters -> comparison report | Red sampled/missing family/free-text expected diff；Green zero unexplained/unqueryable | PG populated required；H repeat；T final；B only D09 input；R later | S10-PER(CF), S7-ORC(ID), S12-CGH(ID), S12-TOP(ID), S12-PRJ(ID), S12-FIL(ID), S12-AGT(ID), S12-LOG(ID), S12-DBG(ID), S12-DTS(ID), S12-KNW(ID), S12-MOD(ID), S12-OPS(ID) | corpus coverage checksum + 11 families；可先实现 core，最终等待 producers |
| S10-API | API evidence adapter for PCAT-API-01..12 | `server/modules/release-verification/evidence/api/**`, runner tests；owns API evidence schema adapter | running S8-READ/S8-GOV/S8-LEG -> immutable HTTP/PG/auth/audit refs | Red mock/stale pin/missing request ID；Green exact candidate evidence bundle | PG+HTTP required；H repeat；T final；B/R no | S10-PER(CF), S8-CON(CD), S8-READ(ID), S8-GOV(ID), S8-LEG(ID) | all 12 IDs same target pin；不启动/改变 runtime |
| S10-UI | browser evidence adapter for PCAT-UI-01..15 | `server/modules/release-verification/evidence/browser/**`, evidence parser tests；owns browser bundle adapter | S9-BRW outputs -> immutable sanitized evidence refs | Red screenshot-only/pre-P13/stale report/redaction fail；Green full operation/network/runtime pins | B required；H repeat；T final；PG/API refs；R later | S10-PER(CF), S9-BRW(ID) | 15 IDs/3 viewports/diagnostics complete；不执行 UI actions itself |
| S10-RPT | report assembly/lineage、distinct approvals、runtime-pin projection、retention | `server/modules/release-verification/report/**`; owns report/approval/runtime-pin persistence and implementation | S10-PER + S10-VMP/S10-DCP/S10-API/S10-UI -> purpose report/pin 与 `readReport` implementation | Red wrong purpose/self approval/pre-report pin/nondeterminism；Green exact lineage/no waiver | L+PG；H repeat；T/R integration later；B refs only | S10-PER(CD), S10-VMP(CD), S10-DCP(CD), S10-API(CD), S10-UI(CD) | 等全部 producer，且不修改 S10-PER public port |
| S11-UPG | upgrade controller state machine/journal core，只调用 Cutover/Verification | `ops/self-hosted/scripts/upgrade-lib.sh`, future controller modules/tests；owns journal/state-machine schema | S7-ORC + S10-PER contracts -> legal-action controller | Red API migrate/gate selection/unknown commit guess；Green guarded idempotent actions | L；PG via apply ticket；H repeat；T/R later | S7-ORC(CF), S10-PER(CF) | journal golden/no direct DB business writer；可与 S11-RP/S10-PER 尽量并行 |
| S11-RP | Recovery Point capture/verify/token-gated whole-state restore adapter | `scripts/run-restore-drill.ts`, `ops/self-hosted/storage/**`, RP tests；owns recovery manifest schema | quiesced target identity -> PG/object/Redis manifest and restore result | Red pre-quiesce/partial/stale/wrong target restore；Green same-boundary checksums | local cross-store + PG；H repeat；T required final；B/R no | G0(CD), S10-PER(CF) | destructive tests only disposable targets；与 S11-UPG 并行 |
| S11-APL | fresh/populated one-shot apply integration through controller | `ops/self-hosted/scripts/upgrade.sh` integration tests, self-host fixtures；owns apply-mode acceptance | S11-UPG + S11-RP + S7-ORC -> P0-P11 checkpoints | Red API startup migration/duplicate apply/mode ambiguity；Green fresh zero-mode + populated full mode | PG real required；H repeat；T final；B/R no | S11-UPG(CD), S11-RP(CD), S7-ORC(CD), S10-VMP(ID) | same controller/mode exact result；不拥有 P12-15 release action |
| S11-REC | resume/recovery-required/failure-after-each-phase matrix | upgrade controller recovery paths/tests；owns failure/next_action mapping | S11-UPG/RP/APL -> deterministic resume/restore/forward result | Red unknown commit auto-resume/partial restore；Green one legal next action | L+PG cross-store；H repeat；T final；B/R no | S11-UPG(CD), S11-RP(CD), S11-APL(CD) | failure matrix exhaustive + journal lineage；不执行 production incident restore |

#### S12：11 个 consumer-family adapter tickets

每个 S12 node **只拥有本 family 的 legacy -> canonical 调用点与 acceptance**；均不得拥有 Cutover phase、P12/P13/P14/P15、Verification report、upgrade controller、shared OpenAPI、shared migration 或 generated schema。

| Node / family | Objective / allowed paths | Inputs -> outputs and ID ownership | Red -> Green | Evidence boundary | Dependencies | Merge gate / conflict surface |
| --- | --- | --- | --- | --- | --- | --- |
| S12-CGH Catalog/governance HTTP | 迁移/删除 `server/modules/parameter-specs/**` 与 `src/infrastructure/http/parameterAdminClient.ts` 的旧 consumer/wiring，只调用 S8 canonical seams | S8-READ/S8-GOV/S8-LEG -> no Effective/Governance/raw writer；owns family D01/D03/D06/D09 corpus cases；no P IDs | Red direct legacy reads/writes；Green exact adapter/410 | PG+HTTP；H repeat；B由S9-BRW；T/R later | S8-READ(CD), S8-GOV(CD), S8-LEG(CD), S7-ORC(CF) | route census zero；与 S8 通过 frozen S8-CON manifest避免同文件并改 |
| S12-TOP Parameter topology HTTP | `server/modules/parameter-topology/**`；`src/application/ports/ParameterTopologyRepository.ts`；`src/infrastructure/http/parameterTopologyClient.ts` | S4-EVD/S6-WFA -> canonical subjects/evidence/bindings；owns D02/D03/D04/D06 cases | Red provisional spec/module identity；Green observe/review/bind or typed block | PG+HTTP；H/T later；B existing topology acceptance | S4-EVD(CD), S6-WFA(CD), S8-CON(CF) | no catalog writer/raw table；shared DTO frozen |
| S12-PRJ Project parameter workbench | `server/modules/parameters/**`；`server/modules/parameter-drafts/**`；`src/application/ports/ParameterRepository.ts`；`src/infrastructure/http/parameterClient.ts`；`src/infrastructure/http/parameterDtos.ts` | S6-WFA -> binding IDs/revision/value tips；owns D04/D05 workflow cases | Red `parameterSpecId`/latest tip；Green stable IDs/history | PG+HTTP+B existing workflows；H/T later | S6-WFA(CD), S8-CON(CF) | full drafts/review regression；不改 S6-WFA core |
| S12-FIL File sync/writeback | `server/modules/parameter-files/**`；`src/application/ports/ParameterFileRepository.ts`；`src/infrastructure/http/parameterFileClient.ts` | S6-WFA protected adapter + source locator -> canonical writeback；owns D07/D08 cases | Red property-only fallback；Green exact binding/revision/source or block | PG+HTTP+B existing file suite；H/T later | S6-WFA(CD) | writeback/audit/provenance gate；与 S12-PRJ 只共享 frozen port |
| S12-AGT Agent tools | `server/modules/agent/**` parameter tools and client schema | S8-READ + S6-WFA binding commands -> read/citation/approved normal workflow；owns D07/D08 cases | Red structural governance tool/role spoof；Green scoped read, no governance write | L+PG+HTTP；B existing Agent where applicable；H/T later | S8-READ(CD), S6-WFA(CD), S8-CON(CF) | tool registry no structural write + provenance tests |
| S12-LOG Log analysis | `server/modules/logs/**`；`src/application/ports/LogAnalysisRepository.ts`；`src/infrastructure/http/logClient.ts`；`src/infrastructure/http/logDtos.ts` | S8-READ + S7-MAP -> safe definition/revision refs；owns D07 case | Red tenant leak/unpinned ref/definition creation；Green scoped immutable ref | PG+HTTP；B existing log acceptance；H/T later | S8-READ(CD), S7-MAP(CD) | log regression + scope negative；不改 Catalog DTO |
| S12-DBG Debugging | `server/modules/debugging/**`；`src/application/ports/DebuggingGateway.ts`；`src/infrastructure/http/debuggingClient.ts`；`src/infrastructure/http/debuggingDtos.ts` | S6-WFA/S7-MAP exact map -> optional binding/pinned revision；owns D07 case | Red debug value mutates Catalog/property guess；Green exact map or block | PG+HTTP+B existing debug suite；H/T/hardware separate | S6-WFA(CD), S7-MAP(CD) | device approval unchanged；hardware evidence不由本票声称 |
| S12-DTS DTS reload | `server/modules/dts-reload/**`；`src/application/ports/DtsReloadRepository.ts`；`src/infrastructure/http/dtsReloadClient.ts` | S6-WFA/S8-READ/S7-MAP -> candidate/run/snapshot pins；owns D07/D08 cases | Red stale release/unpinned value shape/direct Catalog write；Green exact pin or block | PG+HTTP+B fake bridge；H/T/HDC separate | S6-WFA(CD), S8-READ(CD), S7-MAP(CD) | reload regression/provenance；真实 HDC 非 launch code evidence替代 |
| S12-KNW Knowledge | `server/modules/knowledge/**`；`src/application/ports/KnowledgeRepository.ts`；`src/infrastructure/http/knowledgeClient.ts`；`src/features/knowledge/**` | S8-READ/S7-MAP -> canonical definition/revision ref + retained legacy metadata；owns D07 case | Red orphan/silent retarget/draft visible；Green exact mapping/historical badge | PG+HTTP+B existing knowledge suite；H/T later | S8-READ(CD), S7-MAP(CD) | knowledge reference/audit gate；不编辑 shared OpenAPI |
| S12-MOD Module registry | `server/modules/parameter-modules/**`；`src/application/ports/ParameterModuleRegistryRepository.ts`；`src/infrastructure/http/parameterModuleRegistryClient.ts` | S4-REG/S8-LEG -> navigation-only placement；owns D02/D03 cases | Red module proves Subject/Definition/overlay authoring；Green placement-only or 410 | PG+HTTP+B legacy transition；H/T later | S4-REG(CD), S8-LEG(CD) | structural owner census zero；与 S9-GOV page用 frozen ports |
| S12-OPS Release/operations | `server/modules/operations/**`, reconciliation callers, operator read adapters（不含 upgrade controller） | S7-ORC inspect + frozen S10-PER `readReport` port + S8-LEG -> canonical diagnostics；owns D09 operations cases | Red old catalog-only verifier/reclassify/public diagnostics；Green read-only typed operator outcome | PG+HTTP；H repeat；T integration later；R 无 | S7-ORC(CF), S10-PER(CF), S8-LEG(CD) | operator authz + no Cutover mutation；S10-DCP 后再与 S10-RPT integration，无 code cycle；P12-15 excluded |

#### Release integration 与后续 programs

| Node | Objective / owner | Allowed paths / artifacts | Inputs -> outputs | Red -> Green | Evidence boundary | Dependencies / merge gate / conflict |
| --- | --- | --- | --- | --- | --- | --- |
| RI-01 | 独立 release-integration gate；由父会话/发布 owner 统一调用 Cutover、Verification 与 upgrade controller，执行 P12、P13、P11b、P14a/b/c、P15 | `scripts/run-self-hosted-release-gate.ts`、其 tests、`ops/self-hosted/releases/**`；owns target evidence manifest、release report refs、P12/P13/P14/P15 invocation wiring；不拥有 business module | all consumers + P0-P10 + Verification + upgrade/recovery + API/UI acceptance -> approved public-release chain | Red missing consumer/pre-report pin/P13 delta-only/pre-runtime browser/traffic early；Green exact purpose chain and isolation | PG+B+H（repeat only）+T required；R only with distinct approvals | S7-ORC(CD), S10-RPT(CD), S11-REC(CD)；S12-CGH(RE), S12-TOP(RE), S12-PRJ(RE), S12-FIL(RE), S12-AGT(RE), S12-LOG(RE), S12-DBG(RE), S12-DTS(RE), S12-KNW(RE), S12-MOD(RE), S12-OPS(RE), S10-VMP(RE), S10-DCP(RE), S10-API(RE), S10-UI(RE), S9-BRW(RE)；merge only after every blocking producer；不编辑 producer artifacts |
| S13-PROGRAM | R-L2 legacy-read sunset production-release program，不是 launch implementation ticket | future release plan/telemetry/compat docs only after real window | two releases + 90 days + 30-day per-class zero use + report -> eligible reads 410 | unmet telemetry must block | T+R required；local/H不可替代 | RI-01(RE) + actual elapsed time/telemetry + `legacy-read-sunset` approval；不能预先排期成代码 ticket |
| S14-PROGRAM | R-L3/P16 cleanup production-release program，不是 launch implementation ticket | separately approved cleanup release; exact asset removal list | S13-PROGRAM + retention/recovery/zero dependency + own RP/restore -> approved deletion | any protected dependency/history/restore gap blocks | T+R required | S13-PROGRAM(RE) + actual evidence；不得与 launch 合并或因静态“无引用”提前删除 |

<a id="pcat-spec-dag"></a>

### 17. Typed dependency DAG、critical path 与推荐 merge order

依赖类型：`CD`=code dependency；`CF`=contract-freeze dependency（consumer 可在 producer 实现未完成时开工，但只能依 frozen interface）；`ID`=integration dependency（必须在同一候选上汇合）；`RE`=release/evidence dependency（代码 green 不可替代）。下图每个 label 都对应上表真实 ticket row，workstream shorthand 不是 node。

```text
G0: #669-#679 decision docs + this Spec accepted by parent and present on main
G0 -(CD)-> S0-ID
S0-ID -(CD/CF)-> S0-RAT, S0-FIX, S1-BND, S2-SCH
S1-BND -(CD)-> S1-CMP
S2-SCH -(CF)-> S2-RBAC; S0-FIX + S2-SCH -(CD/CF)-> S2-PGH
S1-CMP + S2-SCH + S2-PGH -(CF/CF/CD)-> S3-RUN
S1-CMP + S2-SCH + S2-RBAC + S3-RUN -(CD/CF/CD/CF)-> S3-INS
S3-RUN + S3-INS + S2-RBAC -(CD)-> S3-VFY
S2-SCH + S2-RBAC + S2-PGH + S3-RUN + S3-INS -(CF/CD/CD/CF/CF)-> S4-REG
S3-RUN + S2-SCH -(CF/CD)-> S4-EVD -(CD)-> S4-REV
S4-REG + S4-REV + S3-INS -(CD/CD/ID)-> S5-RSL
S3-RUN + S2-SCH -(CF/CD)-> S5-PRP
S3-RUN + S4-REG + S2-SCH -(CD/CF/CD)-> S6-BND -(CD)-> S6-VAL
S6-BND + S6-VAL -(CD)-> S6-WFA
S0-FIX + S2-PGH + S3-RUN -(CD/CD/CF)-> S7-CLS
S7-CLS + S2-SCH -(CD)-> S7-MAP, S7-ARC
S3-INS + S4-REG + S4-EVD + S4-REV + S5-RSL + S5-PRP + S6-BND + S6-VAL + S6-WFA
  + S7-CLS + S7-MAP + S7-ARC -(CD/CF)-> S7-ORC(P0-P10)
S3-RUN + S4-REG + S4-REV + S5-RSL + S5-PRP + S6-WFA + S7-MAP + S7-ARC -(CF)-> S8-CON
S3-RUN + S4-REG + S6-WFA + S8-CON -(CD/CF)-> S8-READ
S4-REG + S4-REV + S5-RSL + S5-PRP + S8-CON -(CD/CF)-> S8-GOV
S7-MAP + S7-ARC + S8-CON -(CD/CF)-> S8-LEG
S8-CON -(CF)-> S9-PRT
S9-PRT + S8-READ -(CD/ID)-> S9-CAT; S9-PRT + S8-GOV -(CD/ID)-> S9-GOV
S9-CAT + S9-GOV + S8-READ + S8-GOV + S8-LEG -(ID)-> S9-BRW
S0-ID + S2-SCH -(CD/CF)-> S10-PER
S10-PER + S2-RBAC + S3-VFY + S7-ORC -(CF/CD/CD/ID)-> S10-VMP
S10-PER + S7-ORC + S12-CGH + S12-TOP + S12-PRJ + S12-FIL + S12-AGT + S12-LOG
  + S12-DBG + S12-DTS + S12-KNW + S12-MOD + S12-OPS -(CF/ID)-> S10-DCP
S10-PER + S8-CON + S8-READ + S8-GOV + S8-LEG -(CF/CD/ID)-> S10-API
S10-PER + S9-BRW -(CF/ID)-> S10-UI
S10-PER + S10-VMP + S10-DCP + S10-API + S10-UI -(CD)-> S10-RPT
S7-ORC + S10-PER -(CF)-> S11-UPG; S10-PER -(CF)-> S11-RP
S11-UPG + S11-RP + S7-ORC + S10-VMP -(CD/CD/CD/ID)-> S11-APL
S11-UPG + S11-RP + S11-APL -(CD)-> S11-REC
S8-READ + S8-GOV + S8-LEG + S7-ORC -(CD/CF)-> S12-CGH
S4-EVD + S6-WFA + S8-CON -(CD/CF)-> S12-TOP
S6-WFA + S8-CON -(CD/CF)-> S12-PRJ; S6-WFA -(CD)-> S12-FIL
S8-READ + S6-WFA + S8-CON -(CD/CF)-> S12-AGT
S8-READ + S7-MAP -(CD)-> S12-LOG
S6-WFA + S7-MAP -(CD)-> S12-DBG
S6-WFA + S8-READ + S7-MAP -(CD)-> S12-DTS
S8-READ + S7-MAP -(CD)-> S12-KNW
S4-REG + S8-LEG -(CD)-> S12-MOD
S7-ORC + S10-PER + S8-LEG -(CF/CF/CD)-> S12-OPS
S7-ORC + S10-RPT + S11-REC -(CD)-> RI-01，其中 S9-BRW/S10-VMP/S10-DCP/S10-API/S10-UI 与
  S12-CGH/S12-TOP/S12-PRJ/S12-FIL/S12-AGT/S12-LOG/S12-DBG/S12-DTS/S12-KNW/S12-MOD/S12-OPS -(RE)-> RI-01
RI-01 -(RE + actual time/telemetry)-> S13-PROGRAM -(RE + actual evidence)-> S14-PROGRAM
```

关键路径由 `G0 -> S0-ID -> S1-BND -> S1-CMP` 与 `G0 -> S0-ID -> S2-SCH -> S2-PGH` 在 `S3-RUN -> S3-INS -> S4-REG` 汇合；Governance 分支继续经过 `S4-EVD -> S4-REV -> S5-RSL`，再到 `S6-BND -> S6-VAL -> S6-WFA`、`S7-CLS -> S7-MAP/S7-ARC -> S7-ORC`、`S8-CON -> S8-READ/S8-GOV/S8-LEG -> S9-PRT/S9-CAT/S9-GOV/S9-BRW`、blocking `S12-CGH/S12-TOP/S12-PRJ/S12-FIL/S12-AGT/S12-LOG/S12-DBG/S12-DTS/S12-KNW/S12-MOD/S12-OPS` frontier、`S10-VMP/S10-DCP/S10-API/S10-UI -> S10-RPT` 与 `S11-UPG/S11-RP -> S11-APL -> S11-REC`，最后到 `RI-01`。S6-BND 只可在 S3-RUN 与 S4-REG contract freeze 后开始，不能声称与 S4-REG 全程并行。S10-PER 可在 S0-ID 与 S2-SCH schema freeze 后开始；S11-UPG、S11-RP、S10-PER 按精确边尽量并行。S9-PRT 只能在 S8-CON 后开始，browser-real S9-CAT/S9-GOV/S9-BRW integration 必须等待可运行的 S8-READ/S8-GOV/S8-LEG。

推荐 merge waves 只使用实际 ticket rows：(0) `G0`；(1) `S0-ID`；(2) 并行 `S0-RAT`、`S0-FIX`、`S1-BND`、`S2-SCH`；(3) `S1-CMP`、`S2-RBAC`、`S2-PGH`、`S10-PER`；(4) `S3-RUN`、`S11-RP`；(5) `S3-INS`、`S4-EVD`、`S5-PRP`、`S7-CLS`；(6) `S3-VFY`、`S4-REG`、`S4-REV`、`S7-MAP`、`S7-ARC`；(7) `S5-RSL`、`S6-BND`；(8) `S6-VAL`；(9) `S6-WFA`；(10) `S7-ORC` 与 `S8-CON`；(11) `S8-READ`、`S8-GOV`、`S8-LEG`、`S9-PRT`、`S11-UPG`；(12) `S9-CAT`、`S9-GOV`、`S10-VMP`、`S10-API`、`S11-APL`、`S12-CGH`、`S12-TOP`、`S12-PRJ`、`S12-FIL`、`S12-AGT`、`S12-LOG`、`S12-DBG`、`S12-DTS`、`S12-KNW`、`S12-MOD`、`S12-OPS`；(13) `S9-BRW`、`S10-UI`、`S11-REC`；(14) `S10-DCP`；(15) `S10-RPT`；(16) `RI-01`。S12-OPS 针对已冻结的 S10-PER `readReport` port 编译，S10-DCP 汇合所有 S12 result，之后 S10-RPT 才基于完整 evidence 实现该 port；每个 node 仍只有一个 branch 与一个 merge decision。S13-PROGRAM/S14-PROGRAM 等真实窗口，不进入 launch merge wave。

<a id="pcat-spec-artifact-freeze"></a>

### 18. Artifact ownership 与 freeze

| Artifact | Sole owner before freeze | Freeze point / downstream rule |
| --- | --- | --- |
| Branded IDs / closed enums | S0-ID | merge 后 CF；下游只消费，新增/改语义回 owner |
| Migration filenames | S2-SCH、S2-RBAC、S10-PER 各自仅拥有自己分配的文件 | 开工和 rebase 后分配；同阶段不得两 ticket 编辑同文件；applied bytes永不改 |
| ADR numbers/index | G0/父会话 | #669–#679 与 ADR-0040–0042 入 main 后 freeze；实现 ticket 不自行占号 |
| Catalog bundle schema / generated JSON | S1-BND | S1-CMP 前 CF；唯一 generator owner |
| PostgreSQL schema/constraints | S2-SCH | S3/S4/S6/S7/S10 使用前 CF；generated schema仍等 migration merge后更新 |
| Kernel public types | S3-RUN | S3-INS/S3-VFY/S4/S6/S8 前 CF |
| OpenAPI / route manifest / error registry / generated OpenAPI | S8-CON | route/frontend 前 CF；route tickets不得编辑 generated artifact |
| Frontend application ports/state | S9-PRT | page/governance tickets前 CF |
| Browser requirement/operation IDs 与 initial metadata | 本 Spec/G0 拥有现有 `required=false` requirements 与 `coverage=future` operations；S9-BRW 拥有后续 status/spec-reference transition | IDs 在 S9-PRT/S9-CAT/S9-GOV 前 freeze；S9-BRW 唯一把全部十五条切为 blocking/automated 并生成英文矩阵；各 acceptance file只写 marker |
| Verification gate registry / report schema | S10-PER / S10-RPT（不重叠文件） | adapters/controller 前 CF；purpose applicability不可由 adapter改变 |
| Upgrade journal / state machine | S11-UPG | S11-APL/REC 与 RI-01 前 CF |
| `docs/generated/db-schema.md` | schema integration owner（S2-SCH 后续与最终 migration wave各一次） | exact migration tree + real pgvector 后生成；并行 ticket不编辑 |
| Shared #671 fixture | S0-FIX | checksum freeze；S2/S7/S10 only consume |
| Acceptance spec files | S9-CAT owns `e2e/acceptance/parameter-catalog.acceptance.spec.ts`; S9-GOV owns `e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts`; S9-BRW owns `e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts` | 文件一票一 owner；不得跨票同改 |

任何同一 merge wave 出现两个 ticket 同时拥有同一 generated artifact、migration file、registry source 或 acceptance file，父会话必须先调整 ownership/merge wave；不能靠冲突解决后继续称为独立 ticket。

Ticket 创建前仍需父会话确认：四个深模块 seams；上述每行 ticket 粒度；`CD/CF/ID/RE` 边、critical path 与 merge order。本草案继续停在 `/to-tickets` 前。

## Testing Decisions

### 测试 seam 原则

测试只走 production 公开 seam 或同一 production port 的受控 test adapter。禁止把 private SQL repository、直接 Catalog table insert、test-only materializer、mock-only governance、API startup migration 或手工 DB repair 当验收路径。Internal fake 只用于确定性 failure injection；事务、角色、constraint、concurrency、cutover 和 audit 必须用真实 PostgreSQL。

### TDD Red -> Green 顺序

1. Red：static ratchet 证明当前 legacy writers、raw Catalog table reads、`parameterSpecId` consumers、overlay/Effective/Governance contracts 仍存在；Green：只允许明确 migration/compat allowlist，且 allowlist 单调减少。
2. Red：malformed/missing/duplicate/reordered release fixtures 编译错误；Green：同 bundle 任意枚举顺序产生 byte-identical model/digest，非法 lineage 全部 fail before write。
3. Red：fresh PostgreSQL 上 deferred head/subtype/placement/owner constraints、role negative 和 injected transaction failures；Green：S2 全部约束在 COMMIT 生效且无 partial row。
4. Red：Kernel bootstrap/advance/idempotency/drift/current+pinned replay/cache/failure injection；Green：六操作通过 production seam，previous pointer/heads 在每个 failure point 不变。
5. Red：caller/HTTP 传 transaction handle 或依次调用 Review/Registration/Placement writer、ETag race 留下 partial row、explicit/auto/review registration 产生多 Placement、lost response 重复审计、Proposal accept 写 Definition；Green：只通过 Parameter Governance public commands，`resolveReviewItem` 的 Governance-owned UoW、共享锁序、exact replay、独立 refusal sink 和 intent-only proposal 全通过。
6. Red：Binding 用 module/current latest、ProjectValue 未 pin exact revision、CAS race；Green：composite FKs、immutable history、independent-session winner/no-partial-write 通过。
7. Red：#671 R6/R8 same-key 被 merge、R0 被 Archive-as-success、rerun duplicate、rollback dump drift；Green：P0–P10 完整 fixture 与 failure-after-each-phase 通过。
8. Red：canonical routes 直接 repo、scope leak、header/body role spoof、idempotency conflict partial write、legacy inference；Green：PCAT-API-01–12 contract + real-PG + running HTTP + audit 全通过。
9. Red：single page 各 state/viewport/interaction 与 mock/API parity；Green：PCAT-UI-01–15 browser-real bundle 完整，所有 console/network unexpected failure 为零。
10. Red：Verification core 可被 adapter 改 gate、report 缺 gate、错 purpose/前驱、自批、pre-report 当 runtime pin、P13 后只跑 V13/P02；Green：冻结 registry、六 purpose/report chain、完整 post-P13 rerun、distinct approvals、no-waiver 通过。
11. Red：upgrade 仍由 API migrate/sync、unknown commit 猜测 resume、partial restore、traffic 早开；Green：controller core、Recovery Point adapter、fresh/populated apply 与 recovery-required matrix分别通过再汇合。
12. Red：11 consumer family 任一仍读 legacy ID/structure；Green：每个 S12 adapter 独立 green，完整 D corpus 与 protected-reference census 为零；这些 tickets不执行/拥有 P12–P15。
13. Red：缺任一 consumer/P0–P10/V-D-API-UI/upgrade-recovery evidence 仍可 P12、P13、candidate startup 或 public traffic；Green：RI-01 在同一 target/pin 上按 pre-activation -> P12 -> P13 -> full P11b -> runtime pin -> isolated API/browser -> public report -> P15 顺序通过。
14. Red：telemetry/dependency/retention 任一缺失仍可 sunset/delete；Green：只在后续真实 S13/S14 production programs 中由 R-L2/P16 purpose gates fail closed。

### 真实 PostgreSQL fixture 与验收矩阵

| 维度 | Fresh | Populated #671 | Rollback/restore | Browser-real | Hosted | Target/release |
| --- | --- | --- | --- | --- | --- | --- |
| Schema/migrations | empty DB 全链、M01–M04、roles | pre-candidate schema + exact ledger/fingerprint | failed phase dump equality；cross-store isolated restore | 不适用 | Linux repeatability | exact target ledger/schema |
| Catalog | bootstrap、zero legacy | formal Driver/NodeType 仅来自 release；subjectless/manual 不 materialize | old/current/pinned heads 与 fingerprint | API-backed read states | artifact/digest repeatability | exact packaged/DB/runtime equality |
| Registration | zero default registrations | 只创建 proven org/subject + one placement | retire/restore/move stable IDs | unregistered/register/conflict | contract repeats | target same-org/kind/lock proof |
| R0–R10 | zero inventory predicate | 所有 10 fixture case + full graph | P0 conservation、mapping/archive checksums | legacy deep links | corpus artifact | non-sampled target inventory |
| Binding/value | no rows unless explicit seed | stable IDs、3 histories、exact pins、inactive mismatch block | current/effective pointer equality | project consumer states | tests repeat | exact target protected refs |
| Verification | V/D zero-mode complete | V01–17 + D01–09 complete twice | restore-bound verifier rerun | API-01–12/UI-01–15 | archived CI evidence | purpose chain + approvals |
| Evidence claim | real local PG only | populated-shape only | local recovery mechanics only | local/target browser as executed | Hosted only | target-host then release/production approval |

Locked populated command 保留 #671 的 `npm run test:scripts -- parameter-catalog-rehearsal.integration` 语义：创建 checked-empty dedicated database、验证 schema ledger、加载 checksum-locked fixture、在候选+验证 transaction 中运行、rollback 后 canonical dump byte equality，并验证清理 marker；它不是 target readiness。

实现完成前还必须按风险执行 focused tests、`npm run test:all`、`npm run build`、OpenAPI/route contract、`npm run acceptance:coverage`、`npm run acceptance:operations`、`npm run acceptance:models`、`npm run acceptance:browser`、self-host checks、historical migration inventory check、`npm run docs:check` 和 `git diff --check`。Hosted、target-host、release 与 production approval 必须在其实际环境单独记录，不能由 local green 推导。

## Out of Scope

- 本规格分支不实现生产 TypeScript/React、SQL、migration、API、UI、Catalog YAML 或 `upgrade.sh`。唯一 TypeScript 变更是非生产 acceptance-registry metadata 与 static registry tests；它们不执行或证明应用行为。
- 不创建实现 Issues，不调用 `/to-tickets`，不打开 PR，不合并或同步 `main`。
- 不重写 Parameter value editing、draft/review、debugging、DTS reload 或 knowledge 的产品行为；只把它们的 catalog/binding identity adapter 切到 canonical contract。
- 不引入组织 schema/definition override、long-lived dual write/read、runtime lazy repair、remote Catalog hot fetch、property-key alias 或 module-as-definition identity。
- 不把 #676 DEV prototype 代码、截图或人工验收当成 production/browser/release evidence。
- 不在 launch release 中执行 R-L2 public sunset 或 R-L3/P16 schema deletion。

## Further Notes

### Blocker 清单

当前没有来自 11 个不可变 SHA 的未解决 product blocker。实现阶段以下任一情况立即 blocker：R0；release predecessor/membership/alias/history 缺失；protected reference 无 typed disposition；迁移 ledger/file checksum drift；无法证明 exact current Binding/value tip；不能取得同边界 Recovery Point；post-P13 完整 P11 缺失；任何 unexplained/unqueryable D case；writer reachability 非零；target pin/report/approval 不匹配。

### 证据边界

| Evidence | 本规格当前状态 | 可声称 | 不可声称 |
| --- | --- | --- | --- |
| 文档/静态 | 本草案可在 exact branch 运行 link/governance/diff checks，并登记 non-blocking `PCAT-UI-01..15` 与十五条 `future` operation | 规格、链接、registry 与静态一致性 | executable behavior 或 browser evidence |
| Local synthetic | 只执行 acceptance-registry metadata Vitest；`specFiles` 为空，exact future spec ownership 只写在 `deferralReason` | metadata parser/ratchet 行为 | production SQL/runtime/UI/target behavior |
| Real local PostgreSQL | 未执行 | 未来 constraint/transaction/role/concurrency | target data/host/release |
| Populated-shape | #671 是被消费的决策 fixture；本草案未运行 candidate | 未来 representative graph mechanics | row-for-row target |
| Browser | #676 仅 DEV decision evidence；本草案无 UI change、无 browser run | 未来 real candidate interactions | release readiness by prototype |
| Hosted/CI | 未执行 | future runner repeatability | self-hosted target |
| Target-host | 未执行 | exact target rehearsal | another target/release approval |
| Release/production approval | 不存在 | exact purpose report + accountable approvals | future releases or waived failures |

<a id="pcat-spec-documentation"></a>

## 文档影响矩阵

此矩阵是实现完成前的 blocking 更新清单；`Disposition` 只允许 `Update`、`Review`、`No change`。本规格修复现在更新双语 active plan 与 coverage map、acceptance metadata sources/static ratchets、生成的英文 operation matrix 及人工同步的中文 companion，不提前把未来目标写成“已实现”。

| Area | Disposition | English paths | Chinese paths | Owner / gate |
| --- | --- | --- | --- | --- |
| Repository maps | Update | `AGENTS.md`; `ARCHITECTURE.md` | `docs/zh-CN/root/AGENTS.md`; `docs/zh-CN/root/ARCHITECTURE.md` | 首个模块 merge 时登记四深模块、依赖和 readiness |
| Planning | Update | `docs/PLANS.md`; `docs/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md`; later `docs/exec-plans/completed/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md` | `docs/zh-CN/PLANS.md`; `docs/zh-CN/exec-plans/active/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md`; later `docs/zh-CN/exec-plans/completed/2026-09-01-wayfinder-canonical-parameter-catalog-replacement.md` | 父会话维护一份计划、多 ticket evidence |
| Domain/glossary | Update | `CONTEXT.md`; `docs/design-docs/domain-model.md` | `docs/zh-CN/design-docs/domain-model.md` | S0/S2 首个 model slice；只写 domain term，不把实现细节塞进 CONTEXT |
| ADR/index and accepted decisions | Update | `docs/adr/README.md`; `docs/adr/0040-canonical-parameter-catalog-relational-model.md`; `docs/adr/0041-platform-schema-catalog-releases-materialize-before-runtime.md`; `docs/adr/0042-organizations-register-canonical-subjects-once.md`; `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md`; `docs/design-docs/parameter-catalog-api-transition.md`; `docs/design-docs/parameter-catalog-cutover-archive-rollback.md`; `docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | `docs/zh-CN/design-docs/index.md`; `docs/zh-CN/design-docs/adr-0040-canonical-parameter-catalog-relational-model.md`; `docs/zh-CN/design-docs/adr-0041-platform-schema-catalog-releases-materialize-before-runtime.md`; `docs/zh-CN/design-docs/adr-0042-organizations-register-canonical-subjects-once.md`; `docs/zh-CN/design-docs/catalog-kernel-interface-and-transaction-boundary.md`; `docs/zh-CN/design-docs/parameter-catalog-api-transition.md`; `docs/zh-CN/design-docs/parameter-catalog-cutover-archive-rollback.md`; `docs/zh-CN/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md` | G0；引用 immutable SHA，不改历史决策语义 |
| Product specs | Update | `docs/product-specs/index.md`; `docs/product-specs/product-spec.md`; `docs/product-specs/prototype-functional-spec.md` | `docs/zh-CN/product-specs/index.md`; `docs/zh-CN/product-specs/product-spec.md`; `docs/zh-CN/product-specs/prototype-functional-spec.md` | S9 单页/角色/state 合同 |
| Architecture/design | Update | `docs/design-docs/index.md`; `docs/design-docs/full-stack-architecture.md`; `docs/design-docs/domain-model.md` | `docs/zh-CN/design-docs/index.md`; `docs/zh-CN/design-docs/full-stack-architecture.md`; `docs/zh-CN/design-docs/domain-model.md` | S3/S5/S7/S10 seams 与依赖方向 |
| API contract and guides | Update | `docs/design-docs/api-contract.md`; `docs/api/README.md`; `docs/api/authentication.md`; `docs/api/errors.md`; `docs/api/examples.md` | `docs/zh-CN/design-docs/api-contract.md`; `docs/zh-CN/api/README.md`; `docs/zh-CN/api/authentication.md`; `docs/zh-CN/api/errors.md`; `docs/zh-CN/api/examples.md` | S8-CON 同 SHA更新 route/error/concurrency/legacy |
| Frontend and design quality | Update | `docs/FRONTEND.md`; `docs/design-docs/ui-design-system.md`; `docs/developer/ui-quality-checklist.md` | `docs/zh-CN/frontend.md`; `docs/zh-CN/design-docs/ui-design-system.md`; `docs/zh-CN/developer/ui-quality-checklist.md` | S9 ports/state/3 viewport/focus |
| Coverage registries | Update | `e2e/acceptance/requirements.ts`; `e2e/acceptance/operationMatrix.ts`; `scripts/check-acceptance-coverage.test.ts`; `scripts/check-acceptance-operation-matrix.test.ts`; `docs/developer/browser-acceptance-coverage-map.md`; generated `docs/developer/user-operation-coverage-matrix.md` | `docs/zh-CN/developer/browser-acceptance-coverage-map.md`; `docs/zh-CN/developer/user-operation-coverage-matrix.md` | 本 Spec/G0 登记 non-blocking/future metadata；S9-BRW 后续补已有 spec reference、切 blocking/automated 并生成 evidence |
| Quality/testing | Update | `docs/QUALITY_SCORE.md`; `docs/design-docs/testing-strategy.md`; `docs/developer/verification-matrix.md` | `docs/zh-CN/QUALITY_SCORE.md`; `docs/zh-CN/design-docs/testing-strategy.md`; `docs/zh-CN/developer/verification-matrix.md` | S2/S10/S11/RI 真实 PG、V/D/API/UI/evidence hierarchy |
| Security/governance | Update | `docs/SECURITY.md`; `docs/design-docs/security-governance.md`; `docs/security/README.md`; `docs/security/threat-model.md`; `docs/security/data-classification.md`; `docs/security/audit-retention.md`; `docs/security/user-permission-design.md` | `docs/zh-CN/SECURITY.md`; `docs/zh-CN/design-docs/security-governance.md`; `docs/zh-CN/security/README.md`; `docs/zh-CN/security/threat-model.md`; `docs/zh-CN/security/data-classification.md`; `docs/zh-CN/security/audit-retention.md`; `docs/zh-CN/security/user-permission-design.md` | S2-RBAC/S5/S10 audit、roles、retention、refusal sink |
| Reliability | Update | `docs/RELIABILITY.md`; `docs/design-docs/deployment-operations.md` | `docs/zh-CN/RELIABILITY.md`; `docs/zh-CN/design-docs/deployment-operations.md` | S10/S11 readiness、failure、recovery |
| Runbooks | Update | `docs/runbooks/self-hosted-runtime.md`; `docs/runbooks/backup-restore.md`; `docs/runbooks/rollback.md`; `docs/runbooks/release-rollback.md`; `docs/runbooks/monitoring-alerting.md`; `docs/runbooks/observability-operations.md`; `docs/runbooks/incidents.md`; `docs/runbooks/effective-driver-parameter-catalog-reconciliation.md`; `docs/runbooks/platform-admin-and-schema-promotion.md` | `docs/zh-CN/runbooks/self-hosted-runtime.md`; `docs/zh-CN/runbooks/backup-restore.md`; `docs/zh-CN/runbooks/rollback.md`; `docs/zh-CN/runbooks/release-rollback.md`; `docs/zh-CN/runbooks/monitoring-alerting.md`; `docs/zh-CN/runbooks/observability-operations.md`; `docs/zh-CN/runbooks/incidents.md`; `docs/zh-CN/runbooks/effective-driver-parameter-catalog-reconciliation.md`; `docs/zh-CN/runbooks/platform-admin-and-schema-promotion.md` | S11/RI/S13/S14 phase、restore、sunset；旧 runbook标 superseded/retired |
| Self-hosted operator docs | Update | `ops/self-hosted/upgrade.md`; `ops/self-hosted/operations.md`; `ops/self-hosted/releases/README.md`; `ops/self-hosted/releases/release-template.md` | `ops/self-hosted/upgrade.zh-CN.md`; `ops/self-hosted/operations.zh-CN.md`; `ops/self-hosted/releases/README.zh-CN.md`; `ops/self-hosted/releases/release-template.zh-CN.md` | S11/RI；文档与 controller 同 merge，本 Spec不改 `upgrade.sh` |
| Generated artifacts | Update | `docs/generated/openapi.json`; `docs/generated/db-schema.md`; `docs/generated/acceptance-operation-evidence.md`; `docs/generated/acceptance-operation-evidence/index.json` | 同一 language-neutral generated paths：`docs/generated/openapi.json`; `docs/generated/db-schema.md`; `docs/generated/acceptance-operation-evidence.md`; `docs/generated/acceptance-operation-evidence/index.json` | S8-CON/S2 integration/S9-BRW sole-owner rules；exact source SHA生成 |
| Log-analysis API guide | Review | `docs/api/log-analysis-integration.md` | `docs/zh-CN/api/log-analysis-integration.md` | S12-LOG 逐项核对 canonical reference；若无 user-facing drift则记录 exact review evidence |

## 文档更新门

实现计划不得完成，除非：矩阵每个 Update/Review 行已双语更新或以 exact diff/测试明确记录 unchanged；`CONTEXT.md` 与 ADR/index 对 target glossary 无冲突；OpenAPI、route manifest、error registry、browser requirement/operation IDs 与实现同 SHA；migration inventory 与 generated schema 一致；`npm run docs:check` 在 real pgvector PostgreSQL 路径通过；local link、language link、`git diff --check` 通过；未完成项进入 tech-debt tracker 且不能是 release-blocking gate。

### Git & PR Workflow

- 当前 Spec 分支固定为 `codex/wayfinder-668-implementation-spec-20260901`；本轮只允许 append-only commit，不 amend/rebase/force-push。
- 未来每个 ticket agent 从当时最新 `origin/main` 创建独立 worktree，分支模板固定为 `codex/pcat-<issue-number>-<slug>`，先读本规格、AGENTS、对应 ADR/contract 与 owning-module 文档。
- 这是一份计划、多个 ticket 分支。实现 agent 仅在自己的 branch 实现、测试、commit；不得开/合 PR、push/fast-forward/merge `main`，也不得把一个 workstream 的所有 nodes 塞进单一 branch。
- 父 agent/会话所有者按本 Spec 的 `CD/CF/ID/RE` 图审查 exact diff/evidence、集成 ticket branches，独占 PR creation、merge 和 main synchronization。
- 多分支并行必须先 claim migration/ADR/acceptance ID，rebase 后重新检查编号和依赖；任何 inherited dirty worktree 保持只读，不 reset/stash/clean/checkout。
- 本草案分支只含规格/计划文档；在 seams、粒度和依赖确认前保持暂停。
