# 参数 Catalog Review 修复方案

> English: [English](../../../exec-plans/active/2026-09-05-parameter-catalog-review-remediation.md)

状态：**Active**。本文是待实施方案，不是修复完成报告、测试通过证明或生产发布批准。复核基线 `54815cdce5dd21d3d96587f0e52cc0f4faae9dd6`（tree `d5acc28a00ecebeb014040c53cd32fe1d4c72780`）。GitHub 工作包：#802（程序）、#803（OP-01）、#804（OP-02）、#805（OP-03）、#806（OP-04）、#807（OP-05）、#808（OP-06）、#809（OP-07）、#810（OP-08）、#811（OP-09）。Scratch 分支从 `main` 拉出；实现智能体不得打开或合并 PR。OP-09 在没有明确人工授权前不得执行目标机 cutover、恢复、清理或流量切换。

## 文档控制

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0 |
| 编制日期 | 2026-09-05，UTC+08:00 |
| 适用仓库 | `tzrea1-Q/WiseEff` |
| 复核基线 | `54815cdce5dd21d3d96587f0e52cc0f4faae9dd6` |
| 基线 Git tree | `d5acc28a00ecebeb014040c53cd32fe1d4c72780` |
| 工作来源 | 本轮参数 Catalog 代码 Review 的 F1–F7，以及生产页面和发布集成的已知缺口 |
| 文档性质 | 待实施方案，不是修复完成报告、测试通过证明或生产发布批准 |
| 中文计划 | `docs/zh-CN/exec-plans/active/2026-09-05-parameter-catalog-review-remediation.md` |
| 英文配套 | `docs/exec-plans/active/2026-09-05-parameter-catalog-review-remediation.md` |
| GitHub 程序 Issue | #802 |
| 工作包 Issues | #803–#811 |

2026-09-05 再次读取主分支时，其提交仍为上述基线。本方案结合固定提交的源代码、既有接口与仓库规范制定；没有在本轮执行本地构建、真实 PostgreSQL 测试、浏览器测试或目标机操作。正文中“必须通过”“预期结果”均为验收要求，不表示已经执行。[S01] [S02]

本文中的 `OP-00` 至 `OP-09` 是实施工作包编号，已映射到 GitHub Issues #802–#811。`CATFIX-*` 仍是本方案的回归用例标识，**不是新分配的 PCAT 验收 ID**；浏览器验收继续使用现有 PCAT-UI 编号。

---

## 0. 执行摘要

本轮不推翻现有领域模型，不重写参数管理，也不重新发明发布治理体系。保留正式 Subject、Parameter Definition、不可变 Revision、Catalog Release、组织 Registration/Placement、Observation、Proposal、Binding 和 Project Value 的分离，修复这些模型在运行时、HTTP 接线和用户界面上的断点。

**交付目标：一个具有可信身份、正确发布快照、真实查询投影、正确提案状态机、可用页面和完整发布证据的参数 Catalog。**

本轮完成必须同时满足三个层次：

1. **缺陷关闭：** F1–F7 均有失败用例、修复实现和回归证据，不能只靠代码评语关闭。
2. **集成闭环：** 真实入口完成“认证 → API → 领域服务 → PostgreSQL → 查询 → 页面”链路，生产装配不再使用假空数据。
3. **发布闭环：** 按原有 Wayfinder/#735 门槛完成目标环境证据和授权；合并代码不等于授权切换生产流量。

F1 优先单独修复。F2/F3/F5 属于同一个 Kernel 读取改造主线，应由同一负责人统筹。F4 和 F6 可以在目录边界明确后并行实现，最终由 API 集成负责人接入。F7 在 Kernel 读取公共结构稳定后合并。页面挂载和发布放在后面，不能用“页面未挂载”作为后端接口暂时不安全的理由。

### 0.1 本轮明确不做

不恢复组织结构 Schema 覆盖，不引入长期双写，不通过放松数据库约束使测试通过，不重排已应用迁移，不批量合并同名参数，不重写 DTS 调试或 Agent 内部逻辑，也不顺带升级依赖、迁移前端框架或重做视觉设计。

性能工作以消除连接池嵌套获取和建立实测基线为界。Redis、分布式缓存、大规模 CQRS 拆分、独立 Catalog 微服务均不是本轮必需项。

---

## 1. 问题清单、证据与优先级

| Review ID | 已核对的实现问题 | 主要入口 | 本轮优先级 | 关闭工作包 |
|---|---|---|---|---|
| F1 | Catalog 路由绕过统一认证解析器，调用读取开发用户头的 helper | `server/app.ts` | P1；已部署可达时优先应急处理 | OP-01 |
| F2 | 按 revision 创建 release 查询，漏掉当前 head 沿用的前序 revision；历史集合也不完整 | `catalog-kernel/runtime/currentSnapshot.ts` | P1 | OP-02 |
| F3 | 外层持有 pool client 时，投影加载又从同一 pool 申请 client | 同上 | P1 | OP-02 |
| F4 | 真实生产装配仍使用未注册、零使用量和空治理查询实现 | `parameter-catalog-api/productionWire.ts` | P1 | OP-04、OP-06 |
| F5 | 历史 release ID 与当前 release digest 错误拼接，元数据也存在占位值 | 同上，及 Kernel release 元数据读取 | P1 | OP-02、OP-06 |
| F6 | 已有 proposal ID 被作为 definition revision ID；“提交已有提案”错误进入新建逻辑 | `governance/handlers.ts`、`proposals/` | P1 | OP-05、OP-06 |
| F7 | Driver alias 匹配没有完整检查 alias 生命周期；NodeType alias 没有参加匹配 | `runtime/currentSnapshot.ts` | 原 Review P2；本轮启用前一并修复 | OP-03 |
| INT-01 | 新页面未接入现行路由，浏览器验收有无条件 skip 和仅导航占位 | `src/app/routes.tsx`、三份 Catalog acceptance spec | 发布阻断项 | OP-07、OP-08 |
| INT-02 | 核心实现合并与真实目标上的发布证据仍是两件事 | #735 及 release-gate 工作流 | 发布阻断项 | OP-09 |

F1 的证据是根路由接线及 helper 行为，不是已发生越权事件的证明；部署可达性、历史调用和影响范围应另行调查。[S03]

F2 的触发数据是合法的：安装器遇到已有 revision 会复用它，release head 可以指向前序 revision，而读取器只查本 release 创建的 revision。[S04] [S05]

F3 应准确描述为**应用层连接池资源等待／饥饿风险**，不应误称已经观察到 PostgreSQL 行锁死锁。`max=1` 且 current release 已安装时是最小确定性测试条件；较大池中的并发重现要用屏障控制调度。[S04] [E01]

F4、F5 的问题发生在真实 pool 分支，不只是无数据库的测试 fallback。[S06] [S07] [S08] [S09]

F6 不应仅做 ID 替换：共享状态注册表已有 `draft/submitted`，mock adapter 已实现“创建 draft，再提交同一对象”，但后端 `submit` 命令是新建入口。这要求领域命令、HTTP 和 mock 三方对齐。[S10] [S11] [S12] [S13] [S22]

上一轮 CI 状态只作为历史调查线索。本文不将它继承为新候选的通过或失败结论；执行时必须重新核对候选 SHA、工作流事件、尝试次数、必跑 job 及实际测试结果。

---

## 2. 修复后必须成立的领域与安全不变式

| 编号 | 不变式 |
|---|---|
| INV-01 | production 身份只能来自已配置的认证解析器；请求头或请求体中的用户、组织、角色不能自行成为可信上下文。 |
| INV-02 | 一个读取操作只捕获一个 Catalog release identity；内容、响应头、cursor 和 revision 可见性不能混用不同 release。 |
| INV-03 | selected revision 必须精确等于该 release 的 head 所指 revision，不得按最高版本、当前全局 head 或第一个匹配项代替。 |
| INV-04 | pinned 历史只包含目标 release 及其祖先链内可见的内容；不得漏掉祖先，也不得读取未来或另一分支。 |
| INV-05 | 缺少必要投影、materialization 或 head 是错误，不得转为空列表、全零 fingerprint、epoch 时间或虚构 revision。 |
| INV-06 | 每次 Kernel 读取在当前事务作用域内只拥有一个数据库连接；下层 helper 不再从 pool 嵌套申请。 |
| INV-07 | Catalog 结构内容只能通过既有发布／安装边界变更；组织治理命令和 Proposal 接受不能直接改正式 Definition。 |
| INV-08 | Registration/Placement、Observation、Proposal、使用量的查询有真实数据来源，且遵守调用者组织与项目范围。 |
| INV-09 | Proposal ID、Proposal Revision ID、Definition Revision ID 不可互换；提交已有草稿不得创建另一个 Proposal。 |
| INV-10 | 条件写入和幂等性在事务内成立；失败不留下业务半状态、重复 publication intent 或成功审计。 |
| INV-11 | alias 生命周期和 Subject 生命周期都参与匹配；退役 selector 不得降级成有效 fallback 匹配。 |
| INV-12 | 文档-only revision 不自动搬动既有 Binding/ProjectValue 的 pin；历史业务引用继续保留原身份和内容。 |
| INV-13 | mock 与 API 拥有同样的操作权限、状态转换和错误语义；mock 不能多出生产并不支持的治理能力。 |
| INV-14 | CatalogPage 必须从实际应用入口可达；测试 marker、页面文件存在或 warmup 成功都不是浏览器验收证据。 |
| INV-15 | 代码合并、局部测试、Hosted、目标机证据及生产授权分别记录，不互相替代。 |

这些不变式是修复验收要求；不表示当前代码已全部满足。领域方向和证据边界延续既有 #668/#735 约定。[S16] [S19]

---

## 3. 开工前统一的实施决策

### 3.1 认证只保留一个生产入口

根路由将已构造的统一 `authResolver` 传给 Catalog API。开发 helper 仅通过认证解析器的 development 分支调用，不允许 Catalog 特判直达。补删伪造头只能是纵深防御，不能代替身份认证。

