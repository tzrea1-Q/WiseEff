# 存量 self-hosted 升级兼容修复

> English: [English](../../../exec-plans/active/2026-09-06-populated-upgrade.md)

## 范围与状态

### 已授权续工：NW-01–NW-04

用户最新review批准D-A：自然审计测试修复 `009ce086a3050ce555806394463bb8d179c70fbb`
及其三对精确身份重定位，实施前仍逐对独立核验字节／元数据；批准D-B：显式演进比较
证据版本，将完整mapping快照与逐身份、固定计划规则支持的声明差异分开。两项均不
授权新增migration、runtime grant、S6／Policy语义、生产操作或合并Draft。历史v1字节与
批准、原可信库存、原23对映射及用途／批准规则保持不变。

NW-01代码 `25e8aabae`／报告 `4b346d6ef` 已推送，D-A与原生client关闭修复均经独立审查。
run `34192523701` 在merge `7affb0894c4d78446efbfaf534ff61561c44e0a4` 出现新的owned失败：
bootstrap 39通过／1失败：独立child的 `not-applied` 断言已过，但父进程后续fresh-manager inspect
预期 `not-applied`、实际 `unknown`，不能归因成child重开失败。
后续owned suite未执行。随后本机 deferred 真实 PG 反例证明认证探针关闭竞态，
但未复现或证明原 Hosted 原因；已审修复集成到 `0390bd028`。

后续本地代码：`53946302d` 在planner返回后、journal提交或重放成功前复查原宿主锁；
Red为失锁仍成功，Green为19/19调度回归，限定Standards／Spec独立通过。
`1ad2fdb0f` 登记真实Compose handoff owned入口，路由／监督59/59；随后源 `c2197ae17`
实际入口9/9、清理已验证，但应用容器仍为身份 stub。
父唯一负责runner／CI／controller，Raman唯一负责 `handoffDataSource` 和handoff夹具。
`b7c64328f` 集成已双审的mapping快照／v2 codec小边界，真实PG activation 22/22、五文件纯测24/24、
build退出0并保留警告。首次纯测误选配置触发默认开发库ledger检查，未收集用例，不计验证。
上述不证明完整多head比较、P13、获批启动或完整controller成功；新代码不会倒填到已发布的
`4b346d6ef` 全文包。

集成代码 `0390bd028`／tree `bdd8c313172648b2fedf58b2790775213fa9ab0f` 的相关97/97、
build、原 boundary 3509/3509、含真实 schema 核验的严格 owned docs 均通过。
bootstrap 源 `3fa5db71e` 单独真实 PG 41/41、清理已核验。分片 Standards／Spec 和新的
限定集成 Spec 均通过，不推定当前全量或 Hosted 通过。精确执行身份、hash 及新增默认库
误调用偏差见现有证据双语文件。Lagrange 继续实际 P0 库存／登记及多 head provider 链；
Raman 继续真实旧应用源 lease。这些未完成 Scratch 路径不计入交付代码。

当前base仍为 `cda6737a8`；报告 `b5ef257cc` 的run `34169931811` 已失败结束，
实际merge checkout `829f8b49d`。runtime-role-source为12通过／1失败：管理会话终止后
服务端会话数预期0、实测1；后续owned suite未执行。Build/test、smoke和quality通过，
两个目标job跳过。不得与此前任何timeout或恢复失败合并归因。

| 工作单元／唯一写入者 | 退出条件与风险 | 文档影响 |
| --- | --- | --- |
| NW-01运行来源／Raman；审计及精确映射／父 | 按PID归因释放；不放宽预算；三对字节与身份反例 | 现有runtime source、boundary及证据双语文件 |
| NW-02 codec／provider／mapping实现／Lagrange；串行集成／父 | 实际多head与固定P0规则通过既有九gate；未知来源拒绝 | 现有比较合同／决策及指纹 |
| NW-03 controller／journal／组合根／父 | 真实P13与正式批准报告支持受限production API／worker启动 | 现有startup、retirement及操作手册 |
| NW-04集成／父 | 真实终端完整升级非空隔离旧环境并完成业务／恢复验收 | 现有证据／操作手册 |

同一时间只推进一个共享实现根，独立审查单列。先跑相关真实边界，稳定候选再完整验证。
A／B／C均未完成；严格文档检查要求保持。

### 历史续工记录：真实依赖与激活

集成 `864bd95f180a297fb0fd3ec04aeeaf930b36718c` 修复bootstrap夹具生命周期失败，
没有增加任何预算。源 `c4b99f4ba` 经独立Standards／Spec审查通过、真实PG40/40；
父集成另行执行40/40，清理验证通过。审计时间戳相同的修复仍为Scratch：保持字节布局
的替代方案不能仅凭boundary通过获准。自然修复及其三处精确位置变化需单独边界审查。
当前Hosted仍是 `d79b9b23b` 的失败执行，不声称新CI通过。

| 增量／唯一写入者 | 风险与依赖 | 文档影响 |
| --- | --- | --- |
| Bootstrap夹具／Raman，父集成 | 超时工作必须在共享凭据／锁变化前结束；清理保留首错 | 现有retirement双语文件及证据 |
| 审计时间戳／Lagrange，父审查 | 相同时间不保证事件顺序；保留因果与完整审计断言，遵守冻结身份规则 | 现有证据；必要时精确relocation决策 |
| P13 finalizer／父实现、Raman分析 | 完整当前writer控制与正式效果成立前不生成generation | 现有retirement／startup合同；不新增schema或grant |

当前集成续工 `b7bd0e645` 加入独立双审的HTTP owner控制与原生RI检测，父HTTP51/51、
真实PG34/34、build及原base boundary通过。`3cee9f235` 的永久真实终端验收也已通过，
与此前保留的 `73f12a24e` 成功包分开。报告 `d79b9b23b` 的Hosted `34167230816`
owned bootstrap job为27通过／3失败，不是绿色候选；正在修复5000ms夹具超时及其
共享状态后续失败，不延长timeout。后续一项数据库分析被子智能体工具中止，未完工作
明确保留。实际StartupTarget、production正向启动及完整P13／controller仍是内部实现，
与外部目标材料分开。

