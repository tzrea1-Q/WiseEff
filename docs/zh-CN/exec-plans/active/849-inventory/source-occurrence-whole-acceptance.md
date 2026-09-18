# T1.1 整体候选验收检查点

> English: [English](../../../../exec-plans/active/849-inventory/source-occurrence-whole-acceptance.md)

状态：**T1.1 本地整体验收与封板准备已完成；未执行正式 SEALED 交付。** 前轮阻断后，用户已授权 R5／R6 设计复审、修复及验收；两项问题经独立设计和最终实现复审关闭。到此停止：不进入 T1.2，不 commit、PR、合并、部署或修改已有迁移历史。关联[已接受修复设计](source-occurrence-review-repair-design.md)、[威胁矩阵](source-occurrence-threat-matrix.md)及[流程契约](source-occurrence-workflow-contract.md)。

## 最终授权的 R5／R6 续轮——2026-09-17

R5 在既有 migration adapter 中使用 canonical 序列化 locator 计算摘要。测试独立构造排序、双空格缩进、LF 结尾的 preimage；旧 compact JSON 摘要在写入前拒绝，canonical 重放保持 Binding／value／pin／history 数量不变。R6 在 pool wrapper 占有写连接前准备 immutable Catalog snapshot；事务内操作接收 snapshot，不取 pool 连接、不管理事务生命周期。HTTP 在 audited write 前准备 snapshot，seed 复用既有 snapshot 并保留空 Catalog 行为。没有新增依赖、宽松旧摘要兼容、latest-release 限制、生产连接池扩容或超时放宽。

| 最终候选证据 | 实际结果 |
| --- | --- |
| R5 原生 Red → Green | 11:56:18 canonical 正例失败（8 项被选择器排除）；11:57:25 完整 adapter 文件 **9/9 通过**，无跳过。 |
| R6 原生 Red → Green | 11:57:54 空 Catalog／单连接池取连接超时（9 项被选择器排除）；12:00:11 sync／drafts／三份 seed 测试 **33/33 通过**，无跳过。覆盖空 Catalog 单连接、四并发已物化重放、唯一连接上的调用方事务、value／audit 回滚与连接释放。非空 max-one 证据是重放，不是初次物化；整个 seed 仍需 advisory-lock 连接加工作连接。 |
| 最终受影响原生回归 | 12:07:23，**19 文件／171 通过／0 失败／0 跳过**，127.96 秒。覆盖 Binding／迁移、values、sync／routes／drafts、seed、JSON 流程及 DTS proof；不是完整后端／S1。 |
| 最终静态／原生门禁 | build、Node TypeScript、OpenAPI freshness、UI ratchet、`git diff --check` 均通过。fresh `t11r56docs` helper 库的原生 `docs:check` 通过，含 pgvector schema 比较，无跳过。相对已接受基线的边界检查 **3513/3513 已批准**，unapproved／stale／metadata／growth 均零，未改 allowance。保留既有 build 外置／chunk 警告；回执编辑后重查文档治理。 |

新真实鉴权 HTTP 使用 helper runtime `wiseeff_acceptance_disposable_t11_pc_mu50ci5c_ad460bb2`、API `http://127.0.0.1:49155`、真实密码鉴权／数据库角色／ObjectStore。`work/t11-http-loop.ts` **退出码 0**：DTS `<1000>` → `<1250>`、JSON `36.5` → `45.625`；preview／stage／draft 不改 current，自审 403、独立审核成功、重试稳定、历史 export／diff 及新旧精确重导入不变。请求为 `pvcr_bf0ccbe5-c9e2-4975-b7a8-39002957909c`、`pvcr_affda828-49a9-4dd2-a2c3-321ab4e4a81d`。Binding GET 是纯读取，不是 sync 入口；Spec 正确要求为真实鉴权 parameter-file 上传 POST 及同步审计补独立回执。

