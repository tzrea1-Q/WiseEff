# 存量 self-hosted 升级兼容修复

> English: [English](../../../exec-plans/active/2026-09-06-populated-upgrade.md)

## 范围与状态

### 已批准的限定合同演进，2026-09-07

用户明确授权从 `f00f94435`（代码 `11d8147a5`、main `cda6737a8`）实施和隔离
验证两项独立 R3 变更。刷新后引用未变，工作树干净。这两项此前待决策状态已被
本次实现授权取代，不重复请求批准。

恢复：S11-RP 保持 capture/verify/restore-check 的 manifest、精确目标、停写及
run-bound token 所有权。纯检查入口不得直接或间接调用执行层。登记全部 storage
模块及依赖，建立独立受控执行合同。恢复消费既有受信包／token，绑定持久 attempt、
来源信任、授权和逐存储实时目标／锁校验。部分／未知结果保留，成功不恢复流量。
全目录 token 禁令仅演进为有穷尽登记和回归的分层，其他禁用操作不变。

Reader：追加下一个迁移（当前 0140，集成前重查），历史 SQL／checksum 不变。
NOLOGIN 能力仅获正式 Kernel SQL 所需 schema USAGE 和逐对象 SELECT。
保留 0138 历史负测，并以真实受限 LOGIN 验证新增显式授权的读取。不含 DML、
所有权、grant/admin option、高权角色可达、治理 EXECUTE 或新增高权系统元数据
读取。报告查询仍用独立 0139 角色。

单写责任：恢复 Scratch 独占 storage 检查／执行归属及测试；reader Scratch 独占
新增迁移、role manifest、真实 Kernel／角色测试；父协调者独占 runtime 根、
controller、生成 schema、指纹发布及最终操作／证据双语文档。分片分别维护模块
双语合同，独立 Standards／Spec 审查后按 reader→恢复顺序集成。测试不得共享
集群级角色；不照搬旧提案。父协调者继续 startup／P12/P13 内部集成。

威胁冻结：漏登记模块、间接／动态跨层调用、命令规避、伪造／过期／跨 run 包及
token、非空／错误／共享目标、跨存储锁丢失、未知恢复结果、导出后源停止、
PUBLIC／owner／间接成员提权、INHERIT／SET／ADMIN 错配、非法读写、错误 Kernel
pins 和 pool 清理失败。封存前需永久负测与真实隔离正向证据。

文档影响：本计划双语、模块合同、ownership／grant manifest、对应测试／指纹、
生成 schema、已有操作／证据双语文件。不重置 trusted base 或扩大无关 allowance。
未批准 #815、真实备份、企业 CA、生产操作、合并或发布。PR #824 保持 Draft；
这两项不能替代真实 startup 与完整 populated controller 验收。

本次从报告`1190ba591`续工，R3职责已实际分配：父协调者独占controller／journal、
根组合入口与全部执行；release分片独占handoff锁存活；runtime分片新增startup／
真实状态读取；recovery分片新增controlledRecovery adapter及测试。独立预审发现
历史重放早于当前核验、旧日志句柄覆盖新提交、跨run未知结果、锁进程死亡及停写后
resume身份不匹配。这些是实现缺口，不是外部环境依赖。P12/P13沿用既有ownership
与批准语义；unavailable常量本身不构成新增批准要求。不修改冻结grant或Policy决策。

第一组Red在`1190ba591`加测试后得到5通过、2失败：旧句柄覆盖新日志、接受符号链接。
首段修复在独占写锁内比较当前digest，使用独占临时文件、文件及目录fsync，拒绝不安全
日志文件；工作树journal／controller回归19/19。下一段实现跨进程／run的持久phase
intent与重放前真实目标核验；每项外部效果仍须在部署锁存活期间重新观察身份。
Documentation Impact：先同步本计划双语文件，实际adapter执行后更新既有运维及证据
双语文件。组件结果不代表完整升级或生产就绪。

初始开发base为`67d4a7732`，继承报告head为`1a9ba7745`；后续刷新发现纯文档
PR #823，origin/main为`cda6737a8f177a8bbd2f3bc7d195f8e3037bfa74`。
父阅读新增安全／测试规范，以`7218a43dcd5402d52b5e57166b746d0c6409642f`
追加合并，未改写已有提交或重标测试。独立M1备份仍基于`67d4a7732`，
源部署始终为`82344044…`。

