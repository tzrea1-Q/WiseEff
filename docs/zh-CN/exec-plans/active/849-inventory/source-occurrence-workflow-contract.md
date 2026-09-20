# T1.1 来源工作流契约

> English: [English](../../../../exec-plans/active/849-inventory/source-occurrence-workflow-contract.md)

本文件是设计候选，不是实现证据。与[威胁矩阵](source-occurrence-threat-matrix.md)及 ADR-0046 用户确认的补充决策共同使用，约定 schema 与工作流共享的源模块接口。

## 来源身份与入口

Occurrence 标识不可变文件和配置集中的 DTS 节点或 JSON 配置实例根，不把 revision 作为身份。精确参数定位与其分开：DTS property occurrence/CST span，或从文档根开始的绝对转义 JSON Pointer。实例根和参数 Pointer 都使用文档坐标；包含关系按解码后的 token 数组前缀判断（允许相等），不能拼接编码字符串或比较字符串前缀。逐 token 解码再以 `~0`/`~1` 编码得到规范 Pointer，保留空 token。Definition 映射必须明确受审，不能从显示名称、点号拆分或文件名猜测。

JSON 导入向既有 parameter-files candidate 所有者提供正式 ConfigurationSchema 标识、根 Pointer 和明确的 Definition→Pointer 映射。服务端验证已发布 pin 的主体、活动 registration/placement、Definition 归属、文件／配置集及所有 Pointer。只在获授权的持久化推进时分配 opaque 实例身份，并仅按已确认的不可变归属复用。Candidate 不移动当前文件／值指针；未知 Definition／未决映射保持 blocker/observation，不自动建定义。

DTS 解析与连续性仍归 parameter-topology；使用历史版本 ID、精确 property occurrence、CST span/checksum 及受治定义映射。Canonical 来源适配消费这些事实，不另建 DTS parser，也不通过 legacy Binding/value 所有者修改当前数据。本项不提前删除 TD-125 保留的旧读取。

此来源流程仅接受 DTS 和严格 JSON。YAML、TOML、ENV 在创建 candidate、活动 occurrence、Binding 或 ProjectValue 前拒绝；原生负例检查没有活动身份持久化或当前指针变化。

## 最小源模块接口

parameter-files 向 canonical 工作流提供两项操作，接收已有 Database/ObjectStore/trusted invocation：

1. **准备精确 pin 的源改动**：解析获授权的 canonical Binding 与不可变来源 pin，按 file-version 有界读取字节，验证大小／digest／UTF-8，严格定位并仅修改目标值，重解析校验目标和非目标语义。复用现有 file-candidate 所有者持久化服务端对象，返回 opaque candidate ID、基底／候选 digest 及可审阅 diff，不移动当前指针。提交时在不可变请求中冻结 candidate ID、基底／候选字节 digest、diff digest 和完整基底 pin。被已提交请求引用的 candidate 对象／基底字段不可变；编辑必须生成新 candidate 并重新提交。
2. **提交已批准的源改动**：在调用方审计事务内重验权限／来源，仅加载已提交请求引用的服务端 candidate，检查字节／digest、冻结 locator、diff digest 及全部基底 pin。审批不能替换客户端字节、candidate ID 或 locator。使用共享 `commitCanonicalSourceRevision` 边界加锁和比较全部冻结成员，写入不可变文件／配置版本与来源 pin，CAS 当前指针，整体提交工作流／历史／审计。返回精确新 pin；必需源不得返回 `skipped:true`。

命名遵循邻近模块；这是具体所有权操作，不是第二套通用 repository 抽象。复用文件版本插入、对象存储、配置版本／成员持久化、canonical append/history、可信审计和 DTS CST patch。禁止降级到最新版本、绕过事务用 pool 读取、内存对象替代或伪造 storage key。

原子提交包括验证后的文件对象、不可变 file-version/config-revision/member 行，以及每个受影响 Binding 的新不可变 ProjectValue/source pin；随后分别 CAS Binding 当前值，写入不可变有序请求批次结果／历史／共享生效审计。文件与 Binding CAS 必须在同一事务；仅源或仅值成功都不算成功。

