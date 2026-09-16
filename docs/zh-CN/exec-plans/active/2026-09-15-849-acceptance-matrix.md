# Issue #849 验收矩阵与操作说明

> English: [English](../../../exec-plans/active/2026-09-15-849-acceptance-matrix.md)

轮次记录。分支 `feat/849-parameter-unification`，工作树 `/Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification`，基线 `origin/main` `8f03cfa4302aebbe3bc3c37ef2197c082c2a3e2e`。状态：**部分完成**。此处不含任何完成主张；Issue 仍为 OPEN，未开 PR、未合并、未做目标重建或部署。

逐节细节见[轮次报告](2026-09-15-parameter-unification-round-report.md)。延迟的主体类型工作见 [ConfigurationSchema 改动面侦察](../../../exec-plans/active/849-inventory/configurationschema-extension-recon.md)与其[独立 Spec 评阅](../../../exec-plans/active/849-inventory/configurationschema-spec-review.md)。迁移 0148/0149 的 R3 证据见[回溯式威胁矩阵](849-inventory/migrations-0148-0149-r3-threat-matrix.md)；它不会把交付后的修正写成“实现前合规”，处置、静默和恢复仍是后继门禁。

## 1. 五项范围状态

| # | 范围 | 状态 | 主要证据 | 缺口 |
| --- | --- | --- | --- | --- |
| 1 | 全部参数入口及直接相关跨模块引用统一新版 Catalog；清除旧库回退、混合读取与双写；打通导入、查看、草稿、提交、审批、生效、源文件写回、历史及导出 | **服务端新版路径已交付；前端草稿托盘已读取并删除 canonical pending draft（B5 代码已收口，真实数据路径仍待完整种子发布与物化）** | `drafts.integration.test.ts`（11）、`catalogProjectValueRoutes.test.ts`（16）、`parameter-bindings` 74、`parameter-files` 316 | 跨模块消费者改接（Agent、日志、知识、调试、DTS 重载） |
| 2 | 仅 DTS／JSON；113 厂商输入与 4 项兼容种子的语义对齐、真实源文件、完整示例 DTS 基底；JSON 软件配置使用 ConfigurationSchema | **部分完成** | `src/config/seed-reconciliation/manifest.json`（125 项）、`src/config/seed-sources/**`（9 文件，含生成的 `vendor-drivers.dts` 基底：**全部 113 条**厂商输入（27 个驱动主体、12 个 node-type 主体），每条取值均取自受审厂商元数据自带的 DTS 语法 `exampleValue`；可用 `npm run vendor-source:generate` 重新生成，并由 `npm run vendor-source:check` 与 `generate-vendor-project-source.test.ts`（5 项）检测漂移）、`seedSources.fidelity.test.ts`（18）、`canonicalBindingMaterialization.integration.test.ts`、ConfigurationSchema Slice A–C 及 `configurationSchemaPublish.integration.test.ts`（2） | JSON 软件配置项目源（B1）；示例基底是演示源，不是经验证的真机固件 |
| 3 | YAML／TOML／ENV 项目源及对应 8 项种子归入 TD-124；明确拒绝这些格式；厂商 YAML 目录元数据保留读取与发布 | **已交付** | `unsupportedFormat.test.ts`（19）、`importDtsParse.test.ts`（10）、前端 `unsupportedImportFormat.test.ts`（10）、中英 TD-124 行 | — |
| 4 | 按种子重建：保留非参数数据；旧参数、草稿、历史及源文件离线归档；仅初始化 Atlas／Aurora／Nebula；旧链接归档提示；acme 退役但保留发布历史 | **部分交付** | **离线归档已交付（仅捕获）**：`0149_project_parameter_plane_archives.sql` 与 `seedInitialization/archive.ts` 把 32 个逐项目关系以及每个已引用文件版本或 candidate 的实际字节写入 v2 归档，并保存逐关系计数与摘要。R3 矩阵把 legacy／项目平面核对中的每张表归类为捕获、保留／共享、可再生或已不存在。捕获使用一个 repeatable-read 快照、稳定主键顺序、64 MiB 关系大小预检，以及本地／S3 真正有界的 64 MiB 源字节路径；重建守卫校验本次返回的精确归档 ID／digest、关系闭包和内嵌字节完整性。`archive.integration.test.ts`（12 项）覆盖非零图、子作用域、跨项目隔离、源行保留、关系／源字节超限拒绝、源字节保存／对象缺失拒绝、幂等复用、缺失／截断／撕裂／篡改／精确对象拒绝、鉴权和 schema 保留约束。迁移 0148 证据还证明已认证组织绑定、写日志及完成态重放前鉴权、不同 digest 也只能有一个固定范围执行中任务，以及 `completed` 终态不可变（`plan.test.ts` 7；`materialize.test.ts` 7）。**处置（删除）刻意未实现**——账本没有任何列暗示删除已经发生，移除归档行必须另行评审。**归档旧链接提示与 acme 退役仍已交付**并保留历史证据 | JSON 种子物化（B1）、补齐 `csub_drv_sc8562` 容量、acme **定义**生命周期、归档平面处置（删除）、目标静默／恢复、其余 canonical 绑定／值物化（B2）、归档提示界面 |
| 5 | S1／S2 验收：真实鉴权、PostgreSQL、源存储、发布管理器、归档重建、中断续跑、整套恢复；前端三尺寸真实浏览器验证 | **部分完成** | 所有集成套件均用真实 PostgreSQL；导入向导与归档旧链接提示使用真实鉴权与真实浏览器，三尺寸 1440×900／768×1024／390×844（真实鉴权须以 `AUTH_MODE=production AUTH_PROVIDER=local` 启动 API） | S2 全部（归档重建、中断、续跑、整套恢复）；发布管理器仅由其自身套件覆盖；完整三尺寸操作矩阵 |

