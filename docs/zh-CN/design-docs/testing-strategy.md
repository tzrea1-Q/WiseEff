# WiseEff 测试策略与设计

> English: [English](../../design-docs/testing-strategy.md)

核对日期：2026-09-06。源码基线：`67d4a77325b6009b77c2373bd788298a6d022bcf`。
本页是已实现产品的测试设计入口，与[技术文档](full-stack-architecture.md)配套。下列设计用例在**本次文档任务中均未执行**。链接到测试文件只说明核查了相关自动化源码，不代表完整覆盖或执行通过。

## 内容归属与追踪

| 问题 | 唯一负责位置 |
| --- | --- |
| 应当满足什么行为？ | [产品规格](../product-specs/index.md)、[领域模型](domain-model.md)、[API 契约](api-contract.md)、[安全规则](../SECURITY.md) |
| 应测试哪些风险、场景和断言？ | 本页 |
| 使用什么命令、依赖和门禁？ | [验证矩阵](../developer/verification-matrix.md) |
| 已有哪些需求和操作 ID？ | [需求覆盖映射](../developer/browser-acceptance-coverage-map.md)、[操作覆盖矩阵](../developer/user-operation-coverage-matrix.md) |
| 覆盖如何生成？ | [operationMatrix.ts](../../../e2e/acceptance/operationMatrix.ts)、其引用的验收测试及覆盖脚本 |
| 人如何执行常规验收流程？ | [人工验收手册](../runbooks/manual-acceptance.md) |
| 证据记录在哪里？ | 验证矩阵定义的逐次运行产物；历史质量看板不是新证据 |

下文 `TDES-*` 仅标识文档设计场景，不新增验收操作 ID，也不改变 `automated/manual/conditional/future` 覆盖状态。补自动化时先对应既有需求和操作；需要新增操作时修改权威源码并运行生成器，不手改生成的操作矩阵。

## 范围、风险与分层

覆盖参数工作台、评审、目录、文件，日志上传、分析、管理，节点调试、DTS 重载、设备桥，身份和组织治理、小泽、知识库、反馈、通知、审计、应用壳与运维。未来退役、数据切换里程碑及目标发布签署仍是有条件的流程，不能由源码存在推导。

| 优先级 | 风险与对应设计 | 最低有效证据 |
| --- | --- | --- |
| P0 | 跨组织或角色越权、不安全或重复写入、过期合入、未经授权的 Agent/设备动作、数据丢失：AUTH、PARAM、CAT、DBG、AGENT、OPS | 负向与正向对照；涉及事务时检查 API/领域状态及真实 PostgreSQL；核对审计和外部副作用 |
| P1 | 核心流程中断、误导性分析、内容或通知缺失：FILE、LOG、KB、FEEDBACK、NOTIF | 成功、失败及恢复流程；持久结果与用户可见状态 |
| P2 | 较低风险的呈现与入口发现 | 组件与浏览器质量检查；隐藏权限问题或阻断核心操作时提高优先级 |

已有操作的优先级仍以操作矩阵为准。本页优先级用于选择验证深度，不构成发布豁免。

| 层级 | 目的 | 现有工具 |
| --- | --- | --- |
| 领域与策略 | 类型、规范化、状态转移、权限 | Vitest |
| 组件与运行时 | 加载、错误、空态、项目切换、端口一致性 | Testing Library / Vitest |
| API 与数据库 | HTTP 契约、角色范围、锁、幂等、保留策略 | 服务端 Vitest 与真实 PostgreSQL |
| 契约与状态模型 | DTO/OpenAPI 漂移、状态不变量 | 契约脚本、fast-check |
| worker 与模型行为 | 租约、重试、降级、预算、引用真实性 | worker 测试、确定性日志评测 |
| 浏览器 | 真实角色流程、API/UI 联动、持久结果 | Playwright 验收 |
| 质量 | 无障碍、视觉一致性、响应式可用性 | 既有无障碍、视觉与响应式门禁 |
| 设备与目标运维 | 物理效果、恢复、升级、容量、OIDC/模型质量 | 模拟器验证本地流程；目标或实验室证据单独记录 |

## 环境与测试数据

精确准备步骤见[本地开发](../developer/local-development.md)和验证矩阵，本页不复制第二份环境变量清单。

