# 真实认证的恢复执行批准

英文：[English](recoveryApproval.README.md)

`recordRecoveryExecutionApproval` 是 controller 侧批准 producer，连接既有私有
deployment authority、typed capture journal、Recovery Point／包验证器及宿主操作锁。
它不恢复存储、不重启进程、不恢复队列、不开放代理，也不增加发布 purpose 或数据库
权限。

## 信任与输入

固定管理组合根传入真实 journal、私有 operation root、原 `HostOperationLock`、
既有 run-bound restore token，以及 opaque `IncidentRestoreConfirmation`。结构相同
的锁 callback、复制的确认或调用者 JSON 均不能替代这些 capability。确认须由
`openDeploymentAuthority(...).confirmRestore` 经真实 production 会话认证，以及
custodian 的精确私有 run／attempt／capture／目标指派后产生。
`assertIncidentRestoreConfirmationCurrent` 重读同一私有指派并重新认证原会话；
过期、注销、账户禁用或文件替换均拒绝。token 只保留在私有闭包。

capture 从既有 journal 的已提交 typed capture 事件读取，不由调用者 JSON 提供。
run 和记录摘要须匹配确认；source 须匹配 authority 封存的源目标。记录中的包目录
device／inode 必须仍匹配。包／认证操作前后重验 operation、journal 和包目录的身份
与私有所有权。已捕获 source pin 不等于实时目标卷观察或应用持续停写证明；执行层
仍须完成当前目标／边界检查。

## 持久副作用与拒绝

既有包验证器重新读取实际 manifest／payload 字节，检查摘要及角色／metadata／AOF
结构，并执行原 Recovery Point 验证。原 `restoreCheck` 校验 run-bound token。
这些检查本身都不是批准。认证后再次检查包；同步 journal commit 前紧接着核验目录
来源、journal CAS 状态和真实锁。

唯一副作用是既有 `recovery-execution-authorized` committed 事件。typed 记录保留
现有 `RecoveryExecutionApproval` 六项字段，以及 assignment digest、真实主体和
trace。approval reference 是原认证确认摘要。不改变阶段或发布 pin。沿用原 journal
fsync／CAS／未知结果处理；失败不重置 journal、不删除证据、不猜提交结果、不盲目
重试。返回的 approval 供既有执行授权 consumer 对照持久记录使用。

capture 缺失／未提交、跨 run／capture／source／destination 范围、包或目录漂移、
错误 token、过时 journal、未解决的 binding attempt、失效认证、锁缺失／丢失／错误
均拒绝。任何此前 execution approval、撤销、开始、未知或完成事件也拒绝再次批准，
由父 controller 负责 reconcile。检查与批准不会执行恢复。

## 验收与限制

focused 单测拒绝伪造确认／callback，journal 不变化。`authority-pg16` 增加真实受限
认证 LOGIN／会话用例，调用原 capture producer，通过本 producer 持久批准，再执行
既有 consumer 的授权检查。该组件测试的 capture 使用有界合成存储 adapter 和包
字节，只证明包／journal／认证接线，不证明可恢复的 PostgreSQL dump、独立观测的
源停写、三存储实际恢复或业务恢复。正向路径不由 fixture 直接插入 approved 事件。

真实源／目标 observer、终端／controller 派发和完整 capture 到 restore 验收仍由
父协调者接线。生产备份访问、恢复和流量变更仍未授权。本组件不提供生产命令，
也不另造 manifest、token、verifier 或状态机。
