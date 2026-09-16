# 参数统一轮次报告（Issue #849）

> English: [English](../../../exec-plans/active/2026-09-15-parameter-unification-round-report.md)

轮次：2026-09-15 Scratch 实现轮次。
分支：`feat/849-parameter-unification`，工作树 `/Users/tzrea1/Develop/WiseEff-worktrees/issue-849-parameter-unification`。
基线：`origin/main` 于 `8f03cfa4302aebbe3bc3c37ef2197c082c2a3e2e`（2026-09-15 拉取）。
计划：[2026-09-14-parameter-unification-and-seed-parity.md](2026-09-14-parameter-unification-and-seed-parity.md)。已确认决策：[ADR-0045](../../design-docs/adr-0045-configuration-schema-subject-and-seed-rebuild.md)。
状态：**部分完成**。本报告把已交付并验证的内容与未开始的内容分开陈述，避免用一条顺利路径冒充 Issue 完成。Issue 仍为 OPEN。

## 1. 已交付并验证

### 1.1 清除旧库共存，读／写归属统一

`server/modules/parameter-bindings/catalogProjectValueRoutes.ts` 中 Issue 问题陈述点名的四个共存缺陷已全部清除：

| 缺陷（Issue 原文） | 修改前 | 修改后 |
| --- | --- | --- |
| “部分过渡路由合并两种来源” | `GET /api/v2/projects/:projectId/parameter-bindings` 把新版行与旧版 `listProjectBindings` 行合并 | 仅返回新版。未知／越权项目仍 404；新版目录为空时如实返回空列表 |
| “新版集合为空时回退旧数据” | 同一路由在新版列表为空时返回 `original.items` | 不再存在回退。已归档旧行绝不作为当前数据展示 |
| “名为建草稿的路由直接保存新版当前值” | `POST .../parameter-bindings/:bindingId/drafts` 调用 `saveCanonicalProjectValue`，并把新的**当前值 ID**当作 `draftId` 返回 | 真实待处理草稿写入新的 `project_parameter_value_drafts` 归属（迁移 `0145_canonical_project_value_drafts.sql`），当前值、其 tip 与生效源版本均不变 |
| “混合导入批次可回退旧 apply 服务” | `POST /api/v1/parameter-import-batches/:batchId/apply` 在无新版匹配或仅部分匹配时调用旧版 `applyImportBatch` | 仅走新版。未匹配／未绑定行返回如实的 `409 CONFLICT`（`reason: "unbound-canonical-binding"`、`unbound[]`、`applied: 0`）；旧 apply 不再作为回退。空目录预览回退同样已删除 |

新增新版草稿归属：`server/modules/parameter-bindings/drafts/`（仓储 + 服务 + barrel），并新增 HTTP `GET /api/v2/projects/:projectId/parameter-value-drafts` 与 `DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId`，登记进 `routeManifest.ts`／`schemaRegistry.ts` 并重新生成 `docs/generated/openapi.json`。

强制不变量（真实 PostgreSQL，`drafts.integration.test.ts`）：建草稿不改动 `current_value_id`、不追加 `project_parameter_values` 行、不改动 `config_revision_id`；草稿跨刷新持久并可删除；过期基线版本、未知绑定、跨项目编辑者分别以正确状态拒绝。`source_ref` 为 `canonical-binding-identity`（无具体配置集源）的绑定被拒绝。

治理审计新增 `value-drafted`／`value-draft-removed` 动作。

### 1.2 仅支持 DTS／JSON；明确拒绝 YAML、TOML、ENV

- `server/modules/parameter-files/service.ts` 现在有唯一的延期格式判定：`.yaml`、`.yml`、`.toml`、`.env` 以 `ApiError("UNSUPPORTED_FORMAT", ...)` 拒绝，明细为 `{ fileName, format, deferredTo: "TD-124", supportedExtensions }`。`.json`、`.dts`、`.dtsi` 仍可用；真正未知的扩展名（`.txt`、`.ini`）保留通用 `VALIDATION_FAILED`。
- `server/shared/http/errors.ts` 新增 `UNSUPPORTED_FORMAT` → HTTP 400。
- 拒绝发生在 `detectFormat`——所有接受字节的路由共用的唯一暂存前关口——**先于**任何 `objectStore.put` 或数据库行。测试断言对象存储零写入、相关表零行。
- `POST /api/v1/parameter-import/parse-dts` 现在会在解析前拒绝延期 `sourceName`，不再当作 DTS 试解析。
- 前端 `src/application/parameters/import/detectImportFormat.ts` 中把 YAML／TOML／ENV 文本静默当作“表格”的回退已移除，改为显式 `"unsupported"` 结果，并在任何解析器运行前由 `parseImportSource` 抛出 `UnsupportedImportFormatError`。有测试证明 `parseSpreadsheetImport` 永不被触达。
- 厂商 YAML **目录定义元数据**导入未改动且仍为绿（`vendorAdapter.test.ts`、`vendorCoexistence.integration.test.ts`）。

### 1.3 种子对账清单

`src/config/seed-reconciliation/manifest.json` 与 `docs/generated/seed-reconciliation-report.md`，由 `scripts/seed-reconciliation-manifest.ts` 生成，并由 `npm run seed:reconcile`／`seed:reconcile:check` 把关。实测计数与 Issue 期望完全一致：**125 项输入 = 113 厂商 + 12 兼容；117 当前（113 厂商 + 2 JSON + 2 DTS）；8 项延期**。三个板各实测 50 节点／176 原始出现／120 业务／56 结构。每项目 124 绑定、合计 372 的计划量明确标注为 PLANNED，不是已达成事实。两个 `gpio_int` 阻塞厂商输入记为 `transform`，附带精确阻塞点（`…#gpio_int.constraints.cells`、`unhandled-constraint:cells,description`）与所需转换——**没有**丢弃 `cells`／`description`，也未改动导入器。

### 1.4 文档

- ADR-0045（中英）与计划文档对（计划、CONTEXT、`docs/PLANS.md`、领域模型、API 过渡、切换归档文档、`docs/adr/README.md`）已落地。
- TD-124 已加入中英文技术债跟踪表。
- Scratch 侦察证据保留在 `docs/exec-plans/active/849-inventory/`，并附索引 README。

### 1.5 新版提交 → 审阅 → 生效

`server/modules/parameter-bindings/drafts/changeService.ts` 与 `changeRepository.ts`，加上新的 `project_parameter_value_change_requests` 归属（迁移 `0145`），补齐了缺失的受审生效单元：

| 步骤 | 行为 |
| --- | --- |
| 提交（`POST /api/v2/projects/:projectId/parameter-value-drafts/:draftId/submit`） | 冻结新版身份（绑定、定义版本、目录发布）与基线 pin（当前值、配置版本、源引用），以及目标值与理由。当前值、其 tip 与生效源版本不变。每份草稿同时只允许一个未结请求。 |
| 审批生效（`POST .../parameter-value-change-requests/:requestId/review`，`decision: "approve"`） | 唯一授权的生效单元。重新解析受保护引用，拒绝过期的基线值／基线版本／定义版本；拒绝自审；随后经既有新版值归属写入值与受保护源写回，并在同一事务内提交流程状态、`binding_history_events` 历史与调用方审计。已生效草稿离开托盘。 |
| 重放 | 已 `approved` 的请求返回其记录的 `appliedValueId` 与 `applyOutcome`，绝不追加第二个值。 |
| 驳回／撤回 | 不写任何值；请求关闭，草稿保持待处理以便修改。仅提交人可撤回。 |
| 授权 | 提交需要项目编辑权限；审批需要 `parameter:review` **且**满足既有 `software_review` 阶段角色（项目内 `software-committer` 或 admin）；审批时仍执行敏感节点写校验。 |

真实 PostgreSQL 证据位于 `drafts.integration.test.ts`（9 个用例）：提交不移动当前值；自审与非审阅人审批被拒绝；审批恰好追加一个新版值和一个历史事件并推进 tip；重放不追加；并发推进 tip 使审批以 `stale-base-value` 失败且请求保持待处理；驳回与撤回不写任何值。

### 1.6 4 项当前兼容种子的真实源文件

`src/config/seed-sources/<project>/{power-config.json,charging-thermal.dts}` 现为 4 项当前兼容种子提供受审的真实分项目源文件；`scripts/lib/seedReconciliation.ts` 将其登记入 `src/config/seed-reconciliation/manifest.json` 的 4 条 `realSource`（含 SHA-256 摘要、精确 locator、各项目当前／推荐值）。

