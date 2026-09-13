# ADR-0043：Catalog 定义在产品内编写，并由唯一同步器激活

> English companion: [English decision record](../../adr/0043-catalog-authoring-and-online-publication.md)

日期：2026-09-12

## 状态

已接受为产品内 Catalog 编写的目标发布控制面决策。本记录编号为 ADR-0043。冻结时 `origin/main` `063b12c49dbc134e83103c77b813188e34f09461` 上下一个未占用编号是 0043；0040–0042 仍是 Wayfinder 的模型、发布完整性与 registration ADR。

本 ADR **不**声称控制面、migration、HTTP 路由、UI、Hosted 证据、目标机接管或生产启用已经存在。它是 CP-00 的合同冻结。实现跟从 [Catalog 编写与发布](../exec-plans/active/2026-09-12-catalog-authoring-publication.md)。

产品方向已于 2026-09-12 确认：管理员可以在产品内编写正式 Catalog 定义；激活仍要求冻结的不可变 Catalog Release、绑定授权和唯一 Catalog 同步器。Catalog 数据发布与应用代码发布解耦。

## 背景

[ADR-0040](../../adr/0040-canonical-parameter-catalog-relational-model.md) 确立了唯一物化者、稳定身份、不可变 revision、完整后继，以及 Proposal 接受不得写入 Catalog 行。[ADR-0041](adr-0041-platform-schema-catalog-releases-materialize-before-runtime.md) 确立唯一物化输入是不可变 Catalog Release，PostgreSQL 是投影，产品表单、目录扫描和组织数据不是 Catalog 输入。这些完整性规则仍然必要。

随后形成的排他解读是：只有人编辑应用仓库、经评审的包打进应用制品、再经升级/同步器安装，Catalog 内容才能变化。于是新增一条定义变成一次应用发版。`new-empty` 自托管 bootstrap `crel_acme_1` 之后，运营需要更便宜但仍有权威的扩展方式，而不能伪造 Git URL、从 web 连接池写 Catalog 表，或再次 bootstrap。

