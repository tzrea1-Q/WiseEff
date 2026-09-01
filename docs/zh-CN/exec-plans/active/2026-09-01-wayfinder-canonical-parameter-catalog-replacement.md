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

建立四个深模块与一组单向依赖的业务模块：Catalog Kernel 独占 release 编译、materialization 和一致 snapshot；Release Verification 独占 purpose/report/approval/runtime-pin；Cutover 独占 P0–P16、R0–R10、mapping、Archive 和 recovery；Subject Governance、Evidence/Review、Proposal、Binding/ProjectValue 各自拥有业务事务。HTTP、前端和 `upgrade.sh` 只是适配器，不能重新编排内部事务、选择 Definition head、推断 legacy disposition 或豁免 gate。

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

### 1. 最终模块边界、所有权与依赖方向

| 模块 | 拥有 | 公开 seam | 明确不拥有 |
| --- | --- | --- | --- |
| Catalog source/publication | release bundle、manifest/YAML、稳定显式 ID、CI 编译产物 | immutable artifact | PostgreSQL current pointer、组织数据、runtime repair |
| Catalog Kernel | 编译、验证、安装、switch-back、current/pinned snapshot、matcher、revision history、materialization verification/cache | `CatalogMaintainer`、`CatalogRuntime`、`CatalogVerifier` | HTTP 路由、Registration、Proposal、Observation、Binding、release approval |
| Subject Governance | Registration 状态机、exactly-one Placement、taxonomy move/rename | query + commands | Subject/Definition 创建、matcher、Binding identity |
| Evidence & Review | immutable Observation/ReviewEvidence、ReviewItem grouping/resolution | observation ingest、queue query、resolve | Catalog materialization、弱证据自动绑定 |
| Definition Proposal | proposal revisions、submit/withdraw/accept/reject、publication intent | proposal commands/query | Definition/Revision 写入、Catalog pointer |
| Binding & Project Value | canonical Binding、effective revision CAS、immutable values、explicit current pointer/history | binding/value commands/query | Definition head 选择、module-as-identity |
| Legacy Mapping & Archive | typed identities、append-only mapping versions/heads、Archive metadata/object refs | exact operator/compat lookup | 重新分类、普通 Catalog 读取、public Archive enumeration |
| Catalog Cutover | P0–P16、R0–R10、phase locks/checkpoints、classification/mapping/archive、P12/P13、recovery | 4 个 maintenance 操作 | Catalog 内部事务、verification approval、HTTP/UI 业务编排 |
| Release Verification | gate registry、plan/attempt/report、lineage、purpose approvals、runtime pin、evidence retention | 5 个语义操作 + 私有 readiness projection | 修复、migration、sync、Archive 解密、traffic mutation |
| Catalog application/API | 认证、scope、DTO、timeline/composed reads、idempotency adapter | canonical HTTP contract | Catalog table/raw repository、排序/head/alias 推断 |
| Parameter definitions frontend | URL state、单页 UI、ports、conflict/reconfirm UX | application ports | durable business rule、raw migration diagnostics |
| Self-hosted upgrade adapter | host/data-plane orchestration、journal IO、queue/proxy/process adapter | Cutover/Verification 调用 | 自行选 gate、迁移 API startup、人工 waiver |
| Shared audit/observability/evidence | trusted audit、metric/log/evidence stores、retention primitives | shared infrastructure seams | Catalog 或 release 决策 |

依赖只允许如下方向：

```text
Catalog artifact -> Catalog Kernel
HTTP/composers -> Catalog Kernel runtime + owning business modules
Frontend -> application ports -> HTTP adapters
Evidence/Registration/Binding/Proposal -> Catalog nominal IDs + captured snapshot
Cutover -> Kernel maintainer/verifier + business migration ports + mapping/archive + recovery
Release Verification -> read-only Kernel verifier + read-only Cutover/API/browser/recovery evidence adapters
upgrade controller -> Cutover + Release Verification
```

反向依赖、跨模块 open transaction、HTTP 直接读 Catalog 表、Verifier 调 writer、Kernel 调 Registration/Proposal、Binding 按 module 或 current head 猜测均由静态 ratchet 阻止。现有 routes-less `parameter-kernel` 只保留跨参数工作流 primitive；新的 Catalog Kernel 是独立深模块，不能把旧 legacy identity adapter 当 canonical read seam。

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

### 3. Release Verification 深模块合同

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

### 4. Canonical relational schema 与约束