## 1a. 实现 PU-04 过程中发现的两个阻塞与一个契约发现

它们会重塑剩余计划；此处记录而非绕过。

**决策状态（2026-09-15）。** B1、B4、B6 不再是待决问题。[ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md) 记录了三者的决定，各条目下方给出结论；剩下的是实现，而不是决策。B3 已撤回，B5 在其 scope item 1 部分已关闭。

**B1 — JSON 项目源无语义摄取路径。** `ingestConfigRevision` 是 DTS／配置版本解析器。新版值归属**有** JSON 值路径，但没有任何路径能把 JSON 项目源文件变成配置版本，因此 JSON 种子源无法物化。`materialize.ts` 以 `UNSUPPORTED_FORMAT` 明确拒绝（明细带 `deferredTo`），而不是上传无法解析的成员或从清单丢弃。**后果：两个 JSON 兼容种子仍未物化，构成 scope item 2 与测试决定 6 的缺口。** 关闭它并非局部修复：按实现决定 3，它需要 Binding 边界上的 ConfigurationSchema **源身份**扩展（区分 DTS 逻辑节点出现与软件配置实例，含配置集、实例、源文件版本与格式特定 locator）。**已决定（ADR-0046）：为该扩展排期，不重新协商 scope item 2。** 该决定引入统一的 `project_parameter_source_occurrences` 层，身份至少包含 organization + project + config-set + occurrence-kind + instance-id，并额外钉住不可变源文件身份与 JSON Pointer locator；Binding 唯一性收敛为 `(project_id, source_occurrence_id, definition_id)`；既有 DTS 绑定原地 backfill 且永不重新派生其 ID；file-version／config-revision 钉留在 ProjectValue 层，不进入 Binding 身份。因此两个 JSON 兼容种子仍在范围内，并将在该实现落地前保持未物化。

