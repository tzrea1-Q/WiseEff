# 日志 worker 的 Redis 生命周期

> English: [English](../../runbooks/log-worker-queue-lifecycle.md)

本组件管理 `createLogAnalysisQueueRuntime` 和仅供 API 使用的
`createLogAnalysisQueueTransport` 创建的连接，不授予 Catalog 启动、部署发布或
恢复业务队列的权限。两个 factory 都是异步的；调用者必须等待返回后才启动依赖它们
的服务。transport 不启动 Worker。

## 连接与退出契约

Worker 使用 `autorun: false`。Queue 与 Worker 都必须完成 BullMQ 真实的
`waitUntilReady`，才能开始消费。传入的 Redis URL 由 BullMQ 支持 URL 的连接适配器
解析；隔离测试不回退读取环境中的 `REDIS_URL`。认证、连接及异步 readiness 失败
返回 `PCAT-LOG-QUEUE-INITIALIZATION-FAILED`，且返回前关闭已创建的资源。
API transport 复用相同的连接兼容与错误监听，等待 Queue ready，并遵守相同的
幂等关闭契约。

Queue 与 Worker 的错误监听器保留到关闭完成。运行期间可恢复的连接错误仅记录
`PCAT-LOG-QUEUE-CONNECTION-ERROR`，不会让后来已恢复的连接永久失败。关闭期间
发出的错误使应用层 close 返回 `PCAT-LOG-QUEUE-CLOSE-FAILED`，即使 BullMQ
捕获了底层错误并让自己的 close 返回成功。并发和重复关闭复用同一结果。
正常关闭等待实际 BullMQ 任务完成，不强制取消业务任务。构造或清理直接抛错时，
保留既有错误优先级；环境组合根负责这些错误对外输出的脱敏。

## 锁定依赖的兼容处理

已检查的版本为 BullMQ 5.78.0。其 `RedisConnection.close` 会在初始化拒绝处理器
尚未发出错误前移除监听器。`DrainingRedisConnection` 先断开仍在初始化的自有连接，
等待初始化结算，再调用原生 close。Queue 的公开 ready client 通过
`duplicate({ maxRetriesPerRequest: null })` 创建独立自有 Worker 连接，其公开
duplicate 方法在 BullMQ 使用前登记额外的阻塞客户端。初始化失败先断开并结算
这些自有客户端，再执行原生清理；正常关闭先等待 Worker 排空，再关闭自有连接。
不读取 Worker 的任何 private 成员；只有 RedisConnection 子类访问自己的
protected `_client`，不读取 private 初始化 Promise。升级 BullMQ 时必须重新验证
这份依赖契约。

ioredis 的 callback 形式 INFO readiness 失败原本会输出服务器原始诊断，并可能在
NOPERM 时跳过 readiness。本组件只替换自有客户端公开 INFO 方法的错误输出：
保留实际命令和加载检查，两种调用形式均返回静态 readiness 错误。不关闭
ready/version 检查，不替换全局 console 或异常处理器，不修改依赖文件或权限。
格式错误的 URI 转义在分配客户端之前拒绝。两个 factory 都有 production 模式
真实子进程回归，检查静态拒绝和无未处理 Promise 拒绝。

## 威胁与证据矩阵

| 边界 | 必须观察到的行为 |
| --- | --- |
| 连接尚未 ready | 两条 readiness Promise 都完成前不开始消费 |
| 错误密码或自有 Redis 已停止 | 静态拒绝、不调用任务处理器、关闭连接 |
| 已认证身份缺少 INFO 权限 | 静态拒绝，无原始身份或密码日志，无未处理拒绝 |
| 关闭时存在活动任务 | 实际处理器返回前 close 仍等待 |
| BullMQ 捕获关闭错误再发出事件 | 应用 close 拒绝，私有错误 canary 不进入 console |
| TCP 连接被断开 | 重连后实际 BullMQ 任务执行，随后 close 成功 |
| 重复关闭 | 复用关闭结果，不重复释放 |
| 测试目标与清理 | 独立固定 daemon，每个容器、网络、卷均核验归属；本次创建资源的删除操作成功 |

真实 Redis 测试文件为
`server/modules/logs/logAnalysisQueueRuntime.redis.integration.test.ts`。
它复用既有隔离 Docker guard，使用新 nonce、本机已检查的 `redis:7-alpine` 镜像、
AOF、仅 loopback 发布的端口及关闭出站 masquerade 的 bridge。
随机测试密码仅位于私有目录中的 0600 配置。夹具直接启动 Redis，以保持挂载的
私有配置可读，不扩大宿主文件权限；这不证明生产容器使用的 Unix 身份。
仅删除精确身份和 run 标签仍匹配的资源，并核对每次删除的结果；不声称另行扫描了
daemon 上的全部剩余资源。

私有诊断断言只抛出固定错误。永久反例同时检查断言错误的序列化和文本输出，确保
泄漏检查失败时不会再次打印期望秘密或捕获的原始输出。原生 Redis 失败比较也只
保留布尔结果，不把含凭据的错误或客户端对象交给断言格式化器。ACL 夹具失败输出
固定错误，仍会尝试关闭客户端。

处理器是明确注入的受控 Promise，Queue、Worker、Redis 认证、任务投递、重连和
关闭均为真实实现。这不代表 PostgreSQL 权限、真实日志分析业务、已获批准的生产
启动或完整升级与恢复预演通过。

永久入口为 `npx tsx scripts/run-upgrade-component-tests.ts
--expected-daemon-id <独立记录的开发daemon身份> --suite log-redis`。
执行者为开发用户，目录为固定候选 checkout；前置条件是已核验 Docker Desktop
宿主及 daemon 身份。命令创建全新自有资源，不停止已有部署。失败退出非零，
父进程核验清理。私有 receipt 将子进程绑定到实测 Redis run ID、镜像、容器、卷、
网络及 loopback 端点；缺 receipt 是收集失败，不是跳过。子进程被终止时仍由父进程
负责清理。

必需的独立 owned CI Job 执行该文件，通用 backend 明确排除同一文件，永久路由
回归同时核对两端。本地结果仍只是组件证据；排队或跳过的 CI 不能记通过。
本组件不提供生产执行命令。禁止连接已有 Redis 部署或复用测试凭据。