认证成功后仍做业务权限、组织归属、对象范围和 Agent 只读校验。合法用户 A 的请求携带用户 B 的头，不得改变 principal；已认证但越权的请求按既有 403 或 scope-hidden 404 规则处理，而不是一律变成 401。

### 3.2 Kernel 统一持有连接和读取事务

公共加载操作负责 acquire、begin、commit/rollback、release；私有投影函数接收现有 client/queryable。推荐将一次多查询投影构造放在**短生命周期、只读的 Repeatable Read 事务**中，避免多个查询观察到不同数据库时点。PostgreSQL 的 Read Committed 与 Repeatable Read 可见性不同，应通过真实并发测试验证所选择的实现。[E01] [E02]

“current”指操作捕获时的 current pointer，不表示返回响应之后它永远不会变化。捕获后所有读取坚持同一 release；写入必须再经过既有事务内 current-release guard，不得把读快照当成长期写授权。

是否保留既有短事务共享 pointer 锁，以已冻结的 Kernel 锁协议为准；不引入新的反向锁顺序。严禁在持有该事务时等待网络、对象存储、浏览器确认或人工审批。

### 3.3 当前 head 解析与历史集合分开实现

当前定义通过 release head 精确加载选中的 revision。历史集合通过目标 release 的 predecessor 链界定可见范围，再按定义归属和显式排序构造。

不得用 `revision.catalog_release_id = targetId` 代替沿用语义；不得用 `release_sequence <= targetSequence` 代替祖先关系；不得从整个数据库选最大 revision 代替目标 head。

### 3.4 release 元数据仍归 Kernel 所有

HTTP 层不新增散落的 Catalog SQL join。由 Kernel 现有公共读边界提供目标 release 的真实 identity、序列、发布时间、安装时间和 materialization fingerprint；若现有公开投影不足，做最小显式契约补充并同步消费者。

**release digest、compiled fingerprint、database/materialization fingerprint 是不同证据，不能相互代填。** 历史 ID 查询先解析该 ID 对应的权威 pin，再加载 pinned snapshot；外部已提供 expected digest 时，必须验证它而不是忽略。

### 3.5 不把“未接线”伪装成“业务为空”

已启用 Catalog 的生产构造器必须显式接收完整读写依赖。缺少内部必须依赖属于配置错误；依赖齐备但尚无已批准 release 属于 Catalog not-ready。两者都不返回成功空数据。

隔离验证部署可以启动诊断进程并使 Catalog readiness 为 false，但不得据此宣称可接流量。不要把 Catalog not-ready 机械地变成整个进程的 liveness 失败，造成重启循环。

### 3.6 区分两个时间维度

Catalog 内容是 release-pinned 的不可变内容；Registration、Placement、review 数量和 usage 可能是请求时刻的组织业务状态。历史 Catalog 页不能把今天的使用量冒充某个历史 release 发布时的使用量。

沿用现有 API 契约的时间语义；没有历史组织状态证据的字段明确作为当前投影呈现。若产品需要新增历史组织状态查询，另行扩展契约，不在本轮伪造或隐式回填。

### 3.7 Proposal 以“创建草稿，提交同一对象”为目标

以现有共享状态和 mock 交互为依据，对齐后端：Create 创建 draft；Submit 对已有 draft 做受 ETag 保护的原位转换；Accept 只产生 publication intent。不要把修复简化为 Create 与 Submit 都调用“新建并提交”。[S10] [S12]

既有内部“新建并提交”调用者必须盘点。可以保留一个语义明确的内部原子组合入口，但它不得继续承接外部 `/proposals/:id/submit`，也不得跨两个事务留下半成品。

### 3.8 文件负责人和契约变更先登记

`server/app.ts` 由 OP-01 所有；Kernel `interface.ts/runtime/*` 由 OP-02 主责，OP-03 后续顺序修改；`productionWire.ts`、API handler、DTO 契约和治理端口集中由 OP-06 集成。OP-04、OP-05 优先在各自领域目录实现并冻结可消费接口。

原 Wayfinder 的路径归属、冻结契约或 ratchet 若阻止必要修复，由父集成负责人登记一次有范围的修订后再改。**不以批量放宽 allow-list、更新历史证据哈希或删除边界检查规避限制。**[S02] [S17]

---

## 4. 工作包、依赖与合并顺序

| 工作包 | Issue | 交付物 | 依赖与顺序 | 主要负责人 |
|---|---|---|---|---|
| OP-00 | #802 | 基线、威胁范围、文件归属、复现夹具合同、证据清单 | 首先；不得拖延 F1 小范围安全修复 | 集成负责人 |
| OP-01 | #803 | 统一认证接线及根路由安全回归 | 完成最小基线核对后独立优先合并 | 安全／后端 |
| OP-02 | #804 | 单连接快照、正确 lineage/head、真实 release 元数据 | OP-00；可与 OP-04/05 并行 | Catalog Kernel |
| OP-03 | #805 | Driver/NodeType alias 匹配与生命周期语义 | OP-02 稳定后；同文件顺序合并 | Catalog Kernel |
| OP-04 | #806 | 真实治理查询、注册投影及使用量公共读能力 | OP-00；实现可并行，集成依赖 Kernel 合同 | Governance／Binding |
| OP-05 | #807 | Proposal 原位状态机、并发、幂等、审计 | OP-00；与 OP-04 不得同时改同一文件 | Governance |
| OP-06 | #808 | 生产 composition root 和 HTTP 语义完整接入 | OP-01/02/03/04/05 | API 集成 |
| OP-07 | #809 | 新页面真实挂载、状态和深链接、API/mock 对齐 | OP-06；组件准备可提前 | 前端 |
| OP-08 | #810 | 跨模块回归、浏览器真实断言、容量基线、CI 证据 | 测试编写贯穿各包，最终验收在 OP-07 后 | 质量／集成 |
| OP-09 | #811 | 目标机预演、发布目的报告、授权及恢复验证 | OP-08 和原 #735 的其他真实门槛；无人工授权不得执行 | 发布负责人 |

每包已有明确目标的 Issue（#803–#811），按同一工作包保留有限 PR。没有必要复制原来全部 53 个任务或重新设计复杂依赖图。

每个 PR 都应可以独立说明“修了什么、没有改什么、哪条反例现在被阻止”。有必要的跨包类型迁移由集成负责人统一承接，不强迫生产入口在中间态暴露半套能力。

---

## 5. OP-00：基线与测试条件准备

### 5.1 基线记录

记录源码 SHA/tree、锁文件哈希、真实 Node/npm/PostgreSQL/pgvector 版本、已应用 migration ledger、运行模式、认证 provider、Catalog 安装状态，以及新接口是否在目标部署可达。禁止把密码、token、Cookie、数据库 URL 明文放入文档或 CI 附件。

工作区不干净时先记录并保留用户改动，使用隔离分支/worktree；不使用 `reset --hard`、全目录覆盖或清库作为方便的起点。实际开工 SHA 变化时，按 F1–F7 的函数和行为重新核对，关闭已经被真正修复的项，而不是盲目重做。

### 5.2 夹具必须经过生产安装器

复用 `server/testing/parameterCatalog/` 的真实 PostgreSQL 测试基础设施，在隔离数据库中以合法 bundle 安装多 release 链。fixture 工厂可以构造输入，但不得用测试专用 SQL 直接伪造“已安装完成”的正常状态。[S20]

对故意破坏投影的负向测试，只有在专用一次性数据库中才允许使用高权限注入；单独标记为损坏注入，不将其角色或写法当作生产路径。

### 5.3 证据与责任

为每个工作包建立“问题 → 反例 → 文件 → 测试 → 证据 → PR”映射。模块测试作者不能只给自己的端口注入总是成功的对象；至少一个高层测试由集成负责人复核其入口是否真实。

本包默认不改数据库 Schema。必要的合同修订、路径写入授权和新测试文件登记是实施准备，不等于允许目标部署变更。

---

## 6. OP-01：修复生产认证接线（F1）

### 6.1 影响范围

现有主修改点：`server/app.ts`。核对点：`server/modules/auth/contextFactory.ts`、`server/modules/parameter-catalog-api/productionWire.ts` 中的认证适配、read/governance/legacy 的权限和异常映射。

建议新增测试文件：`server/parameterCatalogAuth.integration.test.ts`。这是拟新增路径；若仓库已有等价的根路由认证测试，应直接扩展现有文件，避免双重维护。

### 6.2 实施步骤

**第一步：先复现。** 用 `buildWiseEffRouter()` 的 production 模式构造真实根路由，并通过正式 HTTP/server 测试适配执行请求。至少覆盖一个 Catalog 读接口、一个治理写接口和一个 legacy 读接口。

**第二步：改入口。** 将 Catalog API 接入统一 `authResolver`，删除其对开发 helper 的直接引用。保留 development 模式的合法本地调试能力，但不得让 production 通过无凭据 fallback 继承开发身份。

**第三步：查旁路。** 核对所有调用 `registerParameterCatalogApi()` 的入口，特别是 release evidence driver、独立测试服务器和自托管启动路径，避免有的入口已修、有的入口仍自行构造可信身份。

**第四步：保留授权层。** 认证后检查业务权限、组织范围和对象所有权；Agent read-only 不因修复而获得治理写权。角色不能在适配器中为通过校验而硬编码成管理员。

**第五步：安全处置。** 若问题版本已暴露，发布负责人先评估隔离相关入口或发布小范围认证修复。需要保全访问／审计证据并确定是否有异常调用；只有有泄露证据或既有响应流程要求时才按流程轮换凭据，不凭静态缺陷推断已遭入侵。

### 6.3 验收矩阵

