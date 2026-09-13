# Catalog 编写与发布控制面

> English: [English](../../design-docs/catalog-authoring-and-publication-control-plane.md)

状态：**已锁定的 CP-00 合同**。不是实现、不是 Hosted 证据、不是目标机接管，也不是生产授权。

规范决策：[ADR-0043](../../adr/0043-catalog-authoring-and-online-publication.md)。执行计划：[2026-09-12 Catalog 编写与发布](../exec-plans/active/2026-09-12-catalog-authoring-publication.md)。基线核验（独立 lane）：[Catalog 发布基线核验](../references/catalog-publication-baseline-verification.md)。

冻结时已接受的 `origin/main`：`063b12c49dbc134e83103c77b813188e34f09461`。每次后续派发前重新 fetch。

## 1. 目标

管理员选择已有主体或创建主体，填写受支持的参数合同，预览影响，并按能力与策略发布。系统构建完整后继、用现有编译器编译、检查授权、原子激活并刷新读取。日常符合策略的数据发布不要求编辑 Git、手工填写 digest、执行管理 CLI 或重启应用。

M1 纵向闭环（必须真正可用）：

> 当前完整发布 → 在已有 Subject 下新增一条受支持的 Definition → 页面预览并发布 → 新 DTS ingest 匹配 → 工作台保存值 → 再发布另一条定义 → 重启回读 → 原定义与项目历史完整保留。

M2 增加新 Driver/NodeType、定义修订，以及与页面增量共存的 vendor YAML 导入。D1 批量 vendor 覆盖不能代替 D2 持续页面扩展。

## 2. 现状与目标（旧文档不得压过代码）

| 主题 | `063b12c49` 现状 | 目标 |
| --- | --- | --- |
| 编写 | 仓库 YAML / `scripts/compile-vendor-catalog-release.ts` / 安装 CLI | 页面 ChangeSet 与受控 YAML 导入进入同一管道 |
| Installer | `installPublishedRelease` 已有 bootstrap/advance、`expectedCurrent`、独占锁、Kernel 自有事务 | 同一 installer 加上 Authorization、提交前投影检查与 Activation Receipt |
| Proposal 接受 | 仍要求 `repositoryReference`；只写 `catalog_publication_intents` | 仍不物化；增加结构化 publication reference；禁止假 Git URL |
| Runtime pin | `readApprovedRuntimePin` 仍要求精确 P13 / writer-retirement fingerprint / pin 匹配 | 保留这些应用批准检查，并与 Catalog 激活事实组合 |
| `new-empty` | 对已安装 Catalog 只读校验，不重置 | 同样，且随后的在线发布必须能在升级/重启后存活 |
| Kernel 接口文档（2026-09-01） | 仍写 install/verify 在 S3-INS/S3-VFY 前为 `permission-denied` | 相对已落地 installer 是历史表述。记录在此；不重开 #668 节点 |

## 3. 冻结关系与 writer

物理 schema `catalog_publication` 为新增。Catalog 核心表留在 `parameter_catalog`。CP-02 在合并时确认下一个 migration 编号；本冻结不预占 `0140`。