固定候选 `73f12a24e17f12b9b863b7ebe78790ddd46d722b`（tree
`c02d9512c54c643cb5e85efa0e4d460536c7fb7d`）通过真实 `upgrade.sh`
artifact-init／prepare／inspect：构建同一源码，再由不同工作目录的独立进程
读回原受控包，两次观察完全相同；这不批准启动。Artifact custody、终端接线及
新journal语义分别完成独立Standards／Spec审查。固定候选focused59/59，完整
owned scripts为source-lock4/4后2001通过／11跳过；backend4300/4300。
Build、原可信基线boundary、contract及selfhost均exit 0。该本地检查点执行时Hosted尚未运行。
精确hash及负测中一次错误预期的有界修正见现有证据文件；下文历史身份保留。

认证／SQL精确后继与trigger派发修复已集成：源 `62090c07e` 的30项联合检查及
原19项SQL回归通过，源 `205dabf26` 的31项writer reachability通过，分别完成
独立双审。这些仍是组件证据，不是完整P13。后续接入真实HTTP注册控制与有效
数据库封禁，不另建全仓库源码扫描平台，也不冒称完整writer库存。

续工 `c3f5a4909` 已集成独立审查通过的真实运行LOGIN来源及schema数组类型修复。
源测试提交 `a550e8a7f` 的真实PG认证、连接终止及清理13/13通过；这不是应用启动。
父路由／来源selector 32/32通过。SQL权限效果已集成至 `64d478f37`；固定源
`2a9b22e2b` 的真实PG19/19及独立Standards／Spec审查通过，此前root／路由selector
147/147不算数据库效果证明。`64d478f37` 完整scripts为source-lock4/4后1940通过／
11跳过；backend4300/4300，均exit 0且owned清理验证通过。独立审查通过的应用
artifact producer已集成至 `a557e6886`，selector20/20、build exit 0。
Builder `75e182236` 实际构建并核验的是源 `a321084a5` 的镜像，不能改记为
本次集成身份。该历史检查点尚未实现跨进程包来源选择；上文新执行仅替代此项状态。

此前 `b8fbae437` 已集成独立审查通过的 bootstrap journal 失锁处理、七表 V13
能力子矩阵和强制 controlled recovery adapter 路由。Focused 274/274、真实
adapter 4/4通过；build、原可信基线 boundary、contract、self-hosted检查均exit 0。
此候选尚未运行Hosted；此前交付 `cf494324c` 的CI `34153386496` 已成功，
local non-HDC与target synthetic两个Job跳过。

| 当前增量／唯一写入者 | R3威胁／依赖 | 文档影响 |
| --- | --- | --- |
| Bootstrap journal／Raman，父串行集成 | 最后报告等待期间失锁；保留已提交证据，不重放 | 现有bootstrap双语文件与证据 |
| V13能力／Lagrange，父串行集成 | 间接LOGIN权限与系统schema自建definer；仅七表子矩阵 | 现有gate双语文件与owned CI |
| Adapter强制路由／父 | 普通路由排除与opt-in不得造成四项用例全漏；子进程失败清理仍unknown | 现有操作／证据双语文件 |
| 运行角色来源／Fermat，父串行集成 | 原配置FD、真实受限LOGIN及物理目标证明；不新增grant | 现有runtime来源及证据双语文件 |
| SQL权限效果／Raman，父拥有runner／CI | 七表ACL CAS、当前读回和未知结果；不声称P13完成 | 现有retirement双语文件及强制owned路由 |
| 认证／SQL后继联合检查／Raman，独立Scratch | 合法REVOKE改变原认证ACL基线；仅认可正式核验的精确后继，禁止caller覆盖基线 | 现有retirement／custody双语文件；独立审查与真实子进程读回 |
| 应用artifact／Lagrange，独占upgrade-lib | 固定源、真实构建信任及OCI字节；不假定Docker image ID是config或manifest摘要 | Artifact合同及现有决策双语文件 |
| Artifact终端接线／父，独占upgrade.sh | 显式prepare／inspect；已有run journal及真实宿主锁；构建前拒绝歧义参数，不隐式建journal或转stack apply | 现有操作／证据双语文件与artifact custody合同 |

完整P13效果与不可变generation producer、StartupTarget及真实API／worker正向
启动仍是内部实现工作。A、B、C均未完成；不新增schema／能力或生产操作授权。
以下检查点保留历史身份。

以下四个有界增量已集成至 `2b5d5ed44`（tree
`d97681435e034b7ee604efbe21295d7b434baa82`），强制真实恢复路由15/15通过并记录服务
镜像证据。服务端代码 `6e519a3b4` 修复缺DB静态诊断的集成回归后，
原断言保留，bootstrap240/240及owned backend4300/4300通过，build及严格owned文档／schema检查通过。各源提交
组件执行与当前候选检查在证据中分别记录；其Hosted结果见上，完整startup／controller
验收尚未建立。现有宿主journal已包含typed publication事件，但仅属于存储层，
不新增schema／grant／报告格式；缺完整P13 producer时不得借caller retired标志或
伪pin发行运行状态。

恢复组合已通过正式 capture 和独立认证批准调用单独恢复进程。Scratch
`06dcc6ca5` 的15项真实包／队列测试全部通过；`2bfd4b2b4` 新增强制owned路由，
执行另行记录。两者都不证明完整旧应用升级。已交付报告 `70c1a3ad0` 的CI
`34146381260` 在实际merge `80f831e2a9641a93284a867cdf226499f569c656` 成功；
local non-HDC及target synthetic两个Job跳过，不覆盖新Scratch。

