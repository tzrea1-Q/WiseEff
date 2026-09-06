# 存量升级候选证据

> English: [English](populated-upgrade-evidence.md)

## 身份与状态

采集日期2026-09-06，仅独立开发环境。源部署仍是 `82344044b436a8dafecefbb85dfd724cecb05e3f`；用户提供的历史镜像 ID 为 `sha256:be121540c40fbb35e774b48cefb29b7ddf27d1bb8aa0c050a17acca3b7dfbf6c`，不是 registry manifest，也不是本轮复核结果。最初开发 base 为 `1c9fa56e3eaca6e7984f35a097876772a6e4025d`；最终刷新 base 为 `67d4a77325b6009b77c2373bd788298a6d022bcf`，新增内容是纯文档 PR #822。

代码候选 `b2c150d18bb6d7a8d8d5b45bcbf9f683fdafecbf`，tree `b8eb49d3a074e00196fb89c30ba4d1cae3677b3c`，分支 `codex/populated-upgrade-candidate`。27个任务文件与保留的原 Scratch `d357a5e6538f4bac4d63ba782ce13f75fe1cf194` 逐字节一致。本报告属于后续文档提交，不重新标注旧执行。候选没有 CI checkout、merge-ref、最终merge SHA、正式 bundle/runtime pin、mapping/source冻结或获批真实目标。

| 交付状态 | 结论 |
| --- | --- |
| UPG-01缺上下文拒绝 | 已实现，真实CLI反例已验证 |
| 完整代码交付 | 未完成；仍有boundary回归和发布集成缺口 |
| 合成populated | 原schema及有界值／历史迁移通过；完整语义预演未完成 |
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
