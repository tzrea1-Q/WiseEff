# 面向拓扑与 Schema 的参数精细化管理实施计划

> **面向 Agent 执行者：**必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，按任务逐项执行。所有步骤使用 `- [ ]` 追踪。
>
> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-schema-management.md)
> 设计规格：[面向拓扑与 Schema 的参数精细化管理](../../superpowers/specs/2026-07-16-parameter-topology-schema-management-design.md)

**目标：**用源码 occurrence、有效 DTS 拓扑、版本化驱动/属性规格和稳定项目绑定，替换当前由完整路径派生的扁平参数身份；在一次维护窗口中迁移全部历史引用并原子切换。

**架构：**扩展现有 CST 解析器、结构表、配置集和基线门禁，不另造平行系统。迁移 `0048` 先增加语义模型；在同一特性分支完成 170 属性黄金样例、Schema、身份、API、前端与历史迁移；最后由维护命令填充新 ID、执行全量校验并归档旧身份表。生产发布必须确定性匹配，并强制通过 dt-schema、`dtc` 和 `fdtoverlay`。

**技术栈：**TypeScript 5.9、Node.js/tsx、PostgreSQL 16、Zod、React 19/Vite、Vitest、Playwright、dtc/fdtoverlay 1.8.1、dtschema 2026.6、自托管 Alpine runtime。

---

## 执行形态

解析、Schema、持久化、UI 和迁移共享同一套新 ID，且生产必须一次性切换，因此本计划采用一个分支和一份原子迁移计划。每个阶段都要独立测试、独立提交，但中间阶段不能部署到生产。

**分支：**`feat/parameter-topology-schema-management`。只有在 `32b66e4c`、`b16a2f9c` 或它们的合并等价提交进入最新 `main` 后，才能从 `main` 创建。

**禁止事项：**

- 不在生产长期双写。
- 不建立旧模型兼容投影视图。
- 不把完整路径、label 或模糊评分当稳定身份。
- 不把旧 `recommended_value` 自动升级成 Schema 默认值或策略目标。
- 不允许 `warn/off` 模式生成正式发布基线。

## 四阶段结果

| 阶段 | 可验收结果 | 生产行为 |
| --- | --- | --- |
| A. DTS 语义核心 | 多文件 include/base/overlay、来源链、类型化值、黄金样例 | 不切换 |
| B. Schema 与身份 | 版本化 Schema、确定性映射、稳定逻辑节点、项目绑定 | 不切换 |
| C. 产品工作流 | 语义 API、类型化编辑、发布门禁、新参数库与拓扑工作区 | 只存在于特性分支 |
| D. 原子切换 | 全量历史迁移、旧身份下线、runbook 和验收证据 | 维护窗口一次切换 |

## 核心文件边界

| 路径 | 职责 |
| --- | --- |
| `server/modules/dts/types.ts` | CST 与类型化 DTS 值合同 |
| `server/modules/dts/valueAst.ts` | 原始 RHS 到无损值 AST |
| `server/modules/dts/configSetResolver.ts` | include 图、base、overlay、有效树和来源链 |
| `server/modules/dts/identity.ts` | 确定性逻辑节点连续性 |
| `server/modules/parameter-specs/` | Schema 注册、匹配、推理审核、策略、业务分类 |
| `server/modules/parameter-topology/` | 配置版本、occurrence、逻辑节点、绑定和诊断 |
| `server/modules/parameter-files/dtsToolchain.ts` | 完整配置集编译与 Schema 校验 |
| `server/migrations/0048_parameter_topology_schema_shadow.sql` | 只增加新模型及新 FK 列 |
| `server/cutovers/2026-07-16-parameter-identity-cutover.sql` | 仅供维护窗口使用的 FK 切换和旧表归档 |
| `scripts/migrate-parameter-identities.ts` | dry-run/apply 历史迁移 |
| `src/domain/parameter-topology/` | 前端语义领域类型 |
| `src/components/parameter-topology/` | 参数规格库和项目拓扑工作区 |