| 增量／唯一写入者 | R3威胁与所需证据 | 文档影响 |
| --- | --- | --- |
| 恢复与owned CI／父协调者 | 正式capture与四principal批准；仅凭包恢复；真实暂停队列／重试；未知资源精确核对；保留私有journal | 现有操作／证据双语文件、主计划及authority说明 |
| Bootstrap检查根接线／Lagrange | 完整实测binding及原锁／报告／包检查；不回退旧密码 | 现有retirement双语说明 |
| 初始化信号／Fermat | 终止后无晚到消费者／数据库写入；结算已建资源 | 生命周期及共享信号owner双语说明 |
| 组织归档身份／Raman | 保留已核验owner身份，其他metadata及密文仍禁明文 | 现有Archive双语说明 |

独立审查与作者测试分别记录。路由／配置／CI改动须有路由回归和真实owned执行，
普通路由排除不能造成两边都不执行。沿用既有严格Documentation Update Gate；
生产停止边界和独立外部决定不变。

以下已交付检查点保留原执行身份。

当前代码 `ec0ee9f3e86c6c3e037bf5485e8d32f322375ca5`，tree
`ba7e906bf6a3d8d40d679bf87eacb3f9b0e8717c`，已串行集成经过独立审查的根bootstrap
guard/报告/清理增量及强制owned运行身份lane。当前focused92/92、真实bootstrap27/27、
完整scripts前置4/4及主体1842通过/25跳过、build通过。精确证据及剩余执行见现有
证据双语文件。最终限域Standards/Spec审查通过。最新结束Hosted `34142368636`
在 `8f3cf8489` 成功，两个目标Job跳过；不含当前增量，新候选CI待执行。

父协调者独占terminal/controller及计划/证据。Raman下一独立单元连接已保留custody
与独立管理transport，不返回秘密、不增加grant，用于源认证变更后的完整根检查。
这不产生P12/P13。真实startup观察、终端阶段组合及完整合成验收仍属内部工作；
A/B/C未完成。既有R3威胁矩阵、Documentation Impact Matrix及严格文档门禁继续有效。

下方检查点保留历史身份。

代码 `8ed7ac196b34caf351e7331f6e2be15ea7f8a5d3` 已集成独立审查通过的真实CGH
路由、持久Review查询、生产查询组合根和强制owned PG路由。实际PG16 projection
10/10，backend4289通过/11跳过，完整scripts前置4/4及主体1826通过/25跳过，
build/boundary/contract/selfhost通过。
这些是路由/查询结果，不是获批API/worker根入口启动。失败、WIP身份和CI实际checkout
见现有证据双语文件。

最新结束Hosted `34138417314` 在 `c04d42703` 主Job成功，owned bootstrap两项
COMMIT故障反例失败。已审的原生socket no-delay修复保留2000ms时限，新Hosted待运行。
A/B/C未完成。父协调者独占根集成、runner、共享journal及计划/证据；Raman在独立
Scratch负责legacy retirement/bootstrap接线，该增量独立审查者不写实现文件。
R3风险为借用凭据、观察漂移、未知提交、能力泄漏及假空库存。Documentation Impact
Matrix仍限现有计划/证据/手册及直接相关的双语模块合同，Documentation Update Gate
要求执行owned严格docs/schema检查。

下方检查点保留历史身份。

当前已验证代码 `e5c76c9ce4f828df8866f2b26888661a75aa9919`，tree
`dd12fd3b8a15f168a05487f7dbf16a3e245b72cd`，base 仍为 `cda6737a8`。
各集成增量已经独立审查。Owned Binding PG16 92/92、backend 4260通过／11跳过、
scripts前置4/4及主体1822通过／25跳过、comparison 4/4，以及build／boundary／
contract／selfhost通过。精确执行见现有证据文档，不表示完整存量转换通过。
Bootstrap独立进程恢复与端点修复已经集成；此前22/22、本机16/16保留各自SHA。
新候选尚未实际执行Hosted，不能覆盖 `fa3dbef3f` 的失败。

父协调者独占根集成、runner/config及计划／证据双语文件。Fermat在独立Scratch负责
CGH正式查询接线，Raman负责Spec、Lagrange负责Standards审查。通过现有公开组合
接口替换恒定readiness和假空projection，不增加grant、不迁移冻结边界；查询失败
不能证明库存为零。D01真实usage／registration权限、D06查询／命令组合、完整启动
事实及实际controller成功仍是明确的内部接线点。A／B／C未完成。
R3风险仍包括假空库存、借用权限、陈旧pin、清理结果丢失和错误目标副作用。
Documentation Impact为现有计划／证据及直接相关的双语模块／决策文档，不新增宏观计划。

下方检查点保留历史执行身份。

当前本地代码 `439f79c96794d165a73bf41fdd1697bc552ffffe`，tree
`8b1e7d0510f7d22175d4d586c9565809d9380d2e`。双审的bootstrap凭据隔离已集成：
实际owned PG16 18/18、路由47/47，build／boundary／contract／selfhost退出0。
额外进程／未知提交测试仍单独保留，等待实际执行。远端报告 `fa3dbef3f` 的
Hosted `34130699134`，merge `1a6c126e93d1b565b77d3b8baada937374da799f`，
scripts两个清理hook超时，owned endpoint五个解析器选项失败，不能记为通过。
父协调者负责清理集成及交付；Lagrange负责端点修复，Fermat持有串行PG lane，
Raman负责bootstrap及清理诊断。不放宽timeout、grant、可信基线或阶段批准。
文档影响仍为本计划／证据双语文件及受影响模块合同。startup producer和真实根入口
成功仍是内部工作；A／B／C未完成。下方续工段保留上个检查点的历史状态。

### 当前续工：真实依赖与激活

PR #824 仍为 Draft/Open，base `cda6737a8`，重新核对的远端为 `3c0fe1d66`。
该候选 Hosted `34125753813` 在实际 merge checkout
`e0f9ea2e56582b1dfe5398c5d5f4d9b77b30ea73` 失败：恢复依赖登记导致两个失败，
另有 Linux endpoint 正向失败。旧 `34104402409` 成功保留为历史。父候选
`be95a710f` 已修复登记、集成获双审的 P12 适配器，并加入脱敏 endpoint 诊断；
尚未宣称 Linux 根因解决，新 Hosted 证据仍待执行。