最终浏览器读回由 `liu.min` 登录 `/parameters?project=aurora`、`/parameter-review?project=aurora`，**仅 1440×900**。观察到 current DTS `<1250>`、JSON `45.625` 和正常待审核空态；document 宽 1440，已查看截图 `work/ui-checks/t11-r56-current.png`、`t11-r56-review.png`，无溢出或重叠。刷新后各页 console error 为零，各有两条既有 CopilotKit 许可警告；初次未登录 `/me` 为 401，随后观察的 API 均为 200，未见 5xx。这是本轮读回／导航证据，不冒充下文前轮完整编辑／键盘流程重跑。浏览器已关闭；向精确自有 runtime PID 73753 发送 SIGTERM 后完成回收。不宣称 Hosted／目标／发布验收。

**Standards：PASS。** 独立 Luna／max 评审实际 dirty diff 与未跟踪 R5／R6 文件，核对写前证明、canonical digest、所有事务拥有者及适用安全／开发／协议规则；无阻断 P1 或需处理的代码异味。**Spec：PASS。** 独立 Luna／max 核对批准设计、流程契约、immutable snapshot 语义、seed null 行为、canonical 拒绝／重放及回滚证据；无阻断 P1。审查有界，评审者未参与实现，也未把父端测试冒充其独立执行。前轮 B1-03／06／29 与 live fixture 评审仍按下文独立范围保留。

已重新核对原归档及当前 0151／0152／0153 摘要不变；最后只读持久 lane 仍仅有历史 0151 `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`，无 0152／0153。T1.1 本地候选已准备好供用户决定后续交付，但不是已提交的 exact-SHA seal。后续 todo 全部保持未勾选；不关闭 #849／#853，S1／S2、其余 consumer／seed／cutover 和后续交付保留各自门禁。

### 明确的真实鉴权上传／同步回执

为关闭 Spec 证据备注，未改生产代码，只在既有 disposable runtime 脚本的真实上传 seam 增加断言。fresh 原生 runtime `wiseeff_acceptance_disposable_t11_pc_mu50odt5_18fa08e8`、API 64624 实际通过：真实鉴权 `POST /api/v1/projects/aurora/parameter-files` 返回 **201**；canonical Binding **0 → 1**，current DTS 为 `<1000>`；恰好新增一条 canonical sync audit，actor `u-xu-yun`、action `binding-edited`、`written:1`，target revision 与新 source pin revision 一致。audit trace 为 `69e33f1c-3928-42de-9dd2-6890cb879b79`。后续重复纯读取 Binding GET 的响应及 audit 集合不变。脚本输出明确成功回执并进入 ready；向自有 PID 4898 发送 SIGTERM 后回收，**退出码 0**。这是普通 runtime pool 上的初次 HTTP 物化，和单连接重放测试分开，不把 GET 解释成 sync。独立复审确认 P2 证据备注关闭。脚本和截图仍为 ignored 本地证据，不是已提交的资格产物。

只读回收核对确认 `pg_database` 不再包含两份最终 runtime 库，49155、64624、5174 均无监听。持久任务 lane 不是清理目标。

## 候选与执行边界