**B2 —— 存在注册与足够放置容量时，canonical 绑定／值物化可用；为此修复了两个缺陷。** 成功路径已在真实 PostgreSQL 上证明：
`nodeTypeSubjectBinding.integration.test.ts` 安装真实发布谱系、明确补入受审切片所缺的一个运维整理 driver module、自动注册主体并物化真实 DTS 切片，并断言
**30 条 canonical 绑定及其值**（每项目 10 条、每个 node-type 主体 5 条），且每条绑定都有值行。为此必须先修复两个缺陷，
而在没有任何写入真正发生之前，两者都不可见：

| # | 缺陷 | 修复 |
| --- | --- | --- |
| 1 | `catalogProjectValueSync` 传入 `nodeTypeFallback: { kind: "absent" }`，因此 **113 条中的 33 条 node-type 厂商属性**无论源如何声明都永远无法解析 | 新增共享的 `resolveObservedSubject`：声明的 `compatible` 仍然优先，仅当源未声明时才使用 node-type 回退，名称取自观测到的节点 |
| 2 | `materializeSeedSources` 以裸 client 调用同步，导致绑定工作单元的 `SAVEPOINT` 以 "SAVEPOINT can only be used in transaction blocks" 失败——每次写入注定失败 | 每项目的同步现在运行在 `root.transaction(...)` 内 |

因此 B2 仅在具备足够运维整理容量的夹具上得到证明。注册本身不再是人工前置条件（B6），但未修改的 113 条输入切片目前会因 `csub_drv_sc8562` 没有空闲 driver module 而失败关闭，写入 binding 为零。精确受审身份集合仍未完成；计划预期的每项目 124 条也从未对完整种子实测过。

**C1 — acme 退役可避免伪合并，但会移动一个 pinned 摘要。** 退役契约要求被退役文档带 `tombstone.reason`、`tombstone.withdrawnByReleaseId` 等于后继发布 id、`tombstone.previousSelector` 与前驱一致；`tombstone.successorId` **可选**，因此可以在不声称 acme 演化为真实厂商同名主体的前提下退役它——而后者正是 Issue 禁止的。实施它会改变后继文档，从而改变签入的 `schemas/dts/catalog-release/vendor-catalog-1.yaml` 与 `VENDOR_SUCCESSOR_AGGREGATE_DIGEST` 常量，且必须保持前驱发布与其激活回执不变。

**B3 — 已撤回：不存在携带缺陷。** 此前的轮次把 B3 记为“发布编写路径不能携带全部前驱成员”，依据是 acme 退役后 `completeSuccessor.test.ts` 失败。该推断是错的。失败点是 `expect(result.ok).toBe(true)`，其底层构建错误为 `{kind: "subject-not-active", subjectId: "csub_acme_power"}`：该测试在 acme 主体下铸造定义，而 acme 一旦退役，`applyCreateDefinition` 正确地予以拒绝。直接探针确认携带本身健全——从退役 acme 的前驱构建后继得到 163 -> 164 份文档，**没有**任何前驱身份缺失，退役主体与别名连同 tombstone 一并携带通过。因此真正需要的只是把该测试的变更集移到仍处于 active 的主体上。**acme 退役现已交付**（主体 + 别名，携带 tombstone 且不含 `successorId`），在构建器层面与真实 PostgreSQL 端到端均已核验；见下方范围第 4 项与工作报告 1.13。原 B3 记录中关于变更集校验只接受 `driver` 与 `node-type` 的那一半是真实的，已单独修复（现接受 `configuration-schema`）。

**B5 — 工作台草稿托盘读取的是旧库草稿面（已核验，部分收口）。** 范围第 1 项要求清除旧库回退与混合读取，而前端草稿托盘违反
了这一点：

| 方向 | 端点 | 归属 |
| --- | --- | --- |
| 创建（写） | `POST /api/v2/projects/:projectId/parameter-bindings/:bindingId/drafts` | canonical `project_parameter_value_drafts` |
| 列出（读） | `GET /api/v1/parameter-drafts/mine` | 旧库 `parameter_drafts` |
| 移除（写） | `DELETE /api/v1/parameter-drafts/:draftId` | 旧库 `parameter_drafts` |