| 关系 | 责任 | Writer | 可变性 |
| --- | --- | --- | --- |
| `catalog_publication.release_artifacts` | 精确 Artifact 字节、来源种类、工具链、前驱 pin、aggregate digest。Id 前缀 `cart_`。`artifact_digest` 唯一。 | 发布协调者 | 只插入 |
| `catalog_publication.candidates` | 不可变 Candidate：`artifact_id`、`artifact_digest`、期望基线 pin、proposal/revision、冻结身份分配、影响报告 digest、能力合同。Id 前缀 `ccand_`。 | 发布协调者 | 只插入 |
| `catalog_publication.publication_authorizations` | 绑定 ADR-0043 §1 Candidate 元组的 append-only 批准/撤销事实。真实 actor。Id 前缀 `cauth_`。 | 发布协调者 | 只插入 |
| `catalog_publication.publication_jobs` | 执行投影、幂等键、请求 digest、lease/fencing token、尝试计数、失败分类。Id 前缀 `cjob_`。 | 发布协调者 | 只变状态 |
| `parameter_catalog.catalog_activation_receipts` | 不可变 Receipt：job、授权、release pin、前驱 pin、校验 digest、种类 `online-publication \| adopted-preexisting \| bootstrap`。Id 前缀 `crct_`。`publication_job_id` 唯一。 | **仅同步器**，与 pointer/heads 同事务 | 只插入 |
| 既有 `definition_proposals` / `definition_proposal_revisions` | 草稿与评审。用带标签的 ChangeSet 正文扩展；不得把未类型化 JSON 塞进去就声称合同完成。草稿可引用尚未发布的草稿主体键，但不得把未发布 ID 填进 Catalog 外键。 | proposal 服务 / application role | 既有状态机加 revision |
| 既有 `catalog_publication_intents` | 保留。增加带标签的 `publication_reference`（`repository` 或 `candidate`），使接受不必走假 `repositoryReference`。 | proposal 服务 | 与今日一样只插入 |
| `parameter_catalog.catalog_releases` 及全部 Catalog 核心表 | 所有权不变 | 仅同步器 | 不变 |

第一版不要并行再造任务历史、审批历史和事件总线三套记录。可信审计仍是历史存储。可变 job 状态不得抹掉历史。

### 来源种类

`typed-changeset | vendor-yaml | repository-bundle | adopted-preexisting`

### 任务状态

`queued → running → active`

异常：`needs-rebase`、`blocked`、`failed-retryable`、`failed-terminal`、`cancelled`。

当 Receipt 存在且后来的合法后继已成为 current 时，UI 可投影 `active-superseded`。

`accepted` ≠ `active`。排队成功返回 job 资源，不返回伪成功定义。

## 4. ChangeSet 合同

封闭 tagged union。未知标签失败关闭。

### M1 开放

```ts
type CreateDefinitionChange = {
  readonly op: "create-definition";
  readonly subjectId: string; // 已发布的不透明 id
  readonly propertyKey: string; // S0-ID 构造器，客户端不做规范化
  readonly content: SupportedDefinitionContent; // 能力白名单
};
```

### M2 核心（测试可在 CP-03；产品入口在 CP-10）

```ts
type CreateSubjectWithDefinitionsChange = {
  readonly op: "create-subject-with-definitions";
  readonly kind: "driver" | "node-type";
  readonly canonicalKey: string;
  readonly selector: DriverSelector | NodeTypeSelector;
  readonly definitions: readonly CreateDefinitionChange[]; // 省略 subjectId；一起分配
};

type ReviseDefinitionChange = {
  readonly op: "revise-definition";
  readonly definitionId: string;
  readonly class: "documentation" | "semantic";
  readonly content: SupportedDefinitionContent;
};
```

Candidate 是这些操作的冻结列表，加上每个新实体的冻结不透明 ID。变基后重建只给从未发布的实体分配 ID；已发布自然键不能改变。

不支持：属性改名/身份重用、执行任意自定义约束、组织私有定义、批量不兼容 Binding 迁移、用 UI 对空目录做第一次 bootstrap。

### 受支持内容白名单（M1）

M1 只允许当前运行时已经解释的类型与约束。精确白名单由 CP-03 对照 `parameter-catalog-contract` 拥有，必须是失败关闭的允许列表，而不是“看起来像 schema 的 JSON”。未知 `valueShape`、单位或约束标签一律拒绝。已经能通过现有编译器的 vendor mixed shape 仍是 D1 编译器问题；页面白名单比 vendor 编译器更窄。

## 5. 风险与策略

服务端分类器（客户端不能降级）：

