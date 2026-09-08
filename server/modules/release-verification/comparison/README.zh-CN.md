# 实时比较证据

[English](README.md)

`liveEvidence.ts` 将既有十一类消费者的实时聚合与 Comparison 报告生成器
接入九个 S10 `PCAT-CMP-D01`–`D09` adapter。它不另建 verifier、批准服务
或 Catalog 转换器。

## 实现中的 P0 来源接线

`comparisonSource.ts` 将原停写 handoff、私有管理配置与真实 issued 宿主锁
接入同一个源事务。组合根提供原登记容器集合；实际端点校验仍逐项验证
owner 标签和网络成员。source-system 显式声明来自被固定的管理配置，
不能从比较报告复制。来源负责人采集已安装 0137 的完整来源身份与十一家
消费者库存。P0 登记使用既有管理事务和 journal attempt，严格复用完整 tuple，
INSERT 后重新核验；源租约将旧业务表锁保留到 P0 提交及宿主确认之后。

目前仅有数据库/传输替身及真实私有文件、宿主锁的定点测试。
原 populated-plan 转换与 Binding 族限制仍保留；完整来源计划、真实 P0 执行、
v2 provider/report/gate 和完整两 head 正向均未验证。MOD 仍沿原生产 reader
读取 schema 文件/缓存及已锁定的数据库行，不声称来源完全不依赖文件。
拟议的 MOD 数据库投影已隔离，等待精确 boundary 决定；未修改 allowance
或可信基线。

## 组合契约

每次实际 `runVerification` 调用创建一个
`createComparisonEvidenceExecution({ source })`。将其 adapters 装入既有
verifier；九个必需门禁全部结束后读取 `readEvidence()`，把其中的 typed
evidence references 与其他必需门禁的引用一起传给既有 `assembleReport`。
返回的 Comparison artifact 由父 controller 的证据存储保存。新的 attempt
必须新建 execution 并重新实时采集；本模块不跨 attempt 缓存。

`source` 是组合根安装的代码端口，不是 CLI JSON 选项。其 `withBoundary`
必须在回调及边界释放结束前持有真实目标与停写边界，并提供实际 `Database`、
pool 和 `observe` 函数。每次观察包含当前 `AggregationContext`、完整
`VerificationPins`、`VerificationSubject` 和 `VerificationLineage`。
source 负责人必须从真实目标产生这些事实，不能从 plan 或 report 复制。
缺失 source、状态漂移、采集失败和未知异常均以静态类型化诊断拒绝；保留
原有 corpus failure code，不包含贡献值或连接细节。

adapter 固定 plan 和前后两次观察的独立快照，比较完整 pins、subject 和
lineage，调用默认 providers 的 `aggregateLiveComparisonCorpus`，再调用
`generateComparisonReport`。仅原始 checksum 和完整通过覆盖均正确时才
发行证据。支持既有 fresh/populated 模式的预激活与 post-P13 比较阶段；
注册表规定的不适用状态保持不变，不把尚不支持的必需 purpose/mode 改名通过。

每个 envelope 使用既有 S10 digest codec 绑定 producer、短 gate ID、原始
comparison ID、Comparison checksum、S10 plan digest、purpose、subject、
phase 与完整 pins。artifact 身份为 `sha256:<Comparison checksum>`：
前缀标记原始 Comparison UTF-8/LF 字节摘要，不使用 S10 codec 重序列化后
冒充同一摘要。

P12 从正式 report projection 取得适用且获批的报告后，可调用
`assertComparisonEvidenceAssociation({ comparisonReport, verificationReport, subject })`。
该函数核对原始 artifact 与九个结果、typed references、evidence digests
的逐项唯一对应，返回 `{ comparisonReportDigest }`。它不证明报告批准、
principal 权限、时效或当前目标适用性；这些仍由既有 release action 和真实
状态 producer 负责。

## R3 边界与剩余 producer 工作

| 威胁 | 保留的边界 |
| --- | --- |
| 调用者传入通过的 artifact | 正式执行必须调用既有实时聚合器与生成器，无 provider override 或 report 输入 |
| 采集期间共享对象变化 | plan 与观察独立快照，第二次完整观察必须一致 |
| 跨 attempt 或目标复用 | 每 execution 每 gate 仅一次，核对完整 plan，新 execution 重新采集 |
| 替换 artifact 或 envelope | 原始 codec 校验与九个 producer/purpose/subject/phase/pin 精确关联 |
| 查询或锁失败变成空结果 | 类型化失败，不发行可用证据包 |
| 猜测 mapping 身份 | 不转换 mapping head/version/checksum 为 epoch/head digest |

真实组合根仍负责目标隔离以及 Catalog、mapping、source、lineage 的实际
关联事实。adapter 不推断 `catalogSnapshotChecksum` 等于某个 Catalog pin，
也不推断 `mappingHeadId`/`mappingHeadVersion`/`mappingHeadChecksum` 等于
`mappingArchive.mappingEpoch`/`headDigest`。合法 producer 必须根据既有
领域记录证明这些关联，并保留每条源记录的准确 mapping 与去向。

当前冻结的 contribution parser 要求每条 declared difference 的 mapping
head/version 等于所属 contribution，又要求所有 contribution 的该元组
等于 context。因此，两个实际按 identity 区分的 head 无法在同一个当前
context 中同时表示为不同元组。永久多 head 反例记录此限制；本分片不改
parser 或冻结 codec。全局 epoch 不能取代逐 case mapping 证据。真实完整
mapping 库存的关联与逐 case 证据保全仍是集成责任，不是已批准的语义捷径。

## 验证与文档影响

comparison P0 的管理连接现在在原 pool callback 内、回调返回前登记
`error`/`end` 监听，覆盖 S7、宿主 journal 的 await、借入源租约及连接释放。
连接丢失会拒绝继续派发 P0；丢弃的 native client 先完成 end 再 release，
调用者的 pool 仍由调用者持有。健康连接上的原未决 attempt 拒绝保持不变。
修复前四个生命周期反例失败；新增五例与原 23 个 source/inventory 用例
合计 28/28。测试使用真实 `pg.Client` 事件对象与 checkout/SQL 替身，
不证明真实 PostgreSQL LOGIN 或成功 P0。定向严格类型与原 trusted boundary
扫描通过；真实源/plan 及完整 v2 provider 调用链仍待完成。

`liveEvidence.test.ts` 使用合成 family contributions 和合成边界 source，
运行真实聚合器、parser 与报告生成器。报告关联夹具不是服务产生的获批报告。
测试覆盖九项关联、采集失败、漂移、重放、不可用 family 和多 head 限制；
不证明真实 PostgreSQL 消费者查询、真实批准、P12 apply、启动或完整 controller。

文档影响限于本模块独立中英文组合契约。controller 负责人维护主升级计划
和运维证据；本分片不修改冻结 schema、grant、consumer 或发布规则。