具体 TypeScript、SQL、DTO 和测试代码块以英文主计划为准；本中文伴随计划锁定相同任务、命令、验收结果和提交边界。

---

### Task 1：锁定黄金样例并修正种子术语

**文件：**

- 修改 `scripts/dts-power-seed.ts`
- 修改 `server/modules/parameters/dtsPowerSeed.test.ts`
- 新建 `server/modules/dts/goldenPowerFixture.test.ts`
- 新建 `src/config/dts-seed/wiseeff-power-base.dts`
- 修改 `scripts/compile-dts-seed.ts`

- [ ] 先写失败测试：`gpio_int` 是参数名；`sc8562` 是驱动；`sc8562@6E` 是实例；完整路径只是 locator。
- [ ] 运行 `npm run test:server -- server/modules/parameters/dtsPowerSeed.test.ts --run`，确认当前点号路径导致失败。
- [ ] 种子模型增加 `driverModule`、`instanceName`、`nodeLocator`、`businessCategory`，不再用完整路径生成 `name`。
- [ ] 新增完整 synthetic base，定义 overlay 使用的全部外部 label；GPIO 节点提供正确 cell 声明。
- [ ] 将 synthetic base 纳入 seed manifest，并在 Task 8 的完整工具链门禁中编译应用后的 effective DTB。
- [ ] 断言 50 个节点、170 个属性、18 条 phandle、24 种重复键、两个不同驱动下的 `gpio_int`。
- [ ] 运行定向测试和 `npm run dtc:seed:compile`，预期全部 PASS。
- [ ] 提交：`test(dts): lock semantic power fixture`。

### Task 2：建立无损类型化 DTS 值 AST

**文件：**

- 修改 `server/modules/dts/types.ts`、`parser.ts`、`serialize.ts`
- 新建 `server/modules/dts/valueAst.ts` 和测试

- [ ] 为布尔、empty、string-list、`/bits/`、cell、phandle、mixed、负数和浮点字符串写表驱动失败测试。
- [ ] 运行 `npm run test:server -- server/modules/dts/valueAst.test.ts --run`，确认模块缺失。
- [ ] 实现 discriminated union，并在字符串、group、cell、phandle 上保存 raw span。
- [ ] 校验位宽溢出，同时保留十进制、十六进制和原始 token。
- [ ] 将 AST 挂到 `DtsPropertyCst`；未修改内容必须字节不变。
- [ ] 运行 `npm run test:server -- server/modules/dts --run`，预期 PASS。
- [ ] 提交：`feat(dts): add lossless typed value AST`。

### Task 3：按完整配置集解析 include、base 和 overlay

**文件：**

- 新建 `server/modules/dts/configSetResolver.ts`、测试及 `__fixtures__/config-set/`
- 修改 `server/modules/dts/types.ts`、`parser.ts`
- 修改 `server/modules/parameter-files/unsupported.ts`

- [ ] 先覆盖 include、base、overlay、删除、顺序、循环、路径逃逸、重复 label 和 unresolved target。
- [ ] 运行定向测试，确认 `resolveDtsConfigSet` 不存在。
- [ ] 定义 entry、include roots、overlay order、逻辑文件映射和结构化诊断合同。
- [ ] include 先于 overlay 解析；只允许 manifest 内的规范化 POSIX 路径。
- [ ] overlay 不覆盖 occurrence 原记录，有效属性保存 `set/override/delete` 来源链。
- [ ] 移除旧的 `/include/` 一刀切拒绝；缺失 include 变为 resolver 诊断。
- [ ] 运行 `npm run test:server -- server/modules/dts server/modules/parameter-files/parserSafety.integration.test.ts --run`。
- [ ] 提交：`feat(dts): resolve multi-file config sets`。

### Task 4：增加语义 shadow schema

**文件：**

- 新建 `server/migrations/0048_parameter_topology_schema_shadow.sql`
- 新建 `server/modules/parameter-topology/schemaMigration.test.ts`
- 更新 `docs/generated/db-schema.md`