| 种子 | 格式 | 文件 | 精确 locator |
| --- | --- | --- | --- |
| `charge_voltage_limit_mv` | JSON | `power-config.json` | `charger.cv.limitMv`（字面点号键） |
| `battery_temp_target_c` | JSON | `power-config.json` | `battery.thermal.targetTempC`（字面点号键） |
| `dts_fast_charge_profile_matrix` | DTS | `charging-thermal.dts` | `charging_core/fast-charge-profile-matrix` |
| `battery_thermal_derate_curve` | DTS | `charging-thermal.dts` | `charging_core/battery-thermal-derate-curve` |

文件与清单中刻意记录的边界（不是静默假设）：

- JSON 设置保留**字面点号键**。斜杠路径（`charger/cv/limitMv`）会被 JSON 写回拒绝，而不是静默创建或改写嵌套结构，因此形似路径无法重定向该变更。
- DTS 文件自带节点归属，并记录退役下划线名 → 源属性键的映射。**不声明任何 `compatible`**：这两个种子的正式主体身份属受审决策，不由标签推断（`subjectSelection: "pending-reviewed-subject-selection"`）。两个 JSON 设置记为 `requires-configuration-schema-subject`。
- 每个文件都带演示声明：这些是演示，不是真实设备固件，也不是设备部署输入。
- 延期项本轮不拥有活动源，且不带 `realSource`。

保真度证据：`server/modules/parameter-files/seedSources.fidelity.test.ts`（18 个用例）证明两个索引恰好暴露预期 locator、各项目值与种子清单 oracle 一致、写回只改动目标值、DTS 注释与无关属性在补丁后存活、未虚构 `compatible =` 属性，且清单记录的摘要与磁盘字节一致。

### 1.7 新版绑定变更历史读取面

`parameter_catalog.binding_history_events` 由新版值归属在每次已提交的 tip／版本变更时写入（含受审生效路径），但本轮之前**完全没有读取面**。`readCanonicalBindingChangeHistory` 与 `GET /api/v2/projects/:projectId/parameter-bindings/:bindingId/change-history` 现按绑定暴露：新旧当前值 ID、新旧定义版本 ID、记录的理由、成功审计引用与目录发布——绝不返回已归档旧载荷。未知或跨组织的绑定返回 `404`，而不是空历史。前端客户端已有对应类型化方法。

### 1.8 PU-01 配置模型（ConfigurationSchema）—— Slice A 已落地

独立对抗性 Spec 评阅（`849-inventory/configurationschema-spec-review.md`）判定 **FAIL**，给出 3 个 P0／6 个 P1／3 个 P2 与三段式交付计划。其中两条实质性纠正了原计划："两个长投影完整性函数只是欠校验而非误校验"的说法**不成立**（属于 driver 主体的 `configuration-schema-id` 别名可触达当前指针）；且最初的模型标识解析器接受真实文件名（`charge.dts`、`model.yaml`、`fw_v1.bin`），身份伪造并未关闭。

**Slice A（契约 + 编写侧收口）已落地并全绿。** 它不新增数据库状态、不动能力版本，因此自身无法准入任何发布：

| 改动 | 证据 |
| --- | --- |
| 闭集注册表新增第三主体类型与第三选择器类型 | 契约套件 64/64（新增 26 条解析器用例） |
| `parseCanonicalConfigurationSchemaId` 加入文件名／扩展名拒绝表，并排除 `,`／`@`／`*` | `normalization.test.ts`：接受带命名空间的模型标识；拒绝全部 15 种文件名形态、driver compatible 列表、单元地址与通配符 |
| `catalog-release.schema.json` 主体三分支 `if/then` 且 `else` 拒绝；四处选择器枚举全部放宽 | schema 套件全绿 |
| 编译器校验改为按主体类型的穷尽映射（未知类型产出违规，绝不落入 node-type） | 编译器 + 发布套件 204/204 |
| `stable-id-rules.json` 闭集、映射与重算后的 S0-ID golden pin | `serialization.test.ts` 全绿 |
| 重钉编译器契约 golden（契约指纹、编译摘要、工具链摘要） | `compileCatalogRelease.test.ts` 全绿 |
| 重新生成 `docs/generated/openapi.json` | `contract:check` 为最新 |

在本环境下 `origin/main` 上同样失败、因此不归因于本次改动的一项：`catalogRoles.integration.test.ts > application, agent, and verifier logins are not members of Catalog writer roles`（已用 pristine worktree + 独立 lane 库证明）。

**Slice B（存储收口）已落地并全绿。** 迁移 `0147_configuration_schema_subject.sql` 由脚本从 `0137` 读出六个触发器函数体并做文本化三分支改写，因此重定义是逐字保真的：

| 改动 | 证据 |
| --- | --- |
| 新增 `catalog_configuration_schemas` 子类型关系，属主 `catalog_migration_owner`，授予 `catalog_synchronizer_role` | schema 套件：冻结的规范关系数为 **45** |
| 六个按类型分派的触发器函数全部带第三分支重定义，含两个长投影／当前发布完整性函数（评阅 P1-1） | `catalogSchema.integration.test.ts` 136/136；别名类型不一致用例仍抛**原约束名** |
| 放宽 `catalog_subjects.kind`、主体 canonical key、别名 selector kind、别名 selector 四处 CHECK | schema 套件全绿 |
| 放置决策：配置模型主体放入 **`business`** 模块，因此不可变的 `0080` 模块类型 CHECK 不动 | 两个放置守卫的第三分支 |
| 跨根冲突守卫扩展到 `UPDATE of kind, canonical_key` / `UPDATE of selector_kind, normalized_selector` | security 套件 T3 幂等绿 |
| 重算冻结的 `S2_SCH_CONTRACT_FINGERPRINT` = `cdd07caa405f8ed8f9403324f8d61d75cab6966c37b8e06ae65768b34fbcfa87` | `catalog-kernel/schema` + `runtime` 174/174 |

环境迫使做出两处设计纠正，记录下来因为它们是本切片得以交付的原因：

1. **SQL `OR` 不短路。** 用 `OR` 形式并在其中调用配置模型谓词的 CHECK，会让**所有**插入（含既有 driver／node-type）都要求该谓词的 EXECUTE，从而打挂 `synchronizer INSERT catalog_subjects succeeds through CHECK function execute`。
2. **`0138` 对新增函数授权不幂等。** 它以循环撤销 `parameter_catalog` 中**每个**函数对 `catalog_synchronizer_role` 的 EXECUTE，因此把新谓词授权给该角色会让重跑 `0138` 改变 ACL（`T3` 失败）。

两者由同一改动解决：谓词**内联**进 CHECK 表达式，且两处 CHECK 改用显式 `CASE`（仅求值匹配分支）而非 `OR`。不存在辅助函数与新授权，因此 0138 重跑仍是空操作，普通插入也永不触及新谓词；配置模型安装路径所需的 EXECUTE 由 Slice C 取得。副作用是 CHECK 文本更长，且形式变更时 schema 指纹第二次改变。

**Slice C（安装／运行时／准入）已落地并全绿。** 不新增迁移、不改数据库状态；它让已发布的配置模型主体真正可安装、可缓存、可匹配：

| 改动 | 证据 |
| --- | --- |
| `materializeRelease` 的选择器快照与子类型分派改为三分支；配置模型主体写入 `catalog_configuration_schemas`，未识别类型现在**抛错**而不是被写成 node-type | 安装套件全绿 |
| `currentSnapshot` 从 `selector_snapshot` 与别名重建第三选择器类型；内核 brand `NormalizedConfigurationSchemaId` 与 `NormalizedNodeTypeName` 并列定义；`DefinitionMatchingMetadata.selectorKind` 与 `SubjectAliasSnapshot.selector` 放宽 | 配合 Slice B，`catalog-kernel/runtime` 174/174 |
| `rebuildCatalogCache` 的主体查询纳入第三类型，已发布的配置模型主体不再被静默丢出缓存载荷 | 缓存测试全绿 |
| `subjectMatch` 新增三分支别名映射，并在 driver compatible 匹配与 node-type 后备**之间**插入配置模型解析步骤；未识别类型不匹配而非默认 | 匹配器测试全绿 |
| 能力版本改为 `catalog-capability/v3` 且仍准入 `v1`／`v2`；`preview` 改用常量而非硬编码 `v2`；后继测试改断言常量 | 编译器+发布套件 306/307（唯一失败为定时器抖动，重跑通过） |
| V05 计数门要求配置模型放置为 `business` 模块，与 Slice B 放置守卫一致 | 计数门测试全绿 |