1. 执行前记录源码 SHA、工作区是否干净、命令与筛选条件、运行模式、数据库身份、迁移状态、浏览器尺寸及确定性或在线配置。
2. 使用隔离的 API 测试运行时、明确归属的 PostgreSQL 数据库与对象前缀。目录数据库证据须具备 pgvector，并遵循[目录专用环境规则](../agents/catalog-launch-operating-rules.md)中的实际角色要求，不能使用共享应用库。前置条件缺失记为阻塞或明确跳过，不能算通过。
3. 准备两个组织，同一组织内两个项目、另一组织一个项目。按场景分别使用编辑者、硬件评审者、软件评审者、合入者、组织管理员、平台评审者、只读及停用身份。有效权限来自数据库绑定，不能用一个管理员会话替代角色链。
4. 数据使用逐次运行的唯一前缀。变更前记录项目、候选、定义、发布版本、审批 ID、基线及预期行数。复用所链接测试中的数据构造器，核对唯一身份，不选“第一条”碰运气。
5. 日志复用 `test-fixtures/logs/charging-foldback.log` 和 `unsupported.bin`；DTS、目录、知识库、设备桥复用对应测试的数据。数值边界以选定数据的范围和类型定义为准，不能假设任意数值对真机安全。
6. 确定性模型和模拟器不产生在线模型或硬件就绪结论。真实设备写入、目标恢复和升级演练须满足对应手册前置条件，并使用已授权的隔离实验室或非客户目标。
7. 每个用例通过测试清理器或领域操作撤销自身变更；测试组结束后由运行时所有者清理自身临时资源。失败时先保留证据和资源身份，不能只凭数据库名像临时库就删除。

## 本设计的覆盖地图

中列 ID 是既有示例，不是完整等价关系。具体断言和运行条件以链接源码及生成矩阵为准。

| 能力与设计 | 既有操作或源码契约 | 相关自动化入口 |
| --- | --- | --- |
| 参数编辑与评审；TDES-PARAM-01/02 | `PARAM-HAPPY-001`、`PARAM-ASSIGNEE-001`；语义工作流集成 | [参数](../../../e2e/acceptance/parameters.acceptance.spec.ts)、[负向](../../../e2e/acceptance/parameters-negative.acceptance.spec.ts)、[拓扑](../../../e2e/acceptance/parameter-topology.acceptance.spec.ts)、[PostgreSQL 工作流](../../../server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts) |
| 文件、导入、配置；TDES-FILE-01 | `PARAM-ADMIN-002`、`PROJ-CONFIG-REVISION-GATE-001` | [导入向导](../../../e2e/acceptance/parameter-import-wizard.acceptance.spec.ts)、[参数文件](../../../e2e/acceptance/parameter-files.acceptance.spec.ts)、[版本门禁](../../../e2e/acceptance/config-set-revision-gate.acceptance.spec.ts) |
| 目录；TDES-CAT-01/02/03 | 生产组合、根 HTTP 使用范围及 SQL 预算契约 | [组合](../../../server/modules/parameter-catalog-api/productionComposition.integration.test.ts)、[范围](../../../server/modules/parameter-catalog-api/rootUsageScope.integration.test.ts)、[批量查询](../../../server/modules/parameter-catalog-api/rootBatchQueries.integration.test.ts)、[目录浏览器](../../../e2e/acceptance/parameter-catalog.acceptance.spec.ts)、[负向浏览器](../../../e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts) |
| 日志；TDES-LOG-01/02/03 | 人工流程 D、worker 与评测契约 | [日志验收](../../../e2e/acceptance/log-analysis.acceptance.spec.ts)、[worker](../../../server/modules/logs/worker.test.ts)、[评测](../../../server/modules/logs/eval/)、[黄金语料](../../../eval-cases/logs/README.md) |
| 调试与重载；TDES-DBG-01/02 | `DEBUG-SIM-001`、`DTS-RELOAD-DEPLOY-001`、`DTS-RELOAD-DEPLOY-HW-001` | [模拟器](../../../e2e/acceptance/debugging-simulator.acceptance.spec.ts)、[重载](../../../e2e/acceptance/dts-reload-deploy.acceptance.spec.ts)、[ADB 设计](2026-06-21-adb-real-device-full-chain-test-design.md) |
| 身份与保留；TDES-AUTH-01/02 | `AUTH-RUNTIME-001`、`PERM-USER-MGMT-001` | [认证](../../../e2e/acceptance/auth-runtime.acceptance.spec.ts)、[权限矩阵](../../../e2e/acceptance/permissions-matrix.acceptance.spec.ts)、[删除](../../../server/modules/users/deletion.integration.test.ts) |
| 小泽；TDES-AGENT-01/02 | 工具审批与检查点契约 | [动作](../../../e2e/acceptance/xiaoze-action.acceptance.spec.ts)、[编排](../../../server/modules/agent/orchestrator.test.ts)、[检查点](../../../server/modules/agent/xiaoze/durableCheckpointer.integration.test.ts) |
| 知识库；TDES-KB-01 | `KB-READ-001`、`KB-EDIT-001`、`KB-INDEX-001` | [知识库浏览器](../../../e2e/acceptance/knowledge.acceptance.spec.ts)、[知识服务](../../../server/modules/knowledge/service.test.ts) |
| 反馈与通知；TDES-FEEDBACK-01、TDES-NOTIF-01 | `PFB-SUBMIT-001`、`PFB-ADMIN-001`、`PFB-AUTHZ-001`、`NOTIF-INBOX-001`、`NOTIF-READ-001` | [反馈](../../../e2e/acceptance/product-feedback.acceptance.spec.ts)、[通知](../../../e2e/acceptance/notifications.acceptance.spec.ts) |
| 应用壳与质量；TDES-UI-01 | `SHELL-DIAG-001`；质量门禁 | [应用壳](../../../e2e/acceptance/shell-navigation.acceptance.spec.ts)、[UI 检查清单](../developer/ui-quality-checklist.md) |
| 运维；TDES-OPS-01 | 恢复与就绪契约、有条件的目标演练 | [升级回归](../../../ops/self-hosted/scripts/upgrade.sh.test.ts)、[人工验收](../runbooks/manual-acceptance.md)、[验证矩阵](../developer/verification-matrix.md) |

