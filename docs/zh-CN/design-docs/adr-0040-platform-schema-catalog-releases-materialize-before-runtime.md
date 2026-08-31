# ADR-0040：平台 Schema Catalog Release 必须在运行时启动前完成物化

> English: [English decision record](../../adr/0040-platform-schema-catalog-releases-materialize-before-runtime.md)

日期：2026-08-31

## 状态

已由 [Choose platform schema publication and synchronization semantics](https://github.com/tzrea1-Q/WiseEff/issues/674) 接受；该票属于 [Wayfinder: replace the parameter catalog with one canonical definition model](https://github.com/tzrea1-Q/WiseEff/issues/668)。本 ADR 描述目标语义，不表示现有 loader、数据库、缓存或 upgrade 路径已经完成实现。

## 背景

已批准的目标只有一个结构真相来源：Platform schema catalog。组织可以注册和放置正式 Driver、NodeType 主体，但不能编写、复制、覆盖或私有重定义 schema。运行时 observation 只是证据，不能创建 definition。

当前实现不满足这一合同。`schemas/dts/catalog.json` 虽然列出 YAML 输入，但内容 hash 不一致不会停止加载，缺失的 common reference 也会被忽略。数据库行随项目 ingest 惰性物化，未被业务触达的 schema 可能不在数据库里。进程缓存把固定文件与 Platform/organization overlay 合成。自托管 upgrade 先启动 API、由 API 执行 migration，之后才检查 PostgreSQL 中已有的 catalog 形状；该检查既不读取仓库 catalog，也不能证明数据库是其完整物化。[Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) 及其[仓库研究记录](https://github.com/tzrea1-Q/WiseEff/blob/f982c76a063f3c8bc0a7366d5253243ecba2866f/docs/references/parameter-catalog-contract-inventory.md)已经列出这些事实。

我们需要一条单一发布谱系，让 YAML、数据库行、缓存、upgrade 顺序、回滚和历史重放保持一致，同时不让任何派生副本成为第二权威。

## 决策

### 1. 唯一权威输入是一个不可变 Catalog Release bundle

**Platform Schema Catalog Release** 是唯一权威发布输入。它是经仓库评审、随目标应用制品交付的 bundle。manifest 根保持为 `schemas/dts/catalog.json`，除非后续实现计划只改变物理格式。bundle 必须包含或标识：

- 单调排序的 catalog release version 及其 predecessor release digest；
- 本次发布的精确 YAML 文档及逐文件内容 digest；
- 验证文档所需的 schema 与工具链来源；
- 显式 selector alias、deprecation、retirement 与 tombstone；
- 根据规范化 release model 计算的唯一 canonical aggregate digest。

只有 manifest 列出的内容具备权威性。目录扫描、未列出的文件、数据库内容、运行时缓存、远程热下载、产品表单和组织数据都不是 catalog 输入。数据库或产品工作流可以保存 review evidence 或仓库变更 proposal，但不能发布结构真相。即使是紧急修正，也必须通过同一治理路径发布新的 Catalog Release。

CI 必须在发布前失败关闭：缺文件或引用、digest 不一致、schema 形状错误、正式身份重复、规范化结果不确定、alias 冲突或非法生命周期迁移都必须阻断。文件系统枚举顺序不得改变 release aggregate digest。

### 2. Catalog Release 与 Definition Revision 使用不同版本时钟

bundle 的任何变化都要发布新的不可变 Catalog Release，包括文档、alias、deprecation 和 retirement metadata。已发布的 release version 或 digest 永不重写。

正式 definition 的语义或匹配变化会铸造新的不可变 **Parameter Definition Revision**，包括 value shape、constraints、units、schema default、canonical selector 行为，或任何会改变识别/解释的内容。纯文档修正会发布新的 Catalog Release，但不会强制创建新的语义 revision 或 binding cutover；不可变 release 仍保留发布时的文档快照。生命周期和 alias 变化属于 release metadata，不重写已固定的 definition revision。

稳定 definition identity 仍是 Wayfinder map 已锁定的“typed formal subject + property key”。opaque id 的精确表示和关系型 current-revision 约束由 [Choose the canonical parameter-catalog relational model](https://github.com/tzrea1-Q/WiseEff/issues/672) 决定。

### 3. Alias 是 selector alias，不是另一个身份

Catalog alias 把外部主体 selector（例如旧 `compatible`、nodename 或供应商标识）直接映射到一个 canonical Driver 或 NodeType subject。它不创建第二个 subject 或 definition。解析只允许一跳；禁止 alias chain、cycle、歧义目标、与 canonical selector 冲突，以及把已发布 alias 复用于另一主体。

这里的 alias 不包含 `property_key` alias，也不包含 DTS source-write `targetRef`。带引用的 property-key 修改继续走 ADR-0034 的 source-rewriting cutover；不能用长期 alias 掩盖项目源文件是否真正迁移。

Deprecated 与 retired 必须区分：

- **Deprecated** 是软警告状态。definition 仍可匹配和重放，使已有及新观察到的源不会突然失去 parse coverage，但会离开默认治理选择并指向 successor。
- **Retired** 显式让 selector 或 definition 退出当前匹配；已有 binding、revision、audit 和 replay 仍可通过固定历史访问。

后续 manifest 省略条目永远不代表退休。退出必须发布显式 tombstone，并在 release lineage 中永久保留。

### 4. 派生状态只允许单向来源

目标谱系为：

```text
Catalog Release bundle
  -> canonical compiled model
  -> database materialization
  -> verified current-release pointer
  -> runtime cache
```

PostgreSQL 是可查询物化结果，不是 authoring source。Runtime cache 是某一个已验证数据库物化的可丢弃不可变快照，使用精确 Catalog Release digest 作为 key。业务流量期间不再独立解析 YAML，也不再合成 Platform 或 organization overlay。缓存缺失可以重建；物化缺失或未验证时绝不能退化成空 registry。

Catalog synchronizer 在一个窄小 upgrade seam 后隐藏复杂度：编译 release、暂存完整物化、验证，并原子切换 current-release pointer。调用方不得自行协调 subject creation、row upsert、revision cutover、alias、tombstone 或 cache invalidation。精确 module interface 与 transaction ownership 由 [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673) 决定。

### 5. Synchronization 必须显式、幂等并失败关闭

Synchronization 是持有 catalog 排他锁的一次性维护操作：

- expected digest 已等于 verified current digest 时，只做只读 verification 并 no-op；
- fresh database 必须使用显式 bootstrap mode；
- installed release 只有在声明为 target 的受支持祖先时才能前进；目标制品必须携带跨越所有受支持跳过版本所需的完整 lineage；
- staging 与 current-pointer switch 都必须幂等；同一已知迁移重试产生相同物化与 digest；
- source 缺失或畸形必须在任何数据库写入前失败；
- 数据库出现意外行、物化内容被改、installed digest 未知或 release 不在声明 lineage 中，均属于 **catalog drift**；upgrade 必须停止，synchronizer 不得静默覆盖、推断或删除。

缺失永远不能解释为空 catalog 或隐式删除。物化只能通过 release 声明的新增、successor revision、alias、lifecycle transition 与显式 tombstone 变化。

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

本 ADR 的 synchronization verification 要证明：bundle 和 lineage 有效；每个发布对象恰好物化一次；materialization fingerprint 等于 canonical compiled model；alias 与 tombstone 一致；current pointer 指向完整且已验证的 release；不存在 organization-owned catalog object；runtime cache 可从该 release 构建。Project binding、HTTP、浏览器、可观测性、自托管端到端和 legacy 删除验收仍由 [Choose verification, upgrade, and legacy-retirement gates](https://github.com/tzrea1-Q/WiseEff/issues/679) 决定。

### 7. 失败、回滚和历史永不改写发布真相

Current pointer 切换前 staging transaction 失败时，前一个 verified release 保持 current。Pointer 已切换但尚未公开流量或产生候选写入时，只有 verification 证明旧 snapshot 仍兼容且没有候选写入，才允许受控切回；否则必须恢复已记录 recovery point。一旦发生候选业务写入或公开流量，禁止只回拨 pointer。运行数据恢复服从 [Choose populated-data cutover, archive, and rollback strategy](https://github.com/tzrea1-Q/WiseEff/issues/678)。

业务层 catalog rollback 必须是新的 forward Catalog Release。它可以恢复旧 release 的内容，但拥有新的 version 与 digest。失败 release、materialization attempt 与 audit 不删除。

历史业务值固定其精确 Parameter Definition Revision；ingest、matching、alias resolution 和治理证据还要记录产生该决策的 Catalog Release digest。Replay 按 digest 加载不可变 release 或 normalized snapshot；当前 alias、lifecycle 或 revision 不得重解释历史。生产 replay 不能只依赖 Git history 或网络下载。所需历史 release 缺失或 digest 不符时，replay 必须失败关闭。

### 8. 稳态下 organization structural write 无法表达

目标模型在所有可写层移除 organization-authored schema 或 definition override：

- catalog relational model 不包含 structural definition 的 organization owner 或 scope；
- catalog module interface 不提供 organization structural mutation；
- HTTP、Agent、review-apply、coverage-claim、script 和后台路径不能创建 organization catalog object；
- legacy overlay 与 organization-definition 关系对生产角色只读，并在数据库层拒绝新写；
- 只有维护窗口中的专用 migration principal 可以分类、映射或归档 legacy row，并产生持久审计；
- synchronization verification 要求切换边界后 organization structural row 零新增，runtime cache identity 不再包含 organization key、overlay digest 或 precedence rule。

Organization 可以提交 observation、review evidence 或 repository change proposal，但不能发布 schema。精确 route 退役响应与兼容窗口由 [Choose the parameter API and legacy-identifier transition](https://github.com/tzrea1-Q/WiseEff/issues/677) 决定。

## 评估过的方案

- **让 PostgreSQL 或 Platform Admin UI 编写 catalog。** 拒绝：它会创建第二结构真相，丢失仓库评审和确定的自托管来源，并允许实例之间漂移。
- **保留 lazy ingest materialization，并在运行时补缺行。** 拒绝：未触达 schema 会逃过数据库验证，流量可能看到部分状态，暖缓存也可能与存储历史不一致。
- **把目录缺失视为删除。** 拒绝：打包错误会静默清空或缩小 effective catalog；退休必须是显式评审动作。
- **历史重放时应用当前 alias。** 拒绝：这会改变旧 observation 当时看到的身份判断。
- **以较低优先级保留 organization overlay。** 拒绝：只要还存在 precedence，就仍有两个结构真相来源，组织定义也仍可写。
- **公开流量后回拨 current pointer。** 拒绝：当前业务写可能已经依赖 successor revision 或 selector 语义；恢复必须同时保持数据和 catalog 一致。

## 影响

- 目标模型取代 ADR-0008 与 ADR-0009 的 organization-overlay 发布模型。在有界 cutover 真正移除旧路径前，这两份 ADR 仍描述 legacy runtime 行为；本决策不是提前删除或绕过迁移证据的授权。
- ADR-0011 的 soft-deprecation 安全性继续保留，explicit retirement 成为另一种保留历史但退出 forward matching 的动作。
- ADR-0032 的 semantic-successor 规则保持不变：文档变化记录为新 Catalog Release，不制造语义 binding cutover。
- Catalog compilation、materialization、current-pointer selection 与 cache construction 进入一个 deep module，不再由 ingest、startup、script 和 overlay service 重复协调。
- 实现必须替换当前 silent loader fallback、lazy materialization、per-organization registry composition、API-start migration 与启动后的 database-only catalog check。本 ADR 不包含代码或 migration 实现。