覆盖所有 canonical-backed 文件的 `current_version_id` writer，不只审批路由。当前清单：`parameter-files/repository.ts:setCurrentVersion` 及其上传／回滚（`service.ts`）、candidate 激活（`candidateService.ts`）、baseline 回滚（`baselineService.ts`）、通用写回（`writebackService.ts`）调用者；`parameter-topology/overlayWriteback.ts` 的两处直接更新；canonical 导入／生效。`catalog-cutover/mapping/persist.ts` 修改的是 legacy mapping head，并非源文件指针；`parameter-files/configSetRepository.ts` 的成员移动／清空也必须保护被引用的文件身份。相关指针路径必须进入共享排序锁／CAS 边界，或在修改前明确拒绝 canonical-backed 文件；本步不迁移无关 legacy 消费者。原生测试及最终 writer 搜索须证明没有遗漏的直接更新，新增 canonical 来源不能静默启用旧 writer。

对象可能在回滚后保留；失败时只用于孤立对象／恢复诊断，不算生效结果或删除授权。对象缺失／digest 错误阻止 preview/apply。change-request ID 是幂等键：只能从 pending 转 approved 一次，保存不可变有序批次结果，包含 target 与 sibling-derived 的 value/pin/version/revision/history ID 及共享 audit。目标事件的唯一请求键防止第二次批次生效。不确定提交先鉴权并重读结果；重放不增加版本／值／历史／生效审计。拒绝／尝试审计与生效事件分开。

writer 清单还包含值侧：`parameter-bindings/values/service.ts` append、`values/repositories.ts:casCurrentTip`，其 protected-reference adapter、同步／导入调用者及所有直接 Binding-tip 更新。底层 helper 可在受控源事务**内部**复用，不能单独成为只改值的生效入口；来源绑定调用若脱离该单元须拒绝。延迟 pin/current-tip 约束是数据库兜底，不能替代源提交。初始物化保留已有、单独获授权的 source/import 所有者，但同样必须原子建立真实源 revision 和 pin，不能作为后续编辑的旁路。Placeholder 只允许在该原子初始化事务内短暂存在，不能单独成功成为当前值。原生测试须覆盖直接 append/CAS 绕过及文件指针 writer。

## 冻结工作流与并发

- 草稿冻结 Binding/Definition/release/current-value 以及 occurrence/file/version/config-revision/property locator，保持原始类型，不将 JSON 强转为 `DtsValue`。
- 草稿创建／编辑／删除只改 pending。提交冻结目标和完整源 diff；提交后修改需重新提交，评审不能静默刷新过期 diff。
- 保留现有项目级权限与提交者／评审者分离。首次生效和重放都先鉴权，已批准快捷路径也不能泄漏给失权用户。DTS 敏感节点检查使用精确 pin，不读取最新节点 revision；JSON 不进入设备 overlay。
- 审批／生效继续是既有单次原子动作，但必须加入真实写回。驳回／撤回不改源或当前值；缺源／ObjectStore 必须报错，不能只改值称成功。
- `commitCanonicalSourceRevision` 是 canonical apply 及影响 canonical-backed 来源的 candidate/import 激活共用的当前源版本写入边界。所有相关入口使用其事务／锁协议；尚未接入的 candidate/legacy 激活须拒绝 canonical-backed 来源，不能单独推进指针。依次锁定全部涉及配置集 ID、全部成员文件 ID、全部 Binding ID、全部请求 ID，各组按字典序，不能颠倒。比较**每个**成员冻结的 `(config_set_id, file_id, current_version_id)`、revision/member ID 与成员集合、Binding 当前值／Definition/release、请求状态／candidate ID 及基底／候选／diff digest。配置集没有单独的 current-revision 指针，读取最新 revision 不能替代 CAS；比较和指针更新须同事务。无关成员并发修改也冲突，不能用旧快照覆盖。两个同基底请求最多一个成功，另一个重新准备／评审；反向多配置集请求测试全局锁顺序。
- 新 revision 保留未改成员版本 ID，仅替换目标成员；文件名只是元数据，定位使用不可变 ID。JSON-only 使用共享 revision/member 存储但不调用 DTS parser/toolchain；混合集完整保留成员，DTS 所有者只解析 DTS 文件。
- 同一源提交还必须推进受影响配置集内所有既有 source-backed 同级 Binding，包括未改文件上的 Binding。在相同排序锁内，证明 occurrence 与精确 locator 不变且非目标业务值类型／内容完全相同；为每个同级 Binding 追加同值 ProjectValue 和新不可变来源 pin，并 CAS 当前值。每个配置集只创建一个完整新 revision。locator 消失、身份变化或同级值意外变化均整体回滚，不能自动创建或转移 Binding 来补救。旧草稿／请求保持不变但转为过期，须重新准备／评审。整批只有一次用户批准和一次生效审计，各 Binding 历史引用该审计；同级历史明确标记来源版本传播，不算另一笔用户编辑。请求保存有序完整批次结果，重放不再次追加。成员增删及没有自身 occurrence 的成员变更也须进入同一边界，否则拒绝。
- 既有 import-batch apply 改为准备 canonical 草稿／评审工作并返回真实 staged 数，不直接追加当前值或调用 legacy writer。整批校验后单事务暂存；歧义或 candidate 失败不能留下部分草稿／请求或 applied 批次状态，孤立 pending 对象只算诊断。先解出精确 Binding/Definition。Staged 不等于源已生效；只有通过共享 writer 的审批才能推进源，驳回／撤回行不计入 applied。
- 外部重导入时，数值索引实例根不能证明数组重排后的连续性。包围数组结构／顺序变化须显式新实例映射，不能默默复用索引身份；已批准的精确 pin 标量修改本身不移动实例。