M1 已完成精确四项旧依赖删除、永久重引入反例及独立 Standards／Spec 审查。
`ffc240498` 最终全量 scripts 为1301通过、1项source-lock超时、5跳过；boundary
通过。冻结源锁性能决策解决前仍为Scratch，未创建PR或执行Hosted。远端M1分支仅是备份，
不是发布批准。

M2所有权细化：`m2_runtime` 单独写追加0140迁移与治理读端口，父未修改该迁移；
`m2_release` 写S7精确转换manifest、S6管理导入和证据Archive能力，保留分类与不可变历史；
`m2_recovery` 写固定入口身份／私有输入保护及受控包恢复。父单独写Compose／Dockerfile／
ignore规则、根入口、生成文档和最终集成。父独立审查要求新reader角色拒绝既有未核验能力，
不能向治理writer授予宽泛Catalog／audit SELECT。

当前已集成报告动作绑定、受限登录启动、治理分池、正式定义精确映射／源指纹、源停止后仅
消费包恢复、首次handoff及Catalog Compose凭据／profile／外部卷配置。这些不等于M2闭环。
P2真实停写、阶段化resume、P12/P13 producer归属、退休后完整报告／runtime loader、
完整消费方与业务权限、浏览器／容量及根入口成功仍待完成。秘密必须置于候选构建上下文外；
`.dockerignore`防御不替代固定descriptor的私有输入校验。恢复包限制、企业网络与真实数据
证据独立记录。

## 续工：M1与M2

新preflight确认base `67d4a77325b6009b77c2373bd788298a6d022bcf`、继承报告head `1a9ba7745b6f4e0ba1e52aede3e0ee5fe1ab6016`，候选工作树干净。源部署不变。M1仅为可独立审阅的安全拦截；M2必须完成真实隔离升级成功链，二者分开。

父智能体负责M1 CLI／债务删除、固定入口交接、共享upgrade／Compose／migration、集成及交付。`m2_release`负责既有release-gate脚本及测试；`m2_runtime`负责运行连接／启动文件及测试；`m2_recovery`负责备份包恢复adapter及合成恢复测试。各自独立Scratch，父智能体串行集成；无人获准生产操作或扩大权限。

增量威胁审查：保留诊断absence与发布拒绝的区别；仅移除已证明无用的导入及四个精确债务ID，拒绝回引，保留冻结fixture／relocation／base；交接先绑定artifact／daemon／project／storage身份再产生效果；报告取真实状态；运行初始化先于所有队列效果且不修表；恢复只消费验证过的包及外部秘密输入，绑定目标，部分／未知结果停止。包验证须防文件替换、路径穿越及陈旧Redis AOF。此处补充下方矩阵。首个Red为继承boundary失败，随后在CLI诊断入口验证禁止加载退役模块。

文档影响：继续更新本双语计划、既有双语操作／证据文档及模块所属运行／恢复说明，不新增重复状态报告。内循环只跑focused；里程碑PR前完成build／contract／docs及独立审查。schema追加后旧值保留不等于canonical转换，sentinel RDB恢复不等于AOF部署形态恢复。

当前状态：SCRATCH，未完成。刷新后的base／候选、执行结果及boundary／发布阻塞见[执行证据](../../../../ops/self-hosted/populated-upgrade-evidence.zh-CN.md)。下段保留开工preflight记录。

PREFLIGHT，风险 R3。源部署始终为 `82344044b436a8dafecefbb85dfd724cecb05e3f`；重新 fetch 的开发基线为 `origin/main@1c9fa56e3eaca6e7984f35a097876772a6e4025d`，与用户提供的 main 无差异。源计数和镜像身份仅为用户提供的历史观察。本地独立干净工作树使用 `codex/populated-upgrade-scratch`。本轮止于审阅候选／PR，不合并、不关闭历史单、不批准发布、不访问生产。

