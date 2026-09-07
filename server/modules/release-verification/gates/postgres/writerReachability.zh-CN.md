# V13 旧数据库权限子矩阵

[English](writerReachability.md)

## 原生外键动作

原迁移0048的 `projects` DELETE 会级联删除 `project_parameter_bindings`。
受限LOGIN只有项目DELETE及id列SELECT、没有binding变更ACL，仍实际删除一条binding，
而V13错误passed。test-only `ae1f20d66111cbabb758abee48b9294f3bc16aca`
复现32收集、31过、1失败，5.52秒、exit1、清理通过。更早`2dd71469e`因遗漏0067
要求的module_id在夹具准备失败，不是gate Red；后续补实际module关联，没有修改schema。

适配器从七表逆向追踪实际FK约束及已启用内部触发器事件。DELETE CASCADE传播DELETE；
UPDATE CASCADE和SET NULL/DEFAULT传播实际列。递归UNION按关系/事件/列交集追踪，
起点UPDATE只检查引用key列，再使用既有LOGIN/SET/definer能力。原生RI不授予child
owner的任意EXECUTE或其它权限。

固定`c6e1f9402aa142769148cd7480498f59f8058c12`、tree
`10f8a5437de66c51135ebccf39edffe80d6dfa5f`实际34/34，5.48秒，exit0、零skip，
owned清理通过。原31例保留，非legacy子表级联和项目非key列更新仍为passed子矩阵。
targeted strict types退出0，沿用下述owned命令及PG16镜像，不改grant/migration/
timeout/route/七表范围。有效Red日志`/tmp/upg824-v13-native-ri-observed-red.log`
SHA256 `80c2cb6092f00aaca7794c86762fd3568ee52f1fdeb04635ea7e6580bede9fad`；
Green `/tmp/upg824-v13-native-ri-green.log` SHA256
`4c13a0c4109308d34f22be606881c70240054758ba6a897b3686165de35aed01`。

这里不撤销合法项目删除权限，也不改原FK；可达路径会阻止退役，转换/Archive保持业务
语义由退役owner负责。RI进入非legacy子表后再触发definer、rewrite规则及角色来源排除
仍待后续处理，不把未观察项视为零或称完整P13。

## SECURITY DEFINER 触发器分派