## 可执行核心与风险用例

每个用例按预期逐项记录实际结果，以及适用的 API 状态与错误码、数据库谓词与行数、审计关联和产物。所有用例共同遵循前述环境、清理及证据规则。浏览器按当前数据和测试源码中的路由、标签执行；服务故障注入仅在隔离测试框架内进行，不针对共享服务。

### TDES-PARAM-01 — 类型化变更与真实角色评审（P0）

- **准备：** 专属项目、可编辑绑定、已知基线与候选版本，以及分别指定的评审人。
- **步骤：** 使用当前工作台执行人工流程 B；保存值和原因、选择合法负责人、提交；分别以硬件评审、软件评审和合入身份操作，刷新项目并检查历史。
- **预期：** 每次转移检查真实角色；提交保留精确草稿、绑定、候选和动作身份；候选合入值及审计持久化，原基线不可变。涉及文件写回时检查文件结果和重新解析后的值。
- **清理：** 使用验收数据清理器移除所属请求、候选和项目，不改写共享历史。

### TDES-PARAM-02 — 过期候选与项目隔离（P0）

- **准备：** 两个项目、会话 A 中可编辑候选及其初始状态和版本。
- **步骤：** 加载 A 并延迟响应，切换到 B 后释放 A 的响应；另开会话修改候选，再用旧视图提交或合入；强制发送候选身份被替换的请求。
- **预期：** B 不接收 A 的草稿、值和负责人；过期或变化的身份按端点冲突契约拒绝，不静默选择替代候选，不发生部分合入或写回。
- **清理：** 释放延迟请求，使用数据清理器移除所属草稿和候选。

### TDES-FILE-01 — 导入校验与版本冲突（P1）

- **准备：** 专属配置集、已知源版本、有效 DTS/JSON 文件及格式错误或非法值变体。
- **步骤：** 分别预览，检查错误和映射；取消后核对未发生业务应用；在所属测试环境应用有效文件，改变源版本，再尝试激活或写回旧候选。
- **预期：** 预览不修改当前项目值或文件，但可保留预览记录；无效数据不能应用，有效路径保留预期语法与值形状；过期激活或写回受阻并保留输入供复核。
- **清理：** 通过文件测试清理所属预览、导入记录、文件版本和配置集。向导浏览器测试覆盖预览，不能单独证明全部应用与冲突断言。

### TDES-CAT-01 — 发布版本、授权范围与真实空态（P0）

- **准备：** 已安装版本的目录集成数据、同组织项目受限用户、组织范围读者及第二组织，记录发布 ID 与摘要。
- **步骤：** 在当前及固定版本读取列表、详情、历史；刷新深链接并前进后退；请求另一项目使用量，刷新数据库角色后重试；分别制造未注册、无定义、筛选无结果和投影不可用。
- **预期：** 身份与发布摘要始终匹配；范围来自当前数据库授权。明确空范围为真实零值，不可用数据为错误或未就绪，不能伪装零使用量；不泄漏跨组织事实。
- **清理：** 使用目录测试的专属运行时和数据库清理。