## 已批准 DTS 修改的连续性

已批准 DTS 修改的 logical continuity 只使用提交时锁定的基础 revision，不选择最新解析 revision，也不伪造 reviewed mapping。准备和生效时均证明旧 pin 指向唯一最终生效的属性 effect，非目标 CST 语义及非目标成员字节摘要不变，目标成员修改前／后的字节分别匹配冻结的基础／提议摘要。DTS owner 核对完整节点集合的 locator、name、unit address、compatible、reg 与父身份；任何节点新增、删除或元数据变化均拒绝。只有通过此证明才能保留既有 logical ID。新 revision 使用新 property/node occurrence ID 和重新解析的来源 pin；“同一 locator”指语义目标不变，不代表复用旧 occurrence ID 或偏移。通用外部导入身份匹配规则保持不变。

## 重开的来源值证明设计

设计状态：下文具体修订于 2026-09-17 获得独立 Spec 与 Standards 设计 PASS。以下冻结／提案文字保留获批前门禁记录；实施必须遵守具体修订，不表示实现验收通过。

第二轮 P1 修复触发 R3 设计门禁重开。独立 Spec 与 Standards 评审批准本节及其威胁用例前，迁移适配器和 Definition 替换的生产修改保持冻结。此前实现／测试结果不批准本提案。

**权威证明，不是调用方互相认同。** 调用方 payload 和持久化的 `dts_property_occurrences.raw_text` 单独都不构成来源值证明。0151 不可变触发器仅在属性已有 source pin 引用后保护该行，尚无 pin 的替换目标仍可能与对象字节不一致。两个调用方都必须从精确、限长的不可变 file-version 对象推导值，并交叉核验 occurrence/CST。缺失存储必须拒绝，不降级为只查数据库。

**具体所属模块接口。** 复用 `parameter-files/canonicalSource.ts:loadCanonicalSourceSnapshot` 中限长读取、SHA-256／大小和严格 UTF-8 核验，形成 parameter-files 所属的精确 file-version 读取操作。从传入事务解析存储元数据并验证组织／项目／config-set／file／version；调用方不得以自带 storage key、checksum 或源码充当权威证明。原 snapshot loader 与新建 pin 前的证明复用此实现。parameter-topology 提供精确 DTS 属性证明，接收同一事务、ObjectStore 和显式组织／项目／config-set／revision／logical-node／file／version／property 元组；验证唯一精确 member 和冻结别名、resolved 且归属一致的 revision、匹配的 property/node、唯一最终 set/override effect（先纳入 delete 和相同顺序冲突，再选最终结果）。使用现有 DTS parser 重新解析已核验字节，匹配属性名／span／raw text 及所在节点 span／身份，返回既有无损 `DtsValue` 和精确身份／对象 digest。不新增解析器、通用 query 包装或伪造 canonical pin。Binding/value 所属模块复用 `dtsValueToPayload`、`serializeContract`、`digestProjectValuePayload` 做完整类型值比较和持久化。

**事务与稳定性。** 使用调用方事务，不在核验和写入之间通过 pool 另读。所有受影响项目先按字典序锁 config-set，再按序锁 member file，最后按序锁 canonical Binding，再执行迁移／替换变更。精确 revision 及相关 member/node/property/effect 行锁保持至提交；除更新外，借助 revision 父行锁及外键锁契约防止新增冲突 effect/member。取得锁后重新读取最终 effect／身份。评审必须证明所有相关写入者参与锁协议或被锁阻挡；未证明的写入者／幻读路径是设计阻断，不能假设不可变。preview 与 apply 均限长读并验 checksum；本操作绝不覆盖源对象。事务内继续核验真实 legacy 行并保留 Binding ID。