在 `semantic` 身份模式下（API 服务端所用模式）`saveDraft` 抛 `CONFLICT`，因此旧库表永远不会被写入，而旧库删除静默匹配不到
任何行。后果是：已持久化的 canonical 草稿在刷新后从托盘消失、也无法通过界面移除，而 canonical 列表端点
`GET /api/v2/projects/:projectId/parameter-value-drafts` **完全没有消费者**。

本轮收口：canonical 列表 DTO 现在携带 `reason`（托盘会展示作者填写的原因，此前 canonical 侧从不暴露它），
客户端新增 `deleteProjectValueDraft` 以对应 canonical
`DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId` 路由——该路由此前没有任何客户端方法。
证据：`drafts.integration.test.ts` 在真实 PostgreSQL 上断言原因随刷新保留；`parameterCatalogClient.test.ts`
断言两个 canonical 的 URL 与方法。

**本轮收口（契约与接缝）：**

1. `catalogBindingDraftDtoSchema` 与 canonical 草稿 DTO 现在同时携带 `updatedAt` 与 `reason`。托盘按时间排序与标注草稿，因此时间戳应属于列表契约，而不是从请求顺序推断。
2. 托盘接缝现在接受 canonical 形状的草稿。`TrayHydrationDraft` 是 `parameterId` 可选的端口 DTO，`PendingBindingDraftCore` 不再要求它，
   `serverDrafts`／`resolveSharedWorkingTip` 也改用收窄后的类型。canonical 草稿的 `parameterId` 是**缺失**而非伪造：canonical 模型没有参数记录实体，
   而托盘以 `draftId` 与 `projectParameterBindingId` 为键。`canonicalDraftsToTrayDrafts` 把 canonical 列表映射到该接缝，4 项测试覆盖映射、
   身份缺失、原因与时效保留以及空列表。

**本轮收口（接线）：** 两个方向现在都指向 canonical 归属，且原本自建 client 的组件不再自建。

| 变更 | 效果 |
| --- | --- |
| `deleteProjectValueDraft` 的上下文改为可选 | canonical `DELETE` 路由只强制鉴权与项目编辑权限，**不要求** catalog 发布头或幂等头（与发布路由不同），因此原先要求 `CatalogWriteContext` 的签名等于索要路由从不读取的东西 |
| 新增 `createCanonicalDraftTraySource()` | 经 `canonicalDraftsToTrayDrafts` 读取 `GET /api/v2/projects/:projectId/parameter-value-drafts`，并经 canonical 路由删除；`ParametersPage` 在 API 模式下将其注入为托盘的 `listDrafts`／`deleteDraft` |
| `ApiProjectTopologyWorkspace` 不再构建草稿 client | 其两处内部回退已移除。缺少 prop 现在意味着"无服务端草稿"（删除时给出类型化拒绝），而不是隐式旧库读取；该组件也不再构建任何 HTTP 仓库 |

这也更正了本矩阵此前的一处说法：剩余工作曾被描述为需要为 canonical DELETE 准备 `CatalogWriteContext`。实测该路由**不需要**——那项要求来自客户端自身的签名。
`ApiProjectTopologyWorkspace` 套件现在断言该组件**不调用**任何参数仓库工厂，因此旧库读取不可能再以回退形式重现。

**验证及其诚实的边界。** `canonicalDraftTraySource.test.ts` 证明两个方向都使用 canonical URL 且不产生任何 `/api/v1/parameter-drafts` 调用；适配器与托盘接缝另有 4 + 4 项测试；前端全量套件为绿（446 文件 / 3438 测试）。**未**验证的是带真实数据的在线路径：在 canonical 绑定存在之前（B6），数据库中不可能存在 canonical pending draft，因此托盘尚未在浏览器中对真实 canonical 草稿演练过。