| 用例 ID | 输入／场景 | 必须成立的结果 |
|---|---|---|
| CATFIX-AUTH-01 | production，无凭据，无用户头 | 401；不能进入领域写入 |
| CATFIX-AUTH-02 | production，无凭据，携带开发用户头 | 仍为 401；principal 不被构造 |
| CATFIX-AUTH-03 | 无效／过期／撤销凭据，加任意身份头 | 401，不回退到开发身份 |
| CATFIX-AUTH-04 | 合法用户 A 凭据，加用户 B 或组织 B 的伪造字段 | 只保留 A 的身份；越权操作按既有契约拒绝 |
| CATFIX-AUTH-05 | 已认证但无参数权限 | 403 或既有 scope-hidden 404；不得误报成功空列表 |
| CATFIX-AUTH-06 | 同组织只读用户与 Agent 发治理写请求 | 拒绝；无业务写入和成功审计 |
| CATFIX-AUTH-07 | 开发模式合法调试请求 | 调试功能仍可用；明确不能作为 production 证据 |
| CATFIX-AUTH-08 | 当前实际支持的 local session 与 token/verifier 模式 | 两类入口都遵循对应正式认证链；不新造 provider |
| CATFIX-AUTH-09 | 拒绝请求后的数据库和审计 | 业务表未变；拒绝审计按既有策略记录，不含凭据 |

### 6.4 关闭条件

根入口负向测试从红到绿；Catalog 的三个路由族均验证；业务权限和拒绝审计未退化；没有以“前端按钮隐藏”或代理临时删头作为唯一修复。

## 7. OP-02：统一快照读取、连接管理与发布元数据（F2/F3/F5）

### 7.1 影响范围

主要文件为 `server/modules/catalog-kernel/runtime/currentSnapshot.ts`、`runtime/pinnedSnapshot.ts`、`runtime/cursors.ts`、`catalog-kernel/interface.ts`；安装器仅作为夹具入口和验证对象，不应为适配读取错误而改成“每次发布复制所有 revision”。

扩展现有 `currentSnapshot.test.ts`、`pinnedSnapshot.test.ts`；建议新增 `runtime/releaseLineage.integration.test.ts` 与 `runtime/poolLifecycle.integration.test.ts`，或并入现有等价测试。

### 7.2 连接生命周期改造

公共读操作在最外层一次 acquire。`loadProjection` 及其拆出的查询函数只接收现有 client，既不持有 pool，也不自行 commit 或 release。调用方向为：公开读取操作 → 事务作用域 → 权威 release 解析 → 同连接投影查询 → DTO/快照构造 → 事务结束 → 连接释放。

包括连接建立、begin、查询、结果构造、commit 在内的失败都要有明确释放行为。rollback 失败或连接已经不可用时不能把坏连接当正常连接返回池；按 node-postgres 支持的生命周期接口销毁。返回稳定的存储／不可用错误，不能泄露 SQL 参数或数据库凭据。[E01]

读操作禁止顺手进行安装、迁移、数据修复或补默认记录。短只读事务结束后再做与数据库无关的高成本处理；不要为响应组装长时间占用连接。

### 7.3 release 解析与历史集合

读取输入分为 current expected pin、已知完整 pinned pin、仅有历史 release ID 的解析请求。三者共用内部投影构造，但保持不同的验证条件。

对于 current：一次捕获 pointer 及其权威 identity，核对 expected pin，接下来坚持该 release。对于 pinned：查该 ID 的真实 digest，并与调用者 pin 比较。对于仅有 ID：在 Kernel 内得到权威 pin 后再构造 pinned snapshot，不能使用 current digest。

历史读取建立目标 release 的 predecessor 闭包。应检测缺失 predecessor、循环、重复身份和越界 revision；哪怕数据库约束通常已经阻止这些状态，读取也不能在损坏注入时产生貌似正确的快照。

定义 head 查询精确读取 `(release_id, definition_id, revision_id)`，并验证 revision 归属。历史列表读取闭包内、属于相应 definition 的 revision。相同 revision 被多个 release 沿用时只保留一个 revision 身份；发布事件与 revision 列表不混为同一概念。

禁止保留“找不到 exact revision 就找同定义任一 revision”的 fallback，也不允许把 `selectedRevision` 做成可空后让调用者四处自行补救。必要关系缺失时由 Kernel 返回封闭错误，API 将其映射为既有 release-drift／不可用结果。

### 7.4 时间线与内容变化分类

校正时间线时，以可见 predecessor revision 计算前后关系，并区分 introduced、content、documentation、lifecycle。不要继续仅凭 `revisionNumber === 1` 决定 introduced，或把所有后续 revision 都标成 content。

同一 revision 只是被后续 release 沿用，不应制造新的内容修订事件；若现有产品同时显示 release publication 事实，使用其独立事实类型，不能伪造 revision。文档-only revision 的识别应基于契约规定的字段集合；schema、unit、matching 等内容变化不能被误归到 documentation。

### 7.5 真实元数据与不可变快照

实际返回 ID、digest、release sequence、published time、materialized time 和对应 fingerprint。缺少 materialization 时不补全零哈希；缺少时间时不补 epoch；不要将 digest 当作 materialization fingerprint。

构造后的快照不泄露可变内部集合。现有 shallow freeze 是否足够应通过外部可观察测试判断：调用者改动返回的嵌套 schema/数组，不能改变同一快照的下一次读取或污染共享缓存。实现可选择必要的深冻结或防御性拷贝，不预设大型不可变数据框架。

只对不可变 Catalog 结构考虑按 release ID+digest 缓存；组织投影不进入全局结构缓存。并发首次加载可合并请求，但失败结果不能永久缓存，也不能持有连接等待其他同池加载。未证明瓶颈前不要求新增缓存系统。

### 7.6 验收矩阵

| 用例 ID | 场景 | 必须成立的结果 |
|---|---|---|
| CATFIX-SNAP-01 | A 有 X/r1；B 不改 X | B 的 selected revision 仍是 X/r1，内容完整 |
| CATFIX-SNAP-02 | B 只改 Y | X 沿用、Y 切换，各 head 精确正确 |
| CATFIX-SNAP-03 | C 对 X 做文档-only revision | C 选中新 revision；旧 Binding/Value 的 pin 和行数不自动变更 |
| CATFIX-SNAP-04 | 当前为 C，读取 pinned A/B | 不出现 C 的内容；A/B 的合法旧 revision 均可见 |
| CATFIX-SNAP-05 | 同一 revision 多 release 沿用 | 历史去重，排序稳定，无伪造重复修订 |
| CATFIX-SNAP-06 | 历史页分页、cursor 重用／篡改 | 同查询可连续分页；跨 release 或 query 的 cursor 被拒绝 |
| CATFIX-SNAP-07 | 仅给历史 ID A，当前为 B | Kernel 解析 A 的真实 digest；API 层不借用 B 的 digest |
| CATFIX-SNAP-08 | 正确 ID、错误 expected digest | 明确冲突／拒绝，不能偷偷更换 pin |
| CATFIX-SNAP-09 | 不存在的 release 与有记录但未 materialize 的 release | 分别保持既有不存在／未就绪语义，不成功补默认值 |
| CATFIX-SNAP-10 | 一次性库注入 head 丢失／revision 不归属 | 明确 drift 或完整性错误，不构造 undefined 内容 |
| CATFIX-SNAP-11 | 非祖先分支或未来 revision | 不进入目标 pinned 历史，不用序列号替代 lineage |
| CATFIX-SNAP-12 | 多次读取和修改返回嵌套对象 | 后续结果不被调用者篡改 |
| CATFIX-SNAP-13 | 读取时并发 pointer advance | 响应全部属于捕获版本或明确拒绝，不能混合两个 release |
| CATFIX-POOL-01 | 已安装 current，pool max=1 | 单个读取在有界测试时间内完成，无第二次 client 等待 |
| CATFIX-POOL-02 | N 个请求、pool max=N，屏障控制并发 | 全部有界完成；结束后 waitingCount=0 |
| CATFIX-POOL-03 | 请求数大于 pool 容量 | 正常排队并最终完成，不形成各持一个连接等待第二个的闭环 |
| CATFIX-POOL-04 | 中间查询／commit 故障注入 | 连接按规则释放或销毁，下一请求可以正常执行 |
| CATFIX-POOL-05 | 授权失败、not-ready、digest mismatch | 均无连接泄漏 |

测试超时用于识别失败，不是解决方案。并发测试优先使用 barrier/latch，不用随机 sleep 作为正确性基础；超时后取消或关闭测试资源，不能留下挂起 Promise 导致整套测试退出不确定。

### 7.7 关闭条件

合法 A→B→C 发布链由真实安装器生成并通过 current/pinned 读取；max=1 与并发资源测试通过；没有复制所有 revision 的变通方案；生产 API 能消费真实 release 元数据。

---

## 8. OP-03：统一 Subject/Alias 识别规则（F7）

### 8.1 实施范围

修改 `CapturedCatalogSnapshot.resolveSubject()` 所在 runtime 文件及直接测试。OP-02 合并后再修改共享文件，避免两个工作包对快照类型和构造方式分别重构。

匹配是纯读取：它不创建 Subject、Definition、Registration 或 Binding。自动注册是否执行，仍由上游正式治理命令决定。

### 8.2 目标算法规则

先对输入使用已有共享 canonical constructor 的约定，不新增 trim、转小写、去 `@` 或模糊匹配。随后根据同一个 snapshot 构造 Driver canonical/alias 候选，以 Subject ID 去重；匹配到同一个 Subject 的多个合法 selector 不是多个 Subject。

有效匹配必须同时满足 Subject membership active，以及采用 alias 时 alias membership active。只有唯一、可证明的有效目标才能返回 matched；多个不同 Subject 命中仍保留 ambiguous，不能按遍历顺序选第一个。

命中明确 retired selector 时保留退役证据，不能当作“完全未知”后转入 NodeType fallback。混合有效和退役证据按现有 MatchResult 契约做确定性封闭处理，不让退役别名凭另一个分支被恢复。确切多候选策略在本包的测试真值表中冻结；默认采用不静默消除冲突的保守策略。

只有 Driver 规则允许 fallback 的情况下，NodeType 才参与。NodeType 同时支持 canonical name 与 alias，并采用相同的归属、生命周期和歧义规则。历史 pinned snapshot 使用那个 release 的 membership，不能读当前 membership 覆盖它。