实现采用 PostgreSQL physical relation；下列名称是本规格选择的 canonical 名称。若后续实现 ticket 提议改名，必须证明 OpenAPI、migration、verifier 和文档同时等价，不能改变 key/ownership。

#### 4.1 Platform Catalog

| Relation | 必要列与 key | 不变量 |
| --- | --- | --- |
| `catalog_releases` | `id`, unique `release_version`, unique `release_digest`, restricted `predecessor_release_id`, compiled/toolchain digests | append-only，不 update/delete |
| `catalog_subjects` | `id`, `kind=driver|node-type`, `canonical_key`; unique `(kind, canonical_key)`、`(id,kind)` | Platform-only，无 organization/lifecycle/current selector |
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

#### 4.2 Organization、evidence 与 proposal

| Relation | 必要列与 key | 不变量 |
| --- | --- | --- |
| `organization_subject_registrations` | `id`, organization, subject, `status=active|retired`, method/proof, non-null `current_placement_id`; unique `(org,subject)`、`(id,org)`、`(id,org,subject)` | retire/restore 保留 ID 与 placement |
| `subject_placements` | `id`, registration, org, taxonomy `module_id`, origin；unique registration、`(registration,id)`、`(org,module)` | exactly one retained placement；same-org 与 kind-correct deferred check |
| `parameter_observations` | immutable source identity、org/project/logical-node/config/source locator、release/matcher pin、evidence fingerprint | 创建后不可变，不能成为 Definition |
| `parameter_observation_matches` | unique observation accepted match，pins registration/definition/revision/binding/release/matcher | 只有完整 provenance + unique active match；unknown/ambiguous 无行 |
| `parameter_review_evidence` | immutable evidence bundle、reason、candidate-safe digest、R class/source graph where applicable | 不包含可公开 raw payload |
| `parameter_review_items` | org、evidence fingerprint、matcher/release、reason、status、ETag version | group repeated evidence，不制造 identity |
| `parameter_review_resolutions` | immutable decision、actor、before/after ETag、idempotency fingerprint、target/proposal/out-of-scope | 与 item/Registration/Placement/audit 按 resolution 原子提交 |
| `definition_proposals` | org author、base release/revision、status、current proposal revision、ETag | 不含 accepted Definition/Revision materialization pointer |
| `definition_proposal_revisions` | immutable proposed payload/reason/evidence | proposal edit 追加 revision |
| `catalog_publication_intents` | accepted proposal、repository/publication reference、reviewer/audit | 只表达 intent；无 Catalog table grant |

Placement 的 `UNIQUE(registration_id)` 证明至多一个，Registration 的 non-null pointer 与 deferrable `(id,current_placement_id) -> subject_placements(registration_id,id)` 证明至少一个。Driver placement 必须落在 `driver-group`；NodeType 落在 `node-type`，父节点遵循已接受 taxonomy 规则。组织创建只建 reserved taxonomy root，Registration 初始为零。

#### 4.3 Binding、ProjectValue、mapping、Archive

| Relation | 必要列与 key | 不变量 |
| --- | --- | --- |
| `project_parameter_bindings` | stable `id`, org/project/logical-node, registration, subject, definition, non-null effective revision、explicit current value、release pin；unique `(project,logical_node,definition)` | 无 `module_id` 身份；composite FKs 证明所有 owner/revision agreement |
| `project_parameter_values` | immutable `id`, binding, definition, exact revision, source/config/value digest、typed value storage | history 不跟随 Definition head；禁止 update/delete |
| `binding_history_events` | binding、old/new pointer、reason、trusted audit、release/mapping pin | append-only；current 不按时间推断 |
| `legacy_identities` | unique `(source_system,source_kind,owner_scope_kind,owner_scope_id,source_id)` | immutable typed source identity |
| `legacy_mapping_versions` | identity、run、checksum、graph fingerprint、R class、exactly one typed target or Archive、optional supersedes | append-only，不 reclassify at read time |
| `legacy_mapping_heads` | one CAS pointer per legacy identity | historical consumer pins version；forward repair 追加并 CAS |
| `parameter_catalog_archives` | archive ID、source/owner/R class/reason、checksums、encrypted object ref、protected refs、run/release/audit/retention | ordinary roles no update/delete/decrypt；不进入 Catalog/public UI |
| `catalog_command_idempotency` | scope/key/request fingerprint/result ref/status | exact replay 返回 stored result；同 key 不同 fingerprint 冲突 |

