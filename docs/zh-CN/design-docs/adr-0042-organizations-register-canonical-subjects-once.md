# ADR-0042：组织只注册一次规范主体并只放置一次

> English: [English decision record](../../adr/0042-organizations-register-canonical-subjects-once.md)

日期：2026-08-31

## 状态

已接受，作为 [Choose organization registration and placement semantics](https://github.com/tzrea1-Q/WiseEff/issues/675) 的目标合同。这是参数目录替代模型的决策，不表示当前生产已经具备这些行为。在后续实现计划和经验证的切换完成前，ADR-0039 仍是当前运行合同。

## 背景

Platform schema catalog 是正式 Driver、NodeType 身份及其 Parameter definition 的唯一结构真相。Organization 应当只使用与自己相关的 catalog subject，而不是私有复制每个 subject 或接收全部 Platform definition。

当前模型没有一致地守住这条边界。Driver placement 有组织/主体唯一性守卫；NodeType placement 仍从 module 行推断；审核中的 `createSpec` 可以从 observation 证据铸造组织主体；迁移 0127 还会为每个 Organization 创建每个完整 Platform Driver 的 placement，新建 Organization 也不例外。这些行为混淆了四个不同事实：正式 catalog identity、Organization 使用该身份的声明、Organization taxonomy placement，以及 Project 中的实测使用。

[Classify legacy parameter rows and repair semantics](https://github.com/tzrea1-Q/WiseEff/issues/670) 的旧行分类也证明，property key、展示名、节点标签、module 和 occurrence 都是弱证据，不能建立正式身份，也不能把 R6/R8 形态安全合并为 definition。

## 决策

### 规范主体、注册和放置是三个不同事实

- **正式目录主体**是 Platform 拥有的 Driver 或 NodeType 身份。Organization 不复制、不 shadow、也不私下重定义它。
- **组织主体注册**是某个 Organization 使用一个正式目录主体的持久声明。其身份是 `(organization, formal subject)`，生命周期为 `active | retired`。
- **主体放置**是该注册在组织分类树中的唯一权威节点。注册与第一次放置原子创建；无论 active 还是 retired，注册都始终保留且恰有一个 placement。
- module、observation、occurrence、Project binding、property key、展示名或 source-key token 都不是正式主体，也不能晋升为正式主体。

Driver 与 NodeType 使用相同的 registration 和单一 placement 不变量。placement node 的 kind 仍不同（`driver-group` 与 `node-type`）；taxonomy parent 规则允许时，NodeType 可显式放在 business category、已注册 Driver 或已注册 NodeType 下。

### 显式注册

具备目录治理权限的 Organization Admin 可以在任何 Project observation 之前预注册正式主体。操作必须选择有效父分类，或明确接受 Organization 的保留「未分类」根。Platform 权限只治理 Platform catalog；仅有 Platform 权限不会静默把主体放入租户 taxonomy。

用户指挥的 Agent 不能代替显式注册者。可信 system 路径只能通过下述「唯一证明 observation」规则创建注册。显式和自动注册及其 placement 都是组织域写入，必须在同一事务记录可信审计。

### 唯一证明的 observation 直接自动注册

当当前 Platform catalog 与 matcher revision 唯一证明一个 active 正式主体时，Organization 不能关闭确定性的自动注册。并发重试必须幂等；若注册不存在，则一次创建 registration 与一个 `origin=auto` placement。

证明必须来自权威 Platform catalog matcher，并包含 subject kind 与当前 schema/revision 上下文。零候选、多候选、owner/kind 不一致、既有 placement 冲突或被引用 DTS 上下文不完整，都不是唯一证明。property key、展示名、compatible 后缀、裸 node name、实测 module、binding 或 occurrence 单独都不充分。

Driver 和 NodeType 采用同一规则，但 NodeType 自动注册必须得到正式 Platform NodeType matcher 结果。裸 node name 或 `nodetype:*` module 不能建立该结果。

主体识别与属性识别彼此独立：

- 唯一证明的 subject 即使遇到未知 property，也可以创建 Organization registration；
- 未知 property 仍进入 review，不创建 definition binding；
- recognized binding 必须对应已证明 subject + property 的唯一当前 Platform definition，仅有 registration 不够。

observation 绝不自动恢复 retired registration，而是创建 `retired-registration-observed` review item。

### placement 必须确定，并由 definition 动态继承

Organization creation 只创建保留的 taxonomy 基础设施，其中包括一个稳定「未分类」根；它不创建任何 subject registration，也绝不把 Platform catalog 复制进 Organization。

自动注册的 subject 在该根下获得一个稳定 placement node。显式注册必须选择有效 parent，或明确接受同一默认值。节点稳定身份来自 registration，不来自本地化展示名或实测 module。

正式 subject 的全部当前及未来 Platform definition，在该 Organization 中都动态继承 registration 的当前 placement。definition 不存 organization-specific placement 快照或 override。Organization 内多个 Projects 共用同一 registration 与 placement；实测次数不会创建 Project-specific registration 或额外 placement。

rename/reparent 原位修改同一 placement identity，不改变正式 subject、definition、Project binding 或 history identity。人工 rename/move 会把 `origin=auto` placement 提升为 `curated`。移动后，全部继承 definition 的当前 taxonomy 投影立即变化，但历史 binding revision 与 observation evidence 保持不变。删除 module 若会让 placement 悬空则必须拒绝，只能先移动 placement。退休 registration 也不会让其持久 placement 变为可删除。

### retirement 可恢复，目录域禁止 hard delete

Organization registration 状态机为 `active -> retired -> active`。retirement：

- 保留 registration/placement ID、旧 definition、observation、binding 与 audit 的可读性；
- 从当前可选范围移除该 registration，并阻止新 Project 或新 binding 采用它；
- 不重写已发布 baseline 或历史 binding revision；
- 不会因为最后一个实测 Project 消失而自动发生。

restore 复用原 registration 与 placement。目录域不提供 subject registration 或 placement hard-delete，即使该注册从未使用也一样。若其它领域支持整个 Organization 的抹除，应服从其独立 retention/audit 合同，本决策不授予该操作。

Platform subject retirement 阻止新的显式或自动 registration，并把既有 registration 标为 upstream-retired。已有 Organization registration、placement、history 与已发布解释仍可读；该 retirement 不会伪造 Organization deletion 或替代身份。

### unknown/ambiguous observation 进入 review，而不是 catalog

每条未匹配 observation 都作为不可变证据保留 Organization、Project/config revision、source locator、matcher/catalog revision、候选项和 evidence fingerprint。review 按 Organization、matcher revision 与 evidence fingerprint 聚合，使重复 occurrence 只增加证据，不铸造 identity 行。

review reason 至少包括 `unknown`、`ambiguous`、`placement-conflict` 和 `retired-registration-observed`。零个或多个合法候选都不创建 registration、subject placement、recognized definition 或 recognized binding。review 只能：

1. 选择既有 Platform subject，并注册或恢复其权威 placement；
2. 把证据标记为 out of scope；
3. 提交受治理的 Platform catalog-publication proposal。

Organization review 不能创建 Organization definition、Organization subject 或 definition-shaped provisional identity。Platform publication 是独立的 Platform 治理操作；发布后，普通 matching 也只能在结果得到唯一证明时注册新正式主体。

后续 catalog revision 会重新计算仍 open 的 review item。如果 open item 变为唯一证明，可以按确定性自动注册规则解决。人工 dismissed 或 out-of-scope 的 item 不得自动重开。

### 审计与失败行为

显式注册、自动注册、placement rename/reparent、retirement/restore 和 review resolution 都要记录可信 initiator、accountable principal 或 system identity、reason、before/after、catalog/matcher revision 及支持证据引用。审计与域写入同事务提交。unknown、ambiguous、conflicting 或 malformed 证据必须失败关闭，不得留下半个 subject、registration、placement、definition 或 binding 写入。

## 取代关系与范围

| 旧决策                                                                                                        | 替代模型                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ADR-0007：registration 是 curated module + mappings                                                           | 正式 Platform subject、Organization registration 与 subject placement 是三个不同事实；module 只负责 placement。                                              |
| ADR-0013：Organization subject 可以 shadow Platform subject                                                   | 目标模型退役组织 shadow subject；Organization 只引用规范 Platform subject。                                                                                  |
| ADR-0014：Organization definition 可以 override Platform definition                                           | Platform catalog 是唯一 definition 来源；Organization registration/placement 不复制或覆盖结构定义。                                                          |
| ADR-0039 / migration 0127：完整 Platform Driver 在每个 Organization 及 Organization creation 时获得 placement | 目标 registration 是选择性的：显式使用或唯一证明 observation 才创建。Organization creation 产生零个 subject registration。切换前 ADR-0039 仍是当前生产真相。 |
| D-AG-04：registration default 驱动自动 placement replay                                                       | 默认 placement 规则只在 registration 已存在后适用，不能创建 registration 或把 catalog 铺满所有 Organization。人工移动后的 curated placement 保持稳定。       |

本 ADR 只决定领域语义，不决定关系表名、HTTP shape、迁移批次、UI 布局或实现顺序；这些属于后续 specification 与 tickets。

## 考虑过的方案

- **把每个 Platform subject 放入每个 Organization。** 拒绝：这会给每个租户塞入未使用 catalog entry，并让 Organization creation 依赖 catalog 大小。
- **即使正式匹配唯一也必须人工审核。** 拒绝：身份已得到确定性证明后没有额外判断，审核只会无谓阻塞普通 ingest。
- **允许 module creation 或 observation 创建身份。** 拒绝：taxonomy 与 occurrence evidence 可变，无法提供正式 schema 权威。
- **注册时快照 definition placement。** 拒绝：这会制造 per-definition placement drift，并把一次 module move 变成批量 definition migration。
- **hard-delete 未使用或 retired registration。** 拒绝：registration/placement 被 evidence、history 与可信 audit 引用；restore 必须保留连续性。

## 影响

- 替代模型必须移除 eager Organization-by-catalog placement 维护，以及从 observation 铸造 Organization subject/definition 的 review path。
- Driver 与 NodeType 都需要数据库强制的 Organization-registration 和 one-placement invariant。
- migration 必须按 R0-R10 证据规则分类既有 Organization subject、definition、module 与 placement；弱证据不能用于伪造 canonical registration。
- 本次只写文档，不改变当前生产行为。只有 Wayfinder map 通过 `/to-spec` 与 `/to-tickets` 收敛后才开始实现。