工作树 `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity` 根指令选择 `AGENTS.md`；无根 `AGENTS.override.md`，范围内未发现嵌套指令。分支 `codex/849-853-t11-source-identity`，继承 HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`，已接受基线 `46b6068693942b95f7cba28ee5de6748a97170fa`。T1.1 实际候选是相对 HEAD 的未提交差异和未跟踪文件，不能只审 `base...HEAD`。继承改动和 main 工作区完整保留；本轮未刷新或 rebase main，后续集成前仍须刷新。

原生验证均在专用 pgvector PostgreSQL 55438 上由 helper 新建的临时库进行。`wiseeff_lane_849` 仅提供服务端／管理连接定位，绝不是迁移目标。最后只读核对仍为历史 0151 checksum `8930a209b4a2907a8bcfe297d1744c795fd0a8e4cacb1286b639988c39c86ad7`，无 0152／0153。原归档 0151、现行 0151／0152／0153 的四项 SHA-256 与前轮回执一致，未重写任何持久库历史。

## 前轮整体候选验证账本（R5／R6 修复前）

| 检查 | 实际结果与限制 |
| --- | --- |
| 受影响后端集合，11:04:37 | 105 文件、905 用例：896 通过／9 失败／0 跳过。两个源证明／迁移文件中 3 项超时；两份比较贡献测试中 6 项为 live schema 指纹过期。不是完整后端或 S1。 |
| 后端隔离重跑，11:13:22 | 两个超时文件加纠正路径后的 matcher／capability 兼容文件：4 文件、71 通过、0 跳过；单 worker，断言／超时不变。原命令曾写错两个兼容测试路径，不能把它们算作首轮已收集证据。 |
| live schema 测试指纹校正，11:22:48 | 两份比较测试 8 通过、0 跳过；仅更新现行预期指纹及注释，0137 冻结值不变。 |
| 受影响前端，11:04:37 | 11 文件、136 通过、0 跳过。 |
| 边界脚本测试 | 首轮 4 文件：24 通过、104 跳过，原因是三个 beforeAll 超时。只将这三文件单 worker 隔离重跑一次：104 通过、0 跳过。未放宽断言或超时。 |
| 新增迁移证据，11:30:54 | source-occurrence 迁移与共享 runner：2 文件、26 通过、0 跳过，包含下述 B1-06／29。 |
| 最终变更证据回归，11:37:39 | JSON 流程、source-occurrence 迁移、共享 runner、两份比较贡献：5 文件、51 通过／0 失败／0 跳过，32.56 秒，包含父端最后补充的实际文件 current 指针隔离断言。 |
| 静态门禁 | build 与 Node TypeScript 通过；仍有 Node 模块浏览器外置／大 chunk 警告。lint `--quiet` 零错误，不代表零警告；contract freshness、UI ratchet 通过。相对已接受 main 的完整边界检查为 3513 项／3513 项已批准，未批准、stale、metadata、growth 均零；未改 allowance。补充证据后的最终门禁另记。 |

不得把有重叠的选择性运行相加，包装成一次不存在的全绿运行。大集合失败只隔离核实一次，未反复全量重跑。

### live schema 指纹差异说明

在新临时库使用原迁移 runner 比较六类原生清单：关系、列、约束、索引、触发器、函数。原归档 0151 加 0152 得到 `49bef3f5ef76c8a233c9d67de5f2b716bf9e509f1fc1e336166cd3155ecea38d`；修订 0151 加 0152 得到 `55bc44246fe7372769e9503ef5db3d2de424d3d4e4103d004ca1b311eef43c05`；现行 0153 得到 `7976ce24cb2bcccfeab4e0f33caa51eb298e26849991fe0e28afc66df29a9649`。

恰好十项变化解释该差异：R1 的 pin locator 约束、observation owner 函数、canonical DTS locator 函数；0153 的 replacement occurrence 约束、root digest 约束、replacement owner 函数／触发器、occurrence identity 函数及两个 current-binding resolver。没有额外关系／列／索引变化。两路评审均接受此 live 测试基线校正；它不是新 seal、历史 checksum 别名或 0137 冻结值替代。

### 补充矩阵证据

- **B1-06：** 在相同租户／项目／文件／配置集创建第二个合法 occurrence，伪造 observation 和 match 指向它，同时保留既有 subject／Definition。owner／复合 FK 拒绝后，两个合法迁移 match 保留，探测 observation 回滚。首次测试因 exact-replay 唯一键先拒绝，已用不同 matcher revision 和必需 locator digest 修正夹具；这是夹具失败，不是生产 Red。
- **B1-29：** populated 0151 SQL 全部执行后、receipt／commit 前，只断开测试自建 runner 连接。独立观察者确认新表／列／receipt 不存在，旧 Binding／observation 完全不变。新连接恰好应用 0151–0153 一次，重试无待执行项；换成仅包含至 0150 的旧文件清单被拒绝，receipt／Binding 不变。这证明回滚／重连恢复及降级清单拒绝，不是破坏性 down migration 或部署恢复演练。
- **B1-03：** 同 Definition 在三个文件、两个配置集形成三个不同 Binding／occurrence。修改 target 会推进同配置集 sibling 的 pin／revision，但保留 sibling 业务值和文件版本；另一配置集的值、pin、revision、实际文件 current 记录及真实存储快照均完全不变。JSON suite 17/17 后，最终合并回归为上述 51/51。这是覆盖补充，不宣称生产修复的 Red→Green。

独立有界证据复审接受 B1-03、B1-06 及 B1-29 的回滚／重连／旧清单拒绝核心。新增中断用例没有单独调用旧 DTS resolver；resolver 兼容性仍由既有迁移测试承担。角色／HTTP 证据与本次数据库 ownership 用例分开。父端在复审后补实际文件 current 读回，并重跑全部变更证据。

## 前轮 HTTP 与单 PC 证据（R5／R6 修复前）

helper 临时运行时使用真实本地密码鉴权、数据库角色、真实 API、原生 PostgreSQL 与本地 ObjectStore。夹具 Catalog 安装／注册仅为环境准备，不是生产发布管理器或最终种子验收。前端 `http://127.0.0.1:5174`，API `http://127.0.0.1:58425`；路由 `/parameters?project=aurora`、`/parameter-review?project=aurora`，**仅 PC 1440×900**。两页最终 document 宽度均 1440；已查看截图，未见横向溢出或控件重叠。