| 级别 | 例子 |
| --- | --- |
| `low` | 在已有 Subject 下新增受支持 Definition，且不改变 matcher/selector/fallback，也不收紧已在使用的合同 |
| `high` | 新 Driver 或 NodeType；selector/alias 变化；单位或语义变化；更严约束；matcher/fallback 影响；退休 |

策略行 `catalog_publication.publication_policies`（单例或版本化）：

- `low_risk_single_actor_publish`：布尔，默认 false。
- `publication_enabled`：布尔，默认 false，直到 CP-12。
- `capability_contract_revision`：文本。

高风险始终需要与作者不同的真实主体持有 `catalog:review-high-risk`。worker/manager 身份不能充当该主体。

## 6. API 冻结

不得另手写一份平行 OpenAPI。CP-07 扩展既有生成的 `/api/v2/catalog/*` 合同（S8-CON 机制）。下列名称是 CP-00 冻结。

| 方法与路径 | 合同 |
| --- | --- |
| 既有 proposal 创建/提交/撤回/接受/拒绝 | 保留。Accept 仍不物化。接受结构化 publication reference 只记录 Authorization 意图，不写 Catalog 行。除非自托管低风险策略适用于 **low-risk** Candidate 且 actor 持有 `catalog:publish`，自审仍返回 `proposal-self-approval-forbidden`。 |
| `POST /api/v2/catalog/publication-candidates` | 构建并冻结预览。输入：proposal revision 和/或 tagged ChangeSet，以及 `X-WiseEff-Catalog-Release`。输出：Candidate id、影响摘要、风险级别、能力合同；**不**要求用户填写 digest/version/Git URL。 |
| `GET /api/v2/catalog/publication-candidates/{candidateId}` | 调用方范围内的不可变 Candidate 投影。 |
| `POST /api/v2/catalog/publication-candidates/{candidateId}/publish` | 策略门禁的批准和/或入队。Body：`{ "idempotencyKey": "…" }`。返回 job，不返回 definition。 |
| `GET /api/v2/catalog/publications/{jobId}` | Job 状态、失败原因、变基说明。只有可读到 Receipt 时 `effective` 才为 true。 |

普通 handler 不得在请求事务里运行同步器。

### 新增错误 `details.reason`

`parameter-catalog-api-transition.md` 中的既有 reason 保留。新增：

| `details.reason` | HTTP | 何时 |
| --- | --- | --- |
| `publication-not-authorized` | 403 | 缺少 Authorization 或能力 |
| `publication-capability-missing` | 403 | 没有 `catalog:author` / `catalog:publish` / `catalog:review-high-risk` |
| `publication-self-approval-forbidden` | 403 | 高风险自审，或策略关闭时的低风险自审 |
| `publication-policy-disabled` | 403 | 功能开关/策略关闭 |
| `publication-frozen` | 409 | 应用升级/维护冻结 |
| `candidate-stale` | 409 | 草稿已动或基线漂移；需要重建 |
| `candidate-tampered` | 409 | Artifact/digest/授权元组不匹配 |
| `needs-rebase` | 409 | 前驱不再是 current |
| `unsupported-catalog-capability` | 422 | 内容超出白名单，或运行中镜像无法解释 |
| `publication-authorization-revoked` | 409 | 入队后撤销；尚未线性化进激活 |
| `idempotency-key-conflict` | 409 | 同键不同请求 digest |
| `artifact-missing` | 409 | 前驱 Artifact 字节不可用；不得从 DB 重建 |
| `predecessor-incomplete` | 409 | 后继遗漏应有 membership |
| `activation-receipt-mismatch` | 409 | 恢复时 job/release/receipt 不一致 |
| `adoption-evidence-invalid` | 409 | `adopted-preexisting` 包/历史/投影失败 |
| `registration-followup-failed` | 200 + 嵌套失败 | Catalog 发布已成功；组织登记未成功。绝不把发布改写成已回滚。 |

`needs-rebase` 是领域 reason，不是静默重试。

## 7. 角色与授权

