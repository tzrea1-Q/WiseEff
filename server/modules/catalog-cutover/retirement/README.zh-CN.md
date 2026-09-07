# 旧 LOGIN 退休

> English: [English](README.md)

独立审查另发现继承的准备失败路径：若清理也失败，会覆盖首个错误。现同时报告两项：
准备错误保留内部选定的阶段及闭集 PostgreSQL 错误码，清理错误使用静态信息；
聚合错误不携带原始 SQL、私密错误或 cause。清理成功仍保留原准备错误。
实际 catch 使用同一 helper，文件内两项永久反例以 AST 精确抽取原函数及原测试、
无 integration 导入/setup 的方式执行，修复前1通过1失败，修复后2/2，日志为
`/tmp/pr824-bootstrap-cleanup-{red,green}.log`。这是纯失败路径证据，不是模拟数据库
生命周期，也不重标原固定38项执行。随后 clean
`c4b99f4ba5f2bb6faf3f517ec58a6f4dbfea95cc`、tree
`d1191e1f434271117b39594ac8d67cbf4f61d48c` 完整真实owned40/40通过，14.35s、
exit0，runner及目标cleanup均true。认证准备303ms，独立断言343–1081ms。
日志 `/tmp/pr824-bootstrap-lifecycle-c4b99-green.log`，SHA-256：
`bb6a58244aa9590a54f5d3581c14c49bed4d1bba0c8ead510e24133d0ada597c`。
该执行归c4b99，不重标后继文档提交；Hosted仍待跑。

## 独立 inspection 测试生命周期

Hosted run `34167230816`、job `101880674239` 执行 merge
`4817c844a0e4e0d63d117fa9d6e5eea0e49017aa`（代码 `73f12a24e`，报告
`d79b9b23b`）。Bootstrap 收集30项，27通过、3失败。首 custody transport 用例
超过原5000ms预算，随后两个依赖 successor 用例发生取锁及子进程错误。这不是旧
source-lock问题。新增后继把认证准备、4个子进程、SQL效果和另外3个子进程放进
同一旧用例，并在结束前发布共享 `successorCheck`。Vitest超时不会取消原回调，
后续用例因此可使用仍在执行的夹具。日志与源码支持候选测试组合回归；它们没有证明
独立的生产锁泄漏或数据库输入变化。

本地采用同一owned PG16镜像、daemon、Node22.22.3、空ambient环境和原正式suite命令，
串行对照：

| 固定树 | 实际结果 | 原聚合用例 |
| --- | --- | --- |
| `cf494324c`，tree `47f379156a8f205f0ec43bf813de7e8287ed225e` | 28/28，exit0，cleanuptrue | 2046ms |
| `b7bd0e645`，tree `964de0bb44a4292c8160f7ed5350347448fa7772` | 30/30，exit0，cleanuptrue | 4709ms |
| 诊断 `2750c294a` | 30/30，exit0，cleanuptrue | 4533ms |

诊断实测认证准备299ms、SQL准备517ms；原生子进程约227ms完成导入，237ms取得
受限管理连接，最长的末尾边界子进程1089ms。本地对照没有复现Hosted超时，不能代替
该失败证据；它说明候选新增聚合工作，不能归咎于此前成功的28项实现。

测试现由 `beforeAll` 拥有认证准备，各原selection分别执行；嵌套 `beforeAll`
准备真实SQL。原缺host、错host、额外ACL、新关系、复制host链及末尾边界对抗断言
分别保留。原30项覆盖拆为38项；不再由一个用例赋回调给另一个用例使用。每个用例
登记自己的在途工作，`afterEach` 等真实子进程及数据库清理完成，`afterAll` 先drain
再关闭夹具；仍有在途工作时禁止新工作开始。原用例5000ms、hook10000ms、子进程
1500ms、连接2000ms、查询5000ms均不变。静态阶段/耗时不记录输入、身份、凭据、
原始数据库错误或SQL。

固定 `4b39351a1ddacec102e0394f936710157f6481cd`，tree
`94be9bd33a4b62e252c47fd3d9e64f1ed2a320ca`，真实owned38/38，14.29s，exit0，
cleanuptrue。准备300/509ms，各独立断言336–1110ms。日志
`/tmp/pr824-bootstrap-lifecycle-split-green.log` SHA-256：
`f6eba692cce5f8da255aa778b78d8bd186d6c5528e2f0eb62f9eb59b1f2426cb`。
原Hosted失败保留，新Hosted结果尚待执行。本次仅修测试，不改变fence，不声称已批准
P12/P13或启动成功。

## SQL 后继效果之后的认证 inspection

本独立 Scratch 从 main 建立后快进到 `5f7a3d5b4`。原认证 baseline 包含关系
ACL，因此后续合法的七表 SQL 撤权会令原认证专用 inspection 返回 unknown。
已有19项 SQL 组件测试没有证明这个组合生命周期。

修复消费原持久认证/root intent，以及精确的后继 SQL intent/applied 对，
逐项匹配 run、attempt、物理 target、P12 binding、root request 和恢复包。
根还须核验实际宿主 pending/applied 摘要。原正式 SQL inspector 必须在真实锁
内证明当前效果成立；仅该已核验后继的精确关系/列 ACL delta 可用于重建原
认证 baseline，不开放通用 baseline override、调用者 mapper 或仅凭 checksum
自洽授信。其它实测元数据字段继续严格等于原值。既有 custody transport 保持
私有，仅使用原 version 的新秘密，不导出高权 client。

永久 Red 真实轮换凭据、撤销授权，再由独立进程使用保留 custody 执行
inspection。错 run/target、缺失或不符的宿主步骤、额外 ACL 变化、非 ACL
元数据变化仍须 unknown。Inspection 不重复轮换/撤权，不发行 P13 completed，
不静默提升不确定的宿主写入。仅 storage 的 P12 夹具仍明确未批准，这些
组件观察不能授权完整根退役或启动。