HTTP 闭环断言 DTS `<1000>` → `<1250>`、JSON `36.5` → `45.625`；真草稿不改 current、提交／固定 diff、自审 403、独立审核、重复 apply 无变化、历史导出不变、新旧精确重导入及历史 diff 不变。请求为 `pvcr_b882f4a6-8ac0-4629-b391-2b6b9f80dca3`、`pvcr_6f4e2ca8-7f3a-47d6-9fad-de45f3ed660b`。HTTP 脚本断言执行完成，但其 shell 包装后续未引用 CLI URL 导致 glob 错误，因此不把整个包装命令记录成退出码零。

独立作者／审核人浏览器随后执行：非法 JSON 校验 400、修正后创建草稿并立即进入 tray、提交、自动固定差异、键盘批准、刷新读到 `46.875`；DTS 编辑／tray／提交／批准后刷新读到 `<1300>`，JSON 仍为 `46.875`。浏览器请求为 JSON `pvcr_a37a099f-5c24-47c7-8f46-d6c3ef86ed76`、DTS `pvcr_111157ff-f426-44da-9bb8-3b43ae71581e`，批准均返回 200。snapshot／截图在本地 `work/ui-checks/t11-accept-{json-error,json-review,dts-draft,dts-review,current}.png` 与 `.playwright-cli/`，属于 gitignored 本地产物，不是已提交证据。

最终刷新后两会话 console error 为零，各有两条既有 CopilotKit 许可警告。此前未登录 `/me` 的 401 与刻意非法 JSON 的 400 保留记录，未观察到 5xx；未读取敏感请求头或 token。两浏览器会话已关闭；仅向本任务 runtime PID 发送 SIGTERM，确认回收数据库 `wiseeff_acceptance_disposable_t11_pc_mu4y5g9b_4e7f707c`；只读数据库清单和端口检查确认临时库与两个监听均消失。这是本地证据，不是 Hosted、目标环境、S1／S2 或发布验收。

## 前轮评审意见与已遵守的设计停止门禁（历史）

以下记录用户再次授权前的检查点；其中未完成／停止字样属于历史状态，当前处置以上文最终续轮为准。

两路整体验收评审及有界证据子智能体均为 GPT-5.6-Luna／`max`；实现者不自审。审查有明确预算，不宣称已穷尽大规模 dirty candidate 的每一行。

