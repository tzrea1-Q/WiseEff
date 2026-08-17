# 安全基线

> English: [English](../SECURITY.md)

WiseEff 安全边界围绕身份、授权、审计、Agent tool governance、设备安全和数据隔离展开。

## 不可谈判项

- 前端权限检查只是 UX；后端写入必须执行权限校验。
- 生产写入必须产生审计证据。
- Agent 模型输出不能直接修改生产状态。
- 设备写入必须经过权限、校验、确认、快照和审计。
- 生产不能把 mock runtime 当业务数据源。

## 当前认证基线

- `AUTH_MODE=development` 只用于本地开发和测试，`x-wiseeff-user` 不是生产身份边界。
- `AUTH_PROVIDER=oidc` 是目标自托管生产身份推荐路径。API 通过 discovery/JWKS 校验 OIDC token，再从 WiseEff PostgreSQL 加载有效用户、角色和权限。
- `AUTH_PROVIDER=local` 是 WiseEff 自有本地账号路径。密码只保存 salted `scrypt` 哈希；`auth_sessions` 只保存不透明 session token 的 SHA-256 哈希；`/api/v1/me` 仍从 PostgreSQL 重新加载激活状态、角色和权限。
- `AUTH_PROVIDER=hmac` 只用于本地 smoke/test，不是目标环境身份验收证据。
- 工作流角色边界的浏览器验收以 production auth mode + test-only HMAC token 运行，并为每个 actor 切换真实浏览器凭据。development `x-wiseeff-user` 注入或同一个 Admin token 不能作为 Hardware/Software Committer、Software User 的 UI 证据。
- 生产路由不能回退到 development user，也不能把 token role claim 当作最终授权来源。

OIDC token 必须包含身份和组织声明。只有当 token 包含 `email_verified=true` 时，WiseEff 才允许用 email 作为迁移期 fallback 绑定；否则只按稳定 `sub` 匹配。错误 issuer、错误 audience、过期 token、not-yet-valid token、无签名 token、签名错误或不支持的角色 id 都应被拒绝。

本地账号注册会按所选组织和允许自助选择的平台角色创建基于用户名的账号。服务端会拒绝 Admin 自助注册；Hardware/Software Committer 注册申请会创建 inactive 账号、对应基础 User 角色和待审批申请，但不会发放 session token，也不能在 Admin 审批前登录。Admin 在用户治理后台批准后，服务端才会激活账号并授予申请的 Committer 角色。当前暂不支持邮箱验证，因此注册不能被当作邮箱域名归属证明或邀请接受流程。在 `NODE_ENV=development` 下，`db:seed:m0` 可为 ChargeLab 演示 persona upsert 固定 username 与仅限开发者的共用演示密码，便于本地按角色测 UI；非 development 的 seed 不得写入这些演示凭据，演示密码也绝不能用于生产或客户库。浏览器本地账号 token 当前保存在 `localStorage` 的 `wiseeff.localAuthToken`；需要 SSO、MFA、refresh-token rotation 或更强浏览器会话隔离的部署应使用 OIDC 或经过加固的反向代理/session 集成。

## 权限模型

当前前端权限包括：

- `parameter:view`
- `parameter:edit`
- `parameter:edit-critical`（敏感/安全关键节点写；Hardware/Software Committer 与 Admin 默认具备）
- `debugging:use`
- `logs:upload`
- `knowledge:view`（组织成员默认可读）
- `knowledge:edit`（创建条目;治理**自己的**条目）
- `knowledge:manage`（治理任意条目;彻底删除;Admin 档位）
- `parameter:review`
- `admin:access`
- `users:manage`
- `platform:access`（平台控制台；仅 `platform-admin`）
- `platform:schema-promote`（跨组织覆盖晋升；仅 `platform-admin`）

`platform-admin` 是第一个跨组织角色。`AuthContext` 仍绑定主组织，**不会**扩大对其他租户参数、日志、用户或项目的访问。它解锁平台作用域行（`organization_id IS NULL`）以及一个有界聚合读（晋升候选）。只有已持有 `platform-admin` 的调用方才能授予或撤销该角色。平台级审计事件可将 `organization_id` 置空，并向每个受影响租户扇出一条组织作用域事件；普通列表接口仍按调用方组织过滤。