R6 legacy spec 的 production target 是 ReviewEvidence + Archive/mapping evidence；R8 是 DefinitionProposal + Archive/mapping evidence。只有独立、完整的 project/logical-node/source-revision occurrence graph 才可产生 ParameterObservation；两者不得因相同 property key 合并。

#### 4.4 Cutover 与 verification persistence

Cutover 采用 `parameter_catalog_cutover_runs`、append-only `parameter_catalog_cutover_events`、CAS `current_phase`、typed phase checkpoints、classification ledger、comparison corpus/results 和 rollback-closure record。唯一 run tuple 是 `(source_snapshot_fingerprint,target_artifact_sha,target_catalog_release_digest,migration_contract_version,plan_digest)`。

Verification 采用 immutable plans、attempts、gate results、reports、report-evidence refs、approvals、runtime pins 与 retention calculations。Report bytes canonicalize 后取 SHA-256；approval 不修改 report。`pointer_rollback_closed_at` 是 first candidate business mutation、first queue business delivery、first accepted public business request 的最早 durable event，一旦写入不可清除，测试数据补偿也不重开。

#### 4.5 角色与权限

- catalog relations 由 non-login migration owner 所有。
- `catalog_synchronizer_role` 只有插入新 immutable rows、column-limited 更新 `catalog_state.current_catalog_release_id` 与 `parameter_definitions.current_revision_id` 的能力；不能 UPDATE/DELETE immutable rows。
- application、proposal、Agent、ordinary API/worker 只有允许的 SELECT 与各自业务 relation 写权；不能 assume synchronizer/migration owner。
- proposal role 只能 proposal/publication intent/audit。
- verifier role read-only，不能 `SET ROLE`、执行有写能力的 function、建立临时 writer function 或取得 Archive key。
- legacy structural tables在 P13 后所有 production role/function/trigger 路径都不可写；P01/P02 用真实 SQLSTATE negative matrix 证明。

### 5. 状态机与事务边界

#### Catalog publication

`uninstalled -> bootstrap-installed -> advanced*`；业务回滚是新的 forward release。pre-traffic switch-back 只在 zero-write/traffic + migration compatibility + previous projection/head map 完整时允许。所有其他回退 `switch-back-forbidden`。

#### Registration/Placement

`unregistered -> active -> retired -> active`。explicit 注册要求 Org Admin + release anchor + explicit PlacementIntent；system auto-register 只接受 unique authoritative active match；Agent 不得写。Observation 不得自动 restore retired Registration。move/rename 更新同一 Placement ID；destination conflict 与 audit 一起回滚。

#### Observation/Review

Observation immutable。matcher outcome 为 matched/unknown/ambiguous/retired/placement-conflict。ReviewItem `open -> resolved|out-of-scope`；resolution 只允许 `register-subject`、`restore-registration`、`mark-out-of-scope`、`open-definition-proposal`。选择 existing Subject 不创建 Definition/Revision/Binding；后续 recognition 走独立事务。

#### DefinitionProposal

`draft -> submitted -> accepted|rejected`，`draft|submitted -> withdrawn`。accepted/rejected 要求 Platform Admin，acceptor 与 submitter 不同；stale base 返回 `proposal-stale`。accept 事务只锁 proposal、追加 publication intent 和 trusted audit。

#### Binding/ProjectValue

Recognize-and-bind 在 captured release 下验证 active Subject、Registration、Definition、exact revision 与 owner 后创建/复用 stable Binding。Semantic cutover CAS `effective_revision_id`；documentation-only head 不改 Binding。Change value 锁 Binding/current head，按 effective revision 验证，追加 immutable ProjectValue、CAS current value 并同事务审计。stale CAS 无任何 partial write。

#### Audit 原子性

成功 domain write 与成功 audit 同事务；deny/refusal audit 使用独立 pool-owned sink 以便在被拒事务回滚后保留；step milestone 只在语义上确为已到达的外部阶段时独立提交。所有敏感 mutation 传播同一 server-owned TrustedInvocationContext，不接受 body/header `actorType`。

#### 锁、CAS 与 lost-response 边界