**B6 —— 已解决：种子期自动注册与失败关闭完成条件均已实现。** 该条目早前的修订在问种子初始化能否注册主体；后来的修订收窄为模块供给，随后该条目在重写相邻区块时被误删。此处连同结论一并恢复，因为真正的结论是这两个问题都不是障碍。

**注册已实现。** `seedInitialization/registration.ts` 解析每个已物化版本实际引用的主体——仅限在已发布版本中拥有定义的主体，因此无关的 `compatible` 无法把主体拖进来——并经契约的预授权路径注册：`method: "automatic"`、`actorKind: "trusted-system"`、`placement: { mode: "use-default" }`，以种子摘要派生幂等键，并把种子摘要、项目与主体种类记为证明。`materializeSeedSources` 在 ingest 与值同步之间执行它。

**模块容量仍由运维人员负责。** DTS ingest 会供给放置守卫所需的大多数 `node-type`／`driver-group` 模块，但真实受审切片仍缺少一个可供 `csub_drv_sc8562` 使用的空闲 driver module。种子不会擅自创建这类用户可见结构。`nodeTypeSubjectBinding.integration.test.ts` 明确加入一个由运维人员整理的模块来证明成功路径；未修改的真实切片夹具则证明该容量缺口确实存在。

**失败关闭完成条件已实现。** 物化会先暂存并预检三个目标，只有全部可放置时才开始 canonical 值同步。没有可用模块的主体不会被绑定，也不会被静默丢弃。在任何值同步之前，`materializeSeedSources` 会把运行记录为 `failed`，为每个主体写入同时含 `projectId` 与 `subjectId` 的 `missing-placement-module` blocker，并抛出 `SeedInitializationBlockedError`，不再可能继续落成 `completed`。`getSeedInitializationRun` 会返回这些 blocker；重试进入 `running` 时保留旧 blocker，只有成功完成后才清空。本次没有新增 migration，也没有自动创建模块。`materialize.test.ts` 把 blocker 放在最后一个目标：旧流程会先写入前两个 binding，而两阶段流程写入为零。真实受审切片会记录三个 `csub_drv_sc8562` blocker（每项目一个）且不写入 binding。

**边界。** B6 的失败语义已解决；真实种子要完成，仍需运维人员补齐缺失的 driver-module 容量，再以受审的精确 binding 集合收口。显式加入该容量的夹具证明注册、binding 与 current value 能完成，但它不是目标环境证据。

**B4 — 两个 DTS 兼容种子无法按现状发布。** 其受审源声明 `charging_core` 节点，并携带 3×5 字符串矩阵与 3×4 cell 数组。两个彼此独立的阻塞：cell 数组是**嵌套数组**，定义能力白名单不接受（仅支持 `array<integer>`／`array<number>`／`array<string>`，因此需要能力版本变更，与早前的主体类型扩展同属 R3）。**更正：** 该条目还曾声称 `charging_core` 不是规范节点名。这是**错的**——`parseCanonicalNodeName` 的文法 `/^[A-Za-z][A-Za-z0-9,._+-]{0,30}$/` 明确允许 `_`，`charging_core`、`batt_l_v800`、`cccv_para0` 都解析合法，厂商后继本身也发布了 15 个带下划线的 node-type 名称。因此 B4 的命名那一半从不存在，无需人类命名决定，只剩嵌套数组这一个能力阻塞。

**已决定（ADR-0046）：发布一次 `catalog-capability/v4`。** 它覆盖递归／嵌套数组、`minItems`／`maxItems`、仅含 description 的 mixed item schema，以及数组自身的 `description`；`v1`／`v2`／`v3` 保持原义，且 v3 消费者必须在安装前拒绝 v4 内容而非容忍它。基数只能来自权威 vendor 元数据——`gpio_int` 的 cell 数是 `schemas/dts/vendor/wiseeff/mt-mt5788.yaml` 与 `sc8562.yaml` 中声明的 `constraints.cells: 3`，而复杂 fixture 的 3 行是观测，不得成为 schema 约束；这些 fixture 的 4／5 列在成为不变量前需要受审源证据，且把 cell 矩阵扁平化不可接受。`charging_core` 的正式主体是一项受审的 NodeType 发布决策，而不是与既有 `huawei,charging_core` Driver 做名称相似度匹配。