新增后端业务路由时，必须把前端 capability 映射到服务端授权检查，并补 forbidden 用户的负向测试。

**节点级敏感规则（P3）：** `dts_sensitive_node_rules` 按组织/可选项目匹配 `path` 或 `compatible` 模式，映射到 `high`/`critical` 与所需能力（默认 `parameter:edit-critical`）。命中规则但缺少能力的提交/合入/回写返回 `403`。Agent（`actorType=agent`，含小择 `action.submitParameterChange`）对 `critical` 一律拒绝，写审计 `parameter-sensitive-node-denied`（`requireHuman: true`），须由人工完成变更。

**DTS 重载敏感节点扩展（#284）：** 启动重载运行时，对每个选中参数按同样规则（path / compatible）匹配。命中后除 `debugging:dts-reload` 外还须 `parameter:edit-critical`。critical 层级另须请求体 `confirmationToken: "confirm-sensitive-reload"`，并以 severity `High` 写审计且点名命中规则——在能力与确认都具备时仍允许重载（非一律拒绝）。Agent 在 DTS 重载的全部 mutating 路径上一律拒绝——start、deploy、restore，以及 Admin 重载配置写入（`PUT` 组织配置）——且发生在敏感判定之前，审计 `dts-reload-agent-refused`（`requireHuman: true`），返回 `403` 且 `details.code: "dts-reload-agent-refused"`（#301 / #304）。#280 对重载调试的 Agent 一律拒绝包含配置面；#301 更窄的 start/deploy/restore AC 只是补特定缺口，并非为配置开豁免。更窄的敏感命中拒绝（`dts-reload-sensitive-node-denied`，同样 `requireHuman: true`）保留作纵深防御。拒绝响应为 `403`，`details.code: "sensitive-node-reload-denied"`（含 binding、规则、层级），可与普通缺权限区分。候选列表由服务端返回 `sensitiveMatch`，UI 在启动前即可标记抬升要求。设备部署确认（`confirm-dts-reload`）由 UI 在部署步骤收集（#285），在本闸门之后组合；runtime 不得静默注入任一令牌。

**DTS 重载 Agent actorType 信任边界（#304 / TD-068）：** `assertDtsReloadHumanActor`（以及它对齐的参数模块 `SensitiveWriteActorType` 模式）依赖**调用方传入的进程内** `actorType`，不是 `AuthContext` 上的已认证字段。闸门约束的是传入 `actorType: "agent"` 的 Agent 工具 / 服务调用方；若 Agent 持有普通用户 HTTP token，则与人类不可区分——与参数敏感写相同。在 TD-068 解决前，不得把该闸门理解为已认证的 actor 分型。

**DTS 重载快照（#285 / ADR-0021）：** 对本设备写路径，平台的 snapshot 不可协商项由**重载快照**满足：各目标参数的库基线值、已对设备侧副本校验的制品摘要（并记录实际达到的完整性强度——`sha256` / `md5` / `byte-length`），以及之后能拿到的内核侧信号。它不声称设备树生效值，也不写入 `debugging_snapshots`（该表语义假定可把旧值写回）。

**DTS 重载残留与恢复基线（#288）：** 普通重载运行到达设备写后终端（`unverifiable` / `verified` / `contradicted`）后，平台在 `dts_reload_device_residue` 按组织+设备记录**重载残留**（源运行 + 参数）。残留是运行历史的平台记账，不是设备事实，展示时必须说明此限制（重启 / 重刷 / 平台外改动会使记账失效）。恢复基线启动新运行（`purpose: restore-baseline`），调试值为残留参数集的当前库基线；复用同一 start + deploy 路径（需要时 start 收 `confirm-sensitive-reload`，deploy 收 `confirm-dts-reload`），审计种类为独立的 `dts-reload-restore-*`。恢复运行成功到达设备写后终端则清除残留；失败则保留。

