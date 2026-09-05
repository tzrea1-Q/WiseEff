# Catalog 第二轮交付 — #814

> English: [English](../../../exec-plans/active/2026-09-05-catalog-r2-delivery.md)

## 目标与真实基线

完成 #815–#820 的代码及隔离非目标环境验收。禁止 OP-09/#811、#735 目标演练、P12–P15、生产数据修改、恢复、清理和切流；#668 冻结图不变。本轮没有确认实际合并审批，最多交付经过验证的候选/PR 待审批。这是用户授权的一轮工作，没有新建自动续行 Goal，也没有承诺截止时间；独立审查、集成和 Hosted 是不可省略的顺序阶段。

本次 fetch 接受的 `origin/main` 与初始 checkout 均为 `35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`，tree 为 `6b634836083bdb2c3b54b01d0fa6acf006bd3085`。初始隔离工作树 detached 且干净。另一工作树 `/Users/tzrea1/Develop/WiseEff` 在 `docs/catalog-repair-status@475695fb9bea1b60ecb1304544aa3b7fe96106f8`，本轮不修改。

已读取 #814–#820、#802 的正文、评论和状态。新单全部 open、needs-triage、未分配；原生 blocked_by 均为空，正文依赖仍有效。当前 GitHub 身份实际具有 triage/maintain/admin 权限，工具权限不能替代就绪审查及合并批准。

PR #812 已合并；历史最终候选为 `da52f6d5b7e328d0302cd3b2cbde0ca75db2373a`，正文包含不同早期 SHA 的证据。PR #813 仍 open、无 review，是本次观察到的唯一 open PR。“第一、二层已落地”不能证明本轮剩余验收完成。历史 CI 33955890889 的 local non-HDC 与 target synthetic 为 skipped；本轮未将其记为新证据。

## 反例与工作包状态

| Issue | 协议风险 | 状态 | 观察到的缺陷或缺口 | 最终前置 |
| --- | --- | --- | --- | --- |
| #815 | R2；授权变更按 R3 | PREFLIGHT | usage 固定 Policy 0，port 缺字段补零；权威映射调查中 | 真实契约或获批替代方案 |
| #816 | R2；授权/事务按 R3 | PREFLIGHT | handler/port 每对象查询；合法 page limit 100 | #815 契约交接 |
| #817 | R3 | PREFLIGHT | mock 先校验当前 ETag 再重放，固定 etag-p2，迁移守卫缺失；HTTP 响应丢失 base/content | 独立挑战 threat matrix |
| #818 | R3 | PREFLIGHT | guest 被称为 Agent；perception pin/readiness 占位阻断真实正向读 | 独立挑战 threat matrix |
| #819 | R3 | PREFLIGHT | fulfill 409 和初始 parity 不能证明后端冲突/操作一致 | #817、#818 交接；完整候选含 #815/#816 |
| #820 | R2；来源封存按 R3 | PREFLIGHT | 开始维护框架，最终门禁尚未执行 | #815–#819 集成 |

上表不表示 implemented、verified、merged 或 attested。三位只读 preflight 智能体分别调查 Policy/批量、Proposal、Agent/冲突；父协调者维护计划、环境、证据及集成。生产编辑前冻结精确路径；R3 矩阵由另一位 Spec 智能体挑战。

## 文件所有权、依赖与预算

### Preflight 决策与限定交接

#815 阶段性 unavailable 方案已请求用户决策，目前没有收到批准，也没有实现替代契约。证据来自 `CONTEXT.md:116`、TD-055、`0048_parameter_topology_schema_shadow.sql:66` 和 `0137_canonical_parameter_catalog_schema.sql` 的精确映射约束；不存在 Policy 生产 writer。这是本轮功能/验收阻塞，不是 OP-09 依赖。