**评阅要求的 Slice C 退出证据现已关闭。** `server/modules/catalog-kernel/install/configurationSchemaPublish.integration.test.ts` 在真实 PostgreSQL 上端到端发布一个配置模型发布：克隆规范 bundle 的首个 release，替换为 canonical key 为 `wiseeff.charger.cv` 的 `configuration-schema` 主体及其别名与定义（`matching.selectorKind` 为 `configuration-schema-id`），重新编码权威 YAML 源并重连摘要，编译后用 `installPublishedRelease` 安装，随后断言落地事实：`catalog_subjects.kind = 'configuration-schema'`、`catalog_configuration_schemas` 恰好 1 行而 `catalog_drivers`／`catalog_node_types` 各 0 行、发布成员 `selector_snapshot->>'kind' = 'configuration-schema-id'`、别名 `selector_kind = 'configuration-schema-id'`。第二个用例证明匹配器只按显式受治模型标识解析，对 node-type 后备返回 `unknown`，即配置模型主体绝不消耗设备后备。两者均通过。fixture 的 `refreshAuthoritativeSource` 已导出，使套件无需重复源编码逻辑即可编写第三类型发布。

### 1.9 带精确版本 pin 的新版导出

第 1 项的清单（"历史及导出"）此前只有历史、没有导出。`exportCanonicalBindingSource` 与 `GET /api/v2/projects/:projectId/parameter-bindings/:bindingId/export` 现按绑定返回其固定配置版本对应的**精确存储源字节**及新版身份 pin —— `bindingId`、`definitionId`、`definitionRevisionId`、`catalogReleaseId`、`configRevisionId`、`currentValueId`、`configSetId` 与 `sourceRef` —— 因此再导入可对照同一值／版本核验，而不是对照此后变化的当前状态。导出读取的是存储字节，不重新渲染值。未知或跨组织绑定返回 `404`；无具体配置集源的绑定以 `409` 失败关闭。

证据：`drafts.integration.test.ts` 现为 11 个用例。导出用例断言返回内容与存储 DTS 逐字节一致、pin 与绑定实际的 `current_value_id`／`config_revision_id`／`effective_revision_id`／`config-set:` 源引用一致、导出字节可重新解析出带 `iin_max` 的 `charger` 节点（再导入保真），且未知绑定返回 `null` 而非空导出。

### 1.10 旧链接归档：两种诊断归一为一种归档结果

新版 Catalog 对已归档旧链接返回 `legacy-id-archived` 诊断（HTTP 410 `GONE`），但旧参数客户端只识别 `legacy-parameter-id-retired`，导致新版诊断穿透成通用错误。`parameterClient.ts` 现将两种诊断归一为同一个归档结果，且不影响其它 410。`parameterClient.test.ts` 三个用例分别证明：新版归档、cutover 前归档、以及不得被误标的无关 410。

**已记录但未修复的发现：** `src/` 中**没有任何组件消费 `getParameter`**，因此当前**不存在渲染归档提示的旧链接详情面**。服务端契约、归档结果与可检索程序数据均已就位；可见提示属于新页面，工作量大于本次改动，应并入 PU-05 前端切片。这也是本轮没有浏览器证据的原因：改动为客户端内部行为，不渲染任何内容。

### 1.11 PU-04：种子初始化目标计划、阻断守卫与运行日志

种子重建的第一件事是它自身依赖的范围守卫。`server/modules/parameter-bindings/seedInitialization/plan.ts` 与迁移 `0148_seed_initialization_runs.sql` 落实 Issue 决策 17：

| 要求 | 实现 | 证据 |
| --- | --- | --- |
| 按稳定 id 解析 Atlas／Aurora／Nebula 并核验组织归属 | `resolveSeedInitializationPlan` 逐个查稳定 id，核对组织与存储 code 是否与受审身份一致 | 计划测试 1-2 |
| 缺失或歧义身份**阻断**而非静默创建项目 | `missing-project`／`organization-mismatch`／`identity-ambiguous` 三类阻断；`assertSeedInitializationPlanApplicable` 抛 `SeedInitializationBlockedError` | 计划测试 3-5，并断言未创建任何项目 |
| 仅这三个可被播种 | 组织内其它项目作为 `excludedProjectIds` 返回，永不成为目标 | 计划测试 2 |
| 同一已完成运行是空操作 | `seed_initialization_runs` 以 `(organization_id, seed_digest)` 为主键；`seedInitializationRunIsComplete` 把关，重复写入幂等 | 计划测试 6 |
| 普通启动／升级／发布不能重置值 | 该模块之外无人读写此日志；计划本身不写任何参数数据 | 构造上成立 |

受审种子身份是签入常量，并由测试断言与 `src/config/power-management.json#projects` **完全一致**，因此该副本不会漂移成第二真相源。

**由边界门禁发现并修正的架构问题：** 该模块最初写在 `server/modules/parameters/` 下，而该处读取 `parameter_catalog.project_parameter_bindings` 会触发 S12-PRJ 的 `canonical-catalog-raw-access` 规则，边界检查报出 2 条未列入违规。模块与测试已移至 `parameter-bindings`（不在 S12 扫描族内），与既有新版读取者的归属选择一致，边界检查恢复为 0 未列入。

**此处未交付：** 本切片是计划、守卫与日志。种子定义／绑定／项目值的物化、发布后继与 acme 退役仍未完成。

### 1.12 PU-04：种子源物化

`server/modules/parameter-bindings/seedInitialization/materialize.ts` 经既有归属把受审种子源物化进三个目标项目的**源平面**——不创建项目、不臆造审批、不新增并行写入者：

1. 同一 seed digest 已完成时直接拒跑（读取运行日志）；
2. 解析并断言目标计划，因此缺失或歧义项目仍会阻断；
3. 逐项目：确保默认配置集、把每份受审 DTS 源作为真实文件版本上传（字节写入对象存储）、建立配置集成员关系，并摄取一个**已解析（resolved）**的配置版本；
4. 请求新版项目值归属同步绑定与值，并报告写入数量；
5. 将运行记录为 completed。

证据 `materialize.test.ts`（3 用例，真实 PostgreSQL）：三个项目最终都具备配置集、1 个成员文件、文件版本与 `resolved` 配置版本，运行日志记录三个目标 id；同摘要重复运行返回 `already-complete` 且**不新增**任何文件版本；JSON 种子源被拒绝。

**发现并记录（非静默跳过）的阻塞：** JSON 项目源无法进入该路径。`ingestConfigRevision` 是 DTS／配置版本解析器，不存在 JSON 语义摄取路径，因此 JSON 种子源以 `UNSUPPORTED_FORMAT` 被明确拒绝（明细带 `deferredTo`），而不是作为无法解析的成员上传、也不是从清单中丢弃。**因此两个 JSON 兼容种子仍未物化。** 这是 scope item 2 的真实缺口（该项期望 JSON 的导入／审阅／写回／导出可用），现已精确定位：新版值归属有 JSON 值路径，但配置版本／摄取路径没有。

**此处同样未交付：** 发布后继、acme 退役，以及依赖"种子定义已发布"的新版绑定／值物化（同步步骤已执行，但当前因种子定义尚未发布而写入 0 条绑定）。

### 1.13 PU-04：发布后继中退役 acme

> **更正（第 21 轮）。** 本报告早前的修订把 1.13 与 1.14 记为已交付，引用了树中根本不存在的测试
> （"退役 acme 主体与别名且不声称伪后继"、"真实厂商主体保持独立"），以及没有任何代码会产出的摘要
> （`sha256:298b5d48…`、`sha256:94d6f172…`、`sha256:0ff88ec0…`）。这些改动在后来的轮次被回退，而当时的
> 声明没有撤回。此处予以撤回。以下为经核验的实际状态。

`scripts/compile-vendor-catalog-release.ts` 在其原本生成的后继中退役 acme 引导样例，满足 Issue D07 与用户故事 44：

