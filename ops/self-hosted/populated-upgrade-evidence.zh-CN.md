# 存量升级候选证据

> English: [English](populated-upgrade-evidence.md)

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