首次实际 Red `0c1c3cc33` 收集28项：27过，最后独立进程后继检查因unknown
失败；9.98秒、exit1、清理通过。此前原4个transport模式、真实七表SQL效果及
剩余UPDATE权限为零的断言均通过。日志 `/tmp/pr824-successor-red.log` SHA256为
`7dcb02c8669c12f0998c7442c4ad4d6d083a2977a98606e4678730db6c7f4c77`。
这是有效组合生命周期Red，不是installer或timeout失败。

候选将原SQL owner读回复用于原inspection与持事务inspection；后者核真实
backend、target、事务以及七表/十一张catalog锁，不接受declared-held布尔。
私有custody owner持锁直到认证、原baseline精确重建及最终P12/root边界复验。
该inspection没有DML，但ACCESS EXCLUSIVE锁需要read/write事务。输出仍为
原有界认证结果。原baseline格式没有column ACL字段；列ACL继续由SQL owner
完整前后库存核验，不改变原格式。根传原issued宿主锁和journal选择，facade
实读宿主步骤。额外grant、新relation、缺失/错宿主选择有永久真实I/O反例。
原SQL19项结果本身不覆盖此新inspection；最终固定组合的证据另列如下。

审查新增的真实反例在 `5c46be585` 得到28过/2失败：只有复制的宿主SQL步骤、
缺原capture/credential关联仍被接受；最终边界回调的GRANT逃过已释放的锁。
`317aa226e` 将回调移入事务并修宿主关联后仍为29过/1失败：已有grantee的ACL
更新并不由relation锁或未变化的shared dependency串行化。这两次均非最终Green。

现在SQL owner每次事务首快照前，对精确实读catalog取得SHARE NOWAIT：
`pg_authid`、`pg_auth_members`、`pg_shdepend`、`pg_class`、`pg_attribute`、
`pg_namespace`、`pg_proc`、`pg_type`、`pg_database`、`pg_default_acl`和
`pg_db_role_setting`；最后一项是原`pg_roles.rolconfig`基线字段的真实依赖。
获取与持锁检查共用同一清单。前三张及`pg_database`、`pg_db_role_setting`影响集群元数据，其余锁
短时排除当前数据库的冲突元数据写；可能拒绝并发DDL/ACL，不再称仅锁七表。
没有修改grant、schema、timeout或baseline格式。最后真实边界在锁内完成，
之后再核SQL和认证；实际表/列GRANT、CREATE FUNCTION及ALTER ROLE SET须在该窗口得到55P03，
释放后成功。宿主读回还须具备parser核过的capture/credential前驱、精确root
request/version/digest、cutover run和plan，之后才是SQL步骤。两个owner改按
现有根`backup.digest`接受裸64位hex包摘要；此前合成带前缀值掩盖了该接线错误。
这只冻结原元数据基线，不是所有管理前置条件：session/lock、replication状态、
运行设置和HBA文件仍分别观察，不能称原子冻结的完整writer/P13库存。

固定 `62090c07edca2f07c2ace373bfd9ccc0dab2da80`、tree
`acd8054df6267409c0b7be6392da49297f6f300c` 串行执行既有owned入口：
bootstrap **30/30**、13.62秒，原SQL权限 **19/19**、104.45秒；两者exit0，
精确owned清理均已验证，使用Node22.22.3及原PG16 Linux/arm64 profile。
bootstrap保留原28例，新增两例共享原真实准备状态，各自沿用原预算，不增加timeout。
根派发114个纯逻辑/真实FS用例在`c4941132c`通过，SQL/report/Docker仍为替身，
不是完整根PG正向。固定`62090c07e` targeted types退出0；原trusted-base边界
3509个既有允许、零new/stale/growth。本分片没有运行完整build或Hosted。

最终独立进程路径使用原新secret custody、实际SQL REVOKE、正式SQL现状inspection
及storage-linked P12。typed capture/credential宿主记录属于组件夹具，不是真实
恢复包或获批报告。额外ACL、新relation仍unknown，复制的宿主SQL步骤拒绝；
最后实际边界中的表/列GRANT、CREATE FUNCTION和ALTER ROLE SET均得到55P03，
释放后实际执行成功。role-setting反例在`e3d90ee80`另有真实Red（29/30、exit1、
清理已验）；此前`c4941132c`的30/30+19/19不覆盖它。更早`5e5b947a4`的28/28
及之后两次审查反例失败均保留原身份。

日志及SHA256：

- `/tmp/pr824-successor-role-setting-green.log`：
  `0ddcaf82326bd902384ecfb8aba6d7569eab0008585f28f2f4a339f382851579`。
- `/tmp/pr824-successor-620-sql-green.log`：
  `cbeabbb904c55bc0d7b3afa5988daa06b0b42af39c7f56f270f913f689e9bd20`。
- `/tmp/pr824-successor-role-setting-red.log`：
  `231778e3f551dc687266aea36b4a34661becc8e7fa3eda1efcb39cddfd0297ea`。

独立Spec及Standards对完整固定源码和证据复审，本范围内无剩余P1/P2。
审查结论不会改变任何执行的SHA身份。

唯一写入范围为原 bootstrap credential 模块、owned integration test 与夹具，
必要的 SQL fence 自身 inspection 模块/测试，原退休根/测试及本双语 README。
Runner/CI、共享 migration/grant 不属于本分片。

## 有界旧 SQL 权限效果

本 Scratch 实现位于现有退休根与 `legacySqlPrivilegeFence.ts`，实际 owned PG
组件验证已按下文记录通过。它撤销独立可达的旧结构 SQL 授权，不产生
P13 completed checkpoint、runtime generation、启动 pin 或批准。