| Aggregate/operation | 并发控制 | Lost response / retry | 冲突行为 |
| --- | --- | --- | --- |
| Catalog install/switch-back | transaction-scoped advisory lock + `catalog_state` row lock + expected current pin | 按 release digest/fingerprint 复查 committed state，完整则 no-op | stale lineage、split head 或 unknown projection fail closed |
| Registration create | `(organization,subject)` key lock + destination taxonomy key lock + deferred constraints | Idempotency-Key/request fingerprint 返回 stored result | conflicting PlacementIntent 为 `placement-conflict`，无 partial Registration |
| Placement move/rename | Registration row + source/destination taxonomy key locks；ETag CAS | exact same mutation 可复读结果 | cycle/kind/org/stale destination 409，move 与 audit 一起回滚 |
| Review resolution | ReviewItem ETag CAS + release anchor + idempotency key | exact replay 返回同一 resolution/Registration/Placement | stale/already resolved/key reuse 为 `revision-conflict`，item 保持 unresolved |
| Proposal transition | proposal revision/ETag row lock + exact base release/revision | 已提交同一 transition 返回 stored outcome | stale base `proposal-stale`；self approval 403；无 publication materialization |
| Observation ingest | immutable source occurrence identity + evidence fingerprint uniqueness | identical occurrence is one evidence record/aggregate increment | changed payload under same source identity is evidence conflict，不覆盖 |
| Auto registration | 同 explicit Registration 锁；proof pin 是 captured release + matcher revision | concurrent unique proof 收敛为 one Registration/Placement | zero/multiple/retired/conflicting placement 只 review/refusal |
| Binding create/cutover | unique `(project,logical_node,definition)` + Binding row lock + expected effective revision | exact recognized association idempotent | stale release/revision、owner mismatch 或 CAS loser 无 partial history |
| ProjectValue append | Binding/current-value row lock + expected current value/effective revision | command idempotency record 返回 exact immutable value | stale CAS 无 value、pointer 或 audit partial write |
| Cutover phase | host operation lock + PG cutover advisory lock + phase CAS + source/plan digests | inspect exact checkpoint；known committed phase 可 resume | unknown outcome 先独立分类，不能证明即 `recovery-required` |
| Verification/report | immutable plan/attempt/report IDs；approval unique by report/purpose/principal role | incomplete attempt 标 interrupted 后新 attempt；complete digest-valid report 复用 | nondeterminism、wrong lineage/purpose 或 duplicate-role approval 阻断 |

### 6. Catalog Release 发布、同步与回放

Bundle 必须包含 release ID/version/predecessor digest、exact manifest-listed YAML + per-file digest、显式稳定 Subject/alias/Definition/Revision IDs、完整 as-of memberships、selector/tombstone provenance、complete Definition snapshots、schema/toolchain provenance 和 aggregate digest。文件枚举顺序不得影响编译结果；unlisted file、missing reference、digest mismatch、重复 identity、key/alias reassignment、非法 lifecycle/tombstone、lineage gap 均在写前失败。

发布与 revision 是不同 clock：任何 bundle 变化产生新 release；只有 persisted Definition content 变化产生新 Revision。documentation-only Revision 更新 Definition head，但不动 Binding/ProjectValue。release-only provenance/alias 变化不制造 Revision。Alias 只是一跳 Subject selector alias，不支持 property-key alias、chain、cycle 或 owner reuse。

Self-hosted 顺序必须是 build/offline validate -> quiesce -> verified Recovery Point -> data plane -> one-shot migration -> one-shot Catalog sync -> independent materialization verification；API/worker/web ordinary startup 只 verify packaged digest 与 approved runtime pin，不迁移、不同步、不 repair。

### 7. Canonical API、并发和 legacy ID 过渡

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

### 8. 单一 Parameter definitions 页面

canonical 路由为 `/parameter-admin/specs`，导航中只有一个 Parameter definitions entry；不存在 Effective/Governance peer。URL state 使用 opaque Subject/Definition/Review IDs 与 release anchor，支持 list/detail、timeline 与 same-page Review Queue；legacy bookmarks 通过 exact mapping/redirect/gone/conflict/not-found 处理。

- desktop `1440x900`：typed Subject/Placement navigation、Definition list、detail/history 形成清晰 panes；Review Queue 是同页 peer surface 并显示 count。
- tablet `768x1024` 与 mobile `390x844`：同一 IA 分阶段呈现，不另建简化业务规则；返回、selection 与草稿输入保留。
- detail 展示 formal Subject、current/pinned Revision、safe usage、Registration/Placement、Catalog publication + authorized audit timeline；raw migration row/Archive payload 永不出现。
- state 固定为 ready、unregistered、empty（`no-registrations|no-definitions|no-review-work|no-filter-match`）、loading、error、retired/deprecated、conflict。loading 可以标记上一 release stale，但不得启用 write。
- only Org Admin 可注册/放置/review；Platform Admin proposal review 与 org registration 分离；Agent surface 只读。
- conflict 刷新 release/ETag/placement evidence，保留用户输入并要求重新确认；不得 silent retry。
- 前端 ports 至少拆为 CatalogRead、SubjectGovernance、ReviewQueue、DefinitionProposal、DefinitionTimeline、LegacyLink；项目 topology/workbench port 不再兼任 Catalog governance。
- HTTP/mock adapters 满足相同 state machine；mock 无额外治理能力。#676 仅作为 IA/视觉决策，生产组件、测试和 screenshot 必须在实现分支重新构建与验证。