**DTS 重载运行历史（#289）：** 列表与详情（及候选参数的上次重载投影）走 `debugging:view`（或 `debugging:dts-reload`）。启动 / 部署 / 恢复 / 配置仍按既有权限。编译 overlay 对象按 `RELOAD_ARTIFACT_RETENTION_DAYS`（90）自运行 `completed_at`（否则 `created_at`）保留；过期后元数据与摘要仍可读，产物下载返回 `410` 且 `details.code: "reload-artifact-expired"`。

参数管理写入需要服务端权限和审计：草稿、提交、审阅、merge、import，以及**项目参数初始化**的提交/批准/驳回（审计 kind：`project-initialization-*`）不能只依赖前端禁用按钮。参数模块树 CRUD（`/api/v1/parameter-modules*`）要求 `admin:access`；非 Admin 在具备 `parameter:view` 时可列表。删除非空模块或循环移动返回 `409`。**按 kind 的写守卫（ADR-0010）：** `node-type` 可重命名/移动，仅在空（无 binding、无子模块）时可删；组织 `unclassified` 根只读（不可重命名/移动/删除）；`driver-group` 删除走**解散**（移除子树映射、重停放 binding、清理空 auto 后代）；重分类白名单为 `{business, node-type}`。v2 模块归属路由（registry/discovery-hints 的 GET 除外）同样要求 Admin。模块归属 v2 写入另产生审计：`parameter-module-mapping-created`、`parameter-module-mapping-deleted`、`parameter-module-compatible-dismissed`、`parameter-module-compatible-restored`、`parameter-module-driver-group-disbanded`、`parameter-module-bindings-recomputed`（范围应用与运维重算）。日志上传、重跑、归档、反馈也必须由后端校验权限并记录审计。产品级「问题反馈」提交要求 active 登录用户；Admin 列表、详情、状态更新、备注和附件读取要求 `admin:access`。`debugging:admin` 管理调试 catalog metadata、HDC/ADB node bindings 与调试节点模块树（`/api/v1/debugging/admin/modules*`）；调试节点写入仍必须走 runtime path，并具备调试写权限、项目访问、有效 session、可写 access mode、范围校验、设备 lease、写前快照和必要的高风险确认。

产品反馈以 `organization_id` 做隔离，`product_feedback` 与 `product_feedback_attachments` 的读写都必须按认证组织过滤。附件只允许 `image/png`、`image/jpeg`、`image/webp`，最多 5 张，单张 5 MB，总量 15 MB；数据库只保存 metadata 和对象存储 key，不在行内保存图片 bytes。该反馈属于 Internal Beta 产品反馈，不能混用日志分析的 `logs:feedback` 权限和数据模型。

知识库的每条 `/api/v1/knowledge/*` 路由都在服务端强制 `knowledge:view` / `knowledge:edit` / `knowledge:manage`;UI 门控仅是 UX。发布者问责（设计 D18）:`knowledge:edit` 只治理**自己的**条目（编辑/发布/归档）,绝不发布或修改他人作品;跨人治理与彻底删除集中在 `knowledge:manage`。草稿仅对拥有者与 `knowledge:manage` 可见;检索只覆盖 `published` 条目,草稿与已归档条目不可能经检索泄露。`knowledge_entries`、`knowledge_revisions`、`knowledge_files` 全部按认证组织过滤。文件上传接受 PDF、`.docx`、`.doc` 与纯文本/markdown,上限 20 MB;字节存对象存储,数据库只存元数据、校验和与诚实的提取状态。知识蒸馏（`POST /api/v1/knowledge/distill-from-log`）是"先读后建"的双重门控:调用者创建草稿需要 `knowledge:edit`,同时读取来源分析记录需要 `logs:view` 加组织隔离（由日志服务强制）;预填草稿只耦合已存储的分析记录 DTO,分析器规则 ID 绝不进入知识内容。Agent 写工具 `action.createKnowledgeDraft`（Phase 3）遵循标准变更工具契约:任何写入前都经 DB 落库的审批链等待人工明确批准,在调用用户的 AuthContext 下执行（执行时强制 `knowledge:edit`）,只创建**新**草稿（Agent 绝不修改既有条目）,并记录创建会话（`source_session_id`）与用户以支撑发布者问责;其审计事件携带 `actorType=agent`。Agent 草稿发布权:`knowledge:edit` 可发布或拒绝归档**本人会话**沉淀的草稿（草稿的 `created_by_user_id` 即会话用户）;`knowledge:manage` 可在 `/knowledge-admin` 队列中发布或拒绝任意 Agent 草稿。拒绝会将草稿归档,永不发布。