**Legacy 映射。** `command.source.payload` 仅为待核验声明。创建 Binding/value/pin 前，将其完整类型 payload 与服务器推导结果比较；不一致则拒绝，持久化服务器结果。已有身份的 replay 仍须重新证明归属、精确来源和当前值等价，不能绕过核验。本 DTS legacy 接口不支持的 JSON 继续拒绝，不伪造 DTS 身份。真实 ObjectStore 从 adapter 依赖注入，不接收调用方可信标记。

**Definition 替换。** preview 从字节推导精确目标 payload/digest，要求与旧 canonical 类型值／digest 相等，并连同旧 current-value ID、精确 locator/member/object digest 冻结。改名保留来源值，不是业务值编辑。apply 在锁内重复证明，对比全部冻结证据及旧 tip CAS，再创建替换身份／值／pin／历史。来源为 `9`、旧 canonical 为 `5`，或缺失／无法解析字节、digest/span/最终 effect 漂移、tip 过期时，阻断对应项目，不改变其身份／值／pin／历史／retirement；既有 blocked-attempt 记录仍可写入。把应用已有 ObjectStore 从 `server/app.ts` 经 `parameter-catalog-api/productionWire.ts` 传入 `DefinitionReplacementServiceInput`；不可用时拒绝 preview/apply。不修改发布策略和 source-first 属性改名规则。

### 两份 NOT PASS 设计评审后的具体修订

本修订替代上文不够具体的接口／锁说明；两名评审重新审阅前，仍为提案。

