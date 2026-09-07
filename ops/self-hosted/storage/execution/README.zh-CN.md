# 受控恢复执行层

> English: [English](README.md)

本分片落实用户在 PR #824 报告 `f00f94435d128ff8706ffadedabbee507f79781b`
之后明确批准的独立执行合同，可单独审查。不授权生产连接、恢复、队列投递、代理开放或发布。

## 合同差异

旧 `scripts/run-restore-drill.test.ts` 对 storage 顶层 TypeScript 文件统一禁止
恢复命令；已有采集和执行函数混在同一模块，实际 `pg_restore` 因而违反原合同。
CI `34071070497` 与 `34067803219` 均命中此冲突，不是更早的 source-lock 超时。
用户于 2026-09-07 明确批准真实模块分层及其直接相关的 ownership、依赖检查修订。

新 `scripts/recovery-storage-boundary.ts` 逐项登记全部 storage 文件，包括嵌套模块、
测试夹具及文档，职责如下：

| 层 | 模块 | 允许行为 |
| --- | --- | --- |
| S11-RP 检查 | `recoveryPoint.ts`、`threatMatrix.ts`、`recoveryPackage.ts`、`controlledRecovery.ts`、`controlledRecovery.docker.ts`、`dockerAccess.ts`、`scripts/run-restore-drill.ts` | 采集、验证、restore-check、实际观察；不得导入、重新导出或调度执行层。 |
| 恢复执行 | `execution/packageRestore.ts`、`execution/controlledRestore.ts`、`execution/dockerRestore.ts`、`execution/authorization.ts` | 明确执行恢复，仅接受独立观察身份及持久授权检查。 |
| 测试 | 登记的 `.test.ts` 和 `execution/authorization.fixture.ts` | 合成夹具和故障注入；生产模块不得导入。 |

检查递归追踪本地依赖，包括 storage 以外的 helper，拒绝漏登记、漏文件、无法解析
的导入、动态加载／求值、测试模块依赖和检查层到执行层的路径。字符串常量求值覆盖
拼接、模板和数组 join 规避；采集的可执行程序必须固定为 `pg_dump`。原有 S10-PER
禁止重新实现断言及 `DROP DATABASE` / `FLUSHALL` 禁令继续覆盖两层生产模块。这是有界静态检查
加实际行为验收，不宣称文本扫描可以证明任意 JavaScript 安全。

## 授权与 journal 消费

恢复批准通过 `recoveryApproval` 保存完整批准、assignment 摘要、已认证的 principal
标识及 trace 标识。journal 重算批准引用，绑定前面的 typed capture，并拒绝状态／pin
变化、重复 attempt，以及执行或撤销后的批准。历史仅有哈希的事件仍可检查，但不能授权
执行器。这些持久化校验不负责认证调用者；独立 producer 仍须消费当前有效的正式授权
及维护锁。

执行器每个存储步骤都要求 journal 所在私有父目录的原始模块签发宿主锁。普通
`assertHeld` 回调、无关／祖先目录锁、已释放句柄或被替换目录均不能授权副作用。
批准 producer 在持久化前也约束 journal 直接位于该目录，合成夹具同样遵守。

父 controller 必须依次写入既有 journal：

1. `recovery-package-captured`：`inputDigest` 为
   `recoveryExecutionRecordDigest(RecoveryCaptureRecord)`。
2. `recovery-execution-authorized`：`inputDigest` 为
   `recoveryExecutionRecordDigest(RecoveryExecutionApproval)`。

`RecoveryCaptureRecord` 固定 run、包摘要、S11-RP 摘要、完整源身份和独立取得的
停写边界摘要。`RecoveryExecutionApproval` 固定上述 capture 摘要、执行 attempt、
完整目标身份、已认证批准引用及有效期。两条记录均须 committed，采集先于当前批准；
撤销或后续不同批准使旧消费失效。这是有类型的内部 journal 事件，不是新增任意字符串
controller 命令，也不允许技术测试自行作生产批准。

执行层不导出批准写入器。`createRecoveryExecutionAuthorization` 消费既有私有
`UpgradeJournal`、仍活跃的 `HostOperationLock`、采集／批准记录及 S11-RP restore
token，重新读取 journal 和磁盘包，并调用原 S11-RP `restoreCheck`。token 只证明
run／完整性绑定，不是认证秘密，不能代替来源和执行批准。

`packageRestore.ts` 导出的 `createControlledRecoveryTarget` 只接受上述 factory
实际发出的能力对象。根 `restoreRecoveryPackage` 在读包前拒绝未发行的目标；直接
调用底层 builder 也不能取得根入口能力。每个存储执行前重新核对包、授权、锁和身份。
发行的目标是不可伪造的句柄，不公开授权或恢复方法；复制其字段不能复制内部准入能力。
唯一权威是既有追加式 upgrade journal，记录开始、各存储提交、完成或未知结果；旧的
可截断包状态文件已删除。重新创建 adapter 不会恢复 started／unknown attempt 的
重试资格；reconcile 由父 controller 负责，不得清空或重置记录。

