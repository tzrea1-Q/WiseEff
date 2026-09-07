# 受控报告批准目标

英文：[English](reportApprovalTarget.README.md)

组合根使用既有 `report/index` 公开 factory 的
`VerificationReportService.approveReport`，不实例化核心 gate runner。
原 controller T6 断言继续约束此边界；缺报告等拒绝保留正式报告服务的 typed 结果。

这个仅用于管理面的适配器连接已有 deployment authority 和 Release Verification
批准命令，不运行 gates、不制造报告、不授权新权限，也不批准运行／流量／恢复。
管理凭据不得进入 API 或 worker 容器。

## 输入与职责

`openReportApprovalTarget` 接收显式私有管理／writer URL，以及固定的 PostgreSQL
`systemIdentifier`／`databaseOid`。没有环境 URL 回落、注入数据库、成功 callback 或
环境绕过。受控管理组合根必须通过真实 handoff observer 采集并封存这个 pin。管理
登录使用已有 `pg_control_system` 观察能力，受限 writer 不获得该能力。

私有 deployment authority assignment 可用 `reportDatabase` 保存物理 pin，与 run、
完整 `RecoveryTargetIdentity`、精确报告 digest／purpose 共同位于 custodian 拥有并
固定摘要的文件。映射缺失或不匹配则拒绝执行。它是外层 observer 采集并显式封存的
映射，不是当前多存储观察。不改变 `RecoveryTargetIdentity` 编码：Docker 恢复
producer 的 PostgreSQL identity 仍是原 container／database／bootstrap 摘要。
外层 handoff 继续负责当前 daemon／container／volume／bucket／Redis 身份、维护
阶段与漂移检查。这些组件尚未实现该 observer，也不声称已生成真实部署映射。

## 会话与权限检查

每次实际 writer pool checkout 都审计有效权限并取得随机会话 advisory lock。独立
管理连接必须在固定物理数据库观察到精确 PID／database／namespace／key，并在挑战
前后重新检查物理身份。管理 lease 取得时同步安装 error observer，跨 writer await
保留并在失败销毁期间持续观察，连接丢失会静态脱敏拒绝。执行调用者 SQL 前释放
挑战锁；不可用、错误目标和释放结果
未知都会拒绝并销毁 checkout。这个挑战不是维护锁、停写证明或批准。

能力仅沿用不可变迁移 0139 的 NOLOGIN `catalog_verification_writer_role`：六表
SELECT、五表 INSERT 和 schema USAGE。真实 LOGIN 成员关系必须为 INHERIT true、
SET false、ADMIN false。高权／可达角色、所有权、其他成员关系、缺失授权、额外
有效表／列／序列能力、DDL、grant option、默认 ACL 和不安全函数／参数权限拒绝。
PUBLIC 新增的受限系统函数 EXECUTE 对照 PostgreSQL 16 `pg_init_privs` 检查。
不修改历史迁移。
可调用的系统 schema SECURITY DEFINER 还须有 initdb 来源记录；新建 PUBLIC definer
不能藏在 `pg_catalog` 中绕过审计。

`approveDeploymentReport` 只接收工厂签发的 opaque target 和真实 authority 签发的
opaque command。派发前以及实际 checkout 后原 service 事务体内都重新核验当前私有
指派、期限、run、完整目标、主体、purpose／report digest 和物理映射。JSON 副本
无法制造 capability。每次消费重新认证原会话，检查撤销、过期、账户禁用。token
仅存私有闭包，不进入 command、返回结果或持久批准材料。
`openDeploymentAuthority(...).approveReport(request, target)`
是该路径的认证入口，传入普通数据库 root 仍拒绝。

报告缺失／未通过、purpose、独立主体和 append-only 持久化仍由既有领域服务裁定。
合法会话或物理目标不能把缺失报告变成 passed；单项批准成功也不是运行／公开发布
准入。未知错误固定脱敏；后续初始化失败与正常退出由拥有者关闭两个 pool，工厂
准入失败会关闭已经分配的连接池。

## 证据边界

单测拒绝伪造 target 和非法私有连接输入。既有自有 `authority-pg16` suite 覆盖真实
受限 LOGIN、物理身份／挑战、真实会话、原领域 missing-report 拒绝，以及权限／
指派漂移。不插入 passed 报告、不 mock gate。该组件尚不证明完整获批报告正向链、
真实进程启动、controller 升级、多存储 handoff 或生产就绪；这些仍由父协调者继续
集成。本组件不授权生产连接或操作。
