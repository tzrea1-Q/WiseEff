# 初始化期间的信号处理

[English](processSignals.README.md)

`server/index.ts` 和可执行 `workerRunner.ts` 在第一次异步数据库或队列初始化
之前接管 SIGINT/SIGTERM。重复信号共用一次关闭 Promise。信号请求取消；当前
初始化先结算，随后关闭它已经交付的资源。异步分配后的检查阻止后续 listener
和消费者创建。已经进入初始化的队列仍沿用原有 factory 与排空行为，本改动不
在 BullMQ 内部新增取消机制，也不改变队列准入。

API 复用原有请求、worker、pool 排空流程，支持 listener 尚未创建的阶段。
worker 在提前停止时关闭已准入的 runtime，不继续监听或启动消费者。原准入
错误仍然失败关闭，根入口保持静态诊断。不改变 Catalog projection、权限、
runtime purpose 或报告批准。

`processSignals.test.ts` 的两个子进程用例使用真实 OS 信号、IPC 和 TCP listener，
数据库资源与活动处理是明确的测试替代。晚回调必须先结束，再关闭模拟 pool；
仅观察进程退出不能通过。模拟原有“初始化之后才注册监听”顺序的基线是
1 通过、1 失败，修复后两项通过。这不是旧生产根入口的实际执行。
`workerRunnerBootstrap.test.ts` 另用既有准入替代核对真实根函数的提前停止清理。

新增 owned Redis 用例在子进程中运行实际 queue runtime 和 BullMQ 任务，在
处理被保持时依次发送 SIGTERM、SIGINT，要求只排空一次，再关闭明确的数据库
替代。测试消费父监督器现有私有 Redis receipt，子进程不创建 Docker 资源。
新增用例尚待实际 owned lane 执行。上述测试不证明真实 PostgreSQL 业务作用，
也不代表已批准的 production API/worker 启动成功。

调用者聚焦测试使用既有 runtime bootstrap selector，类型检查使用
`tsc --noEmit -p tsconfig.node.json`。父智能体负责将新纯测试登记到
`vitest.runtime-bootstrap.config.ts`；登记前的开发专用配置只显式选择
`server/processSignals.test.ts`。已有 `log-redis` owned suite 会收集新 Redis
用例，不新增资源 profile，也不提高 timeout。