### 8.3 最小测试集

| 用例 ID | 场景 | 期望 |
|---|---|---|
| CATFIX-MATCH-01 | active Driver canonical | 唯一 matched |
| CATFIX-MATCH-02 | active Driver + active alias | matched，来源可追溯为 alias |
| CATFIX-MATCH-03 | active Driver + retired alias，输入只含退役 alias | 不 matched；保留退役语义，不错误 fallback |
| CATFIX-MATCH-04 | retired Subject | 不新识别；历史身份仍可读 |
| CATFIX-MATCH-05 | active NodeType alias | 正确命中对应 NodeType |
| CATFIX-MATCH-06 | canonical 与 alias 都命中同一 Subject | 去重，不误报 ambiguous；归因确定 |
| CATFIX-MATCH-07 | 输入命中两个不同 Driver | ambiguous，不能静默选一个 |
| CATFIX-MATCH-08 | 当前退役，pinned 旧 release 尚未退役 | 当前拒绝、历史保留原行为 |
| CATFIX-MATCH-09 | 大小写／空格／非法 selector 负向向量 | 沿用共享 constructor 规则，不私自规范化 |
| CATFIX-MATCH-10 | 未知或歧义观察进入治理流程 | 仅产生允许的 Review Evidence，不生成正式定义或有效 Binding |

通过标准是识别结果和下游可观察业务行为同时正确，不只是 resolver 的字符串状态发生变化。

---

## 9. OP-04：实现真实治理查询和业务投影（F4）

### 9.1 模块边界

复用现有领域 repository/query 服务。允许按需要增加小范围公共查询接口，但每种数据仍由其领域拥有：

| 投影 | 权威模块／数据 | 禁止的替代来源 |
|---|---|---|
| Subject/Definition 的组织注册状态 | Governance Registration 与当前 Placement | 固定 unregistered、显示名称猜测 |
| Registration 列表／详情、Placement | Governance 注册／放置记录 | 旧 Effective/Governance 表的隐式 fallback |
| Observation 列表／详情 | Governance Observation/Evidence | 把未知观察当正式定义 |
| Proposal 列表／详情 | Proposal 与其精确 current proposal revision | 静态 fixture、请求体中未持久化的内容 |
| reviewCount | 对应组织、Subject 和允许状态的 Review Queue | 固定零、全组织计数泄露 |
| usageSummary | Binding/Value/Policy 各自公共读边界及受控聚合 | Catalog handler 直接跨域读任意表、把 history 当 current |

如需新增 `server/modules/parameter-governance/queries/` 或 Binding 查询入口，先登记为拟新增路径，保持接口小而明确；不创建一套包办所有领域的通用 repository。

### 9.2 Registration 与 Placement

按组织和稳定 Subject ID 查询注册。active/retired Registration 都保留原 ID 和 Placement ID；恢复不应新建第二个注册或放置。Definition 继承 Subject 当前 Placement，不复制成独立定义位置，移动后读取应反映真实关系。

已存在注册但缺失必要 Placement 是完整性错误，不是 unregistered。显式详情查询不能用空对象代替缺失的持久化关系。

注册方式字段需要明确映射：数据库或领域内部 literal 与 HTTP 的 `explicit/automatic/review` 等词汇不一致时，通过固定映射处理，不直接强制类型转换。

### 9.3 使用量与查询范围

对 projectCount、currentValueCount、policyCount 分别写清去重键、纳入状态、组织范围及时间语义。至少保证：项目数按允许项目去重；当前值只计当前指针对应的值，不把所有历史值相加；不因加入 review 或 alias 表造成 join 扩增。

无注册组织仍可能有权限浏览全局正式 Catalog；不能把“组织注册视图为空”错误实现为“全局 Catalog 不存在”。全局结构列表和组织业务投影必须区分。

平台管理员是否跨组织读取以既有明确授权为准。修复某个组织查询时，不自动扩大为全平台可见。跨组织详情、总数和过滤结果不得泄露对方存在性。

### 9.4 过滤、分页与请求内一致性

范围授权与业务过滤在分页之前生效。注册过滤不得先取一页全量 Catalog 再过滤，否则会出现空页、计数错误和漏项；通过 Kernel 支持的 ID selection 或等价受控接口完成。

避免每行分别查询 Registration、Placement、usage 和 reviewCount。对一页中的 Subject/Definition 批量获取或在请求作用域合并读取；缓存键至少包含组织/授权作用域和相关版本，不能只用 definitionId。

治理数据可变，无法与静态 Catalog 一样天然 release-pinned。涉及多个查询的一次组合响应，在可行范围内用同一读事务观察一致状态；跨领域接口无法共享事务时，明确当前投影语义和容许变化，不声称它是历史强一致快照。

### 9.5 验收矩阵

| 用例 ID | 写入后读取场景 | 期望 |
|---|---|---|
| CATFIX-QUERY-01 | 注册成功后读取 Subject、Definition 与 Registration 详情 | 三处状态、ID 和 Placement 一致 |
| CATFIX-QUERY-02 | 修改 Placement 后读取所有继承定义 | 动态继承生效，无复制记录 |
| CATFIX-QUERY-03 | retire/restore Registration | ID/Placement 保留，状态正确切换 |
| CATFIX-QUERY-04 | 创建 Observation 或 Proposal 后查询 | 列表和详情均可见，不返回假空 |
| CATFIX-QUERY-05 | 已有两个项目和多条历史值 | 项目和 current value 按真值计数，不含历史扩增 |
| CATFIX-QUERY-06 | 组织 A/B 使用同一平台定义 | 各自只看到被授权的业务投影 |
| CATFIX-QUERY-07 | 无注册、无定义、无 Review、过滤无命中 | 四种空原因按所在视图正确区分 |
| CATFIX-QUERY-08 | 查询超时／依赖故障 | typed error，不伪装为 200 空数组或零计数 |
| CATFIX-QUERY-09 | 注册过滤与 cursor 分页组合 | 无漏项、重项、后过滤空页；scope 变化使旧 cursor 失效 |
| CATFIX-QUERY-10 | 25 行和 100 行相同页面场景 | 查询次数不随行数产生无控制线性 N+1；记录实测值 |
| CATFIX-QUERY-11 | 一次性库缺失 required Placement | 完整性错误，不改写成 unregistered |
| CATFIX-QUERY-12 | 请求结束后切换另一个组织读取 | 没有请求间缓存串组织或串权限 |

具体查询数阈值在 OP-08 按集成实现确定；本方案不虚构当前 QPS 或性能数据。

### 9.6 关闭条件

这些测试使用真实领域写入口构造业务状态，随后通过正式查询能力取回；既有组织/项目隔离与数据库角色权限保持不变。不能为读计数方便给 Governance 扩大 Catalog SELECT/DML 权限。

---

## 10. OP-05：修正 Proposal 状态机与幂等行为（F6）

### 10.1 影响范围

主修改目录：`server/modules/parameter-governance/proposals/`，包括 command、service、writer、repositories、result、failures、audit 和测试。共享枚举仅在确有需要时改动；现有五个状态不需要重新发明。

HTTP handler、DTO 和 client 在 OP-06 统一接入。mock adapter 的行为回归在 OP-07/08 联动，不允许先改 mock 让测试迎合错误的后端。

### 10.2 冻结目标状态表

| 操作 | 允许起点 | 终点 | 身份／副作用 |
|---|---|---|---|
| Create | 无 Proposal | draft | 新建一个 Proposal 和初始 Proposal Revision |
| Submit existing | draft | submitted | 沿用 proposalId、base pin 和既有提案内容；按契约推进 ETag |
| Withdraw | draft 或 submitted | withdrawn | 作者权限不变；保持原 ID 和历史 |
| Accept | submitted | accepted | 不同的获授权审核人；创建唯一 Publication Intent，不写正式 Catalog |
| Reject | submitted | rejected | 保留原 ID 和理由，不写正式 Catalog |
| 再次提交已终态对象 | accepted/rejected/withdrawn | 不改变 | typed invalid-transition；不隐式复制或重新打开 |

编辑／rebase 草稿若已有明确公开契约，沿用并纳入测试；若没有，不在本轮扩展成新的编辑产品。后续修改不应伪装成重复 Submit。

### 10.3 命令与身份

新增或明确区分 CreateDraft 与 SubmitExisting 的命令形状。后者至少包含 proposalId、expected ETag、幂等键和可信执行上下文，并从存储加载 base release、base definition revision 和 current proposal revision。它不接受 proposalId 被包装成 DefinitionRevisionId。

所有 base 引用都需验证真实存在、归属和可见性；字符串前缀校验不能替代 referential validation。创建“修改既有定义”的提案时，base definition 与 revision 必须一致。公开契约允许没有现成 definition revision 的新定义提案时，要保留其受控类型分支，不能随手补一个虚假的 ID，也不能在此次修复中静默缩窄已承诺能力。

HTTP Create 的 body 中带有 base release 时，必须验证其与捕获 release 一致；不能忽略用户编辑时的 base 并替换成当前 pin。否则会把过期提案默认为最新提案，绕过 reconfirm。

### 10.4 原子性与并发顺序

在同一事务中完成权限和组织验证、幂等判定、Proposal 加锁或 CAS、ETag 检查、合法状态检查、release guard、业务状态写入、Publication Intent 和成功审计记录。

不得在“检查 ETag”与“更新状态”之间释放锁；同一 ETag 的并发 accept/reject/withdraw 只能有一个真正提交。保持现有全局锁协议，不在本包引入反向锁顺序。

### 10.5 幂等性要求

幂等键作用域至少隔离组织、命令族、操作和目标对象；fingerprint 绑定 payload、base pin、expected ETag 和可信主体等语义要素。完全相同的请求重放不产生新 Proposal、revision、intent 或成功审计。同 key 不同内容返回冲突。

