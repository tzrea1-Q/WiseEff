# 存量升级候选证据

> English: [English](populated-upgrade-evidence.md)

## 中断后续工与最新 Hosted 结果

报告 head `ab446626c4998715fb2ec55aa32c53d714f517af` 的 run `34239424721`
已经结束：Build and test、smoke、quality 成功；owned PostgreSQL、Merge bar
失败；local non-HDC、target synthetic 跳过。SQL privilege 套件20通过、1失败，
失败发生在跨数据库用例业务断言完成后的 fixture cleanup。Bootstrap及其后续套件
未执行。这与上一轮 bootstrap deadline 失败分开归因。owned 原日志 SHA256：
`5bb2f69ccfde0d47b89b0a8d552dc13854b5d5a34e00f4e591fcb5562d4f04bb`。

诊断提交 `4d4b46cdbd071c9902f2805431ef51a81c30d9df` 只增加固定、尽力输出的
清理阶段标签，不输出底层错误，不改变清理顺序。本地 WIP 套件21/21通过，未复现
Hosted失败。独立静态审查通过；根因仍未确定，诊断不能算作清理修复。

父候选现已按原字节集成 Scratch `7cb5acd1346f349728783391a8a4b8b5f3717b71`
的十个源采集文件。该 Scratch 提交的正式 `legacy-source-capture-three-store`
入口实跑1通过、9过滤，100.99秒，未改变120秒用例预算，资源清理已验证。
这证明实际隔离旧源经 custody 绑定管理子进程采集，不包含P0、转换或完整升级。
日志 `/tmp/pr824-7cb-formal-capture.log`，SHA256：
`6645b5af47314e86a5a674460f0e81b036e40ca754d78886adc99e43e75959f8`。
父集成 WIP 的四文件 focused 为120/120，退出0；日志
`/tmp/pr824-source-integration-focused.log`，SHA256：
`c4bfca09ae900da404b86438888cb4ca4d2994b2a870dd20b67828b1e586656a`。
两次执行身份分开，不重标为后续提交。已有 Scratch 审查覆盖这些源文件；完整
startup/controller审查及A/B/C均未完成。公开 `ab446626c` 全文包不包含本增量。

## Inspection 加载增量

追加提交 `d18439ba7960b0688246695b39ffe67e0544b6f7` 按独立Spec意见删除所有本次新增
边界计时probe，避免日志拖延子进程确认。bootstrap integration test与`ffd0ff9f3`字节相同。
精确追加代码的真实自有PG16为44/44、18.74秒、退出0、清理完成；日志及hash见英文对应段。
独立Spec复审已关闭计时finding并通过净四文件增量。Standards静态审查无新finding；
其误用server配置的尝试同样在global setup因ledger拒绝，不计执行测试结果。新Hosted待完成。

代码 `59cd2741263d8538a95e0c72c8462aa343bb741a`，tree
`fdcea9dff305ebca366c12c072c8aa3615345579`，把原 Comparison 公共 projection 的
加载移到 apply 的获批报告核验处，仍早于任何效果；SQL、权限、期限和 gate 语义不变。
加载 Red 1/1失败；修复后 activation、held-session、loading 三个纯测试文件7/7通过。
随后原样提交的 WIP 在真实自有 PG16 上44/44通过、18.20秒、清理已核验。
前序干净 `ffd0ff9f3` 同套件44/44、20.76秒；四个本地边界用例的加载耗时从235–246ms
降到167–169ms，不能据此覆盖Hosted失败或宣称Hosted已修复。build/types/boundary退出0。