项目参数治理（`/parameter-admin/projects/:projectId/*`）的不可撤销动作必须先经过显式人工确认才发请求：发布基线、回滚基线、移除配置集成员，以及文件冲突的两侧裁决。每个确认框都要说明影响范围，裁决可填写操作原因并随审计提示一起记录。修订校验门禁返回 `requiresConfirmation` 时，发布在操作者勾选确认该风险之前保持拦截，门禁结论不得只当提示文案。修订校验只对调用方选定的真实配置修订开放，没有教学或兜底 revision id，避免合成 ID 进入审计记录。这些确认属于 UX 安全层而非授权边界：`/api/v1` 与 `/api/v2` 仍在服务端校验权限、项目范围与审计，并且必须拒绝客户端跳过确认的写入。

Bridge-backed 调试会话还要求 bridge 属于当前用户、未撤销且在线；后端会持久化 `execution_mode=bridge` 与 `bridge_id`，保证审计、回滚和冲突检查与服务端执行路径一致。

## 审计要求

审计记录应包含 actor、target、action、severity、metadata、trace/request id、timestamp，以及项目或组织 scope。

审计完整性由缝（seam）而非约定承载（ADR-0027）：每条审计事件必须是三种形态之一——**审计写证据**（与领域写在同一数据库事务中提交，经 `withAuditedWrite` / `writeAuditEventInTx` 与 `AuditTx` 品牌类型）、**拒绝证据**（先拒绝后抛错；经 `writeRefusalAudit` 走连接池句柄写入，从而逃过它自己触发的回滚）、或**里程碑证据**（分步流程；经 `writeMilestoneAudit` 立即写入，从而在后续步骤失败时仍然存在）。`auditRatchet.test.ts` 钉住剩余的 `createAuditEvent` 直调——全部为有文档说明的永久常驻项。

必须覆盖的事件包括登录/安全事件、参数写入、审阅决策、日志上传/重跑/归档、产品反馈创建与处理、知识条目变更、设备读写、Agent tool、管理员变更和导出。知识库写入记录 `knowledge-entry-create/update/publish/archive/restore/delete`（delete 为 `High` 级）与 `knowledge-revision-restore`,Phase 3 另有 `knowledge-entry-distill`（从日志分析沉淀草稿,metadata 含来源 `logId`）、`knowledge-entry-agent-draft`（`actorType=agent`,metadata 含创建 `sessionId` 与可选 `sourceLogId`）与 `knowledge-entry-reject`（发布队列的 Agent 草稿拒绝归档）,metadata 含内容形式、标题、修订号与生命周期流转及请求 trace;提取正文不写入审计 metadata。节点启用状态写入（共享拓扑草稿管线）产生 `parameter-topology-governance` / `enablement-changed` 审计，metadata 含原值、新值、理由与逻辑节点身份；鉴权复用 `canEditParameters` 与现有 `dts_sensitive_node_rules`（规则要求时须 `parameter:edit-critical`）。产品反馈写入会记录 `product-feedback-create` 和 `product-feedback-update`，metadata 包含反馈类型、状态、页面路径、附件数量，以及 Admin 处理时的前后状态；附件图片 bytes 不写入审计 metadata。调试 catalog metadata 与 binding 变更必须写审计；binding audit metadata 不应暴露 raw node path，除非部署策略明确允许。复杂调试写入还会在审计与操作记录中附加格式感知元数据：`valueKind`、`valueFormat`、`normalizationMode`、字节长度、digest，以及有大小上限的 `valuePreview`；大 payload 不得重复写入审计或验收 evidence，digest 与 preview 才是可比较的持久证据。`maxValueBytes` 与服务端默认值会在服务端限制写入 payload 大小；设备写入审批、lease、snapshot 与确认边界不变。本地账号路径会写 registration、login、logout 和当前用户 profile update 审计事件；用户治理后台还会记录本地 Committer 注册申请的 approve/reject 审计事件。退出登录必须服务端撤销当前 session token；当前用户资料更新不能修改 email、角色、激活状态或组织。