同 key 成功重放不得因对象在首次成功后已经推进版本，先被旧 ETag 校验挡住。另一方面，每次请求仍要重新验证当前身份和权限，不能通过幂等记录读取已失去权限的数据。按既有幂等契约返回先前结果快照或其受控等价结果；不要不加区分地返回对象当前最新状态并声称是原请求结果。

对于“提交响应丢失后重试”，仍使用相同 proposalId 和幂等键。网络重试不能变成新建提案。

### 10.6 历史兼容与最小迁移

先盘点现有调用 `kind: submit` 的消费者，区分“新建并提交”与“提交已有”。内部组合行为可保留为明确适配器，外部接口语义不能继续混淆。

现有 Proposal 已有 draft 状态，但具体数据库默认值和 repositories 的 insert 行为须核对并修改为显式传递状态。**默认先尝试只改应用逻辑，不新增迁移。** 只有持久化结构或约束确有不足，才追加一份独立迁移。

若目标库已经产生疑似错把 proposalId 存为 base revision 的数据，只做只读分类：验证 base 引用是否存在、对应审计和 idempotency 记录是否能唯一证明意图。可证实者形成逐条修复计划；无法证明者保留并隔离等待复核，禁止按 property key、名称或时间接近度猜测合并。

### 10.7 验收矩阵

| 用例 ID | 场景 | 必须成立的结果 |
|---|---|---|
| CATFIX-PROP-01 | Create 后读取 | 一个 draft，base 和内容真实，ID 稳定 |
| CATFIX-PROP-02 | Submit draft | 同一个 proposalId 变为 submitted，不新增 Proposal |
| CATFIX-PROP-03 | 错误 ETag | 冲突，状态、revision、intent、成功审计均无变化 |
| CATFIX-PROP-04 | 同 key 同 payload 重放 | 同一业务结果，无新增副作用 |
| CATFIX-PROP-05 | 同 key 不同 payload／对象／命令 | 冲突或被作用域正确隔离，不能交叉命中 |
| CATFIX-PROP-06 | 提交响应丢失后重试 | 不新建；不被首次提交后的新 ETag 误拒绝 |
| CATFIX-PROP-07 | 两会话同 ETag 并发 accept/reject | 仅一个结果提交，另一个冲突 |
| CATFIX-PROP-08 | 审核人即作者 | 拒绝，不能自审批 |
| CATFIX-PROP-09 | base release 已过期 | proposal-stale；不自动换成 latest pin |
| CATFIX-PROP-10 | Accept 成功 | 恰好一个 Publication Intent；Catalog Definition/Revision/head 未改变 |
| CATFIX-PROP-11 | 更新后、审计前故障注入 | 整体回滚，不留半状态 |
| CATFIX-PROP-12 | 跨组织操作／用户失权后重放 | 拒绝；幂等记录不是授权旁路 |
| CATFIX-PROP-13 | proposalId/definitionRevisionId 对调 | 类型测试和真实引用校验都拒绝 |
| CATFIX-PROP-14 | 已 submitted 的旧数据与内部旧调用者 | 不重复迁移身份，兼容适配语义明确 |
| CATFIX-PROP-15 | 公开契约已有的新定义提案分支 | 不伪造 base revision，也不因修复被静默删除 |

---

## 11. OP-06：完成生产 API 装配及契约一致性（F4/F5/F6 的集成）

### 11.1 集中修改范围

`server/modules/parameter-catalog-api/productionWire.ts`；`read/ports.ts`、`read/types.ts`、相关 DTO/handler；`governance/ports.ts`、`types.ts`、`handlers.ts`；`server/modules/contracts/dtoSchemas/parameterCatalog.ts` 及 route manifest；前端 `parameterCatalogDtos.ts`、`parameterCatalogClient.ts` 的必要合同同步。

生成的 OpenAPI 通过既有脚本生成，不手写修改。已有 paths、错误码、If-Match、Idempotency-Key、release header 和 legacy 行为优先保持；有必要的修订一次性记录，不由下游各写一套解释。

### 11.2 构造矩阵

| 启动条件 | 应有行为 |
|---|---|
| production Catalog 已启用，必须依赖缺失 | 明确配置失败／不能 ready；不能 fallback 到假空实现 |
| 依赖完整，无已安装或无已批准 runtime pin | Catalog not-ready，按既有契约返回不可用和重试提示 |
| 完整依赖与合法 runtime pin | 使用真实 Kernel、Governance、Binding/usage 查询 |
| mock/demo 模式 | 明确使用 mock 适配器，只用于允许的演示／测试边界 |
| 历史 pin 请求 | 读取请求版本的真实元数据和内容，禁止替换为 current |

`unregisteredProjection`、`zeroUsageProjection` 和 `emptyGovernanceQueryPorts` 不再作为真实 pool 的默认依赖。若为测试保留，移动或命名为明确的测试构造，并补 production-import/构造回归防止重新接入。

### 11.3 端到端请求链

读接口走：根认证 → 可信 scope → Kernel release 解析与快照 → 组织范围投影 → DTO → release header/cursor。注册过滤通过被授权的 ID selection 进入 Kernel，handler 不重做 Catalog 结构 join。

治理写接口走：根认证 → 授权 → 严格 DTO → 真实 base/ETag/idempotency 上下文 → 原子领域命令 → 持久化结果 → DTO。不得用空 destination module、固定 driver kind 或硬编码管理员角色代替必须从可信上下文／存储取得的数据；这些现有默认值的真实可达路径必须在集成时验证，不能仅因为通过类型检查就保留。[S06] [S11]

这里将默认字段检查列为**附加集成审查项**：需要端到端用例确认具体失败路径，不把未经执行的新推断提前登记为已复现缺陷。

### 11.4 Kernel 公开边界检查

基线 `createCatalogKernel()` 中安装、switch-back 和验证方法仍有 permission-denied 占位，而独立 installer 已有实现。不能据此断言安装功能完全不存在；应审查维护、验证和运行时各入口实际使用的 capability/factory。[S21]

如公共维护边界未完成装配，在对应角色专用 composition root 内接入；运行时不能因此获得安装权限。不能通过让所有方法共用一个高权限 pool 来消除 permission-denied，也不能将私有 installer import 永久扩散为各消费者的默认做法。

### 11.5 集成验收

至少以真实根路由执行：A/B 两 release 的 current/pinned 读取、注册后再读、Placement 更新、Observation/Proposal 列表与详情、提案完整生命周期、跨组织负向、Agent 写入拒绝、依赖不可用、旧 ID 解析和错误映射。

HTTP 响应必须通过现有 schema 验证；验证不止字段形状，还包含数据真实性：ID 属于相应对象、metadata 对应目标 release、统计与数据库真值一致，拒绝路径不留下写入。

Mock 测试可以证明映射逻辑，但不能替代根认证和真实 PostgreSQL 的生产装配测试。新增一份高层 composition integration test 比让每个端口再增加一组“固定返回成功”的测试更有价值。

## 12. OP-07：挂载真实 CatalogPage 并统一前端行为

### 12.1 影响范围与边界

真正的页面分派点是 `src/app/routes.tsx` 中的 parameter-admin 分支；不能只按旧说明寻找 `App.tsx`。复用 `src/features/parameter-catalog/`、`src/features/parameter-catalog-governance/` 与 `src/application/parameter-catalog/` 已有实现，不重写一套新页面。[S14]

项目运营、参数工作台、文件管理等非 Catalog 路由保持原有边界。只替换本轮明确拥有的组织 Catalog 入口；不能把整个 parameter-admin 分支统一换成 CatalogPage，误删项目管理能力。

### 12.2 挂载步骤

先在真实运行时构造 Catalog Repository 和 Governance Repository，保证 API 模式使用正式 HTTP client，mock 模式使用同语义 adapter。随后将 `/parameter-admin/specs` 接到 CatalogPage，并按既有产品合同在同页组合治理交互。

保留入口重定向、导航标签、面包屑和权限控制。旧书签通过正式 legacy identifier 解析获得确切目标；不能仅按参数名搜索相似条目自动跳转。

URL 中的 subjectId、definitionId、catalogReleaseId、revision 选择、过滤和 cursor 按已冻结契约恢复。若 query 中选择了历史 release，不得在“刷新页面”“返回上一级”或异步响应后静默切回 current。

### 12.3 冲突与空态

加载错误、未就绪和业务空态分开。没有注册、没有定义、没有待审工作、过滤无命中四种原因都必须有对应说明；不能再通过假空查询进入正常空态。

ETag 或 release 冲突时保留用户输入，刷新权威上下文并要求重新确认。不能自动换最新 ETag 重试写入；也不能把网络重试变成新的业务命令。

未授权写入口不仅应隐藏或禁用，真实请求也必须被后端拒绝。历史页需要能查看已退役对象，但禁止的新增识别、注册或治理动作必须依既有合同禁用。

### 12.4 API/mock 一致性

使用同一组操作序列驱动两个 adapter，比较状态、ID 稳定性、权限、错误、ETag 变化和幂等副作用。忽略随机 ID 的字面差异可以，但不能忽略对象关系或状态转换差异。

Mock 不能维持永远不变的 ETag，也不能只因重复请求触发了旧 ETag 检查而拒绝本应成功的幂等重放。将这些行为纳入共享适配器测试，而不是逐个 fixture 断言静态值。[S12]

### 12.5 关闭条件

通过实际应用入口打开新页面，使用真实 API 完成读和治理操作；非 Catalog 路由未回归；Back/Forward/刷新和旧书签行为正确；桌面、平板、手机均完成真实交互和布局检查。[S02]

---

## 13. OP-08：建立跨模块验证和证据门禁

### 13.1 一套共享的多发布链夹具

下面是拟实现的测试夹具规格，不是已经存在的业务数据。所有主体和属性键使用现有 canonical 规则允许的合法值，digest 通过真实编译器生成，不手填“看起来像哈希”的常量。

