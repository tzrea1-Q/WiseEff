# 参数目录 API 与 legacy 标识符迁移

> English: [English](../../design-docs/parameter-catalog-api-transition.md)

状态：这是 [GitHub issue #677](https://github.com/tzrea1-Q/WiseEff/issues/677) 已锁定的产品与兼容性决策。S8-CON 冻结本页对应的 generated OpenAPI、route manifest、DTO schema、稳定 `details.reason` 与 typed frontend client。HTTP handler 仍由 S8-READ、S8-GOV、S8-LEG 拥有，本页不声称运行时已实现。

## 决策

WiseEff 新增规范的 `/api/v2/catalog/*` 资源命名空间。系统不会就地改变 `ParameterSpec` 的含义，也不会把无关 API 整体升级到 `/api/v3`。

目标合同把 legacy 接口混合在一起的五类概念彻底分开：

1. 不可变的 Platform Catalog release、subject、definition 与 definition revision；
2. Organization 拥有的 subject registration，以及每个 registration 唯一保留的 placement；
3. 不可变的 parameter observation 及其产生的 review work；
4. Organization 编写的 definition proposal 与 Platform publication decision；
5. 引用规范 definition 和固定 revision 的 project binding 与 value。

现有 project topology 与 binding 路径继续留在 `/api/v2`，但其一方消费者必须在同一次协调切换中迁移到规范 ID 和 DTO 字段。只有本页明确列出的 legacy 读接口才有有界适配期。任何目标写入都不得双写 legacy 模型。

产品负责人于 2026-08-31 锁定以下策略：

- 有权限的用户可在本 Organization 注册 subject 之前浏览已发布 subject 和 definition。响应返回 `registration.status = "unregistered"`；依赖 registration 的写入返回 `registration-required`。
- 第一版 Agent 只能读目录。Agent 不能创建或提交 proposal，不能注册 subject、修改 placement 或处理 review work。
- Organization Admin 管理本 Organization 的 registration、placement、review resolution 和 proposal submission。Platform Admin 审核 publication proposal，可跨 Organization 读取诊断，但不能修改 Organization 结构。任何人都不能接受自己提交的 proposal。
- 规范命名空间上线时立即退役 legacy 结构写接口。符合条件的 legacy 读接口至少保留两个生产发布或 90 天，取较晚者；且只有本页全部退出门槛通过后才可退役。

## 决策依据

本合同对照 `406c23bcaf0dcfca284de3135e27bfcd19c29c4e` 的 current `origin/main`，并使用以下已接受的 Wayfinder 输入完成校核。尚未集成到 `main` 的 accepted decision commit 只能作为设计证据；本页不会把它误报成 `main` 当前实现。

| 输入 | 本页使用的 accepted evidence |
| --- | --- |
| [Inventory the current parameter-catalog contracts and consumers](https://github.com/tzrea1-Q/WiseEff/issues/669) | [`f982c76a`](https://github.com/tzrea1-Q/WiseEff/commit/f982c76a063f3c8bc0a7366d5253243ecba2866f)：stable-ID 与 consumer inventory；旧 Effective/Governance/overlay surfaces 只是 retirement inputs。 |
| [Classify legacy parameter rows and repair semantics](https://github.com/tzrea1-Q/WiseEff/issues/670) | [`000f617b`](https://github.com/tzrea1-Q/WiseEff/commit/000f617ba9810adda4798b4bc4b2bdfed95b4c39)：R0-R10 classification 与禁止 weak identity inference。 |
| [Capture a representative populated-database rehearsal fixture](https://github.com/tzrea1-Q/WiseEff/issues/671) | [`6c3adfc3`](https://github.com/tzrea1-Q/WiseEff/commit/6c3adfc35c0e3be6d5d381013dace9408190380e)：严格十案例 PostgreSQL fixture，包括必须保持不同的 same-key R6/R8 rows。 |
| [Choose the canonical parameter-catalog relational model](https://github.com/tzrea1-Q/WiseEff/issues/672) | [`542c7a8b`](https://github.com/tzrea1-Q/WiseEff/commit/542c7a8bbce3bd6bb230b0d020d23d10af5182a9)：release-scoped subject lifecycle 与稳定 definition/revision/registration/placement identities。 |
| [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673) | [`b5bf52cc`](https://github.com/tzrea1-Q/WiseEff/commit/b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb)：完整 read-only runtime facet、nominal IDs、exact current/pinned snapshots、deterministic Catalog pages、exact revision history、Catalog publication facts、tagged results 与 kernel-owned transactions。 |
| [Choose platform schema publication and synchronization semantics](https://github.com/tzrea1-Q/WiseEff/issues/674) 与 [Choose organization registration and placement semantics](https://github.com/tzrea1-Q/WiseEff/issues/675) | [`9fe269d4`](https://github.com/tzrea1-Q/WiseEff/commit/9fe269d4facc31b49fc1e0535d2d51ba7140644b)：集成 ADR-0040/0041/0042 的 publication、synchronization、registration、placement、observation、proposal 语义。 |
| [Prototype the single-page parameter-definition experience](https://github.com/tzrea1-Q/WiseEff/issues/676) | [`9c803557`](https://github.com/tzrea1-Q/WiseEff/commit/9c803557a55803ccca79c20eadd033f57d4729e0)：单页 definitions、Registration/Placement context、Review Queue、timeline，以及 ready/unregistered/empty/loading/error 状态。 |
| [Choose populated-data cutover, archive, and rollback strategy](https://github.com/tzrea1-Q/WiseEff/issues/678) | [`1839398b`](https://github.com/tzrea1-Q/WiseEff/commit/1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d)：唯一 R0-R10 production disposition、append-only typed mapping head、immutable Archive evidence 与 mandatory pre-switch semantic comparison。 |

修复后的 issue #673 read facet 可闭合本决策全部 canonical Catalog read，且不暴露 transaction，也不向 Kernel 增加 route。HTTP handler 适配该 interface；不得重复实现 matching、alias/lifecycle interpretation、revision selection、pagination、materialization 或 transaction coordination。Issue #678 是 production R0-R10 classification 与 mapping disposition 的唯一所有者；本 API 只投影 typed mapping head，绝不重新分类 legacy row。

## 范围与非目标

本决策固定路由、资源所有权、DTO 状态、授权、错误原因、ID 查询结果、消费者处置和退役规则。S8-CON 现拥有 generated OpenAPI、DTO、路由、错误与 client 冻结。它不负责：

- 实现 HTTP handler、数据库迁移、mock adapter 或 UI；
- 决定 [Choose the catalog kernel interface and transaction boundary](https://github.com/tzrea1-Q/WiseEff/issues/673) 所属的目录内核方法名或事务实现；
- 重写 project value 编辑、DTS 文本 draft、设备调试或 reload 行为，除非只是改用新的目录身份；
- 创建实现 tickets 或授权生产发布；
- 向公共客户端公开原始迁移行、archive payload、评分内部信息或关系诊断。

## 合同词汇

| 术语 | API 含义 | 所有者 | 可变性 |
| --- | --- | --- | --- |
| `CatalogRelease` | synchronizer 物化的不可变 manifest；只能有一个 current release。 | Platform synchronizer | 只追加；current pointer 原子切换。 |
| `CatalogSubject` | 稳定、带类型的 `Driver` 或 `NodeType` 身份；当前成员状态来自 current release。 | Platform synchronizer | 身份稳定；release membership 不可变。 |
| `ParameterDefinition` | 按 `(subjectId, propertyKey)` 唯一的正式属性合同。 | Platform synchronizer | 身份稳定，指向一个 current immutable revision。 |
| `DefinitionRevision` | definition 内容的不可变版本，包括只改文档的版本。 | Platform synchronizer | 不可变。 |
| `SubjectRegistration` | Organization 使用一个 current-release active subject 的决定。 | Organization | `active` 或 `retired`；身份保留。 |
| `SubjectPlacement` | registration 唯一保留的导航位置。 | Organization | 原地 rename/reparent，不 hard delete。 |
| `ParameterObservation` | 从来源中观测到属性的不可变证据。 | 可信内部 ingest | 不可变。 |
| `ParameterReviewItem` | unknown、ambiguous、retired 或 placement conflict 证据形成的工作项。 | Organization | 显式 resolution 状态机。 |
| `DefinitionProposal` | Organization 的发布意图；acceptance 不创建目录行。 | Organization 作者、Platform 审核者 | draft/submitted/accepted/rejected/withdrawn。 |
| `ProjectParameterBinding` | project/logical-node/registration/definition 的稳定关联。 | Project workflow | 通过乐观并发更新 effective revision 和 current value pointer。 |
| `ProjectValue` | 固定一个 definition revision 的不可变值。 | Project workflow | 不可变。 |

所有 ID 都是不透明字符串。客户端不得根据 property key、subject name、module、Organization 或 source locator 构造 ID。

## 命名空间、响应 envelope 与一致性

### 目录锚点

`GET /api/v2/catalog` 是发现与 readiness 文档。成功的规范目录读取必须锚定到一个已物化的 current release：

```json
{
  "item": {
    "catalogReleaseId": "crel_01K...",
    "releaseName": "2026.08.3",
    "releaseSequence": 42,
    "publishedAt": "2026-08-31T02:00:00Z",
    "materializedAt": "2026-08-31T02:01:12Z",
    "status": "ready",
    "links": {
      "subjects": "/api/v2/catalog/subjects",
      "definitions": "/api/v2/catalog/definitions"
    }
  }
}
```

规范目录响应包含 `X-WiseEff-Catalog-Release: <catalogReleaseId>`。集合 envelope 使用 `items`、`nextCursor` 和 `catalogReleaseId`；单项 envelope 使用 `item`。分页使用 cursor，并以 `(stable sort key, id)` 做确定性 tie-breaker。后续 OpenAPI 合同可固定有界 page limit，但不得改变这些语义。

依赖当前发布状态的写入发送客户端读取时的 `X-WiseEff-Catalog-Release`。可变 Organization 资源和 proposal 还必须使用响应 `ETag` 对应的 `If-Match`。release 过期返回 `release-drift`；资源过期返回 `revision-conflict` 或 `proposal-stale`。客户端必须刷新并要求用户重新确认，不能静默重试治理写入。

### 默认读取规则

- subject 和 definition 列表默认读取 current release 的 active membership。
- definition 列表默认 `lifecycle=active`；只有显式 filter 才返回 `deprecated` 或 `retired`，但历史读取始终保留。
- 未注册的已发布 subject 及其 definitions 仍可读。`registration` 是独立 projection，不能作为改写 Platform truth 的隐式 filter。
- 历史读取必须指定精确 `catalogReleaseId` 或 `definitionRevisionId`，不得用 current release 重新解释历史。
- Organization scope 来自路径和可信授权上下文；body 不能宣称另一个 effective Organization。

## 目标资源矩阵

以下全部是目标合同，不是当前实现证据。

| 资源 | Method 与 path | 合同 |
| --- | --- | --- |
| Catalog document | `GET /api/v2/catalog` | current release、readiness 和规范 links。 |
| Subjects | `GET /api/v2/catalog/subjects` | 按 type、lifecycle、registration state、placement 或文本检索。 |
| Subject detail | `GET /api/v2/catalog/subjects/{subjectId}` | 稳定身份、current membership、aliases、registration projection、placement 和 definition counts。 |
| Subject definitions | `GET /api/v2/catalog/subjects/{subjectId}/definitions` | 一个 subject 在 current release 中的 definitions。 |
| Definitions | `GET /api/v2/catalog/definitions` | current definitions；支持 subject、property key、lifecycle、registration 和文本 filter。 |
| Definition detail | `GET /api/v2/catalog/definitions/{definitionId}` | formal owner、current revision、registration/placement projection、constraints 和 scope 内 usage summary。 |
| Definition revisions | `GET /api/v2/catalog/definitions/{definitionId}/revisions` | 不可变 revision 倒序列表。 |
| Pinned revision | `GET /api/v2/catalog/definitions/{definitionId}/revisions/{revisionId}` | 精确不可变 revision，绝不替换成 current revision。 |
| Definition timeline | `GET /api/v2/catalog/definitions/{definitionId}/timeline` | 对 caller 安全的 publication 与 audit references，不含原始迁移行。 |
| Registrations | `GET, POST /api/v2/organizations/{organizationId}/subject-registrations` | 列表或显式注册一个 current-release active subject。 |
| Registration detail | `GET /api/v2/organizations/{organizationId}/subject-registrations/{registrationId}` | 稳定 status、method、subject 与 current placement link。 |
| Registration lifecycle | `POST .../{registrationId}/retire`、`POST .../{registrationId}/restore` | 保留 registration、placement、bindings、values 与 history。 |
| Placement | `GET, PATCH .../{registrationId}/placement` | 用 `If-Match` 读取或 rename/reparent 唯一保留的 placement。 |
| Observations | `GET /api/v2/organizations/{organizationId}/parameter-observations` | 只读 evidence list；创建只允许内部调用。 |
| Observation detail | `GET /api/v2/organizations/{organizationId}/parameter-observations/{observationId}` | 安全 evidence、source reference、recognition outcome 与 review link。 |
| Review queue | `GET /api/v2/organizations/{organizationId}/parameter-review-items` | unknown、ambiguous、placement-conflict、retired-registration 工作。 |
| Review detail | `GET /api/v2/organizations/{organizationId}/parameter-review-items/{reviewItemId}` | evidence、candidates、status 与 allowed resolutions。 |
| Review resolution | `POST .../{reviewItemId}/resolve` | 单一显式 resolution；绝不创建 Organization definition。 |
| Proposals | `GET, POST /api/v2/catalog/definition-proposals` | 按角色 scope 的列表或 Organization 编写的 draft；Organization 从可信上下文得到。 |
| Proposal detail | `GET /api/v2/catalog/definition-proposals/{proposalId}` | 不可变 base release/revision 与可变 draft metadata。 |
| Proposal workflow | `POST .../{proposalId}/submit`、`/withdraw`、`/accept`、`/reject` | Org Admin submit/withdraw；另一名 Platform Admin accept/reject；acceptance 只记录 publication intent。 |
| Legacy identifier | `GET /api/v2/catalog/legacy-identifiers/{legacyType}/{legacyId}` | 有界、带授权的精确 mapping lookup；不提供搜索或候选暴露。 |
| Project bindings | `GET /api/v2/projects/{projectId}/parameter-bindings` | 保留原 path；协调切换后返回规范 binding DTO 与 ID。 |
| Binding history/compare | 现有 `/api/v2/projects/{projectId}/bindings/{bindingId}/history` 与 `/compare` | 保留 path；entry 固定规范 definition revision 和 value。 |
| Project drafts | 现有 binding 与 node-enablement draft paths | 保留产品行为；input 通过规范 binding/definition identity 解析。 |
| Operator diagnostics | `/api/v2/operator/parameter-catalog/*` | 仅 deployment operator 可用的 reconciliation 与迁移诊断；公共 DTO 不得链接。 |

### Catalog Kernel read 闭合

Canonical Catalog read 只能使用修复后 issue #673 在 `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb` 固定的 `CatalogRuntime`。Current read 调用 `loadCurrentCatalog(expectedPin)`；historical read 调用 `loadPinnedCatalog(exactPin)`。HTTP adapter 只验证 wire syntax 并映射 tagged result。它不能读取 Catalog tables、调用 raw Catalog repository、解释 alias/lifecycle、选择 current revision、对 Kernel page 排序或 post-filter，也不能用另一个 Catalog source 填补 missing result。

| Canonical Catalog read route | Typed Kernel read 与授权组合 |
| --- | --- |
| `GET /api/v2/catalog` | `loadCurrentCatalog(expectedPin)` 与 `snapshot.release`；readiness status 来自独立 readiness seam。 |
| `GET /api/v2/catalog/subjects` | `listSubjects(query)`；需要 Organization filter 时，在 Kernel pagination 前提供 authorized ID selection。 |
| `GET /api/v2/catalog/subjects/{subjectId}` | `getSubject(subjectId)` 提供 stable identity、captured membership、aliases 与 Definition counts；Registration/Placement projection 来自其 owning seam。 |
| `GET /api/v2/catalog/subjects/{subjectId}/definitions` | `listDefinitions({ scope: { kind: "subject", subjectId }, ... })`。 |
| `GET /api/v2/catalog/definitions` | `listDefinitions({ scope: { kind: "all" }, ... })`；authorized ID selection 由 Kernel 在 ordering/paging 前应用。 |
| `GET /api/v2/catalog/definitions/{definitionId}` | `getDefinitionById(definitionId)` 提供 release-selected revision；Registration、Placement 与 usage projection 来自各自 owning seam。 |
| `GET /api/v2/catalog/definitions/{definitionId}/revisions` | `listDefinitionRevisions({ definitionId, ... })`；reverse order 与 release-bound cursor 由 Kernel 拥有。 |
| `GET /api/v2/catalog/definitions/{definitionId}/revisions/{revisionId}` | `getDefinitionRevision({ definitionId, revisionId })`；`revision-unavailable` 绝不 fallback 到 selected revision。 |
| `GET /api/v2/catalog/definitions/{definitionId}/timeline` | `listDefinitionTimelineFacts({ definitionId, ... })` 提供 immutable Catalog publication/revision facts；authorized application composer 合并独立 History/Audit events。 |

Definition timeline composition seam 是严格边界。Kernel facts 只包含 release/revision publication facts；actor、Proposal/Review、Registration/Placement、Binding/value、usage 与 authorization-sensitive events 来自独立 History/Audit seam。Application composer 使用绑定 Catalog release 与 History/Audit high-water marks 的 composite cursor 合并 authorized streams；HTTP 只映射组合结果，不执行 Catalog join。

Registration、Placement、usage、Observation、Review Queue、Proposal、legacy-ID、project Binding 与 operator-diagnostic resource 仍在 Catalog Kernel 外。其 owning module 可使用 nominal Catalog IDs、captured snapshot 或 tagged Kernel result，但不能为 `CatalogRuntime` 增加 write 或 raw repository。

### Registration command

Registration 与 Review resolution 共用以下 discriminated `PlacementIntent`：

- `{ "mode": "use-default" }` 表示用户显式选择本 Organization 的 reserved unclassified root；它绝不是服务端 fallback，也不允许服务端猜测 parent；
- `{ "mode": "choose-parent", "parentPlacementId": "spla_...", "displayName": "..." }` 表示用户显式选择现有 parent 与 retained display label。

```json
{
  "subjectId": "csub_01K...",
  "placement": {
    "mode": "choose-parent",
    "parentPlacementId": "spla_root_drivers",
    "displayName": "Charging ICs"
  },
  "reason": "Adopt the published SC8562 schema"
}
```

命令必须携带当前 `X-WiseEff-Catalog-Release` anchor 与 `Idempotency-Key`。服务端从可信上下文得到 `organizationId`、actor 和 registration method。`choose-parent` 必须验证 parent 对同一 Organization 可见、处于 active lifecycle、符合 child taxonomy kind，且不会引入 cycle 或并发 placement conflict。Driver placement 可选择 reserved Driver root 或合法 business-category parent。NodeType placement 可选择它的 reserved root、合法 business-category parent，或只在 taxonomy rule 允许时选择 active 且已注册的 Driver/NodeType parent。可见的同 Organization parent 若 taxonomy kind 错误、已 retired 或形成 cycle，则返回 `invalid-placement-parent`；scope 外 parent 按 scope hiding 处理。

一个事务创建 Registration、它唯一的 retained Placement，并追加 audit record；任一失败都回滚三项写入。同一 `Idempotency-Key` 与 request fingerprint 的精确重放返回已保存成功结果，不新增 Placement 或 audit event；相同 key 对应不同 fingerprint 返回 `revision-conflict`。已有 active Registration 只有在 retained Placement 精确表达所请求 intent 时才能幂等，否则返回 `placement-conflict`。注册 unpublished 或 retired subject 必须 fail closed。

### Review resolution

`POST /api/v2/organizations/{organizationId}/parameter-review-items/{reviewItemId}/resolve` 必须携带以下三项 precondition：

```text
X-WiseEff-Catalog-Release: crel_01K42
If-Match: "review-item-prev_01KAMBIG-v7"
Idempotency-Key: resolve-review-prev-01KAMBIG-v7
```

显式选择 default placement：

```json
{
  "resolution": {
    "type": "register-subject",
    "subjectId": "csub_01KSC8562",
    "placement": {
      "mode": "use-default"
    }
  },
  "reason": "Authoritative compatible evidence confirms the published driver"
}
```

显式选择 parent：

```json
{
  "resolution": {
    "type": "register-subject",
    "subjectId": "csub_01KSC8562",
    "placement": {
      "mode": "choose-parent",
      "parentPlacementId": "spla_root_drivers",
      "displayName": "Charging ICs"
    }
  },
  "reason": "Place the selected published driver under the approved category"
}
```

不提供新 Placement intent 的 restore：

```json
{
  "resolution": {
    "type": "restore-registration",
    "registrationId": "sreg_01KACME"
  },
  "reason": "Restore the retained Organization registration and placement"
}
```

允许的 `resolution.type`：

- `register-subject`：注册 current-release active subject，并根据必填的 discriminated `placement` intent 创建唯一 retained Placement；
- `restore-registration`：恢复 `registrationId` 指定的 retained Registration；该 variant 拒绝 `placement` 字段，复用 retained Placement，绝不创建第二个 Placement；
- `mark-out-of-scope`：关闭 evidence，不创建结构 truth；
- `open-definition-proposal`：为缺失的 Platform definition 创建关联 draft proposal。

对 `register-subject`，一个事务同时创建 Registration、Placement、Review Item resolution 与 audit record；失败后不得留下部分 Registration 或已 resolved 的 Review Item。Catalog release anchor 必须仍为 current，否则返回 `release-drift`。Review Item 的 `If-Match` 必须指向 unresolved current ETag；缺失/过期 tag 或 item 已 resolved 时返回 `revision-conflict`。同一 idempotency key 与完整 request fingerprint 的精确重放返回已保存结果，不新增 Placement、resolution 或 audit event；同 key 不同 fingerprint 返回 `revision-conflict`。已有精确 Registration/Placement 可用于解析 item；retained Placement 冲突时返回 `placement-conflict`，且 item 保持 unresolved。

上述 `choose-parent` 示例的原子成功响应返回 `ETag: "review-item-prev_01KAMBIG-v8"` 与以下 body：

```json
{
  "item": {
    "reviewItem": {
      "id": "prev_01KAMBIG",
      "status": "resolved"
    },
    "registration": {
      "id": "sreg_01KACME",
      "subjectId": "csub_01KSC8562",
      "placement": {
        "id": "spla_01KCHARGING",
        "parentPlacementId": "spla_root_drivers",
        "displayName": "Charging ICs"
      }
    },
    "catalogReleaseId": "crel_01K42"
  }
}
```

unknown 或 ambiguous evidence 不能直接解析成新 definition。人工选择只记录已选 existing published Subject 并解析 Review Item/evidence decision；它不创建 Definition、DefinitionRevision 或 recognized Binding。任何后续 Binding recognition 都必须走自身独立授权的普通命令。`open-definition-proposal` 只创建 proposal，不创建 subject、definition、revision、registration、placement 或 binding。

## DTO 与产品状态示例

### Ready 且已注册

```json
{
  "item": {
    "id": "csub_01KSC8562",
    "type": "Driver",
    "canonicalName": "southchip,sc8562",
    "membership": { "status": "active", "catalogReleaseId": "crel_01K42" },
    "registration": {
      "status": "active",
      "id": "sreg_01KACME",
      "method": "explicit",
      "placement": {
        "id": "spla_01KCHARGING",
        "displayName": "Charging ICs",
        "parentPlacementId": "spla_root_drivers"
      }
    },
    "definitionCounts": { "active": 14, "deprecated": 1, "retired": 0 },
    "reviewCount": 0
  }
}
```

### 已发布但未注册

```json
{
  "item": {
    "id": "csub_01KSC8562",
    "type": "Driver",
    "canonicalName": "southchip,sc8562",
    "membership": { "status": "active", "catalogReleaseId": "crel_01K42" },
    "registration": { "status": "unregistered" },
    "definitionCounts": { "active": 14, "deprecated": 1, "retired": 0 },
    "availableActions": ["register"]
  }
}
```

客户端可展示 14 个已发布 definitions，但在 registration 成功前，binding 或 value command 返回 `registration-required`。浏览 subject 不得触发自动注册。

### Definition detail 与 pinned revision

```json
{
  "item": {
    "id": "pdef_01KGPIOINT",
    "subject": {
      "id": "csub_01KSC8562",
      "type": "Driver",
      "canonicalName": "southchip,sc8562"
    },
    "propertyKey": "sc,gpio-int",
    "lifecycle": "active",
    "currentRevision": {
      "id": "drev_01K7",
      "revisionNumber": 7,
      "valueShape": { "kind": "phandle-array" },
      "constraints": { "minItems": 1, "maxItems": 1 },
      "documentation": "Interrupt GPIO reference.",
      "publishedInCatalogReleaseId": "crel_01K42"
    },
    "registration": { "status": "active", "id": "sreg_01KACME" },
    "usageSummary": { "policyCount": 2, "projectCount": 6, "currentValueCount": 5 },
    "links": {
      "revisions": "/api/v2/catalog/definitions/pdef_01KGPIOINT/revisions",
      "timeline": "/api/v2/catalog/definitions/pdef_01KGPIOINT/timeline"
    }
  }
}
```

只改文档的 revision 会改变 `currentRevision.id`，但不会重写 binding 的 `effectiveRevisionId` 或 value 固定的 `definitionRevisionId`。

### Review item

```json
{
  "item": {
    "id": "prev_01KAMBIG",
    "organizationId": "org_acme",
    "reason": "observation-ambiguous",
    "status": "open",
    "observation": {
      "id": "pobs_01K9",
      "propertyKey": "interrupt-gpios",
      "sourceRef": { "kind": "project-config-revision", "id": "cfgrev_01K3" }
    },
    "candidates": [
      { "subjectId": "csub_01KA", "evidence": ["compatible-match"] },
      { "subjectId": "csub_01KB", "evidence": ["ancestor-compatible-match"] }
    ],
    "allowedResolutions": ["register-subject", "mark-out-of-scope", "open-definition-proposal"]
  }
}
```

candidates 是已发布 subjects，不是 provisional definitions。原始评分和迁移行 payload 只留在内部。

### 已提交 proposal 与 canonical binding

```json
{
  "item": {
    "id": "dpro_01KNEWPROP",
    "organizationId": "org_acme",
    "status": "submitted",
    "base": {
      "catalogReleaseId": "crel_01K42",
      "definitionId": "pdef_01KGPIOINT",
      "definitionRevisionId": "drev_01K7"
    },
    "requestedChange": {
      "kind": "revise-definition",
      "documentation": "Clarify the interrupt cell contract."
    },
    "submittedByPersonId": "person_org_admin_1",
    "acceptedByPersonId": null,
    "publicationIntentRef": null,
    "version": 3
  }
}
```

另一名 Platform Admin 接受后，`publicationIntentRef` 记录 repository 或 publication-workflow reference。它仍不包含新 definition/revision ID；只有之后的 Catalog release 发布并同步后，才会出现相应 ID。

保留的 project binding path 返回 canonical identity，不再返回 `ParameterSpec` projection：

```json
{
  "id": "pbind_01KPROJECT",
  "projectId": "project_1",
  "logicalNodeId": "lnode_sc8562_1",
  "subjectRegistrationId": "sreg_01KACME",
  "definitionId": "pdef_01KGPIOINT",
  "effectiveRevisionId": "drev_01K6",
  "currentValueId": "pval_01KVALUE",
  "recognizedAgainstCatalogReleaseId": "crel_01K41"
}
```

release/revision IDs 会明确显示刻意保留的旧 effective revision，不能把它伪装成 current definition。

### Empty 与 loading

空集合是成功响应，且必须说明原因：

```json
{
  "items": [],
  "nextCursor": null,
  "catalogReleaseId": "crel_01K42",
  "emptyReason": "no-filter-match"
}
```

`emptyReason` 只能是 `no-registrations`、`no-definitions`、`no-review-work` 或 `no-filter-match`。loading 是客户端状态，不是服务端资源状态。加载期间只有明确标注 stale 才可保留旧 release 内容，并且不得开放基于旧 release 的写入。

## 授权矩阵

授权必须使用服务端拥有的可信 principal 与 Organization context。header 或 body 不能自行宣称 role、Organization、Agent identity 或 System identity。

| 能力 | Ordinary user | Organization Admin | Platform Admin | Agent | Trusted System / synchronizer |
| --- | --- | --- | --- | --- | --- |
| 读取 active subjects/definitions | 已授权 Organization scope | 是 | 是，可跨 Organization 读 projection | 与 invoking principal 相同读 scope | 内部 |
| 读取 scope 内 usage/history | 仅已授权 project/org | home Organization | 跨 Organization support read，带 audit | 与 invoking principal 相同 | 内部 |
| register/retire/restore subject | 否 | 仅 home Organization | 否 | 否 | 仅 unique authoritative proof 自动注册；observation 绝不自动 restore |
| rename/reparent placement | 否 | 仅 home Organization | 否 | 否 | 无公共 System route |
| 读取 observations/review queue | 自己有权的工作 | home Organization | 跨 Organization support read | invoking principal 有权时只读 | 内部 |
| 使用显式 Placement intent 解析 review work | 否 | 仅 home Organization | 否 | 否 | 只有唯一确定性证明时内部 recognition 可关闭；对于 ambiguous evidence，不能代替人工选择 `use-default` 或 `choose-parent` |
| create/submit/withdraw proposal | 否 | 仅 home Organization | 否 | 否 | 否 |
| accept/reject proposal | 否 | 否 | 是，但不能处理自己的 proposal | 否 | 否 |
| materialize/switch Catalog release | 否 | 否 | 无公共 API | 否 | 仅 synchronizer |
| 读取原始 migration diagnostics | 否 | 否 | 还必须具有独立 deployment-operator authority | 否 | 仅 operator/reconciliation jobs |

Platform Admin 不等于 deployment Operator。公共 router 上探测 operator-only route 返回 `404 migration-diagnostics-not-public`；到达 operator router 但无 operator authority 时返回 `403 forbidden`。

所有 Organization mutation、proposal transition、System auto-registration 和 release switch 都需要 trusted invocation context 与 audit record。只有 Organization Admin 可为 ambiguous Review Item 提供 `PlacementIntent`；Agent、Platform Admin 与 System principal 均不得冒充这一人工选择。Proposal acceptance 必须满足 `acceptedByPersonId != submittedByPersonId`。

## 错误合同

目标沿用 WiseEff 现有 error envelope 与通用顶层 code。稳定的领域差异放在 `error.details.reason`，客户端不能解析 `message`。

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "The catalog release changed. Refresh before continuing.",
    "details": {
      "reason": "release-drift",
      "expectedCatalogReleaseId": "crel_01K41",
      "currentCatalogReleaseId": "crel_01K42",
      "retryable": true
    },
    "requestId": "req_01K..."
  }
}
```

| `details.reason` | HTTP / 顶层 code | 场景 | 客户端行为 |
| --- | --- | --- | --- |
| `catalog-not-ready` | 503 / `SERVICE_UNAVAILABLE` | 目录物化或 readiness 未完成/失败。 | 禁止写入；遵守 `Retry-After`；显示 error，不能显示 empty。 |
| `release-drift` | 409 / `CONFLICT` | 客户端 release anchor 已不是 current。 | 刷新并重新确认。 |
| `subject-not-published` | 404 / `NOT_FOUND` | named/current release 中不存在 subject。 | 不推断、不创建。 |
| `subject-retired` | 409 / `CONFLICT` | mutation 指向 retired current-release membership。 | 展示 lifecycle，不自动 restore。 |
| `definition-not-found` | 404 / `NOT_FOUND` | scope 内不存在 canonical 或 pinned definition。 | 展示 not found。 |
| `definition-retired` | 409 / `CONFLICT` | 新 binding/value mutation 指向 retired definition。 | 保留历史读，阻止 mutation。 |
| `legacy-id-ambiguous` | 409 / `CONFLICT` | typed mapping 有多个可证明 disposition。 | 不暴露 candidates；需要 operator reconciliation。 |
| `legacy-id-archived` | 410 / `GONE` | legacy row 已从 operational reads 归档。 | 展示历史不可用。 |
| `legacy-surface-retired` | 410 / `GONE` | 调用已删除 legacy route/mutation。 | 迁移到 successor link，不重试。 |
| `registration-required` | 409 / `CONFLICT` | binding/value action 需要 active registration。 | 仅向 Org Admin 提供显式注册，不自动写。 |
| `placement-conflict` | 409 / `CONFLICT` | registration/placement intent 与保留身份或 current placement 冲突。 | 刷新并要求用户处理。 |
| `invalid-placement-parent` | 409 / `CONFLICT` | 可见的同 Organization parent taxonomy kind 错误、已 retired 或将形成 cycle。 | Review Item 保持 unresolved；要求用户重新显式选择合法 parent。 |
| `observation-ambiguous` | 409 / `CONFLICT` | caller 尝试绑定 unresolved ambiguous evidence。 | 打开关联 review item。 |
| `proposal-stale` | 409 / `CONFLICT` | proposal base release/revision 已过期。 | 作为新的 reviewed proposal revision rebase。 |
| `proposal-self-approval-forbidden` | 403 / `FORBIDDEN` | submitter 尝试接受自己的 proposal。 | 需要另一名 Platform Admin。 |
| `revision-conflict` | 409 / `CONFLICT` | Review `If-Match` 缺失/过期、item 已 resolved，或同一 idempotency key 被用于不同 fingerprint。 | 刷新；不得静默覆盖或重复治理写入。 |
| `forbidden` | 403 / `FORBIDDEN` | 已认证 principal 缺 action/scope。 | 不泄露 scope 外数据。 |
| `migration-diagnostics-not-public` | 404 / `NOT_FOUND` | 公共 caller 探测内部诊断 route。 | 按不存在处理。 |

后续实现必须在共享 API error registry 中新增 `SERVICE_UNAVAILABLE` / 503；本次决策不修改生产代码。系统必须先执行 scope hiding，再区分 unknown release、subject、definition 或 legacy ID 的具体原因。

## Legacy 标识符映射

### Typed resolver

有界 resolver 只接受以下 allow-list `legacyType`：

- `parameter-spec`；
- `parameter-spec-version`；
- `project-parameter-binding`；
- `project-parameter-binding-revision`；
- `parameter-subject`；
- `parameter-placement`；
- `parameter-module`。

精确且有权限的 mapping 返回：

```json
{
  "item": {
    "legacyType": "parameter-spec",
    "legacyId": "spec-sc8562-gpio-int",
    "disposition": "mapped",
    "target": {
      "kind": "parameter-definition",
      "id": "pdef_01KGPIOINT",
      "href": "/api/v2/catalog/definitions/pdef_01KGPIOINT"
    },
    "historicalOnly": false
  }
}
```

resolver 只能 lookup，且不拥有分类权。它读取 issue #678 在 `1839398b0d4fe1c77dec5c8fe8ef7835a2dc210d` 决定的当前 append-only typed mapping head，直接投影 outcome，不重新解释 source shape、property name 或 payload。它不允许 prefix search、reverse enumeration、raw source fields、candidate list、confidence score 或 archive payload。有权限的 operational mapping、ReviewEvidence 或 DefinitionProposal 可返回对应 typed target；archive-only outcome 返回 410，ambiguous/blocked mapping 返回 409，unknown 或 unauthorized ID 返回 404。resolver 绝不把 ReviewEvidence 或 DefinitionProposal 转换为 ParameterObservation、Definition 或 Revision。响应携带与 legacy read 相同的 deprecation headers 和 sunset。

### Mapping 与 archive 矩阵

| Legacy identity/reference | issue #678 typed mapping 的 API projection | 禁止的 API inference |
| --- | --- | --- |
| R4/R5 `parameter_specs.id` | 映射到 pinned Catalog Release 已物化的精确 `ParameterDefinition.id`，旧 ID 保留在 typed map；只有 R4/R5 spec row 可指向 Definition。 | 禁止根据 property/name 相似度或另一个 release 选择 Definition。 |
| R6 `parameter_specs.id` | 生产 primary disposition 为 `ReviewEvidence`，同时保留 immutable Archive evidence 与 typed mapping。 | definition-shaped R6 spec ID 绝不直接映射为 `ParameterObservation`。只有具备完整 project、logical-node、source-revision provenance 的另一个 occurrence graph，才能凭该 graph 自身的 source identity 独立创建 ParameterObservation。 |
| R8 `parameter_specs.id` | 映射为 `DefinitionProposal`，同时保留必要的 immutable Archive 与 typed mapping evidence。 | R8 spec ID 绝不直接映射为 `ParameterObservation`、`ParameterDefinition` 或 `DefinitionRevision`。 |
| `parameter_spec_versions.id` | 只有 R4/R5 version 可映射到 pinned Catalog Release 已物化的精确 immutable `DefinitionRevision.id`，历史 link 保持 pinned；R6/R8 version 仅作为 immutable Archive/typed-mapping evidence 保留，并依附于 parent ReviewEvidence/DefinitionProposal outcome。 | 绝不拿 current revision 替代，也不把 R6/R8 version 提升为 Revision。 |
| `project_parameter_bindings.id` | 关联可证明时保留 stable ID，否则一对一映射新 stable binding ID。 | subject/definition identity ambiguous 时阻断，禁止 property-key-only 推断。 |
| Binding revision/workflow reference | 映射到 binding history 与 pinned definition/value references。 | 归档 workflow evidence，不制造 canonical binding。 |
| Legacy subject ID | 只有 authoritative typed Driver/NodeType identity proof 才映射。 | unknown/ambiguous root 进入 ReviewEvidence 或 Archive，绝不成为 Subject。 |
| Placement/module ID | ownership 与 registration 精确时保留 placement ID；module/category 只有身份可证明时才可映射 navigation placement。 | grouping-only module 归档；module equality 不证明 subject/definition identity。 |
| Audit target | 保留 immutable legacy target fields，精确时新增 mapped target reference。 | 保留 legacy audit evidence 与 archived/ambiguous disposition，绝不重写历史。 |
| Knowledge reference | 只有 exact mapping 才重写 definition/revision，并保留 legacy metadata。 | 标记 unresolved，排除出 current definition picker，不静默 retarget。 |
| Debug/reload reference | cutover 时通过精确 binding/definition map 解析并固定 revision。 | 阻断 operation，交给 operator reconciliation；禁止按 property key 选择。 |
| Export/import ID | 新 export 只含 canonical IDs 与 schema version；有界 legacy import 每行经过 typed mapping。 | 用稳定 reason 拒绝该行；禁止部分创建结构。 |
| Deep link/bookmark | 只有精确且有权限的 mapping 才 redirect 到 canonical detail。 | ambiguous 显示 conflict；archived 显示 gone；unknown/out-of-scope 显示 not found。 |

Issue #678 是全部 R0-R10 生产 disposition 的唯一 owner。与 ReviewEvidence 或 DefinitionProposal 同时保留的 `Archive` evidence 是 provenance，不是第二个 operational disposition。所有 legacy-ID API 只投影 typed mapping head，不得重新分类 row。archive ledger 是 append-only、typed、带 checksum 的迁移证据，不是公共 catalog resource。删除 legacy tables 或 mapping records 属于之后经验证的 retirement 决策；本 API 决策不授权删除。

## Legacy 路由处置

| Legacy surface | 上线时行为 | 最终行为 |
| --- | --- | --- |
| `GET /api/v2/parameter-specs?view=effective` 与精确 detail | 由 canonical definitions 加 registration projection 支撑的 read adapter。 | 全部 sunset gates 后 410。 |
| `view=governance`、raw/migration query modes | 立即 410；governance history 进入 definition timeline，raw diagnostics 进入 operator routes。 | 410。 |
| `POST/PATCH /api/v2/parameter-specs` | 立即 410；不翻译 Organization-authored structural truth。 | 410。 |
| `activate`、`deprecate`、`restore`、`reattribute`、property-key rename/cutover | 立即 410；Platform publication 通过 manifest synchronization，Org 只能提交 proposal。 | 410。 |
| `/api/v2/parameter-spec-review-tasks*` | 在 read window 内，GET 只能适配可精确映射的 unresolved task；resolve 返回 410 并链接 canonical Review Queue。 | 410。 |
| `/api/v2/identity-mapping-tasks*` | 在 read window 内，GET 可适配精确 review item；resolve/reopen 返回 410。 | 410。 |
| `/api/v2/organization-driver-schemas*` 与 Platform promotion/revert | 全部立即 410，包括会暗示 Organization schema overlay 的读接口。 | 410。 |
| `/api/v2/parameter-modules` read/navigation | 有界 derived read adapter 可展示 placement navigation，但不能宣称 module identity。 | 410，改用 subjects/placements。 |
| Parameter-module mapping、registry write、dismissal、recompute、replay | 会创建结构 truth 的立即 410；project-only recomputation 移到内部 project workflow。 | 410。 |
| 现有 project topology、binding history/compare、validation、draft paths | 一方消费者协调完成 DTO/ID cutover；path 保留；上线后不再有 legacy `ParameterSpec` 字段。 | 规范 v2 合同。 |
| 现有 v1 value、debug、reload、knowledge calls | 未被其他决策 version 时保留公共 workflow；实现内部使用 canonical binding/definition/revision IDs。 | 只用 canonical identities。 |

Legacy read response 包含：

```text
Deprecation: true
Sunset: <earliest announced HTTP-date>
Link: </api/v2/catalog>; rel="successor-version"
Warning: 299 WiseEff "Legacy ParameterSpec contract is deprecated"
X-WiseEff-Legacy-Contract: parameter-spec-v2
```

公布的 `Sunset` 不得早于 canonical launch 后两个 production releases 或 90 天，取较晚者。任一退出门槛未满足时可延后，不得提前。退役后，同一路由返回 410、`details.reason = "legacy-surface-retired"` 与 successor link。

## 消费者迁移矩阵

| 消费者 | 规范依赖 | Legacy 处置与迁移要求 |
| --- | --- | --- |
| Parameter definitions page | subjects、definitions、registration/placement、Review Queue、definition timeline | 用单页合同替代 Effective/Governance peer views；URL selection 改用 canonical IDs。 |
| `ParameterTopologyRepository` HTTP adapter | 现有 project topology/binding routes 与 catalog readers | 将 catalog read/governance 与 project topology 拆成不同端口；删除 `ParameterSpec` create/update/lifecycle methods。 |
| Mock parameter topology adapter | 与 HTTP 相同 application ports/DTO states | version/reset fixtures；覆盖 ready、unregistered、empty、loading、error、retired、stale-release；不得有 mock-only governance。 |
| Project parameter workbench/value editing | canonical binding ID、`definitionId`、`effectiveRevisionId`、`currentValueId` | 删除 `parameterSpecId` 和 module-as-definition identity，保留产品 workflow。 |
| DTS ingest/recognition | 内部 observation command、canonical subject matcher、registration policy | unknown/ambiguous occurrence evidence 只能创建 observation/review，不创建 provisional spec。ParameterObservation 必须具有自身完整的 project/logical-node/source-revision occurrence provenance；R6/R8 legacy spec ID 绝不提供该 identity。 |
| File sync/writeback | canonical binding、pinned definition revision、source target | unresolved ID fail closed，不允许 property-key-only fallback。 |
| Agent tools | invoking principal scope 内 catalog read DTO | 删除/禁用结构写工具；v1 中不允许 proposal、registration、placement、review mutation。 |
| Log analysis | 安全的 canonical definition/revision reference 与 immutable observation evidence | 通过 exact mapping 保留 citation；unresolved evidence 不创建 definition。 |
| Node/device debugging | canonical binding 与 pinned revision | exact map 或阻断；设备写 approval 规则不变。 |
| DTS reload | canonical binding、value、definition revision、release anchor | prepare/finalize 前验证全部 references；release drift 阻断。 |
| Knowledge definition picker | active canonical definitions 与显式历史 revision read | exact-map 旧 reference；unresolved legacy reference 不可选择。 |
| Module/driver registry UI | subject type、registration、placement navigation | 退役 module/Organization-schema 的结构所有权；无关 runtime module 概念保持独立。 |
| Import/export | versioned canonical IDs 与 typed legacy resolver | 新 export only；legacy import 在任何写入前验证全部 rows。 |
| Audit/history viewer | canonical target 与保留的 legacy target metadata | 绝不重写历史 actor、target 或 decision evidence。 |
| External API client/bookmark | canonical routes 或有界 typed resolver | 在公开 window 内迁移；resolver outcome 只投影 issue #678 的 typed mapping head，只有 exact deep link redirect，其余 outcome 显式。 |
| Operations/migration tooling | operator-only reconciliation API、typed mapping head 与 archive ledger | 不调用公共 raw/governance modes，也不要求 API adapter 重新分类 R6/R8；诊断需要独立 operator authority。 |

## UI 状态覆盖

已接受的单页体验为每个产品状态提供可区分的 API 证据：

| UI 状态 | API 证据 | 展示规则 |
| --- | --- | --- |
| Ready | Catalog document `status=ready`、collection 200、active release anchor | 只开放有权限 actions，并把 release ID 与 view 绑定。 |
| Unregistered | Published subject/definitions 200，`registration.status=unregistered` | 展示 definitions 与 Org Admin registration action；禁用 binding/value writes。 |
| Empty | Collection 200，带明确 `emptyReason` | 不当成 error，也不推断 publication 缺失。 |
| Loading | 客户端请求未完成，尚无更新的成功响应 | 保持 layout，不允许针对未确认 release 写入。 |
| Error | Structured error envelope，包括 503 readiness 或 409 drift | 按 reason retry/refresh；绝不转成 empty list。 |
| Retired/deprecated | 指定 detail/filter 返回明确 membership/definition/registration lifecycle | 历史读保留；按合同禁用新 matching/binding。 |
| Review placement choice | unresolved Review Item ETag、current release anchor、允许的 `register-subject` resolution | Org Admin 必须显式选择 `use-default` 或 `choose-parent`；不得预选或推断 parent。 |
| Review resolution conflict | 409，reason 为 `placement-conflict`、`invalid-placement-parent`、`release-drift` 或 `revision-conflict` | 保留用户 selection，刷新 release/item/placement evidence，并要求重新确认；不得展示部分 Registration。 |

## OpenAPI 与前端后续影响

后续实现规格必须在一次协调切换中更新：

- 本页全部 resource、envelope、header、ETag、filter、lifecycle enum、discriminated `PlacementIntent`、原子 review-resolution response、proposal transition 与 error reason 对应的 OpenAPI components；
- 共享 error registry 中的 `SERVICE_UNAVAILABLE` / 503，同时保留现有 envelope；
- Review resolution 必填的 `X-WiseEff-Catalog-Release`、`If-Match`、`ETag` 与 `Idempotency-Key` 行为，包括 exact replay 与 conflicting-fingerprint tests；
- route manifest 与授权测试，包括 public/operator route 分离；
- frontend application ports：catalog read、Organization governance、proposal review、project topology 必须是分离接口，不能继续塞进浅层 `ParameterTopologyRepository`；
- HTTP/mock adapter 合同对等与确定性 state fixtures；
- URL state/deep-link translation、knowledge picker、project binding DTO、Agent read tools、debug/reload adapter、import/export schema、audit target rendering 与 telemetry；
- consumer contract tests：上线后任何一方代码不得读取 `parameterSpecId`、Organization overlay DTO、module-as-definition identity 或 Effective/Governance view；
- route-to-Kernel contract tests：9 个 canonical Catalog read routes 全部使用 `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb` 的完整 typed snapshot facet，且 HTTP 不得触达 Catalog tables/raw repositories，也不得执行 alias、lifecycle、selected-revision、ordering 或 pagination policy；
- atomicity tests：Registration + 唯一 Placement + Review resolution + audit 同时提交，restore 复用 retained Placement，每个已声明 stable conflict 都让 Review Item 保持 unresolved。

这些是影响路由，不是实现 plan 或 ticket list。内部 module 可用 issue #673 决定的 capability 完成合同；本页不假定其方法名。

## 上线、退役与回滚门槛

Canonical launch 要求后续 release plan 在同一 candidate revision 上证明：

1. fresh 与 representative populated PostgreSQL 路径上的 canonical schema/current release 均 ready；
2. 每个 R0-R10 row 只有 issue #678 拥有的一个生产 disposition：R6 spec ID 投影 ReviewEvidence 加 immutable Archive/mapping evidence，R8 spec ID 投影 DefinitionProposal 加必要 Archive/mapping evidence，且两者都不得被重新分类为 ParameterObservation；
3. 矩阵中所有一方消费者使用 canonical IDs，contract tests 通过；
4. HTTP、Agent、scripts、jobs 都无法到达 legacy structural write；
5. OpenAPI、HTTP、mock、authorization、audit 与 browser-real 单页 state checks 通过；
6. 已验证 recovery point，rollback 可恢复 pre-cutover application/data，且不依赖 reverse dual write。

只有最短窗口结束且以下条件**全部**满足，legacy reads 才可退役：

- canonical launch 后至少经过两个 production releases 且至少 90 天；
- 每个 first-party consumer、已记录 external integration、export/import workflow 和 deep-link owner 都有 disposition；
- 所有受支持 deployment class 的 legacy-read telemetry 连续 30 天为零；
- mapping/archive reconciliation 不存在未解决的 blocking/ambiguous operational reference；
- 需要 legacy read 的 rollback window 已结束；
- deployment Operator 签署 retirement evidence，Platform owner 批准 public sunset。

任一门槛失败只会延长 read adapter，不会恢复 legacy write 或允许 dual write。最终退役前 rollback 可从 verified recovery point 恢复旧 application；不得把 canonical mutation 反向投影进 legacy tables。

## 验收自检

| 合同检查 | 固定 outcome |
| --- | --- |
| Route-to-Kernel 闭合 | 9 个 canonical Catalog read routes 全部映射到 `b5bf52cc5e6afb8ff60b043ed6207d80dcfe8fcb` 的 typed snapshot read facet；不存在 HTTP 自有的 Catalog 解释或 repository fallback。 |
| Placement intent | `PlacementIntent` 明确判别为显式 `use-default` 或经验证的 `choose-parent`；服务端绝不猜 parent。 |
| Review registration 原子性 | Registration + 唯一 retained Placement + Review resolution + audit 位于同一事务。 |
| 并发与重放 | current release anchor、Review Item `If-Match`/ETag 与 `Idempotency-Key` 均必填；exact replay 幂等。 |
| 稳定冲突 | `placement-conflict`、`invalid-placement-parent`、`release-drift`、`revision-conflict` 固定为 409，且无部分写入。 |
| Restore | `restore-registration` 接收 `registrationId`、拒绝 Placement intent，并复用 retained Placement。 |
| Ambiguity 边界 | 人工可根据 existing published Subject 解析 evidence；不得创建 Definition、Revision 或 recognized Binding。 |
| R6/R8 cutover truth | R6 是 ReviewEvidence 加 Archive/mapping evidence；R8 是 DefinitionProposal 加 Archive/mapping evidence；只有独立证明的 occurrence graph 才能创建自身 ParameterObservation。 |
| 双语/OpenAPI 一致性 | 中英文 DTO、矩阵、reason token、header 与 follow-up impact 指向同一合同。 |

## 决策完整性

本 API 决策不存在剩余产品语义选择：

- namespace/versioning 已固定；
- pre-registration visibility 已固定；
- human、Agent、System、synchronizer、operator authority 已固定；
- proposal authorship 与 separation of duties 已固定；
- Review placement intent、validation、atomicity、concurrency 与 idempotency 已固定；
- canonical resources、state projection、error reason、ID outcome、legacy route behavior 已固定；
- Catalog read route 已通过修复后的 typed Kernel facet 闭合，R6/R8 分类唯一由 issue #678 拥有；
- 最短 compatibility duration 与 evidence-based exit gates 已固定；
- frontend、binding/value、ingest、Agent、log、debug、reload、knowledge、import/export、audit、external、operator 消费者均有 disposition。

后续可以继续规定保持上述决策的实现 mechanics。规格可新增 pagination limit 或 audit event name，但若要改变 ownership、lifecycle、authorization、mapping outcome、route semantics 或 retirement gate，必须重新打开本决策。