| 身份 | 可写 | 不可写 |
| --- | --- | --- |
| Web / 治理 API（`application_role`） | 草稿、提案、发布*请求* | Catalog 核心、Receipt、自我授权 |
| 发布协调者（`catalog_publication_coordinator_role`） | Artifact/Candidate/Authorization/jobs | Catalog 核心、heads、Receipt |
| 同步器（`catalog_synchronizer_role`） | Catalog 核心 + Receipt；列级 heads/`catalog_state` | HTTP 声称的授权；改写不可变历史 |
| 运行时读 | 当前/钉住快照 | 编译时写库、补齐、发布 |
| Migration owner | 新 schema/角色；一次性接管 DDL | 日常 Catalog 内容 |
| 基线读取者（CP-01 采集器） | 无 | 除对指名关系 SELECT 以外的一切 |

CP-02 必须用真实 PostgreSQL 角色证明，而不是 superuser 测试。直接 Catalog SQL、改 Artifact、伪造 Receipt 必须失败。

管理进程复用应用镜像，但使用独立进程入口和数据库角色。PostgreSQL `SKIP LOCKED` 只用于任务认领，从不用于读取 Catalog。

## 8. Kernel 激活顺序

`mode: "advance"` 在线发布时，`installPublishedRelease` 内的规范顺序：

1. 获取既有目录独占锁；遵循维护锁顺序。
2. 重新校验 Artifact digest、Candidate 冻结、Authorization 未撤销、actor 仍有能力、策略仍允许、期望当前 pin、能力合同、未处于冻结。
3. 按今日方式 staged 物化。
4. 用不信任 writer fingerprint 的 verifier 逻辑重算候选投影，读取**本事务**内的 staged 行。
5. 写 Receipt + 审计。
6. 切换 heads 与 `catalog_state`。
7. 强制延迟约束。
8. 提交。

提交前失败则先前 pointer 与 heads 仍可见。调用方永不传入事务。不增加第二个 pointer。不做“先切再验证”。

`adopted-preexisting` 与显式 bootstrap 是带相同锁和 verifier 的独立命令种类，而不是更松的 installer。

## 9. 应用 / Catalog 组合规则

| 事实 | 拥有者 |
| --- | --- |
| 应用已获准运行 | Release Verification `readApprovedRuntimePin` 及其 P13 / fingerprint / pin 规则 |
| Catalog 真实且完整 | Receipt 或 `adopted-preexisting` 证明，外加独立投影检查 |

就绪 = 二者。禁止：

- 删除 digest 比较以求变绿；
- 改写旧报告去匹配新 Catalog；
- 把钉住 Catalog A 的报告当成 Catalog B 的批准；
- 声称 `new-empty` 已退休 P13；
- 普通启动自动安装镜像内 vendor 包；
- 把停机 CLI 发布叫做“在线”更新。

缓按 digest 隔离。失效通知只加速。漏通知时，新操作也不能永远使用旧 current。长事务不能混用新头与旧内容。

升级/恢复冻结：停止新发布；等待或有界中止在途任务；然后再取恢复点。隐藏页面按钮不是冻结。

## 10. 威胁矩阵与测试 owner

密封前这些行必须先红。除标明浏览器/Hosted 外，证据是真实 PostgreSQL。