| Release | 变化 | 必须保留／验证的关系 |
|---|---|---|
| A | 首次发布 Driver D1、NodeType N1、各自 alias，定义 X/r1 与 Y/r1 | 初始结构、注册前全局浏览、绑定初始 pin |
| B | 只把 Y 改为 r2；X 不变 | B 的 X head 仍精确指向 A 的 X/r1 |
| C | X 仅文档变化为 r2，Y 不变 | 历史完整；已有 X/r1 Binding/Value 不自动重写 |
| D | 退役 D1 的一个 alias，D1 自身 active | 当前 alias 不识别；pinned A 的同 alias 仍识别 |
| E | 按已批准规则显式退役 D1 及必要 alias membership | 身份和历史保留；缺省遗漏不得代替 tombstone |
| F | 显式恢复相同 D1/alias 身份 | 不重建 Subject/Registration/Placement；历史仍可读 |

在独立场景增加 D2，以兼容字符串数组同时命中 D1/D2 测歧义，不通过违反唯一约束制造两个相同 canonical key。增加一次显式 Definition retirement 场景，验证 Subject retirement 与 Definition lifecycle 不能互相替代。

组织数据包含 A 组织、B 组织和一个无注册组织；至少两个项目、普通成员、组织管理员、平台审核人、只读用户和受限制的 Agent。创建跨项目使用与历史值，以人工写下的期望关系和计数作为 oracle。

**oracle 不能调用被测函数自己计算期望值。** 例如测试 currentValueCount 时，测试夹具明确知道有几个 current pointer，而不是再次调用同一个统计函数得到 expected。

### 13.2 测试层级

| 层级 | 用途 | 不可替代的证据 |
|---|---|---|
| 类型／纯函数 | ID 不可混用、状态表、匹配、cursor、排序 | 不能证明数据库约束和真实认证 |
| 真实 PostgreSQL 模块测试 | 事务、角色、并发、head/lineage、幂等和回滚 | 不能证明生产 composition root |
| 根路由集成 | 生产认证、真实服务接线、DTO 和权限 | 不能证明实际页面已挂载和可操作 |
| 真 API 浏览器 | 路由、交互、URL、布局、错误状态 | 不能证明目标机恢复和发布审批 |
| 目标环境门禁 | 实际库存模式、双阶段比较、恢复点、授权 | 不能由本地 synthetic 或 Hosted 单测代替 |

现有 `server/testing/parameterCatalog/` 与 schema suite 已强调真实 PostgreSQL/pgvector。维持环境缺失时失败而非跳过的要求；不把内存数据库、SQL 文本断言或零个测试计为 PG 通过。[S20]

### 13.3 PCAT 浏览器用例必须有真实断言

基线 negative acceptance 文件包含无条件 `test.skip`，且多数用例解除 skip 后也只做 `page.goto`。因此，**“挂载页面后去掉 skip”仍不足以完成验收**；必须补充可观察断言和写入结果检查。[S15]

| 现有验收范围 | 至少需要的真实操作与断言 |
|---|---|
| PCAT-UI-01/02 | 从真实导航进入唯一 Catalog；选择 subject/definition/release；刷新及浏览器前进后退仍保持选择 |
| PCAT-UI-03/05 | 详情的身份、revision、文档、注册、Placement、usage 与期望一致；历史分页无重漏 |
| PCAT-UI-04/07/15 | 显式注册、Placement 选择、Review Resolution、提案生命周期走真实后端，并验证持久化结果 |
| PCAT-UI-06/09/12 | 角色禁用、退役限制、Agent 只读及服务端拒绝；不能只检查按钮不存在 |
| PCAT-UI-08 | loading/error/not-ready 和四种空态能够区分，故障不会显示正常零数据 |
| PCAT-UI-10 | 真实 ETag/release 冲突；保留输入、刷新证据、重新确认，无静默自动写重试 |
| PCAT-UI-11 | 旧书签 mapped/gone/conflict/unknown/scope-hidden 的确切结果，不靠名称近似跳转 |
| PCAT-UI-13 | 同操作轨迹验证 API/mock 状态和权限等价；mock 证据与真实 API 证据分开标注 |
| PCAT-UI-14 | 1440×900、768×1024、390×844 下完成列表、详情、队列、弹层、键盘和焦点操作 |

优先使用可访问角色和用户可见名称定位，等待业务状态，不依赖固定 sleep。Playwright 的自动重试断言可用于等待页面达到预期状态，但仍要编写业务断言本身。[E03]

保留预期失败 HTTP 请求的检查：401/403/409 等预期负向用例可以出现在网络记录中，不应为了“控制台零报错”而删掉负向验证。需要区分受控业务拒绝和未处理异常、持续失败重试或无关 Console error。

对 `requirements.ts`、`operationMatrix.ts` 的状态更新与真实 test spec 同一 PR 维护：只有实际执行且断言通过的覆盖才升级。保留已有 PCAT ID，不重新编号，也不以多份重复 marker 代替业务覆盖。

### 13.4 门禁的分层执行

开发中每个工作包运行 focused tests；进入 sealed 候选前运行受影响目录、类型检查、构建、文档与契约检查；完成全部集成后运行完整测试与浏览器门禁。不要要求每一行修改都运行所有 Hosted job，也不能让 full suite 中的一次绿色掩盖 focused 用例未被选中。

对本轮必须执行的用例，skip、not-started、zero-tests、缺少环境均视为门禁未满足。真正不适用的测试可以保留经负责人批准的 N/A，但必须注明原因，且不能用于覆盖本轮必需的行为。

### 13.5 可使用的仓库命令

以下脚本名已经核对 `package.json`；这是实施时的命令清单，不是本轮执行记录。[S18]

开工先核对工作区和提交，不自动清除改动：

```bash
git status --short
git rev-parse HEAD
npm ci
```

隔离 PostgreSQL/pgvector、相应 lane 和认证配置准备好之后，按实际修改范围运行。新测试文件必须先创建并确认会被 runner 收集；不能只凭命令退出 0 判断执行了相应测试。

```bash
npm run test:server -- server/modules/catalog-kernel/runtime
npm run test:server -- server/modules/parameter-governance
npm run test:server -- server/modules/parameter-bindings
npm run test:server -- server/modules/parameter-catalog-api
npm test -- src/application/parameter-catalog
npm test -- src/features/parameter-catalog
npm test -- src/features/parameter-catalog-governance
```

根路由新增测试不一定被以上目录覆盖，应另行运行其真实路径。实际采用了本方案建议名称时执行：

```bash
npm run test:server -- server/parameterCatalogAuth.integration.test.ts
```

集成候选的基础门禁：

```bash
npm run test:all
npm run build
npm run lint
npm run contract:check
npm run ui:check
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
npm run acceptance:models
git diff --check
```

`npm run lint` 在当前基线只对 `src` 执行 ESLint，不能据此声称 server 已通过 ESLint；server 至少由 TypeScript 和测试覆盖。本轮不为了扩大 lint 范围顺带引入与目标无关的全仓格式改动。[S18]

边界检查使用 CI/方案登记的可信基线 SHA，不能填当前 HEAD 掩盖新增违例：

```bash
: "${CATALOG_TRUSTED_BASE_SHA:?请设置已审核的边界检查可信基线提交}"
npm run parameter-catalog-boundaries:check -- --trusted-base-sha "$CATALOG_TRUSTED_BASE_SHA"
```

采用 lane wrapper 时，`--issue` 使用实际分配的 GitHub Issue 数字，不使用 `OP-02` 等本地编号；连接及角色参数按仓库 lane 文档配置。禁止为方便同时运行而共享会被清理的测试数据库。

新页面已挂载、真实 API 与候选 Catalog 已在隔离环境就绪后：

```bash
npm run acceptance:e2e -- e2e/acceptance/parameter-catalog.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/parameter-catalog-governance.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts
npm run acceptance:gate0
npm run acceptance:artifacts:check
```

这些脚本可能需要环境和运行参数，执行者应先读现有使用说明及对应脚本入口，不猜测 `--target`、`--release` 等不存在的选项。任何 release、恢复或清理命令不得仅因出现在文档里而在生产自动执行。

Schema 或 OpenAPI 有实际变更时，再运行对应生成和校验脚本：

```bash
npm run contract:openapi
npm run contract:check
npm run db:schema-doc
npm run db:schema-doc:check
```

只有确实修改 Schema 的工作包才需要数据库 Schema 文档重新生成；所有生成操作之后核对 diff，防止把本机与任务无关的漂移提交进去。

### 13.6 连接和容量基线

在正确性已经通过后，对小夹具、当前代表性库存和预期增长规模执行相同测试，记录数据规模、pool 容量、并发、查询数、连接等待、端到端延迟分布与内存。至少比较 current/pinned、第一页/后续页、注册过滤以及完整定义详情。

硬条件是无挂起、无泄漏、无混版、无跨组织污染；性能条件按测量建立预算并由负责人确认。可将“相同环境下 p95 不出现未经解释的大幅回退”作为候选比较规则，但不要把任意毫秒数写成项目已经承诺的 SLO。

确认 N+1 或反复全量加载是瓶颈后，再优先考虑批量查询、必要索引和有界不可变缓存；每一项优化都必须重新通过 F2/F5 的历史一致性测试。

### 13.7 CI 与证据故障分别定位

CI 失败需要区分代码断言失败、环境不可达、浏览器驱动问题、artifact sanitizer 拒绝和上传失败。不能把 artifact 上传失败反推为所有业务用例失败，也不能把 sanitizer 拒绝绕过后当作验收完成。

报告至少写明原始失败步骤、首个相关错误、影响用例、真实 exit code 和候选 SHA。只修复允许范围内的根因；不批量重录截图、不增加 blanket skip、不把错误码改为成功、不删除必需日志。

---

## 14. 数据库变更与存量数据修复策略

### 14.1 默认不需要改历史迁移

F1 是认证接线；F2/F3/F5 主要是读取和元数据；F4 主要是查询装配；F6 优先利用已有状态结构修正命令；F7 是匹配规则。**第一选择是修复这些代码，而不是先给它们各写一份 migration。**