### 9. P0–P16、Archive 与 rollback

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

### 10. 六类 verification purpose 与 report chain

| Purpose | required-now | 明确不可用 | 通过并批准后唯一授权 |
| --- | --- | --- | --- |
| pre-activation | exact pins、Catalog/materialization、migration、initial V01–V17、D01–D09、Recovery Point、pre-switch fence | API/HTTP/browser/runtime 为 not-yet-executable | P12 read switch |
| post-retirement-runtime | P13 后完整 V/D 重跑、V13/P02、pointer/fingerprint、writer zero、runtime pin | API/browser acceptance 仍 not-yet-executable | API verify-only，然后 isolated worker/web |
| isolated-candidate-acceptance | exact-target API contract/PG/HTTP/auth/audit、三 viewport browser、internal observability、mutation closure record | public approval 不存在 | 无 traffic act；只作为 public report evidence |
| public-release | exact 三 predecessor reports + current target/recovery/observability/rollback | sunset/P16 尚未可用 | queue、proxy、public traffic |
| legacy-read-sunset | public lineage、2 releases + 90 days、每类 30 天零使用、consumer/reference/recovery/approval | P16 deletion | eligible public legacy reads 410 |
| p16-cleanup | 全 canonical/fresh/populated/API/browser/obs/rollback、own Recovery Point/target restore、zero dependency、retention/legal hold | 无 waiver | 列举且批准的 code/schema/role/grant/trigger/view removal |

### 11. Verification gates

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

### 12. Observability、failure codes、audit 与 retention

Stable family 固定为 `PCAT-ART|MIG|SCHEMA|SYNC|CLASS|MAP|REG|BIND|ARCH|VRF|CMP|API|AUTH|UI|UPG|WRITER|RP|RESTORE|RET-*`。human summary 可改，automation 只依赖 family/code + gate ID。

Metrics 至少包括 verification attempts/duration、release verified、comparison cases、protected refs、legacy writers/reads、Recovery Point age/validity、restore rehearsal、retirement condition。Label 只允许 bounded enum/registered deployment ID；严禁 Definition/Binding/legacy/property/value/DTS/user/org/project/report digest/object key/URL/free text。

Structured logs 含 trace/request、target class、release/run/attempt/report、gate、phase、stable code/result/duration/evidence ref 和 redacted summary。Audit 覆盖 verification prepare/run/refusal/report/approval、P12、P13、runtime pin、isolated acceptance/mutation、public authorization、rollback closure、restore、sunset、P16；保留 authenticated principal 与 trusted initiator。

Retention 取 legal/audit hold、最长 protected/business/Archive/mapping retention、cleanup 后一年、最后支持 restore/old-binary window 后一年、legacy public window 结束的最晚者。failed/interrupted attempt 至少一年，incident/legal hold 更长。Report 不复制 raw dump、Archive payload、parameter value、DTS、credential 或 person data。

### 13. Legacy retirement 与可删除条件

R-L0=P13 writer retirement；R-L1=launch 后 read-only observation；R-L2=purpose-approved public read sunset；R-L3=P16 cleanup release。Catalog-only escape checks、reconcile code、legacy writers/roles/triggers/tables、Effective/Governance projection、migration aliases 各自只在 #679 asset-specific gate 到达时删除。

P16 必须同时满足：至少两次 production release、至少 90 天、每种 supported deployment class 连续 30 天 immutable rollup 零 legacy read、全部 first-party/external/import/export/deep-link disposition、unresolved protected/ambiguous operational mappings 为零、mapping/Archive target restore evidence、recovery 不依赖 legacy schema、HTTP/Agent/jobs/scripts/functions/triggers/roles/grants writer 零、fresh/populated/API/browser/obs/rollback 通过、cleanup 自有 Recovery Point + real target restore、old binary 行为明确、distinct Operator/Platform owner approvals、retention/legal hold 完成。

