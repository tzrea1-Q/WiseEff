# 受控退休端点测试

> English: [English](retirement-endpoint-supervision.README.md)

开发组件执行器拥有全部端点夹具资源。它不是生产退休、恢复、批准或升级入口；
继续复用既有本地 daemon 防护和 Hosted 身份准入，不接受部署数据库 URL。

执行机器为已独立批准的开发 Docker Desktop 主机，用户为开发者，目录为固定、
干净的候选工作树。前提是锁定依赖已安装、本地已有 `postgres:16-alpine` 镜像。

```bash
: "${UPG_EXPECTED_DAEMON_ID:?approved development daemon identity required}"
env -i PATH="$PATH" HOME="$HOME" node --import tsx \
  scripts/run-upgrade-component-tests.ts \
  --expected-daemon-id "$UPG_EXPECTED_DAEMON_ID" --suite retirement-existing-pg16
```

父进程创建常规独立组件集群，另建带随机身份的网络、两个 PostgreSQL 容器和
两个端点探针。端点容器使用实际观察的镜像 ID；数据库使用随机凭据，测试仅经
私有 0600 receipt 获取。探针使用不同别名，其中一个故意设置 hostname 为
`postgres`，用于验证名称解析歧义。数据库使用 tmpfs，不涉及生产卷，也不是备份预演。

首次创建端点资源之前，父进程把完整名称、归属随机标识及镜像写入私有计划并
fsync；返回的真实 ID 另行追加并 fsync。创建结果未知时，只按预声明的精确名称、
归属和镜像核对。外来或漂移对象不删除；清理失败使整次执行失败，并保留私有证据
目录。每次就绪检查也核对父进程是否已收到终止信号，终止后不启动测试子进程。

常规组件 profile 的网络、数据卷和服务容器也遵守同一规则：三个资源均有精确
预声明名称及 fsync 后的私有计划；即使 `docker run` 返回结果丢失，服务容器也有
明确的 Docker 名称。清理时按该名称和 run 归属核对，容器还核对镜像。某个清理
步骤失败后仍检查其他资源，拒删外来对象，并保留失败证据。不能因未收到 ID
就认定资源从未创建。
创建返回的资源在任何后续创建之前核对归属，覆盖 Docker 将同名既有卷作为成功
结果返回的情况；挂载服务之前再次核对网络和卷身份。

业务文件只消费 receipt，可对本次探针执行启停及有界网络别名故障，不创建或删除
Docker 资源。监督文件同样只消费 receipt，终止拒绝 TERM 的子进程组，并核对父进程
仍拥有全部端点。该用例本身不证明 Vitest 被终止后父进程已清理。另一条外层故障
实验以较短的进程内监督预算调用 `runUpgradeComponentTests`，记录不含秘密的端点
观察，待父进程返回失败后核对每个精确容器和网络已不存在。故障注入没有 CLI 参数，
不能提高正式 15 分钟、8 MiB 输出及 2 秒终止宽限预算。

`vitest.upgrade-retirement.config.ts` 强制收集两个精确文件，缺 receipt 或零收集
均失败。普通 server/scripts 套件排除这两个文件，由已有强制 Hosted 组件 job 承担。
若组件文件未集成，入口在创建资源前拒绝。既有权限及解析断言和超时保持不变。
即使本次资源全部清理成功，超时也仍是失败。父监督进程自身遭 SIGKILL 或宿主丢失
不承诺自动清理；私有持久计划用于后续明确检查，不能据此盲目删除资源。

文档影响仅包括此双语文件中的夹具归属、强制路由和监督证据。产品权限、P13 语义、
迁移清单、grant 及部署操作保持不变。完整 controller、获批 P12/P13 和生产启动
仍需要独立证据，组件成功不能替代这些验收。