干净候选 `1376fbcbe` 的完整 owned scripts 前置4/4，主体1781通过／25跳过；
backend 4241通过／11跳过，必需 owned Binding 92/92，均无失败。Build 和保持
可信基线的 boundary 通过。这些执行不改记为后续 handoff 修改的结果。
`be95a710f` 的实际 Compose 身份回归在复现共享对象掩盖漂移后通过9/9，build通过，
相关增量分别完成独立 Standards/Spec 审查。应用为身份夹具，不是真正旧 API／worker。

未集成 bootstrap 在 `f122a6285` 通过17项真实PG，但独立Spec随后发现统计视图泄露
秘密及检查输入可变两个P2，尚未封存，修复和真实反例正在进行。父协调者继续承担
真实 startup／管理组合根；尚未证明合法 runtime pin 下根入口启动或完整 populated
controller，不提供生产升级命令。

| 增量与唯一写入者 | 必需证据 | 文档影响 |
| --- | --- | --- |
| Durable Redis／生命周期 Scratch | 真实 BullMQ 连接、错误事件、排空与恢复，独立审查 | 队列模块合同及现有计划／证据对 |
| 既有存储 P12／activation Scratch | 0137、真实批准及 PG 副作用、明确未知结果 | activation 模块双语合同 |
| 宿主激活 journal／journal Scratch | 持久 intent、完整记录 CAS、范围与独立读回 | journal 合同及操作手册对 |
| startup producer、组合根及集成／父协调者 | 独立当前事实和真实受限 production 进程 | 现有操作／证据文档对 |
| P13 停止源解析／Raman | 停止容器真实 hosts／resolver 文件、原 endpoint 及双 PG 反例 | retirement／source 模块合同双文件 |
| P13 endpoint 资源监管及 owned 路由／Fermat | 父发行私有 receipt、持久计划／实际 ID、强杀 child 与精确清理 | runner 合同及必需 CI 路由 |
| P13 集成 Spec／Lagrange | 固定 SHA 的独立跨层审查，不编辑实现 | 现有计划／证据双文件审查记录 |
| 正式 durable 投递／父协调者，独立 Spec Lagrange | 锁定 BullMQ 接受正式 producer key；既有身份及重试兼容 | 队列合同及现有证据双文件 |
| P12 激活命令组合／Lagrange；根 controller 集成／父协调者 | issued host lock 下复用领域、报告 dispatcher 和持久 journal；inspect／reconcile 不重放 SQL | activation-controller 模块双文档及现有操作文档 |

新增 P12 组合 Scratch 显式依赖 `07919b498`，不拥有新 schema／grant 或 verifier。
威胁包括伪造／丢失宿主锁、跨 run journal、未观察的 pins、批准前写 pending、SQL 回执
丢失及 reconcile 意外重放。命令仅选择 action、report、attempt；当前观察必须来自
真实 owner，不来自报告。Lagrange 现为实现者，后续必须由其他人独立审查；父协调者
继续拥有 producer、共享 controller／状态机及 shell 入口。辅助 port 测试不证明获准 PG 激活。

停止源 resolver 与父监督增量经独立 Standards/Spec 审查，已集成至 `c6a57ae41`。
后续实际旧镜像业务验收在上传时 HTTP 500；新增永久真实 Redis 测试使用正式
`enqueueLogAnalysisJob`，复现锁定 BullMQ 拒绝含冒号的 job ID：9通过／1失败、
0跳过、exit 1，精确 owned 清理核验成功。此前受控任务生命周期通过没有覆盖这个
producer key。修复必须保留持久任务身份及重试；改夹具为可接受 key 不满足此项验收。
当前 API／worker 获准启动和完整 controller 仍是内部未完成工作。误用 bootstrap
测试配置的无效 setup 调用单独记录在证据文档，不得继续联系未经核验的默认数据库。

API 请求／后台活动排空增量 `b404b615b` 已取得独立 Standards 和 Spec PASS；
该固定代码 focused 61/61，build 通过。真实 HTTP 客户端断开反例在修复前失败：
socket 关闭并不等于异步 handler 已停止使用数据库。这不证明合法 production
启动，也不覆盖所有初始化路径。

激活 journal `e0ce5aa42` 已取得独立 Standards／Spec PASS，集成为 `814199bb6`；
集成后四文件 selector 实际 109/109。保留 intent／unknown／reconcile 和完整记录
CAS，该分片不构成 P12 授权。

Durable Scratch `815666f16` 的历史真实 Redis 为 8/8，单测 60/60。父集成 build
发现 TS2341：Worker.blockingConnection 是 private，并非 protected。改用父进程
监管的 Redis 路由后收集 8 例，7 通过，认证后 INFO 拒绝在未修改的 30000ms
上限超时；退出 1，自有资源清理核验通过。独立 Standards 又复现 malformed URL
构造产生未处理 URIError。固定 Scratch `2381aaff1` 改用公开 client／duplicate
所有权，并在分配连接前验证 URL；独立 Standards／Spec 复审通过。父集成
`de15d6b46` 的受监督真实 Redis 8/8、退出 0、清理已核验，build 通过。
前述失败保留原归属；构造完成、认证连接、liveness、readiness 与消费授权分别判断。

Comparison `d21627c02` 与既有存储 activation `5b945a645` 经独立审查后已集成。
Activation 已从恒定拒绝改为正式获批报告 projection 加九 gate Comparison 关联。
父 owned PG16 收集／通过 11、跳过 0、退出 0；覆盖存储、epoch、缺报告拒绝，
不代表合法获批 public apply 成功。真实 SELECT-only verifier 对照发现 P01
拒绝必要管理成员关系；P02 在全部角色切换先被 42501 拒绝后仍返回通过。
已提出独立限定 S6 合同决策请求，未扩大 verifier 或 runtime grant。
实际 P12/P13／根 producer 和合法 runtime 批准仍未完成；不能用此发现停止
不受影响的集成工作。