### TDES-CAT-02 — 提案冲突、重试与独立评审（P0）

- **准备：** 组织提案者、另一位有权限的平台评审者、捕获的基线和 ETag、唯一幂等键；使用提案集成及浏览器数据。
- **步骤：** 创建草稿、提交、评审；重复同一请求，再用相同键改变内容；尝试自审、过期 ETag 或基线及跨组织访问；按测试注入提交后的响应阶段失败并重试；刷新冲突输入后明确重新确认。
- **预期：** 相同请求返回原提交结果，不重复写入；指纹变化产生冲突。拒绝过期、越权及自审；接受只记录发布意图，不直接修改目录定义；界面保留冲突输入并要求重新确认。
- **清理：** 只清理所属提案和治理数据。具体入口见[提案工作流](../../../server/modules/parameter-governance/proposals/workflow.integration.test.ts)和[治理浏览器](../../../e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts)。

### TDES-CAT-03 — 分页与投影失败预算（P1）

- **准备：** 根 HTTP 批量查询数据、其声明的规模及 SQL 计数器，固定目录发布版本。
- **步骤：** 执行非空与空页、分页前注册过滤、非法页大小，并注入使用量和注册投影失败。
- **预期：** 严格使用测试声明的语句预算；业务查询不随行数逐条增长，不混入跨组织投影，不在失败后静默回退。查询次数与延迟分开记录。
- **清理：** 停止测试服务并关闭、清理所属数据库。本地查询预算检查不等于目标容量通过。

### TDES-LOG-01 — 上传、证据与归档（P1）

- **准备：** 专属日志域、支持及不支持的文件，API worker 正常运行。
- **步骤：** 执行人工流程 D：上传、询问充电降流原因、观察阶段、打开引用行、反馈、归档并刷新；再上传不支持的文件。
- **预期：** 有效输入形成可追踪真实行的报告，来源与降级标签准确；不支持的输入明确失败。归档改变默认列表，并保留授权历史访问。
- **清理：** 用日志清理器清理所属记录、任务、反馈和对象键。

### TDES-LOG-02 — 引用真实性、工具合法性与降级（P1）

- **准备：** 行为评测的脚本模型，分别覆盖 `loop` 与 `single-shot`。
- **步骤：** 制造供应方不可用、畸形输出、不存在的引用行、非法工具或参数、证据不足及步骤或 token 预算耗尽。
- **预期：** 不虚构引用，不执行写工具；重试有界，回退显示原因与来源，按契约限制提前收敛的置信度；测试框架负向对照能识别已知错误行为。
- **清理：** 重置模型注入和配置，清理所属评测产物。`logs:eval` 是行为证据，质量评测须另用标注语料及其基线规则。

### TDES-LOG-03 — 任务重投与过期租约（P0）

- **准备：** 隔离任务及 worker 数据，明确租约和终态谓词。
- **步骤：** 重复投递相同任务，制造处理失败与重试，令租约到期后重新认领，再让旧 worker 尝试更新进度或完成。
- **预期：** 数据库认领和租约规则控制写入，旧 worker 不能覆盖当前结果；终态、重试及死信证据符合 worker 契约，分发成功不能算处理成功。
- **清理：** 先停测试 worker，再清理所属任务与对象；持久 Redis 行为需要独立队列门禁。

### TDES-DBG-01 — 安全写入、不同观测值与回滚（P0）

- **准备：** 模拟器数据，记录可写值、只读节点及不同回读值探针。
- **步骤：** 执行人工流程 E；读取 `3000`、写入 `3100`、检查快照和观测；探针写 `2` 后观测 `1`；从 UI 与强制 API 尝试只读或无权限写入，再通过支持的入口恢复初始快照。
- **预期：** 观测值不同不改变命令执行成功；拒绝路径不产生设备副作用；快照、操作、审计可追踪，恢复后回到基线。回滚仅能经 API 验证时如实记录，不声称 UI 已覆盖。
- **清理：** 恢复所属模拟器状态并清理测试记录。示例数值只适用于模拟器，不适用于任意真机。

### TDES-DBG-02 — 重载预检与真实设备证据边界（P0）

- **准备：** 专属重载数据、固定 DTS 工具链、假桥及基线摘要；真机变体另需实验室就绪。
- **步骤：** 分别令编译、能力、确认或权限前置条件失败，核对未部署；再部署有效数据，检查快照、内核证据和观测状态，执行残留与基线恢复流程。
- **预期：** 预检失败不能写设备；缺少行为证明保持不可验证；部署不修改参数库；恢复失败保留准确残留与结果。敏感和 Agent 路径遵循当前可信策略。
- **清理：** 完成所属恢复后再拆除测试环境，保留失败设备与运行证据；假桥、真实 HDC 与 ADB 分别记录。