## 2. Issue 测试决定状态

| 测试决定 | 状态 | 说明 |
| --- | --- | --- |
| 1 只测外部可观察行为 | 已遵循 | 新增测试均驱动服务、路由或已安装发布，而非私有辅助函数 |
| 2 S1 生产参数／API 边界 | **部分完成** | 定义→注册→草稿→审阅→生效→源写回→历史→导出已在真实 PostgreSQL 与真实鉴权下证明；初始化、浏览器驱动的审阅与导出未做 |
| 3 S2 自托管运维边界（含归档重建） | **部分完成** | 运维路径现已在真实 PostgreSQL 上端到端跑通：`parameter-catalog-cutover-cli.integration.test.ts` 驱动四个真实 CLI 入口，依次完成 plan -> 中断的 execute（P7 前 `PCAT-ORC-CRASH`）-> inspect（P0-P6 检查点）-> 续跑（`resumed: true`、`liveRun: false`）-> inspect -> 拒绝临时动作与错误令牌 -> 整套恢复（`recovery-required`，回滚在线映射 head、保留只追加的映射版本）。核心状态机 `server/modules/catalog-cutover` **54 项全绿**，含回滚 dump 相等性。**仍未运行：**基于 Docker 的彩排产物脚本（`export-`／`import-parameter-catalog-rehearsal.sh`），它们需要 `wiseeff-postgres-1` compose 容器与宿主机 `psql`；本环境两者皆无，因此 `parameter-catalog-rehearsal.integration.test.ts` 有 15 个用例因 `database ... does not exist` 失败，而非断言失败。静默与目标主机彩排仍未证实 |
| 4 既有先例 | 已扩展 | 新版工作流、源保真、种子清单、切换／分类套件 |
| 5 种子 oracle | **部分完成** | 清单、处置、摘要与初始化计划已覆盖；逐项目精确 Binding 集合未覆盖，因为种子发布尚未发布 |
| 6 DTS／JSON 矩阵 | **部分完成** | 导入拒绝、候选／暂存拒绝、DTS 保字节写回、JSON 字面键、导出／再导入保真已覆盖；两种格式的完整导入→草稿→审阅→生效→再导入闭环未做 |
| 7 工作流与并发矩阵 | **部分完成** | 草稿不动当前值；提交冻结 pin；审批只生效一次；重放幂等；过期 pin 被拒；自审与非审阅人审批被拒。独立鉴权会话、响应丢失对账、批次部分结果未做 |
| 8 提交边界矩阵 | **部分完成** | 生效单元在同一事务内提交值、源、历史、流程状态与审计；对象准备失败与引用对象缺失未注入 |
| 9 初始化与保留矩阵 | **部分完成** | 目标计划覆盖三个允许项目、自定义项目、缺失／歧义归属、阻断与重复运行幂等；物化、初始化锁与非参数保留快照未做 |
| 10 消费者与旧库矩阵 | **部分完成** | 归档诊断归一为一种结果，服务端 410／404 正确，且参数工作台现在会为归档旧链接**渲染**提示：`archivedLink.test.ts`（7）、`parameterRuntime.test.ts`（+2）、`parameterClient.test.ts`（+1）、`ParametersPage.test.tsx`（+6），并在真实浏览器、真实鉴权下完成三尺寸验证。其余消费者族仍未端到端盘点 |
| 11 运维失败矩阵 | **未运行** | 目标／种子／发布／schema 漂移、备份失败、发布排他拒绝均未测试 |
| 12 浏览器证据 | **部分完成** | 导入向导（三尺寸）以及归档旧链接提示的 1440x900／768x1024／390x844（`work/ui-checks/849/*-archived-notice.png`），后者在真实 API 与真实 bearer 鉴权下完成。草稿／审阅／导出的完整三尺寸操作矩阵仍未执行 |
| 13 完成证据 | 已遵循 | 候选、摘要、环境、命令、通过／失败／跳过计数与产物记录在轮次报告中 |