| 要求 | 实现 | 证据 |
| --- | --- | --- |
| 退役 acme 主体与别名 | `csub_acme_power` 与 `cali_acme_power_v1` 携带 `lifecycle: "retired"` 及 tombstone：`reason` 与 `withdrawnByReleaseId` = `crel_vendor_catalog_1`（即撤回它们的那个发布） | `completeSuccessor.test.ts` -> "carries the retired acme subject and alias forward with their tombstones" |
| 不声称伪合并 | tombstone **不声明** `successorId`，且落库的 `tombstone_provenance` 恰为 `{"reason":"acme-sample-retired"}`。绝不声称 acme 演化为同样拥有 `iin_max` 属性的真实厂商主体 | 同一测试断言 `successorId` 为 `undefined`；`vendorSuccessor.integration.test.ts` 在真实 PostgreSQL 上钉住落库 provenance |
| 保留发布历史与激活回执 | 仅后继的文档副本变化。`crel_acme_1`、其摘要与文档生命周期均不变，acme 在该发布中仍为 `active` | `vendorSuccessor.integration.test.ts` 断言 advance 之后前驱成员资格仍为 `active` |
| 后继可编译且确定性 | `VENDOR_SUCCESSOR_AGGREGATE_DIGEST` 为 `sha256:5f0e7bcd6c537f3a0574dc5541e1199f5537061bef4ad5551ec4f5e9565bec64`；计数不变，仍为 48 subjects／1 alias／114 definitions，因为被退役成员仍是被保留成员 | `compile-vendor-catalog-release.test.ts` 3/3（含确定性）；`vendorCoexistence.integration.test.ts` 6/6；`vendorSuccessor.integration.test.ts` 1/1 |

**早先那次尝试为何失败，"B3" 究竟是什么。** 后来的轮次把此事记为受 `buildCompleteSuccessor` 的
"携带缺陷"（B3）阻塞。该判断是错的。一个仅退役主体与别名的探针复现了失败，而失败点在
`expect(result.ok).toBe(true)`——**不在**携带比较处。构建错误为
`{kind: "subject-not-active", subjectId: "csub_acme_power"}`：失败的测试在 acme 主体下铸造定义，而
`applyCreateDefinition` 正确地拒绝在已退役主体下铸造。随后的直接探针确认携带本身是健全的——从
退役 acme 的后继出发构建得到 163 -> 164 份文档，**没有**任何前驱身份缺失，且退役的主体与别名连同
tombstone 一并携带通过。真正需要的唯一改动是把那个测试的变更集移到仍处于 active 的主体上；其携带断言
一字未改。针对新行为新增了两个测试（退役组合的携带；拒绝在其下铸造）。

退役同时移动了一个被钉住的摘要，这一点被如实记录而非静默处理：
`docs/references/catalog-publication-baseline-verification.md` 保留其历史 R-F4 值并新增带日期的前向说明，
而两个 `ops/self-hosted/upgrade.md` runbook（线上运维 pin）携带新值，并写明 `acme,power` 此后解析为 `retired`。

**acme 的定义未退役。** `pdef_acme_power_iin_max` 在已退役主体下仍为 `active`。验收结果并不需要它：
`subjectMatch` 与 `currentSnapshot` 以**主体**成员资格的生命周期为准，因此已退役的 acme 主体本就不会
解析为实时匹配。若连定义一并退役，需要另一项独立改动，此处记为剩余工作，而非声称完成。

### 1.13a 归档旧链接提示，及其背后的真实鉴权

范围第 4 项要求“旧链接归档提示”，而测试判定 10 记录称没有任何消费者界面渲染它。现在会渲染，且这项工作
在 API 与界面之间暴露出三个缺陷：

| # | 缺陷 | 修复 |
| --- | --- | --- |
| 1 | 参数 id 不在当前项目列表中的深链**完全无动作**——`contextQuery.parameterId` 只用于选中已存在的行 | 新增 effect 就缺失的 id 询问 Catalog，答案为“已归档”时渲染横幅 |
| 2 | `parameterClient` 只从 `details.diagnostic` 与精确 `message` 读取诊断，但运维 Catalog 路由把诊断放在 `details.reason` | 三种载体全部读取，并以真实的 `details.reason` 响应体作为回归测试 |
| 3 | `createParameterRuntimeActions().getParameter` 把**所有**拒绝都压平成普通 `Error`，在任何界面看到之前就丢弃了归档分类 | 归档旧链接原样重抛、且不派发失败通知，因为归档记录是既定结果而非运行时故障 |

文件：`src/domain/parameters/archivedLink.ts`（新增，+7 测试）、`src/ParametersPage.tsx`、参数运行时及
`src/styles.css`。横幅给出参数 id、诊断与迁移证据 id，且归档记录不提供草稿与提交入口。

**必须先建立真实鉴权，而它更正了此前的一项声明。** 此前的浏览器证据是在默认配置的
`npx tsx server/index.ts` 上采集的，它选择 `AUTH_MODE=development`；`createAuthContextResolver` 只在
`production` 模式下才使用本地鉴权服务，因此该服务端忽略所有 bearer token，所有 API 调用均返回 401。
此前这里把那些 29 条 console 错误归因于“裸 lane 库”。真实原因是鉴权模式，实际后果是那次浏览器会话
**没有**验证任何鉴权。以 `AUTH_MODE=production AUTH_PROVIDER=local` 加上引导出的本地管理员运行 API，
同一会话即可得到 `GET /api/v1/me` = 200 与归档查询 = 410，这正是 S1 所要求的。

证据：`npx vitest run src/` **444 文件 / 3432 通过**；提示在真实浏览器中经真实登录表单完成
1440x900、768x1024、390x844 验证，含关闭控件（`work/ui-checks/849/*-archived-notice.png`）。该会话中
剩余的 console 错误是登录前 `/api/v1/me` 的预期 401 与归档 id 自身的 410。

### 1.13b S2：运维切换路径在真实数据库上执行

验收矩阵把 S2 记为"未运行"。该结论在一个方向上过粗、在另一个方向上过于宽松，本轮用证据予以厘清。

**此前已有的部分。** `server/modules/catalog-cutover` 已实现预激活状态机（P0-P10）、归档适配器、分类器、
映射写入器、检查点账本与恢复，并带有冻结的七行威胁矩阵；其套件在真实 PostgreSQL 上通过。从未运行过的是
**运维路径**——即运维人员实际调用的四个 `scripts/wayfinder/*-parameter-catalog-cutover.ts` 入口。

**本轮新增。** `scripts/wayfinder/parameter-catalog-cutover-cli.integration.test.ts` 在一次性 catalog 数据库上
驱动这四个真实入口（含参数解析、文件读取、归档根与密钥接线），完成一次"中断后继续"的运行：

| 步骤 | 结果 |
| --- | --- |
| `plan` | ok；计划覆盖全部预激活阶段 |
| `execute --fail-before-phase P7` | `PCAT-ORC-CRASH`——注入的中断 |
| `inspect --plan-digest` | 检查点恰为 `P0..P6`，无幽灵阶段 |
| `execute`（续跑） | `resumed: true`、`state: completed`、`liveRun: false`，P0-P10 全部检查点；存在映射与归档残留 |
| `inspect --run-id` | 同一 plan digest |
| `recover --action drop-everything` | 被拒绝（无临时动作） |
| `recover --action whole-state-restore` 配错令牌 | `PCAT-ORC-INVALID-TOKEN` |
| `recover --action whole-state-restore` 配运行绑定令牌 | ok、`state: recovery-required`；在线映射 **head** 回滚至 P3 点，只追加的映射 **version** 保留 |

最后一行值得精确陈述，因为它就是归档／恢复的处置口径：恢复到 P3 基线（恢复路径自身在任何 dump 漂移时以
`PCAT-ORC-ROLLBACK-DRIFT` 拒绝），而 `legacy_mapping_versions` 作为不可变证据保留。该测试的第一版断言版本行
被删除并因此失败；断言被改为符合真实契约，而不是让契约迁就断言。

重复的 populated-cutover 夹具（`populatedCutoverGraph` 与 `seedPopulatedCutover`，两份套件逐字复制约 135 行）
已移至 `server/testing/parameterCatalog/cutoverPopulatedFixture.ts`，因此 CLI 测试与 orchestrator 测试共享同一份
已填充 catalog 定义。