已安装触发器的分派来自真实表／列变更权限，不依赖函数的 EXECUTE 授权。
现有 owner 能力图追加该分派边，并继续追踪私有内部 definer；依据实际事件位、
启用状态及 replica 设置／参数权限判断。禁用触发器仅在可启用它的 owner 路径可达。
不将函数体或 WHEN 条件当作安全证明；无法变更分派表或仅有读取权限的触发器 owner
本身不会导致全部拒绝。元数据来自 PostgreSQL 的
[触发器目录](https://www.postgresql.org/docs/16/catalog-pg-trigger.html)。

Replica 能力必须沿原 LOGIN／会话传播，不能用 SET ROLE 后 NOLOGIN 的默认设置替代。
递归状态保留该能力及可达参数 SET 权限／函数局部 replica 配置；分派表 owner 也能把
replica-only 触发器启用为普通分派。这里是保守能力分析，不是每个触发条件必然满足的模拟。
test-only `011663f7b7ffcae321150ef43bf2f8bef1643436` 对首版实际复现两处遗漏：
31 收集、29 过、2 失败、0 跳过，5.44 秒，exit 1，清理已验证；两个反例均先实际改变
旧表行，再观察到错误的 passed。固定修复 `205dabf265510870db78264aec75eaa1278aae96`、
tree `09bb0ec01ec4f654f93a42f74fbe939b0242f834` 实际同 31 项全过，5.48 秒，
exit 0、0 跳过、清理已验证。严格 targeted types 与原 3509 项边界扫描均退出 0。
Red 日志 SHA256：`97f454c826a4a7c14b7f827a00d8046951a8ea0867e7f388a20f373be01080da`；
Green：`1616927f610e013329fc6047d60d603e4b0b3f8b144095df56e63f82b7856667`。
命令仍为 `node --import tsx scripts/run-upgrade-component-tests.ts
--expected-daemon-id <独立实测本地daemon> --suite writer-reachability-pg16`，
原父 15 分钟预算及每项默认时限未变；原 29 项不重标为此次 31 项执行，均非全 consumer 退休。

test-only `cfb199cbcae3eaf74c2f92e947dbd78839eb25f4`、tree
`beade877fabf61b7797730c741e66ea7dfb9170d` 的真实受限 LOGIN 向七表外表 INSERT，
通过已撤销 EXECUTE 的触发器实际更新 `driver_schemas`；正式 V13 仍通过。
实际 25 收集、24 过、1 失败、0 跳过，5.25 秒，exit 1，自有资源清理已验证。
固定修复 `ee9bedf01ceb31656e282ed8635766adb2e72075`、tree
`94a525766f9c3489598705e7a1cfec8da5da4f0a` 实际 29/29，5.59 秒，exit 0、
0 跳过、清理已验证；包含原 24 项、trigger Red、私有内部 writer，以及只读 owner、
禁用和无分派权限三项合法回归。严格 targeted types 退出 0；原 trusted baseline 扫描
仍 3509 已允许、0 新增／过期／不匹配／增长。PG16 镜像及平台沿用本文件原记录。
Red 日志 SHA256：`3fce56fd49c80283228f6bc8135d97eff7665cc87e2b001255a1aa605621a813`；
Green：`d0d7d2a977daea0eaaa7b610f3ee8723f5e32c6f97ece5a1979bd3ba6fe4dffc`。
以上是精确自有组件执行，不等于完整 P13 或启动证明。
原生外键级联、rewrite rules、event triggers 与全部 HTTP／Agent／review／jobs／scripts
写入者清单仍不属于这项 SECURITY DEFINER 子矩阵证明，不签发完整 P13 fingerprint。

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
系统 schema 内缺少 `pg_init_privs` 初始化来源的 definer 仍进入图中；
不能仅因 schema 名称而将其作为内建函数排除。
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

23 例执行 tree：`92482fca44d08c2d51db1c5190007fe296e4465a`。
各轮独占资源清理均已核验。镜像为 `postgres:16-alpine`、`linux/arm64`，image ID：
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
23 例 Green 日志 SHA-256：
`6545e9c3c1d4fe9f25416958cdff2651bec2025cd48a5d57d67823d0e60d2bf5`；
此前委托 Red 日志：
`3891cc3e8dc4bb17fb0f7eb5e9344d09127348955fe2151fd531bca95132fb18`。
限定 TypeScript 检查 exit 0；沿原可信基线
`9b3ba7df7e21f5589684bc92c872da593ad4c246` 的 boundary 检查 exit 0：
3509 个既有允许命中，新增、过期、不匹配及增长均为零。
这些是本地隔离组件执行，不是 Hosted、完整 controller、已批准运行启动或生产证据。
后续文档提交不重标这些实际执行身份。

独立审查随后指出系统 schema 来源遗漏。test-only `01da79bff` 首次执行
在原 10 秒 setup 超时：24 收集、24 跳过、1 failed suite、exit 1，
不属于有效功能 Red。同代码同命令的一次有界复跑实际到达全部用例：
5.23 秒，23 通过、1 失败；真实 LOGIN 经新建 `pg_catalog` definer 写入，
V13 却通过。两次资源清理均已核验。
修复 `d28546fad24e106625d6d176c7d23086f147e9c7`，tree
`c3f9ec4a789e524056bbeca0b19207c8ef3101e8`，实际 24/24、5.13 秒、
exit 0、零跳过、清理核验通过，镜像身份与上文相同。
日志 SHA-256：setup 失败
`671b1bbc4d4c504eab0657eb3331b46049e443e2ba340d17cde0d75a30762ec9`；
有效 Red `ad96d192590e8bd0c4489586746258955d40ee1092f6f5ae938dd116c93542a4`；
Green `a9668f5e5595986d517f620ec4926336069183af4e1afa162021f6db10c21eb1`。
固定代码限定 types 与同可信基线 boundary 均 exit 0；boundary 保持 3509
允许命中，新增、过期、不匹配及增长均为零。没有修改 timeout 或基线换取结果。