### TDES-AUTH-01 — 组织、激活与角色约束（P0）

- **准备：** 两个组织、项目角色和停用账号；本地认证数据，或明确选择 OIDC 目标变体。
- **步骤：** 打开允许和禁止路由，直接调用禁止的 API，替换为其他组织资源 ID；停用用户或修改数据库角色后重试。OIDC 使用身份门禁覆盖错误签发者、受众、过期和签名。
- **预期：** 服务端拒绝且不泄漏范围内数据；后续请求反映数据库角色和激活状态；令牌声明本身不授予管理权。记录各端点约定的 401、403 或资源隐藏行为。
- **清理：** 只恢复测试角色和激活状态，本地 HMAC 或开发身份不能证明部署的 OIDC。

### TDES-AUTH-02 — 账号删除与历史保留（P0）

- **准备：** 真实 PostgreSQL 删除数据，包含账号所属状态、保留历史及非自身目标；记录行数与可空引用。
- **步骤：** 拒绝非管理员、自删和无权删除平台管理员的操作；管理员删除合法目标，检查响应与界面，并查询全部外键类别。
- **预期：** 成功 API 返回 `204`；账号所属行级联删除，历史保留并清空身份引用；可信溯源契约要求的 Agent 关联保留；删除审计不包含多余个人信息。失败尝试不改状态。
- **清理：** 拆除所属数据库，不以重建真实已删除账号作为测试清理。

### TDES-AGENT-01 — 审批必需且执行前重验（P0）

- **准备：** 确定性小泽数据，包含读工具、需审批的变更和持久化前状态。
- **步骤：** 执行授权范围内读取；请求变更并拒绝，检查业务未变；创建新审批，在批准前改变范围、参数或用户权限，再经真实端点批准或重放。
- **预期：** 审批前不写业务；拒绝、过期或越权审批不能写；修改参数需重验，重放不能重复副作用；审计保留 Agent 溯源和关联，不改标成人类。
- **清理：** 结束或取消所属待审批记录，清理测试会话及业务数据，不产生在线模型结论。

### TDES-AGENT-02 — 持久中断与隔离恢复（P0）

- **准备：** 专用 PostgreSQL 检查点数据库，唯一组织、用户和会话身份。
- **步骤：** 执行链接的持久检查点集成用例：中断规划 Agent，建立新的存储及 Agent 实例，在同命名空间恢复；另用不同用户、组织或撤销后的权限测试端点鉴权。
- **预期：** 已提交中断可跨实例读取；恢复仍服从端点当前授权。该检查点测试使用假的审批解析器，只证明持久化与恢复机制，必须结合 TDES-AGENT-01 才能讨论完整生产审批链。
- **清理：** 关闭存储连接池，只清理所属检查点数据库；缺少数据库配置记为跳过或阻塞。

### TDES-KB-01 — 发布、范围与检索降级（P1）

- **准备：** 专属草稿、已发布、已归档条目及第二组织；索引数据和嵌入不可用变体。
- **步骤：** 创建、修订、发布，搜索并打开引用，归档后重试；尝试跨组织访问，使用现有框架验证纯文本回退和索引重试。
- **预期：** 检索仅暴露授权的已发布版本及有效引用；草稿和归档内容不经搜索泄漏；回退明确，不制造语义结果。
- **清理：** 使用知识库数据清理器处理所属版本、分块、链接和对象键。

### TDES-FEEDBACK-01 — 提交与管理员处理（P1）

- **准备：** 普通成员及管理员会话、唯一反馈标记和允许的图片。
- **步骤：** 从侧边栏提交带附件反馈、刷新，以管理员处理并关闭，再用普通成员强制调用管理 API。
- **预期：** 内容及附件关联持久化，状态变化可追踪，非管理员在 UI/API 均不能处理反馈。
- **清理：** 只清理测试所属反馈、备注和附件对象。

### TDES-NOTIF-01 — 收件箱范围与已读持久化（P1）

- **准备：** 两名用户的专属通知及初始未读数。
- **步骤：** 打开面板、进入允许的深链接、标记已读或全部已读并刷新，尝试经 API 访问另一用户通知。
- **预期：** 仅暴露授权收件箱，未读数和已读状态持久化，目标页面重新执行自身授权。链接的浏览器测试只是起点，缺少的跨用户断言需在服务/API 层确认。
- **清理：** 删除所属通知数据，不恢复或修改无关用户已读状态。

