# Populated 升级的比较证据来源决策

[English](comparison-provenance-decision.md)

这是一份限定决策材料，不是已批准的合同修订或可执行升级。检查的开发基线为
`1376fbcbe34f140ebe44d6deda121bd7744ff836`，源部署仍为
`82344044b436a8dafecefbb85dfd724cecb05e3f`。本文不修改 migration、grant、
codec、allowance、verifier 或 controller。

## 冲突与责任

[P11 合同](../../../../docs/design-docs/parameter-catalog-cutover-archive-rollback.md#mandatory-p11-semantic-dual-read-comparison)
要求每条声明差异携带精确源身份、R 分类、mapping version/head digest、实际
typed target 或 Archive、不可变计划中的规则和 plan digest。P7 为**每个旧身份**
维护一个 current head。[发布合同](../../../../docs/design-docs/parameter-catalog-verification-upgrade-retirement-gates.md#fixed-input-and-attempt-identity)
另行固定完整 mapping epoch 与 mapping-head digest。

当前有两个独立问题：

1. `comparison/corpusContributionSchema.ts` 的 context 只有一组
   `mappingHeadId/version/checksum`，所有 contribution 必须相等，每条声明差异
   的 head ID/version 又必须等于 contribution，`ruleId` 必须等于 D01–D09 ID。
   v1 封闭字段没有精确 mapping-version ID 或逐身份 head digest。现有 live
   evidence 多 head 反例已经证明这个表达冲突，不能以全局 epoch 代替逐记录 head。
2. 十一个 provider 的 `classifyCase` 都会为可查询但不相等的观察构造声明差异。
   例如 CGH 根据 D ID 选择 R1/R9，并以共享 head ID 冒充 Archive/Definition ID；
   PRJ 选择 R9，把 protected reference 当目标。没有实际 mapping 查询或计划规则
   支持这些分类。parser 只要求 R class 非空、至少一个 target/Archive，没有验证
   完整领域去向。后续 aggregate 通过不能补足这些事实。

第二项违反**现有** P11 合同。停止推断去向、保留真实查询错误、把无证据差异标为
阻塞不需要新的产品决定，但不能据此声称 populated 正向验证完成。第一项涉及冻结
证据格式及其 parser/codec/tests 的限定演进。此前 reader/恢复两项授权没有隐含批准
这第三处格式变化。

## 推荐的最小 old/new 接口

| 边界 | 当前 v1 | 建议新版本；尚未批准 |
| --- | --- | --- |
| 整次采集 | 所有 provider 共用一个 head ID/version/checksum | 从完整真实库存取得 `mappingSnapshot: { epoch, headDigest }`；保留 source、Catalog、plan、candidate 和 phase pins |
| 一条声明差异 | 共享 head ID/version、字符串 R class、猜测目标、以 D ID 当规则 | 精确 `sourceIdentity`、`mappingVersionId`、`headVersion`、`headDigest`、实际 R class、唯一 typed target 或 Archive、已声明 `ruleId` 和 `planPin` |
| 规则关联 | `ruleId === comparisonId` | 固定 P0 计划中的规则，必须匹配本例的 D ID、源身份、去向和允许的语义差异 |
| 核验 | 与同一个共享 tuple 结构相等 | 核验本例属于实测 snapshot、完整 source/run/plan 关系、current head 及实际目标，再复用原 aggregate 和九个 adapter |
| 历史兼容 | v1 UTF-8/LF 规范字节和 checksum | 显式升级 contribution/corpus/report 格式版本；旧字节不变，不重标或借用旧报告批准新采集 |

这些字段名是有限审查面，不是已经生效的 API。`sourceIdentity` 必须包含实际
legacy identity ID 和 source tuple（system、kind、owner-scope kind/ID、source ID），
不能只有消费者引用 ID。`headVersion` 是实际 CAS version，不是 mapping version
number。由 mapping owner 明确定义返回 `MappingHead` 的逐 head digest 和完整集合
digest 的字节、排序规则，不能默默等同不同字段集合计算出的 hash。

建议的封闭字段集合如下：

```text
mappingSnapshot = { epoch, headDigest }
sourceIdentity = { legacyIdentityId, sourceSystem, sourceKind,
                   ownerScopeKind, ownerScopeId, sourceId }
expectedDifference = { sourceIdentity, rClass, mappingVersionId,
                       headVersion, headDigest, typedTarget?, Archive?,
                       ruleId, planPin }
typedTarget = { kind, id }
Archive = { id }
```

未知字段全部拒绝；typedTarget/Archive 必须二选一。mapping 记录的独立
`evidenceArchiveId` 不是第二种去向。完整既有 `MappingHead.version` 提供
sourceChecksum、graphFingerprint、run 和 version 身份，head digest 绑定这些内容，
不接受调用者重复填值冒充事实。ruleId 必须查到固定计划声明，不只要求非空。

可独立交付的安全修复不需要 v2 字段：保留等价值路径；任何 query-failure 都进入既有
阻塞类别；把各 provider 最后的构造证据分支改为
`{ result: "unexplained-difference", expectedDifference: null }`，直到接入真实声明规则。
不增加共享 verifier、不改 parser 来承认构造数据。首个 Red 应调用正式 provider，
独立构造无规则的不等观察，证明实际 aggregate 不得通过。覆盖十一类消费者、精确等价、
两侧查询失败（包括未知 failure code）和引用缺失。把原来期待伪造去向的测试明确记录为
违规行为，不能静默删除或 skip。这可能阻断旧伪正例，但不批准新差异，也不完成多 head
的正向表达。

复用 `mapping/index.ts` 的公开 `lookupProtectedIdentity` 或 `readCurrentMappingHead`，
不新造 classifier、不跨入私有 `persist.ts`。前者已经支持完整源 tuple 或旧身份，
返回实际 mapped/archived/blocked 去向及 head。每个消费者负责沿实际外键定位该身份。
缺失、歧义、无查询权限或 blocked 不能变成猜测目标；一条消费者记录涉及多个身份时，
按固定 corpus 规则枚举，不选 first/latest。

`activation.inspectFacts` 已观察完整 mapping 库存、历史 digest 和实际准备的 epoch；
epoch 必须来自既有领域命令。`runtimeState` 使用另一组字段计算 hash，不能仅凭名称
把它当 activation 的 `headDigest`。可由 mapping owner 的公开 snapshot 投影提供所需
记录与 digest，使用现有表和管理权限。这是内部接线责任，不需要给 runtime 新 grant
或新增 migration。

P0 的声明差异规则也需要真实 producer。现有 classifier 的 `PCAT-CLASS-*` rule ID
描述分类，不等于完整 P11 语义差异声明。在检查的非测试 cutover 实现中没有找到该
P0 声明 producer。应按既有 corpus/classifier 合同确定性地产生并固定到 plan，不能
用 D ID、调用者 JSON 或结果 report 补造。新增业务分类或新允许差异仍需单独产品决定。

## 精确消费者范围

下列路径均位于 `server/modules/`，文件名均为
`parameterCatalogComparisonContribution.ts`，连同各自既有 tests。D ID 为当前
`FAMILY_COMPARISON_IDS` 路由，不是缩减冻结语义覆盖的提议。

| Family／路径前缀 | 当前门禁 | 必须取得真实身份与去向的对象 |
| --- | --- | --- |
| CGH／`parameter-specs/` | D01、D03、D06、D09 | Definition/revision、注册/Placement、Review/Proposal/Observation、旧操作结果 |
| TOP／`parameter-topology/` | D02、D03、D04、D06 | Subject、注册/Placement、Binding/history、Review 去向 |
| PRJ／`parameters/` | D04、D05 | Binding/current/history、ProjectValue 和精确 revision pin |
| FIL／`parameter-files/` | D07、D08 | 文件、source occurrence、locator、配置 revision 和写回引用 |
| AGT／`agent/` | D07、D08 | tool/session/draft 引用、参数 pin 和写回 |
| LOG／`logs/` | D07 | 保留的分析/引用参数身份 |
| DBG／`debugging/` | D07 | debug operation/snapshot 和 Binding/value revision 引用 |
| DTS／`dts-reload/` | D07、D08 | reload snapshot/candidate、配置/source 和 Binding pin |
| KNW／`knowledge/` | D07 | 保留的 Definition/revision 和明确 Archive 去向 |
| MOD／`parameter-modules/` | D02、D03 | Subject 与 registered/observed module Placement |
| OPS／`operations/` | D09 | reconciliation/readiness 和 typed legacy 操作结果 |

父协调者串行整合 mapping snapshot、冻结格式、十一个 adapter 和验收；provider 作者
不能自行批准格式变化。格式实现范围为 `comparison/corpusContributionSchema.ts`、
`corpusResultSchema.ts`、`aggregateComparisonCorpus.ts`、`generateComparisonReport.ts`、
`productionProviders.ts`、`liveEvidence.ts`、公开 index/types/tests，以及上述十一组文件。
仅按已有可信机制更新直接受影响的合同指纹；不重置 trusted baseline、不刷新旧 occurrence
allowance、不改已应用 migration，也不重定义 Release Verification core/gate registry。

## R3 正反验收

| 威胁或成功场景 | 实现后的必需证据 |
| --- | --- |
| 同一 populated 采集有两个合法不同身份 head | 真实 PG mapping 命令生成，十一个 live provider 全运行，逐例去向通过实际 corpus/report codec 和九个 gate 关联 |
| 观察不等但无完整声明规则 | `unexplained-difference`；不产生可用批准/P12/队列/代理动作 |
| R class、source owner、mapping version、CAS head、target、Archive 或规则错误 | typed refusal 或阻塞；不能以总数相等放行 |
| 受保护引用缺失、不可查或歧义 | `unqueryable/protected-reference-missing`，不能变成 fresh zero 或声明差异 |
| SQL NULL、JSON null、缺失、空、默认、示例、实际项目值 | 独立 oracle 分别验证，并保留完整 history/revision pins |
| 采集中 mapping 变化或 owner pending/unknown | 整次失效，不猜 first/latest、不重置 journal、不复用旧 attempt |
| 跨 run/target/source/plan/Catalog/artifact 或 pre/post-P13 复用 | 当前观察和既有 verifier applicability/lineage 拒绝；post-P13 必须重新完整采集 |
| 缺失/重复 family、受保护引用、case 或 D gate | 完整期望清单和规范排序拒绝遗漏、重复、伪造覆盖 |
| v1/v2 字节、checksum、envelope 或 purpose 被改 | 原 codec 和九 gate 一一关联拒绝；不重写历史报告 |
| 整阶段成功链 | 真实领域报告、独立认证批准，再实际 P12/P13/startup；比较通过本身不够 |

保留 v1 多 head 反例作为历史格式测试，新增新版真实正例，不改写旧期待。需要逐个
provider 既有 tests、完整 comparison/contract/boundary、真实 PG 全消费者 oracle 和同一
候选的 controller 验收。本文没有执行这些实现测试。Policy 一张表为零不关闭 #815；
受保护 family 不可查询仍阻塞。

## 独立的应用构建来源缺口

固定输入合同要求应用 release/tag、package manifest、image manifest **和 config**
digests、platform 与 build trust。检查的非测试 `releaseTag/packageManifestDigest`
引用只有 core 类型和 `upgrade.sh` 的 `v-s11-apl`/空值占位。现有 build/handoff 观察
本地 image ID、platform 和 source labels，没有产生应用 package manifest 或证明 OCI
manifest digest。Catalog 的 `CatalogReleaseBundle.manifest` 和基础设施 base-image
bundle 是不同产物，不能填充这些应用字段。

本地 image ID 继续作为实测 config identity 保留。检查的冻结规范没有允许 local-image-only
免除 manifest pin。先复用现有 build-network/build 入口补实际应用 release/package 与
OCI manifest/config 来源采集；这是内部 producer 工作，不以关闭 TLS 解阻。不能从 Git SHA
造 release tag，不能把 image ID 重标为 registry manifest digest。如果需要 local-only
产物合同，应单独提出精确批准范围，不捆绑进本次 Comparison 格式决定。企业 CA/网络证据
及真实备份授权仍分别记录。

## 决策与文档影响

推荐决定：仅授权表达既有 P11 完整 tuple 所需的版本化 Comparison 格式和 mapping-owner
投影；门禁、分类、principal、批准 purpose、零差异门槛和 schema/grants 不变。父协调者
承担实现责任，仍需独立 Standards/Spec 审查。接受前可以继续安全分类 bugfix 和独立的真实
startup/handoff 接线，不新建恒定 unavailable 的 manager。

向用户只提出一个精确决定：**是否允许 Comparison contribution/corpus/report 格式演进为
上述封闭逐身份 tuple，接入真实 mapping-owner snapshot 和 plan-rule 查询，同时保持门禁、
R 语义、权限和批准边界不变？** 仅请求表示及直接相关 ownership/codec 对齐，不请求批准
推断差异、#815、local-image-only 发布证据或生产操作。

| 人读文档 | 决定后的影响 |
| --- | --- |
| 本中英文对 | 记录精确决定与审查提交；当前仅提案 |
| Comparison README 对 | 新旧版本与 mapping projection 合同 |
| Cutover/release 设计伴随文档 | 明确既有语义要求的表示，不降低要求 |
| 主 populated 计划、手册、证据 | 父记录新执行身份、剩余输入和生产停止边界 |

本文只做路径/链接及空白检查。需要自有数据库的完整 `docs:check`、TypeScript/build、
Hosted、真实 comparison、startup、controller 和生产均**没有在本分片运行**。