- [ ] 写迁移失败测试，检查全部 specs、schema、occurrence、logical node、binding、mapping、review、validation 和 legacy evidence 表。
- [ ] 在最新数据库上运行，确认缺少 `parameter_specs`。
- [ ] 建立稳定 `parameter_specs` 和不可变 `parameter_spec_versions`，`example_value` 不参与 DB 校验或发布策略。
- [ ] 建立 driver/property subtype、组织策略目标和独立业务分类。
- [ ] 建立 config revision、源码 occurrence、逻辑节点版本和来源 effect。
- [ ] 建立项目绑定、绑定版本、映射任务、规格审核任务、校验结果、`audit_subject_links` 和迁移证据。
- [ ] 给 history、draft、CR、submission、file conflict、debugging 引用增加 nullable 新 FK；此阶段不删除旧列。
- [ ] 在 fresh DB 和已经到 `0047` 的 DB 上重复迁移，预期幂等 PASS。
- [ ] 提交：`feat(parameters): add semantic identity schema`。

### Task 5：持久化源码 occurrence 与有效拓扑

**文件：**

- 新建 `server/modules/parameter-topology/types.ts`、`repository.ts`、`ingestService.ts` 及测试
- 修改 `server/modules/parameter-files/service.ts`

- [ ] 写事务 ingest 失败测试：黄金配置产生 170 个属性 occurrence，`gpio_int` 有正确逻辑节点和值。
- [ ] 断言 include 失败不留下部分记录。
- [ ] 配置版本先进入 `resolving`，同一事务保存 manifest、occurrence、logical revision、effect 和诊断。
- [ ] 结束状态只能是 `resolved` 或 `invalid`，旧配置版本不可修改。
- [ ] 同时保存 offset 与一基行列。
- [ ] 只有完整 config set 冻结后才调用语义 ingest，禁止单文件伪造有效树。
- [ ] 运行 parameter-topology 和现有 structural integration 测试。
- [ ] 提交：`feat(parameters): persist effective DTS topology`。

### Task 6：建立版本化 Schema 注册中心和严格匹配

**文件：**

- 新建 `server/modules/parameter-specs/` 下 types、repository、loader、matcher 及测试
- 新建 `schemas/dts/vendor/wiseeff/*.yaml`
- 新建 `schemas/dts/catalog.json`

- [ ] 先写 Linux/Vendor/人工优先级、未知项和多候选测试。
- [ ] 注册中心记录 Linux Schema revision、dtschema 2026.6、Vendor 内容哈希。
- [ ] 只加载项目 `compatible` 可达的 Schema 及引用的公共 Schema。
- [ ] 唯一候选返回 matched；无候选创建推理草稿；多候选创建阻断任务。
- [ ] 为完整黄金配置维护 Vendor Schema，使 170 个属性全部绑定到审核规格。
- [ ] 单位和约束只在有证据时填写；示例值仅说明格式；不得虚构默认值和策略目标。
- [ ] 运行 matcher 和黄金覆盖测试，要求 170/170 且两个 `gpio_int` 属于不同规格。
- [ ] 提交：`feat(parameters): add schema registry and strict matcher`。

### Task 7：稳定逻辑身份与项目绑定

**文件：**

- 新建 `server/modules/dts/identity.ts` 及测试
- 新建 `server/modules/parameter-topology/bindingService.ts` 及测试

- [ ] 写节点移动后唯一匹配、两个等价候选、仅 locator 匹配三个测试。
- [ ] 身份证据只允许人工连续性映射、父逻辑 ID、driver schema、Schema 唯一键、`reg`、unit address 和拓扑关系。
- [ ] 禁止 fuzzy score、label 单独命中或路径单独命中。
- [ ] 歧义任务保存候选、证据、revision、审核者、原因和时间，并把 revision 置为 `needs_mapping`。
- [ ] 稳定 binding key 为 project + logical node + spec；实际值放在 binding revision。
- [ ] Schema 默认值、策略目标值、示例值、项目生效值分别存储，不保留“推荐值”业务字段。
- [ ] 运行 identity 和 binding 测试。
- [ ] 提交：`feat(parameters): bind stable logical identities`。

### Task 8：完整配置集工具链与失败关闭

