# 旧 LOGIN 退休

> English: [English](README.md)

本 R3 分片仍处于 Scratch。数据库动作禁用精确的旧应用 LOGIN，并移除指向它们的
成员关系；不删除 owner、ACL、角色、密码或源数据。原有能力必须仍由同一已验证
恢复包完整表达，不授予新权限。管理连接必须与被退休角色分开。

仓库尚无名为 `retireLegacyWrites` 的正式执行器，原 P0–P10 orchestrator 明确将
P13 保持 unavailable。前置公开接口是
`createApplicationReadActivation().inspect(activationIntent)`，使用 0137 既有存储，
不新增表，核对精确 intent 和完整当前 binding，不代表当前运行批准。本分片不能
取代 verifier，也不能把登录禁用结果当成所有旧
写入口退休。路由、Agent、后台任务、触发器以及新的完整 V01–V17／D01–D09
切换后验证仍须分别完成。

## 增量威胁矩阵与所有权

| 威胁 | 必须观察到的结果 |
| --- | --- |
| 调用者只传角色名，冒充旧应用身份 | 使用旧应用真实凭据连接，将后端绑定到管理连接实测物理目标，读取实际角色名称和 OID |
| 错误数据库或宿主锁丢失 | 修改角色前拒绝，提交前重新核验 |
| 当前 bootstrap 或恢复格式无法表达的高权角色 | 不修改并拒绝，不编造能力缩水的恢复策略 |
| 其他数据库中的成员、owner 或 ACL 关联 | 拒绝共享范围，保留恢复材料 |
| NOLOGIN 后仍有旧会话 | 不算退休；NOLOGIN 不会终止连接，也不是停写证明 |
| 并发 controller 或提交结果未知 | 保留持久 intent，只检查，不盲重试或重置 journal |
| 旧角色重命名、替换或能力漂移 | 固定 OID／名称／恢复包比较失败 |
| 数据库围栏只部分完成 | 不恢复应用、队列或代理 |

本 Scratch 独占 `retirement/` 及新增 self-hosted 组合 adapter。迁移、应用连接池、
主 controller、生成 schema 和统一执行计划由父协调者维护。实现变化同步维护
本文件及英文伴随。真实 PostgreSQL 测试只用本轮新建且验证归属的集群，不使用
ambient DATABASE_URL。

v3 恢复包的 bootstrap 是预先存在的 OID 10 身份，不是可转移的高权角色声明。
若禁用唯一 bootstrap LOGIN，却仍依靠同一身份重连管理，会丢失管理通道。这一
情况需要独立证明管理与恢复策略，不能由普通恢复包角色路径静默覆盖。

## 已实现入口及证据边界

`ops/self-hosted/scripts/parameter-catalog-upgrade/legacyWriterRetirement.ts`
创建真实 P12 组件，核验已应用 binding 与当前 Catalog／源清单／mapping 事实，
从现有宿主 journal 读取 capture。按已记录目录 inode 和包摘要重读同一恢复包。
实测已停止的旧容器提供原凭据，以随机后端锁证明真实认证连接位于独立观察的
管理数据库。关键步骤重复检查宿主锁、包、容器和停写边界。

仅支持受控 bridge 的源观察器先证明：原 DATABASE_URL 主机是固定 PostgreSQL
endpoint 的实测地址，或实际自有网络内唯一指向该容器的 alias，端口为 5432；
同一实测容器必须发布精确的 loopback 管理端口。未知网络成员、错误 ownership、
自定义 DNS／hosts／相关挂载、多网络、端口错误或别名冲突均在连接旧 LOGIN 前
拒绝。关键检查重新观察该映射并拒绝漂移。只有 Docker 转发关系已独立证明后，
私有凭据才可使用发布端口；凭据相同本身不是原连接目标证明。本 profile 要求
现有 controlled-recovery ownership nonce 和关闭 IP masquerade 的 bridge；
不支持的部署在 effect 前拒绝。

Docker 配置本身不够：通过 `docker cp` 读取已停止容器的真实 `/etc/hosts`、
`/etc/resolv.conf`、`/etc/nsswitch.conf`。使用现有宿主 tar 工具，只将指定成员
解到有界 stdout，不向宿主文件系统解压。文件缺失或 resolver 规则不支持时拒绝。
本 profile 要求 `hosts: files dns`、Docker DNS `127.0.0.11`、`ndots:0`；真实 hosts
内容不得把原主机重定向到其他地址，容器 hostname 与数据库 alias 冲突也拒绝。
三个文件的摘要参与反复的 endpoint 观察。
不支持容器环境中的 `RES_OPTIONS`、`LOCALDOMAIN`、`HOSTALIASES` 覆盖。每份
Docker tar 必须精确列出一个所请求名称的普通文件；链接、重复成员及多文件
拼接均拒绝。