Controller 恢复点／停写证据 `920b3f1d9` 已获独立 Standards／Spec PASS。
两个路径逃逸反例先失败，修复后 13 例通过；使用真实私有包文件和宿主锁，
源／停写 port 仍为单测夹具，不是完整三存储恢复或真实停写 producer。
必需 owned CI 已接入真实 Redis 生命周期与既有 schema 激活；通用 suite 排除
对应 integration 文件，并有双端路由回归。当前新增候选 Hosted 尚未执行。

本增量 R3 威胁包括初始化／关闭事件、可恢复断线不永久污染、pool 关闭后的活动写入、
启动中信号、不可信激活事实、SQL／文件提交不确定、跨 run 重放及真实边界内元数据漂移。
两项已授权合同继续有效，不含新 schema／grant、S6／Policy 决策、生产操作或发布授权。
A/B 仍由内部实现承担，C 外部条件单列。父协调者串行集成，不以自审替代独立审查。

P13 源 Scratch `64c613980` 尚未集成。其13例真实 PG／endpoint 通过，但独立审查
仍指出两个P2：仅检查Docker解析配置不能证明实际 `/etc/hosts` 内容；child拥有的
endpoint容器可能在测试被强杀后遗留。下一项实际反例是原hostname解析到第二个真实
PG，以及child强杀后由父核对并清理自有资源。父supervisor拥有全部资源创建和持久
receipt；source消费者只观察。创建／提交／清理结果未知时保留证据并失败。这些endpoint
probe或单独登录fence均不代表完整P13退休，也不是旧应用启动。

source-lock调度及严格owned数据库文档增量已经独立Standards／Spec审查。
`734b10dae` 完整scripts收集1722／通过1697／失败0／跳过25，包括全部四个冻结
source-lock用例；`6be8e08ef` owned严格docs实际schema比对通过且未跳过。
既有证据双文件保留命令身份、hash及早前失败。已用验证TLS路径从固定旧源真实
Dockerfile构建本地源镜像；构建成功不代表启动、企业网络信任或controller证据。
最终集成后仍需文档更新门禁，本计划尚未完成。

### CI 归因与既有 schema 激活增量

在 `d7cdd6473`，父协调者负责 CI 路由、精确执行证据和最终集成。Hosted
`34097926621` 在 backend 超时；该 run 的 scripts 已不再出现原 S11-RP 失败，
但新的 backend 故障／取消分别保留。需 receipt 的 runtimeState 文件改在强制
独立 `bindings-pg16` 执行；身份夹具复用既有迁移模板，不改 23 例断言、源 seed
或超时。两项修复均独立 Standards／Spec 审查，完整结果记入既有证据双文件，
不跨 checkout 合计。

进一步 Spec 复核纠正一项设计依赖：冻结合同要求 P12/P13 及 append-only journal
证据，**并未要求**原型的三张新表。未批准 0141 原型仍排除。激活分片仅拥有新增
`catalog-cutover/activation/` 公共模块、测试及双语 README，使用既有 0137 的
run／event／checkpoint 存储与权限。父协调者拥有宿主 journal 和根组合。不扩展
S7 预激活接口、S2 schema、grant 或 trusted baseline；此替代实现不需要这些扩展。

本增量 R3 威胁：伪造 current head、前驱分叉、跨 run checkpoint 重用、用获批报告
自身充当目标 oracle、SQL 提交后文件 journal 提交失败、实时锁丢失和覆盖不可变
checkpoint。动作必须有精确前置条件、真实批准 projection、明确 pending／committed／
unknown 状态与实读 reconcile；读模式消费者必须实际消费已验证状态。写入一个
event 不代表 P12 完成或 startup 批准。P12/P13 与完整根执行仍为内部实现责任，
不再把所选三表提案当作整体阻塞。

生命周期分片拥有 workerRunner／worker 及其既有测试，补齐 stop／start 失败时
实际 pool 关闭、等待进行中的 polling 工作，不改变准入或权限。威胁包含部分启动、
同步清理异常、重复 stop、并行未完成工作和私有错误泄漏。父协调者继续独占
runtimeConnection、API 根、Compose、migration、生成物与指纹。文档影响为本计划
双文件、既有操作／证据双文件及激活模块 README 双文件。

### 已批准的限定合同演进，2026-09-07

用户明确授权从 `f00f94435`（代码 `11d8147a5`、main `cda6737a8`）实施和隔离
验证两项独立 R3 变更。刷新后引用未变，工作树干净。这两项此前待决策状态已被
本次实现授权取代，不重复请求批准。

恢复：S11-RP 保持 capture/verify/restore-check 的 manifest、精确目标、停写及
run-bound token 所有权。纯检查入口不得直接或间接调用执行层。登记全部 storage
模块及依赖，建立独立受控执行合同。恢复消费既有受信包／token，绑定持久 attempt、
来源信任、授权和逐存储实时目标／锁校验。部分／未知结果保留，成功不恢复流量。
全目录 token 禁令仅演进为有穷尽登记和回归的分层，其他禁用操作不变。

Reader：追加下一个迁移（当前 0140，集成前重查），历史 SQL／checksum 不变。
NOLOGIN 能力仅获正式 Kernel SQL 所需 schema USAGE 和逐对象 SELECT。
保留 0138 历史负测，并以真实受限 LOGIN 验证新增显式授权的读取。不含 DML、
所有权、grant/admin option、高权角色可达、治理 EXECUTE 或新增高权系统元数据
读取。报告查询仍用独立 0139 角色。

单写责任：恢复 Scratch 独占 storage 检查／执行归属及测试；reader Scratch 独占
新增迁移、role manifest、真实 Kernel／角色测试；父协调者独占 runtime 根、
controller、生成 schema、指纹发布及最终操作／证据双语文档。分片分别维护模块
双语合同，独立 Standards／Spec 审查后按 reader→恢复顺序集成。测试不得共享
集群级角色；不照搬旧提案。父协调者继续 startup／P12/P13 内部集成。