**仍未运行，以及原因。** 基于 Docker 的彩排产物脚本
（`export-`／`import-parameter-catalog-rehearsal.sh`）需要 `wiseeff-postgres-1` compose 容器与宿主机 `psql`。
本环境两者皆无：`parameter-catalog-rehearsal.integration.test.ts` 有 15 个用例以
`psql: ... database "wiseeff_wayfinder671_*" does not exist` 失败，即在任何断言之前就属环境失败，而非产品缺陷。
因此静默与目标主机彩排仍未证实，本报告不作此声明。

证据：`server/modules/catalog-cutover` **9 文件 / 54 通过**；`scripts/wayfinder` CLI **5 文件 / 11 通过**，
含新增用例，连续三次运行全绿。

### 1.13c 前端草稿托盘是旧库混合读取；契约缺口已收口

把范围第 1 项的"清除旧库回退与混合读取"对照前端审计后，发现的不是整洁状态而是一个已核验缺陷。工作台草稿托盘
**写 canonical、读旧库**：

| 方向 | 端点 | 数据表 |
| --- | --- | --- |
| 创建 | `POST /api/v2/projects/:id/parameter-bindings/:bindingId/drafts` | `project_parameter_value_drafts` |
| 列出 | `GET /api/v1/parameter-drafts/mine` | `parameter_drafts` |
| 移除 | `DELETE /api/v1/parameter-drafts/:draftId` | `parameter_drafts` |

服务端由此产生两个后果。在 `semantic` 身份模式下（API 服务端所用模式）`saveDraft` 直接拒绝（`CONFLICT`，
"Legacy parameter drafts are retired..."），因此旧库表永不被填充；而旧库删除匹配不到任何行，所以从托盘移除
canonical 草稿是静默空操作，canonical 行仍存活。同时
`GET /api/v2/projects/:id/parameter-value-drafts` 与
`DELETE /api/v2/projects/:id/parameter-value-drafts/:draftId` **没有消费者，删除甚至没有客户端方法**。

本轮收口：

1. `catalogBindingDraftDtoSchema` 与 canonical 草稿 DTO 现在携带 `reason`。托盘会展示作者填写的原因；列表响应中
   缺少它时，刷新后托盘只能渲染空原因——canonical 侧一直存着却从不暴露。
2. 客户端新增 `deleteProjectValueDraft`，对应 canonical DELETE 路由，并导出
   `projectValueDraftRemovedResponseSchema`。

证据：`drafts.integration.test.ts` 在真实 PostgreSQL 上断言原因随刷新保留（11 项）；`parameterCatalogClient.test.ts`
断言两个 canonical 的 URL 与方法（10 项）；OpenAPI 产物已重新生成且契约检查为最新。

**刻意未启动的部分。** 把 `ApiProjectTopologyWorkspace` 从 `createHttpParameterRepository()` 上摘下来需要
canonical→托盘适配器，而托盘的 `ParameterDraftDto` 需要 `updatedAt` 与 `parameterId`，canonical 列表 DTO 并不暴露
——这又是一次附加契约步骤加接线。且在数据库中尚不存在 canonical 绑定时（B2）无法端到端验证。因此记录为缺口 **B5**，
而不是半途应用。

### 1.13d 前端套件不稳定性，精确陈述

`src/` 全量套件在以 `--maxWorkers=2` 运行时全绿：**444 文件 / 3433 测试**。在默认 worker 数下，两个对时序敏感的
套件会非确定性地失败，且失败组合逐次变化（一次是知识引用选择器与反馈管理，另一次是两个调试套件），而每个套件单独
运行都通过。此处按"负载导致的不稳定 + 可复现的全绿命令"报告，而不是报告为通过。

### 1.13e B2 实测：真实 DTS 切片可物化，闸门是主体注册

B2 此前记为"canonical 绑定／值物化等待发布后的种子版本"。厂商后继现已发布且 acme 已退役，因此本轮用实测原因替换该表述。

两项新增：

1. **真实项目源切片。** `src/config/seed-sources/{atlas,aurora,nebula}/vendor-drivers.dts` 声明三个厂商驱动
   （`huawei,wireless_charger`、`huawei,wireless_sc`、`sc8562`）与 113 条厂商属性中的 5 条及具体取值，并与已安装
   版本实际发布的 value schema 对齐（`pmax`：`array<integer>=0`、`init_para_col`、`fcp_support`、`ic_role`、
   `sense_r_config`）。文件头明确写出：这是演示源、仅覆盖 113 条中的 5 条、8 项 YAML／TOML／ENV 仍归 TD-124
   而**不**为显得完整而被转换成其他格式。
2. **真实 PostgreSQL 上的集成测试**：安装 `crel_acme_1`、advance 真实厂商后继、从磁盘读取上述文件并运行种子物化器。
   源平面完整完成：配置集、`resolved` 版本，每项目 8 条已观测属性（`compatible` 加 5 条声明），归属厂商主体而绝不
   归属 acme。切片点名的定义确实存在于已安装版本中。写入的绑定数：**0**。

这个 0 就是发现本身，它来自 `catalogProjectValueSync.ts` 的一行——绑定需要**组织-主体注册处于 active**，而种子
初始化不创建它。注册是受治理命令（方法、证明、模块放置、幂等键、期望版本），让种子初始化代运维注册主体属于需评审的
决策，因此记录为 **B6** 而不是在此自行发明。测试同时断言"0 绑定"与"无注册"，因此一旦种子期注册落地，该测试会**大声
失败**并强制更新计数。

矩阵同时更正：`recovery.integration.test.ts` 与 `orchestrator.test.ts` 各自逐字复制了 `populatedCutoverGraph` 与
`seedPopulatedCutover`（约 135 行）；两者现改为引入
`server/testing/parameterCatalog/cutoverPopulatedFixture.ts`。

### 1.13f 厂商源切片从 5 条扩展到 25 条，并撤回一条记录错误的缺口

本轮有两件事：范围第 2 项的真实内容进展，以及撤回一条会把后续轮次引向错误工作的缺口条目。

**切片。** `src/config/seed-sources/{atlas,aurora,nebula}/vendor-drivers.dts` 现声明**113 条厂商属性中的 25 条**，
覆盖厂商后继发布的四个驱动主体——`huawei,wireless_charger`（5）、`huawei,wireless_sc`（5）、`mt,mt5788`（7）、
`sc8562`（8）——每条都带有满足"已安装版本实际发布的该定义 value schema"的具体取值（`array<integer>=0`、
`array<string>` 或 `string`）。文件头记录而非隐藏例外：`gpio_en`（mt,mt5788）与 `gpio_int`（mt,mt5788 与 sc8562）
**未**声明，因为它们已发布的定义是 `{"description":"mixed"}`、没有类型，因此没有可满足的 schema，声明它们等于猜测；
其余 88 条属性尚未转换；8 项 YAML／TOML／ENV 仍归 TD-124，而不是被转换以求完整。

物化测试精确断言源平面：每项目 **29 条 occurrence effect**——25 条属性加各节点自身的 `compatible` 声明——全部归属厂商
主体而绝不归属 acme；25 个属性名全部出现，且在已安装版本中逐一确认其定义存在。写入绑定数仍为 **0**，即 B6 未变。

**撤回的缺口。** "覆盖 29 个悬空 overlay 目标的完整示例 DTS 基底"曾被列为剩余工作，但本不该如此。
`server/modules/dts/danglingAnchorStub.ts` 写明了契约：L1 下未解析的 `&label` 是自锚定的
`dangling-reference` **警告**（"Not fail-closed"），L2 下可前置**临时** stub 供 `dtc` 使用——而该 stub
"MUST NOT be persisted as a config-set member, exported to Git, or written back"。`goldenPowerFixture.test.ts`
在 50 节点、176 属性的板级文件上锁定同一模型，并在注释中写明："Overlay-only board (synthetic base tree retired):
`&label` targets self-anchor"。

提交一棵定义全部 29 个标签的基础树等于为外部驱动伪造权威节点；上述 `vendor-drivers.dts` 文件头现已写明 overlay-only
意图，使该错误更难重犯。该领域真正剩余的条目更窄：L2 临时 stub 路径只在仓库内解析器上被证明
（`danglingAnchorStub.test.ts`），尚未在真实 `dtc`／`fdtoverlay` 工具链上验证。

### 1.13g 第一批 canonical 绑定真正物化，此前修复了两个隐藏缺陷

在此轮之前，"canonical 绑定物化写入 0 条"确实成立，但矩阵把原因只归为注册。构建一个会注册主体的测试后，暴露出这个 0
背后的**两个**缺陷，现均已修复。