**文件：**

- 新建 `server/modules/parameter-files/dtsToolchain.ts` 及测试
- 修改 `dtcValidator.ts`、`validationGate.ts`
- 修改/新增 toolchain 检查脚本
- 新建 `tools/dts-toolchain/versions.json`、`requirements.txt`
- 修改 `ops/self-hosted/Dockerfile`、CI、`package.json`

- [ ] 先写 base+overlay+dt-schema、缺工具、超时、路径逃逸、顺序错误和 warning policy 测试。
- [ ] 完整流水线必须执行 base `dtc -@`、overlay DTBO、`fdtoverlay` 顺序应用和 effective DTB `dt-validate`。
- [ ] 新建 `scripts/validate-dts-config-set.ts`，提供仓库级配置集验证命令。
- [ ] 返回结构化诊断、输入 hash、产物 hash 和全部工具版本。
- [ ] 发布模式缺任一工具即失败；`warn/off` 只允许本地诊断。
- [ ] 固定 dtc 1.8.1、commit `8f48565e5cfedc74d3f7512f1e0188e9d85dc1de` 和 dtschema 2026.6。
- [ ] 自托管镜像从固定 commit 构建 dtc/fdtoverlay，并安装 `dtschema==2026.6`。
- [ ] 增加 `dts:toolchain:check` 和 `dts:config:validate` 命令。
- [ ] 运行 toolchain、seed 和 self-hosted 检查。
- [ ] 提交：`feat(dts): validate complete config sets`。

### Task 9：语义 API、服务端权限和审计

**文件：**

- 新建 `server/modules/parameter-specs/{schemas,service,routes}.ts`
- 新建 `server/modules/parameter-topology/{schemas,service,routes}.ts` 及路由测试
- 修改 `server/app.ts` 和 contracts 注册

- [ ] 覆盖规格列表/详情、规格审核、source/effective topology、binding、mapping task、validation API。
- [ ] Viewer 可读项目拓扑；只有参数 Admin 可审核规格/映射或发布；跨组织 ID 返回 404。
- [ ] DTO 分开 property key、driver、logical node、instance、locator 和 effective value。
- [ ] 规格审核、映射、编辑、校验、基线、发布和迁移全部写审计，只保存 ID/证据 hash，不记录完整源码。
- [ ] 生成并检查 OpenAPI。
- [ ] 运行 parameter-specs、parameter-topology 和 contracts 测试。
- [ ] 提交：`feat(parameters): expose semantic topology APIs`。

### Task 10：类型化编辑、最小回写和审批流

**文件：**

- 修改 `server/modules/parameter-files/writebackService.ts`
- 修改 `server/modules/parameters/{service,repository,types}.ts`
- 新建 `server/modules/parameter-topology/editService.ts` 及测试
- 修改 structured edit integration

- [ ] 先写 overlay 写入、未改字节保持、过期 revision、共享 base 保护、delete、Schema 失败和 unresolved mapping 测试。
- [ ] 现有项目 occurrence 用 AST span patch；共享 base 上的项目差异生成/更新 overlay。
- [ ] 草稿对应候选 config revision，重新解析并真实编译后才允许提交。
- [ ] 新 draft、submission、CR、history 和 conflict 只写 spec/binding ID。
- [ ] 初始化建议只使用 `policyTarget ?? schemaDefault`；`exampleValue` 明确为非强制示例。
- [ ] 运行全部参数工作流和 writeback 测试。
- [ ] 提交：`feat(parameters): edit semantic bindings through review`。

### Task 11：前端语义合同与客户端

**文件：**

- 新建 `src/domain/parameter-topology/types.ts`
- 新建 `src/application/ports/ParameterTopologyRepository.ts`
- 新建 `src/infrastructure/http/parameterTopologyClient.ts` 及测试
- 新建 `src/application/parameters/parameterTopologyRuntime.ts`
- 修改旧 parameters 类型