**Standards：** live 指纹问题已修复验证。原 current-release 竞态意见已撤回：已捕获的 immutable Catalog snapshot 可以继续使用其固定 release。**仍有一项确认 P1：** `binding/migrationAdapter.ts` 使用 `JSON.stringify(locator)` 计算摘要，正式 pin 使用 `serializeContract(locator)`；测试夹具同样采用错误计算，掩盖了合法 canonical proof 被拒绝的问题。固定五键只读向量给出 adapter `sha256:de386a8fc1fc63cad6be4d3485563790a0a33b965b1d6f3d39c48fce6e018af8`，canonical `sha256:1b9ad36da413ad4a105de8eedaece29006c15816b74ce8628e8d7b9d03f3dea4`。

**Spec：** 跟踪完整校验 bytes 在同一事务重新解析的流程后，撤回原 sibling value P1。原 dangling overlay P1 未提供当前 canonical-bound 可触发反例，通用 ingest 的宽松行为本身不足以证明 canonical 路径漏洞；畸形历史 pin 仍作为 B1-16 残余边界记录，不宣称已复现缺陷。其明确剩余项为上述 B1-03／06／29 证据缺口；证据复审后才能给 PASS。

**R6——主智能体补充且独立确认的 P1，不是已撤回的 stale-release 意见：** sync 新增自持事务先占用 pool 连接，然后 `loadPublishedCatalog(pool)` 从同池另取连接。在 fresh 原生库使用 `max:1, connectionTimeoutMillis:300`，单独加载空 Catalog 返回 `null`，sync 却报 `timeout exceeded when trying to connect`，未按预期返回零。测试 pool 关闭、helper 回收；Standards 确认连接池饥饿／事务生命周期问题，调用方已持事务和满池并发同样受影响。本轮未修生产代码。

同一来源证明／canonical digest 不变量再次出现 P1，触发交付协议 Step 5：**停止常规补丁，退回威胁矩阵／设计复审。** 不允许静默延期 adapter 或放宽证明。既有授权覆盖 R1–R4，不代表已接受新的事务接口。本轮未修改生产运行时或迁移；仅改验收测试、live 测试指纹和中英证据。

下一份有界设计任务包须包含：（1）**R5**，adapter 复用 canonical serializer，夹具独立推导，继续拒绝非规范输入，不重写旧 pin／receipt；（2）**R6**，在事务外准备 immutable snapshot，传入现有事务内 sync 操作，并一致调整 direct-pool、HTTP、seed 调用方，避免二次取连接、伪装 Pool、嵌套 BEGIN／COMMIT；（3）原生正反例、单连接／调用方事务／满池并发验证；（4）生产修改前独立 Standards／Spec 设计复审，随后受影响回归与最终验收。snapshot 准备保留原 release 语义，不添加凭空要求的 latest-release 限制。本检查点不授权该修复、不扩展 Catalog 行为、不重签 relocation allowance、不启动 T1.2。

## Documentation Impact Matrix

| 区域 | 处置 |
| --- | --- |
| 计划与证据 | 新增本中英检查点，更新 todolist／威胁矩阵现状，由修复回执链接。 |
| 运行时／数据库／API／安全 | 已授权 R5 adapter 摘要修复及 R6 事务拥有权拆分，适配 HTTP／seed 调用方。不扩展 schema、公开 API 或权限；前轮证据保留独立范围。 |
| 测试／生成产物 | 两项迁移测试及跨配置集 JSON 证据；一项已解释 live 指纹校正。不改历史冻结值、已应用迁移、allowance 或 SQL schema 生成结果。 |

## Documentation Update Gate

前轮补充证据门禁通过 Node TypeScript、边界（3513/3513 已批准）、`t11acceptdocs` 原生 `docs:check` 和 diff 检查，当时正确地未关闭 R5／R6。上文另获授权的最终续轮关闭两项问题，完成 T1.1 本地验收／封板准备。中英回执与 todolist 同步更新；最终文档治理和 diff 检查覆盖这些编辑。不宣称 commit、正式 SEALED、PR、合并、Issue 关闭或下一 todo 已启动。