[#826](https://github.com/tzrea1-Q/WiseEff/pull/826) 为 vendor `catalog.json` 后继增加了仓库编译器与 `advance` CLI。那是合法的 D1（批量 vendor 覆盖）路径。它不是 D2（持续产品内编写），控制面就绪后不得变成规则不同的第二个 writer。

仍然拒绝的极端：

- Web 或 SQL `INSERT` 写入 `parameter_catalog` 表。
- 组织私有定义、运行时 overlay 或来源优先级。
- 用假 `repositoryReference` 满足当前 Proposal 接受列。
- 重开 #824、伪造 P13 退休，或把 `new-empty` 当成存量数据 cutover。
- 通用工作流平台、第二个微服务仓库、把 Kafka/Temporal 当第一版队列，或第二个 `active_catalog_pointer`。

## 决策

### 1. 一条管道，两个编写入口，一个 writer

```text
页面类型化 ChangeSet ─┐
                      ├→ 完整后继 Builder → 现有 Compiler
受控 YAML 导入        ┘                              ↓
                                            冻结 Artifact + Candidate
                                                     ↓
                                      绑定 Candidate 的授权
                                                     ↓
                                      持久 Publication Job
                                                     ↓
                         独立管理进程 → 唯一 Kernel installer
                                                     ↓
                    提交前投影校验 + Activation Receipt + pointer/heads
```

- **ChangeSet** 是类型化意图，不是 Catalog Release。
- **Artifact** 是精确不可变编译包字节、工具链与输入证据。投影行不能重建它。
- **Candidate** 钉住一份 Artifact、前驱 pin、冻结身份分配、影响报告和能力合同。冻结后不可变；草稿改动需要新 Candidate。
- **Authorization** 把 `candidateId + artifactDigest + expectedBaseRelease + proposalRevision + impactReportDigest + capabilityContract + policyRevision` 绑定到真实 actor。digest 是完整性，不是权限。管理进程身份不是批准人。
- **Publication Job** 是执行投影（`queued → running → active`，异常为 `needs-rebase | blocked | failed-retryable | failed-terminal | cancelled`）。Proposal 的 `accepted` 不是 `active`。
- **Activation Receipt** 由同步器与 Catalog 投影及 `catalog_state` / definition heads 同事务写入。页面只有读到 Receipt 才能显示“已生效”。

唯一 Catalog Release 同步器仍是 `CatalogSubject`、release membership、`ParameterDefinition`、`DefinitionRevision`、definition heads、`catalog_state.current_catalog_release_id` 与 Activation Receipt 的唯一稳态 writer。普通 API 与业务 worker 不持有同步器凭据。

### 2. ADR-0043 取代、保留与不动的条款

| 先前条款 | 处置 |
| --- | --- |
| ADR-0040 把“仓库评审发布”当作唯一编写来源 | **作为唯一来源被取代。** Catalog Release 仍是唯一物化输入；编写可以是类型化 ChangeSet 或受控 YAML 导入后再编译。 |
| ADR-0040 图中 `PUBLICATION_INTENT` 只由仓库发布兑现 | **替换。** 兑现路径是 Candidate + Authorization + 同步器安装。历史 `repositoryReference` 仍是一种来源。 |
| ADR-0040 Proposal 接受不物化 Catalog 行 | **保留。** 接受只写 intent/授权事实。 |
| ADR-0040 唯一同步器、完整后继、缺项≠退休、不可变 revision、无组织 overlay、稳定身份 | **保留。** |
| ADR-0041 §1 “随目标应用制品交付”作为唯一发布输入 | **取代。** Artifact 存放在 `catalog_publication.release_artifacts`（物理名见控制面文档）。应用镜像仍可携带 vendor 包供显式 bootstrap；普通启动只校验，不得自动覆盖数据库当前 Catalog。 |
| ADR-0041 §1 “产品表单不是 catalog 输入” | **作为禁止类型化编写被取代。** 表单产出 ChangeSet。它们不写 Catalog 表，也不另造 digest 算法。 |
| ADR-0041 §5/§6 把每次内容变更当成应用升级同步 | **部分取代。** 授权、前驱、能力与提交前校验通过时，允许经同一 installer 在线 `advance`。bootstrap 仍须显式。重放当前 digest 仍是已验证 no-op。 |
| ADR-0041 备选方案拒绝“Admin UI 编写 catalog” | **拆分。** UI 作为编写入口现在允许。UI/PostgreSQL 作为第二结构真相或 UI 写 Catalog 表仍然拒绝。 |
| ADR-0041 失败即关闭编译、精确 digest、历史重放、无 overlay、流量后禁止仅指针回滚 | **保留。** |
| ADR-0041 / 验证门禁的精确 `readApprovedRuntimePin` / P13 比较 | **作为应用批准保留。** 就绪是已批准应用 pin **与** 真实当前 Catalog（Activation Receipt 或显式 `adopted-preexisting`）的合取。旧报告不能批准后来的 Catalog 后继。`new-empty` 不得声称 P13 已退休，也不得捆绑 #824。 |
| ADR-0042 registration/placement | **不动。** 登记不是 Catalog 发布。后续登记失败不得把已经成功的发布显示成回滚。 |
| 冻结的 Wayfinder #668 53 节点图 | **不动。** 本程序不重标或掩盖那些节点。 |
| #824 存量旧值迁移 | **范围外。** 不得作为本程序一部分恢复或合入。 |
| PR #825 Option 1“网页永远不能发布定义”作为现行产品策略 | **取代。** Option 1 对 #825 的代码仍是历史事实。本 ADR 是替换策略。 |

### 3. 范围、共享与权限

正式定义作用域是**当前平台实例**。实例内组织共享同一份官方 Catalog。网页发布不等于上游 WiseEff 官方背书。

本程序 **不** 引入组织私有 Definition、不恢复运行时 overlay、不引入来源优先级。两组织可独立起草，但不能为同一自然键发布两个正式身份。内容一致可复用已有定义；内容不同是冲突，不是“网页赢”或“vendor 赢”。

能力（冻结名称）：

| 能力 | 含义 |
| --- | --- |
| `catalog:author` | 创建/编辑草稿与 ChangeSet，并请求 Candidate 预览。 |
| `catalog:publish` | 请求执行已授权 Candidate，或在策略内批准。 |
| `catalog:review-high-risk` | 独立批准高风险 Candidate。编写者不能用第二个合成身份满足此项。 |

组织 Admin **不会**自动获得 `catalog:publish`。请求体中的角色、组织、风险与批准标志均不可信。服务端从可信上下文计算 actor、scope、风险与策略。

自托管单人发布仅当：

1. 实例策略 `catalog_publication.low_risk_single_actor_publish` 显式启用；
2. 服务端把该 Candidate 分为 **low-risk**；
3. actor 持有真实的 `catalog:publish` 授权。

高风险变更始终要求独立的 `catalog:review-high-risk` 主体。新增 Definition 不天然低风险。新 Driver、selector 变化、更严约束、单位/语义变化或 matcher/fallback 影响属于高风险。

关闭发布能力只停止新编写/发布，不隐藏或删除已发布定义。

### 4. 身份、完整后继与冲突

Builder 从可验证的前驱 **Artifact** 出发，应用冻结 ChangeSet，产出完整后继。它从不扫描运行时投影来把额外行合法化。未改定义保留 revision ID。每一持久内容变更只铸造一个新 revision。退休必须显式。缺项无效。

同一冻结 Candidate 重试必须产生相同字节、digest 与已分配 ID。Release ID、revision ID 与发布时间在 Candidate 上冻结；安装重试不得重新生成。

两个 Candidate 基于同一前驱：第一个合法提交者成功，另一个返回 `needs-rebase`。失败输入保留。不得修改旧 Candidate 的 predecessor。禁止 last-write-wins。

### 5. 在线激活

`installPublishedRelease` 仍是唯一事务拥有者。调用方仍不能传入已开启事务。在线路径在该边界内增加：

1. 既有目录独占锁并遵循维护锁顺序；
2. 前驱、Authorization、能力与冻结检查（执行时重新检查，不只入队时检查一次）；
3. 物化；
4. 用独立于写入算法的验证逻辑，在**同一未提交事务**内重算候选投影；
5. 写 Activation Receipt 与审计；
6. 切换 heads / `catalog_state`；
7. 强制约束检查；
8. 提交。

没有第二个 current pointer。指针已切而验证未完成的窗口不是可接受设计。不能假设另一连接能看见未提交的 staged 行。

任务恢复：若 R2 已安装成功但成功响应丢失，随后 R3 成为 current，恢复 R2 必须观察其 Receipt 并报告 `active-superseded`。不得再次 advance R2。现有 `already-current` 分支不足以覆盖该场景。

### 6. 既有安装的接管

在线新发布要求 Activation Receipt。控制面之前已安装的 Catalog（用户报告、非本轮主机核验：`crel_acme_1`）不能补造历史 Candidate、批准人或 job。

CP-01/02/06 定义一次性 `adopted-preexisting` 证明，绑定精确当前 ID/digest、精确源包、独立投影校验、data mode、采集时间与操作批准时间。它证明“今天核验并接管了这份已安装发布”，不证明“过去已经跑过新审批”。

接管不是通用激活后门。未知或漂移的历史阻断在线发布，但保留现有读取。新空库仍用显式 bootstrap。缺失与部分状态不可混同。

### 7. 双版本

应用批准事实：代码 SHA、migration 清单、权限边界、能力合同、部署模式及对应已批准 runtime pin。

Catalog 激活事实：精确 Catalog ID/digest、Artifact、前驱、Candidate 授权、投影校验和 Receipt（或 `adopted-preexisting` 证明）。

就绪是二者。钉住更旧 Catalog 的已批准应用报告不能批准后来的后继。不得删除 digest 比较、改写旧报告，或把 `new-empty` 当成 P13 退休。

首次启用要求先完成兼容应用升级，再打开在线 Catalog 发布。每个 API/worker 副本都必须满足能力白名单；随后加入的旧镜像必须保持 not-ready。

## 后果

- 新深模块 `server/modules/catalog-publication/` 拥有 ChangeSet 校验、Builder、Candidate/Artifact 持久化、Authorization 与 jobs。它不拥有 Catalog 表。
- Kernel installer 增加 Authorization 与 Receipt 检查；它不变成审批服务。
- Proposal 接受增加结构化 publication reference。`repositoryReference` 列对历史仓库来源仍然有效，不得填假 Git URL。
- D1 vendor 编译/`advance`（#826）在新通道就绪前仍可用。CP-07 之后，vendor 导入是同一管道的适配器。
- 现行计划中的 T01–T28 是永久测试。高风险反例在实现前就存在，而不是等 UI 变绿再补。

## 必须保持的核验

可执行矩阵见现行计划第 9 节。ADR 级不变量：

- Proposal/HTTP/Agent/SQL 不能写 Catalog 表或 Receipt。
- 冻结 Candidate 重复编译字节相同。
- 并发同一前驱发布产生一个胜者与 `needs-rebase`。
- 篡改 Artifact/Authorization 失败关闭。
- 入队后撤销在激活前线性化。
- 物化/校验/head/receipt/提交前故障回滚全部 Catalog 写入。
- R2 成功后 R3 已 current 的恢复不重装 R2。
- 后续发布之后的 `new-empty` 升级不重置 current、不 seed。
- 错误包或缺失历史的接管被阻断。