独立 Spec `policy_preflight` 在生产修复前提出 P1 finding。#817 修订包括历史快照缺失/残缺时 `503 SERVICE_UNAVAILABLE / proposal-replay-unavailable / retryable:false`，两个合法 principal 共 key、完整不可变 DTO、终态与角色撤销。未提供 reason 时必须保留旧 fingerprint 字节；提供 reason 时属于请求语义。#818 保留现有 Agent 项目 binding 权限，观测真实 SSE/tool-result 与持久审计，不将未知工具一律当 HTTP 403；正向 oracle 为 current=C 时读取 Binding/value=1842 的 A pin，不拆约束伪造缺值。

Spec 已对 #817 mock 快照/ETag、随后 DTO/历史/权限片给出限定 THREAT-READY；#818 六条真实入口用例（3 条范围拒绝通过、3 条正向读失败）支持限定读取片 THREAT-READY。均不是整单验收 PASS。协调者完成这轮审查后实际更新 #817/#818 readiness 与 assignee，其余验收仍必须执行。

| Writer | 精确可编辑范围 | 只读/交接 |
| --- | --- | --- |
| 父 #816 Subject 片 | `server/modules/parameter-catalog-api/read/{types,ports,handlers}.ts`、`ports.batch.test.ts`；`server/modules/parameter-catalog-api/rootBatchQueries.integration.test.ts` | usage/Definition 等 #815；不改 productionWire 或权限 |
| #817 `codex/catalog-r2-817` | `src/application/parameter-catalog/{mockAdapter,authority}.ts`、新增 `proposalContractVectors.ts`/`proposalContract.test.ts`、直接测试；`src/app/appRuntime.ts`；`server/modules/parameter-governance/proposals/{command,result,writer,repositories}.ts` 及实际 failure 映射；`queries/proposals.ts`；Catalog API `governance/{dto,handlers,errors}.ts` 和新增 `proposalAdapterParity.integration.test.ts`；`vitest.server.config.ts` 别名 | DTO reason 枚举与生成 OpenAPI 暂由 #817 独占，#815 写入前按 SHA 交接；usage/browser 只读 |
| #818 `codex/catalog-r2-818` | `server/modules/agent/tools/perceptionTools.ts` 及测试；新增 `server/modules/agent/xiaoze/catalogBoundary.integration.test.ts`；新增 Binding `adapters/projectReadAdapter.ts` 及集成测试、`adapters/index.ts` | Auth/registry/orchestrator/Kernel 只读；guest helper 改名另提交后按 SHA 交给 #819 |

两子分支均从 accepted main 在独立工作树开始，模型继承。测试 Red 在生产编辑前实际运行。#817 API 13 collected/10 passed/3 failed、mock 11 collected/9 passed/2 failed，#818 6 collected/3 passed/3 failed，均为未提交树上的 Red 证据，不是最终候选通过。原始证据位于各 lane ignored work 目录，最后整理脱敏交付包。

#816 Subject Red：1/25/100 行的业务 SELECT 为 4/76/301，auth 均 1、Kernel 均 15、事务语句 8/56/206。125 Subject/250 Definition 经正式安装器生成。事先审查预算固定为业务 SELECT 4（prefilter 1+页投影 3），空页仅 prefilter 1。第一轮 focused Green 为 6 文件/21 passed；正在补缺结果、稳定 ID、空集合、故障用例及原始测量文件后再验证本片。单样本耗时不当作容量 p50/p95 或生产 SLO。

同一文件只允许一个写入者。父协调者初始仅写本计划、中英文配套及 ignored `work/catalog-r2/` 新证据。#802 历史计划和 PR #813 只读。禁止修改历史迁移、放宽 ratchet、执行目标/生产操作或修改相邻无关代码。DTO/OpenAPI、mock fixture、read ports、productionWire、浏览器 helper 必须按 SHA 顺序交接。