威胁冻结：漏登记模块、间接／动态跨层调用、命令规避、伪造／过期／跨 run 包及
token、非空／错误／共享目标、跨存储锁丢失、未知恢复结果、导出后源停止、
PUBLIC／owner／间接成员提权、INHERIT／SET／ADMIN 错配、非法读写、错误 Kernel
pins 和 pool 清理失败。封存前需永久负测与真实隔离正向证据。

文档影响：本计划双语、模块合同、ownership／grant manifest、对应测试／指纹、
生成 schema、已有操作／证据双语文件。不重置 trusted base 或扩大无关 allowance。
未批准 #815、真实备份、企业 CA、生产操作、合并或发布。PR #824 保持 Draft；
这两项不能替代真实 startup 与完整 populated controller 验收。

本次从报告`1190ba591`续工，R3职责已实际分配：父协调者独占controller／journal、
根组合入口与全部执行；release分片独占handoff锁存活；runtime分片新增startup／
真实状态读取；recovery分片新增controlledRecovery adapter及测试。独立预审发现
历史重放早于当前核验、旧日志句柄覆盖新提交、跨run未知结果、锁进程死亡及停写后
resume身份不匹配。这些是实现缺口，不是外部环境依赖。P12/P13沿用既有ownership
与批准语义；unavailable常量本身不构成新增批准要求。不修改冻结grant或Policy决策。

第一组Red在`1190ba591`加测试后得到5通过、2失败：旧句柄覆盖新日志、接受符号链接。
首段修复在独占写锁内比较当前digest，使用独占临时文件、文件及目录fsync，拒绝不安全
日志文件；工作树journal／controller回归19/19。下一段实现跨进程／run的持久phase
intent与重放前真实目标核验；每项外部效果仍须在部署锁存活期间重新观察身份。
Documentation Impact：先同步本计划双语文件，实际adapter执行后更新既有运维及证据
双语文件。组件结果不代表完整升级或生产就绪。

初始开发base为`67d4a7732`，继承报告head为`1a9ba7745`；后续刷新发现纯文档
PR #823，origin/main为`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。
父阅读新增安全／测试规范，以`7218a43dcd5402d52b5e57166b746d0c6409642f`
追加合并，未改写已有提交或重标测试。独立M1备份仍基于`67d4a7732`，
源部署始终为`82344044…`。

M1 已完成精确四项旧依赖删除、永久重引入反例及独立 Standards／Spec 审查。
`ffc240498` 最终全量 scripts 为1301通过、1项source-lock超时、5跳过；boundary
通过。冻结源锁性能决策解决前仍为Scratch，未创建PR或执行Hosted。远端M1分支仅是备份，
不是发布批准。

M2所有权细化：`m2_runtime` 单独写追加0140迁移与治理读端口，父未修改该迁移；
`m2_release` 写S7精确转换manifest、S6管理导入和证据Archive能力，保留分类与不可变历史；
`m2_recovery` 写固定入口身份／私有输入保护及受控包恢复。父单独写Compose／Dockerfile／
ignore规则、根入口、生成文档和最终集成。父独立审查要求新reader角色拒绝既有未核验能力，
不能向治理writer授予宽泛Catalog／audit SELECT。

当前已集成报告动作绑定、受限登录启动、治理分池、正式定义精确映射／源指纹、源停止后仅
消费包恢复、首次handoff及Catalog Compose凭据／profile／外部卷配置。这些不等于M2闭环。
P2真实停写、阶段化resume、P12/P13 producer归属、退休后完整报告／runtime loader、
完整消费方与业务权限、浏览器／容量及根入口成功仍待完成。秘密必须置于候选构建上下文外；
`.dockerignore`防御不替代固定descriptor的私有输入校验。恢复包限制、企业网络与真实数据
证据独立记录。

## 续工：M1与M2

### 当前集成所有权

父已集成 capture 及 typed 批准持久化至 `35770b7e1`；恢复负责人实现的真实
authority／approval producer 已集成为 `0d87cbf20`，`b8378f9f4` 已将真实认证批准接入
四例实际 Docker 恢复；现复验后续签发锁增量。父负责剩余 CI 组合修复、报告证据与交付；activation 提供
独立 Spec 审查。reader 和报告读取能力审计已通过各自真实受限登录通道。
生产根入口仍缺真实 current-state producer 及实际 P12／P13 lineage。
P12 schema、S6 业务能力决策分别保留；管理 lease challenge 可在不新增运行身份
系统权限的前提下继续实现。任何组件完成均不改变生产停止边界。

父协调者拥有既有 journal 的 typed recovery capture 事件及采集桥接。
source/package 摘要来自真实 capture 返回，不接收调用者 JSON；采集前持久化
pending attempt，未知 journal 结果保留包并禁止重试。旧 hash-only 事件可检查，
但不能提升为可信 producer 记录。每步核验由模块签发、精确配置根目录的实际
host lock；这不证明完整停写 producer，也不授予恢复。Recovery Scratch 仅拥有
五文件 deployment authority 适配，使用真实 production 认证及私有每 run 指派，
不新增产品 role 或默认 admin 映射。journal、handoff、controller 仍由父单写。
文档影响为本计划伴随对、恢复执行合同伴随对及既有运维／证据伴随对。

父协调者拥有数据库基础层及组合根。`codex/pr824-p12-contract-scratch` 在
`9b7af682c` 保留追加 0141 和 `catalog-cutover/activation/`：仅管理阶段的
mapping epoch 与 P12 CAS，与 P5 和实际消费路由分开。完整 server 集成证明
新增三表需要另行 S2／S2-RBAC／S2-PGH 决策；S7 现有归属不授权更改冻结 schema。
父追加显式 revert `68304f9bf`、`d4640da40`，将未封存原型从两项已获批变更
分离；未 reset 历史、未更改历史迁移。原型与其独占验收通道一并分离，不是
跳过已有实现测试来声称通过。限定 schema 决策后，应一起恢复实现和通道，
分别验证历史／当前 schema，并重新执行受影响验收。