只读 bootstrap／空态预检保留 adapter 的真实 Docker 和数据库观察；授权时及每次
存储写入调度前（包括空态检查后）重新计算完整目标身份。删除只读预检内部的重复
全量观察，不会跨写入边界缓存身份。专门反例验证空态检查后发生漂移时首次写入被拒绝。

隔离 Docker 目标保留 PG16 角色、owner／ACL、对象字节／content type／metadata、
Redis AOF；拒绝非空和共享资源，复制后 Redis 仍停止。恢复返回
`restore-executed-not-business-verified`，不代表候选启动、业务消费者或公开流量获准。

Docker 矩阵采用四个独立 run：`postgres` 与 `wiseeff` bootstrap 各执行
`package-only-restore` 和 `nonempty-target-refusals`。正向 run 完成源停止、子进程
恢复及 owner／ACL／对象／AOF 验收；负向 run 采集自己的真实包，保留六种既有
function／view／sequence／type／extension／event-trigger 拒绝断言。两种验收不共享
运行中的源、包、目标或时限。此前 `be7f73f78` 和 `21f9e89ff` 的组合用例均为
`postgres` 通过、`wiseeff` 超时，仍保留失败记录。阶段计时显示六组顺序拒绝占用
正向生命周期 180 秒预算中的 33–39 秒；本次拆分保留所有断言及每例原有时限。
所有用例（包括通过的用例）都保留私有包和追加式 journal；Docker 资源与私有秘密
输入仍单独按自有资源规则清理。留证 fixture 不提供删除能力。它创建 0700 目录，
初始化时以 `wx` 打开 0600 的 `retained-evidence.json` 标记；结算仅通过这个原始
文件描述符写入 accepted／failed 测试结果，然后 sync 并关闭。它核对目录、标记的
设备／inode／owner／权限及描述符身份；替换、符号链接、硬链接或权限漂移均拒绝。
真实目录替换竞态反例验证不会删除外部目录或把写入重定向到外部文件。检测到路径
漂移时不返回已验证的标记定位符；成功诊断只给出相对开发宿主临时目录的位置，不
打印宿主路径，也不代表来源保管或恢复批准。保留包不得进入普通 artifacts。本次
不提供通用包清理命令，也不因留证修改重新标记此前组合用例的执行身份。

## 验收与操作边界

永久反例覆盖批准缺失、错误 token／run／目标、过期／撤销、跨存储期间包变化、锁丢失、
部分失败及重放。真实 Docker 用例只创建独占 PG16 Alpine、源版 MinIO 2024-12-18、
Redis 7 AOF，采集后停止源；独立子进程只接收包和私有目标输入。夹具通过实际 journal
模块写合成记录，只证明消费者合同，不冒充真实领域批准或完整 controller 升级。
形似队列的键只证明持久性，不代表完整业务消费者验收。

执行机器：已独立核对为开发机的本机；用户／目录：开发账号、独立工作树；前置条件：
依赖已安装。以下命令使用临时本地文件与锁，不连接生产、不停服：

```bash
./node_modules/.bin/vitest run --config vitest.scripts.config.ts \
  scripts/recovery-storage-boundary.test.ts \
  ops/self-hosted/storage/recoveryPackage.test.ts \
  ops/self-hosted/storage/controlledRecovery.test.ts \
  ops/self-hosted/storage/execution/authorization.test.ts
```

真实恢复验收还要求：用户已批准隔离合成执行、独立核验 Docker daemon 及资源归属，
四个固定版本镜像已存在。以下命令实际写入／停止／清理它自己创建的合成容器和存储；
环境变量仅选择测试，不能绕过身份防线：

```bash
UPG_CONTROLLED_RECOVERY_DOCKER_TEST=1 ./node_modules/.bin/vitest run \
  --config vitest.scripts.config.ts \
  ops/self-hosted/storage/controlledRecovery.docker.integration.test.ts --maxWorkers=1
```

预期：命令返回 0，用例分别报告两个 bootstrap 场景通过。失败即停止，保留拒绝／未知
证据，不手工清理真实恢复目标或 journal。生产恢复命令尚不可执行，本文不提供。
controller 侧 `recordControlledRecoveryCapture` 桥接先持久化 typed intent，再记录
实际 S11-RP capture 返回值。journal 验证目录身份、run／attempt、完整采集记录，
并禁止采集事件改变 controller pins。执行层拒绝历史只有摘要的采集记录；它们仍可
检查，但不能自动提升为当前可信采集。pending／unknown 保留原包并拒绝盲目重试。
桥接使用实际签发的主机锁，每次 probe 核验 root／锁对象；journal 父目录变化后不再
写入替换路径。包通过经核验的独占文件描述符输出。这些组件还不等于完整终端／
controller 的采集和批准 producer。Shell 释放仍是检查后按路径清理；现有用例未证明
能原子抵御最后一次检查后的替换竞态。

真实 controller 批准 producer 和完整业务验收仍是内部集成工作；真实备份、密钥／
托管、企业网络证据及生产授权分别保留，不能用合成成功代替。