1. **建 pin 前读取及无环归属。** 在 `parameter-files/sourceVersion.ts` 增加具体操作 `loadExactSourceRevisionForProof(tx, objectStore, { organizationId, projectId, configSetId, configRevisionId, fileId, fileVersionId })`，Binding/value/pin 尚不存在时也可调用。从同一事务读取精确归属的 revision/member/version 图，要求所选 file/version 唯一，返回完整冻结 manifest 和每个 member 已核验的 bytes、size、checksum、不可变别名及身份。调用方提供的 storage key/checksum/源码/别名均不是权威输入。复用既有限长读取实现，不调用仅支持已建 pin 的 loader。该文件仅依赖 shared DB/errors、ObjectStore 类型、既有大小常量和纯 manifest 规范化，不导入 canonicalSource、sourcePropertyProof、Binding owner 或 topology writer。`parameter-topology/sourcePropertyProof.ts:proveExactDtsProperty(tx, objectStore, exactIdentity)` 调用该操作，`canonicalSource.ts` 也复用 sourceVersion；topology 不反向导入 canonicalSource。无损 payload 转换留在 Binding owner，不新增依赖或通用 storage/proof 接口。
2. **精确 include／overlay 来源。** 加载全部冻结 member，使用既有 `resolveDtsConfigSet` 解析 pinned entry/include-search-path/overlay-order manifest。合法 `&label` 的 ref-path 不一定等于 resolved logical-node 路径。仅按需扩充该 resolver 的 expansion segment/source-chain 元数据，保留不可变 file-version 与原文件 offset，包含 include segment 的 origin offset；不得用路径字符串相等或同名／同 raw 值选择 occurrence。最终 resolved effect 的原始 file/version/property span 必须匹配持久化属性及其所属 CST 节点，resolved node 必须对应所选 logical-node revision。完整有序 target source-chain 与持久化 effect 对照，包含 delete、重复／同序冲突；origin 缺失或变化即拒绝。无法解析／悬空／重复 label、缺失／循环 include、跨 member 属性 span 或歧义 origin 在写入前拒绝。canonical proof 的 ingest 归属复用此精确 origin 映射，不用宽松 name/raw fallback；无关 retained legacy matching 不在本次改动内。保留既有 UTF-16 字符串 offset 单位，不当作 UTF-8 字节 offset。先比较已验 CST 和持久化 raw text 解析后的无损 `DtsValue` 结构，再生成 ProjectValue payload/digest；大 cell、group、数组和非标量不进行有损数字转换。
3. **完整证明的容量边界。** 单 member 保持既有 2 MiB 上限；proof 操作还须在读取前限制最多 128 个 member、存储字节总计 32 MiB。解析在超过 32 MiB 展开后 UTF-8 字节、64 层 include、100,000 个语法／source-chain 访问项或 8 MiB locator/origin 元数据前拒绝。重复 include 每次计入展开预算。明确拒绝，不截断、不省略 member；返回稳定 source-proof-limit 错误，所有指针保持原样。这些上限属于精确 proof 入口，不修改 capability 版本、不增加配置框架。
4. **精确锁序及幻读隔离。** 发现阶段只选择锁目标，不作为证明。同一个 apply 事务按下列层级、每层按 ID 字典序锁定：config-set → member file → file-version → config-revision → revision member → logical node → logical-node revision → node occurrence → property occurrence → effect → legacy Binding → canonical Binding → current ProjectValue/pin → preview → replacement → replacement-project → change request → operation idempotency。覆盖完整相关来源图，不仅目标属性。可能竞争的既有行使用显式 `FOR UPDATE NOWAIT`，锁竞争返回可重试冲突；不得持有后序锁再等待前序锁。取锁后重读完整 member／ID 集合，变化则拒绝，不再补取前序新锁。父 config-set/file/version/revision/logical/node 行锁通过 0048 及后续复合外键阻挡新 child 插入，行锁阻挡已有 child 更新／删除。双连接测试必须验证，包括发现前已经在进行的插入。不新增表锁或宽泛角色授权。
5. **写入者清单与状态阶段。** 相关写入者包括 `ingestService` 经 topology repository 新增 revision/member/node/property/effect 及状态更新、`bindingService` logical remap、file repository／`overlayWriteback`／`editService` 新增 file-version、parameter-drafts repository 的 revision 状态、projects repository 删除 revision，以及 property-key rewrite 调用方激活新 file/config version。既有 canonical source/current-pointer 保护继续有效。写入该图的路径必须同序、命中真实 FK／行锁使 proof NOWAIT 冲突，或拒绝 canonical-backed 变更；不能宣称 config-set 锁本身已串行化全部写入者。实现前后清单及双连接证据须逐路径证明实际机制。preview proof 也必须在事务中。replacement 保留现有 reservation／publication／finalization 分阶段结构：不持来源锁执行 publication／网络操作，不在已持 workflow/idempotency 锁的 reservation 事务中再拿来源锁。apply 重新按上述顺序拿来源锁，再锁定并重验 workflow 状态、精确 manifest/current release，随后证明和变更。不同幂等键的并发 continue 受 replacement/project 行锁约束，completed 项返回已存结果，不再 append/history/applied audit。发布后的来源漂移阻断项目 apply，不伪造已经激活 Catalog 的回滚。
6. **可执行依赖／事务接线。** migration adapter 改为 `mapLegacyBinding(tx: Queryable, objectStore: ObjectStore, command)`；调用方用既有原子 owner 管理 BEGIN/COMMIT/ROLLBACK，不允许 autocommit。暂存写入后的拒绝必须回滚整个单元。应用存储按 `app.ts → registerParameterCatalogApi → createGovernancePorts → createParameterCatalogMigrationService` 传入，service input 必须包含 `objectStore: ObjectStore | undefined` 字段。未配置存储时可保留无关只读路由，但 preview/apply 在来源相关写入前拒绝。所有 integration 调用方／harness 使用真实 local ObjectStore、真实 version 对象及独立期望字节，不以 memory-store 成功、bypass flag 或虚构来源元数据作为证明。两个操作在实际事务中调用同一 topology proof。store 是服务器依赖，不是 command 字段。精确 replay 重新验证既有 Binding/current pin/current value 与同一推导 source digest／类型 payload；不符则拒绝，不 append/history，不重置当前值、不强制 replay。

补充必需 Red：合法 alias overlay/include 的 resolved path 不同、不同节点同名同值、重复 include 和非 ASCII offset、origin 缺失／伪造、每项容量上限、未 pin 的 file-version metadata 更新／新 effect／新 member／alias 修改并发、并发 legacy mapping、不同幂等键的两次 replacement continue。分别证明单次变更后精确 replay，以及冲突请求不能产生第二次变更。既有完整流程和独立来源／值证明要求继续保留。

**必需 Red 用例及证据归属。**

