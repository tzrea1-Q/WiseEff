# 追加的 Catalog 运行读取能力

English: [English](catalog-reader.md)

PR #824 的用户于 2026-09-07 明确批准本项有限契约演进。`0140_parameter_catalog_runtime_reader.sql` 仅追加读取能力，保持历史 0138/0139 字节不变，不批准运行启动、发布、恢复或任何生产操作。

## 新旧契约

执行到 0138 时，普通生产身份不能 SELECT Catalog 表，原测试继续成立。追加 0140 后，未显式获得 reader 成员关系的身份仍被拒绝。受限 LOGIN 身份可以独立获得 `catalog_runtime_reader_role`，PostgreSQL 16 成员选项为 `INHERIT TRUE, SET FALSE, ADMIN FALSE`。迁移不授予成员关系、不管理密码、不修改现有应用登录。

reader 属性为 NOLOGIN、NOINHERIT、NOSUPERUSER、NOBYPASSRLS、NOCREATEDB、NOCREATEROLE、NOREPLICATION。完整权限仅为 `parameter_catalog` schema USAGE，以及下列十张表的 SELECT。没有函数、序列、默认 ACL、grant option、所有权、DML 或其他领域授权。

| 正式调用／查询 | 必要 SELECT 对象 |
| --- | --- |
| `loadCurrentCatalog` 当前指针 | `catalog_state`、`catalog_releases` |
| 当前／历史 `loadProjection` 的 release、materialization、前驱链 | `catalog_releases`、`catalog_materializations` |
| 当前／历史 Subject 投影 | `catalog_release_subjects`、`catalog_subjects` |
| 当前／历史 alias 投影 | `catalog_release_subject_aliases`、`catalog_subject_aliases` |
| 当前／历史精确 definition head 与 revision 历史 | `catalog_release_definition_heads`、`parameter_definitions`、`definition_revisions`、`catalog_releases` |

权限清单依据现有 `runtime/currentSnapshot.ts`、`runtime/pinnedSnapshot.ts` 的实际 SQL，登记在 `catalogReaderManifest.ts`。这些查询不读取 Driver／NodeType 子类型表，因此未授予它们 SELECT。Kernel 的公共接口和自己持有的 repeatable-read、read-only 事务不变。SELECT 成功不等于适用的 runtime 批准；报告投影使用独立的 0139 verifier 能力，Governance 保留既有独立命令连接。本项不增加治理 EXECUTE 或系统身份函数。

## 复用与拒绝

角色是集群级对象。复用既有 reader 前检查全局属性、出向成员关系、入向成员选项、所有权、角色设置，以及当前数据库的关系／列／函数／schema／database／默认／系统参数 ACL。Catalog PUBLIC 权限及相关未来 PUBLIC 默认授权必须保持撤销。污染状态返回 SQLSTATE 42501，迁移不会通过撤权、降权或覆盖来规范化它。

reader 可能已在其他数据库拥有合法 SELECT。当前连接不能读取其他数据库的关系目录，因此本迁移不声称核验那些 ACL，也不修改它们；每个实际运行数据库仍需有效能力核验。集群可见的所有权和成员关系会被检查。角色名和 NOLOGIN 都不能替代安全证明，迁移检查也不替代运行身份门禁。

现有逐文件迁移事务绑定角色创建、ACL 和 ledger checksum。失败事务回滚；已提交重试通过 ledger 无操作。并发数据库迁移复用同一角色前执行相同审计。恢复不涉及删除 ledger 或无条件清理。

## 验收与文件归属

`catalogReader.integration.test.ts` 使用既有 owned-target 组件入口及私有 receipt，在自己创建的 PostgreSQL 16 Alpine 集群执行。部分负测会在回滚事务中临时污染集群级能力，因此不能指向 ambient／共享 Catalog lane。在隔离开发工作树、独立核验本机 Docker daemon 后执行：

```sh
./node_modules/.bin/tsx scripts/run-upgrade-component-tests.ts --expected-daemon-id "$VERIFIED_DEVELOPMENT_DAEMON_ID" --suite reader-pg16
```

该开发命令写入自己新建的容器、网络、卷和私有测试数据库，不停生产服务，也不接受生产 URL。预期输出包括实际 image ID、平台、退出码与资源归属核验后的清理结果。身份／receipt 缺失时停止，不能跳过或回落生产。PG16 Alpine 证据不替代独立 pgvector Catalog lane。

用例先执行 0138 拒绝，再追加 0140；真实 compiler／installer 安装 release 链后，由受限 LOGIN 调用正式 Kernel 当前／历史查询。测试精确 ACL 与成员选项、错误 pin、全部 Catalog DML 与范围外读取、能力污染、未来对象、独立业务写入和并发数据库复用。本项仅证明 reader 组件；API／worker 启动批准与完整 controller 仍需独立集成验收。

本文件、英文伴随、版本清单、追加迁移、专用测试及两处组件入口 selector 构成独立 reader 变更单元。父协调者拥有共享契约指纹、生成 schema、完整迁移库存、CI 路由和最终 Standards／Spec 独立审查。用户授权不豁免这些检查，也不扩张其他冻结契约。