## Agent 安全

Agent tool 分为：

- Read-only：权限检查后可自动运行。
- Preparation：可创建草稿或预览，但不提交生产状态。
- Mutating：必须创建 approval record，等待人工批准后执行。

批准时必须重新检查权限和业务状态。Provider 故障不能静默执行工具；降级回答允许存在，但必须跳过 tool execution 并留下可审计证据。

**Xiaoze P0 感知：** `perception.*` 工具为只读（`kind: read`，`requiresApproval: false`），必须通过与其他 Agent 工具相同的 `ToolRegistry.authorize` 边界。跨页面读取受调用方项目 scope 与权限限制；越权 tool call 返回 `FORBIDDEN`，Agent 必须给出安全的非数据回答。AG-UI 端点在流式事件前拒绝未认证请求。

**Xiaoze P1 行动：** `action.submitParameterChange` 为 mutating 且 approval-gated。AG-UI runtime 开启 orchestrator 自有的 Agent 审批链——`beginApproval` 持久化 tool-call + approval 记录并发出 interrupt——且仅通过 `resolveApproval` 恢复，在事务内重新鉴权、审计 `actorType=agent`。审批状态以数据库行（`agent_tool_calls` + `agent_approvals`）为唯一载体、绝不驻留进程内存，因此 begin 与 resolve 跨重启和多副本仍然正确（ADR-0024）。`editedArgs` 在批准时重鉴权与执行之前完整替换 tool payload。执行时工具走切换后的语义路径：创建类型化绑定草稿（schema 校验、写锁），以草稿身份经 `submitParameterChanges` 提交（`actorType: "agent"`）；提交失败会删除 Agent 建的草稿。任何草稿创建之前先走与人工相同的敏感节点守卫：命中 `critical` 规则立即拒绝（`403`、`requireHuman: true`），不会创建生产变更请求。设备写闸门在 P1 仍由调试界面与后端拥有，不在小泽内执行。

**Xiaoze P2 规划：** 多步计划使用 LangGraph `StateGraph` 与按 `threadId` 的 checkpointer，使 mutating 步骤在批准后能从计划中途恢复而不丢失已感知上下文。当 `XIAOZE_CHECKPOINTER=postgres` 时，checkpoint 载荷（含 tool 参数与感知上下文）静态保存在 PostgreSQL 中，须与 Agent 业务表一样受数据库访问控制保护；与用户可见聊天历史（TD-030）分离。resume 命令仅携带审批决定（`approvalId`、`decision`、`editedArgs`、`reason`）；请求级认证上下文经每次调用的配置传递，绝不进入图状态、也不会被序列化进 checkpoint（ADR-0024）。主动建议为只读、受 authz 限制且 opt-in（`XIAOZE_PROACTIVE_ENABLED` / `VITE_XIAOZE_PROACTIVE_ENABLED`，默认关闭）。suggest 通道仅通过 `POST /api/v1/agent/xiaoze/suggest` 调用 `perception.*` 工具，不写库且不提出调用方权限外的数据。计划中的 mutating 写入仍须逐步经 orchestrator approval 链人工批准；拒绝某步则安全终止计划且不产生 mutation。

### 日志分析 LLM（P1/P2）

`LogAnalysisAdapter` 背后的日志分析内核运行在小泽栈之外（ADR-0022）：仅复用 `ChatOpenAI` 客户端模式并使用独立的 `LOG_ANALYSIS_*` 环境变量家族，不用 LangGraph、不进 `ToolRegistry`、不接 approval 链——因为它**没有任何写路径**。其全部输出是仅供参考、证据接地的报告；绝不触碰设备、参数或任何 mutating API。自 P2 起默认内核是驱动五个**只读**工具的有界 agent 循环；工具是 worker 内部普通函数，绝不进注册表，所有带数据库的工具在仓储层绑定 worker 快照中的组织 id——模型无法把查询引向别的租户。

