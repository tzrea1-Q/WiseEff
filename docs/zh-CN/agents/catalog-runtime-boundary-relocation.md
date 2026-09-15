# 运行时拓扑出现位置身份修复

> English: [English](../../agents/catalog-runtime-boundary-relocation.md)

## Post-cutover 测试身份跟进

独立接受的后续决定仅固定 `server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts` 中四处已审事务包装移动的 29 个出现位置身份。候选 `fc776086a9c163ec048a231133cc6292bbfbda8c` 的最终检查发现 29 new、29 stale，因此在发布前被拒绝。全部原测试断言和原始 SQL 切片保留，事务行为另行审查。这是明确的身份决定，不是对 SQL 整体等价或后续源码修改的许可。

[固定 29 对记录](../../../scripts/fixtures/parameter-catalog-allowlist/post-cutover-test-relocation.json) 的 SHA256 为 `9a68e55a93d17118275f71334dd5890ebdae5ad75582d6c9d590f6163134a647`，绑定历史 blob `765b2c38cddc76ddb0b242ee06215872f12c1897` 与目标 blob `3be455785b71abf93e0f600a979bd82098de4105`。独立 Standards、Spec 设计审查逐项核对了原始切片、元数据和完整 blob。原 23 对与 16 对记录不变；私有固定配置复用下述校验器，五份已登记记录的 131 个源端点和 131 个目标端点共 262 个均不重复，全部校验后才应用别名。完整文件漂移、不完整/篡改/交换/重复/跨记录身份及 allowance 增长均拒绝通过，不提供调用者自定义位移策略。

实现 `135a4edada7fcff307136496619813c2e6f66769`、tree `5388cb81093c3a2810331f757e14431343748219` 在相同三个定向文件通过 93 项测试，直接 checker 为 3513/3513 allowance、68 对 relocation，无 new/stale/growth/metadata 错误。新增契约先出现 1 项真实断言失败、25 项通过。build 和直接文档治理通过。原 3519 条 fixture 与六项移除未变。后端代码与独立审查的 `69fd38c152108f610786b269e9337e57f73a24bc` 逐字节相同，后者完整原有后端通过 4180/4180；这是单独绑定的既往证据，不冒充本提交重跑。最终代码审查与 Hosted 记入活跃计划检查点。

## 原运行时拓扑身份决定