P16 永不因“非 current”删除 Audit、Archive、mapping versions/heads、Catalog releases、Definition revisions、Bindings、ProjectValues、Proposals、Observations 或 ReviewEvidence。

### 14. Migration 编号与历史不可变策略

- 当前基线最高 prefix 是 `0136`；本规格不抢占 `0137` 或任何具体编号。
- 每个实际 migration slice 开工与 rebase 后重新 fetch `origin/main`，枚举 packaged filenames 与 applied ledger，取当时下一组连续、唯一 prefix；并行 collision 只对尚未应用的本分支文件做 content-preserving renumber。
- 已在任何受支持环境 applied 的 migration 文件名与 bytes 永不修改、删除或伪造。需要修复时新增 append-only migration。
- 历史 rename/alias 只有经显式 append-only alias ledger 才合法；ambiguous alias 失败。不得为缺失 applied file“补一个同名不同 bytes”。
- release manifest 记录 ordered filename/checksum inventory、old/new compatibility 和 target ledger/schema fingerprint。M01–M04 在 migration 前后运行；API startup 证明没有执行 migration。
- 每个 migration 强制 fresh + upgrade-from-supported-floor + populated rehearsal，约束测试必须 `SET CONSTRAINTS ALL IMMEDIATE` 或 COMMIT；并发用 independent sessions。
- `docs/generated/db-schema.md` 由 exact migration tree 重新生成，`npm run docs:check` 必须在计划完成前用真实 pgvector PostgreSQL 路径验证，而不是把 extension skip 当完整 schema evidence。

### 15. 实现切片与依赖图（尚非 Issues）

```text
S0 contract/gate registry + fixture ratchets
  -> S1 release bundle/compiler
  -> S2 canonical PostgreSQL schema/roles
  -> S3 Catalog Kernel
S3 -> S4 Registration/Placement
S3 -> S5 Observation/Review/Proposal
S3 + S4 -> S6 Binding/ProjectValue
S2..S6 -> S7 mapping/Archive/cutover P0-P10
S3..S6 -> S8 canonical API + legacy resolver
S8 -> S9 one-page frontend + consumers
S7 + S8 + S9 -> S10 Release Verification + V/D/API/UI evidence
S7 + S10 -> S11 self-hosted controller/report chain/recovery
S8..S11 -> S12 all 11 consumer cutovers + P12/P13/P14/P15
S12 -> S13 R-L2 telemetry/sunset
S13 -> S14 P16 cleanup release
```

建议后续 ticket 粒度是“一条公开 seam 或一个可独立验证的 vertical contract”，不是按文件或表拆票：

1. S0 固定 branded IDs、closed enums、gate registry、static import/route/legacy writer ratchets 与 #671 fixture loader。
2. S1 实现 deterministic bundle compiler/validator 与 release-history artifact，不接数据库。
3. S2 实现 schema、deferred constraints、roles/grants 和 real-PG contract harness，不接 HTTP。
4. S3 实现完整 Kernel 六操作、snapshots、cache、failure injection 与 independent verifier。
5. S4 实现 Registration/Placement aggregate、explicit/auto flows、concurrency 与 audit。
6. S5 实现 Observation/Review/Proposal 三个不同 aggregate，确保 acceptance 不 materialize Catalog。
7. S6 实现 canonical Binding/ProjectValue 和所有 protected workflow adapters。
8. S7 实现 classifier、typed mapping、Archive、P0–P10 和 rollback-contained populated rehearsal。
9. S8 一次协调交付 OpenAPI、route manifest、auth/idempotency、Kernel closure 与 legacy HTTP。
10. S9 一次协调交付 ports、HTTP/mock parity、single page、responsive/browser operation IDs。
11. S10 实现 verification persistence/interface、V/M/P/D gate、report lineage/approvals/runtime pin；browser/API runner 只作为 evidence producer。
12. S11 修改 upgrade controller 只消费 Cutover/Verification seams，完成 fresh/populated/restore/unknown-outcome matrix。
13. S12 按 11 consumer families 分批迁移，但 P12 前必须在同一 candidate 上整体 P11；P13 后完整重跑，再做 isolated/public release chain。
14. S13/S14 是后续 release 工作，不能与 launch ticket 合并，也不能因代码“看起来无引用”提前删除。

Ticket 创建前需要父会话确认三点：上述模块 seams 是否正确；每个编号项是否为合适 ticket 粒度；依赖边是否允许 S4/S5/S6 并行且仍保持 S7/S10 汇合 gate。本草案不会创建 Issues。

