# Bootstrap 源认证退出适配器

[English](legacyWriterRetirement.bootstrap.README.md)

本分片为既有 `retireLegacyApplicationLogins` 根适配器接入精确 OID 10 源登录。
它不放宽普通角色 fence，也不标记 P13 完成。依赖候选为
`8ed7ac196b34caf351e7331f6e2be15ea7f8a5d3`；Scratch 分支从本地 main 创建后推进到
该精确候选，再进行本文件归属内的修改。没有新增 migration 或 grant。

根入口仍核实已停止的 handoff、源实际解析端点、原凭据建立的真实 backend、当前
P12 binding 及正式批准报告投影、同停写边界恢复包、目录 inode、目标身份和真实宿主锁。
bootstrap 路径另要求显式私有 `bootstrapCredentialDirectory`，它必须是本 run 锁定私有根
目录的直接子目录，且在备份包之外；没有默认目录或密码参数。
旧密码来自已核验的源容器 URL；既有 custodian 创建并同步新私有版本，密码及 hash
不进入根事件或返回值。

调用正式 `applyBootstrapCredentialFence` 前，根在既有 0137 事件表追加
`bootstrap-application-authentication-intent`，绑定 P12 intent/binding、handoff 与恢复摘要、
目标、attempt、custody 目录及已发行 receipt。此事件不是 P13 checkpoint 或运行权限。
底层继续拥有自身 intent/applied 事件以及认证、owner、ACL 不变量。

## 锁与生命周期

| 会话或步骤 | 必需事实及兼容边界 |
| --- | --- |
| 独立 guard | 既有受限管理 LOGIN，无可达高权角色；显式 SET 到既有 migration owner |
| guard 身份 | 已独立定位的 OID 10 会话观察精确 PID/advisory 挑战，不新增系统函数 EXECUTE |
| guard 库存锁 | 六张既有 Catalog/mapping 表的 SHARE 锁跨底层两次提交，并保持到最终读回 |
| bootstrap 管理会话 | 唯一 S7 session 锁持有者；短只读事务在同会话检查当前 P12 |
| 底层效果 | run/event 写入与角色修改不写这六张表；真实双会话兼容仍待验证 |
| guard error/end | 立即销毁写入连接；执行开始后的不确定结果保留 unknown |
| 清理 | 两个 lease、pool、custody 和包目录均尝试关闭，后续错误不覆盖原拒绝 |

inspect 只重开原持久 custody 版本，不生成新 secret、不重试 ALTER、不重置 journal，
也不把 intent 当成功。只有根 intent、尚无底层 intent 的中断仍为 unknown；本分片不
自动重试此状态。返回 `bootstrap-authentication-fenced-not-p13` 之前仍须核实当前
P12/恢复包/锁，并取得同一版本的底层真实读回。

## 验证范围

直接根测试执行实际根函数与真实私有 custody 文件生命周期，但 PostgreSQL、Docker、
批准及 P12 观测使用 I/O 替身。它们仅证明派发、绑定、拒绝和清理，不证明实际获批升级
或实际密码轮换。此前底层 PG 认证结果保留自己的 SHA。本次根集成仍需真实双会话锁
兼容、提交期间 guard 终止，以及完整合法 P12/报告/恢复前驱夹具；不得通过插入 passed
报告获得证据。本分片不提供生产命令。

文档影响为本根适配器中英文说明；父协调者维护唯一升级主计划及后续 controller/startup 接合。