- [ ] 先写 DTO 测试，断言 `gpio_int`、`sc8562`、`sc8562@6E` 和 locator 分离，且没有 `recommendedValue`。
- [ ] 定义 specs、bindings、source/effective tree、mapping 和 validate 的明确 port。
- [ ] HTTP 客户端保留结构化诊断和 `409 stale-revision`，不得全部转成普通字符串。
- [ ] 运行 domain/client 测试。
- [ ] 提交：`feat(parameters): add semantic frontend contracts`。

### Task 12：把参数库改造成规格治理页面

**文件：**

- 新建 `src/components/parameter-topology/ParameterSpecLibrary.tsx` 及测试
- 新建 `SpecReviewQueue.tsx`、`ParameterSpecDetail.tsx`
- 修改 `src/ParameterAdminPage.tsx` 和旧 library table

- [ ] 先断言属性键、驱动、compatible、类型、Schema 版本、示例值、业务分类、审核状态和使用量等字段。
- [ ] 参数名列不得显示完整路径；示例值不得标为推荐值或默认值。
- [ ] 支持按属性键、驱动、compatible、业务分类、Schema 来源和生命周期搜索。
- [ ] 详情分开展示默认、示例、策略目标、使用情况和 Schema 历史。
- [ ] 推理审核必须显式选 Schema 并填写原因，不提供“接受第一个候选”。
- [ ] API 模式替换旧扁平库；生产不能从 `state.parameters` 获取业务数据。
- [ ] 运行组件、a11y 和 build。
- [ ] 提交：`feat(parameters): manage versioned parameter specs`。

### Task 13：项目参数改造成 source/effective 拓扑工作区

**文件：**

- 新建 `ProjectTopologyWorkspace.tsx`、`TopologyTree.tsx`、`BindingPropertyTable.tsx`、`BindingDetailPanel.tsx` 及测试
- 修改 `src/ParametersPage.tsx`
- 切换时退役旧 `DtsNodeTreeView` 和 `DtsStructureBrowserPanel`

- [ ] 先断言真实树层级、`gpio_int` 属性和值。
- [ ] 覆盖 source/effective 切换、重复 `&amba`、unresolved target、两个 `gpio_int` 搜索结果、详情、编辑诊断和移动端 drawer。
- [ ] 桌面三栏共享稳定 selection ID，不从 path 推断选择。
- [ ] source 模式显示文件/行号和 occurrence effect；effective 模式显示合并节点和来源链。
- [ ] tablet 将详情收进 drawer；mobile 使用 tree → properties → detail 导航并显示面包屑。
- [ ] API 模式用 binding ID 驱动旧审批操作，不再展示扁平 `sourceNodePath`。
- [ ] 运行组件测试和 build。
- [ ] 提交：`feat(parameters): add topology-aware project workspace`。

### Task 14：确定性历史迁移与原子 cutover

**文件：**

- 新建 `server/modules/parameter-topology/migration.ts` 及测试
- 新建 `scripts/migrate-parameter-identities.ts`
- 新建 `scripts/check-parameter-identity-cutover.ts`
- 新建 `server/cutovers/2026-07-16-parameter-identity-cutover.sql`
- 修改 `package.json`

- [ ] 测试必须覆盖定义、项目值、history、draft、各状态 CR、decision、submission、file conflict、baseline、debug 引用和 audit。
- [ ] dry-run 报告旧/新计数、未映射、歧义和断裂历史链，所有阻断项必须为 0。
- [ ] ID 由 SHA-256 命名空间和语义组成确定性生成；spec ID 禁止含项目路径。
- [ ] 所有旧 ID、完整名、路径、current/recommended 值和行 hash 写入 legacy evidence。
- [ ] 旧 recommended 值不得自动变成默认/策略目标；示例值来自审核后的规格目录。
- [ ] audit payload 保持不可变，通过 `audit_subject_links` 关联新 ID。
- [ ] 默认命令只 dry-run；`--apply` 必须同时提供维护 token、快照 ID、停写确认且无阻断。
- [ ] maintenance-only SQL 在单事务中切换 FK、约束非空、归档旧表、删除 active workflow 旧身份列并写 cutover marker。
- [ ] 该 SQL 不放入自动 `db:migrate` 目录。
- [ ] 从同一快照恢复两次，ID 与 checksum 必须一致；故障注入不得留下部分 cutover。
- [ ] 提交：`feat(parameters): add atomic identity migration`。