固定库存为 `public` 下原 `LEGACY_STRUCTURAL_TABLES` 四表，加
`public.driver_schemas`、`public.driver_schema_versions`、
`public.dts_property_specs`。可撤范围仅表级 INSERT、UPDATE、DELETE、
TRUNCATE 与列级 INSERT、UPDATE。SELECT、owner、其他表、schema、函数及
角色成员关系保持。剩余 REFERENCES/TRIGGER、owner、superuser 阻止本授权
步骤通过。不透明可执行写入路径不在本步骤证明范围内，完整退休仍须通过
原 V13 核验；本模块不复制该 verifier，也不扩大 REVOKE 范围。
不使用 CASCADE、不删角色、不增加授权。

根复用原已实际认证且由显式私有配置提供的管理 lease 与 S7 锁，先核每项
ACL 的实际角色、owner、grantor 权能。Catalog 管理角色名或 0137 INSERT
权限并不等于 public 表撤权权能；受限连接失败后不得回落管理员连接。
私有 custody facade 不为本操作导出 client。

候选身份来自真实 runtime-role source；原应用身份仍由已停止源边界分别
认证。调用者角色名或候选配置不能独自确定 ACL 范围。必须观察实际对象和
角色 OID、PUBLIC、列授权及 INHERIT/SET 路径。跨数据库或共享使用、身份
不明、不支持的授权链、恢复材料关联不完整，均在首个 REVOKE 前拒绝；
不能顺带清理无关业务权限。

原核验过的 PostgreSQL 恢复包仍是恢复权威。另保留效果前的精确库存：对象、
列、owner OID，原始可空 ACL 与默认值区别，grantor/grantee、grant option
及成员边。库存绑定同一目标、源、P12 intent/binding、已批准报告、原包及
capture、host run 和 attempt。它描述源侧本次 CAS 的即时前像，不冒充
capture 时 ACL，也不是新增 GRANT 恢复接口。整状态恢复回到原 capture，
不承诺逐项恢复 capture 后的权限变化。原 snapshot dump 已保留 owner 与
ACL；沿用原 producer、包、源及角色资格核验，不另跑 restore 或虚构
逐 ACL 的归档证明。源 OID 只绑定实际 CAS；跨恢复用 schema/table/column
及角色名识别对象，不能要求恢复实例 OID 不变。效果后回读必须证明仅
选定授权发生变化。

REVOKE 前须已耐久保存现有 host pending 边界与专属 0137 P13 step intent。
每次写与 COMMIT 保留根最后一次 await 后的真实锁、报告、包及数据库检查。
步骤结果要求实际提交确认及精确回读；未知提交保留 intent，只可精确检查，
不能盲目重放 REVOKE。不另夺 S7 或递归借用 max-one pool；清理保留原首错。

现有根在凭据退休前打开品牌 runtime-role source，并在 SQL 效果期间持续
重读。根原六表 P12 库存锁不变；SQL owner 另在每个事务的首个快照前持有
七张旧表锁。先提交不可变 intent，再执行精确 REVOKE、实际回读并提交。
首个身份观察前还须实际管理 search path 以 `pg_catalog` 开头；每个事务另持
`pg_authid`/`pg_auth_members`/`pg_shdepend` 的 SHARE NOWAIT。它短时冻结
集群级角色及共享依赖元数据写入，包括相冲突的 DDL/ACL 操作，不冒充只有
七表局部锁；已存在竞争即拒绝。
第三个事务持七表锁，覆盖新快照回读及根的宿主确认。本 owner 不关闭借入
pool/client。ACL 前像中的恢复资格只关联原包角色名，不声称当前角色属性、
成员关系等于原 capture，也不独立恢复它们；当前全部成员边仍参与效果 CAS。

`inspectLegacySqlPrivilegeFence` 在原管理/S7 边界内读取精确原 run、attempt、
selection 与 intent digest，区分无 intent、只有 intent 且原态未变、以及
精确已提交授权效果；坏记录、ACL 漂移或丢失边界均为 unknown。它不重放 SQL，
不把 host pending 提升为完成。现有根 inspection 仍只检查凭据；SQL 步骤的
自动根 reconciliation 与普通 LOGIN 的 SQL 接线仍是内部缺口。

永久用例覆盖根调用、直接及列级/PUBLIC/INHERIT/SET 写入、
SELECT/owner/无关业务权限保留、grantor 权限不足、共享或未知使用、授权
依赖、intent 落盘失败时零 REVOKE，以及提交或宿主锁丢失后禁止重放。
原根 Red 为 1 失败、50 filtered，证明新效果未被派发；当前根 54 项纯测试与
真实宿主 FS 回归通过，包括 host pending 失败时零 SQL、未知效果保留 pending，
以及凭据变更前拒绝 runtime-source 错目标。其中 SQL、报告、Docker 端口是
替身。首次固定 `490b976d6` 的 owned PG 为 17 收集、5 过12失败，90.35 秒、
exit1、cleanuptrue。unsafe search path 确实错误返回成功；另外11失败来自
夹具 UPDATE definition_lifecycle 调用了原 DTS trigger 却缺其读取权限。
夹具现改为真实结构列 specification_key，保留实际行数、UPDATE拒绝及其它
断言，不改 trigger、不补 grant。原日志 `/tmp/pr824-sql-privilege-pg-red.log`
SHA256 为 `0047ddf3ae7b13bfa2a53840d7a641b94d4e5186491c074a1ead0ad006b7e27c`。
下一固定 Red `d101d5ded` 为18项中16过2失败，95.04秒、exit1、cleanuptrue。
只剩 unsafe resolution 与最终 host 确认时并发 GRANT pg_write_all_data：
后者真实 GRANT 成功，随后实际 LOGIN 又可 UPDATE。保留日志
`/tmp/pr824-sql-privilege-membership-red.log` 的 SHA256 为
`40239689884ee73630ffa74ec193fe078e6dd54bd4d673d532a97e7947f82ba4`。
相应解析 guard 与角色元数据锁的固定 `f1064b650` Green 为18/18，94.76秒、
exit0、cleanuptrue；`/tmp/pr824-sql-privilege-pg-green.log` SHA256 为
`0da0d4c778fc5af765848dafe2219663265d9a4e33913ae2956052a1442138f6`。
随后固定 `175a6e320` 增加第二个 owned DB：最终 host 确认时实际 GRANT SELECT
仍成功并新增共享依赖。该 Red 为19项中18过1失败，104.66秒、exit1、cleanuptrue，
日志 `/tmp/pr824-sql-privilege-dependency-red.log`，SHA256 为
`c14028dcbd4dcf69ad15da61a01e124bc278c8bdf46d219e7cdf00fc83ad1e1d`。
新夹具最初把真实 pg.Client 传给仅查询但类型要求 PoolClient 的 helper，targeted
types 拒绝；现改为原实际 observed pool checkout，独立关闭 pool 与数据库，
不使用 cast 或修改 helper 合同。
复用真实 P0–P10/P12 storage 与明确未批准引用，只测试 SQL 效果。
真实 SQL 提交后注入 host 确认失败不冒充网络
COMMIT 故障。不声称完整根 P12/P13 批准或全部 writer 退休。