本前置修复属于 [EFF Issue #828](https://github.com/tzrea1-Q/WiseEff/issues/828) 和[活跃效率计划](../exec-plans/active/2026-09-13-agent-delivery-efficiency.md)。用户授权继续 EFF 并解决阻塞；独立 Standards 与 Spec 在实现前接受了这 16 对已有出现位置的精确身份。此决定不批准 Catalog 运行时行为、就绪状态、冻结里程碑或目标操作。

在 accepted main `9dc751690a615b162bb41feef6392289b2ca7f6a`，边界检查发现 3513 处但仅识别 3497 处：PR #832 移动了 `server/modules/parameter-topology/ingestService.ts` 中 15 处已有 legacy 标识符及 `server/modules/parameter-topology/schemas.ts` 中 1 处 effective-view 字面量。原始切片和 allowance 元数据未变。周围错误处理行为确有变化，本记录不声明 SQL 或运行时等价。本修复保持业务源码逐字节不变。

原始 S0-ID fixture 仍为 `9b3ba7df7e21f5589684bc92c872da593ad4c246` 上的 3519 条；allowance 仍为 3513 条，保留此前六项移除。[独立固定记录](../../../scripts/fixtures/parameter-catalog-allowlist/runtime-topology-relocation.json) 的 SHA256 为 `7c99527e2473aac06b64fc3e3db892d1b866843a8092bf39c058bdc5e81afaa2`，绑定完整身份对、原 fixture 摘要、原始切片与完整源码 blob：

| 文件 | 历史 blob | 当前 blob |
| --- | --- | --- |
| `ingestService.ts` | `30e4e8107a7dbf11a0a4c81e9aab355f303e43f1` | `1f28235a496dfc57b649966b714588155eae982b` |
| `schemas.ts` | `4e10ae4b663012ac0fec7b611db828c508569555` | `d6669310903a9d00a8ce9b923e4fa9ec63f80ef2` |

原 fixture 完整性、显式 base 祖先关系和可信父版本增长检查先执行，[此前 23 对记录](catalog-boundary-relocation.md) 保持不变。新校验器在绑定身份前检查全部 16 对、完整 blob、位置、原始字节、实际扫描结果和原 allowance 元数据；所有已登记记录的源与目标 ID 分别全局唯一。报告使用同一 `relocations` 列表，准确呈现五份已登记记录的 23、16、29、4、59 对映射。不重新生成清单，不引入通用位移搜索、allowance 增长、补行、排除规则或 trusted-base 替换。

记录缺失、不完整、自改或损坏；身份交换或重复；allowance 变化；文件、blob 或位置错误；以及两个源码文件任意位置的 dirty/后续修改，均拒绝通过。新债务仍无 allowance。后续源码变化须消除债务或取得另一项独立审查的精确身份决定，不能编辑记录自我授权。Draft PR #824 是另一项 Knowledge Audit 提案，未来可能在 checker 集成/断言文件发生交集；本修复不修改或集成该工作。

main 上的本地 Red 为 16 new、16 stale。实现 `e31226b6cc06c2278230b810bb1becd8dbc1f32a` 的同一 checker 接受 3513/3513，new/stale/growth/metadata 错误均为零，呈现 39 对 relocation。三个定向文件通过 82 项测试。实际命令为 `npm run test:scripts -- scripts/parameter-catalog-allowlist/runtimeTopologyRelocation.test.ts scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts` 与 `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 9dc751690a615b162bb41feef6392289b2ca7f6a`。原完整 build 和直接文档治理通过；未运行本地 schema 验证。最终审查与 Hosted 证据记入后续计划检查点。

同一前置修复将 M1 浏览器证据读取移入原套件 `beforeAll`。缺少 M1 证据时，原生收集现可列出 39 个文件中的 196 项测试；单独执行 M1 仍因证据缺失而失败。57 个断言以及原测试、超时和运行时要求全部保留。恢复收集不等于 M1 或完整浏览器验收通过。回退采用经审查的修复提交 revert，会恢复已知 checker/收集失败，不改变业务源码。

## Issue #859 出现位置身份决定（第五份记录）

`#859`（“index DTS draft and writeback versions”）在三个 owner-path 文件中于既有 SQL 之上插入 import、带索引的版本列与辅助函数，移动了 59 处已被 allow-list 的 S12-TOP 出现位置，且未改变任何原始切片：`server/modules/parameter-topology/editService.ts` 26 处、`server/modules/parameter-topology/editService.test.ts` 28 处、`server/modules/parameter-topology/overlayWriteback.ts` 5 处。同一变更仅新增 1 处没有基线对应物的出现位置——`editService.test.ts` 中对 `project_parameter_bindings` 的裸读；该处改为返回 fixture 辅助函数已解析出的 logical node id，从而从源码中消除，而非加入 allow-list。

[固定 59 对记录](../../../scripts/fixtures/parameter-catalog-allowlist/edit-service-version-index-relocation.json) 的 SHA256 为 `9e99562ff8d649a75103682eff1890e7dc3a0439eb693d8caaff1153fa1b46da`，逐对绑定未变的 rule、token、evidence、column、完全相同的原始切片，以及完整源/目标 blob。它不授予任何新 allowance、不做跨文件搬运，也不改动 fixture、其摘要、十一个分片、trusted base 或此前保留的六项移除。将该记录视为已审查证据，仍以独立 Standards 与 Spec 对本固定记录的审查为前提。