共享契约场景开发 WIP 最多 2；只读 preflight 可 3 路并行。进入封存审查前释放实现槽，留给独立 Standards/Spec 两位 reviewer。模型继承当前默认，不声称覆盖成功。合并/Hosted WIP 为 1，目标为一轮 seal/review/Hosted；字节改变使旧 seal 失效，finding 返回 Scratch。内部循环不跑全量，不在同一树重复完整验证。

## Threat matrix 与验收所有权

R3 实现前，每行必须定义初始状态、principal/组织/项目、请求、HTTP/业务/审计预期、可执行测试或明确缺口、证据 owner。涵盖成功、旧条件/并发、完全相同重放、同 key 改语义、已提交丢响应、回滚、伪造、跨域、终态及快照不可变。由独立 Spec 挑战后才开始生产修复。最终 Standards/Spec 在相同 base/head 独立审查，父协调者收齐并去重后统一返修。

| Finding / Issue | 既有 ID 与本轮别名 | 真实测试位置/层级 | Owner |
| --- | --- | --- | --- |
| Policy / #815 | CATFIX-QUERY；R2-POL-01..07 | server/modules/parameter-bindings/usage；待冻结的 Policy 公开边界测试；根 HTTP 列表/详情/页面 | Policy |
| 批量 / #816 | CATFIX-QUERY-10；CATFIX-POOL；R2-BATCH-01..07 | server/modules/parameter-catalog-api 与 catalog-kernel/runtime；新增真实根路由 SQL 测量 | 批量 |
| Proposal / #817 | CATFIX-PROP；PCAT-UI-13；R2-PROP-01..09 | src/application/parameter-catalog/mockAdapter 测试及同向量真实 adapter→HTTP→PG | Proposal |
| Agent / #818 | PCAT-UI-12；PCAT-AGENT-READONLY-001；R2-AGT-01..07 | 真实认证 Agent endpoint/registry/dispatcher/PG，仅 provider 确定化；guest 单独浏览器 | Agent |
| 冲突/parity / #819 | PCAT-UI-10/13/15；PCAT-CONFLICT-RECONFIRM-001；PCAT-ADAPTER-PARITY-001；R2-E2E-01..08 | parameter-catalog-negative.acceptance.spec.ts、governance spec；#818 交接后 helpers | 浏览器 |
| 最终集成 / #820 | 上述所有 ID；PCAT-UI-01..15 | 三份 Catalog spec、广域门禁、容量、精确候选审查与 CI | 父协调者 |

新增测试路径和用例名必须在标 pass 前补齐。不得删除、重编号、重复 marker 或降低 mandatory 来制造覆盖。测试 oracle 独立声明。

## 环境与证据

实际 Node v22.22.3、npm 10.9.8、playwright-cli 0.1.14；`npm ci` 安装 1640 packages 成功。专用 `wiseeff-g668-pg` 为 pgvector/pgvector:pg16，loopback 55438。其他容器/数据库不作为本轮证据，也不清理。按实际 Issue provision/doctor，从成功输出配置环境；URL 仅存 ignored、0600 私密文件，交付包排除。角色 canary 必须实际执行。

环境原始脱敏日志生成于 `work/catalog-r2/evidence/lane-820-provision.json` 和 `lane-820-doctor.json`。每条测试记录包含 finding/issue/requirement、文件/用例、base/candidate/checkout/tree、环境/夹具/身份 scope、命令、起止时间、退出码、collected/passed/failed/skipped、层级、原始产物、reviewer 与处置。static、pure/mock、real-PG、root-HTTP、browser-real、Hosted、target 分开。missing-env、zero-tests、mandatory skipped、not-run 均不能算通过。

测量前预算：1/25/100 行的业务投影 SQL 必须固定，与 auth、Kernel、事务分开；精确数量等待 Policy 契约和已有查询盘点后冻结。空页不查询页级投影。不增加全局缓存、pool 或 timeout 隐藏问题。容量采样覆盖小/代表/增长库存、current/pinned、第一页/后续页、注册过滤/详情，记录分布、page size、pool/并发、warm/cold、样本/预热、SQL、waiting、p50/p95 及可用内存指标；未测项写 unavailable。不允许挂起、泄漏、混版、跨组织污染，不虚构延迟 SLO。