若确有新增索引、状态约束或幂等结果存储需求，先证明现有结构无法满足，再追加最小迁移。分配编号前 fetch/rebase 并核对目录和 migration ledger；禁止修改 `0137` 或其他已应用 SQL 的字节。

### 14.2 分类修复而不是全量猜测修复

| 分类 | 示例 | 处理原则 |
|---|---|---|
| 仅展示错误 | 数据真实存在，但 API 返回空、零或错误 metadata | 修读取；不要为修 UI 重写真实业务数据 |
| 引用完整且能唯一证明原意 | 审计、幂等和对象关系共同证明某条错误提案映射 | 形成逐条计划，保留旧引用映射、修复原因及审计 |
| 引用损坏但含多种可能 | proposal base 指向无效 ID，无法确认真实 revision | 保留、隔离、交人工复核；不按名称自动选择 |
| 非法副作用或安全疑点 | 疑似未经授权的注册、审批、publication intent | 安全与业务负责人共同核对；先保全证据，不自动删除 |
| 历史固定 pin | 旧 Binding/ProjectValue 指向旧 revision | 默认保留，不能随 current release 全量更新 |

修复脚本必须具备只读预览、明确目标清单、候选 SHA/计划 hash、幂等性、每条结果、故障回滚和审计。运行前后对受保护引用、行数与领域真值做比较；行数一致不等于语义一致。

### 14.3 Schema 变更验收

至少覆盖空库迁移、支持的升级起点、有数据升级、独立角色权限、延迟约束在 commit 时的失败，以及失败无残留。真实 pgvector 环境和目标 Schema 文档必须与迁移链一致。[S20]

索引变更需单独评估表规模、锁影响和迁移工具是否支持其事务模式；不直接把开发库几毫秒的结果当作目标机安全证明。

---

## 15. OP-09：目标环境预演、发布门禁与恢复

### 15.1 发布前条件

F1–F7 和 INT-01 有对应证据；全部必跑用例实际执行；新生产接线不含假空实现；真实 target 的认证 provider、数据库角色、库存模式、Catalog bundle 和 runtime pin 明确。

代码合并之后仍沿用原 #735 及相关已批准方案，不新建一套可以绕过原门槛的“简化 release 流程”。本包只补充修复带来的新验证点和精确候选身份。[S19]

### 15.2 原有目的链的执行原则

在维护与流量隔离条件下完成预激活验证和必要比较，获得对应批准后才可执行 P12。P13 之后执行新的完整验证／比较尝试（P11b），不能仅检查少数新增项，也不能复用激活前的报告字节和 checksum。

随后按合法 post-retirement runtime pin 进行 verify-only startup，在仍隔离公共流量和队列的条件下完成真实 API／浏览器验收。public-release 聚合报告及其独立批准满足后，才可恢复相应流量，并进入观察阶段。

具体 P12、P13、P11b、P14a、P14b、P14c、P15 的参数和授权条件以既有 #735 合同及实际脚本为准；本文不发出这些目标操作命令，也不授权提前切换。

实际 target 只运行它真正的 fresh 或 populated 库存模式，但 pre-activation 与 post-P13 两次证据必须独立。实现测试则要覆盖 fresh/populated × pre/post 的全部组合。不得把没有查到数据或查询失败报告为“已证明零库存”。[S19]

### 15.3 本轮新增的目标验证点

通过实际部署入口验证 production 认证不可绕过；历史 A/B release 读取正确；真实注册、Placement、使用量和 Proposal 在写后可读；提案 ID 不变且审批只产生 intent；别名退役后不再新识别；页面真正挂载且三视口可操作。

复核已有受保护消费者，包括 Catalog/Governance、topology、项目参数、文件、Agent、日志、debugging、DTS reload、knowledge、modules 和 operations。这里要求原有比较门禁继续覆盖各族，不意味着本轮重写每个消费者。

### 15.4 恢复边界

未发生候选业务写入且未开放流量时，只有通过现有 guard 证明可恢复，才允许使用既有 pre-traffic pointer switch-back。单纯看到“旧 release 还存在”不是恢复授权。

已经发生候选写入或流量时，不允许仅回退 Catalog pointer 造成数据模型与业务记录不一致。按已批准流程选择同计划确定性修复并重新验证，或恢复已经验证的跨存储一致恢复点。

恢复点至少考虑 PostgreSQL、对象存储及其元数据、Redis/队列/作业状态和实际部署配置；具体范围以应用真实使用情况和现有恢复方案为准。先验证备份可还原，再把它作为恢复选项。禁止在未隔离队列和写入者时执行部分恢复。

### 15.5 发布观察与停止条件

重点观察 Catalog not-ready/drift、存储错误、认证拒绝异常、Proposal 冲突与重复副作用、连接池等待、历史读取错误和 legacy lookup 异常。指标标签不携带 token、用户敏感值或无限增长的对象 ID。

发现身份旁路、跨组织数据、混版快照、未解释的数据差异、受保护引用无法查询、持续连接饥饿或缺失恢复证据时，停止继续推进发布。不得通过放开权限、增加无限重试、把失败改为空结果或忽略 artifact 安全检查继续上线。

---

## Git 与 PR 工作流

- 接受的 `origin/main`：`54815cdce5dd21d3d96587f0e52cc0f4faae9dd6`。开工时重新核对；SHA 变化则按 F1–F7 行为重测，已真正修复的项关闭而不是盲目重做。
- Scratch 分支从最新 `main` 拉出。实现智能体只在功能分支提交，不得 push `main`、打开/合并 GitHub PR，或在合并后同步 `main`。
- 建议分支：`fix/catalog-op-01-auth`（#803，可含 OP-00 计划落地）、`fix/catalog-op-02-snapshot`（#804）、`fix/catalog-op-03-match`（#805）、`fix/catalog-op-04-queries`（#806）、`fix/catalog-op-05-proposals`（#807）、`fix/catalog-op-06-wire`（#808）、`fix/catalog-op-07-page`（#809）、`fix/catalog-op-08-evidence`（#810）。OP-03 必须在 OP-02 共享文件稳定后顺序修改。
- 父集成负责人审查、封存、打开及合并 PR，并按 OP-01 → OP-02 → OP-03，OP-04/OP-05 在 OP-06 前，OP-07/OP-08 在 OP-06 后，OP-09 最后的顺序合并。
- 停止边界：没有明确授权，不在生产或目标机执行 cutover、恢复、清理、流量切换或批量数据修复。

## 文档影响矩阵与更新门禁

仓库要求面向开发者的文档以独立中英文文件维护；本文提供中文实施正文，纳入仓库时需要同步英文配套及双向链接。不能把只有中文的文件直接当作已经通过仓库文档治理。[S02] [S17]