| 反例 | 预期结果 | 原生证据归属 |
| --- | --- | --- |
| 来源 `<5>`、adapter 声明 `0` | 拒绝；不新增 canonical 身份／值／pin／历史 | Binding integration |
| 无 pin 的数据库 raw text 为 `<5>`，精确对象为 `<9>`；错误节点／span；对象缺失、损坏、超限 | 两个路径均拒绝，不仅相信行内容 | 来源所属模块 + 真实本地存储 migration PG |
| 旧 canonical `5`、替换来源 `<9>` | preview 阻断，apply 重验；旧状态仍可读 | Replacement provenance/execute |
| preview 相符，apply 前字节／事实或旧 tip 漂移 | 冲突／阻断，不写替换结果 | Replacement 双连接 PG |
| 最终 effect 为 delete／同序冲突，或并发插入 effect/member | 无歧义证明，不提交割裂的值／pin | 来源所属模块双连接 PG |
| 匹配的字符串、cells／数组、无损非标量 DTS | 类型 payload／digest 相同，来源字节不变 | 来源所属模块 + 两个调用方 |
| 成功后 replay、跨归属、无存储 | 仅授权精确 replay；拒绝不产生 applied 状态 | Binding 与 replacement PG |

旧 adapter 成功用例尝试仅值编辑，不授权重新开放该写入者。先清点真实调用方；保留明确的 `owned-source-commit-required` 拒绝用例，并在真实已批准来源提交接口证明 CAS 一胜一败。不得靠伪造 source-commit 标记使旧夹具通过。

**已评审的生命周期兼容澄清（2026-09-17）。** 两名有界评审均确认共享 source-version reader 不应限定 `resolved`：其他合法生命周期状态下的历史不可变 pin 仍可读取。reader 继续要求完整 manifest／归属／字节证明。建 pin 前的 DTS 操作另行接受 `resolved`、`validated`、`compiled`、`pending_approval`，与既有 continuity baseline 一致；拒绝 draft/resolving/needs-mapping/invalid/validation-failed。首次 JSON registration 保持原 resolved-only 门禁。不由此宣称编译或发布通过。manifest 路径元素类型错误返回 source-proof-invalid；manifest 路径元数据也计入 8 MiB proof 上限。新增 SQL 修订已独立通过 schema contract §2.8 的两份设计评审；0152 正在接受有界实现评审，0151 不变。

**独立边界门禁。** 新 canonical raw SQL 必须归入既有 Binding/value/registration 所属模块的具体有类型操作；调用方仍负责来源字节与来源事务。集成测试复用支持的 fixture／publication 建立和观察接口。不得为避开扫描而搬测试、增加通用 SQL 代理、拆分禁用字面量、扩张排除或 allowance。新增 35 项及变化的历史 relocation blob 是独立未完成门禁；实现固定后，精确目标字节及严格列举的未变化旧 debt 须单独获得独立 relocation 批准。本设计不充当该批准。

## 严格 JSON 源格式

沿用 2 MiB 上传上限，增加深度 64、100,000 token/容器成员和累计 8 MiB locator 文本预算，在无界分配前拒绝。locator 预算限制重复长前缀造成的放大，即使输入字节和 token 数量较小也生效。拒绝非法 UTF-8，以及**所有解码后字符串（键和值）**中 PostgreSQL text/JSONB 无法保存的 NUL／孤立代理字符、注释、尾逗号、错误 literal/escape 及**解码后**重复键。负例覆盖目标字符串与无关源字符串，在 candidate 暂存前拒绝。有界扫描器记录 value span 和每个对象的重复键集合；能复用时仍由原生 JSON 解析负责语法／值解码，不仅为该格式添加依赖。

保留 JSON 标量、对象和数组类型。不能经过原生 JSON/ProjectValue 往返而保持数值时明确拒绝，不四舍五入。比较规范化十进制／指数文本；无意义的首尾零或指数写法不算数值变化。0.1、36.5 等有限小数必须保留；拒绝整数丢精度、溢出／下溢和负零丢失。DTS cells 保留无损类型／raw，不得用 `Number(...)` 静默丢精度或矩阵形状。

Pointer 为空表示文档根，否则以 `/` 开头；仅解码 `~0`/`~1`，保留空／Unicode／点号键，只访问自有属性。数组仅接受范围内的规范索引 `0|[1-9][0-9]*`，拒绝 `-`、负数、前导零和隐式追加；对象字面键 `01` 仍合法。原型类键是数据，不沿继承链读取或通过原型 setter 写入。