## Git & PR Workflow

父 Scratch：当前隔离工作树 `codex/catalog-r2-integration`，来自真实 accepted main。子 Scratch 从相同 main 在独立 worktree 开始，仅父智能体集成提交。建议串行顺序 #815→#816→#817→#818→#819→#820，调整必须记录真实依赖理由。子智能体不开 PR、不写 main、不关闭 issue、不派下游。PR 使用 Refs #814/子单，最终独立审查及 integration-ready 后才创建。合并与关闭需要实际审批及 merge attestation。

focused 使用当前 package.json 中真实路径和实际 issue lane。完整候选执行 `test:all`、`build`、`lint`（仅 src）、`contract:check`、`ui:check`、`docs:check`、`acceptance:coverage`、`acceptance:operations`、`acceptance:models`、`git diff --check`。边界命令为 `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`，执行前核对 scanner 的可信基线规则，不换成 HEAD 隐藏新增违规。尚无批准的 Hosted 命令替代。

浏览器执行三份 Catalog `acceptance:e2e`、`acceptance:gate0`、`acceptance:artifacts:check`，并用 playwright-cli 验证 1440×900、768×1024、390×844 的 snapshot/screenshot、键盘/焦点/弹层/滚动、console/network。最终产物绑定实际候选；当前尚未运行。

## 文档影响矩阵

| 范围 | 状态 | 路径 | 处置 |
| --- | --- | --- | --- |
| 仓库地图 | Review | AGENTS.md；ARCHITECTURE.md；docs/README.md；docs/zh-CN/root/AGENTS.md；docs/zh-CN/root/ARCHITECTURE.md；docs/zh-CN/README.md | 模块地图不变则保留 |
| 计划 | Update | 本文件；英文配套；docs/PLANS.md；docs/zh-CN/PLANS.md | 独立本轮记录，不改写历史 |
| 产品 | Review | docs/product-specs/product-spec.md；prototype-functional-spec.md 及中文配套 | 未授权产品重设计 |
| 架构/API | Review | docs/design-docs/parameter-catalog-api-transition.md；catalog-kernel-interface-and-transaction-boundary.md 及中文配套 | 契约实际变化时同步 |
| 质量/覆盖 | Update | e2e/acceptance/requirements.ts；operationMatrix.ts；docs/developer/browser-acceptance-coverage-map.md；user-operation-coverage-matrix.md 及中文配套 | 可执行证据后由父更新，保留 ID |
| 可靠性/运维 | No change | docs/RELIABILITY.md；docs/runbooks/README.md 及中文配套 | 目标操作排除 |
| 安全/领域 | Review | docs/SECURITY.md；CONTEXT.md；docs/security/README.md 及已有中文配套 | 仅澄清已证明边界 |
| 前端/设计 | Review | docs/FRONTEND.md；docs/zh-CN/frontend.md；docs/design-docs/ui-design-system.md；docs/developer/ui-quality-checklist.md | 最小相关状态/adapter 变化 |
| 生成文件 | Review | docs/generated/openapi.json；db-schema.md | 契约/schema 实际变化才生成 |
| 参考 | Review | docs/references/productization-api-contract-draft.md；docs/developer/verification-matrix.md 及中文配套 | 不虚构命令等价性 |

## 文档更新门禁

完成前逐条记录 Update/Review 的改动路径或明确无变化依据。中英分离双向链接；coverage/OpenAPI 使用实际生成器并检查 diff。`npm run docs:check` 必须通过。R2 必需证据未齐保持 active；OP-09 独立待授权。向用户提供保留目录结构的完整修改代码文件包和路径清单，排除凭据及无关文件。