### TDES-UI-01 — 核心导航与各状态可用性（P1）

- **准备：** API 角色，以及受影响页面的加载、错误、空态和有数据状态。
- **步骤：** 在 `1440x900`、`768x1024`、`390x844` 下导航、刷新与深链接、搜索筛选、开关弹窗、键盘聚焦、提交及错误恢复；收集快照和截图，检查控制台与网络。
- **预期：** 无意外横向溢出、操作遮挡、文字不可读或输入丢失；加载、禁止访问、错误及空态可以区分，仅允许预期负向 API 响应。
- **清理：** 重置测试拦截和浏览器会话。详细标准复用 UI 清单及质量门禁。

### TDES-OPS-01 — 就绪、恢复与发布证据（P0）

- **准备：** 选择本地故障注入框架，或已授权的隔离目标演练；记录源码及部署版本、恢复点与资源归属。
- **步骤：** 注入必要依赖故障，对比存活与就绪结果，再恢复依赖；升级、备份、恢复、回滚按既有手册在选定环境执行，核对数据库与对象一致性。
- **预期：** 存活不能掩盖依赖和就绪失败；失败升级或恢复不标成功；候选或恢复状态满足手册不变量；目标容量使用声明的工作负载、指标及现有阈值。
- **清理：** 遵循阶段恢复及资源归属规则。本地脚本不能关闭目标 OIDC、Redis、存储、硬件、模型或发布门禁。

## 边界与非功能覆盖

值、文件和 API 变化按合法、空、畸形、缺失、重复、超大输入划分，范围和形状边界取自权威 schema。列表覆盖零、一、多页、分页前筛选、不透明 ID、过期游标或版本及跨范围数据。写入覆盖重复请求、幂等指纹变化、并发状态变化及提交前后失败。

容量标准来自[可靠性目标](../RELIABILITY.md)和目标容量门禁，记录数据规模、并发、持续时间、延迟分位数与错误；不能把本地计时说成已测 SLA。无障碍、视觉和响应式补充业务断言；设备超时、离线、不支持观测及模型预算失败都须保留可处理的结果。

## 执行选择与结果判定

精确命令以验证矩阵为准。实现阶段按上表选择聚焦测试，到对应集成阶段再扩大验证。纯文档修改执行 `npm run docs:check` 和 `git diff --check`。本次文档交付不跑产品测试、不修改测试数据、不生成验收证据。

接受一轮测试结果前：

- 必须收集并执行要求的用例；必需测试被跳过或收集为零，会阻断对应通过声明。
- 分别报告通过、失败、跳过、阻塞和未运行，说明选定测试实际覆盖了哪些设计断言。
- 保存 SHA、运行身份、命令、角色、路由、环境、断言、预期与实际、脱敏 API/数据库/审计摘要和产物路径。
- 聚焦与全量运行分开，部分证据不能覆盖 `latest-full.json`；全量本地验收及资源、产物安全由 Gate0 管理。
- 缺陷记录包含复现、预期与实际、设计及操作 ID、严重程度、环境和证据；修复后复验受影响检查，不把历史通过改称新证据。
- 自动化存在但无新结果，本次仍记为未运行。硬件、在线模型质量、专家日志标注、目标 OIDC、恢复、容量及未自动化断言均明确列为验证依赖，不能据此断言缺少实现。

## 专项与历史参考

样式契约通过 [cssAssertions.ts](../../../src/test/cssAssertions.ts) 结构化查询，不匹配 CSS 文本格式；渲染行为由组件和浏览器门禁负责。

日志评测分确定性行为层（`npm run logs:eval`）和质量层（`npm run logs:eval:quality`）；后者基线仅统计符合条件的 `realLog: true` 标注样本，合成样本展示格式和框架行为。提示词或模型变更遵循[语料规则](../../../eval-cases/logs/README.md)。

账号删除必须保留[账号删除计划](../exec-plans/active/2026-08-28-user-account-deletion.md)定义的可信溯源；迁移约束及禁止身份重建的精确谓词由 PostgreSQL 测试负责。

下列拓扑轮次保留历史测试理由和数据计数，不代表当前发布状态，也不是切换共享数据库的指令。实现背景见已完成的[第四轮](../exec-plans/completed/2026-07-16-parameter-topology-round4-review-blockers.md)、[第五轮](../exec-plans/completed/2026-07-16-parameter-topology-round5-review-blockers.md)和[第六轮](../exec-plans/completed/2026-07-16-parameter-topology-round6-review-blockers.md)计划；当前执行选择以上述验证矩阵为准。