- **不可信输入：** 上传的日志内容、检索到的知识条目文本（`read_domain_knowledge`）与参数上下文（`get_related_parameter_context`）都按不可信模型输入对待——把知识条目关联到业务域意味着其文本进入提示词，这是既有不可信输入立场的延伸，不是新的信任授予。提示词要求模型不得执行其中的指令，且结构性控制不依赖该指令：每步输出必须是通过 schema 校验的严格 JSON（工具调用或最终报告），工具参数经 zod 校验且结果硬性截断，接地校验会剔除任何在解析行中不存在的引用行号；无法接地的输出直接弃用，改用确定性规则回退并显式标注降级。
- **published-only 检索：** `read_domain_knowledge` 在 SQL 层继承知识库的 published-only 不变量——草稿与已归档条目绝不进入分析提示词，域关联也只能指向已发布条目（发布是唯一信任门，设计 D13）。
- **诚实降级：** provider 故障走既有 job 重试/退避；最后一次尝试回退到规则引擎并记 `analysis_source = 'rules-fallback'` 与 `degraded_reason`。循环内核预算耗尽的提前收敛同样保持标注（`degraded_reason = 'token-budget-exhausted'`，置信度封顶）。降级结果绝不冒充完整分析，UI 必须保持来源徽标可见。
- **证据纪律：** 日志、审计与指标记录 model 标签、latency、token 数、降级原因与 trace/request id；绝不记录 API key、原始 prompt、原始 provider payload 或原始日志内容。`/health/ready` 暴露 `logAnalysisLlm` 配置状态（与 `xiaozeLlm` 同语义），不暴露凭据。
- **租户隔离：** worker 通过组织级仓储查询读取日志字节、业务域行、知识关联与参数上下文；业务域治理（含知识关联、Webhook 配置与按域模型覆盖）需要 `logs:admin-domains` 并写 `log-domain-*` 审计。

### 日志分析结果 Webhook（P3b）

域级结果 Webhook 会让服务端向管理员提供的 URL 发起出站 HTTP 请求，因此 URL 按不可信输入对待并施加硬性反 SSRF 约束：

- **协议与地址策略：** 仅允许 `https:`；拒绝内嵌凭据的 URL；IP 字面量主机若落在私网、环回、链路本地、CGNAT、基准测试、组播、保留或云元数据段（`0.0.0.0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、`192.0.0.0/24`、`192.168/16`、`198.18/15`、`224/4` 及以上、`::1`、`::`、`fc00::/7`、`fe80::/10`、`ff00::/8`、IPv4-mapped IPv6）一律拒绝。同一校验在配置保存时（返回明确的 `VALIDATION_FAILED` 原因码）与投递时都会执行。
- **DNS 重绑定闭环：** 投递连接通过套接字自带的校验型 DNS lookup 解析主机名——所有解析地址都会对照封禁段检查，任何一个被封禁即拒绝连接,主机名无法在“校验”与“连接”之间重新解析到私网地址。不跟随重定向；丢弃响应体（只记状态码）；短超时（`LOG_WEBHOOK_TIMEOUT_MS`，默认 5s）。`LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true` 是本地联调开关，额外放行环回（`http://127.0.0.1`）接收端；服务端环境校验在生产环境拒绝该开关。
- **载荷最小化：** 投递只携带精简结果摘要（记录/运行 id、文件名、状态、来源、严重级别、置信度、截断结论、产品链接路径）。绝不外发原始日志内容、证据全文或提示词；消费方经认证 API 获取细节。
- **真实性与防重放：** 每次投递用该域密钥签名——`X-WiseEff-Signature: sha256=<HMAC-SHA256(secret, "timestamp.rawBody")>`,并携带 `X-WiseEff-Timestamp`。时间戳参与签名输入（未签名的时间戳可被改写,防重放即失效）;接收端在有界重放窗口内用常量时间比较校验（docs/zh-CN/api/log-analysis-integration.md）。
- **密钥处理：** 签名密钥为 HMAC 用途在服务端存储,API 层只写不读（响应与审计元数据仅含已配置状态与末四位）,绝不出现在投递记录、日志或指标中。配置变更与管理员测试投递均有审计（`log-domain-webhook-config`、`log-domain-webhook-test`）。
- **影响面诚实：** 投递尽力而为并与分析结果完全解耦——失败按有界退避重试、按次记入 `log_webhook_deliveries`、在 `/log-admin` 与指标（`wiseeff_log_webhook_deliveries_total`）中可见,绝不使分析 job 失败、重试或延迟。该通道有意不进 `/health/ready`。