## 3. 实际达到的证据层级

| 层级 | 是否达到 | 位置 |
| --- | --- | --- |
| 文档／静态 | 是 | 中英报告、ADR-0045、TD-124、威胁矩阵、Spec 评阅、本矩阵 |
| 本地纯逻辑／假实现 | 是 | 契约、编译器、schema、种子清单与匹配器套件 |
| 真实本地 PostgreSQL | 是 | 上文引用的每个 `*.integration.test.ts`，使用专用 lane 库 |
| 真实本地鉴权 | 是（本轮确认） | API 必须以 `AUTH_MODE=production AUTH_PROVIDER=local` 运行，并用 `npm run admin:bootstrap` 引导本地管理员。只有真实会话下 `GET /api/v1/me` 才返回 200，归档查询才返回 410。**更正：**此前的浏览器证据是在默认 `AUTH_MODE=development` 的服务端上采集的，该解析器完全忽略 `Authorization`，所有 API 调用均返回 401，因此那次会话并未证明任何鉴权 |
| 真实浏览器 | 部分 | 导入向导与归档旧链接提示，各三尺寸。提示通过真实登录表单、来自 API 的真实 410 以及关闭控件完成验证 |
| Hosted／CI | **否** | 未开 PR |
| 目标主机／硬件／发布／生产 | **否** | 未获授权 |

## 4. 操作说明

### 4.1 本地复现验证

```bash
cd /Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification
npm run catalog:lane:env -- provision --issue 849
export DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_lane_849
export TEST_DATABASE_URL="$DATABASE_URL"
```

务必导出 lane 库。否则服务端测试骨架会退回共享 compose 库，并因不可变迁移漂移而失败。默认 compose 库不构成可接受证据。

```bash
# 新版工作流、历史与导出（真实 PostgreSQL）
npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings

# 契约与生成产物
npx vitest run --config vitest.server.config.ts server/modules/contracts
npx tsx scripts/check-openapi-contract.ts

# ConfigurationSchema 端到端
npx vitest run --config vitest.server.config.ts \
  server/modules/catalog-kernel/install/configurationSchemaPublish.integration.test.ts

# 真实兼容源与种子清单
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-files/seedSources.fidelity.test.ts
npx vitest run --config vitest.scripts.config.ts scripts/seed-reconciliation-manifest.test.ts
npm run seed:reconcile:check

# 种子初始化计划、守卫与日志
npx vitest run --config vitest.server.config.ts \
  server/modules/parameter-bindings/seedInitialization/plan.test.ts

# 仓库门禁
npm run build
npm run docs:check
npx tsx scripts/check-parameter-catalog-boundaries.ts \
  --trusted-base-sha "$(git rev-parse 8f03cfa43)"
git diff --check
```

已知环境特性，避免误读红灯：

- `server/testing/testDatabase.ts` 会强制删除陈旧 worker 库。两个触碰数据库的进程同时运行时互删临时库，产生 `database "wiseeff_test_*" does not exist` 或 `Connection terminated unexpectedly`。请一次只跑一个触碰数据库的命令。
- `catalogRoles.integration.test.ts > application, agent, and verifier logins are not members of Catalog writer roles` 在本环境下 pristine `origin/main` 上同样失败，属既有基线失败，不归因本分支。
- `catalog-publication/jobs/manager.integration.test.ts` 有一个定时器竞态用例，重跑通过。