最新代码候选 `21f5aa4a8bdbb7208504396bce62796cf55875da` 已有真实Binding
producer／import组件50/50、最终兼容／门禁63/63及build通过证据；恢复35/35
保留其自己的执行提交，不合并计数。根升级里程碑仍未完成。具体停写／恢复boundary、
journal adapter／reconciliation、分阶段handoff、runtime／public状态生成链、
完整业务／浏览器／容量仍由父协调者承担，缺真实备份不阻止这些独立开发。

三个决策独立保留：M1冻结source-lock测试的性能修订；独立0140提案新增的两项
governance EXECUTE；#815权威Policy引用计数或明确批准的unavailable契约。
没有默认批准。在既有 ownership 内实现 P12/P13 仍是父负责的内部工作，不能把
unavailable 常量本身当作外部决策。运行权限提案单独备份，未安装到本候选。
没有PR、Hosted或生产执行；手册提供已测试组件／检查命令，不编造根升级／生产命令。

## 文件所有权与依赖

### 2026-09-07 增量

父智能体继续实现，不把缺生产授权当作代码阻塞。父负责 controller 准入、S7 P4
接线及固定准备 pins、文档和实际测试；release lane 负责受控迁移／结构 receipt，
runtime lane 独立审查管理与 P4，recovery lane 独立审查 controller 跨 run 准入。
真实 PostgreSQL 测试使用独立集群，不共享集群级角色。

新增 R3 威胁：看似存活的失效宿主锁、文件／目录 fsync 结果未知、另一 run 未决的
Binding／管理 attempt、await 后输入被修改、search_path 重定向、冻结后新增表／列、
另一候选借用管理 receipt、ledger 未变但物理 schema／ACL 漂移、resume 跳过历史 P4
适用性。receipt 只证明实测准备，不批准发布；P4 绑定外层准备 run／plan 和候选
SHA／tree，避免与后生成的 S7 digest 循环依赖。

新增真实矩阵使用独立自有 `postgres:16-alpine`；pgvector Catalog lane 及必需 setup
保持原约束。恢复已加入两个 PG16 bootstrap 身份、原 MinIO 版本、AOF 和数据库属性
不支持时拒绝的真实三存储包测试。精确批次（含 setup 失败、零收集误调用）记入既有
双语证据，不能混加不同 SHA。

文档影响：本计划及中文伴随、既有操作／证据双语文件。终端组合根、全部源消费方
producer、既定 ownership 内的 P12/P13、完整新报告链、运行启动／pool、应用／浏览器
和容量验收仍由父负责，是内部开发缺口。真实备份、企业 CA／网络、生产授权及单独
记录的 Policy／权限决策是不同外部依赖；二者均不关闭 M2 或 OP-09。

| 包 | 所有者与范围 | 依赖与成功条件 |
| --- | --- | --- |
| A | 父协调者：双语计划、证据、操作手册 | 实现前冻结威胁矩阵，独立 Spec 挑战 |
| B | 父协调者：reconcile CLI、升级 shell、交接工具与测试 | 真实旧调用失败关闭；诊断不作为发布批准 |
| C | 父协调者：verifier/controller 接线 | B、角色与恢复合同；保留 unavailable 边界 |
| D | 身份／恢复 lane，先只读审计运行根与角色 | 编辑前明确交接；真实受限登录验证 |
| E | 身份／恢复 lane，先只读审计恢复模块 | 隔离三存储证据，不充当目标证据 |
| F | 构建 lane：build-network 专用工具与测试 | 复用现有策略，合成证书与企业 CA 分开 |
| G | 父协调者：预演、文档、完整文件交付包 | A-F；真实备份和生产批准为外部依赖 |

升级 shell、Compose、运行时组合根、migration、生成文档和 fingerprint 各由父协调者单一写入。保留其他工作树。共享 schema 开发 WIP 为 2；不重叠的构建工作可并行。固定候选后并行 Standards／Spec 审查；集成就绪后运行一次最终 Hosted，不反复跑广域测试。

## 威胁矩阵

### PR #824 续工