## 参数拓扑（第四轮）

第四轮在分支 `fix/parameter-topology-round4-review-blockers` 关闭父智能体 Review 阻断。**TD-042 仍为 BLOCKER**——下列门禁证明本地/临时库行为，不构成生产 cutover 就绪。

| 领域 | 测试 / 命令 | 证明内容 |
| --- | --- | --- |
| 厂商 dt-schema | `goldenPowerFixture.test.ts`、`scripts/vendorDtSchemaGenerator.test.ts` | 由属性规格确定性生成 linux-bindings；黄金 DTB 通过真实 `dt-validate`；负例按预期失败 |
| 黄金计数 | `goldenPowerFixture.test.ts`（拓扑解析）、`seedM1DtsFiles.test.ts`（`dts_properties`）、`matcher.test.ts`（排除结构键后匹配 120）、`ingestService.test.ts`（occurrence 176） | 锁定 **176 occurrence / 120 matched / 684 seed 行** |
| stage → finalize | `migration.test.ts`（临时 PostgreSQL、重连、注入失败） | 可运维 `stage-review` 事务；原子 `finalize`；cutover 拒绝非 `finalized` 运行 |
| 精确回写 | `editService.test.ts`、合入工作流测试 | occurrence 锁定合入/回写；base 不可变；身份过期 → `409` |
| Matcher / 审核作用域 | `matcher.test.ts`、`matcherScope.integration.test.ts` | override 按节点 locator 指纹隔离；`blocker_scope` 门禁 |
| Manifest 门禁 | `manifestBackfillMigration.test.ts`、`configRevisionManifest.test.ts`、`editService` needs_review 路径 | 从 `dts_config_revision_members` 回填；`needs_review` 对编辑/校验/发布/回写失败关闭 |
| 全局规格 hotspot | `postCutoverDashboard.integration.test.ts` | 租户项目包含 `organization_id IS NULL` 厂商规格 |
| 未匹配审核 | `service.test.ts`、`routes.test.ts` | `createSpec` + `confirmPropertyMismatch` 与治理审计 |
| 浏览器验收 | `parameter-topology.acceptance.spec.ts` | `PARAM-SPEC-GOVERN-001` 至 `PARAM-CONFIG-PUBLISH-GATE-001`；`PARAM-ENABLE-*` 占位已登记（ADR-0003）；API 模式无教学回退 |

拓扑发布前工具链门禁：

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameter-topology/migration.test.ts server/modules/parameter-specs/matcherScope.integration.test.ts --run
```

## 参数拓扑（第五轮）

第五轮在分支 `fix/parameter-topology-round5-review-blockers` 关闭父智能体 Review 阻断。**TD-042 仍为 BLOCKER**——下列门禁证明本地/临时库行为，不构成生产 cutover 就绪。

| 领域 | 测试 / 命令 | 证明内容 |
| --- | --- | --- |
| 不可变 base 与 candidate | `postCutoverWorkflow.integration.test.ts`、`editService.test.ts` | 合入/回写后 base binding revision 不变；合入值仅在 candidate revision |
| Fail-closed 回写 | `parameters/service` 合入路径、`writebackService`、`editService` 工具链门禁 | 缺 `objectStore`、项目范围、write lock 或工具链失败关闭；无 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` 生产绕过 |
| Phase 审计与运行关联 | `migration.test.ts`（`parameter_identity_migration_phases`、`migration_run_id`） | `stage-review`/`finalize` 不可变 phase 行；推断任务关联 staged 运行；cutover 拒绝伪造状态 |
| 租户 resolve | `validateSpecReviewTenantEvidence`、跨租户 PG 负向测试 | 跨租户证据拒绝；0055 不信任 raw evidence ID |
| Draft→激活→resolve | `draftSpecWorkflow.integration.test.ts`、`service.test.ts`、`routes.test.ts` | `createSpec` 仅 draft；`activate` 需 Admin+完整形状；resolve 拒绝 draft |
| 验收 fixture 诚实化 | `acceptanceTaskLookup.ts`、`semanticFixtureCleanup.ts`、topology/files/dts acceptance | 无 `items[0]` fallback；前缀作用域 FK 完整清理；覆盖 draft→activate→resolve |

第五轮工具链门禁（同第四轮）：

```bash
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts server/modules/parameter-topology/migration.test.ts --run
```

## 参数拓扑（第六轮）

第六轮在分支 `fix/parameter-topology-round6-review-blockers` 关闭剩余 Review 阻断。**TD-042 仍为 BLOCKER。**

