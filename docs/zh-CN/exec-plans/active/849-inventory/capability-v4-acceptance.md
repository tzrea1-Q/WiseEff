# T1.2 catalog-capability/v4 — 本地实现回执

> English: [English](../../../../exec-plans/active/849-inventory/capability-v4-acceptance.md)

状态：**T1.2 本地候选完成。** 独立设计 Spec PASS，随后实现 Standards PASS 与 Spec PASS（grok-4.6；要求的 gpt-5.6-luna 不可用）。不执行正式 SEALED、commit、PR、合并、Hosted、目标环境或 Issue 更新。

契约：[威胁矩阵](capability-v4-threat-matrix.md)、[设计](capability-v4-design.md)、ADR-0046、ADR-0016、#849／#853 T1.2。

## 候选

- 工作树：`/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- 分支：`codex/849-853-t11-source-identity`
- HEAD（未改）：`f9c710f6a90d67462965a06abd47e33aa200e75e`
- 已接受 main：`46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1 仍是未提交脏工作。T1.2 是同一树上的额外脏／未跟踪改动。无 commit。

## 已交付行为

1. 当前能力修订为 `catalog-capability/v4`。冻结的 `CATALOG_CAPABILITY_V3_ALLOW_LIST` 保持 v3 数组原义（无嵌套数组，数组上无 `minItems`／`description`）。
2. v4 准入递归数组、mixed item `{description}`、数组级 `description`、元数据 `minItems`／`maxItems`，预算为深度 4／256 个容器节点／`maxItemsBound` 4096。未知关键词失败关闭。
3. `gpio_int` 厂商 YAML 字节不变。`foldConstraints` 把 `cells: 3` 与 `description` 映射为嵌套数组（外层组数不受约束，内层 `minItems=maxItems=3`，items 为 `{description:"mixed"}`）。标量上的 `cells` 仍为 `cells-require-array-or-mixed`。
4. `charging_core` 已列入 NodeType YAML（`nodename-charging-core.yaml`）。D1 与生产导入器发出 `node-type:charging_core`，与 `driver:huawei,charging_core` 不同。嵌套属性 schema 没有从示例推导的基数。
5. Installer：`verifyAuthorizationForActivation` 按精确集合成员关系准入候选 `capability_contract.revision`。编译后、materialize 前用消费者 allow-list 遍历每个定义 schema。新原因 `unsupported-consumer-capability-revision`。冻结 v3 注入只存在于 `installPublishedReleaseForTests`。
6. D1 厂商后继 digest 现为 `sha256:3d5c70fb5e0aad4bb7c3c063ca3283a81fb39ec25c471669a0500dd410a48f97`（49 subjects／116 definitions）。`ops/self-hosted/upgrade.md` 运维 pin 已更新。
7. 种子对账：gpio_int 不再是 blocker。因 charging_core 两个属性，厂商输入为 115（原 113）。计划 124／372 绑定不变；T1.3 必须把这两个厂商属性与两个 DTS 兼容 locator 合并，而不是增加绑定。

## 验证（不可相加）

Helper PostgreSQL：端口 55438，一次性数据库 `wiseeff_t12_capv4`（不是 `wiseeff_lane_849`）。持久 lane 未动。

| 命令 | 结果 |
| --- | --- |
| `test:server` capabilities + runtime capabilities + vendorAdapter + completeSuccessor | 4 文件，**57 passed**／0 failed／0 skipped |
| `test:server` capabilityV4.integration | **2/2 passed**（online-publication v3 写入前拒绝 + 生产 NodeType 安装；冻结 v3 对嵌套数组厂商后继的 advance 拒绝） |
| `test:server` vendorSuccessor.integration | **1/1 passed**（116 个属性键；华为 Driver 与 charging_core NodeType 并存） |
| `test:server` onlinePublication.integration | **14/14 passed** |
| `test:server` authorization.integration | **15/15 passed** |
| `test:server` nodeTypeSubjectBinding.integration | **1/1 passed** |
| `test:server` failures + parameterCatalog DTO | **18 passed** |
| `test:scripts` compile-vendor-catalog-release | **3/3 passed** |
| `test:scripts` seed-reconciliation-manifest | **14/14 passed** |
| `test:scripts` check-contract-schemas + install-catalog-release | **10/10 passed** |
| `npm test` parameterCatalogClient + publicationState | **24/24 passed** |
| `seed:reconcile:check` | 当前 |
| `contract:check` | OpenAPI 当前 |
| `docs:check` | 通过，含 helper 库上的 pgvector schema 比较 |
| `git diff --check` | 通过 |
| `npm run build` | 见完成报告 |

不是完整 `test:server` 套件。不是 S1／S2、Hosted 或目标。T1.1 的 171 文件结果不是本候选。

## 剩余限制

- 生产导入器上的完整厂商后继仍会碰到 `maxChangeSetOps` 32；那是 T1.3。
- 种子清单守恒为 127 项输入；T1.3 绑定计划仍是 124×3。
- 无 commit／PR／seal。