按准确 value span 修改，不按模糊斜线路径拆分。结果用同一严格所有者重解析，校验目标相等及非目标语义全等；span 允许时原样保留无关字节。所有序列化变化，包括格式／键顺序，都进入冻结的源 diff。本 parser 不扩大 capability v3 或实现 v4 数组 schema。

## 精确导出与证据

已实现 HTTP 接口：`GET /api/v2/projects/:projectId/parameter-bindings/:bindingId/export?projectValueId=...`（省略值选择器时导出当前 tip），以及同一 Binding 的 `POST /reimport-preview`，请求为完整导出 item。导出元数据来自所选不可变值／历史，不使用当前 Definition head。重导入预览将完整包与已持久化归属和字节证据比较，重解析精确目标并验证已存 typed value。它仅做只读核验，不等于应用外部修改后的文件；manifest／字节变化必须走显式新映射或已审核编辑流程。UI 即使只有一个源文件也下载完整身份包。

既有导入批次 `/apply` URL 现在返回 `status: staged`、`summary.staged` 和逐行不可变候选／基线证明，不设置 `appliedAt`。仅有变化且明确匹配的行可以暂存。精确重试核验同一用户的原草稿和候选仍存在，并匹配冻结 manifest 与存储字节；草稿被删除、消费或编辑后返回冲突，绝不静默重建。JSON 初次注册验证全部成员的有界字节；混合 DTS／JSON 配置集必须已有唯一精确、完整且 resolved 的 DTS revision，注册前检查其 entry／base／alias manifest。

每个 revision member 冻结 `source_name`，作为解析及导出包 alias，与文件的可变展示名和不可变 file ID 分开。运行时 manifest 使用 `sourceName`；canonical 后续 revision 沿用 pinned member alias，不能从当前展示 `fileName` 重新取值。只有新导入的 manifest 可以用其提供的解析路径建立新 alias。alias 遵守既有相对逻辑路径规则：非空，拒绝纯空白／控制字符、绝对路径及越界 `..`；同一 revision 的全部 DTS／JSON alias 必须唯一。被 pin 后不可变，并进入冻结成员 manifest 和精确导出。canonical load／prepare／commit／export 遇到任意缺失或重复 alias 均拒绝。

历史 alias 回填必须逐个 revision／file／version member 交叉证明：使用唯一历史 manifest 对应，或已独立证明精确历史归属的不可变 `source_ref` 命名快照。`source_ref` 只提供命名证据，不建立来源所有权。对任何 canonical pin 引用的 revision，alias 冲突、include 成员无法唯一归属，或只能从当前展示名／storage key 推断时，整次升级中止。未被引用的历史成员可保持空。展示改名不改变 occurrence／pin 身份和稳定解析／导出 alias。

导出经鉴权的 canonical Binding/value pin 对应的完整 revision 成员及每个不可变版本对象，验证 owner/member/digest/size，返回真实字节和身份清单：组织／项目／配置集，Binding/Definition/ProjectValue/source-pin/occurrence ID，格式，DTS logical/property occurrence 或 JSON instance/schema/root Pointer，文档绝对参数 locator，config-revision ID，以及每个 member ID/file ID/file-version ID/sourceName/role/order/字节 digest/size。revision 的 `entry_file`、`include_search_paths` 与 `overlay_order` 使用同一冻结 alias 命名空间。重导入先对照持久化归属校验清单，客户端 ID 本身不是连续性证明。历史导出不调用 current-only `loadConfigSetSnapshot`。重导入验证类型／值／locator 等价，覆盖嵌套根、转义斜线／波浪号和空键。跨域、缺 revision/member/object、digest 错误均拒绝，不回退当前版本。

接口仍是用户确认的 T1.1：迁移／SQL、canonical Binding/observation、真实鉴权文件／导入／草稿／评审／导出，以及源 patch。每个垂直实现小步先获得行为 Red。最终证据须包含专用真实 PG、本地真实对象存储和独立鉴权会话，不能只用测试 AuthContext 直接调用。区分 parser、服务集成、HTTP 与 PC 浏览器证据。

端到端覆盖 DTS/JSON、多文件／实例／配置集共享 Definition、字面键和精度、过期／重排／双连接竞争、越权／重放／Agent 拒绝、对象／DB／audit 故障、重启读取，以及当前版本变化后的历史导出／重导入。实际执行时记录非零用例数，本文件不提供 PASS。