### 4.2 复现浏览器证据

```bash
npx tsx server/index.ts            # API 监听 127.0.0.1:8787，已导出 lane 库
npx vite --host 127.0.0.1 --port 5173 --strictPort   # 端口须在 5173-5199 以满足 CORS
playwright-cli -s=wiseeff849 open http://127.0.0.1:5173/parameter-admin
```

用针对 lane 库创建的本地账号登录，打开"批量参数导入"，粘贴或上传 `work/ui-checks/849/params.yaml`。向导必须在步骤 2 显示明确的不支持格式提示，而 `config.json` 不得显示。在 1440×900、768×1024、390×844 三尺寸抓取快照与截图，并检查 `console error`。

### 4.3 后续步骤（按依赖顺序）

1. **实现 B1**（已由 ADR-0046 决定）：为 ConfigurationSchema 源身份实现排期。B6 失败关闭已完成；注册权限继续使用契约既定的 `trusted-system` + `automatic` + `use-default` 路径。
2. **落地携带兼容种子的发布后继**，取决于 ADR-0046 的 `catalog-capability/v4` 与 `charging_core` 的受审 NodeType 主体发布。本步曾被 B3 阻塞，而 B3 已**完成**——acme 主体与别名已在厂商后继中退役，并在真实 PostgreSQL 上核验。后继构建器能正确携带已退役成员，因此后续任何退役都可依赖该行为；尚未验证的是让 `configuration-schema` 成员穿过 `buildCompleteSuccessor`。
3. **新版绑定／值物化**：在后继发布后执行（B2）。退出证据：逐项目**精确** Binding 集合（各 124，合计 372）而非总数。
4. **S2**：先落受审重建处置契约（R3，实施前需 Spec 评阅），再做 plan → apply → status/resume → verify，然后做中断与整套恢复演练。
5. **B5 前端接线**：为 canonical pending-draft DTO 增补 `updatedAt` 与参数身份，加入 canonical→托盘适配器，把 `ApiProjectTopologyWorkspace` 从 `createHttpParameterRepository()` 上摘下，待 canonical 绑定存在（B2）后验证。
6. **S2 剩余**：执行基于 Docker 的彩排产物路径（需要 compose `wiseeff-postgres-1` 与宿主机 `psql`）以及目标主机静默彩排。运维 plan／execute／inspect／recover 路径与整套恢复已完成。
7. **PU-05 前端**：归档旧链接提示已完成；剩余草稿托盘、审阅与导出，随后对这些界面跑完整三尺寸操作矩阵。
8. **PU-08**：把 S1／S2 证据绑定到同一个 sealed candidate 并跑 Hosted。

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | 新增 | 本矩阵及英文对应件；轮次报告及英文对应件 |
| 架构／领域 | 未变更 | ADR-0045 与设计文档在更早轮次落地，此处未改 |
| 质量／测试 | 已更新 | 上文记录测试决定 1–13 的状态；未改动任何门禁定义 |
| 运维 | 已更新 | `ops/self-hosted/upgrade.md` 与 `upgrade.zh-CN.md`：因 advance 现已退役 acme，钉住的厂商后继 digest 移至 `sha256:5f0e7bcd…`，并在两份文档中记录运行时后果（`acme,power` 解析为 `retired`） |
| 参考 | 已更新 | `docs/references/catalog-publication-baseline-verification.md` 及其中文对应保留历史 R-F4 digest，并新增带日期的前向说明，因此 `063b12c49` 的记录未被篡改 |
| 生成产物 | 未变更 | 本文档不产出也不消费生成产物 |

## 文档更新门禁

本矩阵及其中英对应件是本轮的文档交付物，仅记录状态，不改动任何代码、契约或门禁。`npm run docs:check` 与 `git diff --check` 通过。上文每条状态都由 §4.1 中的命令在本修订的代码树上运行得出；此处不主张目标执行、部署、Hosted CI 或 Issue 完成。
