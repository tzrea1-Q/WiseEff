# ADR-0041：平台 Schema Catalog Release 必须在运行时启动前完成物化

> English: [English decision record](../../adr/0041-platform-schema-catalog-releases-materialize-before-runtime.md)

日期：2026-08-31

## 状态

已由 [Choose platform schema publication and synchronization semantics](https://github.com/tzrea1-Q/WiseEff/issues/674) 接受；该票属于 [Wayfinder: replace the parameter catalog with one canonical definition model](https://github.com/tzrea1-Q/WiseEff/issues/668)。本记录正式编号为 ADR-0041，并以 [ADR-0040](../../adr/0040-canonical-parameter-catalog-relational-model.md) 的模型权威、稳定身份、revision 与事务规则为前提。本 ADR 描述目标 publication/synchronization 语义，不表示现有 loader、数据库、缓存或 upgrade 路径已经完成实现。

## 背景

已批准的目标只有一个结构真相来源：Platform schema catalog。组织可以注册和放置正式 Driver、NodeType 主体，但不能编写、复制、覆盖或私有重定义 schema。运行时 observation 只是证据，不能创建 definition。

当前实现不满足这一合同。`schemas/dts/catalog.json` 虽然列出 YAML 输入，但内容 hash 不一致不会停止加载，缺失的 common reference 也会被忽略。数据库行随项目 ingest 惰性物化，未被业务触达的 schema 可能不在数据库里。进程缓存把固定文件与 Platform/organization overlay 合成。自托管 upgrade 先启动 API、由 API 执行 migration，之后才检查 PostgreSQL 中已有的 catalog 形状；该检查既不读取仓库 catalog，也不能证明数据库是其完整物化。[Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) 及其[仓库研究记录](https://github.com/tzrea1-Q/WiseEff/blob/f982c76a063f3c8bc0a7366d5253243ecba2866f/docs/references/parameter-catalog-contract-inventory.md)已经列出这些事实。

[ADR-0040](../../adr/0040-canonical-parameter-catalog-relational-model.md) 已确定上位模型：Proposal 接受只产生 publication intent；只有已发布的不可变 Catalog Release 才能输入 catalog 真相；Catalog Release synchronizer 是稳定 CatalogSubject/alias root、不可变 release-scoped subject/alias membership、`ParameterDefinition` 与 `DefinitionRevision` 的唯一数据库物化者。当前 subject/alias lifecycle 只通过单一 current Catalog Release pointer 派生。ADR-0040 还要求任意持久化 definition 内容变化，包括 documentation，都创建新的不可变 DefinitionRevision。

我们需要一条单一发布谱系，让 YAML、数据库行、缓存、upgrade 顺序、回滚和历史重放保持一致，同时不让任何派生副本成为第二权威，也不削弱上述规则。

## 决策

### 1. 唯一权威输入是一个不可变 Catalog Release bundle

**Platform Schema Catalog Release** 是唯一权威发布输入。它是经仓库评审、随目标应用制品交付的 bundle。manifest 根保持为 `schemas/dts/catalog.json`，除非后续实现计划只改变物理格式。bundle 必须包含或标识：

- 单调排序的 catalog release version 及其 predecessor release digest；
- 本次发布的精确 YAML 文档及逐文件内容 digest；
- 稳定 subject declaration：opaque subject ID、不可变 Driver/NodeType kind 与永久 canonical key；
- predecessor 已知每个 subject 的完整 as-of membership：active/retired lifecycle、selector snapshot/provenance，以及仅在 retired 时存在的 tombstone provenance；
- 永久 alias-owner declaration，以及 predecessor 已知每个 stable alias 的完整 as-of active/retired membership 与 selector/tombstone provenance；
- 完整 definition snapshot 及验证所需 schema/toolchain provenance；
- 根据完整 normalized release model 计算的唯一 canonical aggregate digest。

只有 manifest 列出的内容具备权威性。目录扫描、未列出的文件、数据库内容、运行时缓存、远程热下载、产品表单和组织数据都不是 catalog 输入。Proposal 接受只写入获批 publication intent 或仓库变更引用以及可信审计；它既不是 Catalog Release，也不得直接创建或改变 CatalogSubject、ParameterDefinition、DefinitionRevision 或 current-release pointer。只有经仓库评审的内容被组装成拥有独立 version 与 digest 的新不可变 Catalog Release，才算完成发布。紧急修正也走同一路径。

CI 必须在发布前对缺失文件/引用、digest 不符、schema shape 错误、正式身份重复、稳定 ID 或自然键改绑、非确定性 normalization、alias 冲突、非法 lifecycle transition、无效 predecessor 或无法保留所需历史的 release 失败关闭。编译结果必须不受文件系统枚举顺序影响，并得到相同 aggregate digest。Synchronizer 在打开物化事务前还要重复完整离线验证；CI 成功不能替代运行时证明。

Manifest compilation 必须确定性地产生关系形状：一个不可变 `catalog_releases` identity；新引入身份对应的永久 `catalog_subjects` 与 `catalog_subject_aliases` root；release 内每个 subject 对应一个 `catalog_release_subjects` membership；每个 stable alias 对应一个 `catalog_release_subject_aliases` membership；以及完整 Definition snapshot。Retired subject/alias membership 必须带非空 tombstone provenance，active membership 则不得携带。Tombstone 因而是不可变 membership 上的 withdrawal provenance，不是可与 lifecycle 漂移的独立身份。Compilation 不产生 `catalog_state`；只有 synchronization 成功后才能切换该 singleton pointer。

### 2. Catalog Release 与 Definition Revision 使用不同版本时钟

bundle 的任何变化都要发布新的不可变 Catalog Release，包括 definition 内容、documentation、alias、deprecation、retirement metadata 或 release provenance。已发布的 release version 或 digest 永不重写。

正式 definition 的任意持久化内容变化都会铸造新的不可变 **DefinitionRevision**，包括 value shape、constraints、units、schema default、definition 级 lifecycle 或 matching metadata、展示文本、示例以及纯 documentation 修正。既有 revision 永不更新或删除。Documentation-only revision 会推进 ParameterDefinition head，但不会改变任何 Binding 的 `effective_revision_id`、创建或替换 Binding，也不会切换当前或历史 ProjectValue。只改变 release provenance、subject selector alias 等 release 层事实而未改变任何持久化 definition snapshot 时，不凭空制造 DefinitionRevision。

definition 的稳定身份仍是 typed formal subject 加永久 property key；opaque ID 与 relational current-head constraint 由 [ADR-0040](../../adr/0040-canonical-parameter-catalog-relational-model.md) 确定。Catalog Release 与 DefinitionRevision 使用不同版本时钟，但 release 是 synchronizer 铸造 revision 的唯一来源。

### 3. Alias 是 selector alias，不是另一个身份

稳定 Catalog alias 把外部主体 selector（例如旧 `compatible`、nodename 或供应商标识）直接映射到一个 canonical Driver 或 NodeType subject。`catalog_subject_aliases` 为该 subject 永久持有 normalized selector；`catalog_release_subject_aliases` 声明该 alias 在一个 release 中是 active 还是 retired。两者都不创建第二个 subject 或 definition。解析只允许一跳；禁止 alias chain、cycle、歧义目标、与 canonical selector 冲突，以及把已发布 alias 复用于另一主体。

这里的 alias 不包含 `property_key` alias，也不包含 DTS source-write `targetRef`。带引用的 property-key 修改继续走 ADR-0034 的 source-rewriting cutover；不能用长期 alias 掩盖项目源文件是否真正迁移。

Deprecated 与 retired 必须区分：

- **Deprecated** 是软警告状态。definition 仍可匹配和重放，使已有及新观察到的源不会突然失去 parse coverage，但会离开默认治理选择并指向 successor。
- **Retired** subject/alias membership 在对应 release 成为 current 后显式退出当前匹配；已有 binding、revision、release membership、audit 与 replay 仍可通过固定历史访问。Definition 级 retirement 仍属于 definition content，因此服从 DefinitionRevision 规则。

每个 successor manifest 都必须是 predecessor 已知每个 subject 与 stable alias 的完整 as-of snapshot。省略任一对象均无效，并阻止发布和 pointer switch；不得解释为 retirement 或 deletion。撤回必须使用带 tombstone provenance 的显式 `retired` release membership，记录稳定身份、既有 selector state、适用时的 successor，以及执行状态转换的 release。Restore 是后续 release 对同一 subject ID、canonical key 与 alias owner 发布 `active` membership。某身份首次发布前未出现在旧 release 中，含义是尚未发布，而非 retired。Retirement/restore 期间 definition 内容有变化时仍创建新 revision。

物理删除不是 catalog lifecycle 操作。只要任何受支持 lineage、Binding、ProjectValue、observation、match、audit 或 replay 记录仍可能引用，已发布 subject、definition、revision、alias、tombstone 或 release snapshot 都不得删除。存储退役可以归档不可变且已验证的 snapshot，但不得让 digest 或固定身份变得不可用。退役后也禁止把 alias 或自然键复用于另一身份。

### 4. 派生状态只允许单向来源

目标谱系为：

```text
Catalog Release manifest + YAML
  -> canonical compiled release
       (stable roots + complete release memberships + definitions)
  -> atomic database projection
       (release/subject/alias memberships + revisions + heads)
  -> catalog_state.current_catalog_release_id
  -> captured release snapshot / runtime cache
```

PostgreSQL 是可查询物化结果，不是 authoring source。只有 Catalog Release synchronizer 可以插入稳定 CatalogSubject/alias root、release identity、`catalog_release_subjects`、`catalog_release_subject_aliases`、ParameterDefinition 或 DefinitionRevision 行，或推进 Definition head 与 `catalog_state.current_catalog_release_id`。Proposal、ingest、review、HTTP、Agent、脚本和普通应用服务都没有并行物化路径。

`catalog_subjects` 与 `catalog_subject_aliases` 永不直接回答 current-lifecycle 查询。当前 subject lifecycle 是 `catalog_state.current_catalog_release_id -> catalog_release_subjects` 唯一定位的行。当前 alias resolution 使用同一已捕获 pointer，并要求其 `catalog_release_subject_aliases` row 与所属 `catalog_release_subjects` row 都是 active。每次当前 catalog 读取只捕获一次 pointer，因此 reader 只会看到完整旧 release 或完整新 release，不会看到混合 membership state。

Runtime cache 是某一个已验证数据库物化的可丢弃不可变快照，使用精确 Catalog Release digest 作为 key。业务流量期间不再独立解析 YAML，也不再合成 Platform 或 organization overlay。缓存缺失可由已验证数据库 projection 重建；物化缺失或未验证时绝不能退化成空 registry。

Catalog synchronizer 在一个窄小 upgrade seam 后隐藏复杂度：编译 release、暂存 stable root、完整 subject/alias membership 与 definition，验证 owner 和 predecessor completeness，再原子推进 Definition head 与 current-release pointer。调用方不得自行协调 subject creation、membership row、revision cutover、alias、tombstone 或 cache invalidation。精确 module interface 与 transaction ownership 仍由 [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673) 决定；本 ADR 不启动该票。

### 5. Synchronization 必须显式、幂等并失败关闭

Synchronization 是持有 catalog 排他锁的一次性维护操作。任何 catalog 写入前，验证必须证明：

- release version 与 aggregate digest 尚未使用，或已对应逐字节等价的 normalized content；
- predecessor 与所有需要跨越的 skipped-release transition，从 installed digest 起构成受支持且无缺口的 lineage；
- 所有 manifest file、reference、逐文件 digest、schema、稳定 opaque ID、永久自然键、完整 definition snapshot、alias、lifecycle transition 和 tombstone 均有效；
- predecessor 的每个 subject/stable alias 在 target release 中恰有一个 membership；新 root 恰有一个 first membership；active row 不带 tombstone、retired row 恰带一个；每个 release alias membership 与其永久 alias owner 和 release subject membership 指向同一 subject；alias 只有在所属 subject membership active 时才可 active；
- 每个发生变化的持久化 definition snapshot（包括 documentation-only）恰好映射一个新 DefinitionRevision，未变化 snapshot 不创建 revision；
- 被引用或受支持 replay 所需的每个历史 release/snapshot 都存在且 digest 有效。

验证通过后：

- expected digest 已等于 verified current digest 时，只做只读 verification 并 no-op；
- fresh database 必须使用显式 bootstrap mode；
- installed release 只有在声明为 target 的受支持祖先时才能前进；目标制品必须携带跨越所有受支持跳过版本所需的完整 lineage；
- release row、新 stable subject/alias root、完整 subject/alias membership row、definition、所需的精确 revision、selector/tombstone provenance 与 materialization fingerprint 一起 staged 并校验；Definition head 与 `catalog_state.current_catalog_release_id` 在同一原子领域事务中切换；任何错误都保持上一 pointer 与所有既有 Definition head 不变，数据库中不存在可见的部分 candidate catalog；
- stable key 与 content digest 保证重试幂等；成功后重跑同一 transition 是 verified no-op，失败后重试只会提交一次完整目标或重复同一拒绝，绝不制造重复 revision；
- source 缺失或畸形必须在任何数据库写入前失败；
- subject/alias membership 缺失、多出、重复或被改，stable owner 不一致或被改绑，lifecycle/tombstone 配对非法，Definition/release 不一致，数据库出现意外行，installed digest 未知或 release 不在声明 lineage 中，均属于 **catalog drift**；upgrade 必须停止，synchronizer 不得静默覆盖、推断或删除。

缺失绝不能解释为空 catalog 或隐式删除。物化只能依据 release 声明的新增、successor revision、alias、lifecycle transition 和显式 tombstone 变化。失败 attempt evidence 与可信审计可以在失败领域事务之外持久记录，但不能呈现成部分发布的 release。

### 6. Upgrade synchronization 与 verification 必须先于应用进程启动

自托管安装和升级顺序如下：

1. 构建目标制品并离线验证其 Catalog Release；
2. 停止流量、暂停队列，创建并验证 recovery point；
3. 启动 data plane；
4. 以一次性候选操作运行数据库 migration；
5. 以单独的一次性候选操作运行 catalog synchronization；
6. 运行独立 catalog synchronization verification；
7. 只有成功后才启动 API、worker 与 web；
8. readiness 必须证明各进程期望 digest 等于数据库 verified current digest，随后才恢复队列和公开流量。

普通进程 restart 只做验证。API 和 worker startup 永不迁移或同步 catalog。若进程打包的 digest 与 verified current digest 不同，进程必须退出或保持 not-ready，而不是自行修复数据库。

独立 synchronization verification 必须通过与 writer 不同的只读路径重新编译 manifest，并重新计算数据库 fingerprint。它逐项比较 target release 的稳定 subject/alias owner、`catalog_release_subjects` 与 `catalog_release_subject_aliases` key set、lifecycle、selector provenance、tombstone presence/digest、Definition revision/head 与 aggregate digest 是否等于数据库 projection。它还要证明 predecessor membership 完整、拒绝 projection 多余行、singleton pointer 指向该完整 verified release、documentation-only revision 未改变 Binding/ProjectValue cutover 状态，并能从 pointer-anchored projection 构建 runtime cache；同时证明不存在 organization-owned catalog object。Project binding、HTTP、浏览器、可观测性、自托管端到端和最终 legacy 删除验收仍由 [Choose verification, upgrade, and legacy-retirement gates](https://github.com/tzrea1-Q/WiseEff/issues/679) 决定。

### 7. 失败、回滚和历史永不改写发布真相

Current pointer 切换前，synchronization 失败会留下零项 catalog 领域变化，并保持上一 verified release 为 current。切换后、public traffic 或 candidate business write 之前，只有独立验证证明上一 snapshot 完整、数据库迁移仍兼容且没有 candidate write，operator 才能切回；否则恢复已记录的 recovery point。允许的 switch-back 必须原子恢复上一完整 projection 的 `catalog_state.current_catalog_release_id` 与记录的 Definition head，绝不修改不可变 subject/alias membership 或 tombstone provenance。一旦发生 candidate business write 或 public traffic，禁止 pointer-only 或 head-only rollback。Operational data recovery 由 [Choose populated-data cutover, archive, and rollback strategy](https://github.com/tzrea1-Q/WiseEff/issues/678) 决定。

业务层 catalog rollback 必须是新的 forward Catalog Release。它可以恢复旧 release 的内容，但拥有新的 version 与 digest。失败 release、materialization attempt 与 audit 不删除。

历史业务值固定其精确 DefinitionRevision；ingest、matching、alias resolution 和治理证据还要记录产生该决策的 Catalog Release digest。重放已是 current 的 digest 只执行 verified no-op。Historical replay 直接读取 pinned release 的 `catalog_release_subjects` 与 `catalog_release_subject_aliases` 来解析 subject lifecycle/alias，并绕过 `catalog_state`；首次发布前 membership 缺失表示尚未发布。保留的旧 release 可以确定性物化到全新或隔离的只读 replay projection，或按 digest 加载其不可变 normalized snapshot；它绝不能把生产 current pointer 向后推进。当前 alias、lifecycle、documentation 或 revision 不得重解释历史。生产 replay 不能只依赖 Git history 或网络下载。所需历史 release 或 membership 缺失、不属于其记录 lineage 或 digest 不符时，replay 必须失败关闭。

### 8. 稳态下 organization structural write 无法表达

目标模型在所有可写层移除 organization-authored schema 或 definition override：

- catalog relational model 不包含 structural definition 的 organization owner 或 scope；
- catalog module interface 不提供 organization structural mutation；
- HTTP、Agent、review-apply、coverage-claim、script 和后台路径不能创建 organization catalog object；
- legacy overlay 与 organization-definition 关系对生产角色只读，并在数据库层拒绝新写；
- 只有维护窗口中的专用 migration principal 可以分类、映射或归档 legacy row，并产生持久审计；
- synchronization verification 要求切换边界后 organization structural row 零新增，runtime cache identity 不再包含 organization key、overlay digest 或 precedence rule。

Organization 可以提交 observation、review evidence 或 repository change proposal，但不能发布 schema。精确 route 退役响应与兼容窗口由 [Choose the parameter API and legacy-identifier transition](https://github.com/tzrea1-Q/WiseEff/issues/677) 决定。

## 必需验证场景

实现规格必须至少自动化以下场景；涉及数据库状态时使用真实 PostgreSQL。每个失败断言都要同时检查 current Catalog Release pointer 和所有 Definition head 未发生变化。

| 范围              | 必需场景与预期结果                                                                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发布权威          | 接受 Proposal 只写 publication intent 与可信审计；CatalogSubject、ParameterDefinition、DefinitionRevision 及 release head 的行数和 pointer 均不变化，proposal role 无权修改它们。                                                         |
| Manifest 编译     | 同一 manifest 不受枚举顺序影响，编译为相同 stable root、完整 subject/alias membership、Definition snapshot 与 aggregate digest；active/retired membership 带有规定的 null/non-null tombstone provenance。                                 |
| Release 校验      | 文件缺失/未列出、文件或 aggregate digest 错误、身份重复、稳定 ID/自然键改绑、alias owner 不一致、非法 lifecycle/tombstone transition、predecessor subject/alias 省略及 lineage 缺口都在 catalog 写入前失败。                              |
| Revision 完整性   | 每个持久化 definition 内容差异（包括 documentation）恰好创建一个不可变 DefinitionRevision，并只推进对应 Definition head；未变化 definition 不建 revision。                                                                                |
| 纯文档变化        | Documentation-only revision 推进 Definition head，但 Binding 的 ID/数量、`effective_revision_id`、current ProjectValue 和全部历史 ProjectValue 逐字节不变。                                                                               |
| 幂等性            | 重跑已验证 current digest 是只读 no-op；重试失败的已知 transition 不创建重复项，只会提交一次完整目标或重复同一拒绝。                                                                                                                      |
| 失败原子性        | 在任意 release component staged 后、提交前注入失败，不得看见 candidate root/membership/definition/revision；`catalog_state`、既有 release projection 与全部 Definition head 不变。                                                        |
| 当前 lifecycle    | active-to-retired pointer switch 后阻止当前 matching/registration；当前 alias lookup 要求 alias 与 subject membership 均 active；绑定到一次 captured pointer 的并发 reader 只看到完整旧或新 release。                                     |
| 漂移              | membership 缺失/多出/被改、alias owner 不一致、tombstone provenance 错误、未知 installed digest、意外 catalog 行或 compiled-release/database fingerprint 不一致会阻止同步和启动，不自动修复、不降级为空 catalog。                         |
| 退役与恢复        | 省略 predecessor subject/alias 必须失败；显式 retired membership 停止新匹配但保留 stable root/history；后续 active membership 使用同一 subject ID、canonical key 与 alias owner 恢复。                                                    |
| 历史重放          | Replay 读取 pinned release 的 subject/alias membership 而不连接 `catalog_state`，在后续 retire/restore 后仍复现原 release；所需历史缺失或 digest 无效时失败关闭。                                                                         |
| 回滚              | Pre-traffic switch-back 仅在零 candidate write 且既有状态经验证兼容时成功；它原子恢复上一 release pointer 与记录的 Definition head 且不修改 membership；发生 write/traffic 后必须拒绝，改走新 forward release 或 recovery-point restore。 |
| Upgrade/readiness | API、worker、web 只有在 one-shot synchronization 与独立 verification 通过后才启动；普通 restart 只验证 digest equality，永不自行同步。                                                                                                    |
| 禁止 overlay      | HTTP、Agent、review、coverage、script、background 与普通数据库 role 均不能创建 organization structural definition/overlay；cutover 边界后此类行零新增，cache key 不含组织 precedence 输入。                                               |

## 评估过的方案

- **让 PostgreSQL 或 Platform Admin UI 编写 catalog。** 拒绝：它会创建第二结构真相，丢失仓库评审和确定的自托管来源，并允许实例之间漂移。
- **保留 lazy ingest materialization，并在运行时补缺行。** 拒绝：未触达 schema 会逃过数据库验证，流量可能看到部分状态，暖缓存也可能与存储历史不一致。
- **把目录缺失视为删除。** 拒绝：打包错误会静默清空或缩小 effective catalog；退休必须是显式评审动作。
- **历史重放时应用当前 alias。** 拒绝：这会改变旧 observation 当时看到的身份判断。
- **以较低优先级保留 organization overlay。** 拒绝：只要还存在 precedence，就仍有两个结构真相来源，组织定义也仍可写。
- **公开流量后回拨 current pointer。** 拒绝：当前业务写可能已经依赖 successor revision 或 selector 语义；恢复必须同时保持数据和 catalog 一致。

## 影响

### G0.1 compiler identity 补充

Bundle publication、compilation 与 synchronization 必须消费 ADR-0040 和 active #668 规格定义的三个 S0-ID canonical constructors；manifest 不能提供第二套 normalization algorithm。Compiled bytes 保留接受后的原始 ASCII 值，非法 whitespace、quoting、Unicode、wildcard、unit-address、property shape 或 structural property 必须在任何数据库写入前拒绝。`DriverNature` 与 `DriverInstanceCardinality` 只能使用各自两个封闭值；NodeType 不携带 family。Canonical/alias selector collision 在完整 release 与 lineage 上按 accepted exact bytes + selector kind 检查，并覆盖并发 publication attempt。

- 目标模型取代 ADR-0008 与 ADR-0009 的 organization-overlay 发布模型。在有界 cutover 真正移除旧路径前，这两份 ADR 仍描述 legacy runtime 行为；本决策不是提前删除或绕过迁移证据的授权。
- ADR-0011 的 soft-deprecation 安全性继续保留，explicit retirement 成为另一种保留历史但退出 forward matching 的动作。
- ADR-0040 取代对 ADR-0032 的任何“documentation 可原地修改”解释：documentation 变化要创建 DefinitionRevision 并推进 Definition head，但不制造 Binding 或 ProjectValue cutover。
- Catalog compilation、materialization、current-pointer selection 与 cache construction 进入一个 deep module，不再由 ingest、startup、script 和 overlay service 重复协调。
- 实现必须替换当前 silent loader fallback、lazy materialization、per-organization registry composition、API-start migration 与启动后的 database-only catalog check。本 ADR 不包含代码或 migration 实现。