| ID | 威胁 | 必须观察到的结果 | Owner |
| --- | --- | --- | --- |
| T01 | 已有 Subject 下新增 Definition | 一个新定义与首 revision；ingest/存值可用；原行不变 | CP-03/05/08 |
| T02 | 冻结 Candidate 重复编译 / 输入排列 | 字节/digest/ID 相同；未改项保留 revision | CP-03 |
| T03 | 页面/HTTP/Agent/SQL 绕过 | 服务端拒绝；Catalog 与 Receipt 行数不变 | CP-02/04 |
| T04 | 同/异幂等键 | 同请求→同 job；不同 digest→冲突；不重复发布 | CP-07 |
| T05 | 两 Candidate 同一前驱 | 一个提交，另一个 `needs-rebase`；heads 不混合 | CP-05/07 |
| T06 | 同自然键不同身份 / alias 归属 | 编译/激活拒绝；无组织或来源优先级 | CP-03/05/09 |
| T07 | 篡改 Candidate、Artifact 或 Authorization | 失败关闭，不物化 | CP-02/04/05 |
| T08 | 入队后撤销 | 执行时重检；除非已线性化否则不激活 | CP-04/05/07 |
| T09 | 物化/校验/head/receipt/提交前故障 | 全部回滚，无可见候选 | CP-05 |
| T10 | 激活成功、响应丢失 | 从 Receipt 恢复；不重复 definition/revision | CP-05/07 |
| T11 | R3 已 current 后恢复 R2 | R2 为 `active-superseded`；不倒拨、不重装 | CP-07 |
| T12 | Worker 崩溃、lease 过期、旧 worker 返回 | 可重新认领；过期 fencing token 不能覆盖；Catalog 副作用 ≤ 1 | CP-05/07 |
| T13 | 漏缓存失效、多进程、滚动重启 | 新操作看到正确 current；在途操作保持捕获 pin | CP-06 |
| T14 | 不支持的 schema / 旧镜像 | 发布前阻断或 not-ready；不忽略未知语义 | CP-03/06 |
| T15 | 文档修订 | 新 revision/head；Binding pin 与值不变 | CP-03/10 |
| T16 | 语义修订 | 旧 Binding/值保持旧 pin | CP-10 |
| T17 | 新 Driver 对 NodeType fallback | 影响被报告；不静默改写历史匹配 | CP-03/10 |
| T18 | 后继遗漏前驱 / 缺失 Artifact | 拒绝；不从 DB 补齐；缺项≠退休 | CP-01/03/05 |
| T19 | 页面新增→vendor 导入→再页面新增 | 所有前驱保全；冲突可见 | CP-08/09 |
| T20 | ingest 未发布属性 / 重处理 | 只产生证据/审核；不铸造 Definition；已接受匹配不变 | CP-08/10 |
| T21 | 发布成功、登记失败 | 发布仍显示成功；登记按原聚合重试 | CP-08/10 |
| T22 | 升级/恢复与在途发布 | 冻结/锁阻断新激活；恢复点无跨越中的 publish | CP-06/12 |
| T23 | 发布后再 `new-empty` 升级并重启 | 不重置、不 seed、不要 #824、不伪造 P13 | CP-06/11 |
| T24 | 真包接管 vs 伪造历史 | 显式接管证明 vs 阻断 | CP-01/02/06 |
| T25 | 关闭发布 / 停管理进程 | 既有 Catalog 可读；新发布禁止或安全排队 | CP-06/07/12 |
| T26 | 应用升级/回退 vs 本地 Catalog 增量 | 合法升级不覆盖本地 Catalog；不兼容镜像不能靠跳过检查运行 | CP-06/12 |
| T27 | 从一致恢复点恢复 | Artifact、投影、授权/receipt、业务值一致 | CP-11/12 |
| T28 | 真实页面状态与刷新 | 诚实的 pending/active/blocked/rebase；无假成功或越权泄露 | CP-08/11 |

M1 至少覆盖 T01–T14、T18、T22–T25、T28，以及既有项目值回归。M2 增补 T15–T21、T26–T27。启用任何范围前，恢复、兼容性、权限和浏览器门禁都不能用“后续矩阵”豁免。

## 11. 明确不做

不重建参数领域模型，不恢复 `parameter_specs` 作为真相，不双写，不改变 source property 身份，不恢复 overlay，不让用户填写 hash，不让未发布草稿参与匹配，不存储任意可执行约束，不把发布变成设备写通道，不对当前实例再次 bootstrap，不 seed Catalog，不改旧 migration，不捆绑 #824，也不把当前 main 绿色当成目标机证据。
