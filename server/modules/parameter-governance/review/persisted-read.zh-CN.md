# 已持久 Review Queue 的只读投影

[English](persisted-read.md)

`createPersistedReviewQueueReader(pool)` 是 S4-REV 新增查询工厂，沿用
`ReviewQueueReader` 的 list/get 接口，但不调用旧工厂按需创建 open ReviewItem 的
路径。旧 `createReviewQueueReader`、分组和 ETag 算法、合同指纹、授权及命令失败联合
类型保持不变。现有导出检查禁止 resolution writer、公开 repository 和事务，并未
冻结查询工厂的封闭清单。

新投影验证原 Organization Admin 上下文和当前 Kernel pin，在 repeatable-read
**read-only** 事务中读取 evidence 与 open item；每个当前证据分组都必须已有持久项。
在调用原脱敏投影前核对身份、grouping fingerprint、matcher revision、release、reason
以及安全正整数 ETag version。无法解码的 evidence、无法解释的当前 open item 均不可用。
缺少准备状态或权限时，不虚构 item ID、ETag 1 或空队列。实际观察到的空库存仍返回空。

投影在归还连接后再次独立验证 Kernel pin，避免单连接 pool 嵌套租借死锁，也不转移
Kernel 事务所有权。pin 变化时拒绝。这是一次有界查询快照，不是停写证明、runtime
批准或 Verification 报告。升级组合根仍须在比较采集期间持有真实目标边界。

存储或准备失败抛出名为 `ReviewQueueProjectionUnavailable` 的 Error，其静态 code/
message 为 `review-queue-projection-unavailable`，不附 SQL、连接串或证据原文。
沿用既有查询抛出存储异常的边界，不扩展冻结命令失败联合类型。rollback 失败销毁
连接，release 失败不覆盖先前不可用异常。pool 由调用方持有并关闭。

| 威胁 | 必需检查 |
| --- | --- |
| 缺分组被当成准备完成 | 明确拒绝，不 INSERT，不造 ETag |
| Evidence 无法解析 | 明确不可用，不静默丢弃 |
| 持久身份或版本错误 | 完整分组/项关联和安全正版本 |
| 越权或旧查询 | 原 Org Admin 同组织规则和 Kernel 检查 |
| await 期间修改输入 | 首个异步操作前固定输入 |
| 查询/回滚/连接异常泄漏或放行 | 静态异常、回滚、释放连接 |
| 查询变为隐式写入 | 实际 READ ONLY 事务，真实 PG 前后状态一致 |

纯测试通过正式公开工厂使用合成数据库/Kernel 端口。真实 PG 文件为
`server/modules/parameter-governance/review/persistedQuery.integration.test.ts`，要求父
协调者的既有 owned-target receipt 和独占集群；不得使用 ambient backend 配置直接
运行。父协调者拥有精确 runner/CI 路由及共享生产 API 组合根。

真实 PG 夹具通过既有 compiler、installer、ingest 和分组入口准备 release/evidence/items。
正向 LOGIN 使用 0138 已有 synchronizer 与 governance 能力，成员选项为 INHERIT TRUE、
SET FALSE、ADMIN FALSE。**这不是最终 API/worker 最小权限身份**，因为这些能力还含写入。
实际投影事务为只读。另一个仅 0140 Catalog reader 的 LOGIN 必须在 Review 读取处失败，
不修改能力角色的 grant，也不创建记录。本测试依赖父候选精确的 0140 migration 和归属
检查工具；它们不在本 Scratch 的 main base，须在核验集成后运行，不替换 schema。

本分片不增加 grant、migration、治理 EXECUTE、启动批准或发布权限。生产组合根可在
没有命令 pool 时选用新工厂，但缺少合法 Review SELECT 仍真实拒绝。分组状态准备与
最终运行身份的能力是独立责任。

文档影响为本中英文对；父协调者维护 PR 主计划和精确执行证据。纯测试、具有治理能力
的 PG 组件测试、最终运行身份及完整升级验收须分别记录。

两次独立 Kernel pin 检查的未知异常都转为投影的静态 unavailable 错误。
测试夹具依次等待 reader pool、角色、admin pool 和数据库清理；任一步失败仍继续
尝试后续步骤，只报告首个失败阶段，不带底层私密诊断。受限 LOGIN 用例的断言和
清理同时失败时，两项错误均保留。纯清理反例验证共用夹具函数，不代表实际执行了
PostgreSQL DROP 或真实资源已清理。
