# 合成恢复授权组合

[English](synthetic-recovery-authority.README.md)

`openSyntheticRecoveryAuthority` 为 `rehearse-upgrade-recovery.ts` 组合既有正式认证、
私有部署身份分配、Incident 确认及 typed 恢复批准模块，不是生产运维入口。
父调用者创建并拥有独立 PostgreSQL 容器和卷；本模块在任何数据库写入前核对
已独立批准的 daemon、精确镜像、run label、网络、发布端点、独占卷消费者和空集群，
随后才新建控制面数据库。没有 ambient DATABASE_URL 回退。
此既有合成脚本的 PostgreSQL identity 是实际 container ID；源与目标 ID 必须与 capture/
选定目标精确相等。这不是替换独立 Docker recovery adapter 的组合 digest 编码。

四个合成 principal 均实际密码登录。Incident owner 的真实 session 经独立受限 LOGIN
调用 `openDeploymentAuthority` 验证，仅有既有五张认证表 SELECT 和
`auth_sessions.last_used_at` UPDATE；operator、platform owner 与 verifier 相互独立。
不构造 passed 报告或批准其他阶段。

私有 assignment 仅绑定本 run、source、target、capture 和 restore attempt。
capture 必须已由 `recordControlledRecoveryCapture` 产生并提交 typed host journal，
本模块不补写 capture，不把 checksum 当成执行许可。实际批准由既有
`recordRecoveryExecutionApproval` 重验包、token、session、目录、锁、journal 后持久化。

源数据库身份由父在真实 capture 边界、停止源之前观察并传入；本模块不重连源补值。
返回仅包含 scoped approval 和幂等 close，不含密码、URL、session 或私有客户端。
close 等待本模块连接和句柄关闭，不删除父 Docker 资源及私有 assignment 证据。
部分准备失败保留原状态，不能重试同一集群来假造成功；模块不恢复存储或启动队列。

纯回归只验证公共入口在复用源/目标容器、伪造锁、错误 scope 时于数据库/Docker 操作前拒绝，
不 mock 成功认证或批准。真实正向需要父执行隔离 PostgreSQL/包恢复流程，当前纯检查
不代表该执行，不代表完整应用恢复或发布就绪。

Scratch 从本地 main `67d4a7732` 创建后快进至父精确依赖 `70c1a3ad0`。
本增量只有模块、测试及双语说明，不修改迁移、grant manifest 或共享 authority。

首次七项纯测试新增私有输入 accessor 反例实际为六通过、一失败；修复后七项通过。
这只证明错误脱敏的 Red/Green，不是 PostgreSQL 认证批准或恢复成功。
