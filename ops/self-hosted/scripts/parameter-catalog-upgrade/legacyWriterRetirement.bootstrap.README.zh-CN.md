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

## 宿主 journal 中的持久认证步骤

bootstrap 分支将上述 SQL 事件绑定到原宿主 journal。实际根准入和私有凭据 custody
准备完成后，`bootstrap-retirement-pending` 必须完成文件及目录 fsync，才能派发首次
SQL intent。typed payload 分别绑定宿主 run 与 cutover run、完整 root binding
（含 P12 intent/报告）、原 capture 摘要、SQL request 摘要和非秘密 custody version。
密码、密码 hash、连接 URL 均不进入该宿主事件。

只有既有 `applyBootstrapCredentialFence` 的提交确认，再加实际
`inspectBootstrapCredentialFence` 返回相同摘要，才能产生
`bootstrap-retirement-credential-step`。根另读回唯一且未变的 SQL root request，并复核
guard、目标、源、恢复包和报告。每次追加前后核真实宿主锁和原私有 journal 目录 FD。
全记录 CAS 只推进到本次根调用自己的已确认追加，不能采用 await 期间的外部修改。
记录不改变 controller 状态、phase、next action 或 pins。

效果不确定时，仅在宿主边界仍可用时追加 `bootstrap-retirement-unknown`，否则保留
pending。二者均不授权再次轮换，即使调用者换新 attempt。若 rename 已成功但目录
fsync 失败，诊断读取可能看到 credential-step；保留的 write lock 仍令正常读取拒绝。
不自动移锁、确认结果或重试效果。独立 inspection 继续读取原 SQL request、custody，
通过仅使用新密码的 transport 核验；它不会提升宿主 pending/unknown。后续 reconcile
必须结合这些实际根观察，不能仅凭宿主记录确认。

本增量仅支持 bootstrap，复用 0137，不增 schema/grant，不写 P13 checkpoint、不宣称
全部 writer 退役、不发行 runtime generation 或发布 startup。测试使用真实宿主文件、
CAS、fsync 故障，SQL、Docker、报告和 activation 仍是显式根编排替身。它们证明持久性
和派发顺序，不证明完整获批 P12/P13 的 PostgreSQL 根执行。最初四条真实回归失败与
更早一次夹具自身的 mutation 失败分别保留；历史 27 例 PG 不重标为本次宿主接线证据。

## 锁与生命周期

| 会话或步骤 | 必需事实及兼容边界 |
| --- | --- |
| 独立 guard | 既有受限管理 LOGIN，无可达高权角色；显式 SET 到既有 migration owner |
| guard 身份 | 已独立定位的 OID 10 会话观察精确 PID/advisory 挑战，不新增系统函数 EXECUTE |
| guard 库存锁 | 六张既有 Catalog/mapping 表的 SHARE 锁跨底层两次提交，并保持到最终读回 |
| bootstrap 管理会话 | 唯一 S7 session 锁持有者；短只读事务在同会话检查当前 P12 |
| 底层效果 | run/event 写入与角色修改不写这六张表；真实双会话兼容由下文 `290b0e240` 执行覆盖 |
| guard error/end | 立即销毁写入连接；执行开始后的不确定结果保留 unknown |
| 清理 | 两个 lease、pool、custody 和包目录均尝试关闭，后续错误不覆盖原拒绝 |

`acquireBootstrapInventoryGuard` 是根实际使用的资源实现，既有独占 PG 夹具也调用它。
它不提供 P12、恢复或退役授权，不取得凭据，也不执行阶段动作。guard 不取得 S7 锁，
此锁只属于 mutator；生产连接池容量不变。每次 verify 实查六张表锁与 mutator 的 S7 锁，
guard 丢失立即销毁真实 mutator。

底层 `beforeEffect` 生命周期约束由根自身闭包安装，不接受根调用者输入的 callback。
闭包在每次事件追加、密码写入、COMMIT 前及首次 COMMIT 后复核真实 issued 宿主锁、
源/恢复包/journal 边界、持有的 guard 与正式报告投影。它复用既有会话，不开启嵌套事务。
不带该钩子的底层 API 仍仅是管理组件，不是正式维护入口或发布批准。
报告留存期限可能在六表锁仍被持有时到期，因此旧的通过投影不能代替每次效果前的复核。

inspect 只重开原持久 custody 版本，不生成新 secret、不重试 ALTER、不重置 journal，
也不把 intent 当成功。只有根 intent、尚无底层 intent 的中断仍为 unknown；本分片不
自动重试此状态。返回 `bootstrap-authentication-fenced-not-p13` 之前仍须核实当前
P12/恢复包/锁，并取得同一版本的底层真实读回。

轮换成功后，原源密码和原管理密码都不能再连接。inspect 因此要求通过既有凭据保管者的
受控维护输入，显式提供当前有效的私有 `administrativeConnectionString`；源 URL 保持
原样。适配器不猜新旧密码、不使用 ambient 配置、不新增返回密码的 API，也不自动构造
该私有输入。当前根替身回归证明 inspect 不重连已拒绝的原源凭据；由独立进程执行、
带真实获批 P12 与 capture 前驱的完整根 inspect 仍未运行，不能用底层独立进程结果覆盖。

## 验证范围

直接根测试执行实际根函数与真实私有 custody 文件生命周期，但 PostgreSQL、Docker、
批准及 P12 观测使用 I/O 替身。它们仅证明派发、绑定、拒绝和清理，不证明实际获批升级
或实际密码轮换。此前底层 PG 认证结果保留自己的 SHA。完整根集成仍需
合法 P12/报告/恢复前驱夹具；不得通过插入 passed
报告获得证据。本分片不提供生产命令。

追加 PG 回归在真实 prepared run 上执行本根 guard 与既有认证效果，保留原 22 用例及
超时，并追加受限 LOGIN/SET 反例、跨两次 COMMIT 锁兼容、真实 guard backend 终止、
真实宿主锁进程终止，不把 prepared run 伪造为 P12 checkpoint 或报告批准。

| 实际候选 | 执行及范围 |
| --- | --- |
| `dba3e7f8d` | 父 owned `bootstrap-credential-pg16`：25 通过 / 2 失败，5.49s，exit 1，清理已核验。宿主锁退出仍能继续密码写入；另一夹具错误地期待镜像既有 `pg_control_system` 权限拒绝。该轮 guard 正向尚未进入两次提交。 |
| `290b0e240a1cdda22bfff7bedfbe5207f3c10a22` | 同 owned selector：27 通过 / 0 失败 / 0 跳过，5.55s，exit 0，清理已核验；跨提交 guard、认证读回及宿主/backend 失效反例通过。 |
| `22bdf0e1d462635cd17b39ce4f4c13ad1681efff` | 后续仅根报告留存复核修复：75 pure 根回归及 targeted strict types 通过；其 Red 为 14 通过 / 1 失败。此结果不重标上面的 PG 执行 SHA。 |

父使用 `postgres:16-alpine`，linux/arm64，实际 image ID 为
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
原始 Red/Green 日志 SHA-256 分别为
`704b6106abda7548b99f7fc26afad0c4c61ef7924f78beab51feaf8d8c1fb28c` 和
`b770f8952c3c67ef244f4c85695381d26dc0da20663fc9abdcfed8c91fbd0a06`。
它们属于隔离组件证据，不是完整根批准、startup、P13、业务队列、Hosted 或生产批准。

文档影响为本根适配器中英文说明；父协调者维护唯一升级主计划及后续 controller/startup 接合。