| 文档／资产 | 本轮影响 | 负责人 | 更新时机 |
|---|---|---|---|
| 新中文计划及英文配套 | 工作包、范围、不变式、验收和状态 | 集成负责人 | OP-00；每次实质进度更新 |
| `docs/PLANS.md` 及中文配套 | 新计划索引与剩余工作 | 集成负责人 | 计划落地／完成归档 |
| `docs/api/authentication.md` 及实际中文配套 | 统一认证边界与开发头限制 | OP-01 | 认证修复同 PR |
| `docs/SECURITY.md` 及中文配套 | 受保护入口、可信身份、拒绝审计 | OP-01/06 | 安全语义有变化时 |
| `docs/design-docs/catalog-kernel-interface-and-transaction-boundary.md` 及中文配套 | 单连接、捕获时点、lineage、metadata 读边界 | OP-02 | Kernel 合同修订同 PR |
| `docs/design-docs/parameter-catalog-api-transition.md` 及中文配套 | Proposal 状态、metadata、错误、条件写入 | OP-05/06 | 契约实现同 PR |
| `docs/design-docs/domain-model.md` 及中文配套 | 仅记录真正改变或澄清的语义，不重写全部领域 | OP-05/集成 | 必要时 |
| `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 实际页面挂载点、状态、适配器边界 | OP-07 | 挂载同 PR |
| 浏览器覆盖 map、operation matrix 及对应中文文档 | 实际可执行覆盖与 evidence 链接 | OP-08 | 测试从 planned 转 executable 时 |
| `docs/generated/openapi.json` | DTO/route 有变化时重新生成 | OP-06 | 契约变更同 PR |
| `docs/generated/db-schema.md` | 只有 Schema 实际变化时重生成 | 迁移负责人 | 迁移集成同 PR |
| 现有发布、回滚、self-hosted runbook 及中文配套 | 新候选验证点与恢复限制 | OP-09 | 目标预演前完成 |

“及中文配套”指仓库中实际已有的 counterpart，不猜测大小写或路径；按照索引定位。如果确实没有配套，登记新增文件而不是引用不存在的文件。

文档门禁要求：路径可解析、双语语义一致、generated 内容来自正确候选、未把计划行为写成已完成事实、每项尚未完成的证据仍显式标记 blocked/not-run、`npm run docs:check` 实际通过。

---

## 17. 每个 PR 的交付记录模板

实现者的交付正文应包含下列字段，填真实值，不保留含糊的“测试正常”。

| 字段 | 内容要求 |
|---|---|
| 工作包／实际 Issue | OP 编号、真实 Issue 号、对应 F/INT |
| 基线／候选 | baseline SHA、candidate SHA、tree SHA |
| 文件范围 | 修改文件、拟新增文件、生成资产、没有触碰的关键边界 |
| 根因与修复 | 反例如何触发、修复改变哪一层行为、为什么没有扩大权限或改领域真相 |
| 测试执行 | 完整命令、exit code、文件数、test 数、passed/failed/skipped 数和实际环境 |
| 关键结果 | 修复前失败断言与修复后结果；数据 pin、状态或计数的真值 |
| 安全与数据 | 认证、组织隔离、角色、审计、幂等、迁移是否涉及 |
| 浏览器 | 路由、视口、交互、截图/快照、网络/console 检查；不涉及则注明理由 |
| Hosted | run ID、event、attempt、head SHA、各必跑 job 状态；不得只写“CI 绿” |
| 目标环境 | target 标识的脱敏形式、库存模式、phase、pin、report checksum；未执行则明确写明 |
| 残余限制 | 未完成项、受阻原因、是否阻止模块关闭／页面启用／发布 |
| 文档 | Impact Matrix 状态、双语同步、生成资产和 docs gate |

证据目录应区分 local/PG/browser/Hosted/target。日志、trace、HAR、截图均可能包含用户内容或凭据，上传前经过现有 sanitizer；原始敏感调试日志保留在受控位置，不进入公开仓库。

修复 PR 的摘要可以只解释关键变化；面向用户交付代码修改时，附上所修改代码文件的完整内容，而不是只有 diff 或零散片段。仓库审查仍保留精确 diff，便于核对范围。

---

## 18. 最终完成定义

### 18.1 代码修复完成

F1–F7 的必需反例和回归已执行；正确历史链和 max=1 测试通过；真实治理读能力接入；Proposal ID 与状态迁移正确；alias 生命周期处理正确；无新增未批准边界违规；类型、构建、受影响测试、文档和契约检查通过。

### 18.2 产品集成完成

新 CatalogPage 从实际应用可达；真 API 路径完成治理操作；四种空态与错误明确；API/mock 权限状态一致；旧书签行为明确；PCAT-UI 必需用例有业务断言且实际通过；不把 warmup、planned 或 skipped 算成覆盖。

### 18.3 发布完成

OP-09 和原 #735 的所有真实门槛满足；目标验证使用同一精确候选及正确 pin；预激活、post-P13 和 public-release 的证据和批准没有互相替代；恢复点和恢复流程可用；实际开放流量经过所需授权。

**允许记录“代码修复已完成，目标发布仍 blocked”。不允许为了关闭工作项，把三个完成层次压成一个绿色状态。**

### 18.4 关闭前核对表

- [ ] production 的 Catalog 身份不再来自开发用户头。
- [ ] current/pinned 快照的 ID、digest、metadata、head 和历史范围一致。
- [ ] 未修改定义跨 release 沿用旧 revision 时正常可读。
- [ ] max=1、并发请求和故障路径都没有连接泄漏或循环等待。
- [ ] Registration、Placement、Observation、Proposal、usage 来自真实查询。
- [ ] 生产不可用与业务为空没有混用。
- [ ] 提交已有 Proposal 不新增 Proposal，base ID 不混淆。
- [ ] ETag、幂等、并发和审计具备原子性；审批不直接改 Catalog。
- [ ] Driver/NodeType alias 与各自生命周期一致。
- [ ] 旧 Binding/Value pin 和受保护历史未被随意重写。
- [ ] 新页面实际挂载，非 Catalog 路由未回归。
- [ ] 浏览器断言实际执行，mandatory tests 无 skip/zero-tests。
- [ ] 中英文文档、OpenAPI/Schema 必要资产与候选一致。
- [ ] 目标模式、独立验证阶段、报告和恢复证据完整。
- [ ] 发布负责人明确授权后才恢复相应流量。

---

## 19. 可直接交给开发智能体的任务说明

以本方案的固定提交作为参考，开工时核对实际主分支，不覆盖用户工作区。首先落实 OP-00 的最小基线和文件归属，再优先完成 OP-01 的认证修复；其余工作按依赖推进。

每个工作包先增加能表达原问题的测试，再做最小实现。测试必须至少有一条穿过真实生产组合边界；涉及数据库的关键行为使用真实 PostgreSQL/pgvector，不把 mock 成功当作数据库证据。

不修改已应用迁移，不扩大 Governance 的 Catalog 权限，不用 fallback 空结果消除错误，不复制所有 revision 修复读取，不用增大 pool 或 timeout 掩盖连接等待，不将 proposalId 强制包装为 revisionId，不自动把过期 ETag/release 改成最新后重试。

OP-02/03 共享文件顺序修改；OP-04/05 冻结领域查询和命令接口；OP-06 统一装配根依赖、HTTP 与 DTO；OP-07/08 完成真页面和真实断言；OP-09 仍受既有目标操作及审批约束。

实现完成提交候选、测试证据和完整修改文件，由父集成负责人审查、封存、打开及合并 PR。没有明确授权，不在生产执行 cutover、恢复、清理、流量切换或批量数据修复。任何无法证明的行为都记录为具体 blocker，而不是用未经支持的默认值继续运行。

---

## 20. 来源与定位索引

正文 `[Sxx]` 为仓库证据，`[Exx]` 为官方技术文档。源码链接均固定在本次复核提交；Issue 链接用于说明既有目标合同，其讨论会变化，因此执行时仍需复核。新拟建文件和 CATFIX 测试属于本方案建议，不会作为现有证据引用。

| 编号 | 来源 | 主要定位 |
|---|---|---|
| S01 | [本次复核的精确提交][S01] | 提交与 tree 身份 |
| S02 | [AGENTS.md][S02] | 分支、文档、真实浏览器与运行时规则 |
| S03 | [server/app.ts][S03] | getCurrentAuthContext 与 buildWiseEffRouter 的认证接线 |
| S04 | [currentSnapshot.ts][S04] | loadProjection、loadCurrentCatalogSnapshot、resolveSubject |
| S05 | [materializeRelease.ts][S05] | stageRevisions 复用已有 revision 与 stageHeads |
| S06 | [productionWire.ts][S06] | 生产依赖、named release pin 与占位元数据 |
| S07 | [read/ports.ts][S07] | unregisteredProjection、zeroUsageProjection |
| S08 | [governance/ports.ts][S08] | emptyGovernanceQueryPorts |
| S09 | [pinnedSnapshot.ts][S09] | 历史 release 的 digest 校验 |
| S10 | [parameter-catalog-contract/enums.ts][S10] | Proposal 五状态及共享封闭枚举 |
| S11 | [governance/handlers.ts][S11] | Create/Submit 与 Proposal ID 错误适配 |
| S12 | [mockAdapter.ts][S12] | createProposal、submitProposal、transitionProposal |
| S13 | [proposals/command.ts][S13] | 既有 submit 命令与条件命令结构 |
| S14 | [src/app/routes.tsx][S14] | 实际 parameter-admin 路由分派点 |
| S15 | [parameter-catalog-negative.acceptance.spec.ts][S15] | 无条件 skip、planned marker 与导航占位 |
| S16 | [Wayfinder #668 目标合同][S16] | 领域分离、不可变发布、注册、迁移与历史保留 |
| S17 | [docs/PLANS.md][S17] | 计划治理、依赖与文档更新要求 |
| S18 | [package.json][S18] | 实际测试、构建、文档、契约及验收命令 |
| S19 | [Release integration #735][S19] | P12–P15、目的报告、独立阶段和真实证据门槛 |
| S20 | [catalogSchema.integration.test.ts][S20] | 真实 PostgreSQL/pgvector 必需与不可跳过要求 |
| S21 | [catalog-kernel/interface.ts][S21] | 公开 Kernel facets 与方法装配现状 |
| S22 | [proposals/writer.ts][S22] | writeSubmit 新建、withdraw、条件写入与审计 |
| E01 | [node-postgres Pool API][E01] | 连接池排队、client 释放、单连接事务与等待观测 |
| E02 | [PostgreSQL Transaction Isolation][E02] | Read Committed 与 Repeatable Read 的可见性 |
| E03 | [Playwright Assertions][E03] | 可重试的页面断言与等待业务状态 |

[S01]: https://github.com/tzrea1-Q/WiseEff/commit/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6 "本次复核的精确提交"
[S02]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/AGENTS.md "AGENTS.md"
[S03]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/app.ts "server/app.ts"
[S04]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/catalog-kernel/runtime/currentSnapshot.ts "currentSnapshot.ts"
[S05]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/catalog-kernel/install/materializeRelease.ts "materializeRelease.ts"
[S06]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-catalog-api/productionWire.ts "productionWire.ts"
[S07]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-catalog-api/read/ports.ts "read/ports.ts"
[S08]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-catalog-api/governance/ports.ts "governance/ports.ts"
[S09]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/catalog-kernel/runtime/pinnedSnapshot.ts "pinnedSnapshot.ts"
[S10]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-catalog-contract/enums.ts "parameter-catalog-contract/enums.ts"
[S11]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-catalog-api/governance/handlers.ts "governance/handlers.ts"
[S12]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/src/application/parameter-catalog/mockAdapter.ts "mockAdapter.ts"
[S13]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-governance/proposals/command.ts "proposals/command.ts"
[S14]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/src/app/routes.tsx "src/app/routes.tsx"
[S15]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/e2e/acceptance/parameter-catalog-negative.acceptance.spec.ts "parameter-catalog-negative.acceptance.spec.ts"
[S16]: https://github.com/tzrea1-Q/WiseEff/issues/668 "Wayfinder #668 目标合同"
[S17]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/docs/PLANS.md "docs/PLANS.md"
[S18]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/package.json "package.json"
[S19]: https://github.com/tzrea1-Q/WiseEff/issues/735 "Release integration #735"
[S20]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/catalog-kernel/schema/catalogSchema.integration.test.ts "catalogSchema.integration.test.ts"
[S21]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/catalog-kernel/interface.ts "catalog-kernel/interface.ts"
[S22]: https://github.com/tzrea1-Q/WiseEff/blob/54815cdce5dd21d3d96587f0e52cc0f4faae9dd6/server/modules/parameter-governance/proposals/writer.ts "proposals/writer.ts"
[E01]: https://node-postgres.com/apis/pool "node-postgres Pool API"
[E02]: https://www.postgresql.org/docs/current/transaction-iso.html "PostgreSQL Transaction Isolation"
[E03]: https://playwright.dev/docs/test-assertions "Playwright Assertions"

---

**实施优先级总结：先保护身份入口，再修复 release 读取与治理读写，随后接通真实 API 和页面，最后用同一候选上的目标证据决定是否发布。**