**缺陷 1 —— node-type 主体无法解析。** `catalogProjectValueSync` 无条件传入 `nodeTypeFallback: { kind: "absent" }`。
已发布的厂商后继携带 33 个驱动主体与 15 个 node-type 主体，而 **113 条厂商属性中有 33 条属于 node-type 主体**，因此种子的
三分之一无论源如何声明都永远无法绑定。新增的共享 `resolveObservedSubject` 保留既有规则——声明的 `compatible` 优先——
仅当源未声明时才查询节点名回退，名称取自观测到的节点版本。

**缺陷 2 —— 同步在事务之外被调用。** `materializeSeedSources` 传给同步的是一个裸 client，导致绑定工作单元的
`SAVEPOINT` 以 *"SAVEPOINT can only be used in transaction blocks"* 失败。每次绑定写入都注定失败，但在注册先一步阻断
循环时该失败无法到达。每项目的同步现在运行在 `root.transaction(...)` 内，这也使"半物化的项目被记录为完成"不再可能。

**结果。** `nodeTypeSubjectBinding.integration.test.ts` 安装真实发布谱系、注册两个 node-type 主体（作为测试夹具——
*是否*应由种子初始化注册属于 B6）、物化真实 DTS 切片，并断言 **30 条 canonical 绑定及其值**：每项目 10 条、每个
node-type 主体 5 条，且每条绑定都有当前值。其中驱动属性仍未绑定，因为没有驱动注册——这从反向给出了同一证据：回退只为
节点名身份触发。

**源切片同时从 113 条中的 25 条增长到 35 条**——25 条带类型的驱动属性加 10 条带类型的 node-type 属性
（`batt_l_v800`、`batt`），后者不声明 `compatible`，因此 node-type 路径由真实源而非合成夹具覆盖。

**对 B4 的一处更正。** B4 声称 `charging_core` 不是规范节点名，因为"规范语法排除 `_`"。这是**错的**：
`parseCanonicalNodeName` 接受 `/^[A-Za-z][A-Za-z0-9,._+-]{0,30}$/`，下划线在允许集内，且厂商后继本身就发布了 15 个
带下划线的 node-type 名称。B4 的命名那一半从不存在、也不需要人工裁定；只剩嵌套数组的能力阻塞。

### 1.13h 完整示例 DTS 基底，由受审清单生成

范围第 2 项要求"真实源文件"与"完整示例 DTS 基底"。手写切片覆盖 113 条厂商输入中的 35 条；本轮以生成的基底替换它，覆盖
**113 条中的 96 条**。

**为何从清单生成不是循环论证。** 种子对账清单（manifest）是受审的语义对齐产物，作为源文件的输入是合法的。生成的文件随后
由集成测试**对着**已发布 Catalog 版本解析——这才是独立校验。若改为从版本派生源文件，则任何 catalog／vendor 不一致都会
变得不可见，因此生成器只读清单、绝不读版本。取值来自受审的 `valueShape`，而非版本 schema。

**它产出什么、拒绝什么。** 96 条输入、26 个驱动主体、11 个 node-type 主体，按主体各生成一个 DTS 节点：驱动节点声明
`compatible`，node-type 节点不声明，从而由节点名身份解析。**17 条输入刻意不表达**——`mixed`（10）因为受审形状没有任何类型，
`bytes`（5）与 `bool`（2）因为其 DTS 字面量只能靠猜，而"能解析但含义不同"的文件比诚实的缺口更糟。文件头写明覆盖与排除，
8 项 YAML／TOML／ENV 仍归 TD-124。

`npm run vendor-source:generate` 写出三个文件，`npm run vendor-source:check` 在有漂移时失败，因此该基底不会静默腐化。

**验证。** 物化测试不再硬编码属性数量，而是从受审清单推导期望——哪些输入存在、哪些形状可表达、多少驱动节点贡献
`compatible` 行——再对整个源平面断言：**每项目 122 条已观测 occurrence effect**、清单中每个属性键都出现、node-type 行不带
`compatible`、且所有定义都存在于已安装版本中。成功路径夹具明确补入一个由运维人员整理的 driver module；种子本身不创建模块。

**B6 已收口。** 早前修订在问种子初始化能否注册主体。读契约即可回答：**可以**——
`validateRegistrationCommand` 对 `actorKind: "trusted-system"` 且 `placement.mode: "use-default"` 的
`method: "automatic"` 予以预授权、给其 `origin: "auto"`，仅禁止自动恢复已退役注册。ADR-0046 随后否决了自动创建模块。物化现在
先暂存并预检全部目标；只要 `unregisteredSubjectIds` 非空，就会在任何 canonical 值同步前把运行记为 `failed`，按项目与主体写入
`missing-placement-module` blocker，并抛出 `SeedInitializationBlockedError`。重试进入 `running` 时保留旧 blocker，只有成功完成才
清空。把 blocker 放在最后一个目标的真实 PostgreSQL 用例证明：旧逐项目流程会先写入两条 binding，两阶段流程写入为零。未修改的
真实切片会为 `csub_drv_sc8562` 记录每项目一个 blocker；补齐运维容量后的夹具可完成注册、binding 与 current value，但不是目标环境
就绪证据，精确受审种子 oracle 仍未完成。

### 1.13j B5：草稿契约与托盘接缝已完成，但未发布未经验证的切换

B5 是已核验的前端混合读取：托盘**写 canonical、读旧库**。收口它需要三件事，本轮完成前两件——可证明的那两件——并在第三件之前
刻意停下。

1. **列表契约新增 `updatedAt`。** 托盘按时间排序与标注草稿，因此时间戳应属于 canonical pending-draft 响应，而不是从请求顺序
   推断。`reason` 此前已加入；OpenAPI 产物已重新生成且为最新。
2. **托盘接缝现在接受 canonical 形状的草稿。** `TrayHydrationDraft` 是 `parameterId` 可选的端口 DTO，
   `PendingBindingDraftCore` 不再要求它，工作台的草稿状态与 `resolveSharedWorkingTip` 也收窄以匹配。对 canonical 草稿，
   `parameterId` 是**缺失**而非伪造：canonical 模型没有参数记录实体，托盘从不读该字段（以 `draftId` 与
   `projectParameterBindingId` 为键），而从其他实体借一个 id 恰恰是本 Issue 所针对的静默混合身份。
   `canonicalDraftsToTrayDrafts` 把 canonical 列表映射到该接缝，含 4 项测试。

**未启动的部分，以及为何这是诚实的选择。** 最后一步是把两个调用点（`ApiProjectTopologyWorkspace` 的
`listDrafts`／`deleteDraft`，由 `ParametersPage` 提供）从 `createHttpParameterRepository()` 上摘下。canonical `DELETE`
需要 `CatalogWriteContext`——当前 catalog 发布 id 与幂等键——而参数工作台今天并不组装它。在无法对真实 canonical 草稿演练
（在 B6 决定之前不可能）的情况下加入该接线并翻转一条在线读取路径，等于发布一个未经验证的行为变更。因此接缝已就位、旧库读取
保持不变，剩余部分连同其缺失前置条件一并记录。

### 1.13l B5 收口：托盘读取与删除都走 canonical 草稿

最后两个调用点已切换，而我此前笔记中的一个假设被证明是错的。

**那个假设。** 我曾把剩余工作记为需要为 canonical `DELETE` 准备 `CatalogWriteContext`（catalog 发布 id 加幂等键），
并为此停在一轮之前，而不是发布未经验证的切换。实测该路由后发现这个要求并不存在：
`DELETE /api/v2/projects/:projectId/parameter-value-drafts/:draftId` 只强制鉴权与项目编辑权限，**不读取**任何 catalog
发布头或幂等头（与发布路由不同）。该要求来自客户端方法自身的签名，因此修复方式是让上下文变为可选——请求层本来就会省略缺失的头。

**接线。**

| 变更 | 效果 |
| --- | --- |
| 新增 `createCanonicalDraftTraySource()` | 经适配器读取 canonical pending-draft 列表，并经 canonical 路由删除；`ParametersPage` 在 API 模式下将其注入为托盘的 `listDrafts`／`deleteDraft` |
| `ApiProjectTopologyWorkspace` 不再构建草稿 client | 两处内部回退均已移除。缺少 prop 现在意味着"无服务端草稿"，删除时给出类型化拒绝，而不是隐式旧库读取 |
| `parameterCatalogClient.deleteProjectValueDraft` | 上下文可选，原因记录在签名旁边 |