首次加载测试误用了 server 的数据库 global setup，setup在执行测试前因ledger不匹配拒绝，
不计作Red或通过。正式Red/Green使用无数据库setup的纯Node配置。独立审查和新CI仍待完成。
原始日志及逐文件hash见[英文对应表](populated-upgrade-evidence.md#inspection-dependency-loading)。

## Bootstrap 来源边界续修

未集成Scratch `607d2fbfce98a5d1f976fd03bb67af0a863c4233` 的正式owned
`legacy-source-capture-three-store` runner已通过选定采集用例：1通过、1过滤
（Vitest记为skip）、99.89秒、退出0、自有清理完成。它以
`--management-snapshot-input-file` 消费原私有custody输入，不再使用临时selector wrapper。
runner的通用`verified-by-complete-suite`字段只记清理，不能解释为过滤的业务用例也执行。
日志及hash见英文对应段。新增父清理失败路径仍需专门回归，尚未封存。

独立 Scratch `1ce73d4c21b7b20b86c5fafa1bfc0fbfaf8d1988`，tree
`e670a5c8961813130c24dc1cfa9b7b0434bfd1a7`，通过调度范围的独立 Standards/Spec
及26/26纯回归。随后真实旧源采集在不变的120秒预算内通过，用时103.92秒：1通过、1过滤
（runner显示跳过），退出0。候选内部子进程读取126关系、126条源迁移、12条待迁移，未执行
迁移或P0。采集 cleanupRejected=false，runner清理true；runner通用的
`verified-by-complete-suite` 标签不能把此 selector 记作全套通过。该clean Scratch尚未集成。
此前156秒超时保留；源准备耗时也不同，不能将全部改善归因于调度。日志及hash见英文对应段。

代码 `1eb67491386a22392dafb741ff4a137a6477be87`，tree
`4795bd23de24c417e45998557d3e5ce0680bb686`，承接报告 `8bf6706b6`。
独立 Spec 发现 bootstrap hook 未重验运行来源。两个效果前反例证明管理来源丢失／配置漂移后
仍继续；第三个反例证明最终 inspection 丢失来源后仍记录 `credential-step`。修复复用原来源
核验，在效果 hook 和非 unknown 宿主记录前后调用；unknown 仍依赖尚存的宿主边界。
独立 Spec 已复核该提交并关闭 P1；独立 Standards 也通过三文件及双语手册增量，另复跑根测试
74/74。审查者的 docs governance 通过，但缺pgvector导致schema验证跳过，不记作完整docs通过。

随后原样提交的代码 WIP 上，根调度回归83收集／83通过／0失败／0跳过，退出0。此前三个
Red 在实际继续执行／完成记录断言失败，不代表真实密码轮换。真实 PG16 为20/20、退出0、
清理已核验；执行时是以 `8bf6706b6` 为基线、添加宿主记录复核之前的 WIP。
当时没有保存完整 WIP tree/blob 快照，因此仅保留中间执行证据，不能归属已提交的
`1eb674913`。独立交付包审查后撤回此前“blob相同”的声明。最终代码 build
退出0，保留既有警告；完整 P13 和真实启动仍未证明。

Hosted `34234885440` 已结束，实际 merge checkout 为
`437a6fc4b568e4cb88f56dda1c5a012edcee8add`：Build/test、smoke、quality成功，
owned PostgreSQL与Merge bar失败；target synthetic和local non-HDC跳过。
bootstrap credential套件40通过／4失败／0跳过，四个final-boundary独立子进程检查超出1500ms；
其后串行owned套件未执行。干净的本地报告head `ffd0ff9f3` 同套件44/44通过且自有资源清理完成，
不能抹去Hosted失败。

已提交代码 `1eb674913` 的 owned scripts 随后为2058/2069通过、0失败、11跳过，退出0；
source-lock另计4/4，清理已核验，原boundary退出0。原始日志/hash见英文对应段。
前序 `2ef8cdae3` 的 backend 与真实PG证据仍保留原执行身份。

精确原始日志、hash、容器和网络身份见[对应英文证据表](populated-upgrade-evidence.md#bootstrap-source-boundary-follow-up)。
本次日志仍在本地，待下一份公开全文包；已有 `8bf6706b6` 公开包不包含这次续修。

## NW 续工，2026-09-08

### 管理会话接线集成

代码 `2ef8cdae3ce7e7996656efdb4a7ae9ba2492a618`、tree
`36e41f8a696f98caa7013411a07678ceb1d86459` 原样集成源提交
`6d2637196`、`f76a79b65` 和 `cd377f4d1`。退休执行方核对实际租借的管理连接与
已签发来源，包括端点、数据库和真实观察到的 advisory challenge。
解锁结果不确定时销毁调用方 lease、使来源失效；清理失败保留先前准入错误码，
不导出底层 cause。独立 Standards 核验新增 cause、隐藏属性和 JSON 脱敏断言后
关闭最后P2；父Spec接受限定单元。

同一集成代码的两个focused套件收集／通过80/80、失败／跳过0/0、退出0。
Strict TypeScript、build（保留既有警告）及原trusted-base boundary均退出0。
同一集成的 `runtime-role-source-pg16` 收集／通过19/19、失败／跳过0/0，21.25秒、
退出0、清理已验证，使用下文记录的显式owned daemon及PG16 Alpine镜像。
源 `f76a79b65` 先前19/19仍单独保留，当前Hosted待完成。
日志尚在本地，待下一份全文交付包收录：

| 日志 | SHA256 |
| --- | --- |
| `pr824-2ef8-source-pure.log` | `c8e91c3a11347af6a575687faf6bdb2d72dc3735dcd781b36a08c82b2cde17e0` |
| `pr824-2ef8-build.log` | `ae94642175174266c03c0c413fd5d74c19a8b8cbcdd81fca5a946b4e958aa23f` |
| `pr824-2ef8-types.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `pr824-2ef8-boundary.log` | `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| `pr824-2ef8-runtime-source-native.log` | `51d5d1b189016bbbf20bd3e82c2e7f26cfc0157280260ef9db24588b3bfda19c` |

第一次完整scripts通过 `env -i` 调用，未配置必需的owned PostgreSQL／TMPDIR／
容器输入，退出1：1976通过、62失败、28跳过（2066），另有四个套件setup错误。
Source-lock单独4/4通过。这是父协调者的执行方式错误，不是继承代码失败的证据。
旧rehearsal helper选择了默认本地测试目标，exporter报告临时路径清理失败。
原结果保留在 `pr824-2ef8-scripts.log`，SHA256
`f7daf6edcf9fbcc152ce3a68de96418a2a9a3bec2f1ac03250d365b440f59b20`。
修正执行复用既有 `scripts-pgvector` owned runner，结果单独记录：137文件通过，
2055测试通过／0失败／11跳过，前置source-lock另计4/4；退出0、清理已验证。
同一代码的owned backend为4322/4322、无失败／跳过、退出0、清理已验证。
Owned docs同时验证governance与真实schema产物，退出0、清理已验证（报告Markdown
当时为WIP）；contract和selfhost均退出0。未放宽断言或预算。这些结果不覆盖合法
隔离启动、完整controller、浏览器业务验收或增长容量。

| 补充日志 | SHA256 |
| --- | --- |
| `pr824-2ef8-scripts-owned.log` | `6aadea7a8d4f0ec84b657e7723c9ad5489e8f5cc2038ebf0366d9378b9cb7e2c` |
| `pr824-2ef8-server-owned.log` | `9d7e5ee66d9e0ac61b1e30c1bd619b11c7e2da8f2d50992069d111df619b3fe1` |
| `pr824-2ef8-docs-owned.log` | `7438f859771d8e0b458ea29622ebc0ebdfedd9bc413a11f3b866aecad5a7586e` |
| `pr824-2ef8-contract.log` | `b360b9bd3abdfe68681a8d267d5287709d4444710f48e2e21afb069a384d9981` |
| `pr824-2ef8-selfhost.log` | `fb3bebbd4a67124cfc37061ec47e862690f238d75a55a572211b4ba5a2701f56` |

完全相同代码随后在干净的detached验证checkout执行 `handoff-three-store`，
9/9通过、70.54秒、退出0，全部nested清理已验证；应用容器仍为身份fixture，
不是真实旧应用。此前从父协调者含未提交报告的工作树运行，被正确拒绝
`handoff-entry-artifact-changed`（8通过／1失败，nested清理unknown）。修正checkout
保管条件后只重跑受影响套件。日志 `pr824-2ef8-handoff-clean.log` SHA256为
`e6dc845e379dffdb33bac03159a3bef83418587b70df02eb3249f9b4cc454268`；
原拒绝执行 `pr824-2ef8-handoff-owned.log` SHA256为
`7a4bf7bec95c8d56ef89a077931a3e5da37154990fde7974f52d73523edd2058`。

### Handoff批处理与原生RI触发器可达性

集成代码 `f950e02cea8d67b423b3a3d84677827dc72fe0ab`、tree
`f5b5823ab11500568e95ea06686266334a1d9e8d` 沿用原base。精确容器／卷批量观察
保留各阶段独立边界检查。源 `8d6a49b6c` 的真实handoff为9/9，同tree集成为
`71ba53ea1`；这些测试不是完整旧应用升级。

RI修复沿外键动作追踪非退休表上已安装的SECURITY DEFINER触发器，再复用原有
退休对象写能力检查。两个真实受限登录反例此前已修改 `driver_schemas`，V13却通过；
现在均拒绝。invoker反例仍不能修改该表。父Spec与独立Standards通过限定修复。
Standards审查者核对真实反例后撤回了限制dispatch范围的初始建议，因为该限制会恢复
两条漏检。未改变权限或发布阶段。

在集成 `f950e02ce` 上，`writer-reachability-pg16` 收集／通过38/38，失败／跳过0/0，
退出0、耗时6.11秒，runner与相关资源清理已验证。显式owned daemon为
`07ef20c3-7210-41f4-b337-5f617ca84c0d`，PostgreSQL16 Alpine镜像为
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`，
linux/arm64。build（保留警告）、包含两个修改测试的strict types及原trusted-base
boundary均退出0。日志SHA256：

| 执行 | SHA256 |
| --- | --- |
| 真实PostgreSQL | `3968197348ee799a78ef1685e87807ddb39ca4ad477e1a8e7b4e679e9c444237` |
| Build | `1ea63b5bd6104e12597eaa963e5290a7fa5a164f9078bca0347bdaa597fcc26c` |
| Boundary | `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| Strict types（成功空日志） | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

这些结果不覆盖独立管理会话来源接线或完整multi-head producer。Scratch采集
`f6ab3b705` 实际返回126个关系、126条源迁移及12条待执行迁移，但用时155.215秒，
超过未改变的120秒预算而失败；runner清理通过，nested cleanup仍为unknown。
Scratch `785acd2d6` 将原正向plan断言改成预期不支持；其报告的1/1绿色不接受为验收
证据；提交 `fbbd52a2d4cd807960ef3d63d3cbfc8d35d2ae0c` 已恢复原正向要求，
尚无后续正向执行通过证据。两次执行均不证明P13、合法启动、完整controller或A/B/C完成。

### 普通 LOGIN 后续 SQL 退休

代码 `bd4ad49c85c5eeaa2e351245f5a4b616af700399`、tree
`22bb45b5aa84c82f79b5480edb037d116a1beb8d` 已原样集成，未改写执行身份。
源报告 `5822d889c` 仅修改退休模块手册。
[限定实现、原反例及执行 hash](../../server/modules/catalog-cutover/retirement/README.zh-CN.md)
记录根调度130/130、真实 PostgreSQL 21/21且清理核验通过，以及types/build、
boundary3509/3509。父Spec和独立Standards通过本分片。PG用例使用真实受限连接及
既有SQL owner；夹具P12引用不是获批宿主根入口证据。报告 `d5aefa28d` 的Hosted
`34219075502` 随后在merge `f5acf76cef1fa667620c12c25262420e11282746` 通过必需job：
owned477/477、scripts2035通过／27跳过、backend4322/4322；local non-HDC和target
synthetic跳过。[原始日志](https://github.com/tzrea1-Q/WiseEff/tree/06ba6f7c9ae2d66957a24366085b6de9d307031c/owned-d5aefa28d-reviewed/hosted-34219075502)
不覆盖上方后续集成。完整P13、合法production启动及完整controller仍未完成。

### 已退休模块映射写入口集成

集成 `ce3eee2f27f7e0b3eeec8e163a3cf0196ba47a94` 与源报告
`e5aa2712f4bce573e1cb5a6eabdcbc5fec78e09c` 的 tree 相同：
`14023ee5c0b769fe4b737ea45afa4fcb06b78966`。真实执行属于源代码
`cf15075ee7e8170f25d06ea065e6ad9a25f3a975`：V13为35/35、5.87秒；
SQL fence为20/20、130.10秒；均零失败／跳过、退出0、清理核验通过。
日志 `/tmp/pr824-module-mapping-cf150-gate-green.log` 与
`/tmp/pr824-module-mapping-cf150-effect-green.log` 的 SHA256 分别为
`5ab4a5d55ca898207c6d524f1050bf387550909a55c2abeda98690e0dc3979df`、
`fc6865db043e928793620dbb65c3fc9b0c35c15be47bd8620ad6002e82a9c7d1`。
限定独立审查及两次真实失败反例见 retirement 模块双语 README。本次仅修复既有写入口
范围，不新增 grant 或 migration，不代表完整 P13 或运行批准。
报告 `6d8fbe2bf` 的 Hosted `34213839839` 已成功结束，merge 为
`e3fb8ebe295762237f8696eee4d684187f4093f4`。十六组owned全部执行，476通过／0失败／0跳过，
清理核验通过。Frontend3374；source-lock4；scripts2019通过／27跳过；bridge134通过／4跳过；
backend4322。Boundary、contract、log-eval、smoke、quality、Merge bar通过；local non-HDC、
target synthetic跳过。[原日志与执行索引](https://github.com/tzrea1-Q/WiseEff/tree/5fd8a74f5ea440a67fcb24fde3e01a18db45009e/owned-6d8fbe2bf-reviewed/hosted-34213839839)
保留精确身份。[全文包](https://raw.githubusercontent.com/tzrea1-Q/WiseEff/b7b5c531c442f0d8cc2b108a49aeb867d7fbd737/owned-6d8fbe2bf-reviewed/pr824-authorized-full-files.zip)
包含359个完整Git文件、不含Scratch；SHA256为
`f40cf3aec5cab1f28966622cda331460fbfb6e031eebaf3ab1efa92b7c68716e`。
独立字节／材料审查及父重新下载checksum核验通过。包内manifest保留打包时CI待完成的
历史状态；后续CI索引单独记录完成，不改写历史包。

### 最后边界夹具后续修复

Hosted `34197132779` 已失败结束，报告 `23f3a7e21`，实际 merge checkout
`b3e9bfea958fe91f77a97747f70204a3067875eb`。Build/test、smoke、quality 通过；
local non-HDC、target synthetic 跳过；owned 和 Merge bar 失败。
Build/test 实际执行 frontend 3374/3374、source-lock 4/4、scripts 2019通过／27跳过、
bridge 134通过／4跳过、backend 4322/4322、boundary 3509/3509、contract、log-eval。
scripts 跳过为历史 rehearsal 16、handoff 1、runtime identity 5、vendor DT 5；
bridge 跳过为 CLI 2、macOS URL scheme 2。

Owned 到 bootstrap 为40/41：仅 `final-boundary` 触发既有1500ms独立子进程期限。
原 acknowledgment-loss 和 native probe 回归通过；后续 recovery、handoff suite 未执行。
原日志 `/tmp/pr824-ci-23f3-owned.log`，SHA256
`76fe0e229f12e1e0eb01bd683a6ac2df4c4b090dfb303e4ac363120013ae68a0`。
一次未改代码的本机 `23f3` 对照为41/41、18.41秒、清理通过，未复现 Hosted。
日志 `/tmp/pr824-bootstrap-23f3-timeout-control.log`，SHA256
`985d853d98158b3836b3db6fa94bb453a7ee21ff7cd76f704d8b6abe164f7010`。

仅测试源提交 `2747faf47ab46171891a9742dd4fb1d7754ab9f3` 与集成
`de225d63913ae51856b819b39e6061763bd0950d` 的 tree 相同：
`b22fa72f940a8b0f17fa4648f9bf3c232d4e2b47`。原聚合检查拆成四个独立命名的最后边界用例；
每条保持真实 `55P03`、锁释放后执行成功、1500ms子进程期限及50ms锁超时。
恢复还覆盖阻塞阶段本身失败的路径，生产代码及其他用例未变。
正式源执行44/44，零失败／跳过／过滤、20.97秒，清理核验通过；四例耗时
922／865／905／880ms。日志 `/tmp/pr824-bootstrap-boundary-split-full.log`，SHA256
`96227b31bf3e27ed95d08e0eaba220c5a1080f80030bcb1b4ba1fe3e7c84ed7f`。
独立 Standards／Spec 均通过该单文件增量。拆分让每个子进程窗口少等待三次锁超时，
但不证明原 Hosted 的精确原因或未来稳定性，也不代表启动或完整升级完成。

集成 `de225d639` 的 build 退出0，保留既有警告；boundary 使用未改 trusted base，
保持3509/3509。日志 `/tmp/pr824-de225-build.log` 的SHA256为
`abba015b58a21f80519ad0ddc35ebabb5549f28168a8a5f1a5ce7d22e0a51959`；
`/tmp/pr824-de225-boundary.log` 的SHA256为
`6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795`。
随后 Hosted `34200531532` 成功结束，报告 `504fd4046`，实际 merge checkout
`ed57cadcdc5c599e02635aac2f772c8bd84c95ca`。Build/test、owned、smoke、quality、
Merge bar通过；local non-HDC和target synthetic跳过。Frontend为3374/3374；
scripts为2019通过／27跳过，另有source-lock 4/4；bridge为134通过／4跳过；
backend为4322/4322。Boundary、contract、log-eval均实际成功执行。
十六组owned全部执行：reader49、writer34、runtime identity11、runtime-role-source13、
SQL privilege19、read projections10、report36、authority81、bindings98、Redis12、
activation22、retirement16、bootstrap44、三存储恢复16、controlled recovery4、handoff9。
合计474通过，零失败／跳过，各suite均报告清理核验通过。这些仍是组件验收，
handoff应用仍为identity stub，不是完整旧应用升级。
原owned日志 `/tmp/pr824-ci-504fd-owned.log`，SHA256
`01bd876306d2cdfea28341ff2deedb9d87e9323e878b789c9576805d8c07ab71`；
build日志 `/tmp/pr824-ci-504fd-build.log`，SHA256
`9f436137990b5ed997078a1a12e74f484ecbc8cd1e64f6215b1751c390d09697`。
这两份日志未倒填进已发布的 `23f3a7e21` 文件包。

### 集成后续候选 `0390bd028`

代码 `0390bd028219b464e143418cb13155d3819aee0e`，tree
`bdd8c313172648b2fedf58b2790775213fa9ab0f`，base 保持 `cda6737a8`。
以下执行期间 HEAD 和代码未变；后续文档提交不构成新的代码执行。
Node 22.22.3／Vitest 4.1.5，仅开发隔离环境。

| 执行 | 结果 | 本地日志／SHA256 |
| --- | --- | --- |
| scripts 配置下 controller、handoffDataSource、upgrade-component-ci、run-upgrade-component-tests | 97/97，零失败／跳过，退出0 | `/tmp/pr824-0390-focused.log`／`f2dc90a596d9be23b362629d937e84c6450b9a51ec2738c44bcab9a5ce6c21bb` |
| `npm run build` | 退出0，保留既有警告 | `/tmp/pr824-0390-build.log`／`d99411a7e6ba2d37789984e0935a60c1f3dce6efc9c6010441251c48304f130c` |
| Boundary，原 CI trusted base `9b3ba7df7e21f5589684bc92c872da593ad4c246` | 3509/3509，无新增／stale／不匹配／增长，退出0 | `/tmp/pr824-0390-boundary.log`／`6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| 正式 owned runner `--suite docs-check` | governance、真实 pgvector schema 产物及清理核验通过，退出0 | `/tmp/pr824-0390-docs-owned.log`／`38d0d45cc59844a373b03a8adc693fbcd3efdbf4432c553071315a7f25b135d3` |

独立源执行保持原身份：`c2197ae17` 正式 `handoff-three-store` 为9/9、77.32秒，
退出0、清理核验通过。日志 `/tmp/pr824-handoff-data-c219-actual.log`，SHA256
`465c86b2a5b5a19a3a82ad96e9b0f7808a952c33ded7f479752defcd19b631a2`。
该执行使用真实 owned 三存储和私有传输，但应用容器仍为身份 stub，并非旧 API／worker。
它已登记到强制 owned CI 路由。

bootstrap 源 `3fa5db71e` 正式完整入口为41/41，零失败／跳过／过滤，17.65秒，
退出0、清理核验通过。日志 `/tmp/pr824-bootstrap-probe-3fa5-final-green.log`，SHA256
`6e4fd6a31068c45f48222ebb97ae9477830edccae9bea5e487ba8af6bba1e704`。
deferred 真实 PG Red 观察到下一次 guard 执行时自有认证 PID 仍存活；修复等待原生终止
再进入后续 guard，保留 unknown 和权限合同。两次原代码本机对照未复现 Hosted，
因此不能声称已证明原 Hosted 失败的精确原因。

run `34192523701` 已失败结束，merge 为 `7affb0894c4d78446efbfaf534ff61561c44e0a4`：
bootstrap 39通过／1失败。child 已返回 `not-applied`，父后续 fresh-manager inspect
返回 `unknown`；后续 owned suite 未执行。Build/test、smoke、quality 通过；
local non-HDC、target synthetic 跳过；Merge bar 失败。原日志
`/tmp/pr824-ci-4b-owned.log`，SHA256
`c36cc577c9b303bde9645dcdaee1b5503de29dfef8f575d248d6f656cd5a063c`。
它与此前 runtimeRoleSource 会话数失败及各次超时分别记录。
以上不代表当前完整 scripts／backend 或新 Hosted 已通过。

bootstrap、handoff、mapping／codec 分片分别通过 Standards／Spec；另有新独立审查者
只读审查 `4b346d6ef..0390bd028` 集成并给出 Spec PASS、无 P1/P2；审查者没有执行测试。
审查范围不包括完整 provider、P13、获批应用启动或完整升级。A／B／C均未完成。

新增执行安全偏差：父在 `b7c64328f` 对两个纯测误选 server 配置，global setup 到达
默认／共享开发库 ledger 后拒绝，零用例执行。编号 migration 循环未运行，但 bootstrap
DDL 影响未完整观测，不能声称零写入；没有在那里尝试修复或清理。日志
`/tmp/pr824-b7c-comparison-pure.log`，SHA256
`6b18e73e96371936054a33df4c457641d4a6b29101a68b23714a4b5290de2fd3`。
后续纯测显式不加载 global setup，数据库验证均使用正式 owned runner。
这是独立于下方历史事件的新偏差，不计为通过证据。

### 固定 NW-01 集成

代码 `25e8aabaee5bedd709aa15d02e6e6d020cc5550c`，tree
`e03802313b64eaf4f33fc04299f06072fe9f9fb5`，加入独立双审通过的跨数据库
夹具生命周期修复。源 `074c49c0b` 正式完整 19/19 通过，114.97 秒，退出 0，
清理已核验。第二个空数据库在专属既有 hook 中准备；清理先等待真实在途工作，
再移除跨库依赖和共享角色。所有测试／hook 预算及 SQL 断言保留。源日志 SHA256：
`9cc822fdb13485be96c34089dd399eb8309a81dcf41ed2ac4ab3216c4cae5ee6`。

`25e8` 后续正式 owned 执行通过 read projections 10/10、report 36/36、
authority 81/81、bindings 98/98、真实 Redis 12/12、activation 22/22。
随后 retirement 的 10000ms 准备 hook 失败，1 通过、15 跳过；失败期间父同时
运行了两个 boundary 扫描。相同代码、无并行扫描的完整对照 16/16 通过，23.56 秒。
另一个仅诊断的 Scratch 测得准备耗时 6077ms，也通过 16/16；这些不证明扫描与
失败的因果关系。未修改 retirement 代码或预算，未集成诊断 Scratch。对照日志
SHA256：`d6fa9fbc81154331b720ece3305a90688140b9d2d990450b0f4d51ecdd556c07`。

明确续跑的后续套件通过 bootstrap 40/40、合成三存储包恢复 16/16（382.57 秒）、
受控恢复 4/4（364.40 秒），均核验清理。这些是分别执行的组件证据，不回写成
一次未中断的串行成功，更不是完整升级。全量 scripts 先通过 source-lock 4/4
（47.65 秒），再通过 2013、跳过 11、失败 0，共 2024（129.07 秒）。跳过分布：
handoff 1、vendor DT generator 5、通用 runtime identity 文件 5；独立真实
runtime-identity 套件不能重标为这五条已执行。全量 backend 4311/4311，零跳过／
失败，181.43 秒。build、contract、selfhost 退出 0；CI 固定 base 的 boundary
3509/3509，无新增或失效 allowance。普通 docs 退出 0 但跳过 schema 子项；
随后独立严格 owned pgvector docs-check 验证了实际 schema 产物及清理。
这段验证期间仅两个 boundary 文档命令示例未提交，无代码或 HEAD 变化。
尚无新的 Hosted 结果。

日志前缀 `/tmp/upg824-nw01-25e8-`（本地证据，不是下载链接）：

| 后缀 | SHA256 |
| --- | --- |
| scripts-pgvector.log | `5b7ee934eeda53c4cf32280af2d2b958784f8b6a93811d551817ce544b29154f` |
| server-pgvector.log | `db5d56ee05072e14109b91491400ddba3497a5553b763c0d13bec2b2c92325f9` |
| build.log | `0e172463482c4fa315f1a761ac704aa70e4059bd739f6ba74388e69085a466cb` |
| docs-owned.log | `0a6dff3e5d48939e0ca60b073b07680de875000ffa6a0d4a7a98b614eedfc3a5` |
| boundary-ci-base.log | `6eecbc7c68f93a34280ba53bb4a3837ff844959de6391569ee190fe9a3b0f795` |
| recovery-three-store.log | `e5b5bcb933b6f39735ae877ee1b02d8d84f4c3812448134d6cf288337e3bb70c` |
| controlled-recovery.log | `a18d0f4dcfb3f8615976bedbbf0a77b0a649e79a08f2cd9f7aea8481b82d6ae1` |

### 较早的 NW-01 执行

本地代码 `2a96d3f31f8ca00559b7fb81ea578632ae9ec165`，tree
`5bfa1d4febe0085ac1d760ac9dce96d9038a7a09`，已集成独立审查的 NW-01
原生连接关闭修复及获准的 D-A 审计重定位。base 仍为
`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。本地执行没有 CI merge-ref。
远端报告 `b5ef257cc` 的 `34169931811` 仍是失败执行；其管理会话断言
与下面新发现的本地失败分别记录。

未修改的正式组件 runner 按原串行顺序，在独立核验的开发 Docker daemon、
PostgreSQL 16 Alpine、linux/arm64 上执行。该固定代码的 reader 49/49、
writer reachability 34/34、runtime identity 11/11、runtime role source 13/13
通过，均退出 0，无跳过或过滤，清理已核验。下一项 legacy SQL 为 18 通过、
1 失败，共 19，退出 1：跨数据库用例超过原 5000ms 预算，夹具报告清理失败；
外层 owned runner 核验其资源已清理。该批次后续套件未执行。build 退出 0，
保留构建警告。这不是全部 owned 通过，也不是启动通过。

日志位于执行机器 `/tmp/upg824-nw01-2a96-<名称>.log`，不是下载链接。SHA256：

| 名称 | SHA256 |
| --- | --- |
| reader-pg16 | `62cc1e1a899d84cc45fbe2b7faeaec2daf4d56a9e625d9716f9620cb6158414d` |
| writer-reachability-pg16 | `ac39cb4b824a3433ae78381fad54f38654c994dcb2dc45a478669f16446a89c9` |
| runtime-identity-pg16 | `7643e9c36faa586728407c0204d1f0dfd4199ca1310047f5071b708ade66776d` |
| runtime-role-source-pg16 | `9b7b8305559be3b468ccd9f93d06cc0280eae8d22218ab051f6a0ec7e66f66ce` |
| legacy-sql-privileges-pg16 | `ba7739739f0dbf0638d5c56d5547b4f14cef4391ca143839ab4c25d1aab9860b` |
| build | `b452864ba63d9b5630480de71784d50042724ddb3eeed4d6d7b2fd2d8e37d9fe` |

D-A 已获准并在 `86d590713` 集成；下方历史段保留其当时未批准状态。
自然修改的测试文件精确 blob 为 `e019e246ea36a9ced4a70b572bc4c03d22eaad0b`，
三条受保护原始切片及权限元数据已独立核验。重定位测试 69/69 通过。
该精确测试文件另一次真实 PG 执行 15/15 通过，但执行期间 checkout 的无关
runtime 源文件前进，因此只作为该文件的证据，不记为固定整候选执行。
D-B 仍在实现；A/B/C 均未完成，未访问生产。

## 历史集成候选，2026-09-08

Bootstrap集成 `864bd95f180a297fb0fd3ec04aeeaf930b36718c`，tree
`3174a0505facdf5d4b298c208057024152a490ca`，实际owned
`bootstrap-credential-pg16` 收集／通过40，失败／跳过／过滤均0，13.86s，exit 0，
清理验证通过。原日志 `/tmp/upg824-bootstrap-864-owned.log` SHA256：
`0988bfa8f857ba0d42f42e11a71c611c291320b0df2f496cb9dcfd9611b87535`。
独立审查源为 `c4b99f4ba5f2bb6faf3f517ec58a6f4dbfea95cc`；其另一次真实40/40耗时
14.35s，日志SHA256
`bb6a58244aa9590a54f5d3581c14c49bed4d1bba0c8ead510e24133d0ada597c`。
Lagrange Standards及Fermat Spec独立通过该增量。原子进程／用例／hook预算均不变。
同环境对照中，原聚合用例在 `cf494324c` 为2046ms，在 `b7bd0e645` 为4709ms；
现在准备与新增子进程分别有生命周期，清理前等待未完成工作。准备／清理双失败保留
安全的首错阶段／代码及独立清理原因。这些是夹具／传输结果，不是获准API启动或完整P13。

独立审计排序失败已在base和CI checkout以真实相同时间戳复现。测试修复尚未集成：
自然修改造成三处冻结occurrence位置变化，保持字节布局的替代方案不能作为边界授权。
两者均不修改生产审计行为，也不记作当前候选CI成功。

自然修复单独保存在
[`009ce086a3050ce555806394463bb8d179c70fbb`](https://github.com/tzrea1-Q/WiseEff/commit/009ce086a3050ce555806394463bb8d179c70fbb)，
未集成本候选。旧／新完整blob为 `79c7bdf5cd4535d5d340e546a0037080ebae8c9b` 和
`e019e246ea36a9ced4a70b572bc4c03d22eaad0b`。三段未变SQL从365／384／423行移动至
376／395／434行，均偏移1017字节。Fermat独立核验原始字节与权限元数据未变；映射
仍待用户独立身份决策，不申请通用位移规则。该固定自然候选尚未PG／build，不能借用
已排除的布局保持方案的执行结果。

报告 `c9dd70008a6bbc5a25941d842bb44dd919e9af07` 的完整owned scripts通过：
source-lock4/4（39.22s），随后2012项中2001通过／11跳过／0失败（86.91s），清理验证
通过。日志SHA256 `212a0ca7a8b5966b5a0ebc4704402e2d5b69af8f52b966f2ef6f4e51d113fc8b`。
Build exit 0，保留警告（Vite7.85s），日志SHA256
`2f62cfc00eefdd3d8e3cafb1dcf492dd75548046229ec33cf8cc660f3f87675a`。
原base boundary、contract及selfhost均exit 0。这不修复待处理审计排序反例，也不覆盖
此前Hosted失败。
同一报告的完整owned backend为4310/4310、零失败／跳过、98.88s、exit 0且清理通过。
日志SHA256 `a14f197e09030eb8676a88fb11a24fd4c5af603c37df0a7eef6595f0d2513ebd`。
本次通过不消除已证明的时间戳相同反例。

后续集成 `b7bd0e6454e7db5c07435aac290ef77d5c3f151a`，tree
`964de0bb44a4292c8160f7ed5350347448fa7772`，加入分别双审通过的HTTP owner控制与原生
外键动作检测。父真实PG34/34、6.21s、exit 0、清理验证；HTTP51/51、1.73s、零失败／
跳过。Build exit 0、保留警告（Vite7.93s），原base boundary3509/3509、无增长。
上述PG／HTTP／build日志SHA256依次为
`e4b8168023ea0ea407f9df891c94fbe277edfbb4441620ff5133f3ea689082d4`、
`1995f029ce884575887abb60dbfcacb4e3b49ab8f0ba4cbaea1a22ddf4973a71`、
`6be96b6a4e9c34c85fae4d83921179458446125c8a15f8088987c9a01f5bea1c`。
API用例是真实注册／HTTP加数据库替身，不是production获准启动。RI检测不撤销项目删除
能力、不改原FK。后续数据库派发分析被子智能体工具的网络安全自动审查中止；未完工作
及独立审查不记通过，完整数据库封禁与P13仍未完成。

原永久入口 `applicationArtifact.build.ts` 在
`3cee9f235534dd5d2f5cfcc9e8ae46b95f6520c4`（tree
`97a9ccffc8dfe84ffb38ebb66731ff9ec097e30f`）改为调用真实终端，并实际构建同一源码、
独立进程读回、拒绝缺失／错误源输入，随后拒绝原包篡改，以及恢复字节后的再次复用。
命令exit 0，`/tmp/upg824-terminal-permanent.log` SHA256
`c2f639f967a490bdcd05512d165c04716d554c487b2fbd3d002581808920e6ec`。
包为 `sha256:cda7007066579eff3e82ffca6ede81a91d660f87a7f181d827edd9b55a5bbdad`，
加载镜像 `sha256:db0ccc9915f16f9bcdfd50612c93247e4efb18c4c9dd115ba2fee2a3a086183b`，
平台manifest `sha256:82717e836965c30246859dc038e60585984872226a3b5f0dc5f0a023b45d9942`。
故意损坏的负测run不可复用，之前 `73f12a24e` 成功包单独保留；两者均不是发布。

报告 `d79b9b23bcf7799613aa4d8265fedf1ab4ac6240` 的Hosted run `34167230816`
实际checkout为 `4817c844a0e4e0d63d117fa9d6e5eea0e49017aa`。Owned job
`101880674239` 在bootstrap custody失败：30项中27通过／3失败／0跳过，20.62s，
exit 1且清理验证。首项超过5000ms，后两项为锁和独立子进程失败。原job日志SHA256
`953304e16fbf84c0774aff3bc3fdd7ff3574bd63139f6c542a1581ac01888672`。
这是新候选失败，不是历史source-lock超时。该run已失败结束：smoke／quality通过，
Build/test及owned两个job失败，Merge bar失败。Frontend3374/3374，scripts为
source-lock4/4后1985通过／27跳过，bridge134通过／4跳过。Backend4299通过／1失败／
0跳过：knowledge参数引用审计用例收到相同两条记录但顺序相反，正在独立核验时间戳
相同时的排序保证，不能与bootstrap混为一因。Contract及log-eval未执行；owned依序至
retirement-existing均通过，bootstrap失败后后续恢复suite未执行。Local non-HDC与
target synthetic两个job跳过。Main job日志SHA256
`7c75d16db519fe3fcafd72acc98f60892e2f3c282b47463f656703c2e7c52bcd`，不声称当前CI通过。
报告 `d79b9b23b` 的独立strict owned docs已通过，含真实DB schema验证、exit 0及清理，
日志SHA256 `66089de582a346c6dc8a496c65ee2a704fcc3a9ed4d21ae601a4b5fe73b653a3`。

终端代码 `73f12a24e17f12b9b863b7ebe78790ddd46d722b`，tree
`c02d9512c54c643cb5e85efa0e4d460536c7fb7d`，实际通过现有 `upgrade.sh`
执行artifact-init、artifact-prepare及从 `/` 工作目录启动的独立进程artifact-inspect，
各exit 0。私有Git副本的合成tag选中同一源码；独立核验的本地Docker Desktop
daemon为 `07ef20c3-7210-41f4-b337-5f617ca84c0d`，未启动服务。
两次产物观察逐字节相同，SHA256为
`2b2dba36e8d64fc86161470f694e5da9c460a493666eca19daf33c4be72c64d4`；
init日志hash为 `d7728e0d2100d2b0260f55ed7ae8294b34434ea5dafb1a2ac99a8f26e3d79f44`。
原始日志 `/tmp/upg824-terminal-73f-{init,prepare,inspect}.log` 是本地执行索引，
不是下载附件。私有包保留，不进入公开证据。

- 加载镜像ID：`sha256:173a729b33c1a2509bc233732ee195bc2be41ffa777d5310abedad1a6970e9dd`。
- 平台镜像manifest：`sha256:a5b82ffedf7a6eb42a2b765fbe7a4cab780d92a7ece1ec7973c5af88a11442d8`。
- 包：`sha256:5017b60822678dc2d55ec58bf30e4527d8ae948302f5ddd8dd6d2e62015fd269`。
- Receipt：`sha256:d43a144fddb390242fca229b3efd62fe356d6ef1dac0ff3c449223bf5bea18ab`。

跨run inspect、重复init及重复prepare均exit 2，journal字节不变。首次临时负测
误写预期 `ATTEMPT-EXISTS`，实际源码正确返回 `EXISTING-SELECTION`，因此该断言失败；
按现有源码合同有界重跑该例通过，没有为此修改实现或要求。失败日志SHA256
`38d1ecf74925bf3898ea14ca9b1b512f45e28b59de3a1eed9d326ca90012d2d9`，
修正后重复prepare日志 `663f45b654a1ba5d4c1619b54ee2857154364138e50b652ae6efaf0cec1baef4`。

固定 `73f12a24e` 执行均exit 0：

| 检查 | 实际结果 | 日志SHA256 |
| --- | --- | --- |
| Artifact／终端focused | 59通过、0失败／跳过，14.30s | `24d1be45e1b00e651a4faf4ffaa6a6461ae4cae009907a4f8d2e4433a586fcdd` |
| Build | 通过、保留既有警告；Vite 7.90s | `733a75b89dfe17c90f3e2620805766afbf3144ab3cef5f52a557f338708d01ea` |
| Owned scripts | Source-lock4/4、37.39s；主批2001通过、11跳过、0失败（2012），135文件、89.02s | `1e8fa2e66f056bd2f917c3d55604dc779192d16bbf77fcbc70805a46b78e119f` |
| Owned backend | 4300通过、0失败／跳过，528文件、95.92s | `3dd95f0425816efca7f09a72dd1b11497b5f07c5bfedbb872debb403bc50f8ad` |
| Boundary | 原可信base，3509/3509，无new／stale／growth | `da522bf73a2a7fe5678fa952947c608bbb31908fa9288f45ce246a0f433ee4c5` |
| Contract | 通过 | `b360b9bd3abdfe68681a8d267d5287709d4444710f48e2e21afb069a384d9981` |
| Selfhost | 通过 | `fb3bebbd4a67124cfc37061ec47e862690f238d75a55a572211b4ba5a2701f56` |

两项owned批次在记录的本地pgvector profile验证了资源清理，不能替代PG16 Alpine或
目标验收。11项skip仍是下文列出的handoff／runtime-inspector／vendor-DTS用例。
此前 `01a25af5c` 五文件selector因缺必要PG环境，236通过、4跳过、1个suite前置失败，
exit 1；保留日志hash `899f92814d7835f5a82b6302428c1a6eef5c63c96b6e4e0d56b4a25d655f8c03`，
不能称为功能回归或完整通过。

Journal `a05e79510` 独立58/58、3.35s，日志hash
`13496a8bde5c12bcb4fe123c9d7d4381397256985dcbfb558589774d411f6792`，
独立双审通过。Custody源 `2339a92c0` 与终端 `73f12a24e` 也各有独立Standards／Spec
限定PASS；custody作者50项用例明确替代build owner，与上文真实终端执行分开。
认证／SQL后继 `62090c07e`（真实PG30+19）及trigger源 `205dabf26`（真实PG31）已集成，
精确Red／Green及hash仍见其现有合同。当前Hosted、完整P13／StartupTarget、API／worker
合法启动、完整controller及目标验收均不能从产物检查点推导；A／B／C仍未完成。

Artifact集成 `a557e688671d11f7752a61b5f28803af39298bcd`，tree
`5ccb025d0bb8fcfb433ffd47d11168717505ca4e`，focused20/20、348ms、零失败／跳过；
build exit 0，保留警告（8.16s）。日志SHA256依次为
`589ccb2a43871e525c349d26096f4790d5d1c5ab9c2443a8f2a20990ab711fda`
与 `48b5c431de5c85d2aee93b1fb100c364de1ad700bed45a06f886271547db3428`。
Contract／selfhost exit 0；boundary保留可信基线 `9b3ba7df7e21f5589684bc92c872da593ad4c246`，
3509/3509，零新增／过期／增长。第一次命令参数名错误，扫描前exit 1；改正后exit 0。
Builder `75e182236` 另行使用真实BuildKit／OCI字节构建源 `a321084a5`，独立双审通过；
精确身份、历史拒绝与日志hash见[artifact合同](scripts/parameter-catalog-upgrade/applicationArtifact.README.zh-CN.md)。
这些结果不是当前Hosted、startup或完整controller通过。

SQL集成 `64d478f37875e43aea468fa3ff2f7902a3ac7bae`，tree
`addec035553353cde8eab0fed19e79e34287d933`，完整owned scripts：source-lock
4/4、36.94s；随后1940通过／11跳过／0失败（1951）、85.79s。Owned backend
4300/4300、零失败／跳过、97.31s；两者均exit 0，资源清理验证通过。日志SHA256依次为
`de356585385f98f9f457a15c0c11951a2f69833dd7457419e854f61c9a377819`
与 `88233681b848909f657ce2f179517154aeebfce0c9485f6af9bfd5c7fdd3c3d4`。
11个跳过仍是下文列明的handoff／运行检查器／vendor DTS用例，不是Hosted或完整controller验收。

SQL源 `2a9b22e2b28e9254f7635e56e7feb897b40bdb99`，tree
`11018998b52e927564b64e8fbc506ee815e98759`，独立真实PG执行19/19、104.13s、
零失败／跳过、exit 0且清理验证通过，日志SHA256为
`fb454b14d7ea1f34ec0729978d411dde41a3bc00ef6de19231a32d508887a58b`。
独立Standards／Spec及父路由的单独审查通过。
[Retirement合同](../../server/modules/catalog-cutover/retirement/README.zh-CN.md)保留三项
真实修复前反例、更早trigger夹具失败，以及关闭并发窗口的精确集群级锁范围。
此结果证明SQL权限步骤；独立认证检查还需识别合法SQL后继，同时保留原metadata基线。
该单独根集成正在Scratch中推进。

运行来源集成 `c3f5a49092b761ad2b6806ad515849ff4ece1878`，tree
`2841d3d3ebfa756f508c585cc97cb8b390f32d67`，路由／来源selector 32/32、零失败／跳过，
exit 0；日志SHA256为
`fa0e48d06bb1a00856ba53ae46b5aa8facb928c5df8efee3fd40c141bc183447`。
真实PG源执行仍属于测试提交 `a550e8a7f`，不重标为此cherry-pick：13/13、14.01s、
零失败／跳过、清理验证通过。错误密码、签发后断连和初始化终止使用实际LOGIN会话。
[来源合同](scripts/parameter-catalog-upgrade/runtimeRoleSource.README.zh-CN.md)保留最初
2通过／5失败、schema数组Red／Green、精确hash和独立Standards／Spec范围。
父强制路由也已另获独立Standards／Spec PASS；这些结果不证明真实API／worker启动。

SQL效果集成 `e41dd4e8225dd6aa216bbd32904edad91b16a082`，tree
`bec6af8d4953222379bfb96c4f961562a3ef2f38`，四文件root／路由selector
147/147、零失败／跳过、5.38s、exit 0；build exit 0，保留原警告。
日志SHA256依次为 `c1841efa56872a69895a0316bf862b363350064eda3a13d82bb9cb733afc4eab`
与 `73d0f588942879bd16bb008cefa849709aabc2696ef5064450ad715ded7ef8ae`。
路由Red为23通过／1项unknown-suite失败，无跳过。独立Spec审查发现低层管理连接
缺少search-path前置检查，修复和真实PG效果验证尚待完成。此候选未封存、不受已交付
Hosted覆盖；root selector仍模拟SQL效果。

执行 `b8fbae437107194c19393651180b397ef7b2ae42`，tree
`c3068db7f9a2e56eede19e22cf74ee5b14c5129a`，已集成经过审查的bootstrap持久
步骤、七表V13能力修复和controlled adapter强制路由。七文件selector274/274，
零失败／跳过，13.59s，exit 0；`upg824-b8fbae-focused-single.log` SHA256
`e7bc1d355a3450ea0a31c8508404653b5c7be171a714766e0414560f4d6995e2`。
此次单一执行替代被两个并发selector复用的日志路径，不累加它们的计数。
Build exit 0，保留原警告，日志SHA256
`054ef17679960b73505a99231f63a5accfadc7be56d4267aa082f5b5119a7836`。
Boundary使用原可信基线`9b3ba7df7e21f5589684bc92c872da593ad4c246`，
3509/3509 allowance，零新增／stale／growth。首次命令漏传必需base参数，扫描前
exit 1；修正命令后通过。Contract／selfhost exit 0。仅报告变更的后继
`e225a450e68c0cb867e0174d93940fcb6dca2902`（tree
`51af229ae4f4036efcc30eb34ce217fb18dec990`）随后实际执行完整owned scripts：
source-lock4/4，主体1925通过／11跳过／0失败（1936），exit 0；owned backend
4300/4300，零失败／跳过，89.03s；严格docs/schema实际pgvector检查exit 0，
没有数据库跳过，均完成资源清理。11个script跳过分别为handoff1、运行身份检查器5、
vendor DTS生成器5，不算通过。Scripts／backend／docs原日志SHA256依次为
`357f5b00f1ca096c704749b815146d7d2bdaa6f653f0114a8967639b4013e448`、
`27e785fadcd6ca3cbe28f20a0dd81f9ffd8609cf1b08b99ef597deae8062a1a1`、
`bf5f32b3199b827362c05d6bbe0b377ee5d98a2df54f1782334fc91551d0fdd2`。
这些是报告SHA上的新执行，不是重标旧运行；该候选Hosted尚未运行。

Owned `controlled-recovery`执行原有四个bootstrap及停源包／目标拒绝场景：
4/4，零失败／跳过，262.44s，exit 0，内外层清理验证通过，私有证据保留。
`upg824-controlled-owned.log` SHA256
`e96878cad31b599bbc623f69dce00b1cdce6c6dfb696b1d5befb4fcf3f76dc85`。
使用下方本地PG16 Alpine镜像。此矩阵自身不证明真实BullMQ业务消费、完整controller
升级或真实备份副本。精确强制路由及缺receipt拒绝替代opt-in；Lagrange独立
Standards及Raman独立Spec均已通过该路由增量。

Bootstrap源`6ff7d984`独立Standards／Spec PASS；其232/232是同字节封前WIP，
不是固定SHA的PG执行。V13源`d28546fad`双审通过，实际PG24/24在gate模块另记。
两者均不证明完整P13或可用StartupTarget。

本地续工 `2d907209fb1f78aba6798270cc654fba187e36bf`，tree
`3f3eb2074d0a4db1ddeb49dd12cb49a242127721`，集成分别双审的部分恢复观测与宿主
publication存储。六文件根／journal selector为223/223，失败／跳过0，14.61s，退出0；
build通过，保留原警告。原日志hash分别为
`97d680621540902827985f77ba64af37c3f923b274aeba967fad0c5f0e3e7f0d`、
`dee0193b680cfed77da96d2eacb5c65056e3977f777370a1aec3f31e14c60d30`。
Lagrange Spec／Fermat Standards另行审核集成，不把作者自审计入独立审查。
publication仍仅是存储，不是P13或可用StartupTarget；此本地增量不受下述CI覆盖。

真实部分恢复源执行为 `9959dc42e327bf375d6fc24e7e594fecc324835d`：16/16，失败／
跳过0，259.10s，退出0，清理核验且保留私有证据。PG恢复提交后实际对象PUT403，
同attempt保留started／postgres-committed／unknown，Redis从未启动，业务副作用0；
清理后重新验证capture／approval／包。日志hash
`9f8b6e4503191cec349008c4c8ac3bf27af42c7c7b3558217e58c9eb05a3c1fd`。
Red `1f249b598` 为15通过／1失败（缺真实partial观测），不是包setup失败；
以上不证明完整业务恢复。

已推送报告 `cf494324cec093343b418001f620a248d861fce6` 的CI `34153386496` 已成功，
实际checkout `f4a900722c36a6aabe9a948a7bfeb92b6f4fa8ba`。Frontend3374通过；
scripts source-lock4/4，主体1856通过／31跳过（1887）；backend4300通过；
bridge134通过／4跳过。boundary、contract、log-eval实际执行。十一条owned路由
均失败／跳过0且清理核验：reader49、runtime identity11、projections10、report36、
authority81、bindings98、Redis12、activation22、endpoints16、bootstrap28、recovery15。
Build/test、owned PostgreSQL、smoke、quality、Merge bar成功；local non-HDC与
target synthetic两个Job跳过。main／owned原日志hash分别为
`2a0a69d4ce0e522852cedbcba06919e5553b91f893e4d9dc9076f9df25f3145e`、
`37a0b8efefc7434537e9351d3959ce4256ecb663592821c40ddec7920281db42`。

代码 `2b5d5ed4446a1aca56dd3d929fd15691172ba29d`，tree
`d97681435e034b7ee604efbe21295d7b434baa82`，在原base `cda6737a8` 上集成四项
经过独立审查的增量：正式恢复／真实队列组合、私有bootstrap transport及根接线、
组织Archive身份修复、初始化信号所有权。无migration／grant／trusted baseline／
timeout变更。PR #824保持Draft／open／未合并，已完成Hosted见上；源部署仍为
`82344044b436a8dafecefbb85dfd724cecb05e3f`。

| 精确执行 | 结果 | 原日志SHA256 |
| --- | --- | --- |
| `6e519a3b4`，完整bootstrap路由 | 240/240，失败／跳过0，1.09s，退出0 | `7b9e33887191dcc514775263a42ae5219005530fba0c03c646cd81da91bfda05` |
| 同代码，owned backend | 4300/4300，失败／跳过0，94.65s，退出0，清理核验 | `2dacc625d79b7c7d5822acf7af8ba410bcafac4f14d3972628d90330c4c8165c` |
| 同代码，build | 退出0，保留原bundle警告 | `7249d28fbc96147ea3fadaa0c30793bfb4dc456769eb3b948e6e166e6d9b03fb` |
| 同代码，严格owned文档／schema检查 | 退出0，实际pgvector schema对比，数据库未跳过，清理核验 | `f32ede11b5587ca1a00bcfd282ac48db936a90b5dc9ed53742127337c1527bfd` |
| `2b5d5ed44`，强制owned恢复路由 | 15/15，失败／跳过／过滤0，220.43s，退出0，清理核验，私有证据保留 | `e34bf2bca5dbd410897860a4f8fe8870f5d4a3fb75f6d439327c71d11bf7f876` |
| 集成前驱 `d0fba71ca`，完整owned scripts | source-lock4/4，主体收集1867／通过1852／跳过15／失败0，退出0；S11-RP实际13/13 | `67a2a3693f2076f54371ce1a030950aff6493e1899f5a0cf1f92ba19a3da596c` |

相比 `6e519a3b4`，代码仅新增六行恢复测试证据输出，已获Lagrange Standards与
Fermat Spec独立通过。服务端／build执行保留原SHA；期间仅两份操作Markdown更新。
之后恢复执行期间八份Markdown未提交。实际服务均为linux/arm64，SHA256 image ID为：
PG `16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`，
Redis `ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`，
MinIO `1dce27c494a16bae114774f1cec295493f3613142713130c2d22dd5696be6ad3`，
mc `993e8c454a7ec632923f7e3e61adf1d473261da6354cefd641aedd33a2cfe112`。
这些不是registry manifest digest；包manifest摘要为
`f5eaf9e8917b7b3d856d0df9344c1e49acecee25feec61a494442dcbce654797`。
前驱 `4091d2e28` 的bootstrap为
239通过／1失败，backend为4299通过／1失败：新包装替换了原缺DATABASE_URL的静态
诊断。修复仅恢复精确安全文字，没有修改原断言或输出任意底层错误。两份原失败日志
SHA256为 `63f921011a57e83a2f18c294f6925628f7c3b80399773ffbe6019abbe348e019`、
`7e19e61d45d5a3b9c25a153b2406cfa6dc775f0ebe35255c9733a031fd70498d`。

组件及集成审查按非作者范围分别执行，不以自审替代独立审查。最新诊断修复
`fc241712e` 有Lagrange Standards／Raman Spec通过；根 `44d63de87` 的真实socket与
已观测源端点绑定已独立审查。根测试使用真实文件系统和合成PG／领域依赖，不是
完整获批部署。真实custody28/28、Archive98/98、Redis生命周期12/12在模块证据中
保留原执行SHA，不改记为此候选执行。

A／B／C仍未完成。API与worker仍缺完整独立StartupTarget接线，合法获批状态下的
production启动和非空旧controller全链尚未证明。持久publication／P13／Archive pins
及报告集成仍属内部责任；真实备份、企业网络／CA、S6／Policy决定和生产批准分别
保留，不混为一项阻塞。不提供生产升级命令或切流授权。

## 恢复组合续工，2026-09-08

Scratch代码 `06dcc6ca52ba030e46b232f573d229b2dd530476`，tree
`2296304b0f369d8909b2285bbfab650a93eddb02`，15项真实恢复测试全部通过，
失败／跳过0，218.64s，退出0。原日志 `upg824-real-queue-06dc-actual-full.log`
SHA256：`92aff22e60683f175d701ab752fd773b58c0192bfbc0952778040ccd747adc1b`。
正式capture、四principal批准及独立进程仅凭包恢复已组合成功；真实BullMQ暂停任务、
payload、提交副作用后失败重试和数据库唯一约束均核验。卷／容器create结果未知时的
精确回收，以及缺payload／错误run／目标旧AOF的指定拒绝通过。私有证据保留与Docker
清理分别记录；这仍是代表性合成队列，不是全消费者或完整旧应用转换。

修复删除证据、未登记create未知结果和子进程失败含混后，两文件增量获得独立
Standards与Spec通过。authority helper在 `bc85eb3df` 有单独双审。这些审查不覆盖
后续owned路由 `2bfd4b2b4`。该路由初审发现嵌套清理的不完整成功声明，
`be1f38964` 修正后获独立Standards／Spec通过；子进程被强制终止时仍记录嵌套清理
unknown，自动回收全部此类资源尚未实现。原 `2bfd4b2b4` 精确代码已由现有owned
runner执行：收集／通过15，失败／跳过0，228.35s，退出0，Docker清理核验且私有
证据保留。原 `upg824-recovery-owned-current.log` SHA256：
`b42d1a794676b5f9621971dc120038170a55adb40e70a4c561cf47b168cfd868`。
命令为 `node --import tsx scripts/run-upgrade-component-tests.ts
--expected-daemon-id <已独立核验的开发daemon> --suite recovery-three-store`。
实际PG16 Alpine镜像为
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`，
linux/arm64。执行期间代码不变，六份报告／操作Markdown有更新；build也退出0，
保留原警告，日志SHA256：`4973963707d3b06d0527c5bb8de3246df525d1ab58aa090af5124d98efc73fc7`。
之前一次focused误用缺少pgvector环境的命令，
S11-RP套件在setup失败（16通过、7未执行）；不是通过，也不是外部阻塞，须由owned
scripts lane提供依赖补验。

已交付报告 `70c1a3ad0` 的CI `34146381260` 成功，实际checkout
`80f831e2a9641a93284a867cdf226499f569c656`。scripts1826通过／41跳过，
backend4289通过／0跳过，bridge134通过／4跳过。十个owned lane、boundary、contract、
log-eval、smoke、quality及Merge bar通过；local non-HDC和target synthetic两个Job
跳过，不覆盖新Scratch。已验证70c1全文包保持原样，不包含这些新增文件和日志。
A／B／C仍未完成，不提供生产升级命令。

## 已交付ec0检查点——保留原执行身份

代码 `ec0ee9f3e86c6c3e037bf5485e8d32f322375ca5`，tree
`ba7e906bf6a3d8d40d679bf87eacb3f9b0e8717c`，在原base `cda6737a8` 上串行集成
已审bootstrap根适配器及强制runtime identity owned路由。Lagrange的Standards与
Fermat的Spec集成审查在这些增量范围内通过，不是完整P13或startup验收。
根适配器在认证副作用和提交前重验真实宿主锁、库存guard和正式获批报告。
清理逐项尝试所有自有资源，保留更早的准入错误或未知结果；未改migration、grant、
timeout、trusted base或发布批准。

| 精确执行 | 结果 | 原始日志SHA256 |
| --- | --- | --- |
| 干净 `ec0ee9f3e`，根入口/路由focused | 收集/通过92，失败/跳过0，2.50s，退出0 | `1572fa0f212cc148db4356642357bcff0af3839b1a5134d2f09ea88e5fad714f` |
| 同代码，owned bootstrap PG16 | 收集/通过27，失败/跳过0，5.62s，退出0，清理确认 | `592dee9d0a8ec74756e355a77139dae58559ea0d4370acfe52264faf1483fdb4` |
| 同代码，完整owned scripts | source-lock 4/4、43.54s；主体收集1867、通过1842、跳过25，82.20s，退出0，清理确认 | `57ec64012c9340362ee5629836e164dca96417c9f7d99b8ea7616106b4b5eae4` |
| 同代码，build | 退出0，保留原bundle警告 | `6b8e52caa5dc68015a21fd2516700c280f20e84b3468c949db15694d232c0b4d` |
| 同代码，owned backend | 收集/通过4289，失败/跳过0，87.76s，退出0，清理确认；执行中仅报告Markdown变化 | `19bf2d13a3d8fee31847036fe640de656a5069246ddb4044d14d66da516b0269` |
| 前驱 `1595baccf294f0069e0fa512657b9060e4a72284`，owned runtime identity PG16 | 11/11，6.20s，退出0，清理确认；含真正进程拒绝，不是合法pin启动 | `7dd223abeb3459294c2369f4a46bbc45368d5e601ffd7154163d767c46cfb6de` |

27项覆盖实际guard backend丢失、宿主锁持有进程退出、两个COMMIT边界及独立进程
低层检查。其prepared run不证明具备真实P12/报告/capture前驱的完整根调用。
原 `dba3e7f8d` Red为25通过/2失败：锁丢失仍执行认证修改，以及独立ACL夹具对
镜像默认权限的错误假设。修正夹具只观察既有ACL，没有授予新权限。根报告过期
Red/Green和精确历史见bootstrap适配器双语说明。运行身份测试改由现有owned receipt
和强制Hosted job接管；普通路由排除不等于跳过验收。

最新结束Hosted为 `34142368636`，报告head
`8f3cf848993c7a55891732840d15f76eee3f4add`，实际merge checkout
`5f87013d39d9026fc1aa972e8cdcec4083960c85`，成功。主Job实际执行frontend3374/3374、
source-lock4/4、scripts1810通过/41跳过、bridge134通过/4跳过、backend4289通过/11
跳过，以及boundary、contract、log-eval。Owned各lane分别通过：reader49、projection10、
report36、authority81、Binding92、Redis11、activation22、endpoint16、bootstrap22，
各自失败/跳过0。Smoke、quality和Merge bar成功；local non-HDC与target synthetic两个
Job跳过。该CI不含1595和新根增量，当前候选CI仍待执行，不继承旧成功。

当前boundary、contract和selfhost也均退出0。Boundary保留3509项allowance，新增/
过期/增长均0，trusted SHA未改。首轮误用 `--trusted-base` 参数，在扫描前退出1；
实际扫描使用必需的 `--trusted-base-sha`。保留这次调用错误，不记为boundary发现，
也不覆盖原日志。
Owned严格 `docs:check` 含真实pgvector schema比较，退出0、清理确认，没有数据库
跳过。执行代码为 `ec0ee9f3e`，当时仅本轮报告/计划Markdown有未提交修改。

真实API/worker仍缺完整StartupTarget producer/callback。终端还需真实handoff、capture、
activation和retirement组合；认证退出本身不等于P13。完整comparison、报告链、业务/
浏览器验收及controller恢复仍未证明。这些内部工作与外部决策/材料分别保留。
A/B/C未完成，目前不能交付生产升级命令。

## 较早执行检查点，2026-09-08（历史）

代码 `8ed7ac196b34caf351e7331f6e2be15ea7f8a5d3`，tree
`b1f545978bf06ee8b1e86b158cb8e10d1d5eae61`，base仍为 `cda6737a8`。
CGH已使用真实路由，替换恒定readiness和假空查询。新增持久Review读取使用只读事务，
保留原惰性分组命令；生产查询组合根已使用该读取器。未改migration、grant、timeout、
比较格式或boundary可信基线。各增量及最终bootstrap夹具修复均获独立Standards/Spec
审查；这不是整体集成验收通过。

干净代码的强制 `read-projections-pg16` lane收集10、通过10、失败/跳过0，11.62s，
退出0、清理已验证。五项覆盖真实Catalog路由，包括实际仅持0140能力的LOGIN访问
GET `/catalog` 返回200。另五项覆盖持久Review读取；该正例使用既有同步/治理能力
和只读事务，不是最终应用登录身份。独立0140-only登录仍不能读Review或创建分组。
这些结果均不代表 `server/index.ts` 或worker启动。

前两轮WIP失败保留：首次4通过/1失败/5跳过，原因是compiler结果取值错误和ACL负测
表名不存在；第二次5通过/0断言失败/5跳过，但setup因将后继bundle用于bootstrap而
失败。最终复用既有无前序release和正式注册表；未放宽installer或权限断言。
下方历史两个fresh比较正例依赖假空canonical projection，保留原执行计数，但不能
作为有效fresh升级证据。当前未知canonical库存明确拒绝。

干净代码backend收集4300、通过4289、跳过11，99.37s，退出0、清理已验证。
Build、contract、selfhost及boundary通过，可信基线仍为
`9b3ba7df7e21f5589684bc92c872da593ad4c246`。首次boundary调用漏传必需参数，
扫描前退出1；这不是boundary发现。完整scripts前置source-lock 4/4（41.25s），
主体收集1851、通过1826、跳过25（82.79s），退出0、清理已验证。执行开始于干净
`8ed7ac196`，期间仅修改本报告Markdown。当前候选Hosted仍待运行。
Owned严格 `docs:check` 包含实际pgvector schema产物检查，退出0、清理已验证，
没有missing-database跳过。Fermat的最终集成Spec审查在排除本人CGH实现后通过；
CGH仍由Raman/Lagrange独立双审覆盖。这是限定代码集成审查，不是完整controller验收。
Lagrange最终Standards集成审查也通过，排除本人TCP增量，由Raman/Fermat独立审查
覆盖。持久Review factory已经集成；仍缺的是CGH合成库存认证、必要能力和完整消费方
语义，不能再写成该factory尚未实现。

| 当前日志 | 原始SHA256 |
| --- | --- |
| `read-projections-lineage-fixed` | `36731b5a567b4d53018a606d2eebac166f72d39b4c35d112e62f3fedd1d86488` |
| `backend-8ed7` | `a3b084bd4354acd136a7cc0080af23c26b3b5ca05c667bf02a4b23a14e61e0d2` |
| `scripts-8ed7` | `3ccf2abc283345a6b27a051b0c776948f9e8b339995936d530fa7602fcb94453` |
| `build-8ed7` | `e1d55e4d70407e4b5b5f0e7515c12945cce513f94cd3d5b52f8de36222d30266` |

全文包manifest分别记录脱敏交付字节和上述原始本机日志hash；不含生产执行证据。

最新结束Hosted为 `34138417314`，报告head `c04d42703188432a2c98026ebfa6c683ae1526c8`，
实际merge `df274d9412a83ec5bb0be53e1b629c112feb25c3`。主Job成功：scripts前置4/4，
主体1806通过/41跳过；backend4260通过/11跳过，boundary、bridge、contract、log-eval
实际执行成功。Owned bootstrap在原2000ms COMMIT观察期限内失败2/22；此前owned阶段
及smoke/quality成功，local non-HDC与target synthetic跳过，Merge bar失败。
该run不含本次增量。实际Linux TCP代理实验定位Nagle延迟；两端原生socket现在使用
`setNoDelay(true)`，保留字节、故障次序和时限。集成本机PG bootstrap在 `ec53a3592`
加组合根WIP上通过22/22，不能重标为后续干净代码执行；新Linux Hosted仍需运行。

API/worker startup producer及完整controller的P12/P13/报告/业务/恢复集成仍是内部
工作。A/B/C均未完成，没有生产升级命令或生产执行许可。S6、Policy、比较格式、真实
备份及企业网络依赖分别见现有手册和决策记录。

## 上次执行检查点，2026-09-07（历史）

代码 `e5c76c9ce4f828df8866f2b26888661a75aa9919`，tree
`dd12fd3b8a15f168a05487f7dbf16a3e245b72cd`，base `cda6737a8`。已集成双审的
Linux 解析器修复、可显式重试的清理及脱敏 I/O 诊断、独立进程 custody 验证，
以及十一个 provider 的比较安全修复。历史 migration、timeout、grant 和 boundary
可信基线不变。各增量独立审查通过；Lagrange 的最终 Standards 集成审查无新增
P1/P2。这不是整体 Spec 批准，也不代表 A/B 完成。

| 精确执行 | 结果 | 原始日志 SHA256 |
| --- | --- | --- |
| `e5c76c9ce`，独立 PG16 Alpine Binding lane | 9 文件、92/92，72.10s，退出0，清理已验证 | `2213a1012638f8d79cee86001109561ed3a45bb8919ba99916c688ab3131b7ca` |
| 同代码，独立 pgvector backend | 收集4271，通过4260、失败0、跳过11；96.38s，退出0，清理已验证 | `005231cda5ff896efcf4eded3d45b8b809c8bcadccd1f4e1a1a219797bffac46` |
| 同代码，真实比较聚焦回归 | 4/4，3.70s，退出0，清理已验证 | `312c8c8ae8d24103d4fbc6b7b02c412e45a5d23a7744f228d11153e109eb0b7a` |
| 同代码，完整 owned scripts | Source-lock 4/4、40.47s；主体收集1847，通过1822、失败0、跳过25、84.07s；退出0，清理已验证 | `768ec7169c50f4b2f835f24ff5e70ff8ea9040b8ed1016b6b8dd7161d6aa5a10` |
| 同代码，真实 Redis/BullMQ | 11/11，2.75s，退出0，清理已验证；真实任务／排空／去重、认证／就绪失败及断连恢复 | `6c31c27afa13dceda627d54d9730474d396bd4545e421810c447bcb98f146333` |
| 同代码，build | 退出0，保留既有警告 | `6172839c231d77fb36a5eab4ca0bcd6cf29adbd784f2b8d6f5230322917dbdef` |
| 同代码，boundary／contract／selfhost | 均退出0；3509 allowance，无新增／陈旧／增长，可信基线仍为 `9b3ba7df7e21f5589684bc92c872da593ad4c246` | 见交付日志 manifest |

比较聚焦回归证明两个 fresh 比较正例，以及完整存量库存检查后对 CGH 503 的阻塞，
不是 populated corpus 通过。D06 新增两条真实关联的 open／dismissed Review，九类
比较 ID 要求全部保留。此前 `0d71d9949` backend 因实际 CGH 503 失败1项；
`fd4ea4094` 因缺 D06 库存和共享集群管理观察失败2项，均保留为历史失败。
管理结构测试现在只由强制独占 Binding lane 执行，避免与无关角色修改并发；
原断言没有放宽。

较早已集成执行保留身份：`b54241a4f` bootstrap 22/22，包含实际 COMMIT 确认丢失、
子进程中断，以及父进程关闭 handle 后第二进程重新打开 custody。
`0c198621d` 实际 Docker/PG endpoint 本机16/16，不是 Linux Hosted 结果。
`88521629e` 完整 scripts 前置4/4、主体1818通过／25跳过；`2307f1d06` 清理／诊断
纯回归5/5。诊断区分慢 connect/drop/end，不输出私有 SQL；尚未证明 Hosted 超时
已修复，也没有提高冻结时限。

最新结束 Hosted 仍为远端 `fa3dbef3f` 的 `34130699134`，merge
`1a6c126e93d1b565b77d3b8baada937374da799f`，失败详情保留于下段；本检查点没有
当前候选的 Hosted 结果。生产模式 API／worker 的完整 startup producer/callback
仍未接通；完整 P12/P13／报告／controller、业务／浏览器／增长规模及完整业务恢复
仍未完成。A／B／C 均未完成。S6、Policy #815、逐身份比较格式决定分别保留；
真实备份、企业网络及生产批准是独立外部输入，不替代内部实现责任。

## Bootstrap 检查点（历史）

代码 `439f79c96794d165a73bf41fdd1697bc552ffffe`，tree
`8b1e7d0510f7d22175d4d586c9565809d9380d2e`，已集成双审的 bootstrap
凭据隔离及强制 owned PG16 CI 路由。两个 Spec P2 修复分别在实际事务提交秘密 SQL
之前关闭活动跟踪，以及在首次等待前固定检查输入。加强的活动可见性基线在
Scratch `75a88cf06` 通过18/18；三份代码／测试文件原样集成于 `a78cdb24d`。
父候选 `439f79c96` 实际 owned PG16 18/18、路由47/47及build、boundary、contract、
selfhost均退出0，PG清理已验证。这是凭据隔离证据，不是完整P13或获批启动。
COMMIT确认丢失／子进程中断新增反例仍单独保留，实际执行待核对，尚未集成。
新的数据库连接不等于新的进程重新打开custody。

最新已结束 Hosted 为 [34130699134](https://github.com/tzrea1-Q/WiseEff/actions/runs/34130699134)，
head `fa3dbef3f9e44327d6e3797111e260036e05c647`，实际merge checkout
`1a6c126e93d1b565b77d3b8baada937374da799f`。结果失败：scripts前置4/4，
随后1774通过／41跳过（1815），两个suite因upgrade/recovery临时数据库清理的
**afterAll** 10000ms超时失败。这不是测试断言失败，也不是历史source-lock超时。
Owned endpoint为11通过／5失败（16）：正向基线暴露Linux解析器选项
`edns0`、`trust-ad`、`ndots:0`所在拒绝阶段，尚无已验证的接受条件修复。
后续owned阶段及主流程boundary／bridge／backend／contract／log-eval未运行。
Smoke与quality通过；local non-HDC与target synthetic跳过；Merge bar失败。
该run没有执行 `439f79c96`。

实际API／worker当前状态producer及完整populated controller仍是内部实现缺口。
A／B／C均未完成，尚不能交付生产升级命令。

## 上次续工检查点，2026-09-07（历史）

最新已结束 Hosted 为 [34125753813](https://github.com/tzrea1-Q/WiseEff/actions/runs/34125753813)，
head `3c0fe1d66`，merge checkout `e0f9ea2e56582b1dfe5398c5d5f4d9b77b30ea73`。
Scripts 前置4/4；主体1734通过／2失败／41跳过（1777），两个失败是摘要传递依赖未登记，
本机同期主体1750通过／2失败／25跳过。Linux owned endpoint 为15通过／1失败；后续
owned阶段及主流程backend、boundary、bridge、contract、log-eval未运行。Smoke/quality
成功，local non-HDC与target-synthetic跳过，Merge bar失败。下方旧成功记录保留原身份。

`770764871` 登记九个实际摘要依赖并继续递归扫描。新增逐模块反例还发现 execution 根
会把恢复命令豁免传给普通helper，已收紧为仅明确execution模块允许。初次selector并非
成功：九个新增断言失败，另一个restore套件缺少必需PG导致setup失败／七项跳过，没有
连接默认数据库。修复后的纯boundary为45/45，独立Standards/Spec通过。
`1376fbcbe` 集成获双审的P12 controller adapter；正向领域操作与报告测试仍是替身，
不作为真实已批准P12证据。

| 干净执行身份 | 结果与范围 | 日志SHA256 |
| --- | --- | --- |
| `1376fbcbe34f140ebe44d6deda121bd7744ff836`，tree `df7069faa182c4194e557ab72ee11fe566de4ba6` | owned scripts前置4/4、主体1781通过／0失败／25跳过（1806），46.23s+87.49s，exit0、清理通过 | `10dacb17c6eb346c9f6a1ed3bb23264ea2697dab7eb508e2e29a352e13b94de7` |
| 同一`1376fbcbe` | owned backend 4241通过／0失败／11跳过（4252），110.84s，exit0、清理通过 | `0227f19dffaac897130c41c95bbcd94bb8ce2d12e0e116159dc5bdd86ef4a3dc` |
| 同一`1376fbcbe` | 必需owned Binding 92/92，75.76s，exit0、清理通过；从通用backend迁出的精确文件在此收集 | `4e5194a9d00991fa09bfdd2891e759edcd7827fda1c03e5bcf3e14062f57ed11` |
| 同一`1376fbcbe` | build exit0，保留已有警告 | `723dcb007c326c2ab49ff8754ad4e4ccc30c87415b569eb2f5e1e59c2770be4f` |
| 同一`1376fbcbe` | boundary exit0，可信基线不变 | `da522bf73a2a7fe5678fa952947c608bbb31908fa9288f45ce246a0f433ee4c5` |
| `04f6cbdba` | 实际Compose共享观察Red：8通过／1失败，漂移被错误接受 | `adb490beab0cc7afed05133c9c978900f446392020e606d2da02a3e0ea8f79c4` |
| `be95a710f51ca73f13c2a6f222682cec816a5296`，tree `33c7a2b6aa160eca6c615581d27241727a12a033` | 实际Compose身份Green：9/9，53.37s，exit0；立即快照修复漂移掩盖 | `d79afc127b790f264a703888d4a81274815232a69ae0a5c33944c0280e02bc18` |
| 同一`be95a710f` | build exit0 | `3a2d89bdd6f560a962875a23d5b836e7a31870ae976b9ace963b4d9e4d3ee5c5` |

Compose应用为明确的身份夹具，不是旧应用镜像。此前两次8通过／1失败均拒绝夹具的
非规范journal路径；仅创建0700目录未解决，实际修正为已有realpath父目录，不放宽锁／
路径校验。Handoff及快照增量已获独立双审。Linux endpoint增量仅加入安全阶段诊断，
父`193cccd73`纯测试37通过；Linux根因仍待Hosted实测，尚未宣称修好。

Bootstrap仍未集成：17项正向后独立Spec发现统计视图秘密暴露与inspection参数可变两P2。
真实Red `29def0df3`为18收集／16通过／2失败，修复组合`6f5593fa6`为18/18、exit0、
清理通过，仅证明低层认证操作，不是P13。之后新增的统计可见性baseline需另记执行和审查。
真实startup producer、合法pin下根进程启动及完整populated controller仍是未完成内部工作。

本节更新早期“审查额度耗尽”“P12／journal 尚未集成”的当前状态；下面的历史
执行身份保持不变。开发 base 为 `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`，
生产源仍为 `82344044b436a8dafecefbb85dfd724cecb05e3f`。

Hosted [34104402409](https://github.com/tzrea1-Q/WiseEff/actions/runs/34104402409)
已成功结束，报告 head `39d5b125d9dd64df44d95e9fb2328a51a0bd3d14`，实际 merge checkout
`155ffd1692cf4392e11b6d1f705b18cb40c7c149`。Scripts 收集1657／通过1616／失败0／跳过41；
backend 为4180／4169／0／11。Boundary、bridge、contract、log-eval、owned PostgreSQL、
Acceptance smoke/quality、Merge bar 均实际成功。Local non-HDC、target-synthetic 两个
job 跳过。这不是下列续工代码的 Hosted 证据。

Endpoint／监管修复已集成至 `097a4a598`，tree 为
`73095ef503baf41b12c3f7ed67f0b39d548011b9`。组件 `cdb0db88d` 的真实双 PG
endpoint 测试16/16；原 resolver 反例14通过／2失败，修复获独立 Standards/Spec
通过。父候选 `9722cc18e` 的纯 retirement 测试47/47。两者都不证明完整 P13 或运行启动。

镜像修复 `df0fa9c56` 让固定 DTS 工具及 libfdt 在既有最小环境可用，不依赖
`LD_LIBRARY_PATH`；独立 Standards/Spec 通过。正式 login-shell 工具链命令在旧镜像
exit 1，在修复镜像 exit 0。修复镜像 ID 为
`sha256:7148348e0a7db9e9574dcc7ec6dd49b184809f8d9417ec2ecb9d89e3c0c56dd0`
（linux/arm64、TLS 验证配置、依赖缓存）；不含后续 retirement 提交，不证明企业网络信任。
日志 SHA256：`5b8cfbe336c77c23b89a5a424ba9ebb0d3c1300806a614beede7d9e22b3cdd17`。

实际旧源镜像在独占内部 Compose 网络、无公开端口的环境中通过 API readiness、worker
liveness、注册、登录、认证读取及匿名／错误密码拒绝。只有模型使用既有 deterministic
实现；production 模式、认证、PG、MinIO、Redis AOF 均真实。这是旧源准备，不是候选
启动。日志 SHA256：`72a294da16e04abe5a8efcf64f4cff539e97a0c0a21b099b619ce953dcaa09db`。
随后两文件上传业务实验 HTTP 500、exit 1，尚未证明任务处理；已核验全部精确自有容器
停止、数据保留。失败日志 SHA256：
`ea7244096fc7f5484e80a9486dc084f6ef079110271bbea74d21fc20200a24e5`。

一个实现智能体两次误用通用 server 配置运行纯文件 bootstrap 测试；均 exit 1、0用例。
global setup 在归属核验前尝试默认数据库，可能执行模板及 migration ledger DDL。
现无执行日志能确定是否发生写入；已停用该路径，未对未核验目标调查或清理，不声称
目标未变或已经恢复。这是无效 setup 失败，不是 Red/Green。纯文件测试现使用既有
无 setup 的 retirement 配置；PG 测试必须独立 integration 文件及父级 owned cluster
receipt。Bootstrap 凭据退出仍为 Scratch。

队列修复 `07919b49834c6edb8060fa2612d55ab7892cc3dc`，tree
`4262f0741d17649646897a2abd901e444109ec69`，获独立 Standards/Spec 通过。正式
producer 先复现 BullMQ 拒绝 ID：10收集／9通过／1失败、exit 1、owned 清理核验成功。
修复提交前 WIP 的真实 Redis 11/11，包括日志同 key 并发／不同 key、通知 key 和真实
未标记持久任务碰撞。业务 processor 仍注入，只证明传输／调度，不证明完整日志业务或
通知送达。WIP focused 28/28、typecheck 通过。干净 `07919b498` build 通过（保留既有
bundle 警告）、contract／selfhost／boundary 通过；boundary 3509/3509、未允许及
stale 均0。首次 boundary 命令漏必填 trusted-base，检查前 exit 1；纠正后仍使用原
`9b3ba7df7e21f5589684bc92c872da593ad4c246`。

| 队列增量日志 | SHA256 |
| --- | --- |
| 真实 producer Red，`c6a57ae41` 加测试／Markdown WIP | `9e814a278a3c89f455d4df3b0601e7f6a84138b062c19dc553cd43806eba2116` |
| 真实 Redis Green，`194fefd97` 加后提交为 `07919b498` 的代码 WIP | `34df5cfb5654ca2beaea1ae833556b402deb1a68802d9308e6bf0e7d808da8a2` |
| WIP focused 28/28 | `8965a97fb36059090678e9f4b3b31bf56e1804e9305eecdf79203503949a8e45` |
| 干净 `07919b498` build | `77ed519befe1abea53820e6017aeb0cd73f23470f880385705e1f1dd35ff886e` |

`07919b498` 完整 owned backend 收集4261：4249通过／1失败／11跳过，115.39s、
exit 1、清理核验成功。Catalog roles 全集群负测看到了并行 Binding producer 夹具
创建的 `s7_binding_*` LOGIN。这是候选测试路由缺陷，不归为 main 继承失败。
`3fc7f7464` 仅将该文件移出共享 backend；`df41defd3` 永久检查其既有 mandatory
owned `bindings-pg16` 收集。独立 Standards/Spec 通过；路由 Red 1失败／Green 1通过，
权限断言、role grant、timeout 不变。完整 backend 失败保留，等待单独归属的新执行；
路由测试或旧 Hosted 成功不替代全量结果。

| 实际执行身份 | 命令／范围与结果 | 日志 SHA256 |
| --- | --- | --- |
| clean `4847025983527893e21e260da55cbf32aeff8a46`，tree `3b7671516daf03d332b02c07534a061be6517b8b` | owned `scripts-pgvector`：收集1716、通过1690、失败1、跳过25；99.45秒，退出1，清理已核验。唯一失败是 source-lock lineage 原60000ms超时 | `64b8245f38d2882beeb88ee12b917dad84f0dd4d2516c7090cb283a0162a10af` |
| `484702598`／base `cda6737a8`，独立clean工作树、相同依赖 | 相同 source-lock 单例 selector：各通过1／失败0／过滤3，43.322秒／38.159秒，退出0；不能改写全量失败或据此判为继承失败 | candidate `28ff39f4800da4f362ac0044b12e392e21ce44ec127cab6398d4757e5b0542b1`；base `3cee9c7de9a3a1898ebf921e1c1d04e8806af119c551d8b987b4cd993d6574a6` |
| `372d1366d` 加精确owned路由／Markdown WIP | owned `activation-existing-pg16`：收集／通过11，跳过0，14.84秒，退出0，清理已核验；既有存储／读回与真实S6反例，不是获批完整P12 apply | `cc3f57a4a91ab9019fc0d22d2cddfb5ed3c725a781559baafae891dc7513710a` |
| clean `801e0a8b31c3c7f00d861c294b0c511889a8da4f`，tree `bf0fe5ec209886b34d957faf6afc7d67f45ce0cf` | owned `log-redis`：收集／通过9，跳过0，2.75秒，退出0，清理已核验。此前断言Red通过8／失败1、退出1，只输出布尔失败 | Green `182278a3c613f5f1d2b08f572cfe3e65e2304382c9474a024a7baaa7ae27013e`；Red `62c9727c18b26a301ceb5f12f152bf284f25d0b3823d3422e8f8c451bc626e2d` |
| clean `7d8d9567255608948d2ad8b97c68ac3839b1d688`（与 `801e0a8b3` 仅操作／证据Markdown不同） | owned `server-pgvector`：收集4237、通过4226、失败0、跳过11；179.56秒，退出0，清理已核验。11例显式启用的runtime bootstrap仍跳过 | `4c5e70c0b4bdebc90d076189cc5b7954da91df365ab37471598bfc37f16fa832` |

随后 clean `734b10dae3f6901f46108a3b00ea775813a9ba8d`（tree
`09ce523108dcac46268204fa56355feafa235f8e`）完整 scripts 执行先运行未改动的四个
source-lock 用例：4通过，45.61秒；再运行普通 scripts：收集1718、通过1693、
失败0、跳过25，102.85秒。仅在该 SHA 内合计收集1722／通过1697／失败0／跳过25，
退出0，自有资源清理已核验。日志 `upg824-full-scripts-734.log` SHA256：
`989d50e86d4b1a0da6a055e5f91cf1d476465d738b2c19cca7872b78eca980b7`。
串行路由改变调度，不修改 source-lock 字节、trusted base 或60000ms上限；
先前超时仍保留为对应原 tree 的失败。

Clean `6be8e08ef9d3d6b1eb50ebafd16e1ef3c5d2396c`，tree
`0efb9c071ad571750798024a3a5d1558ca5fd6cb`，执行 owned `docs-check`，在新建的
自有 pgvector 集群实际运行 `npm run docs:check -- --require-database`。
文档治理和真实数据库生成 schema 比对通过，退出0，清理已核验；没有数据库跳过，
跟踪产物未变化。日志 `upg824-owned-docs-6be.log` SHA256：
`6587bcd237a80c084eef04ab08a6f0a51c860a7566e63238a675cbb518a1dd61`。
严格模式在缺少专用 URL 或 vector 扩展不可用时失败；普通开发模式仍明确报告原跳过行为。

以上环境为 Node22.22.3／Vitest4.1.5、独立核验的开发 Docker Desktop。
linux/arm64 image ID：Redis `sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`；
PG16 Alpine `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`；
pgvector `sha256:a36250871de0833b8757561c72f2477ef1ddd1101afa4e617fb552e0de514c6b`。
这些不是manifest digest，也不是用户历史生产镜像。

Durable源 `2381aaff1`、父API `b404b615b`、activation journal `e0ce5aa42`、Comparison
关联 `d21627c02`、P12 `5b945a645` 均取得各自限定组件范围的独立审查。另一个路由／秘密
断言P2已在 `801e0a8b3` 修复并独立复核。真实Redis/BullMQ使用受控processor，不是完整
日志分析业务管线。API／worker根入口仍未消费完整的真实启动producer。

真实SELECT-only verifier登录复现了P01拒绝必要管理成员关系，以及P02在全部角色切换
42501后仍通过。已请求限定S6决定，没有暗改S6／runtime授权或Policy方案。P13、完整
producer／报告链、根controller成功、全量消费者oracle、业务恢复／队列／浏览器／增长
验收仍属内部工作，A／B未完成。真实备份、企业网络信任、Policy #815、生产批准是独立
C依赖，未执行生产操作。续工候选Hosted和最终集成审查尚未记为通过。

已经用固定旧源 `82344044b` 的真实 Dockerfile 构建镜像，source tree 为
`6dd92c36c4eb41bcaaba5a7a756befb9239d9120`，复用既有 build-network 库并验证 TLS。
源归档 SHA256：`08f183a7efd41c947dc7c42b35c65e06434a4e44e3d6749c3aa06672b21dec9b`；
传输指纹：`0d8146b81c294106f716b9aca8f616030a470eceb917803c45b3d565621f1f75`。
所得本地 linux/arm64 image ID：
`sha256:a7c1fd128b60ea545d483b285ab88d349de26a491d1e6a826a413a075cd4737d`。
这是新构建的合成源环境 artifact，不是用户旧生产镜像，也不是已发布 registry manifest。
构建使用六个缓存步骤，不证明所有依赖重新下载或企业网络信任。构建退出0；日志
`upg824-old-source-image-build-attempt2.log` SHA256：
`9696f468d718952ade63b8a4e2b47ae2ee0a7f4ed9442e48d9e07b4007f7db8b`。
首次尝试在 Docker build 前因可选 registry shell 变量未定义停止；修正调用保留既有默认
registry。本次构建没有启动旧 API／worker，也没有执行 controller 升级。

## 已授权契约实现检查点，2026-09-07

### Worker 集成与审查环境停止点

生命周期代码 `4a0dfa1465c92e59223d98251baa12ac902f8f24`，tree
`1a598cdeee118a937dae9b22e4a542d32c32463b`；源部署和开发 base 不变。
`1b8b5ed24` 集成已独立双审的源 `81727d73c856024a5b5b57e67f471a7621774b69`：
worker 拥有数据库和 listener，等待进行中的 polling 工作，尝试全部停止回调后
关闭 pool。保留原准入错误，初始化／启动／停止使用静态脱敏错误。源 Red 为
35 通过／8 失败，固定源 Green 48/48。这是生命周期和真实 HTTP listener 测试，
不是已批准的 production startup。

`91a897cde` 集成源 `321374300779554825a5b205156d456d726ff87e`：async durable
factory 在 Worker 构造失败后清理 Queue，关闭任一项抛错也等待两项关闭，并只
关闭一次。`4a0dfa146` 在实际 API 根等待该 factory；worker 已等待。源 Red 为
53 通过／3 失败；父执行 `91a897cde` 加该一行 API WIP（随后提交为 4a0dfa146）
**56/56、475ms、退出 0**，build 退出 0（Vite 9.90s、既有警告）。最后 durable
增量经父检查，但独立 Standards／Spec **未完成**：两个审查智能体均遇到账号
使用额度限制。因此仍为 Scratch，未封存。

`1b8b5ed24` 加仅 Markdown WIP 的独立 Docker runtime bootstrap selector
**11/11、7.03s、退出 0**。其中四例用真实 PostgreSQL 登录启动实际 API／worker
production 入口：超级用户、Catalog 缺失均在 listener／消费者构造前拒绝，输出
不含凭据。其余覆盖受限会话、checkpoint 管理及 checkout 失败。这是真实根入口
负向证据，**不是**合法 runtime pin 下启动成功。最新完整 backend 仍是下文独立
记录的 d7cdd6473 执行。

日志 SHA256：父生命周期
`5f9a66067dd337ac84e015b4269112cb9e94b15e9801c1bbff0be5bd6a849381`；
build `47cd1820b576af495ca925f1d81b905c2ad2267aea9c7408a96cc90661657be7`；
真实 runtime 根 `9d997d65546a1e251bf25f3747346df84b12666c8628308db87fa846da84597b`。
Boundary 再次退出 0，匹配 3509，unallowlisted／stale／mismatch／growth 均为零；
contract、selfhost 在 4a0dfa146 加仅 Markdown WIP 退出 0。

既有 schema P12 工作分别保存，**未集成、未验证**：
`codex/pr824-activation-existing-storage` 的 `b7337f5d11624b287c7615cde36ee38c39b81399`，
以及 `codex/upg-activation-journal` 的 `2375dad8b458ed60649ce1e082ab3fd30bfd4f9c`，
均从 d7cdd6473 开始。额度中断时领域动作、实读 reconcile、根接线和独立审查尚未
完成。不假设新增表／grant；此前三表原型仍排除。这些内部实现仍由父协调者负责，
不归咎于缺少生产授权。

`1c279310b62ae1a13466aa99602e0b7575ec4a65`（tree
`49982aab037d1a166ef42291c95bd2d97ef5aae7`）把两份 worker 测试纳入既有 bootstrap
config，使生命周期命令无需临时 config 或 ambient 数据库即可复现。该 config-only
提交前同样代码／config WIP **56/56、549ms、退出 0**。完整独立 scripts 在
4a0dfa146 加仅 Markdown WIP 于 17:00:51 启动，在 config 编辑前结束：**收集
1657、1631 通过、1 失败、25 跳过**，120 文件通过／1 失败／1 跳过，124.89s，
退出 1、自有资源清理确认。唯一失败仍为未改动 source-lock 的 60000ms lineage
用例；未放宽断言、超时或 baseline，不得记作完整通过。scripts 日志 SHA256：
`eeaffb65b36bc4a6659bb307190aa706774624450a55d485da156f131adf92f3`；
仓库 config 生命周期日志：
`390c7811a472f4e5148f6b62a5af3a39f8d7c2ed465ba9b4e82b55fad797e725`。

完整独立 backend 在 1c279310b 加仅六份 Markdown 交付 WIP 于 17:04:05 启动：
**收集 4180、4169 通过、0 失败、11 跳过**，517 文件通过／1 跳过，245.30s，
退出 0、自有资源清理确认。使用与 d7cdd6473 同一已独立登记的 linux/arm64
pgvector image。Opt-in runtime bootstrap 11 例在本批仍跳过，不重标此前真实
11/11；不能从完整 backend 推断 production 启动或真实旧部署完整转换。
此检查点新的 Hosted run 尚未完成。

### Hosted 取消与已归因的 CI 修复

Run [34097926621](https://github.com/tzrea1-Q/WiseEff/actions/runs/34097926621)
报告 head 为 `2ce71d683f1cd3e51b657f45aafaabc34d3dd5f2`，实际 merge checkout
为 `41f592f9214549d142daa978df9a6c3d81089315`，base 为 `cda6737a8`。
Build and test 达到原有 20 分钟 job 上限后取消，Merge bar 失败。这是新执行，
不改写历史 S11-RP 失败。

| Hosted 范围 | 实际结果 |
| --- | --- |
| Build、文档治理、UI ratchet、lint | 步骤通过 |
| Frontend | 3374 通过，438 文件 |
| Scripts | 收集 1656：1615 通过、0 失败、41 跳过；121 文件通过／1 跳过 |
| Boundary／device bridge | 两步骤通过 |
| Backend | 取消，无最终总数；516 文件通过摘要，runtimeConnection 11 跳过，runtimeState beforeAll 失败且 7 跳过；sensitiveNode identity 无文件结束摘要 |
| Contract／log-eval | 取消后未执行 |
| 独立 PG16 reader／report／authority | 49/49、36/36、81/81，均清理确认；linux/amd64 PG16 Alpine image `sha256:75f5a96988cdf694a215073c3e9c001b706b371e2f94df3967f2efdec2787f6b` |
| Acceptance smoke／quality | 4/4、100/100；既有夹具验收，不是 production startup 或完整 populated 转换 |
| Target synthetic／local non-HDC | 两 job 按 workflow 条件跳过 |

41 个 scripts 跳过分别为：环境依赖 rehearsal 16、opt-in Docker recovery 4、
handoff Docker 1、runtime identity 5、vendor schema 5、recovery rehearsal 10。
不得记为通过。

本机自有隔离环境对未改动 sensitiveNode 23 例作 candidate/base 对照：
`2ce71d683` **23/23、22.05s**；`cda6737a8` **23/23、21.12s**。未复现 Hosted
停滞。两者均独立 pgvector PG16 集群、linux/arm64、单 worker、Node heap 768 MiB。
另做首例分段测量，主要成本为完整迁移准备，而非 resolver；不能据此声称与
linux/amd64 等价或将问题归咎于 0140。

Receipt 故障独立复现：仅有 ambient DATABASE_URL、缺必需自有目标 receipt 时，
runtimeState 收集 7 例、全部跳过，beforeAll 报
`upgrade-tests-require-explicit-owned-postgres-receipt` 并失败。
提交 `4b32a98f1c9464ed8eb0648ca4aa7b6b18171ad9` 将该精确文件从 ambient
backend 移入既有强制 `bindings-pg16` job。Receipt、真实 Docker 所有权、20 分钟
上限及 Merge bar 均保留。路由 Red 为 4 通过／1 失败；提交前 WIP 的真实自有
bindings lane **92/92**，含 runtimeState 7/7，78.74s，退出 0、清理确认。

提交 `d7cdd6473c3f37c24c99cb5a1c620c96394ce633` 仅把身份测试准备改为每例从
既有迁移指纹模板克隆新数据库。23 例断言及 seed SQL 逐字不变，保留单连接 FIFO
与失败清理。该干净提交（tree `80bcf61c8b08d5c178722bde207b854ec498d893`）
**23/23、3.88s**，退出 0、清理确认，原用例超时未变；路由 selector **19/19、
1.74s**，build 退出 0（Vite 8.95s、既有警告）。独立 Standards／Spec 无 P1/P2。
仍需新 Hosted 确认，不能仅凭准备优化声称取消问题已经解决。

日志 SHA256：身份 Green
`64bac3a333ae7c21d34064146b44e18d55d64c6eee91076c4d36ca12ea2e0afb`；
独立 bindings `738326584f8fe84f613c112eecc7f7056596fb07d29d20c6e09af4b3fe0ee37e`；
路由 `d189c9a64ad8a78504e91867a1733a4af2fc433fc75110a78bf8291a49e7cc4a`；
build `05588efb6c1b0bce136f7624ef551bdb9ee9376d3b999fc4b24b95d250ca47c6`。

完整独立 `server-pgvector` 于 16:35:50 在干净 `d7cdd6473` 启动（之后工作树仅
修改四份计划／证据 Markdown）：**收集 4165、4154 通过、0 失败、11 跳过**，
517 文件通过／1 跳过，182.76s，退出 0、清理确认。runtimeState 七例现在属于
独立必需 bindings lane；这是明确路由变更，不是新增七次通过或静默删除测试。
本机 linux/arm64 pgvector image：
`sha256:a36250871de0833b8757561c72f2477ef1ddd1101afa4e617fb552e0de514c6b`。
日志 SHA256：`f9074e442d8fd228f8ed000a9de5385448565158249cb8a48acfd1ef07086a63`。

`ee21b3e65` 另为发布 dispatcher 的首次实时观察保存独立快照。Red 为 **42 通过／
1 失败**：观察方复用一个对象、第二次读取时改为公开状态，原代码仍会调用 P12。
Green **43/43** 现已在所有动作前拒绝。这是调用接线回归，不是实际生成的通过
发布报告；独立 Standards／Spec 通过。Green 日志 SHA256：
`645e2531982b96ed0f926ca184d42b13ba87af8c23784674b5927635439e75d5`。

### 至 4394ec9cb 的后续集成

后续最后代码为 `3ce597e21496b98b7fc3e0e575396abef46d6ce0`，tree
`6dd110761274923a946a9aca41ec95cdfeb98dfc`。相对 4394 仅在 opt-in 恢复测试夹具
增加 8 行真实 TCP 就绪探测，每次关闭连接；原四场景、每例 180 秒和迁移仅执行一次均不变。
不将 4394 全量执行重标到此提交。源 `25414128c9de400749257dc3e2298668359e9654`
当前锁四例尝试 **0 通过／4 失败**，45.42s，均在 capture／approval 前失败：
initdb 临时 socket ready 早于认证数据库实际 TCP endpoint。自有资源清理确认。
失败日志 SHA256：`f36c08c3979cf58d662341ee0f238711b23961e66ef40469a41b4f0d7a712cb3`。
修正源为 `949110778aa2d9b0f0ca72ef380c05a0434a25cb`。

该干净源（tree `7051a8fd896d439339b88848b0af6c7c2d7e2c3e`）于 15:44:09 执行
四个真实 Docker 场景：**4 通过、0 失败／跳过**，534.25s，退出 0。每例均低于原
180 秒（97.957／151.282／138.602／146.131s）。自有容器、网络及卷执行后确认不存在。
日志 SHA256：`f94726621fbfcc46d8b4817679309e1e39bbefdc1ebc1a5a0fab3702601663ae`。
storage 全目录、capture／approval／authority／journal／handoff、Docker guard 的
blob 与父 `3ce597e21` 相同；其他四文件不同（report-target 服务、其双语 README、
disposable-runtime 测试）。这是组件源码对照，不声称该 run 执行了父 checkout。
实际测试覆盖采集、真实认证批准、源及认证端停止、独立恢复、owner／ACL、对象内容／
metadata、Redis AOF，以及两组六类非空目标拒绝时 journal 字节不变、无 started。
writer 占位服务和形似 Bull 的键仍不证明完整应用停写或实际业务队列消费者恢复。

父 `3ce597e21` 的自有 `schema-doc` 退出 0、清理确认；重新生成 pgvector 标准
schema 后 Git 无差异，文档治理检查也退出 0。这是实际隔离生成及比较，不把无库
`docs:check` 跳过解释为验证了迁移。schema 日志 SHA256：
`4575bc715ea031ca98d04223f4fccb3ff0d0c30fc9fa3f69c8f3f68939895a41`。

全文交付包保留经独立审查的 old／new 合同文件。每个指纹为排序后的 path、mode、
Git blob、文件 SHA256 记录清单的 canonical JSON SHA256；旧不存在文件显式记录 null。
这是限定交付指纹，不重置任何冻结 trusted base。包内 manifest 列出每组精确八个文件。

| 合同范围 | 旧 `f00f94435` | 新合同 blob（至 `3ce597e21`） |
| --- | --- | --- |
| reader | `9960d9bf66d09e955bd98b2ae431fb09d3f266b21ab419711df6dd2acbc403d7` | `cf87073abc4367f4debfac2037dadbd8fb17ea15e75e39bde7f1a501f3154df3` |
| 恢复 | `d84482d977522e743a2757c3797010f9428050c8344fac9e2a88470eec11cf89` | `92ae6cfc5307583f242fe1e4260a8d786530ec501c65b5a079fb2bb955b63199` |

Standards、Spec 分别对 4394 已授权分片复核，无 P1／P2；后续 TCP 夹具修订也通过
独立审查。以上均不批准完整 startup／controller 集成，也不覆盖失败的测试结果。

后续代码 `4394ec9cbfd50c6ab55dd5572db8647d15edbf62`，tree
`8266327238c9af164f026067ad4c4811768adfa3`，修复了两项新的 scripts 集成问题：
controller 消费正式公开报告批准服务（T6 不变），disposable-runtime 单测补齐严格
Pool mock。原 `1708e99c8` 批次 **1614 通过、2 失败、25 跳过，另 1 收集失败**，退出 1。
修复后完整 `scripts-pgvector` 于 15:30:19 收集 1656：**1630 通过、1 失败、25 跳过**；
120 文件通过／1 失败／1 跳过，99.06s，退出 1，自有资源清理确认。唯一失败仍为冻结
source-lock 的 60000ms lineage 超时，不改写历史 Hosted 的 S11-RP 失败归因。
未放宽 timeout、断言、trusted base 或 allowance。日志 SHA256：
`1fccb66c6500e5097082d116f7e148ced5a3bbeaf30cc986e4a850a2f676aa66`。

同一代码仅有六个报告／操作／计划 Markdown 文件未提交时，`npm run build`
退出 0（Vite 10.38s，保留原有警告）。15:35:10 的真实 `authority-pg16`
**81/81 通过**，0 失败／跳过，36.69s，退出 0，自有资源清理确认；本次也验证了
新的公开报告服务组合。boundary 再次 **3509 匹配**，0 未登记／stale／mismatch／growth；
contract、selfhost 均退出 0。build 日志 SHA256：
`db03392c3dba6bcaef5e512ecb1d00b75e01c9fece3e477a4831709012ec094b`；
authority 日志：`a051d6b4895c8d31c1575e968d818575ea82e2c901b36f70c6d7bd57ad944c03`。

修正后的实际恢复 suite 在源 `b8378f9f4a09375c23b53093baadcb819c838599`
（集成 `21362c9d0`／`d1c60c16c`）于 15:10:05 **4/4 通过**，0 跳过，540.64s。
使用实际 Docker capture、独立受限 PostgreSQL 认证和正式批准 producer；随后关闭源
及认证服务，由只接收包／journal／私有目标的子进程恢复。两种 bootstrap 均验证
owner／ACL、对象内容／metadata 和 Redis AOF，两组六类非空目标均拒绝。自有资源
已清理，四个保留的私有证据 marker 均为 accepted。这是真实合成三存储恢复，
不是用户真实备份、完整旧应用 controller 或 Bull 消费者验收。日志 SHA256：
`70ebd6bcd2c1a791dede24aa58dd3b1c2d64acb6573af06261c24b2ced650b8f`。

后续 `aec10a5a5def311c35616396c016906f8ddf92b9` 要求执行器使用 journal 精确
canonical 私有父目录的原始签发锁。假回调／错误目录 Red **26 通过／2 失败**；
祖先别名 Red **1 失败／7 过滤**。最终 focused **79 通过／1 个 opt-in Docker 跳过**，
TypeScript 退出 0，独立 Standards／Spec 通过。一次中间测试修订有变量遮蔽错误
（15 失败／64 通过／1 跳过），已修复，不将其作为功能结果。`4394ec9cb` 对六类
非空拒绝增加真实 journal 字节不变／无 started 检查。旧 4/4 仍绑定 b837；
当前锁实现的实际恢复单独执行。

开发 base 仍为 `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。
代码 `1708e99c80c29efa9cc31c1d128ace69b387d929`，tree
`1f68cbd0167d0fd98cd1878ae501a0cf2e6f8d92`；部署源仍为 82344044。
远端 PR 独立复核为 `f00f94435d128ff8706ffadedabbee507f79781b`，Draft／Open／未合并。
本检查点这些本地增量尚无新 Hosted 执行。

未获批 P12 schema 已通过 `68304f9bf`、`d4640da40` 和集成 `0edeb24fc` 从可执行候选
明确撤出，全文保留在 `codex/pr824-p12-contract-scratch` 的
`9b7af682cfa33cf60a9d27851dd5518bebf7b171`。生成器恢复为 0140、138 张表；
实现与其 lane 一并分离，没有保留功能而删除必需测试，没有放宽 S2 manifest 或断言。

| 实际执行身份 | 范围及精确结果 |
| --- | --- |
| 干净 `69f1a713128ce8a6614b220bddde591d0b1a213b`，tree `c3efe44e9827d0aefaabaf5c76422f80076eb3b5`，14:42:04 UTC+8 | 完整 `server-pgvector` 收集 4172，**4161 通过、0 失败、11 跳过**；518 文件通过、1 跳过；252.68s，退出 0，自有资源清理确认。11 个 opt-in runtime 用例不计本批通过。 |
| `0edeb24fc` 加 reader 测试 WIP，随后同 base 加实现 WIP | 真实 PG16 reader Red **46 通过／3 失败**，Green **49/49**，无跳过；提交为 `cb82fcb0a`，保留正式 Kernel 查询。 |
| 源 `09b8f1a4fb6a88b4c5d52429950bd2b822f42db9`，集成 `69f1a7131` | 真实报告读取 PG **36/36**；恢复旧 blob 配最终 canary 的 Red **34 通过／2 失败**。不是通过的 startup 报告。 |
| 源 `7c200e602af0be47c9ea0c16a95bfeb94912f0a6`，集成 `7aa08586f` | 真实 authority／report-target PG **63/63**；重验认证、私有 assignment、物理 lease；包含 missing-report 拒绝，不是成功的报告批准。 |
| 源 `371486626afa85526c4b199f38e7733cbbefec3c`，集成 `0d87cbf20` | 真实 authority PG **81/81**，含 18 个新增恢复批准场景；36.60s，退出 0、清理确认。真实受限认证及 capture／journal／approval 代码；存储字节与源边界仍明确为组件合成。 |
| `b2c77efa4`、后续 `35770b7e1` 提交前 WIP | typed journal Red **27 通过／11 失败**；初始 journal／consumer Green **64/64**。旧批准／pending capture Red **37 通过／2 失败**；最终三 selector **101/101**，退出 0。四 selector 未提供 PG 的尝试有 106 通过／7 跳过及 setup 失败，不是 PG 证据。 |
| 干净 `1708e99c8` | boundary **3509 匹配、0 未登记／stale／mismatch／growth**，退出 0，trusted base 未变。一次遗漏必需 base 参数的调用仅为 usage 失败，不算扫描。contract、selfhost 均退出 0。 |
| 干净 `1708e99c8`，15:02:12 UTC+8 | 最新四个 Docker 恢复场景 **0 通过／4 失败**，99.76s，退出 1。证据 marker 使包目录非空，新 capture guard 在原活动写入者断言前拒绝；这是候选夹具组合失败，不是恢复成功。 |

0140 仍是未封存的新追加迁移；本次提交前能力审计新增拒绝 PUBLIC 危险 builtin 与无
可信来源的系统 schema definer。SHA256 为
`9fd18152c0dd25037a2b0b5acb706c95897c8f24bfb7b709cb17ff4312db3aee`。
0138 保持 `a575205695852b11a536c7d41293f87634242b3c8d98f2345b3599e144aca8c5`；
0139 保持 `36fdd85de86ab09309dd6531594feca16a5bce00b343fa858ac04f4cdbf49f31`。
不得为此前 Scratch 数据库修改历史 ledger 来绕过 checksum 漂移。

typed 恢复批准持久保存 principal／assignment／trace，重算精确引用，并拒绝仅哈希或
已被替代的授权。`recordRecoveryExecutionApproval` 在写入前消费正式签发 authority
和真实宿主锁，不执行恢复或批准流量。普通 TypeScript 构建现已显式覆盖三个管理批准模块；
此前漏覆盖暴露的 7 个类型收窄错误已修复，未改变拒绝策略。限定 Standards／Spec 审查通过。
合法生产模式 API／worker 启动、完整 P12／P13／controller、全消费者语义、真实业务队列恢复、
浏览器和增长证据仍未完成；reader SELECT 与持久批准不能代替它们。

独立审查的退休 Scratch 为 `cb385e347d8a0fe2fcec057be4876e40fa9bf6e1`，保留在
`codex/pr824-retirement-contract-scratch`，仍依赖分离的 P12 原型。最新提交前代码真实 PG
**10/10**、纯测 **24/24**；共享锁 Red **9/1**、checkout listener Red **20/4**。
首次 Green 有一个跨库准备超时；将自有夹具准备放到 beforeAll，未改 timeout 或断言。
这只证明 LOGIN fencing，不是 P13；旧高权 bootstrap LOGIN 退休仍不支持、未验证。

原始日志 SHA256：完整 server `e50aa9f75c8dacf9912fd77510b607fc5509a3eccec15a4f7fade3ccd116264d`；
authority 81 `bd3065114dbb06c5363d97cd011cf5d6385856ad09a133f373285bcb9fd67687`；
最新 journal selectors `708a0e373e794d7cdb4d1f3d9b3ca43228ec25e5b7a1c32b717a6d06061d0603`；
失败四例恢复 `c835f760da778b03bbff1d9a6b0ecde2cd3b63dd8937b32870c9d47576c3df6f`。

### 较早的集成失败与分别验证的增量

`c120f92da`／`cf4813652` 的 P12 原型通过 0141 增加三张管理表。
focused PG16 通过不能授权修改冻结 S2 schema 合同。完整 server 在
`28c9902a4ea9cca600d7355e91276629f8c6647d`、14:01:54 UTC+8 执行，
退出 1：**4184 收集、3919 通过、53 失败、212 跳过**；521 文件中
482 通过、38 失败、1 跳过，151.36 秒，独占资源清理已核验。
新增表导致历史 43 表断言和 S2 指纹拒绝当前 46 表 schema。
原指纹仍为 `5424d2588395ab736b7af2ad5146091d7c9592ede4a59eea48480917e84516f5`；
候选实测为 `23fe1747c1c5e5477277654e90b3a0a002db6123a05c9342ef11a57fdc270646`。
这是候选集成失败，不归为 main 继承失败。P12 保持未封存 Scratch，等待独立、
限定的 S2／S2-RBAC／S2-PGH 决定；两项已有授权不包含替换该冻结合同。
旧 manifest、断言、指纹均未改变。

`1066cd05f` 将现有恢复采集接到 typed pending／committed／unknown journal
和由模块签发、绑定原目录的宿主锁。执行消费者拒绝历史仅 hash 的采集记录。
目录被替换时保留原 pending 证据，不写入替换目录中的 journal 副本。
采集不生成批准、不推进发布阶段。最终提交前 focused 在 13:44:03 执行：
105 收集、**104 通过、1 个 opt-in Docker 跳过**，退出 0，4.70 秒。
这是文件系统／journal 证据，不是绑定真实源的完整 controller 执行。

`f96833510` 将恢复输出绑定原目录和文件句柄。`81d99a6c0`
（源提交 `fff28cf7a8104f2284b424afc47f59b7abcc79db`）先同步每个 payload
和 manifest，再同步目录，完成后才返回成功。源 Red 为 4 失败／38 filtered；
源 Green 为 **84/84**、无跳过，TypeScript 检查退出 0。父集成后的
package／capture／authorization selector 在 14:12:44 执行 **83/83**，
退出 0，4.46 秒。两者 selector 不同，不合并总数。独立 Standards／Spec
接受限定句柄和同步修复。失败保留部分包；这些验证不能证明 shell 锁释放最后
一次路径检查之后遭到替换时，清理操作仍具原子性。

实际部署认证实现到 `5fafaff65`（源
`0c4a57e110fdddb7255d9a1dbc4a1b1b767b0540`）：真实受限认证 LOGIN、
现有会话授权、私有 run assignment，并核查有效 ACL／成员／函数／系统参数能力。
其独占 PG16 为 **38/38**，单测 **14/14**，build 与文档治理退出 0。
assignment 不把产品管理员自动变成部署 Operator。后续报告 writer target
为另一个仍在审查的 Scratch；中间 54/54 不能证明 passed 报告批准或启动成功。

`2ae097c939b611f94efe45fa878932f60fe2852c`、tree
`e774874e6fd86e0c43c1362c95664586c64c2c3c` 的 build 退出 0，Vite
8.76 秒，保留原警告。独占 schema 生成退出 0，新增 0141 库存提交为
`28c9902a4`；生成不是 schema 批准。reader／report／activation／authority
为必需 CI 独占集群；从共享套件精确排除后，不能在对应必需 job 未运行时算通过。
这里没有新的 Hosted 执行或生产操作证据。

新增原始日志 SHA256：

- 完整 server `28c9902a4`：`0328b620ad6839d1f57d377eb849f093f5e3ddd50e57c1f17f9278207426f5b7`。
- 集成恢复同步 selector：`18207bff46a7d7ee089961476c6398ccd77cdbbf6d6e6f37cca0bcb90e502365`。
- build `2ae097c93`：`3ddb73e02838a41b4fd38ebb5330e71ebc1a71592d4b11b46304f7ec46ea411e`。

### 本次续工中较早的执行

用户的两项限定决定取代下方历史记录中的恢复／reader 待决策状态。
base 保持 `cda6737a8`，生产源仍为 `82344044b436a8dafecefbb85dfd724cecb05e3f`。
发布本轮工作前实查 PR #824 为 Draft/Open/未合并，远端 head `f00f94435`。
历史执行不改记到后续报告提交。

reader 提交 `cf06d5a79` 至 `9caeae155` 追加 0140、十表精确查询／grant 清单和
权限污染反例。历史 0138 SHA256 为
`a575205695852b11a536c7d41293f87634242b3c8d98f2345b3599e144aca8c5`；
0139 为 `36fdd85de86ab09309dd6531594feca16a5bce00b343fa858ac04f4cdbf49f31`。
`3f2e8f7a7` 将历史角色合同两侧明确停在 0139，新增 reader 另行验收。
未修改生产登录或凭据。权限审计修正后，独立 Standards/Spec 审查无剩余 P1/P2。

恢复提交 `6b8febdc2`、`d22efaccc`、`44eaa7a9a` 实现登记的检查／执行分层、
不可伪造的执行目标对象和持久授权消费。检查入口不能导入执行层；新增模块漏登记、
命令伪装均有负测，无关 S10-PER 禁令保留。消费方要求既有 journal 中已经提交的
采集／批准记录；合成夹具不是尚缺的真实认证 controller producer。
独立审查在此消费方及四场景拆分中未发现剩余 P1/P2。真实恢复与完整 controller
批准生成仍为独立验收。

| 执行身份／命令 | 实际结果 |
| --- | --- |
| `0a4d6a4b6e86151aac87794f681e02d06cb47bb1`，tree `2aaf410e77adcda983bdd01cda4861e4403cc361`，owned runner `--suite reader-pg16`，11:33:23 UTC+8 | 46 收集／通过，0 失败／跳过／过滤，退出 0；真实受限 LOGIN 调正式 Kernel；PG16 Alpine 镜像 `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`，linux/arm64；清理核验通过 |
| 同提交，startup config 选择 `verifyStartup.test.ts`、`publishedStartup.test.ts`，11:35:21 | 41 通过、0 失败／跳过；仅 adapter 单测，非生产入口启动成功 |
| 同提交，boundary selector `locks the post-refresh`，11:35:22 | 1 通过、23 selector 过滤；非全套 |
| `6e6ceb6b57dc6b493ebe9629cbd8deb0d2eb2e7d`，owned runner `--suite schema-doc` | 退出 0，真实生成库存为 138 个迁移、末尾 0140；pgvector 镜像 `sha256:a36250871de0833b8757561c72f2477ef1ddd1101afa4e617fb552e0de514c6b`；清理核验通过；生成结果另提交 `4f0b54413` |
| 随后提交为 `2ff5e46b2` 的提交前字节，CI/runner/Hosted admission selectors，11:54:32 | 4 文件、75 通过、0 失败／跳过；合成密码学与真实 Git 夹具，非 Hosted 签发证据 |
| `44eaa7a9a71b3951c9af6292f439d64e5dd17702`，tree `aeb64d15e656d9e8d4a12a515a4825eba08b7ab7`，owned runner `--suite scripts-pgvector`，11:54:54 | 118 文件：115 通过、2 失败、1 跳过；1572 测试：1482 通过、65 失败、25 跳过；退出 1，63.14 秒；独占集群清理核验通过 |

本次 scripts 失败不归并到旧 Hosted 失败：一项是未改动 source-lock 的 60 秒
超时，另 64 项为 rehearsal。缺少规范化 TMPDIR 触发冻结的符号链接安全清理拒绝；
数据库用例还保留默认开发容器，未使用 runner 独占容器。因此首批不能证明这些嵌套
CLI 全部命中独占目标。`d7b7215c4` 传入本次私有规范路径、精确容器／固定 Docker
endpoint 及匹配的新集群 bootstrap 登录，不修改冻结断言或 timeout；修复后全量如下。

| 后续执行身份／命令 | 实际结果 |
| --- | --- |
| `a39294fff7d061249f229438c2a56c54234e8dd2`，tree `ba88e0792cb2d432c378f4166d8ce8c1dfa1462b`，仅证据文档 WIP；owned `scripts-pgvector`，12:08:34 | 118 文件：116 通过、1 失败、1 跳过；1572 测试：**1546 通过、1 失败、25 跳过**，退出 1，193.19 秒。64 项 rehearsal 已实际通过；source-lock deadline 仍失败。清理核验通过。 |
| 同代码，owned `server-pgvector`，12:15:32 | 517 文件：515 通过、1 失败、1 跳过；4111 测试：**4101 通过、1 失败、9 跳过**，退出 1，295.65 秒。唯一失败是 legacy guard 将明确 canonical schema 关系误判为旧 flat 身份。 |
| 同代码，`npm run build` | 退出 0；Vite 15.40 秒，保留 chunk/externalization 警告。contract、selfhost、文档治理也退出 0；非目标机镜像构建。 |
| 同代码，boundary CLI，明确 trusted base `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74` | 退出 0：3509 matches/allowances，unallowlisted/stale/metadata/growth 均 0。 |
| 同代码，实际独占 PG runtime integration，12:14:31 | **9/9**，退出 0，7.33 秒。真正 production `server/index.ts` 和 `workerRunner.ts` 在 listener/consumer 前拒绝高权登录或缺 schema 的受限登录；没有证明合法生产启动。 |
| `2437ab790` 加逐次 checkout WIP，随后提交为 `9d55cde1950a1e5108d01b72b1d0531435225df4`，12:45:08 | **38/38**，退出 0，6.85 秒：11 项真实 PG／入口负测、27 项 hook 单测。延迟核验时真正终止 backend 会拒绝并销毁连接，Kernel/root/raw pool 不能绕过观察；不是获批启动正向。 |
| `9d55cde1950a1e5108d01b72b1d0531435225df4` 加 runner/config WIP，随后提交为 `503c20b2850ddb3bfe9e84da1df6fea04c361b4c`，owned `report-pg16`，12:46:49 | **34/34**，退出 0，8.95 秒；PG16 Alpine 镜像同前，独立随机集群清理核验通过。真实受限 LOGIN 调正式报告投影，拒绝额外成员／ACL／definer 委托；正向读取 absent 报告，不是通过的技术报告。同代码独立报告单测 **27/27**，退出 0。 |

未改动的 source-lock 文件在 candidate/base 同一精简环境、直接 Command Line
Tools Git 下对照，两侧 70 秒外层监督均以 143 终止；两侧都不是通过，也不证明
所有候选失败均继承。没有修改 timeout、预期或 trusted base。
`c837829314c20ee6557334676c7970e728fe3ba3` 只修两个 schema 同名误判，逐处检测，
保留 path/token 禁令；独立 source 提交扫描 8/8。后续全 server 结果另记，不能用
该 selector 推定全套通过。

`9d55cde19` 保留真实反例链：hook 前十一项绕过失败；七种非 Error 拒绝暴露 pg
callback 假值成功分支；五项延迟断线暴露未处理 error 事件。最终同步 acquisition
callback 与连续监听移交分别通过 Standards/Spec 复审，不增加 grant 或发布权限。

恢复执行 source `4bd547437a1e6981ad14430899b5a2df032cf198`（集成为 `44eaa7a9a`）
实际 Docker **4/4**，退出 0，566.22 秒，原每例 180 秒不变。PostgreSQL 的
`postgres`、`wiseeff` 两种 bootstrap 登录分别覆盖完整独立包恢复及非空目标矩阵。
源停止后由独立过程验证 owner/ACL、受限读取、对象字节／content type／metadata 和
Redis AOF；形似队列的键不等于真实 Bull 业务消费者验收。后续仅夹具 source
`a957f7f998ea583d1dd4183aefbc04fe38ee81bb`（集成到 `954022cd8`）成功／失败均保留
私有证据，通过原 FD 写 marker。独立 focused 为 102 通过／10 项 opt-in Docker
跳过；legacy CLI 为 1 通过／11 过滤，20.25 秒，退出 0。不把前述四场景重新标为
此夹具提交执行。最终证据保留变更的独立审查无剩余 P1/P2。

新增原日志 SHA256（私有日志，不是上传的备份）：

- 修复后 scripts：`1f2af023f54a78e150c5cd4ee9dc5599a0828b122588de09e87edafae96d03ba`。
- 最终 checkout PG/单测：`3fb09556e9cea3fd40bbfb714b3702aea4612ca3685ff1cc3cb6c504cd8c296f`。
- 报告 PG：`f51e7118d40c8afa22a362651fa2a92e50d7e4efaa9c46842e6d730f19e079ad`。
- 四场景恢复：`afc8dac2356bfddd90c3d23d6fd522f763f2743ad80de94e5b6710c988b1220d`。
- 后续 legacy CLI：`044c666c0d8a89e9103dff178c6b05d4dac2722c7a8f2314e29cf1cd8852b560`。

代码 `c837829314c20ee6557334676c7970e728fe3ba3`，tree
`ecf59fd9cb98d82f531e68f31bcb4e370ac8f59d` 的 `npm run build` 通过，Vite
9.16 秒，保留原警告。12:54:42 全 server 收集 4158 项：**4147 通过、0 断言失败、
11 跳过**，但有 **1 个 suite 收集失败**：`selfHostedUpgrade/database.test.ts`
仅模拟 Client，新增 import-time 子类需要 Pool。整批退出 1，243.61 秒；519 文件为
517 通过／1 失败／1 跳过。`d93ae67a6` 补入误实例化即报错的 mock Pool，不增加
真实数据库 fallback。12:59:50 focused **41/41**（14 fixture＋27 checkout），退出
0；这不能覆盖全 server 失败。build 日志 SHA256：
`d4b4272c5eb0a732323d77e026079774cc34148a9ad59027fbcd2f7f44bb9007`；
server：`318091fde20e83e312657d1fde45d1e301f85948a1f686240b307a24b8fe4ea1`。

独立可审的规范修订为 `7cb047d1b10fbb74cf70b0cb2ab4d7b9e9e5d243`（reader，
两份规范）和 `a3e58024b3b20a2fdcc154a6bab3981310be7571`（恢复，四份规范）。
它们追加本次明确授权，原 phase、审批、退休和整体恢复资格条款不变。Standards
复审无 P1/P2，并核对中英文及相对链接。全文交付分别登记限定合同指纹，不将它们
当成全量 trusted baseline、实现候选或测试 checkout。

reader 日志 SHA256：`ff5f63523cd4418541d022ac20166d5d3a698b5ce5f211eddd01de2ac9c3d553`。
startup 日志：`854670dda36ec5d67ab63391a417a8da8cdf5254b2505583cb6c04e5aeeaff5f`。
boundary selector：`94fea2760b9d43e95e3b71b2ed3ba2ccc6d1978349243ff2e9f3b45636a6207a`。
这些是私有原始日志指纹，不代表已上传日志。

`e7f72e800` 新增已发布候选重启的批准投影核验，没有生成当前目标事实。
`1ebb03bf6`、`0a4d6a4b6` 让 38 个退休 HTTP 写路径只由一个入口处理，
并在查询 Catalog 指针前返回 410；含真实 branded pool 的根路由回归，
但未完成 P13 数据库／后台写路径清点。`d60043451` 修复生产缺 schema 绕过：
修复前新增两项单测失败，修复后选中三文件 25 项通过；真实受限登录进程负测见上表。

真实 API/worker startup callback、当前状态 producer、P12/P13、副作用后的报告／
批准链和完整 controller 仍是内部实现责任。S6 Binding/Value 租户权限是单独的
限定决策，不在 reader 0140 授权中。真实备份授权／材料、企业 CA／网络、
Policy #815 和生产批准分别保留为外部依赖。本检查点未建立真实副本、企业构建、
浏览器／容量或生产执行证据。PR 保持 Draft，M2 未完成。

## 历史 PR #824 复核续工，2026-09-07

代码 `11d8147a5accf08867bfaf792346af0d555b1d05`，tree
`570163372b9b8e1cdae5a6880262d66ae0fde408`，父报告 `7fabeb8c4`。
worker 准入后初始化失败会关闭连接池并返回固定脱敏错误；清理失败不泄漏诊断。
原登录／runtime-pin 拒绝处于该处理器之外，保持原样。

修复前两个生命周期反例失败，观察到私有诊断逸出。最终 focused 命令为
`./node_modules/.bin/vitest run --config vitest.runtime-bootstrap.config.ts
server/modules/logs/workerRunnerBootstrap.test.ts server/modules/logs/workerRunner.test.ts`：
退出 0，2 文件，15 收集／通过，0 失败／跳过／过滤。这是生命周期单测，
不是实际进程合法启动验收。`npm run build` 在相同生产代码上通过（早于最后
仅测试断言的追加），保留 chunk/externalization 警告。文档治理通过；
本分片未运行 schema 文档数据库验证、新全量 scripts/server/contract/boundary/
browser/capacity/PG。独立 Standards 与 Spec 仅本生命周期分片 PASS，
不构成整 PR 或 M2 审查通过。

Hosted `34067803219` 的 head 为 `7fabeb8c4`，实际 checkout 是
`51ec49131ea542d499607021c20012ad1b39266c`（base `cda6737a8` 的 merge-ref）。
scripts 114 文件，1467 收集：1427 通过、1 失败、39 跳过。唯一失败为
`scripts/run-restore-drill.test.ts` 的 S11-RP 生产 token 禁令命中
`ops/self-hosted/storage/controlledRecovery.docker.ts` 内 `pg_restore`，
不是历史 source-lock 超时。本机同 selector：base 1 通过／12 过滤，
candidate 1 失败／12 过滤；均 Node 22.22.3/npm 10.9.8/Vitest 4.1.5，
Hosted Node 22.23.2。后续 boundary/bridge/backend/contract/log-eval 步骤跳过。
该历史 run 的 Acceptance quality/smoke job 成功，不证明生产 startup。

原 CI 日志 SHA256：`7e01dcbdd93b9cae2e21c559146b1f9b2bfcadfe36cbf6964d8f2021ff3fc115`。
候选 selector：`87ce9486226ae219a6dd23586c4c61c2c2b999a61f58c8a5c707ef60f521acd2`。
base selector：`698920a886a67deab69d33617d3e22cc12d81425ce81e8582143eea757e68143`。
原日志私有保留；校验和不等于已提供公开附件。

A/B/C 均未完成：未通过放宽扫描修 CI；未接通真实根 startup adapter／合法
进程验收；未完成 controller 升级。runtime 只读能力及恢复执行归属需要明确
合同决定。当前状态／P12/P13／报告 producer 仍是内部实现缺口，不归因于
生产未授权。本轮无新 Docker/PG、真实备份、企业网络、生产执行或批准。

## 续工检查点，2026-09-07

代码 `df644163e28d0aaa11733b9b08f398ac7d2429e4`，tree
`4690333c6d62a9c613b344d9616c473c92bcc0e9`；后续报告提交仅改变既有六个
双语计划／操作／证据文件。重新 fetch 的 origin/main 仍为
`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。源部署保持
`82344044b436a8dafecefbb85dfd724cecb05e3f`，历史 image ID 见下文，
不替换成本地重建镜像。本检查点没有候选 PR、Hosted checkout/job、merge-ref、
merge SHA 或生产操作。M1 因记录中的全量 scripts 失败仍为 Scratch；M2 未完成。
组件成功不等于完整升级或批准。

报告 `1190ba591` 后实现了：既有 journal 内目标级 Binding／管理持久 attempt、
真实宿主锁存活验证、fsync 未知及跨 run 准入拒绝、原应用已停止时的 handoff 观察、
完整旧 public 投影与不可变迁移清单、受控管理迁移／checkpoint、候选／run／plan
固定的 P4 receipt 及 resume／no-op 重验、物理结构／权限连续性，以及两个 bootstrap
profile 的 PG16／MinIO／AOF 独立包恢复。关键提交为 `b91c98a31`、`45e2d07cd`、
`bbefbfc25`、`0a88f831b`、`273e0b26e`、`4f3f1485c`、`aa47072bc`、`a77e0ea6a`。

| 实际执行（UTC+8） | 结果与边界 |
| --- | --- |
| `df644163e`，00:28:33，真实 PG16 Alpine 组件终端入口 | 9 文件，92 收集／通过，0 失败／跳过，71.88s，exit 0；旧 schema、canonical Binding 组件、P4、Archive 和结构测试 |
| `df644163e`，00:28:29，runtime bootstrap 配置 | 10 文件，96 收集／通过，0 失败／跳过，9.57s，exit 0；含新建自有网络／卷上的 7 个真实受限登录／checkpoint 用例 |
| `df644163e`，build | exit 0，保留 externalization／chunk 警告 |
| `df644163e`，最终 CLI／gate／Compose | 63 收集／通过，0 失败／跳过，exit 0；含真实旧七行 gate 与新 CLI，不能当作完整旧 controller 成功 |
| `df644163e`，boundary／contract／selfhost／docs | 均 exit 0；boundary 3509 全部匹配，0 unallowlisted／stale／growth／mismatch；docs 使用显式自有 PG receipt |
| `0a88f831b` 加 source-test WIP，00:03:00，受控恢复 | 3 文件，42 收集／通过，0 失败／跳过，217.28s，exit 0；两个 bootstrap 身份、原 MinIO 版本、AOF、独立包恢复；恢复代码 blob 到最终候选未变 |
| `273e0b26e` 加父集成 WIP，00:21:57，管理／controller journal | 4 文件，67 收集／通过，0 失败／跳过，2.75s，exit 0；后提交为 `4f3f1485c`，不重新标为该 SHA 执行 |
| `aa47072bc`，00:23:32，系统授权扩展前的 PG16 矩阵 | 9 文件，89 收集／通过，0 失败／跳过，68.13s，exit 0 |
| `aa47072bc` 加三项权限反例，00:25:48 | 3 失败、20 selector 过滤，exit 1：parameter SET、builtin EXECUTE、特权设置未改变 receipt |
| 同工作修改修复后，00:26:11，后提交为 `a77e0ea6a` | 23 收集／通过，0 失败／跳过，1.04s，exit 0；真实 PostgreSQL，未改阈值 |
| `27946d016` 加父 P4 WIP，00:20:06 | 1 失败、6 selector 过滤，exit 1：失效 P4 仍允许 resume |
| 同 P4 测试，暂不应用输入克隆修复，00:21 | 1 失败、6 selector 过滤，exit 1：await 后调用方修改影响 P4 |
| 同工作修改修复后，00:21 | 7 收集／通过，0 失败／跳过，exit 0；真实 S7／checkpoint／Archive 调度，receipt port 明确为合成组件端口，不是报告 |
| `f5797479b` 加修正的 controller 反例，00:09:01 | 原代码 2 失败、15 selector 过滤；修复后 49 收集／通过，0 失败／跳过，2.64s；真实 journal／宿主锁，owner spy 只检查禁调 |

失败保留：第一次恢复命令误选不存在的路径，收集 0 个用例（passWithNoTests 导致
exit 0），不记通过；改为实际 storage 路径后得到 42 项结果。新 controller 测试
曾错误地给非 Binding harness 请求 Binding scope，setup 失败；修正后才真实复现
replay 准入问题。第一批结构测试 67 通过／2 失败，分别为 typed reason 接线不一致、
controller 提前拒绝使旧的晚拒绝断言失效；下一批 PG16 为 88 通过／1 失败，原因是
克隆缺省 Archive key 抢先抛错，掩盖要求的 typed 准入拒绝。`aa47072bc` 修复顺序，
未放宽断言。Typecheck 也发现管理 journal 两处 union spread 错误，已在最终 build
之前修复。

9 月 6 日直接将 pgvector-only fixture 指向 Alpine 曾产生 7 个文件 setup 失败、
7 个纯测试通过和 60 跳过，不是迁移失败或通过；随后增加独立自有 Alpine fixture，
未放宽 Catalog lane。更早仅留工具会话输出的锁 Red/Green、部分迁移、源投影和
恢复演进执行仍保留各自身份；缺失原始日志不重建成伪造 raw log。

最终矩阵采用已独立核验 daemon 的 Docker Desktop、新建自有数据库／角色／卷／
网络，PG16 `linux/arm64` image ID 为
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
工具为 Node 22.22.3、npm 10.9.8、Vitest 4.1.5、TypeScript 5.9.3。核对旧 schema
完整 126 个迁移文件及 0129–0139 的 11 个追加文件 checksum；0140 未进入候选。
source／bundle／mapping／receipt pins 来自组件 fixture，不是生产或 runtime／
public 报告 pin。临时资源按所有权核验后清理；公开包日志脱敏路径、凭据和宿主身份，
附文件校验和。

独立增量审查关闭了 search_path／源 schema、跨 run 准入、可变 P4 输入及系统权限
连续性问题。这些是有界标准／规范／安全审查，不是整体 seal。P4 结构连续性不替代
Release Verification；持续停写仍须由根流程真实 boundary 提供，不能传 boolean。

剩余内部工作仍由父负责：完整终端交接与 P2/P3 组合、未知结果显式 reconcile、
全部消费方转换／oracle、P12/P13 和新完整报告链、真实 API／worker pool 启动、
浏览器／业务／增长验收。未跑 M2 完整 scripts／server／UI 或 Hosted。#815 仍无
权威统计或分阶段 unavailable 的已接受契约；单独备份的 0140 提案新增两项治理
EXECUTE 能力，未批准、未集成。授权真实备份及企业 CA／网络证据均缺失。
生产维护条件未就绪，不交付生产升级命令。

## M1 续工记录，2026-09-06

开发 base 仍为 `67d4a77325b6009b77c2373bd788298a6d022bcf`。
M1 实现 `9453cf442b40fe1e90dc4ffb948e7b31898568eb` 删除两个无用旧 import
以及只求值、未调用 verifier 的表达式。verification 模块没有必需初始化副作用；
另一个无用 import 已被实际 CLI transform 擦除。两个旧模块仍留给实际调用方。
仅删除四个已退休 S12-OPS allowance；历史3519项 fixture、trusted base、
23对 relocation 均未改变，重新引入任一删除项都有永久拒绝反例。

`ffc2404986918466c672450d9628834bdf899b18`，tree
`e62f9239f4d1c207d2269951417915d87afce9fb`，补齐 relocation 回归的四项
精确删除断言。独立完整 M1 Standards／Spec 在 `9453cf442` 通过，后续断言
差异也经独立复核通过。范围仅保护性拦截，不是支持 populated 升级。
本记录时尚未创建 PR、未执行 Hosted。

| 实际执行 | 结果 |
| --- | --- |
| 继承 boundary Red | 1失败，23项被 selector 过滤 |
| 退休模块加载 Red | 1失败，0跳过 |
| `9453cf442` 完整 focused 集合 | 13文件，291通过，0失败／跳过，181.69秒 |
| `9453cf442` build | exit 0，保留原构建警告 |
| `9453cf442` boundary CLI | 3509匹配，未允许／陈旧／增长／metadata差异均0，23对relocation，exit 0 |
| `9453cf442` 全量 scripts | 104文件，1299通过、3失败、5跳过，exit 1，452.82秒 |
| `9453cf442` 加精确断言差异，有界 relocation/source-lock | 37通过，0失败／跳过，exit 0，69.40秒 |
| `ffc240498` contract／selfhost | 均 exit 0 |
| `ffc240498` 最终全量 scripts | 104文件，1301通过、1失败、5跳过，exit 1，356.29秒 |
| `67d4a7732` 后 `ffc240498`，同一source-lock命令串行对照 | 各4通过，0失败／跳过，44.76秒／59.27秒，未改timeout |

全量两项失败是旧3513／6数量断言，已按精确四项删除修复；另一项是 source-lock
在原60秒限制下超时。候选较 base 约4865次 Git 子进程仅增加15次，不能据此
把明显变慢归因于提交增长。该测试自身受源锁约束，本轮未改测试或 timeout。
有界复跑通过不覆盖全量失败；最终全量批次仍在同一source-lock用例超时。
M1因此仍为Scratch，不在必需命令失败时创建PR。再次全量执行前需单独处理
runner／源锁性能决策，不再计划同样的反复重跑。5项跳过不记通过。
下文原17项失败保留原执行：15项目标路由失败、两项超时，其中 setup 超时过滤了
后续用例。当前正确路由的批次是新证据，不能重新标注旧批次。

本轮专用 PG 为新建且核验归属的 Docker Desktop 集群，镜像
`pgvector/pgvector:pg16`，数据库 `wiseeff_lane_734`，随机私有凭据并固定实际
容器身份；未使用共享 Compose 应用数据库。旧 schema 回归另建独立
`postgres:16-alpine` 容器。未连接生产机。M1全文包现已发布到
[交付备份分支](https://github.com/tzrea1-Q/WiseEff/blob/codex/populated-upgrade-delivery-20260906/m1-full-files.zip)，
含报告head `a9a8858ab713cfca5bc605d35e04fbfd602acaa6` 的全部33个修改文件、
diff、manifest和选定日志。上传后重新下载验证，SHA256为
`43d254419c11d1aa0cec79fadbd06ec4ac8cd549aaa4cbba53721515b78d010c`。
这是源码／证据备份，不是发布镜像或PR批准。

## M2 续工记录，2026-09-06

最终代码候选为 `21f5aa4a8bdbb7208504396bce62796cf55875da`，tree为
`abcaeb43726145608d0a80edd5b5cdc52724fbee`。后续报告提交只改六份既有双语
计划／手册／证据文件。当前集成base为 `cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。
本检查点GitHub查询没有候选PR或分支Actions run；没有CI checkout、merge-ref
或merge SHA。M2全量scripts／server、API／浏览器及容量验收仍未运行。
M1全量scripts失败单独保留在上表。

父集成沿用相同开发base。下表保留实际执行时的代码身份；cherry-pick和后续报告提交
不会把旧执行重新标成集成head执行。

后续origin/main推进至`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`，仅含纯文档
PR #823。父以`7218a43dcd5402d52b5e57166b746d0c6409642f`追加合并；原base与
先前测试身份不变。

| 精确代码／边界 | 实际结果 |
| --- | --- |
| `fa7ee0bc6c7e94e26c9d34663b1f4cc9e8c277d2`，build | exit 0，保留原externalization／chunk警告 |
| 同head，boundary CLI及原trusted base | exit 0，3509匹配；未允许／陈旧／增长／metadata差异均0 |
| `6b817a48e41a2ae14355575f7a832e840531a018`，S6收据消费端＋Archive | 父执行19:06:43，2文件12通过、0失败／跳过，2.93秒；含5项真实隔离PG用例 |
| `06ef19e2cab84cdfb375b00fe7fe28d286027db3`，handoff | 父执行19:07:42，4通过、0失败／跳过，30.99秒；此前3通过／1超时批次仍独立保留 |
| `1173071bd` 加NODE_ENV反例，修复前 | 1通过／1失败，私有API env将实际NODE_ENV覆盖为development |
| 同工作差异修复后，纳入`90f555b96` | 真实Compose config，2通过、0失败／跳过，不代表应用启动 |
| `90f555b96`，交接拒绝冲突运行模式 | 父执行19:13:02，4通过、0失败／跳过，37.62秒 |
| 未批准的独立runtime提案`cac99fba82ec4f6349afed4d27c7d642fd0064ff` | 技术评估8文件67通过、0失败／跳过，含11项真实PG；后续仅配置提交`56a838eaa`未重跑整批 |
| `cd2598d13`，恢复包v2＋真实三存储 | 2文件28通过、0失败／跳过，71.70秒；原MinIO版本、AOF、独立恢复进程、角色继承和三项恢复故障 |
| `7695ace6f`，管理CLI回归 | 14通过、0失败／跳过，749ms，含真实CLI输入拒绝 |
| `9ce8db341`，专属新PG上的实际管理CLI | exit 0；137项迁移、4张checkpoint表，production模式且无运行期秘密 |
| `7695ace6f` 加配置防护，提交`1fda481ea`前 | S6＋Archive 12通过、0失败／跳过；缺receipt的CLI在收集前exit 1 |
| `9ce8db341`，测试目标URI反例 | 2通过、0失败／跳过；query host／port／sslkey及hash在Docker调用前拒绝 |
| `9ce8db341`，boundary | exit 0，3509匹配，未允许／陈旧／增长／metadata差异均0 |
| `7218a43dc`，窄类型修复并接入最新main后的build | exit 0，保留原chunk／externalization警告；之前类型错误已解决 |
| `23e7540a7`，dump外权限恢复回归 | 2文件34通过、0失败／跳过，99.69秒；五项权限故障在自建fixture清理前验证源仍保留 |
| `b5c67723c`，数据库级设置恢复拒绝 | 2文件35通过、0失败／跳过，117.42秒；拒绝后新连接仍受原设置约束 |
| `42b906033` 加后提交为 `b5c67723c` 的runner修改 | 3文件25通过、0失败／跳过，828毫秒；CLI、receipt、migration和真实子进程终止，本批不使用Docker |
| `e73d48419` 加组件runner | 6文件42通过、4失败、0跳过，8.78秒；四项producer用例因真实受限源表权限失败 |
| `4c60f1bcc`，原build | exit 134，TypeScript的1 GiB heap耗尽 |
| 固定 `7218a43dc` 与 `42b906033` 加runner，串行冷 `tsc -b --force` | 同为1 GiB上限：base exit 0、候选exit 134；分别检查Node项目均exit 0，内存报告938938K／941585K |
| `ce9915f23`，分项目进程build | exit 0；保留原两个TypeScript项目和Vite、每进程原heap上限及已有Vite警告 |
| `17647b243`，真实组件终端入口 | 6文件48通过、0失败／跳过，8.99秒；源pool分离后的真实producer与受限导入 |
| `198054e1b`，加入未知源回滚 | 6文件49通过、0失败／跳过，8.70秒；注入响应丢失后销毁真实连接 |
| `1635060c3`，journal准入反例 | 49通过、1测试超时、0跳过；测试持有单槽pool连接又请求另一连接 |
| `21f5aa4a8`，journal准入使用独立受限登录会话 | 6文件50通过、0失败／跳过，8.53秒；缺journal、pending、unknown均在阶段动作前停止，未改timeout |
| `21f5aa4a8`，最终代码build | exit 0，保留既有Vite警告 |
| `21f5aa4a8`，最终CLI／门禁／Compose集 | 6文件63通过、0失败／跳过，3.05秒；包含真实旧gate／新CLI子进程 |
| `21f5aa4a8`，boundary／contract／selfhost | 均exit 0；3509匹配，unallowlisted／stale／growth／mismatch均为0 |

组件runner前三次因Docker Desktop未发布internal network端口而在收集前失败，
保留为失败。现使用独立owned bridge、仅发布loopback并禁用IP masquerading。
其中只运行PostgreSQL，不证明应用外联隔离。未知suite（包括继承的对象属性名）
在Docker调用前拒绝；执行有15分钟上限、TERM/KILL升级和8 MiB原始输出上限。
清理前核对精确资源归属。

独立审查发现数据库级设置不在dump或角色清单中。`42b906033`在导出前拒绝
这些设置和缺失统计字段，不RESET或猜测恢复方式。恢复仍限于声明的PostgreSQL 16、
bootstrap `postgres` 合成形态，不能冒充完整业务或生产`wiseeff`角色恢复。
另一次 `23e7540a7` 真实终端执行返回源已停止、AOF、仅消费包的恢复及清理证据，
同时明确 `fullBusinessVerification=false`、`releaseReady=false`。

`9ce8db341` 的Node typecheck发现管理parser返回的checkpoint模式类型被扩宽；
`842010159`补充明确窄类型。先前真实CLI保留实际执行SHA，不隐藏这项类型失败，
也不归给base。两次探索调用使用不存在的配置名／错误flag，均以usage／configuration
错误停止，没有收集测试或访问数据库。

S6测试使用真实旧schema，将共用Definition的两个项目转换为canonical Binding，
保留4个值ID／时间及独立显式tip，并通过现有领域reader读取revision历史。
加密源Archive保留JSON null与SQL null的区别；SQL-null项目值当前明确拒绝，
不猜值。这是管理收据消费端的canonical转换，已超出“旧表保留”。但其P0/P8收据
仍是合成管理fixture，不是完整producer或发布批准链。实际producer必须先固定P0源意图，
后生成P7 mapping／Archive随机ID，再绑定P8收据，不能反向补写P0。

后续producer已实现这段有界生成链：确定性的完整Binding意图、真实P7 head、
加密Definition证据、实际自动registration、v2收据生成，再同事务执行S6导入／checkpoint。
三个跨项目合成Binding共用两个Definition，保留六个值并独立断言tip／历史。
源读取使用独立受控管理连接及21张表的真实SHARE锁；canonical写入仍用受限
管理登录，冻结grants未变。这超出了保留public旧行，但早期P0/P7仍为夹具准备，
不是完整根入口或verifier报告链。其他消费方、SQL-null值转换、HTTP／浏览器及
运行身份下的完整业务仍未覆盖。

独立审查发现的阶段倒写及未知提交准入已在消费端修复。controller journal的
pending／unknown会拒绝普通execute，缺journal／boundary adapter在写前拒绝。
具体root adapter和显式reconciliation仍缺失。源回滚响应丢失时销毁连接，不再归还pool。
这些审查与反例不能证明一次P0–P16成功运行。

handoff使用真实PG／MinIO／Redis身份，执行现有controller的inspect、宿主锁、私有文件
descriptor和漂移拒绝；应用容器明确是身份测试桩。没有证明完整旧应用controller、
候选启动成功或停服后的分阶段resume。

运行身份提案位于[独立备份分支](https://github.com/tzrea1-Q/WiseEff/tree/codex/populated-upgrade-runtime-proposal)。
它没有向governance writer授予宽泛Catalog／audit SELECT，但两项新增writer EXECUTE
仍扩展0138冻结manifest，尚未批准。可执行集成候选中没有0140迁移。
真实生产启动callback仍缺当前目标runtime pin状态producer；普通业务角色覆盖、
隔离API／浏览器、容量仍未完成，开发责任保留在父任务。

### 重建的旧源镜像

父任务从干净旧源SHA `82344044b436a8dafecefbb85dfd724cecb05e3f`、tree
`6dd92c36c4eb41bcaaba5a7a756befb9239d9120` 使用其原Dockerfile和既有build-network
库完成TLS验证构建。实际本地Docker image ID为
`sha256:65b300d1a8b80c06b9f7b37ccc21e45973d875492f2ae60f0128937cc934dea1`，
平台`linux/arm64`。BuildKit image manifest为
`sha256:40ef0227106e6ad85e2c0d286bdeb4dddb472b6e3ff66c6e746a6dc28db93c9c`，
config digest为
`sha256:2a0d17d6a8c2c7815d1ffe35ff94a4be03fcb2d8e4432c7bd3774f2d9a0fa12b`。
lockfile SHA256为
`43adbfe23117426588694bbd209eb96997d3a73287da475a2a2d4dfab29050ea`。
构建exit 0；日志SHA256为
`220821b090936a637118d9dbddf576c774827d74157c77ec8f3870fda5eca25e`。
已保留本地重建镜像；它不是用户历史image ID、registry发布、最终候选镜像，
也不是企业网络／CA验证。

### 执行安全偏差

三次本地调用违反了显式隔离路由要求。两名子任务漏传专用URL而调用server globalSetup，
到达默认／共享开发数据库，在历史ledger缺失拒绝前执行了migration ledger bootstrap DDL；
对应目标的逐文件migration循环未执行。更早的template setup已返回，复用／新建效果
未完整观察，不能声称零写入。完整原始日志未保留，不编造checksum。另一次裸docs检查
查询默认数据库扩展能力，因vector不可用跳过schema生成；该调用未执行迁移。
未连接生产机。父已撤销子任务执行权限；后续DB／Docker／测试集中由父核验专属目标后执行。
未对未经核验的默认目标再次连接、修复或清理。这些偏差不是通过证据，保留在记录中。

M2根入口完整成功、完整业务恢复、真实备份副本、企业网络候选构建、Hosted checkout／jobs
以及生产操作均仍为**未运行／未完成**。以上组件结果不授权生产命令或维护窗口。

## 上轮身份与状态（历史）

采集日期2026-09-06，仅独立开发环境。源部署仍是 `82344044b436a8dafecefbb85dfd724cecb05e3f`；用户提供的历史镜像 ID 为 `sha256:be121540c40fbb35e774b48cefb29b7ddf27d1bb8aa0c050a17acca3b7dfbf6c`，不是 registry manifest，也不是本轮复核结果。最初开发 base 为 `1c9fa56e3eaca6e7984f35a097876772a6e4025d`；最终刷新 base 为 `67d4a77325b6009b77c2373bd788298a6d022bcf`，新增内容是纯文档 PR #822。

代码候选 `b2c150d18bb6d7a8d8d5b45bcbf9f683fdafecbf`，tree `b8eb49d3a074e00196fb89c30ba4d1cae3677b3c`，分支 `codex/populated-upgrade-candidate`。27个任务文件与保留的原 Scratch `d357a5e6538f4bac4d63ba782ce13f75fe1cf194` 逐字节一致。本报告属于后续文档提交，不重新标注旧执行。候选没有 CI checkout、merge-ref、最终merge SHA、正式 bundle/runtime pin、mapping/source冻结或获批真实目标。

| 交付状态 | 结论 |
| --- | --- |
| UPG-01缺上下文拒绝 | 已实现，真实CLI反例已验证 |
| 完整代码交付 | 未完成；仍有boundary回归和发布集成缺口 |
| 合成populated | 追加schema后旧Binding／revision行保留；尚未证明canonical业务转换 |
| 真实备份副本 | 未运行；未提供备份，接收adapter也未完成 |
| 实际恢复 | 已执行并验证合成三存储sentinel恢复；未证明完整业务／真实恢复 |
| Hosted／PR | 未运行／未创建；仍为Scratch |
| 申请生产维护窗口 | 不具备条件 |
| 生产执行／批准 | 未授权、未执行 |

## 反例与精确执行

初始base在真实隔离PostgreSQL上运行 `npm run parameter-definitions:check -- --catalog-only`，返回 typed `absent/missing`，exit 0。`8922b3884573bd5d7c3c3f2efce53f3f51d6b894` 同命令返回 exit 2、`PCAT-UPG-RELEASE-CONTEXT-UNAVAILABLE`；显式 `--verify --diagnostic --report-id missing` 仍允许诊断返回absence和exit 0。原版7行controller gate fixture与源Git字节一致，SHA256 `29c28f2b5951bf4650984ec1be07ac121b8bb61c07e29388f70b7848e8952232`。其子进程回归调用真实npm/CLI，仅Docker传输由adapter代替，不能称完整旧controller／Compose预演。新普通stack入口对canonical目标拒绝apply/no-op/resume/recover-candidate；生产固定入口交接尚缺。

工具：Node22.22.3、npm10.9.8、Vitest4.1.5、Docker29.5.3。原schema回归使用独立 `postgres:16-alpine`；verifier专属fixture为pgvector PostgreSQL16。迁移清单是126个源文件及0129–0139共11个候选后缀，核验完整filename/checksum。此结果不证明生产扩展／应用启动兼容。

| 代码SHA | 检查 | 精确结果 |
| --- | --- | --- |
| 8922b3884 | 11文件focused，真实Docker开关开启 | 266通过，0失败／跳过，exit 0 |
| 8922b3884 | 全量scripts | 103文件：99通过／4失败；1306测试：1251通过／17失败／38跳过；exit 1 |
| d357a5e65 | 恢复继承库存后的CLI及boundary | 42测试：41通过／1失败；exit 1；前一Scratch缩减库存导致恢复被拒绝 |
| 1c9fa56e3、d357a5e65分别运行 | 串行exactRelocation/source-lock，原timeout | 各37通过、0失败／跳过；exit 0；53.98s／60.40s |
| 上述两个SHA分别运行 | URL/container一致的单个真实零库存导入导出回滚selector | 各1通过、80因selector过滤；exit 0；未复跑其他失败场景 |
| b2c150d18 | 12文件focused，两个Docker开关，maxWorkers=1 | 收集290：289通过／1失败／0跳过；exit 1；83.94s |
| b2c150d18 | boundary CLI，trusted base 9b3ba7df7e21f5589684bc92c872da593ad4c246 | 3513项：3512匹配、1未允许／1陈旧，0增长／metadata差异；exit 1 |
| b2c150d18 | npm run build | exit 0；保留Node externalization／chunk警告 |
| d357a5e65 | contract:check、selfhost:check | 均通过 |
| 8922b3884 | 带专属PG的docs:check | governance及schema artifact通过 |
| 2e40a8b3d | report及role两个server integration文件 | 31通过、0失败／跳过；非全量server |

剩余boundary失败由本轮负责：保留的legacy verifier引用移动后不能绑定冻结occurrence。未修改断言、检查器上限或allowance ID来隐藏失败。原全量批次另有15个数据库／容器路由失败及两个超时，其中setup超时导致33项跳过。同环境有界对照支持路由／负载归因，但不能把原批次改成通过。全量frontend/server、浏览器业务验收、增长容量、完整consumer oracle、企业网络镜像构建和Hosted均未运行。

日志和全文件校验和在本地交付包的 `evidence/`、`manifest.json`。保留原执行SHA；合成凭据／开发机路径不构成生产证据。包内不含私有备份或原始业务值。

## 剩余工作与责任

[冻结relocation契约](../../docs/agents/catalog-boundary-relocation.md)明确禁止通过padding源文件保留身份，独立Standards已否决该路径。最小boundary决策是独立审查这一未变引用的精确映射（完整blob、字节位置、原始切片及反例），或按归属契约移除旧债务。现有23对授权不能批准本次新映射。

父实现者负责在不放宽冻结boundary的前提下修复occurrence回归。发布集成owner负责获批P12/P13归属、退休后完整复验、runtime/public门禁和固定身份交接。运行安全owner负责实际角色／pool迁移和业务验收；检查器不会切换凭据。恢复owner负责备份接收、同边界快照、目标绑定完整恢复。产品owner负责#815权威Policy引用或明确批准unavailable。构建操作员负责企业CA及真实受信镜像来源。数据owner负责真实备份授权。验收owner负责完整语义／浏览器／容量。生产批准另行处理。

独立Standards通过了有界代码审查并验证27个刷新blob；独立Spec仅接受有界helper，明确完整需求未满足。此前Docker环境可指向远端的P1已通过固定本地endpoint／daemon身份检查修复。不宣称整体seal、发布批准或OP-09关闭。参见[终端手册](populated-upgrade.zh-CN.md)，当前不提供生产升级命令。