固定 `2a9b22e2b28e9254f7635e56e7feb897b40bdb99`、tree
`11018998b52e927564b64e8fbc506ee815e98759` 在 clean detached checkout 实际
19/19，104.13秒、exit0，runner 与夹具清理均已核验。角色 GRANT 与跨DB ACL
GRANT 在确认窗口中均以55P03拒绝，事务锁结束后同一GRANT成功。精确命令为
`env -i PATH="$PATH" HOME="$HOME" node --import tsx scripts/run-upgrade-component-tests.ts
--expected-daemon-id <独立实测owned daemon> --suite legacy-sql-privileges-pg16`。
Node为22.22.3；PG16 linux/arm64实际镜像为
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
最终日志 `/tmp/pr824-sql-privilege-dependency-green.log` 的SHA256为
`fb454b14d7ea1f34ec0729978d411dde41a3bc00ef6de19231a32d508887a58b`。
独立Spec与Standards均对该有界组件给出PASS；后继仅文档提交不承接其执行身份。

唯一写入路径为本 README 双语文件、`legacySqlPrivilegeFence.ts` 及其
`.test.ts`/`.integration.test.ts`、同目录
`vitest.legacy-sql-privilege.integration.config.ts`，以及原根
`legacyWriterRetirement.ts`/`.test.ts`/`.bootstrap.test.ts`。mandatory 路由与普通套件精确排除
由父任务负责。本单元不改 migration、权限 manifest、共享 journal 类型、
报告格式或冻结 baseline。

根 `inspectLegacyApplicationLoginFence` 现已在构造旧密码管理pool之前调用此
transport，把借入的实际TCP socket绑定两份已核验源端点，保留锁／包／报告／P12
检查，并先归还lease再做max-one pool的最终P12读取。根 `44d63de87` 的95项调度
回归及独立审查通过，不是完整获批根PG执行。下文保留的组织Archive失败已由
[Archive证据](../archive/README.zh-CN.md)所述独立修复和验证；原custody执行仍只
覆盖platform场景，不重标历史。

## 私有凭据保管连接检查

`inspectBootstrapCredentialFenceFromCustodyTransport` 仅返回既有认证检查结果。
它借用真实受限管理 LOGIN，按完整非秘密根绑定读取唯一既存的
`bootstrap-application-authentication-intent`，重算请求摘要并逐字段比对后，
才重新打开该记录中的原凭据 receipt。不选最新 attempt、不生成新秘密、不重试
ALTER，也不回落旧密码；不返回密码、URL、连接或任意管理回调。

当前仅支持已连接的明文 TCP socket，使用实际对端 `127.0.0.1` 和观测端口；
TLS、Unix socket 与其他对端均拒绝。回环地址只是传输限制，不是权限依据：
外层根仍须用停止后的 handoff/Docker 观测独立证明端点。读取秘密前先核管理
身份及物理数据库，新私有 OID10 连接再以真实随机会话锁挑战及目标身份核对
原 reader；不从可变 client host/port 或环境变量取得路由。

借入会话必须处于 autocommit。组件自有事务在首快照前取得既有六表 SHARE 锁，
随后设为 READ ONLY；SET LOCAL 与 rollback 恢复调用者身份。新 OID10 会话
持 S7，在认证检查前后调用实际 activation owner 的同会话检查。库存锁全程
保持，阻止不参与 S7 的 mapping writer 在两快照间造成 ABA；根记录另以新鲜
OID10 事务重新读取。返回前关闭所有自有 pool/FD，不 release/end 借入会话。

外层根仍负责 host lock、停止的源及端点、恢复包、当前适用批准报告和 P12。
本接口不代表 P13 或 runtime 批准。若在首 COMMIT 后、ALTER 前中断，新秘密
无法连接，结果保持 unknown 和原版本，不自动重试实际动作。

新 test-only fixture 复用既有共享 fixture 真实写入、S7 P0–P10 和既有 epoch/storage
事务；其 P12 引用、handoff 与包标识均为明确未批准的组件输入，不能作为发布
证据。父进程关闭原 custody 与 OID10 连接后，子进程只接收受限 guard URL 和
完整非秘密选择，验证精确检查及跨 run/包漂移拒绝。实际 `9d26ab1c2` 收集 28、
原 27 通过，新例在 facade 前的 fixture plan 阶段失败，不是有效 transport Red；
`e518f7047` 同样原 27 通过、准备失败：实际 0081 约束拒绝 DTS property 中的
结构键，两次均未触及 facade。修正复用 `seedSpecBindingGraph` 的既有可选
property 路径，不创建或删除 DTS property，并在要求实际 R10 分类前读回残留
定义和版本。该旧 no-Binding P2 路径不证明实际应用停写。修正 fixture 与实际
实现的独立执行证据如下。

