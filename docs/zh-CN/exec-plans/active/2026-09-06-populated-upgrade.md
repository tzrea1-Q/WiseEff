# 存量 self-hosted 升级兼容修复

> English: [English](../../../exec-plans/active/2026-09-06-populated-upgrade.md)

## 范围与状态

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

四个决策独立保留：M1冻结source-lock测试的性能修订；独立0140提案新增的两项
governance EXECUTE；此前unavailable的P12/P13实现归属；#815权威Policy引用计数
或明确批准的unavailable契约。没有默认批准。运行权限提案单独备份，未安装到本候选。
没有PR、Hosted或生产执行；手册提供已测试组件／检查命令，不编造根升级／生产命令。

## 文件所有权与依赖

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