## Testing Decisions

### 测试 seam 原则

测试只走 production 公开 seam 或同一 production port 的受控 test adapter。禁止把 private SQL repository、直接 Catalog table insert、test-only materializer、mock-only governance、API startup migration 或手工 DB repair 当验收路径。Internal fake 只用于确定性 failure injection；事务、角色、constraint、concurrency、cutover 和 audit 必须用真实 PostgreSQL。

### TDD Red -> Green 顺序

1. Red：static ratchet 证明当前 legacy writers、raw Catalog table reads、`parameterSpecId` consumers、overlay/Effective/Governance contracts 仍存在；Green：只允许明确 migration/compat allowlist，且 allowlist 单调减少。
2. Red：malformed/missing/duplicate/reordered release fixtures 编译错误；Green：同 bundle 任意枚举顺序产生 byte-identical model/digest，非法 lineage 全部 fail before write。
3. Red：fresh PostgreSQL 上 deferred head/subtype/placement/owner constraints、role negative 和 injected transaction failures；Green：S2 全部约束在 COMMIT 生效且无 partial row。
4. Red：Kernel bootstrap/advance/idempotency/drift/current+pinned replay/cache/failure injection；Green：六操作通过 production seam，previous pointer/heads 在每个 failure point 不变。
5. Red：Proposal accept 仍能写 Definition、Observation 能 weak-match、Registration 产生多 Placement/自动 restore；Green：各 aggregate 和权限边界分别通过。
6. Red：Binding 用 module/current latest、ProjectValue 未 pin exact revision、CAS race；Green：composite FKs、immutable history、independent-session winner/no-partial-write 通过。
7. Red：#671 R6/R8 same-key 被 merge、R0 被 Archive-as-success、rerun duplicate、rollback dump drift；Green：P0–P10 完整 fixture 与 failure-after-each-phase 通过。
8. Red：canonical routes 直接 repo、scope leak、header/body role spoof、idempotency conflict partial write、legacy inference；Green：PCAT-API-01–12 contract + real-PG + running HTTP + audit 全通过。
9. Red：single page 各 state/viewport/interaction 与 mock/API parity；Green：PCAT-UI-01–15 browser-real bundle 完整，所有 console/network unexpected failure 为零。
10. Red：report 缺 gate、错 purpose、错 predecessor、self approval、pre-report 被当 runtime pin、P13 只跑 V13/P02；Green：六 purpose/report chain、完整 post-P13 rerun、distinct approvals、no-waiver 通过。
11. Red：upgrade 仍由 API migrate/sync、unknown commit 猜测 resume、partial restore、traffic 早开；Green：fresh/populated/restore 与每个 legal-action guard 通过。
12. Red：11 consumer family 任一仍读 legacy ID/structure；Green：完整 D corpus 与 acceptance matrix 通过后才允许 P12/P13。
13. Red：telemetry/dependency/retention 任一缺失仍可 sunset/delete；Green：R-L2/P16 purpose gates fail closed。

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

- 本规格分支不实现生产 TypeScript/React、SQL、migration、API、UI、Catalog YAML 或 `upgrade.sh`。
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
| 文档/静态 | 本草案可在 exact branch 运行 link/governance/diff checks | 规格完整性、链接与静态一致性 | executable behavior |
| Local synthetic | 本草案未执行生产行为测试 | 未来 pure/fake contract | SQL/runtime/target |
| Real local PostgreSQL | 未执行 | 未来 constraint/transaction/role/concurrency | target data/host/release |
| Populated-shape | #671 是被消费的决策 fixture；本草案未运行 candidate | 未来 representative graph mechanics | row-for-row target |
| Browser | #676 仅 DEV decision evidence；本草案无 UI change、无 browser run | 未来 real candidate interactions | release readiness by prototype |
| Hosted/CI | 未执行 | future runner repeatability | self-hosted target |
| Target-host | 未执行 | exact target rehearsal | another target/release approval |
| Release/production approval | 不存在 | exact purpose report + accountable approvals | future releases or waived failures |

## 文档影响矩阵

此矩阵是实现完成前的 blocking 更新清单；本规格草案只新增双语 active plan 和相应计划索引，不提前把目标行为写成“已实现”。