后续隔离准备 `6424d31f5`、`90f8dbbfc` 各收集 28、27 通过、新例准备失败，
自有资源均清理成功。P0–P6 实际完成，P7 拒绝组织源：archive 明文检测把较长
organization ID 当作私密 payload，而归档 metadata 又必须保留同一 owner ID。
这是内部归档兼容缺口，不是生产授权缺失。本片不放宽检测、不缩短 ID、不删
owner metadata 或安全检查，改用既已支持的 platform 源形态。共享 fixture
的 `organizationId` 类型只补上既有 SQL NULL 语义，SQL 和约束均不改；
本片不证明组织归档通过。

实际 owned PG16 Red `84a17cd477b3dce72057dde76d8697e7b67ee04a`
已通过准备与原 27 例；新独立进程的精确选择返回 stub 的 `unknown`，而非既存
fence 摘要（收集 28、通过 27、失败 1，6.21 秒）。Green
`312400172a4c0b43f4c6cc5efcd58ef72c30882b` 全部 28 例通过，8.59 秒，
包含精确选择、跨 run／包漂移及借入连接真实 `end` 后拒绝。两轮均核验自有
资源清理成功；后者也证明六表锁与 READ ONLY 的语句顺序可在实际 PG16 执行。
日志 `/tmp/pr824-custody-transport-platform-red.log` 和
`/tmp/pr824-custody-transport-platform-green.log` 的 SHA-256 分别为
`3bb3fc37665a92382b614231b921421e79be6eda7a993471a497a617d3f9f681`、
`ebb3c4cf4d075ed003fb9b67fe5e98547de4cbbacef285b898e449e54d8ccf4c`。
这是上述精确 checkout 的本地组件证据，不是本次仅证据更新的执行、Hosted，
也不是正式获批的完整根 P12／P13。

本 R3 分片仍处于 Scratch。数据库动作禁用精确的旧应用 LOGIN，并移除指向它们的
成员关系；不删除 owner、ACL、角色、密码或源数据。原有能力必须仍由同一已验证
恢复包完整表达，不授予新权限。管理连接必须与被退休角色分开。

仓库尚无名为 `retireLegacyWrites` 的正式执行器，原 P0–P10 orchestrator 明确将
P13 保持 unavailable。前置公开接口是
`createApplicationReadActivation().inspect(activationIntent)`，使用 0137 既有存储，
不新增表，核对精确 intent 和完整当前 binding，不代表当前运行批准。本分片不能
取代 verifier，也不能把登录禁用结果当成所有旧
写入口退休。路由、Agent、后台任务、触发器以及新的完整 V01–V17／D01–D09
切换后验证仍须分别完成。

## 增量威胁矩阵与所有权

| 威胁 | 必须观察到的结果 |
| --- | --- |
| 调用者只传角色名，冒充旧应用身份 | 使用旧应用真实凭据连接，将后端绑定到管理连接实测物理目标，读取实际角色名称和 OID |
| 错误数据库或宿主锁丢失 | 修改角色前拒绝，提交前重新核验 |
| 当前 bootstrap 或恢复格式无法表达的高权角色 | 不修改并拒绝，不编造能力缩水的恢复策略 |
| 其他数据库中的成员、owner 或 ACL 关联 | 拒绝共享范围，保留恢复材料 |
| NOLOGIN 后仍有旧会话 | 不算退休；NOLOGIN 不会终止连接，也不是停写证明 |
| 并发 controller 或提交结果未知 | 保留持久 intent，只检查，不盲重试或重置 journal |
| 旧角色重命名、替换或能力漂移 | 固定 OID／名称／恢复包比较失败 |
| 数据库围栏只部分完成 | 不恢复应用、队列或代理 |

本 Scratch 独占 `retirement/` 及新增 self-hosted 组合 adapter。迁移、应用连接池、
主 controller、生成 schema 和统一执行计划由父协调者维护。实现变化同步维护
本文件及英文伴随。真实 PostgreSQL 测试只用本轮新建且验证归属的集群，不使用
ambient DATABASE_URL。

v3 恢复包的 bootstrap 是预先存在的 OID 10 身份，不是可转移的高权角色声明。
若禁用唯一 bootstrap LOGIN，却仍依靠同一身份重连管理，会丢失管理通道。这一
情况需要独立证明管理与恢复策略，不能由普通恢复包角色路径静默覆盖。

## 已实现入口及证据边界

`ops/self-hosted/scripts/parameter-catalog-upgrade/legacyWriterRetirement.ts`
创建真实 P12 组件，核验已应用 binding 与当前 Catalog／源清单／mapping 事实，
从现有宿主 journal 读取 capture。按已记录目录 inode 和包摘要重读同一恢复包。
实测已停止的旧容器提供原凭据，以随机后端锁证明真实认证连接位于独立观察的
管理数据库。关键步骤重复检查宿主锁、包、容器和停写边界。

仅支持受控 bridge 的源观察器先证明：原 DATABASE_URL 主机是固定 PostgreSQL
endpoint 的实测地址，或实际自有网络内唯一指向该容器的 alias，端口为 5432；
同一实测容器必须发布精确的 loopback 管理端口。未知网络成员、错误 ownership、
自定义 DNS／hosts／相关挂载、多网络、端口错误或别名冲突均在连接旧 LOGIN 前
拒绝。关键检查重新观察该映射并拒绝漂移。只有 Docker 转发关系已独立证明后，
私有凭据才可使用发布端口；凭据相同本身不是原连接目标证明。本 profile 要求
现有 controlled-recovery ownership nonce 和关闭 IP masquerade 的 bridge；
不支持的部署在 effect 前拒绝。