父协调者新增可选的逐次连接借出核验，使管理 owner 的目标挑战覆盖 Kernel
实际使用的 session。在另一连接上前后探测并不足够。hook 只接收借出的查询
session，在调用者第一条语句／BEGIN 前执行，也覆盖正式 Kernel 取得的 raw pool。
失败销毁连接并保留准入错误；验证等待期间不得暴露 session。不向 Kernel 外传
事务，不增加数据库权限。回归覆盖根查询／事务、raw promise/callback 借出、
延迟和清理。通用 hook 本身不是目标证明或批准，owner 必须提供真实 nonce／
物理目标观察。文档影响：本计划双语、基础层说明和 activation 合同；执行后更新
操作／证据文档。reader 与恢复仍保留独立审查和执行 SHA。

新preflight确认base `67d4a77325b6009b77c2373bd788298a6d022bcf`、继承报告head `1a9ba7745b6f4e0ba1e52aede3e0ee5fe1ab6016`，候选工作树干净。源部署不变。M1仅为可独立审阅的安全拦截；M2必须完成真实隔离升级成功链，二者分开。

父智能体负责M1 CLI／债务删除、固定入口交接、共享upgrade／Compose／migration、集成及交付。`m2_release`负责既有release-gate脚本及测试；`m2_runtime`负责运行连接／启动文件及测试；`m2_recovery`负责备份包恢复adapter及合成恢复测试。各自独立Scratch，父智能体串行集成；无人获准生产操作或扩大权限。

增量威胁审查：保留诊断absence与发布拒绝的区别；仅移除已证明无用的导入及四个精确债务ID，拒绝回引，保留冻结fixture／relocation／base；交接先绑定artifact／daemon／project／storage身份再产生效果；报告取真实状态；运行初始化先于所有队列效果且不修表；恢复只消费验证过的包及外部秘密输入，绑定目标，部分／未知结果停止。包验证须防文件替换、路径穿越及陈旧Redis AOF。此处补充下方矩阵。首个Red为继承boundary失败，随后在CLI诊断入口验证禁止加载退役模块。

文档影响：继续更新本双语计划、既有双语操作／证据文档及模块所属运行／恢复说明，不新增重复状态报告。内循环只跑focused；里程碑PR前完成build／contract／docs及独立审查。schema追加后旧值保留不等于canonical转换，sentinel RDB恢复不等于AOF部署形态恢复。

当前状态：SCRATCH，未完成。刷新后的base／候选、执行结果及boundary／发布阻塞见[执行证据](../../../../ops/self-hosted/populated-upgrade-evidence.zh-CN.md)。下段保留开工preflight记录。

PREFLIGHT，风险 R3。源部署始终为 `82344044b436a8dafecefbb85dfd724cecb05e3f`；重新 fetch 的开发基线为 `origin/main@1c9fa56e3eaca6e7984f35a097876772a6e4025d`，与用户提供的 main 无差异。源计数和镜像身份仅为用户提供的历史观察。本地独立干净工作树使用 `codex/populated-upgrade-scratch`。本轮止于审阅候选／PR，不合并、不关闭历史单、不批准发布、不访问生产。

最新代码候选 `21f5aa4a8bdbb7208504396bce62796cf55875da` 已有真实Binding
producer／import组件50/50、最终兼容／门禁63/63及build通过证据；恢复35/35
保留其自己的执行提交，不合并计数。根升级里程碑仍未完成。具体停写／恢复boundary、
journal adapter／reconciliation、分阶段handoff、runtime／public状态生成链、
完整业务／浏览器／容量仍由父协调者承担，缺真实备份不阻止这些独立开发。

旧 governance EXECUTE 提案未获批准，不属于 0140。本轮独立决定涉及冻结
source-lock 准备成本、P12 三个管理表及 S2 合同、S6 Binding／Value 业务读取，
以及 #815 权威计数或明确批准的 unavailable 契约，均不默认批准。
其余 P12/P13/controller 实现仍由父负责，不能把 unavailable 常量本身当作外部
决策。P12 原型单独保留；PR #824 为 Draft。手册提供已测试组件／检查命令，
不编造根升级／生产命令。

## 文件所有权与依赖

### 2026-09-07 增量

父智能体继续实现，不把缺生产授权当作代码阻塞。父负责 controller 准入、S7 P4
接线及固定准备 pins、文档和实际测试；release lane 负责受控迁移／结构 receipt，
runtime lane 独立审查管理与 P4，recovery lane 独立审查 controller 跨 run 准入。
真实 PostgreSQL 测试使用独立集群，不共享集群级角色。

新增 R3 威胁：看似存活的失效宿主锁、文件／目录 fsync 结果未知、另一 run 未决的
Binding／管理 attempt、await 后输入被修改、search_path 重定向、冻结后新增表／列、
另一候选借用管理 receipt、ledger 未变但物理 schema／ACL 漂移、resume 跳过历史 P4
适用性。receipt 只证明实测准备，不批准发布；P4 绑定外层准备 run／plan 和候选
SHA／tree，避免与后生成的 S7 digest 循环依赖。

新增真实矩阵使用独立自有 `postgres:16-alpine`；pgvector Catalog lane 及必需 setup
保持原约束。恢复已加入两个 PG16 bootstrap 身份、原 MinIO 版本、AOF 和数据库属性
不支持时拒绝的真实三存储包测试。精确批次（含 setup 失败、零收集误调用）记入既有
双语证据，不能混加不同 SHA。

文档影响：本计划及中文伴随、既有操作／证据双语文件。终端组合根、全部源消费方
producer、既定 ownership 内的 P12/P13、完整新报告链、运行启动／pool、应用／浏览器
和容量验收仍由父负责，是内部开发缺口。真实备份、企业 CA／网络、生产授权及单独
记录的 Policy／权限决策是不同外部依赖；二者均不关闭 M2 或 OP-09。

