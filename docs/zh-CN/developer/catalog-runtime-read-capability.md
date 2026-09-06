# Catalog 运行读能力候选

English: [English](../../developer/catalog-runtime-read-capability.md)

本文件描述 populated 升级 Scratch 候选中的待批准权限提案，不是生产迁移命令，也不证明整个 API／worker 已能使用这些角色运行。`0140_parameter_catalog_runtime_read_capability.sql` 中以下两项治理 writer 函数授权须先取得明确决策，运维入口才能执行该迁移。不可变的 `0138` manifest 保持原文。

现有 `parameter_governance_writer_role` manifest 仅允许执行 `assert_catalog_subject_active(text,text,text,text)`。该函数返回 `void`，校验当前 release／Subject，并保持共享指针锁；它不能返回实际数据库身份，也没有组织／模块参数来锁定并返回目标模块。Placement 的 trigger 函数也不是可直接调用的查询接口。

本次向治理 writer 提议增加的能力仅为：

| 函数 EXECUTE | 返回和用途 |
| --- | --- |
| `runtime_database_identity()` | 返回实际 PostgreSQL system identifier 和当前数据库 OID 的文本，在业务写入前匹配两个真实连接池会话。 |
| `lock_governance_destination_module(text,text)` | 返回匹配模块的 ID、组织 ID、父模块 ID、kind，并在 writer 事务中保持 `FOR SHARE` 行锁。 |

这属于新增能力，不能声称已由旧 manifest 批准。它们不增加 Catalog SELECT／DML、public 表 SELECT、migration／synchronizer 成员资格或 trigger 函数 EXECUTE。

独立的 `catalog_runtime_reader_role` 提案仅获得十二张不可变 Catalog 表的 SELECT、schema USAGE，以及身份函数和精确 Proposal 成功重放函数的 EXECUTE。重放只对六种成功 Proposal action、`info` severity 返回 `resultSnapshot`，不暴露拒绝审计 metadata。三个新函数均由固定的 `catalog_migration_owner` 拥有，固定 `pg_catalog` search path，使用限定关系名，并撤销 PUBLIC EXECUTE。迁移不创建 LOGIN 或密码。

已有集群级 reader 角色必须属性安全、没有父角色成员关系、不拥有当前数据库对象，且没有 manifest 以外的显式权限；允许不可转授的数据库 CONNECT。额外表／列 DML、schema CREATE、函数 EXECUTE、默认权限和其他对象能力均明确拒绝。其他数据库的权限既不被当作当前目标的授权，也不被修改。若已有角色在当前新数据库没有不允许的本地能力，同集群新数据库仍可正常安装。常规重试核对 checksum 并使用现有 migration ledger。

Proposal 命令保留 writer 的共享指针锁，独立租用 reader 会话并明确指定 `READ COMMITTED READ ONLY`。两个实际会话调用已安装的身份函数，不能仅比较 URL。身份不一致或不可用时，在业务写入前抛出静态 `ProposalReadTargetError`，不向未核验目标写审计。正常业务拒绝继续保留持久拒绝审计。组织授权仍由已认证的领域适配器执行，共享数据库登录加组织参数不构成数据库逐用户隔离。

管理恢复除角色与成员关系外，还须保留数据库本地 ACL。`0140` 特别撤销受管数据库中 `pg_catalog.pg_control_system()` 的 PUBLIC EXECUTE，仅给受保护 owner 授权；其他系统函数 ACL 不变。不能假设普通数据库 dump 会恢复该系统函数 ACL。受控权限材料和管理恢复验证必须保留该 ACL、新函数的 owner／search path／EXECUTE ACL，以及没有扩大默认 ACL 的事实。不得修改其他数据库或静默修复已有过宽角色。

真实 PostgreSQL 有界测试位于 `server/modules/parameter-governance/proposals/runtimeRoles.integration.test.ts`，通过 `vitest.runtime-bootstrap.config.ts` 使用显式核验的开发 daemon 身份运行。测试拥有可丢弃的 PostgreSQL 16 Alpine 集群，并使用两个受限登录连接。合成成功命令不等于 Release Verification 报告或生产批准。实际测试证据由父交付记录保存；待批准授权、完整 HTTP 授权、其他业务权限、运行 pin 生成和完整 populated controller 仍是独立验收项。