Docker 配置本身不够：通过 `docker cp` 读取已停止容器的真实 `/etc/hosts`、
`/etc/resolv.conf`、`/etc/nsswitch.conf`。使用现有宿主 tar 工具，只将指定成员
解到有界 stdout，不向宿主文件系统解压。文件缺失或 resolver 规则不支持时拒绝。
本 profile 要求 `hosts: files dns`、Docker DNS `127.0.0.11`、`ndots:0`；真实 hosts
内容不得把原主机重定向到其他地址，容器 hostname 与数据库 alias 冲突也拒绝。
三个文件的摘要参与反复的 endpoint 观察。
不支持容器环境中的 `RES_OPTIONS`、`LOCALDOMAIN`、`HOSTALIASES` 覆盖。每份
Docker tar 必须精确列出一个所请求名称的普通文件；链接、重复成员及多文件
拼接均拒绝。

endpoint 拒绝保留固定 `SOURCE-ENDPOINT-UNPROVEN` 错误，并增加枚举阶段。
诊断只包含计数、tar 退出状态和有限选项分类（`ndots-zero`、`ndots-other`、
`edns0`、`trust-ad`、`other`），不输出 resolver 原文、Docker stderr、主机名或
凭据。诊断分类本身不意味着允许额外 resolver 选项。真实 endpoint 夹具在每次故障
修改前先要求正常基线成立，再核对精确拒绝阶段，避免无关的早期失败被记为
预期负例。Hosted run 34125753813 的失败只记录了外层 catch 位置；当时诊断增量
并未确定或修复平台根因，也未改变 endpoint 接受条件或 timeout 上限。

随后 run 34130699134 将 Linux 失败定位到 `resolver-options`：同一行包含
`edns0`、`trust-ad`、`ndots-zero`。解析器现在要求恰好一行 options、一个
`ndots:0`，并且只允许附带各至多一次的 `edns0` 和 `trust-ad`。其他选项、重复项、
缺失或非零 ndots 仍拒绝。resolver 原文仍由摘要固定，不改写任何文件、DNS 服务、
命名空间、目标身份或 timeout。