父协调者单写 runtime admission、API/worker 根入口及本计划双语文件；
独立 CI Scratch 负责恢复执行归属，独立只读 Spec 审查启动事实与权限。
刷新后 main 仍为 `cda6737a8`，head 为 `7fabeb8c4`。Hosted `34067803219`
实际执行 merge-ref `51ec49131ea542d499607021c20012ad1b39266c`：scripts
1427 通过、1 失败、39 跳过。失败为恢复执行器的 `pg_restore` 命中 S11-RP
合同，不是历史 source-lock 超时。本机同 selector 对照已复现候选失败、base 通过。

新增 R3 威胁：namespace 缺失绕过应用启动核验；报告反填当前状态；管理凭据
进入运行池；隔离启动提前消费业务；公开重启借用旧批准；初始化失败泄漏连接
或私有诊断。独立 Spec 已确认 namespace 与 worker 清理边界。
生产缺少 DATABASE_URL 已由 env 校验拒绝，不重新包装为新缺陷。

真实进程正向仍需 P12/P13/current-pin 的真实 producer 及获准 Catalog 读取能力。
当前集成都未具备。`0139` 报告只读权限不含 Catalog 读取，`0138` 明确以生产
Catalog SELECT 拒绝为负向合同。不得授予 synchronizer 或制造 passed 报告。
继续不依赖这些决定的初始化修复；能力及恢复执行归属变更需明确决定。
不放宽扫描、grant 或 timeout。文档影响为本计划及已有操作／证据双语文件。
Draft 仍是部分交付，本轮不授权生产操作。

| 威胁 | 必需观察／责任 |
| --- | --- |
| 缺参数、absent、未批准、blocked、未知参数 | 真实 CLI 非零 typed 拒绝，B |
| 旧升级器调用新检查 | 不因诊断成功恢复流量，B |
| 跨候选／目标／release／mapping／source、旧 purpose／attempt | 复用 verifier 精确核验，B/C |
| 预激活批准借用于运行或公开发布、伪造批准 | 各动作独立拒绝，C |
| apply/resume/recover-candidate/no-op 绕过 | 所有可达放流路径有门禁；旧服务恢复分开，B |
| 缺阶段、乱序、并发、未知提交结果 | journal／锁拒绝，不重置或猜测，C |
| 假 fresh、部分迁移成功、checksum 漂移 | 完整库存识别；历史 SQL 不变；重试证据，G |
| 超级用户、继承／DEFINER 提权 | 真实受限登录正向与反向 PG，D |
| 错数据库／主机／Compose／卷／桶／Redis、部分恢复 | 保持隔离，仅显式绑定恢复，E |
| 写入／投递／公开流量之后指针回退 | 持久拒绝，E |
| 不可信／过期／错误证书、insecure 就绪 | 拒绝；受信合成链成功且无秘密泄漏，F |
| 值／历史／受保护引用丢失、未知 Policy 被算零 | 全量分类与独立 oracle，不用计数相等替代，G |
| pgvector lane 被当成源数据库镜像兼容 | 单独扩展兼容证据，G |

## 测试层次与停止边界

先 Red 后 focused Green；真实子进程退出码、PG 迁移／角色、隔离 Compose 顺序、合成存量语义、build／contract／boundary／selfhost／docs。可见改动按 playwright-cli 三种视口验证。各次执行记录精确 SHA/tree、命令、退出码和收集／通过／失败／跳过，setup 失败不算零用例通过。A 合成、B 授权真实备份副本、C 生产分别记录。

尚无授权真实备份、企业 CA 或生产窗口批准。#815 仍需权威关联或明确批准 unavailable 合同。冻结阶段若 unavailable，记录缺失集成，不伪造实现或批准；继续独立工作。

## 文档影响矩阵

| 改动 | 英文 | 中文 | 门禁 |
| --- | --- | --- | --- |
| 范围／威胁／证据 | 英文计划 | 本计划 | docs:check |
| 升级／诊断／交接 | upgrade.md | upgrade.zh-CN.md | CLI 回归与 docs |
| 运维步骤 | 新存量升级 runbook | 中文终端手册 | 仅引用真实测试入口；缺失步骤明确标记 |
| 构建信任 | 现有构建文档按需更新 | 对应伴随文件 | 证书反例 |

## 文档更新门禁

双语同批更新，生成器更新生成产物。完成前运行 `npm run docs:check`；独立交付和限制记录完成前计划保持 active，代码完成不推出生产就绪。