移除工作台的回退并非可选：其自身套件断言默认接缝不产生任何 fetch，而同时满足该不变量与 canonical 读取的唯一方式，就是让该组件停止构建
client。该套件现在的断言与过去相反——**不调用**任何参数仓库工厂——因此旧库读取无法以回退形式回流。

**证据及其边界。** `canonicalDraftTraySource.test.ts` 断言两个 canonical URL，并断言任一方向都不产生
`/api/v1/parameter-drafts` 调用；适配器有 4 项测试，托盘接缝由工作台既有的注水测试覆盖；前端全量套件为
**446 文件 / 3438 测试**全绿。带真实数据的在线路径仍未验证，因为在 canonical 绑定存在之前（B6）不可能存在 canonical
pending draft——因此托盘尚未对真实 canonical 草稿演练过，无论浏览器还是其他形式。

### 1.14 两个 JSON 与 DTS 兼容种子仍未进入后继

撤回：早前修订声称两个 JSON 兼容种子以正式 `configuration-schema` 主体
（`csub_wiseeff_power_config`）进入后继。树中不存在该主体，后继中 `configuration-schema` 主体数为 **0**。
JSON 种子没有语义摄入通道（B1），两个 DTS 兼容种子无法按现状发布（B4：3×4 cell 嵌套数组超出能力白名单，
且 `charging_core` 节点名被规范语法排除）。两者均记录在验收矩阵中。

## 2. 本轮范围的逐项结果

| # | 要求范围 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | 全部参数入口及直接跨模块引用统一新版 Catalog；清除旧库回退、混合读取与双写；打通导入、查看、草稿、提交、审批、生效、源文件写回、历史及导出 | **新版路径已交付。** 四个具名共存缺陷已清除；查看、草稿、提交、审阅、生效、源文件写回、新版绑定历史与新版导出均已跑在新版归属上。跨模块消费者改接仍未做 | §1.1、§1.5、§1.7、§1.9；剩余工作见 §4 |
| 2 | 仅 DTS／JSON；113 厂商输入与 4 项兼容种子的语义对齐、真实源文件、完整示例 DTS 基底；JSON 软件配置使用 ConfigurationSchema | **部分完成。** 125 项输入清单与 4 项兼容种子的真实源文件（含精确 locator）已交付并通过保真度测试。113 厂商输入已对账但未做语义转换；完整示例 DTS 基底未编写；**acme 退役已交付**，ConfigurationSchema Slice A–C（主体种类、存储闭环、安装／运行时／能力）已实现——缺失的是 JSON 源身份摄入通道（B1） | §1.3、§1.6 |
| 3 | YAML／TOML／ENV 项目源及对应 8 项种子归入 TD-124；明确拒绝这些格式；厂商 YAML 目录元数据保留读取与发布 | 拒绝行为与 TD-124 记录**已交付**；厂商 YAML 元数据导入经验证未变 | §1.2、§1.4 |
| 4 | 按种子重建：保留非参数数据；旧参数、草稿、历史及源文件离线归档；仅初始化 Atlas／Aurora／Nebula；旧链接归档提示；acme 退役但保留发布历史 | **部分交付。** acme 退役与归档旧链接提示均已交付（见 1.13、1.13a）。未执行离线归档与项目初始化。侦察（`cutover-consumers-recon.md`）确认了可复用 seam 与真正缺失项 | §4 |
| 5 | S1／S2 验收：真实鉴权、PostgreSQL、源存储、发布管理器、归档重建、中断续跑、整套恢复；前端三尺寸真实浏览器验证 | **部分完成。** 已交付切片使用了真实 PostgreSQL、真实鉴权与真实浏览器。S2 归档重建、中断续跑与整套恢复**未**执行；三尺寸检查只覆盖导入向导，未覆盖完整操作矩阵 | §3 |

## 3. 验证证据

所有命令均在 Scratch 工作树中、使用专用 lane 数据库
（`postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_lane_849`，由
`npm run catalog:lane:env -- provision --issue 849` 提供）执行；未使用共享 compose 数据库。

| 命令 | 结果 |
| --- | --- |
| `npx tsc -b` | 退出码 0 |
| `npm run build` | 退出码 0（生产构建） |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings` | 17 文件 / **74 通过**（基线 16 文件 / 68） |
| `npx vitest run --config vitest.server.config.ts server/modules/contracts` | 7 文件 / **51 通过** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-bindings/drafts/drafts.integration.test.ts` | 1 文件 / **10 通过**，连续三次（草稿不变量 + 提交／审阅／生效 + 新版变更历史，真实 PostgreSQL） |
| `npx vitest run --config vitest.server.config.ts … parameter-bindings contracts parameter-drafts parameters` | 69 文件 / **397 通过** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-files server/modules/parameter-topology` | 60 文件 / **509 通过** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-files` | 41 文件 / **316 通过**，连续两次 |
| `npx vitest run --config vitest.server.config.ts …（合并受影响集，无重叠数据库进程）` | 130 文件 / **934 通过** |
| `npx vitest run src/application/parameters src/components/ParameterImportWizard` | 38 文件 / **197 通过** |
| `npx vitest run --config vitest.server.config.ts server/modules/parameter-files/seedSources.fidelity.test.ts` | 1 文件 / **18 通过**（真实兼容源：locator、字面键、保字节补丁、清单摘要） |
| `npx vitest run --config vitest.scripts.config.ts scripts/seed-reconciliation-manifest.test.ts` | 1 文件 / **14 通过** |
| 厂商目录 YAML 导入（`vendorAdapter`、`vendorCoexistence.integration`） | **25 通过** |
| `npm run seed:reconcile:check` | 退出码 0（临时副本中可检出漂移） |
| `npm run contract:openapi` 后 OpenAPI 检查 | 退出码 0，产物为最新 |
| `npm run db:schema-doc` 后 `docs:check` | 退出码 0，产物最新，治理通过 |
| `tsx scripts/check-parameter-catalog-boundaries.ts --trusted-base-sha 8f03cfa4…` | **通过**：3513 项违规全部在白名单内，**0 项未列入、0 项失效** |
| `npx vitest run --config vitest.server.config.ts server/modules/catalog-publication server/modules/catalog-kernel`（**第 21 轮**） | 50 个文件 / **492 通过、1 失败**——唯一失败为既有的 `catalogRoles.integration.test.ts > application, agent, and verifier logins are not members of Catalog writer roles`，该用例在未改动的 `origin/main` 上同样失败 |
| `npx vitest run --config vitest.scripts.config.ts scripts/compile-vendor-catalog-release.test.ts scripts/install-catalog-release.test.ts`（**第 21 轮**） | 2 个文件 / **10 通过** |
| `npm run catalog:compile-vendor`（**第 21 轮**） | 输出 `digest=sha256:5f0e7bcd…`、`counts=48 subjects / 1 alias / 114 definitions`，前驱 `crel_acme_1` 不变 |
| `npm run docs:check` | 通过 |

浏览器验证（`playwright-cli` 真实浏览器；API 模式前端 `127.0.0.1:5173` 对接真实 API `127.0.0.1:8787`，lane 数据库本地账号）：

- 路由 `/parameter-admin` →“批量参数导入”向导步骤 1，同时走粘贴路径与真实 `.yaml` 文件上传。
- **观测到 YAML 拒绝**：步骤 2 显示“暂不支持 YAML 格式的参数文件导入，请改用 xlsx、csv、json、dts 或 dtsi 文件。”，粘贴 YAML 与上传 `params.yaml` 均如此。
- **正向对照**：上传 `config.json` 未出现不支持格式提示，即不存在过宽拒绝。
- 1440×900、768×1024、390×844 三尺寸：`document.documentElement.scrollWidth - clientWidth === 0`（无横向溢出）；已截取快照与截图。
- 控制台：29 条 error，**全部**为空 lane 数据库导致的 HTTP 401（该账号无项目／线程数据）。未见 JavaScript 异常与布局错误。
- 截图：`work/ui-checks/849/desktop-1440x900-yaml-refusal.png`、`tablet-768x1024-import-wizard.png`、`mobile-390x844-import-wizard.png`。

## 4. 未交付、跳过与失败

本轮未把任何未列入 §1 的内容报告为已交付。