### Task 15：切换全部剩余消费者并下线旧 API

**文件：**

- 修改 parameters routes/repository/dashboard
- 修改 Xiaoze perception、debugging 引用
- 修改前端 ParameterRepository、HTTP client、initialization、Excel export
- 替换后删除旧 flat DTO 和 fallback helper

- [ ] 写全仓守卫测试，生产代码禁止 `recommended_value`、把 `source_node_path` 当身份以及 `DTS_IDENTITY_FALLBACK_MODE`。
- [ ] dashboard、Agent、export、初始化和 debugging 全部查询 spec/binding。
- [ ] Excel 将 property key、driver、instance、locator、effective value、Schema version 分列。
- [ ] 删除 `(name,module)` fallback 和旧 flat list contract。
- [ ] 旧 ID 请求返回 `410 legacy-parameter-id-retired` 和 evidence lookup ID，不提供兼容投影。
- [ ] mock 可保留小型语义 fixture；生产/API 模式不得导入旧 mock 作为业务数据。
- [ ] 运行全部 server 参数消费者、全部前端测试和 build。
- [ ] 提交：`refactor(parameters): retire flat parameter identity`。

### Task 16：浏览器验收与三视口证据

**文件：**

- 新建 `e2e/acceptance/parameter-topology.acceptance.spec.ts`
- 修改旧 parameters acceptance
- 修改 acceptance coverage map 和 operation matrix

- [ ] 登记 `PARAM-SPEC-GOVERN-001`、`PARAM-TOPOLOGY-BROWSE-001`、`PARAM-TOPOLOGY-EDIT-001`、`PARAM-IDENTITY-MAP-001`、`PARAM-CONFIG-PUBLISH-GATE-001`。
- [ ] 覆盖规格检索/审核、source/effective、两个 `gpio_int`、类型化编辑、过期编辑、映射阻断、编译失败、审批发布、刷新持久化。
- [ ] 运行定向 acceptance，最终必须 PASS。
- [ ] 用 `playwright-cli` 在 1440×900、768×1024、390×844 分别 snapshot 和 screenshot。
- [ ] 实际操作树选择、模式切换、搜索、详情、编辑、校验、映射和发布。
- [ ] 检查 console error 和相关失败网络请求。
- [ ] 运行 coverage、operations、evidence、quality。
- [ ] 提交：`test(parameters): cover semantic topology workflows`。

截图固定路径：

```text
work/ui-checks/parameter-topology-desktop.png
work/ui-checks/parameter-topology-tablet.png
work/ui-checks/parameter-topology-mobile.png
```

### Task 17：cutover runbook、可观测性和全量文档

**文件：**

- 新建中英文 `docs/runbooks/parameter-identity-cutover.md`
- 更新 README、CONTRIBUTING、ARCHITECTURE
- 更新 domain model、API contract、FRONTEND、SECURITY、RELIABILITY 及中文伴随文档
- 更新本地开发、环境变量、验证矩阵及中文伴随文档
- 更新产品规格、PLANS、tech debt、可观测配置

- [x] runbook 写明停写、DB/对象快照、工具健康、dry-run、积压检查、compile-all、apply、postflight、应用切换、观察窗口和整体恢复命令。
- [x] runbook 明确：apply 失败后禁止部分继续。
- [x] 增加解析/Schema/编译耗时与失败、映射积压、规格审核积压、工具版本、发布和迁移状态指标。
- [x] 工具不可用、映射长期积压和生产绕过门禁必须告警。
- [x] 文档统一使用 spec/binding、source/effective、example/default/policy/effective 等新术语。
- [x] 真正完成后归档或标记旧 DTS active plan 被本计划取代。
- [x] 运行 `npm run docs:check && npm run observability:check && npm run selfhost:check && git diff --check`。
- [x] 提交：`docs(parameters): add semantic cutover operations`。

