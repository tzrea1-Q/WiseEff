# V13 旧数据库权限子矩阵

[English](writerReachability.md)

本次修复已实际复现的 V13 误放行：独立受限 LOGIN 可以修改旧 driver schema，
正式 PostgreSQL V13 adapter 却返回 `passed`。本分片不证明完整 P13 退休，
也不批准运行启动、恢复、队列消费或发布。

## 范围与对象来源

`catalogRoleManifest.LEGACY_STRUCTURAL_TABLES` 的原四项保持不变。
V13 在这四个关系之外，观察下列已经存在的旧结构对象：

| 关系 | 现有结构写入者 |
| --- | --- |
| `driver_schemas` | `parameter-specs/service.ts` 的 `reattributeParameterSpec`；`parameter-specs/repository.ts` 的 `upsertMatchedDriverSchema` |
| `driver_schema_versions` | `upsertMatchedDriverSchema` 写入版本 |
| `dts_property_specs` | `reattributeParameterSpec` 更新命名空间与 property key |

已退休的 `parameterSpecs.reattribute` 路由在
`contracts/dtoSchemas/parameterCatalog.ts` 冻结清单中。七表只是有源码依据的
数据库子集，不是完整旧源或写入者库存。本次未修改迁移、grant、共享角色清单、
格式、gate 标识、失败码、可信基线或 boundary allowance。

## 威胁与实际观察

原直接 ACL 与 definer 检查保留。新增观察以真实 LOGIN 角色为根，追踪
PostgreSQL 16 SET 成员边，使用真实表／列权限涵盖 PUBLIC 与继承能力，
并独立检查所有权。无人可达的 NOLOGIN owner 不会仅因拥有表而被视为运行写入者；
增加可达成员关系后，结果必须改变。INSERT、UPDATE、DELETE、TRUNCATE、
REFERENCES、TRIGGER 及适用的列级权限均阻塞。

可执行用户 SECURITY DEFINER 的 owner 若可修改七表之一，该能力未证明安全，
因此阻塞。有效 EXECUTE 委托继续追踪其他 definer owner，覆盖不对 LOGIN
直接开放的私有内层函数。递归 UNION 对 LOGIN／owner 去重，循环会终止。
仅具备读取能力的受限 owner 正例继续通过；不以 SQL 正文缺失证明安全。
观察窗口内缺表或真实查询失败，返回既有 V13 类型化阻塞结果，不输出私有诊断，
也不执行修复写入。

继承的 `postgres` 与 `current_user` 排除仅为兼容行为，不是受信生产角色清单。
controller 证明的生产身份、完整旧表、触发器、其他函数机制、HTTP／Agent／review／
job、脚本和后台写入者仍是独立义务。范围标签只进入 evidence digest，report
不会将其解释为新 gate 状态；不能用本数据库子矩阵通过生成完整 P13 指纹。
缺表反例只针对原有退休前观察窗口，不修改 P16 清理语义。

## 复现与执行身份

通过 `scripts/run-upgrade-component-tests.ts` 的
`writer-reachability-pg16` suite，传入独立核验的本地 daemon 身份。
沿用现有 runner 的受控主机准入，不提供 ambient 数据库 URL。
runner 创建独占临时 PG16 集群，以真正只读 LOGIN 执行正式 adapter。
用例会在该临时集群修改合成角色、ACL、owner、函数及一项系统目录 SELECT grant。
清理先关闭客户端，再处置临时数据库及 runner 资源，不消费生产输入。

专属配置先验证 receipt，只收集精确文件，零用例拒绝，默认 timeout 不变；
仅从共享 server suite 精确排除。mandatory owned CI job 必须执行该 suite，
Merge bar 仍要求此 job。

依赖：`2b5d5ed4446a1aca56dd3d929fd15691172ba29d`，祖先 main 为
`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。

| 实际代码 | 收集／通过／失败／跳过 | 结果 |
| --- | --- | --- |
| `81905a346` | 12 / 1 / 11 / 0 | 首轮真实 LOGIN Red，exit 1 |
| `9bdb6a686` | 19 / 1 / 18 / 0 | 扩充权限 Red，exit 1 |
| `d135f4ce5` | 19 / 19 / 0 / 0 | 首轮实现，exit 0 |
| `0733f322f` | 23 / 22 / 1 / 0 | 私有内层 EXECUTE 委托 Red，exit 1 |
| `6dca0f385365c54c4c8a2ba63c5315309e0672ca` | 23 / 23 / 0 / 0 | 5.69 秒，exit 0 |

最后执行 tree：`92482fca44d08c2d51db1c5190007fe296e4465a`。
各轮独占资源清理均已核验。镜像为 `postgres:16-alpine`、`linux/arm64`，image ID：
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
最后 Green 日志 SHA-256：
`6545e9c3c1d4fe9f25416958cdff2651bec2025cd48a5d57d67823d0e60d2bf5`；
此前委托 Red 日志：
`3891cc3e8dc4bb17fb0f7eb5e9344d09127348955fe2151fd531bca95132fb18`。
限定 TypeScript 检查 exit 0；沿原可信基线
`9b3ba7df7e21f5589684bc92c872da593ad4c246` 的 boundary 检查 exit 0：
3509 个既有允许命中，新增、过期、不匹配及增长均为零。
这些是本地隔离组件执行，不是 Hosted、完整 controller、已批准运行启动或生产证据。
后续文档提交不重标这些实际执行身份。