| Area | Disposition | Exact paths / update gate |
| --- | --- | --- |
| Repository maps | Update at implementation | `AGENTS.md`, `ARCHITECTURE.md`, `docs/zh-CN/root/AGENTS.md`, `docs/zh-CN/root/ARCHITECTURE.md`：登记新模块、命令和 readiness 顺序 |
| Planning | Update now/review later | 本双语 active plan；`docs/PLANS.md`, `docs/zh-CN/PLANS.md`；完成后移至双语 completed，任何 deferred work 进双语 tech-debt tracker |
| Domain/glossary | Update with first model slice | `CONTEXT.md` 及相关中文 domain model：删除/标记旧词义，加入 CatalogRelease、CatalogSubject、DefinitionRevision、Registration、Placement、Observation、ReviewEvidence、Proposal、ProjectValue、VerificationPurpose |
| ADR/index | Update before implementation merge | `docs/adr/README.md`、ADR-0040/41/42 双语落主线；明确旧 ADR supersession，不改历史正文 |
| Product specs | Review/update with UI slice | `docs/product-specs/product-spec.md`, `prototype-functional-spec.md` 及中文 companion：唯一页面和角色/状态 |
| Architecture/domain | Update | `docs/design-docs/full-stack-architecture.md`, `domain-model.md`, `index.md` 及中文 companion；加入 Kernel/Verifier/Cutover seams 和依赖方向 |
| API docs/contract | Update atomically with S8 | `docs/design-docs/api-contract.md`, `docs/api/README.md`, `authentication.md`, `errors.md`, `examples.md` 及中文 companion；OpenAPI generated artifact/route manifest |
| Frontend/design | Update with S9 | `docs/FRONTEND.md`, `docs/design-docs/ui-design-system.md`, `docs/developer/ui-quality-checklist.md` 及中文 companion；单页 state/ports/responsive contract |
| Quality/testing | Update before P12 | `docs/QUALITY_SCORE.md`, `docs/design-docs/testing-strategy.md`, `docs/developer/verification-matrix.md`, browser coverage map、operation matrix 及中文 companion；登记 PCAT IDs/commands/evidence |
| Security/governance | Update with roles/audit | `docs/SECURITY.md`, `docs/security/threat-model.md`, `data-classification.md`, `audit-retention.md`, `user-permission-design.md` 及中文 companion |
| Reliability/runbooks | Update with S11 | `docs/RELIABILITY.md`, self-hosted runtime、backup/restore、rollback、release-rollback、monitoring/alerts、incidents runbooks 及中文 companion |
| Self-hosted operator docs | Update with S11 | `ops/self-hosted/upgrade.md`, `operations.md`, release template 及 `.zh-CN.md` companions；不在本草案改 `upgrade.sh` |
| Generated schema | Update after migrations | `docs/generated/db-schema.md` 由 exact fresh migration tree 生成并用 real pgvector PostgreSQL 验证 |
| References/decision contracts | Land/review | #669–#679 的双语 ADR/design/reference artifacts 以 immutable SHA 为来源；若 cherry-pick/重写会改变 SHA，则以新文档明确引用原 SHA，不替代证据 |
| External compatibility | Update before launch | published API deprecation/sunset docs、import/export schema、deep-link mapping 与 operator diagnostics 文档 |

## 文档更新门

实现计划不得完成，除非：矩阵每个 Update/Review 行已双语更新或以 exact diff/测试明确记录 unchanged；`CONTEXT.md` 与 ADR/index 对 target glossary 无冲突；OpenAPI、route manifest、error registry、browser requirement/operation IDs 与实现同 SHA；migration inventory 与 generated schema 一致；`npm run docs:check` 在 real pgvector PostgreSQL 路径通过；local link、language link、`git diff --check` 通过；未完成项进入 tech-debt tracker 且不能是 release-blocking gate。

### Git & PR Workflow

- 未来每个实现 agent 从当时最新 `origin/main` 创建独立 worktree 和 `codex/` feature branch，先读本规格、AGENTS、对应 ADR/contract 与最近模块文档。
- 实现 agent 仅在自己的 branch 实现、测试、commit；不得 push `main`、开/合 PR、fast-forward 本地 `main`。
- 父 agent/会话所有者审查 exact diff 与 evidence，决定 ticket/branch 集成，拥有 PR、merge 和 `git pull origin main`。
- 多分支并行必须先 claim migration/ADR/acceptance ID，rebase 后重新检查编号和依赖；任何 inherited dirty worktree 保持只读，不 reset/stash/clean/checkout。
- 本草案分支只含规格/计划文档；在 seams、粒度和依赖确认前保持暂停。