### Task 18：完整验证和迁移演练门禁

- [x] 运行 `npm run contract:check`、`npm run test:all`、`npm run build`、`npm run docs:check`（详见 task-18-report；满载下偶发超时，隔离复跑通过）。
- [x] 运行 `npm run dts:toolchain:check`、`npm run dtc:seed:compile`。
- [x] 连续运行两次 `npm run db:seed:m1`，验证幂等。
- [x] 迁移演练：本地 dirty DB dry-run 非生产快照；受控证据为 `migration.test.ts` mid-fail + success（见 `work/cutover-rehearsal/20260715-2035/`）。
- [ ] 恢复维护快照并证明旧版本仍能启动（需真实维护快照；本机以测试注入失败回滚代替）。
- [ ] 从同一初始快照重复演练，对比确定性 ID 和 checksum（同上，受控测试覆盖确定性，非生产快照）。
- [x] 运行 topology acceptance、coverage、operations、a11y、responsive、visual(darwin)；evidence 本机仍缺完整 P0/P1 产物。
- [x] 最终 diff 确认语义路径无业务 `recommendedValue`；legacy guard 通过。
- [x] 提交：`test(parameters): prove semantic identity cutover`。

---

## 文档影响矩阵

| 范围 | 精确路径 | 动作 |
| --- | --- | --- |
| 仓库地图 | `AGENTS.md`、`ARCHITECTURE.md` 及中文伴随 | 更新架构入口；AGENTS 工作流不变 |
| 计划 | 本计划、`docs/PLANS.md`、`docs/zh-CN/PLANS.md`、tech debt | 更新 |
| 产品事实 | `docs/product-specs/prototype-functional-spec.md` | 更新参数流程和术语 |
| 领域/API | domain-model、api-contract 及中文伴随 | 更新实体、状态机和 v2 路由 |
| 前端 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 更新 source/effective 与 port |
| 安全 | SECURITY 中英文 | 更新不可信编译、审计和迁移 |
| 可靠性/runbook | RELIABILITY、parameter identity cutover 中英文 | 更新 |
| 开发环境 | local-development、environment-variables、verification-matrix 中英文 | 更新工具链和门禁 |
| 质量/验收 | coverage map、operation matrix、acceptance spec | 更新 |
| 生成物 | DB schema、OpenAPI、acceptance evidence | 重新生成/更新 |
| 引用 | productization API contract draft | 检查并移除扁平身份描述 |
| README/CONTRIBUTING | 根文档 | 更新 DTS 前置依赖和命令 |

## 文档更新门禁

- [ ] 所有 Update 项均更新；有人类阅读的页面同步维护中英文。
- [ ] `npm run docs:check` 通过。
- [ ] OpenAPI 和数据库 Schema 生成物与实现一致。
- [ ] 新 acceptance/operation ID 都有生成证据。
- [ ] 延后事项写入 tech debt，包含负责人和验收条件。
- [ ] 只有在非客户目标迁移演练和全部证据通过后，计划才能移入 completed。

## 设计覆盖自检

| 设计要求 | Tasks |
| --- | --- |
| 完整 config set、include/base/overlay | 1、3、5、8 |
| 源码 occurrence 与有效拓扑 | 2–5 |
| 版本化驱动/属性规格 | 4、6 |
| 确定性身份与人工队列 | 7、9 |
| 示例/默认/策略/生效值拆分 | 4、6、7、10、14、15 |
| 参数规格库与项目拓扑 UI | 11–13 |
| 类型化编辑、最小回写、审批 | 2、10 |
| dtc/fdtoverlay/dt-schema 失败关闭 | 8–10 |
| 全量历史迁移与证据 | 14、15 |
| 维护窗口和整体回滚 | 14、17、18 |
| 170 属性黄金验收 | 1、6、18 |
| JSON/人工参数只迁统一身份 | 4、14、15 |
| 三视口和浏览器证据 | 12、13、16、18 |

终态门禁不是“单元测试通过”，而是：非客户环境维护演练成功、整体快照回滚成功、真实工具链通过、真实 API 浏览器验收通过。