这是修复过窄的字符串比较，不改变身份合同。
[`resolv.conf(5)`](https://man7.org/linux/man-pages/man5/resolv.conf.5.html)
将 `edns0` 定义为协议扩展，将 `trust-ad` 定义为 DNSSEC AD 位处理；后者不是
通用信任保证。本观察器不读取 AD 位，也不以 DNSSEC 结果授权目标；证明仍来自
独立观察的 Docker ownership、单 bridge、唯一 alias／地址、精确发布端口，以及
调用者的物理数据库观察。
[musl 1.2.5 解析器](https://git.musl-libc.org/cgit/musl/plain/src/network/resolvconf.c?h=v1.2.5)
从 options 读取 ndots、attempts、timeout，不读取这两个标志。原有 `127.0.0.11`、
`hosts: files dns`、hosts 文件、容器状态及 resolver 覆盖检查仍全部强制执行。
合成归档测试覆盖实测 Linux token 组合，不代替新的 Hosted 或真实 PG 执行。

endpoint 拓扑由父监督器创建两台自有 PostgreSQL 容器及使用同一固定 PostgreSQL
镜像的 psql 探针，再通过私有 receipt 交给测试子进程。子进程不创建资源，不能
依赖自己的 afterAll 处理强制终止后的清理。从网络内查询原 URL，再通过发布端口独立比较 system identity，
随后停止探针。指向另一数据库的 URL、错误发布端口和实际重复 alias 均拒绝。
另先证明真实 hosts 文件覆盖使原 URL 访问第二数据库，再停止探针并验证观察器
拒绝；Docker hostname 冲突也被拒绝。探针不是旧 API／worker 镜像，其一次性
数据库使用仅通过私有 receipt／stdin 传递的随机密码，只证明网络映射，
原 LOGIN 围栏用例另行验证真实受限凭据。

adapter 绑定完整 `activationIntent` 与领域 `bindingDigest`，读取正式已获批的
预激活 projection，将 artifact、目标、源、Catalog、mapping、恢复输入逐一
对齐实测 binding 和恢复包。后续 pending／unknown capture 会使其拒绝。这只是
额外的前驱检查；父 controller 仍须通过既有 release gate 调度完整 P13，并证明
全部旧写入口已退休。

管理连接持有 S7 锁后，两个事务使用 `inspectOnHeldManagementSession`，不再从
第二条连接请求同一锁。inspector 检查实测目标、身份、ExclusiveLock、UTC 和
实际强隔离事务，再次核验原边界。SAVEPOINT／RELEASE 探针有局部事务作用，
但不写业务数据、不执行 DDL、不切角色、不 BEGIN／COMMIT。reconcile 使用同一
接口并要求事件绑定仍是当前 binding；旧事件不成为当前运行或发布批准。

`beginLegacyRetirementTransaction` 开始 SERIALIZABLE，设置 synchronous commit
与 UTC，随后对 P12 同样保护的六张 Catalog／mapping 表取得 SHARE NOWAIT 锁。
两个写事务均在首次产生快照的查询前调用它。S7 锁不能独立阻止 mapping 或
installer 写入；在 repeatable read 内重复 SELECT 只会重读旧快照。锁竞争留下
失败事务，由 owner 回滚，该事务不写 intent 或角色 effect。本准备函数不能替代
实际目标、S7 锁和停写边界检查。

`retireLegacyApplicationLogins` 先持久保存 intent，再于独立事务应用数据库围栏和
effect event；COMMIT 开启 synchronous commit。它不创建 P13 checkpoint，不推进
run phase；返回 `legacy-logins-fenced-not-p13`。已有 intent 不是重试许可。
`inspectLegacyApplicationLoginFence` 在结果不确定时只读核对事件、真实角色和后端
状态，不使用已禁用凭据，也不修数据。原 owner／表 ACL 为恢复和历史访问保留，
它们不证明旧写路径零可达。新运行权限、触发器／路由／任务退休、全部消费者
验证及完整 P13 提交仍是内部集成工作。

专属 `loginFence.integration.test.ts` 用真实 LOGIN 调用同一管理作用函数，检查
重连拒绝、成员移除及 owner／ACL／值保留，覆盖错误目标、锁、会话、角色、
恢复材料和跨库关联，并检查已经 SET ROLE 的直接及间接成员会话：NOLOGIN／REVOKE
不会重置其他后端的有效角色，因此保留原始 caller OID 供提交后检查。相同键的共享
advisory lock 仍被拒绝：管理后端必须实际持有已授予的 `ExclusiveLock`；负测在回滚前
核对角色、成员、owner 和 ACL 不变，不让回滚隐藏副作用。这十例仅属于
数据库组件证据，不制造 P12 报告，也未执行
顶层 adapter。父协调者须精确将该文件接入新建自有 PG16 lane，并从共享 server
suite 排除；缺少 receipt 时明确失败，不静默跳过。
跨库共享角色负测的第二个数据库在 suite setup 准备；建库不计入五秒角色作用断言。

修改与检查入口均在 pool 获取回调返回前同步安装管理 lease 错误监听，并保持至
连接销毁。获取失败时销毁已经获取的 lease，脱敏底层连接错误。该资源 helper
不核验目标、不授予权限，也不取代调用者反复检查连接及目标边界。

纯测试命令：`node_modules/.bin/vitest run --config
server/modules/catalog-cutover/retirement/vitest.config.ts`。真实 SQL 由父 runner 使用
`retirement/vitest.integration.config.ts` 执行，不能直接对任意数据库运行。本分片
不交付生产命令或生产就绪结论。

## Bootstrap 凭据分片尚在实现

Bootstrap 认证退出是独立、尚未完成的组件。私有凭据准备实际写入并同步两个
原始凭据文件和其 0700 目录；公开 receipt 只含随机版本与精确文件身份，不含
密码或密码 hash。重新打开必须匹配原版本及文件身份，文件变化即拒绝。
这些文件系统证据不代表 PostgreSQL 密码已经轮换，也不是 P13 或生产批准。

低级 SQL 动作要求真实的标准 OID 10 管理连接、现有 S7 排他会话锁、精确数据库
目标、没有其他 bootstrap 会话或成员关系，并满足受支持的 SCRAM TCP 认证配置。
角色属性、名称、OID、owner 和 ACL 均保留。它仅在已有 0137 存储中追加独立的
认证 intent/applied 事件，不推进 cutover phase，也不创建 P13 checkpoint。
隔离管理动作测试可以使用真实登记的 prepared run；后续根入口仍须在调用前
证明实际 P12 binding、获批报告、恢复包、停写边界及真正签发的宿主锁。
本组件没有维护 CLI，也不提供这些尚未接合的批准。

初版单数据库限制不能支持常见的业务库与默认维护库并存。当前有界扩展只允许
实测 OID 5、bootstrap owner OID 10、默认数据库 ACL 的 `postgres` 维护库。
独立只读连接从已经验证的管理会话派生同一地址，核对集群与实测数据库 OID，
拒绝非初始化对象（PostgreSQL 16 的 `FirstNormalObjectId` 为 16384）、自定义
schema、非默认 public schema ACL、额外用户角色授权、默认 ACL、外部／大对象、
publication 及活动连接。该连接关闭后再核对数据库清单和 bootstrap 会话。
同名不构成身份或空库证明；其他业务库仍不受支持。密码写事务持有
`pg_database` 的 SHARE 锁，避免写入期间清单变化。这不是根 controller 的
完整停写证明，也不扩展恢复包范围。首次隔离业务库加维护库执行收集 10 项，
9 项通过、正向动作拒绝。之后的精确会话分类发现一个 PostgreSQL logical
replication launcher，而非泄漏的客户端；首次失败不能唯一归因于单库限制。
当前支持范围仅允许至多一个没有数据库和事务的内建 launcher，继续拒绝所有
客户端、复制 worker 及未知后台，并要求不存在复制 slot 或 subscription。
事务采样、parse/rewrite/plan 调试及语句统计在任何 intent 和 BEGIN 之前即拒绝，
不以已被采样的事务中再关闭采样保护密码语句。下述后续隔离成功不重标旧失败。
密码事务另外关闭 `track_activities`，在同一 lease 核验设置生效后才发送密码语句，
防止统计读取身份通过 `pg_stat_activity` 看到该语句；日志设置不能代替这项保护。
检查入口在第一次 await 前固定目标、run、attempt、custody 和 client，调用者之后
修改输入不能替换本次选择的恢复 attempt。强化后的反例已单独执行：旧实现加新测试
在 runner 候选 `34f3c12a8` 收集 18 项、16 通过、2 失败；修复后的 runner 候选
`75a88cf0687a07a93367f18e2e0ba228a4176684` 在 3.75 秒内 18 项通过，资源清理核验通过。
其代码和测试 blob 与组件 `3ec370aeb` 一致；此前 17 项结果不覆盖这两项修复。

后续两个进程／传输反例尚未执行。测试仅向 receipt 已证明的隔离数据库转发，观察
真实服务端 COMMIT 回复：第一项扣住 intent 提交确认后终止真实子进程，检查应看到
旧凭据仍有效且原 intent 待判定；第二项在密码及事件事务已提交后断开实际连接，
通过新建管理连接核对同一私有版本。测试不伪造 COMMIT、认证结果、applied 事件或
批准，不修改既有测试与监督超时。这两项验证认证组件，不代表整状态恢复资格或 P13 完成。

template 标记不能绕过数据库清点。只接受实测默认模板 OID 1／4、bootstrap
owner 和默认模板 ACL；可连接的 `template1` 与维护库一样执行独立只读目录检查。
`template0` 必须保持不可连接且没有活动会话，只在这个默认模板范围内保留，
不临时开放连接，也不声称已经查询其中业务内容。额外模板数据库或 `template1`
内的用户状态会拒绝动作；执行器不改变模板标记、ACL 或连接策略。

私有版本先持久化，再写 SQL intent。密码事务只改变认证秘密，并原子追加
applied 事件。提交确认丢失时不重试轮换；检查必须匹配原 run、attempt、私有
文件身份及不变的权限元数据，真实新密码会话须连到同一 OID/数据库，旧密码
须被拒绝。只有 SQLSTATE `28P01` 算密码拒绝，网络故障、私有文件缺失或事件
与认证不一致均保持 unknown。成功标签仅为 `authentication-fenced-not-P13`。

截至源码 `4ba8a753020b178967e271abc3e5034309a3150e`，已通过父创建资源的专用
入口执行；真实 checkout 为 `f122a62854c46cdbcb96668d17b549b215a28af3`，tree 为
`f44599a6af253d187bc771c6a72a79970ecba986`。**收集 17 项、通过 17、失败及跳过
均为 0**，耗时 2.43 秒，退出码 0，资源清理核验通过；正向用例耗时 314 ms。
镜像为 Linux arm64 的 `postgres:16-alpine`，实际 image ID：
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
原日志 `/tmp/upg824-bootstrap-seventeen-fixed.log`，SHA-256：
`e67b4d5c9aca7e50a971607056378189ea3a834127397954666988a5008a7809`。
这是本地协调交接证据，不是已上传附件，也不是在本报告提交上重跑。它证明真实
新旧密码认证生命周期及列出的拒绝场景，保留 bootstrap OID、属性和代表性
owner／ACL／数据；尚未覆盖未知提交确认、进程中断、完整角色恢复、真实 API／worker
启动、生产授权或完整 controller／P13。整个分片的独立审查仍待完成。

本分片曾两次误用 `vitest.server.config.ts`，而非本目录的纯测试配置。
两次均收集 0 项用例，在 `server/testing/testDatabase.ts` 的共享 migration
ledger 检查中失败。失败前的 setup 可能创建迁移模板、删除陈旧测试数据库，
并执行 ledger 初始化 DDL；日志不足以确认哪些写入实际发生，不能声称没有
写入或已经回滚。执行身份为 `d3e2af891c198859a25753cc98bf5d21d379e5c3`
加两个未跟踪 bootstrap 文件。原日志保留于
`/tmp/pr824-bootstrap-custody-red.log` 和
`/tmp/pr824-bootstrap-custody-green.log`，均不算有效 Red/Green 证据。
之后的只读环境检查未发现显式数据库 URL，但不能倒推此前进程环境。
该配置会回落到 loopback 默认数据库，没有独立签发的目标 receipt；没有再
连接该目标调查，也没有对其执行清理。

纯测试仅使用现有 `retirement/vitest.config.ts`，以 `env -i` 保留 PATH/HOME，
精确选择 `bootstrapCredentialFence.test.ts`；该配置没有数据库 setup。
后续真实 PostgreSQL 用例使用单独的 `bootstrapCredentialFence.integration.test.ts`，
必须有父监督器新建的独占集群和 receipt，不能通过通用 server suite 执行。

### Bootstrap 故障代理与 Linux 小报文延迟

Hosted `34138417314`、head `c04d42703` 的 endpoint 16 例通过，随后 bootstrap
20 通过／2 失败。两次失败都在原 2000ms 内未观察到 COMMIT 2，COMMIT 1 用例通过；
这不能证明凭据、PostgreSQL 提交或生产环境发生了故障。

代理将服务端响应逐个 PostgreSQL frame 转发，但两个新 TCP socket 仍启用 Nagle。
锁定的 `pg` 客户端连接已调用 `setNoDelay(true)`；现在测试代理在转发前对两端做
相同设置。帧解析、实际字节、指定 COMMIT 截断、2000ms 观察限制及原 test/hook
预算不变。[Node TCP 文档](https://nodejs.org/docs/latest-v22.x/api/net.html#socketsetnodelaynodelay)
说明了默认缓冲与该设置；没有更改服务端或运行期 fence 配置。

限定的 Linux/arm64 Node 22.21.1 容器，镜像
`sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf`，
运行 `c04d42703` 的实际代理与 30 轮合成 loopback 请求／响应。原版总计1263ms、
中位42ms；仅加 socket 设置后总计5ms、中位0ms。两者字节相同且都截获 COMMIT 2。
容器禁用外部网络，没有挂载或秘密，已按精确归属身份清理。此前 macOS 对照为5ms与4ms，
未复现延迟；初次容器调用漏开交互 stdin，零观察，不算通过。仅修正后确实得到两条
结果的运行构成 Linux 对照证据。本探针不使用 PostgreSQL。

`scripts/bootstrap-fault-proxy.test.ts` 从测试语法树执行实际代理函数，以合成 TCP 帧
验证，不导入数据库 setup。它要求两端在转发字节前调用原生 no-delay，核对完整响应、
COMMIT 1 保留／COMMIT 2 断连和清理；不设速度阈值，不伪造 SQL 或批准结果。
新增两例在原代理上失败，修改后通过。真实 bootstrap 22 例和新的 Hosted 执行仍须
分别核验；协议回归通过不等于凭据退出或 P13 已完成。