**PU-01 尝试记录（本轮）。** 先写了 R3 威胁矩阵（`849-inventory/configurationschema-threat-matrix.md`，16 行）。随后实施了扩展：契约枚举与新的 `parseCanonicalConfigurationSchemaId` 解析器、内核编译器类型／规则／校验、运行时匹配器（第三个解析步骤，绝不消耗 NodeType 后备）、JSON Schema 三分支、能力版本升到 `catalog-capability/v3` 且仍准入 v1/v2、按字节锁定的 S0-ID 序列化 golden 及其 blob／长度／SHA pin、追加式迁移 `0146`，以及 DTO／API 联合类型。要达到一致状态，必须刻意更新**五个冻结的安全指纹**（S2-SCH schema 指纹、ACL 指纹、冻结的规范关系数 44 → 45、编译器契约 golden、能力契约摘要），并为新表与新谓词补角色清单授权与属主。这些门禁存在的意义正是防止 schema/ACL 变更被静默吸收，更新它们不是机械动作。与其让这些门禁保持失败、或在无独立评审的情况下把观测值写进安全 pin，**整套 PU-01 改动已被回退**；本次尝试交付的产物是威胁矩阵与已记录的改动面地图。应由带 Spec 评阅人的专门轮次落地。

**未开始（最大剩余风险）：**

1. **PU-01 ConfigurationSchema。** 侦察显示改动面并非局部：新迁移须修改 `0137` 中 5 处闭集 CHECK 约束与 6 个触发器函数、主体／选择器枚举与规范化、`schemas/dts/catalog-release/*`（含**按字节锁定的序列化 golden**）、编译器严格 schema 及其编译产物 golden、安装器、运行时匹配与快照、目录缓存与校验、发布能力版本（及准入清单）、API DTO 与生成的 OpenAPI、注册／位置守卫、发布校验计数门，以及前端呈现层与 `catalogRoleManifest.ts`。这是 R3 变更，实施前需要威胁矩阵；因此选择不尝试，而不是半途应用。
3. **受审真实源文件**：`charge_voltage_limit_mv`、`battery_temp_target_c`、`dts_fast_charge_profile_matrix`、`battery_thermal_derate_curve`，以及解析悬空 overlay 目标的完整自洽示例 DTS 基底。清单已记录去向，文件尚不存在。
4. **种子发布与三项目初始化。** acme 退役已完成，但仍未发布携带种子定义的发布，因此 canonical 绑定／值物化仍写入 0 条绑定，且未初始化任何项目。
5. **归档重建运行配置与 S2。** 未归档、未证明静默、未做中断续跑、未做整套恢复演练。侦察确认归档适配器、分类器、映射查询、检查点与自托管控制器真实可用，真正缺口是受审重建处置契约、四个切换操作缺少操作面、归档目标仅支持本地文件系统，以及 P11–P16 阶段仍声明不可用。
6. **跨域消费者切换**（Agent、日志、知识、调试、DTS 重载）与**完整浏览器操作矩阵**。向导检查不能替代 Issue 的操作矩阵。

**已交付内容中的缺口，如实列出：**

- 新版导入**预览**仍把未匹配行归类为 `added`（继承自 `createImportPreview`）。通过该路由已无法应用此类行（apply 拒绝未绑定行），但预览仍有误导性。彻底修复需要新增分类值，会牵动 DTO、汇总计数、`status.ts` 与前端。
- `GET` 新版绑定列表不内联展示待处理草稿；草稿托盘需调用新增草稿路由。
- **建草稿**路由仍返回旧形状响应（其中带真实草稿 ID 与新版 pin），以保持现有工作台可用；新版 `catalogBindingDraftDtoSchema` 尚未成为该单一路由的线上形状。新增的提交／审阅／撤回路由使用新版契约。
- `server/modules/parameters/service.test.ts` 在新增测试改变了该文件的目录边界白名单指纹后已回退到 `origin/main`；等价的拒绝覆盖位于 `importDtsParse.test.ts`。

**本轮追查到两个间歇性失败的根因，其中一个是本次改动自身测试中的真实缺陷：**

1. `rejects and withdraws without writing a value` 约每三次运行失败一次，报 `Binding has no concrete config-set source to draft against`。前一个测试中的"过期 pin"探针用无序 `limit 1` 复制了**任意**一条 `project_parameter_values` 行，而不是绑定自身的当前 tip，因此有时带上占位源 `canonical-binding-identity`。已改为 join `binding.current_value_id`；修复后连续四次运行全绿。
2. 整个 129 文件集合还会出现 `database "wiseeff_test_*" does not exist`、`terminating connection due to administrator command`、`Connection terminated unexpectedly`。`server/testing/testDatabase.ts` 会强制删除陈旧 worker 数据库（`drop database ... with (force)`，第 124／133／245 行），因此在两个触碰数据库的进程同时运行时，它们会互删对方的临时数据库。这是测试框架特性、由重叠运行触发，不是产品失败。在没有重叠进程时，合并集完全通过。

**失败：** 最终状态下无。合并受影响集通过 **130 文件 / 933 测试**。中间出现过两次失败并已修复，不作为通过的跳过项上报：路由单测最初断言了旧的直存行为；种子对账测试最初测量了错误的值计数。

**已上报但未修复（超出本轮授权）：**

- 计划中的“24 个悬空 overlay 目标”**无法复现**。两次独立测量每板得到 **29** 个不同的未解析 `&label` overlay 目标与 **37** 个缺失 `&name` 引用。清单记录 29 并写明差异，未编造 24。
- 两个 `gpio_int` 厂商输入仍阻塞生产导入器。清单记录了确切所需转换；本轮刻意未改动导入器。

## 5. 证据层级及其不能证明的内容

- **本地真实 PostgreSQL**（专用 lane 数据库）：是，覆盖草稿归属、路由边界、格式拒绝与种子清单。
- **真实浏览器**：是，覆盖三尺寸导入向导。
- **Hosted／CI**：未运行（未开 PR）。
- **目标主机与硬件**：未运行，未获授权。
- 不主张新版工作流、种子、归档重建或 ConfigurationSchema 已达产品就绪。Issue 保持 OPEN 与 `ready-for-agent`。

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | 已更新 | `docs/zh-CN/exec-plans/active/2026-09-14-parameter-unification-and-seed-parity.md` 状态、本报告、`849-inventory/README.md`、中英 TD-124 行 |
| 架构／领域 | 已更新 | `docs/zh-CN/design-docs/adr-0045-configuration-schema-subject-and-seed-rebuild.md` 与英文对应件、`docs/adr/README.md`、`CONTEXT.md`、中英领域模型、中英 API 过渡与切换归档文档、中英 `docs/PLANS.md` |
| 产品规格 | 复核，未主张变更 | 主体类型尚未实现，本轮不改产品规格文本 |
| 质量／测试 | 复核 | 已运行受影响套件与边界／契约／schema 文档门禁；Issue 的完整操作矩阵尚未覆盖 |
| 运维 | 复核，未变更 | 本轮未做归档重建操作面改动 |
| 安全／治理 | 复核 | 新增 `UNSUPPORTED_FORMAT` 错误码；新版草稿写入仍经可信敏感节点校验与审计写入 |
| 生成产物 | 已更新 | `docs/generated/openapi.json`、`docs/generated/db-schema.md`、`docs/generated/seed-reconciliation-report.md` |

## 文档更新门禁

计划状态、ADR-0045 对、TD-124 对与本报告对均已更新，并通过 `npm run docs:check` 与 `git diff --check`。生成产物已重建且为最新。本轮不主张目标执行、部署、Hosted CI，也不主张延期工作包已完成。

## 6. 后续 T0.3 补记：迁移 0148/0149 的回溯式 R3 修正

#853 T0.3 对已交付迁移进行后续审计，没有伪称评审发生在实现前。边界记录在[回溯式威胁矩阵](849-inventory/migrations-0148-0149-r3-threat-matrix.md)。修正候选把请求组织绑定到认证身份、在写运行日志和完成态重放前完成全部目标鉴权、跨进程和不同 seed digest 串行化同一固定组织范围、使 `completed` 成为终态，并在重建前校验本次精确 v2 归档对象、文件版本与 candidate 字节以及 64 MiB 聚合上限。真实 PostgreSQL 证据现为 plan 7 项、archive 10 项、materialization 7 项。捕获仍不等于处置；目标静默、恢复和任何删除仍属于 #853 T2.3/T3.3。