## 设备安全

设备访问必须经过 gateway boundary。写请求需要 request id、用户和权限上下文、设备和 node target、access mode、目标值、风险等级、确认或 approval id、写前快照，以及 readback 结果或失败原因。

Simulator-backed path 只用于本地验证。ADB/HDC 都必须经过同一个后端 gateway、权限、lease、snapshot、rollback 和 audit 边界。真实 pilot readiness 需要 HDC/device-lab 目标证据；本机 ADB lab 证据只能作为补充：不能有前端直接设备写入，不能无 lease 和 snapshot 写入，不能无确认 rollback，也不能绕过审计。

本地 Device Bridge 连接采用短时配对码和带 scope 的 bridge token（`device-bridge:connect`、`device-bridge:execute`）。这些 token 仅在服务端校验通过后用于 WebSocket 注册与 RPC 执行；浏览器中的 bridge 健康探测或配对 UI 本身不授予设备写入权限。

本地桥监听回环地址（`127.0.0.1:18787`），其 HTTP 面按 CORS 策略刻意分层（决策 TD-108，以方案 B2 关闭）。`/tools/install` 限定于配对来源白名单（`[webOrigin, serverUrl]`）。`/connect` **有意**保持开放 CORS 加 Private Network Access：它是首次接触端点，让任意 WiseEff 来源请求一个已在运行的桥去连接，且其副作用无论来源都有门控——`runConnectCommand` 在没有合法的短时效、一次性配对码时拒绝配对，除非桥已配对到请求中指定的那个确切服务器,因此任意网页无法把桥配对到攻击者控制的服务器。`/health` 同样保持开放 CORS，让任意 WiseEff 来源能探测到桥在运行，但**对非白名单浏览器来源脱敏身份字段**：只有配对来源（白名单命中）或本机工具（无 `Origin` 头）能拿到 `bridgeId`、`serverUrl`、`launcherPath`、`tokenExpiresAt` 和工具状态；其余浏览器来源只拿到存活信号（`{ ok, paired, connected, updatedAt }`）。这样既保留零摩擦的存在性探测，又让操作者偶然访问的网页无法指纹识别桥 ID、配对服务器或操作者的启动器文件系统路径。残余且已接受的暴露面是跨来源存活信号加一个针对桥自身已配对服务器的 CSRF 式重连触发；它不暴露设备写入权限——写入始终经由已认证、有审计的服务端路由。

Bridge 重命名（`PATCH /api/v1/device-bridges/:bridgeId`）与撤销（`POST /api/v1/device-bridges/:bridgeId/revoke`）需要 `debugging:use`，且只能操作当前用户拥有的 Bridge；撤销会立即使 bridge token 失效，阻止新的 WebSocket 连接。重命名只更新展示用机器标签，不轮换凭据，也不扩展 scope。

## 不可信子进程执行（DTS 校验门禁）

P2 配置集基线校验门禁用系统 `dtc` 二进制编译用户提供的 DTS 内容（`server/modules/parameter-files/dtcValidator.ts`）。DTS 内容属于不可信输入（项目成员上传/编辑），子进程边界必须保持受限：