| 领域 | 测试 / 命令 | 证明内容 |
| --- | --- | --- |
| Evidence-only scope 校正 | `0058_*.sql`、`specReviewTenantEvidence.integration.test.ts` | 历史污染 FK 按可证 evidence 重建/清空；未证明 resolved→open；幂等与回滚 |
| 无损规格身份 | `specIdentity.test.ts`、`draftSpecWorkflow.integration.test.ts` | `vendor,limit` ≠ `vendor-limit`；sanitize 不入哈希；碰撞审计 fail-closed |
| 全局激活权限 | `globalSpecActivate.authz.test.ts` | 组织 Admin 激活全局 draft → 403；本组织 draft 可激活；读/绑定全局仍允许 |
| 完整 valueShape 激活 | `DraftSpecActivatePanel.test.tsx`、`specCompleteness.ts` | gpio_int cellsPerGroup=3 保留；不完整形状阻断 |
| 融合 DTS 工作台 | `ParametersPage.test.tsx`、`DtsParameterWorkbench.test.tsx`、`DtsTopologyNavigator.test.tsx`、`DtsBindingDetailDialog.test.tsx`、`DtsBindingDraftTray.test.tsx` | 成熟 `WorkbenchLayout` + 真实语义嵌套导航、搜索/筛选、raw 值/shape/provenance 详情、本轮修改区、项目安全 typed 提交与响应式可访问性；无旧推荐值/教学回退 |
| 租户作用域清理 | `semanticFixtureCleanup.isolation.test.ts` | 其他组织/项目同名 Config Set 不受影响 |
| submit→review→merge 验收 | `parameter-topology.acceptance.spec.ts`、`disposablePostCutoverRuntime.ts` | 先通过融合 DTS 工作台执行语义搜索/树/详情/本轮修改，再自动创建可丢弃数据库，执行 migrations+identity cutover，校验 marker/run 一致性，并证明真实 set/delete 角色链、writeback、candidate AST/tombstone、reload 与 base 不可变，最后销毁数据库。因无 delete UI 控件，delete 创建/提交走公开 API；角色决议与 merge 仍走 UI。 |
| assignee/审阅 UI 验收 | `parameters-negative.acceptance.spec.ts`、`parameters.acceptance.spec.ts` | 三个可见下拉框使用 API 作用域 eligible user；production HMAC 浏览器身份分别执行硬件、软件与合入 UI 操作。不得用 DB 角色查询或同一 Admin token 替代 |
| 项目切换隔离 | `ApiProjectTopologyWorkspace.test.tsx` rerender + deferred-response 回归、浏览器交互 | 项目 A 的 candidate/draft/message 不得影响项目 B；B 从 `current` 开始；迟到的 A 草稿响应被忽略且不能加载 B 候选人。 |
| Evidence 运行隔离 | `check-operation-evidence.test.ts`、`run-browser-acceptance.test.ts` | 完整 record/artifact 共享 run+commit 目录；focused 保留 `latest-full`；混合运行 fail-closed。 |
| Binding 提交身份 | `routes.test.ts`、`postCutoverWorkflow.integration.test.ts`、迁移 `0059`–`0063` | HTTP 保留 draft/binding/spec/action 并返回 exact candidate ID。两个真实 PG 连接证明 submission 持有 draft+candidate 锁时，candidate 状态修改必须等待；提交执行 `draft -> pending_approval` 并把 ID 持久化到 item/request。Merge 拒绝 candidate 缺失、状态/value/delete proof 变化。升级测试覆盖 0061 全 origin 失效与 0063 事务回滚/幂等。 |
| Typed delete 生命周期 | `schemas.test.ts`、`postCutoverWorkflow.integration.test.ts`、`parameter-topology.acceptance.spec.ts` | `delete` 要求空 target，贯穿 draft/submission/CR/audit，证明 candidate binding 缺失及匹配 occurrence effect，写出 `/delete-property/`，re-ingest/validate 后不产生替代 binding revision，并在真实角色审核/合入/reload 后保持缺失。 |
| test:all 稳定性 | App API runtime 隔离、dashboard fixture 唯一命名空间、每个事务 PG client 的 FIFO 查询 | 默认 `npm run test:all` 无需临时 worker 覆盖或全局提高 timeout |

不得为了让拓扑验收变绿而对共享开发/验收库就地 cutover。拓扑 spec 自主管理 `wiseeff_acceptance_disposable_*` 数据库，并在破坏性清理前校验 test marker。独立的干净快照演练完成前，TD-042 仍保持开放。