endpoint 拒绝保留固定 `SOURCE-ENDPOINT-UNPROVEN` 错误，并增加枚举阶段。
诊断只包含计数、tar 退出状态和有限选项分类（`ndots-zero`、`ndots-other`、
`edns0`、`trust-ad`、`other`），不输出 resolver 原文、Docker stderr、主机名或
凭据。这些分类不意味着允许额外 resolver 选项。真实 endpoint 夹具在每次故障
修改前先要求正常基线成立，再核对精确拒绝阶段，避免无关的早期失败被记为
预期负例。Hosted run 34125753813 的失败只记录了外层 catch 位置；本次诊断增量
不代表已确定或修复平台根因，也不改变 endpoint 接受条件或 timeout 上限。

endpoint 拓扑由父监督器创建两台自有 PostgreSQL 容器及使用同一固定 PostgreSQL
镜像的 psql 探针，再通过私有 receipt 交给测试子进程。子进程不创建资源，不能
依赖自己的 afterAll 处理强制终止后的清理。从网络内查询原 URL，再通过发布端口独立比较 system identity，
随后停止探针。指向另一数据库的 URL、错误发布端口和实际重复 alias 均拒绝。
另先证明真实 hosts 文件覆盖使原 URL 访问第二数据库，再停止探针并验证观察器
拒绝；Docker hostname 冲突也被拒绝。探针不是旧 API／worker 镜像，其一次性
数据库使用仅通过私有 receipt／stdin 传递的随机密码，只证明网络映射，
原 LOGIN 围栏用例另行验证真实受限凭据。

adapter 绑定完整 `activationIntent` 与领域 `bindingDigest`，读取正式已获批的
预激活 projection，将 artifact、目标、源、Catalog、mapping、恢复输入逐一
对齐实测 binding 和恢复包。后续 pending／unknown capture 会使其拒绝。这只是
额外的前驱检查；父 controller 仍须通过既有 release gate 调度完整 P13，并证明
全部旧写入口已退休。

管理连接持有 S7 锁后，两个事务使用 `inspectOnHeldManagementSession`，不再从
第二条连接请求同一锁。inspector 检查实测目标、身份、ExclusiveLock、UTC 和
实际强隔离事务，再次核验原边界。SAVEPOINT／RELEASE 探针有局部事务作用，
但不写业务数据、不执行 DDL、不切角色、不 BEGIN／COMMIT。reconcile 使用同一
接口并要求事件绑定仍是当前 binding；旧事件不成为当前运行或发布批准。

`beginLegacyRetirementTransaction` 开始 SERIALIZABLE，设置 synchronous commit
与 UTC，随后对 P12 同样保护的六张 Catalog／mapping 表取得 SHARE NOWAIT 锁。
两个写事务均在首次产生快照的查询前调用它。S7 锁不能独立阻止 mapping 或
installer 写入；在 repeatable read 内重复 SELECT 只会重读旧快照。锁竞争留下
失败事务，由 owner 回滚，该事务不写 intent 或角色 effect。本准备函数不能替代
实际目标、S7 锁和停写边界检查。

`retireLegacyApplicationLogins` 先持久保存 intent，再于独立事务应用数据库围栏和
effect event；COMMIT 开启 synchronous commit。它不创建 P13 checkpoint，不推进
run phase；返回 `legacy-logins-fenced-not-p13`。已有 intent 不是重试许可。
`inspectLegacyApplicationLoginFence` 在结果不确定时只读核对事件、真实角色和后端
状态，不使用已禁用凭据，也不修数据。原 owner／表 ACL 为恢复和历史访问保留，
它们不证明旧写路径零可达。新运行权限、触发器／路由／任务退休、全部消费者
验证及完整 P13 提交仍是内部集成工作。

专属 `loginFence.integration.test.ts` 用真实 LOGIN 调用同一管理作用函数，检查
重连拒绝、成员移除及 owner／ACL／值保留，覆盖错误目标、锁、会话、角色、
恢复材料和跨库关联，并检查已经 SET ROLE 的直接及间接成员会话：NOLOGIN／REVOKE
不会重置其他后端的有效角色，因此保留原始 caller OID 供提交后检查。相同键的共享
advisory lock 仍被拒绝：管理后端必须实际持有已授予的 `ExclusiveLock`；负测在回滚前
核对角色、成员、owner 和 ACL 不变，不让回滚隐藏副作用。这十例仅属于
数据库组件证据，不制造 P12 报告，也未执行
顶层 adapter。父协调者须精确将该文件接入新建自有 PG16 lane，并从共享 server
suite 排除；缺少 receipt 时明确失败，不静默跳过。
跨库共享角色负测的第二个数据库在 suite setup 准备；建库不计入五秒角色作用断言。

修改与检查入口均在 pool 获取回调返回前同步安装管理 lease 错误监听，并保持至
连接销毁。获取失败时销毁已经获取的 lease，脱敏底层连接错误。该资源 helper
不核验目标、不授予权限，也不取代调用者反复检查连接及目标边界。

纯测试命令：`node_modules/.bin/vitest run --config
server/modules/catalog-cutover/retirement/vitest.config.ts`。真实 SQL 由父 runner 使用
`retirement/vitest.integration.config.ts` 执行，不能直接对任意数据库运行。本分片
不交付生产命令或生产就绪结论。