- **独立临时目录**：每次校验都写入全新的 `mkdtemp` 目录，`finally` 块中统一清理——包括 spawn 出错、超时或异常场景；校验从不写入共享或可预测路径。
- **最小环境变量**：子进程拿到 `PATH` 以及已存在的用户身份变量（`HOME`、`USER`、`LOGNAME`）（`minimalEnv()`），API key、数据库 URL、SSH agent socket 等进程 secret 都不会传给 `dtc`。未设置的身份变量直接省略，不编造。
- **硬超时**：每次 `dtc` 调用都受超时控制（`DtcValidateOptions.timeoutMs`，默认 10 秒），超时会向子进程发送 `SIGKILL`，避免畸形或恶意 `.dts` 文件无限期挂住发布/导出路径。
- **不假设网络可用**：沙箱不为 `dtc` 提供也不预期出站网络访问；未来任何需要网络访问的校验器实现都应当作新的威胁模型评审，而不是增量改动。
- **固定 argv，无 shell 拼接**：文件名和路径作为 `spawn` 的 argv 元素传入，从不拼接进 shell 字符串，DTS 文件名无法注入 shell 元字符。
- **可审计的降级路径**：`dtc` 不在 `PATH` 上时，校验器按 `DTS_VALIDATION_MODE` 降级（`block` 失败关闭，`warn`/`off` 放行并记录诊断），而不是静默跳过校验；每次门禁运行——包括降级场景——都写 `validation.gate` 审计事件（见 `docs/zh-CN/developer/environment-variables.md`）。
- **可选 dt-schema 钩子**：当 `DTS_ENABLE_DT_SCHEMA=1`（或 `enableDtSchema`）时，校验器可合并注入的 schema runner 诊断。缺工具默认按 warning 降级（`DTS_DT_SCHEMA_MODE=warn`）；仅 `DTS_DT_SCHEMA_MODE=block` 才把不可用抬升为硬错误。
- **生产失败关闭工具链（基线发布 / Admin 校验）**：release 模式工具链校验（`dtc` + `fdtoverlay` + `dt-validate`）用于**基线发布门禁与 Admin `validateConfigRevision` 辅助**，不用于日常语义合入/写回。生产环境不得绕过这些 L2 门禁。API 与 CLI 门禁共用项目/受管二进制解析器；无效显式路径失败关闭，runtime 不自动安装工具。绕过触发 critical 告警 `WiseEffConfigPublishValidationBypass`。语义身份切换仅限维护窗口且只能整快照恢复——见 `docs/runbooks/parameter-identity-cutover.md`。迁移证据保留遗留 ID/值，但不得把 `recommended_value` 自动提升为 schema default 或 policy。在干净非客户快照演练完成前，**TD-042 仍为 BLOCKER**。
- **容器化沙箱评估（TD-040 / B5）**：**本期不实现**。评估结论：维持受限 OS 子进程（`tmpdir` + 最小环境变量 + 硬超时 + 固定 argv）作为默认隔离边界。若后续威胁模型需要强于当前子进程的隔离，再单独立项评估容器/gVisor 方案。

**导出数据分级：** `exportFile`/`exportConfigSet` 返回的正是项目已存储的同一份 DTS/JSON 参数内容（不含凭据、token 或跨租户数据），因此导出响应的敏感级别与源参数文件相同，均要求 `admin:access`，与配置集/基线其他接口一致。导出 bundle 通过 HTTP 响应体返回，供调用方手动提交到 Git；后端不会把它写入共享或公开位置，持久化导出 bundle 的调用方需要自行套用与源仓库一致的访问控制。

## Secret 和备份安全

- S3-compatible 对象存储凭据、signed URL、带密码的数据库 URL、bearer token、Agent API key 都不能提交。
- 备份/恢复证据只能提交脱敏后的摘要、计数、对象 key/prefix 和命令状态，不能提交数据库 dump 或对象内容。
- Restore drill 必须使用隔离数据库和对象存储目标。恢复到 live production database、live bucket 或 live prefix 是安全违规。
- `/metrics` 是运维证据，不是公开 API；pilot/production 必须通过私有网络、VPN、allowlist、mTLS 或更强控制保护。

## 参考

- [docs/design-docs/security-governance.md](design-docs/security-governance.md)
- [docs/design-docs/domain-model.md](design-docs/domain-model.md)
- [docs/design-docs/api-contract.md](design-docs/api-contract.md)
- [docs/security/README.md](security/README.md)
- [docs/runbooks/identity-provider.md](runbooks/identity-provider.md)
