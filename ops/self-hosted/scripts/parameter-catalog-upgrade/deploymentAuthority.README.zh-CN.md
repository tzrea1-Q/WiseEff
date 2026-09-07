# 每 run 的部署运维权限

English: [English](deploymentAuthority.README.md)

本适配器实现既有 Deployment Operator、Platform owner 和 incident owner 的部署／run
职责，不新增产品角色、数据库 grant、验证 purpose、恢复 token 或发布验证器。
产品 Admin／Platform Admin 身份本身不能批准任何动作。

## 信任与准入

固定管理组合根向 `openDeploymentAuthority` 传入独立观测的源数据库身份、精确
target/run、指派摘要和显式私有认证连接，以及可信配置维护者 UID、规范化私有目录。
这些必须来自管理 handoff，不能来自 HTTP body/header 角色或任意请求配置。
维护者准备指派；请求主体和应用容器不能写入该目录。同 UID 的恶意主机管理员不在
此文件权限边界内。摘要只固定完整性，不能单独证明配置来源。

指派 JSON 遵守相邻模块的 `DeploymentAuthorityAssignment`，固定三个不同认证身份，
分别承担 Operator、Platform owner、incident owner，并排除声明的独立 verifier。
它固定 run、完整源目标、有效期、认证数据库观测、精确报告摘要／purpose，以及可选
恢复 attempt／capture／目标。不存在默认身份或通配授权。目录为可信 UID 的 0700，
文件为同 UID 的 0600 单硬链接；符号链接、路径别名被拒绝。适配器固定目录与文件
身份，每次准入重新读取；即使替换后内容相同也拒绝，父控制器须按新来源重新规划。
指派仅给出资格，不是批准，更不是恢复执行许可。

实现自行构造既有 production `AuthContextResolver`，调用
`createLocalAuthService(...).resolveSession`。不接受注入认证回调、development 上下文、
角色字段或 TEST 绕过。会话必须真实、有效、未撤销，并绑定当前有效数据库用户。
server-owned user invocation 保留真实用户及组织；普通 bearer 凭据不证明有人现场操作。

连接池只使用显式管理认证 URL，每次真实 lease（包括重连）都验证身份。高权或可达
角色、成员关系、对象所有权均拒绝。实测认证库须匹配私有 pin；只要名称及 OID 与
源数据库相同就拒绝，不因网络地址不同放行。不同集群的名称／OID 碰巧相同也保守
拒绝。认证沿用既有 public 表查询，并固定每个连接的 search path 为
`pg_catalog,public,pg_temp`。所需权限为 SELECT：`auth_sessions`、`users`、
`organizations`、`user_role_bindings`、`user_password_credentials`；以及只更新
`auth_sessions.last_used_at`。有效表／列权限包含 PUBLIC；清单外读写、序列能力、
DDL、grant option、未来表授权、显式函数授权以及用户 schema 中可执行的
SECURITY DEFINER 都拒绝。通过 PostgreSQL 16 的 `pg_init_privs` 初始化 ACL 基线拒绝
PUBLIC 新获得的受限系统函数执行能力；有效参数授权中的 ALTER SYSTEM 以及
superuser／未知参数 SET 也拒绝。认证不需要此类用户 definer。本组件不执行这些 grant，
不扩大运行 pool 权限。

本地会话解析会更新 last_used_at，只能写独立管理认证库，不能写冻结源。本组件真实
测试使用同一自有集群中的两个数据库，证明数据库写隔离，不证明恢复故障域独立。
若源集群停止后还需认证，必须具备独立可用的认证基础设施及其真实身份观测；本组件
不负责创建该基础设施，也不声称已验证该场景。

## 命令与职责

`prepareReportApproval` 验证真实 Operator／Platform-owner 与被指派的精确摘要／purpose，
返回携带真实用户的 opaque command，异步认证前固定请求字段；这不是已持久批准。
消费方持久批准前必须重新核验当前指派、有效期、目标与阶段，本组件尚未实现该消费方。
既有 `VerificationReportService.approveReport` 仍是正式批准写入口。本组件中的
`approveReport` 明确以 `REPORT-TARGET-ADAPTER-UNAVAILABLE` 拒绝：真实 RootDatabase、
库名／OID 或网络地址均不足以证明报告库物理目标。现有受限报告登录不能查询高权
集群身份，本组件不增加该 grant。父控制器须通过真实目标组合根接入后才可调用领域
命令，不能以任意 pool 或调用者 JSON 冒充目标证明。报告完整性、gates、passed、
独立批准及不可变持久化继续由原领域服务负责，配置摘要不能制造报告。

`confirmRestore` 只验证 incident owner 与精确 attempt／capture／目标，返回不可复制
伪造的不可变确认，状态明确为 `authenticated-confirmation-not-persisted`。
`assertConfirmationCurrent` 重新检查指派、有效期和认证库准入。复制对象不能变成
有效确认。两者均不写升级 journal、不读恢复包、不恢复数据、不恢复流量；真实来源、
当前锁／停写边界和包有效性仍由父控制器检查。

父控制器须把确认与当前 capture／handoff 绑定后持久写入既有 journal，之后才构造
执行授权。进程重启后应读取并验证持久授权记录，不能把 JSON 反序列化成有效的
进程内 capability。正式控制器继续核验阶段、目标及 pin；本组件不授予 startup 批准。

打开／验证失败会关闭新 pool，返回固定脱敏错误。后续初始化失败或正常退出由调用方
调用 `close()`；关闭后使用会拒绝。连接串、会话 token 不进入返回记录或诊断。
用户身份和指派内容属于私有审计信息，不能进入公开交付包。

## 验收与待接线

单测覆盖配置来源、范围、期限、主体独立和伪造。真实 PG 测试在连接前要求既有自有
目标 receipt，运行实际迁移，经真实本地登录签发会话，使用受限认证 LOGIN。覆盖
incident 确认、未指派产品 admin／verifier 拒绝、主体冒用、源库排除、会话撤销、
连接权限漂移、指派漂移及生命周期。Operator／Platform owner 的真实认证确认可通过，
报告写入仍待实测目标接线。早期 `a86b6095d` 组件运行曾调用领域 missing-report 路径，
随后审查发现目标绑定缺口，收紧后的接口取代该行为。两次均不证明合法已通过报告的
批准正向链；不制造 passed 报告、不 mock gates。

固定 handoff 配置／凭据读取、正式 controller 动作、typed capture／approval journal、
当前阶段与 pin 校验、API／worker 生命周期由父协调者负责；本五文件组件没有完成
这些接线。既有自有 component runner 的 `authority-pg16` selector 执行受限登录集成
测试，并非生产 controller 动作；不在此提供生产命令。
生产指派、真实备份使用、恢复、迁移、队列／代理变更和发布仍需单独授权。本组件及
其配置来源／权限边界须接受独立 Standards 和 Spec 审查。