| 包 | 所有者与范围 | 依赖与成功条件 |
| --- | --- | --- |
| A | 父协调者：双语计划、证据、操作手册 | 实现前冻结威胁矩阵，独立 Spec 挑战 |
| B | 父协调者：reconcile CLI、升级 shell、交接工具与测试 | 真实旧调用失败关闭；诊断不作为发布批准 |
| C | 父协调者：verifier/controller 接线 | B、角色与恢复合同；保留 unavailable 边界 |
| D | 身份／恢复 lane，先只读审计运行根与角色 | 编辑前明确交接；真实受限登录验证 |
| E | 身份／恢复 lane，先只读审计恢复模块 | 隔离三存储证据，不充当目标证据 |
| F | 构建 lane：build-network 专用工具与测试 | 复用现有策略，合成证书与企业 CA 分开 |
| G | 父协调者：预演、文档、完整文件交付包 | A-F；真实备份和生产批准为外部依赖 |

升级 shell、Compose、运行时组合根、migration、生成文档和 fingerprint 各由父协调者单一写入。保留其他工作树。共享 schema 开发 WIP 为 2；不重叠的构建工作可并行。固定候选后并行 Standards／Spec 审查；集成就绪后运行一次最终 Hosted，不反复跑广域测试。

## 威胁矩阵

### PR #824 续工

父协调者单写 runtime admission、API/worker 根入口及本计划双语文件；
独立 CI Scratch 负责恢复执行归属，独立只读 Spec 审查启动事实与权限。
刷新后 main 仍为 `cda6737a8`，head 为 `7fabeb8c4`。Hosted `34067803219`
实际执行 merge-ref `51ec49131ea542d499607021c20012ad1b39266c`：scripts
1427 通过、1 失败、39 跳过。失败为恢复执行器的 `pg_restore` 命中 S11-RP
合同，不是历史 source-lock 超时。本机同 selector 对照已复现候选失败、base 通过。

新增 R3 威胁：namespace 缺失绕过应用启动核验；报告反填当前状态；管理凭据
进入运行池；隔离启动提前消费业务；公开重启借用旧批准；初始化失败泄漏连接
或私有诊断。独立 Spec 已确认 namespace 与 worker 清理边界。
生产缺少 DATABASE_URL 已由 env 校验拒绝，不重新包装为新缺陷。

真实进程正向仍需 P12/P13/current-pin 的真实 producer。已获批的 0140 Kernel
reader 已实现并验证，与 0139 报告读取分离；历史 0138 负测保留。reader 与恢复
执行分层两项已在批准范围内落实，不再等待相同决定，也不授予 S6 业务读取或
批准独立 P12 schema。不得授予 synchronizer 或制造 passed 报告。继续初始化及
controller 独立工作，不放宽扫描、grant 或 timeout。文档影响为本计划及已有
操作／证据双语文件。Draft 仍是部分交付，本轮不授权生产操作。

| 威胁 | 必需观察／责任 |
| --- | --- |
| 缺参数、absent、未批准、blocked、未知参数 | 真实 CLI 非零 typed 拒绝，B |
| 旧升级器调用新检查 | 不因诊断成功恢复流量，B |
| 跨候选／目标／release／mapping／source、旧 purpose／attempt | 复用 verifier 精确核验，B/C |
| 预激活批准借用于运行或公开发布、伪造批准 | 各动作独立拒绝，C |
| apply/resume/recover-candidate/no-op 绕过 | 所有可达放流路径有门禁；旧服务恢复分开，B |
| 缺阶段、乱序、并发、未知提交结果 | journal／锁拒绝，不重置或猜测，C |
| 假 fresh、部分迁移成功、checksum 漂移 | 完整库存识别；历史 SQL 不变；重试证据，G |
| 超级用户、继承／DEFINER 提权 | 真实受限登录正向与反向 PG，D |
| 错数据库／主机／Compose／卷／桶／Redis、部分恢复 | 保持隔离，仅显式绑定恢复，E |
| 写入／投递／公开流量之后指针回退 | 持久拒绝，E |
| 不可信／过期／错误证书、insecure 就绪 | 拒绝；受信合成链成功且无秘密泄漏，F |
| 值／历史／受保护引用丢失、未知 Policy 被算零 | 全量分类与独立 oracle，不用计数相等替代，G |
| pgvector lane 被当成源数据库镜像兼容 | 单独扩展兼容证据，G |

## 测试层次与停止边界

先 Red 后 focused Green；真实子进程退出码、PG 迁移／角色、隔离 Compose 顺序、合成存量语义、build／contract／boundary／selfhost／docs。可见改动按 playwright-cli 三种视口验证。各次执行记录精确 SHA/tree、命令、退出码和收集／通过／失败／跳过，setup 失败不算零用例通过。A 合成、B 授权真实备份副本、C 生产分别记录。

尚无授权真实备份、企业 CA 或生产窗口批准。#815 仍需权威关联或明确批准 unavailable 合同。冻结阶段若 unavailable，记录缺失集成，不伪造实现或批准；继续独立工作。

## 文档影响矩阵

| 改动 | 英文 | 中文 | 门禁 |
| --- | --- | --- | --- |
| 范围／威胁／证据 | 英文计划 | 本计划 | docs:check |
| 升级／诊断／交接 | upgrade.md | upgrade.zh-CN.md | CLI 回归与 docs |
| 运维步骤 | 新存量升级 runbook | 中文终端手册 | 仅引用真实测试入口；缺失步骤明确标记 |
| 构建信任 | 现有构建文档按需更新 | 对应伴随文件 | 证书反例 |

## 文档更新门禁

双语同批更新，生成器更新生成产物。完成前运行 `npm run docs:check`；独立交付和限制记录完成前计划保持 active，代码完成不推出生产就绪。
