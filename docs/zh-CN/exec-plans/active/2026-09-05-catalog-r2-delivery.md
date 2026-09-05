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

## 已观测集成检查点

上表为历史 preflight。Subject 批量、Agent 读取和 Proposal 已集成至 `1009ecbfb28dea6f867f09fa13fa17709bdf40e5`，仍是 Scratch，未 seal，未达到 integration-ready。#815 等待已提出的产品决策；Definition/usage 批量和完整容量证据未完成。

| 分片 | 精确来源 / 父集成 | 实际证据 | 剩余门禁 |
| --- | --- | --- | --- |
| #816 Subject | `b26067e72accee2249a5f75a609c7cd730184a2c` | 精确提交 7 文件 / 25 测试通过；根 HTTP 的 1/25/100 行业务 SQL 为 4/4/4，空页投影零；auth 1、Kernel 15、事务 8、未分类 0、waiting 0 | Definition/usage、filter/cursor/隔离矩阵、容量分布 |
| #817 Proposal | 子 `143fe6736a331fd88ed455744647cb689fd705c4`、`389e58727c4ae60e306ae06cf317316f8cad1f50`；父 `bd05961ad`、`1009ecbfb` | 精确最终子提交：server 12 文件 / 106 测试、frontend 11 文件 / 92 测试通过；build、contract check、appRuntime 窄 lint 通过 | 集成检查、独立审查、浏览器操作轨迹 |
| #818 Agent | guest `835700cdc1c0e60c176907e19cc75e1ca097ea72`；子读 `773545fc4be7c7402c2335efb50f8eda87297e36`；父 `3ebe49d9d`、`425cc0864` | 子分支 17 条根 HTTP/PG + 8 单测及精确 build 通过；User-invocation 变异选中 1 条并失败，其余 16 条过滤，不算通过套件 | source-backed Binding 批准成功/重复确认、缺失/不一致补充证据、浏览器 |
| #819 浏览器 | guest 与 Proposal 顺序交接 | 真实 local-login A/B：B submit 200，A 旧 ETag withdraw 409，业务/成功审计无变化，输入保留；刷新未重新加载 submitted，实际 Red | UI 修复、提交后丢响应重放、操作 parity、三视口 |

父提交 `e1fa24376a83e24505f25e5b006176970ac03cd0` 只删除 6 条已失效 Agent SQL allowance，无新增。对 accepted base 扫描通过：3513 处 violation 全部已 allowlist，stale/mismatch/growth 均为零；不能自动外推后续字节。

manual disposable 清理调用未定义的 `stopRuntime`，已记录为环境缺陷；#819 使用既有 tracked nested manifest 路径。父匹配 PID、启动身份及工作树命令后，用既有 stop helper 仅停止本轮泄漏的 #819 API 进程组。数据库/对象目录保留，未停止共享或目标进程。原始证据：`work/catalog-r2/evidence/owned-819-process-takeover.json`。

Standards/Spec 在同一 accepted base/检查点独立审查。本节不声称 review PASS、PR、Hosted、merge、attestation 或关闭 issue。额外一次清理设计咨询因模型容量失败，没有结论；#812/#813 历史证据不能替代缺失门禁。

对 `1009ecbfb` 的两份独立审查均返回 finding，不是 PASS。统一返修包保留原编号：R2-REV-01 = STD-01/SPEC-01（mock 接受无效 Proposal base）；R2-REV-02 = STD-02（空 kind 的 mutation 与 GET/list 不一致）；R2-REV-03 = SPEC-02（evidenceRefs 省略与 [] 的重放不一致）。收齐后一次交给 Proposal owner。原报告：`work/catalog-r2/reviews/standards.md`、`spec.md`。

后续精确 `89904eb1a445f4143482e5fa586962f12578f48a` 集成 focused：server 43 文件 / 261 测试通过；frontend 12 文件通过、1 失败，105 测试通过、1 失败，根因为旧测试要求普通 User 创建 Proposal，与 API 权限表不符。父 `4da0c44cbea5fa571a25f75466cc52865e28663b` 改为断言无创建入口，单文件 12 测试通过；不是全量通过。

在 `4da0c44cb` 加明确记录的临时只读探针，实测 Definition 的 N+1 仍存在：1/25/100 行业务查询 5/101/401，事务 10/106/406，auth 1、Kernel 15、未分类 0、waiting 0。预设五查询预算下，4 条测试中 2 通过、2 失败。探针源码与原始 SQL 保留在 `work/catalog-r2/evidence/definition-budget-red/`，采集后移除临时测试文件。单样本耗时不算容量分位值。Definition 批量继续等待 #815 usage 契约，不转移至 OP-09。

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

### Subject 临时容量观测

实测来源为 `5b4118ae5f1bfb2964f425722e409854ba662d03` 加保留的只读测量探针，不是最终集成候选。三个独立安装器生成的合成库存分别为 25/125/500 Subject，每个含两个 Definition，均未登记；只测 current 的 Subject 第一页。pool max 实测默认 10、请求并发 1，每个 limit 预热 2 次、warm 样本 20 次，下表采用 nearest-rank 分位数。同主机还有其他隔离 lane 活动。未添加或清空缓存，业务查询预算事先固定为四条。

| Subject / Definition | Limit（实际返回） | p50 ms | p95 ms |
| --- | --- | --- | --- |
| 25 / 50 | 1（1） | 11.88 | 14.34 |
| 25 / 50 | 25（25） | 10.92 | 14.20 |
| 25 / 50 | 100（25） | 10.57 | 13.45 |
| 125 / 250 | 1（1） | 22.85 | 26.13 |
| 125 / 250 | 25（25） | 23.11 | 25.49 |
| 125 / 250 | 100（100） | 22.36 | 25.29 |
| 500 / 1000 | 1（1） | 82.98 | 91.51 |
| 500 / 1000 | 25（25） | 76.87 | 81.89 |
| 500 / 1000 | 100（100） | 75.37 | 80.36 |

所有组的业务/auth/Kernel/事务查询数均为 4/1/15/8，响应后 waitingCount 为 0、total connection 为 1、idle connection 为 1。三次分别收集并通过 64 测试，无 skipped。原始 JSON 记录实际 RSS/heap，属于同进程测试 worker/API，不冒充独立生产进程。disk-cold、连接等待时长、生产代表性、pinned/后续页、登记过滤、详情及更高并发均 unavailable，不推出毫秒级 SLO。这不满足 #820 完整容量门禁。探针、起止时刻、SQL、内存与未取整摘要：`work/catalog-r2/evidence/subject-capacity-checkpoint/`。

## Git & PR Workflow

父 Scratch：当前隔离工作树 `codex/catalog-r2-integration`，来自真实 accepted main。子 Scratch 从相同 main 在独立 worktree 开始，仅父智能体集成提交。建议串行顺序 #815→#816→#817→#818→#819→#820，调整必须记录真实依赖理由。子智能体不开 PR、不写 main、不关闭 issue、不派下游。PR 使用 Refs #814/子单，最终独立审查及 integration-ready 后才创建。合并与关闭需要实际审批及 merge attestation。

focused 使用当前 package.json 中真实路径和实际 issue lane。完整候选执行 `test:all`、`build`、`lint`（仅 src）、`contract:check`、`ui:check`、`docs:check`、`acceptance:coverage`、`acceptance:operations`、`acceptance:models`、`git diff --check`。边界命令为 `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`，执行前核对 scanner 的可信基线规则，不换成 HEAD 隐藏新增违规。尚无批准的 Hosted 命令替代。

浏览器执行三份 Catalog `acceptance:e2e`、`acceptance:gate0`、`acceptance:artifacts:check`，并用 playwright-cli 验证 1440×900、768×1024、390×844 的 snapshot/screenshot、键盘/焦点/弹层/滚动、console/network。初始预检时尚未运行；以下检查点更新实际执行状态。

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

## 已验证的 Scratch 检查点：2026-09-06 Asia/Shanghai

代码候选为 `b54a126b594effe5470f7df4c8b4d0458abc14c6`，tree 为 `c51651772664dfdc91e68673e67027a8dc3ed8be`。再次 fetch 后 accepted base 仍为 `35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`。后续纯报告提交不改变历史执行 SHA 的归属。本候选未 sealed、未 integration-ready、未 Hosted、未合并、未 attested。没有关闭 R2 issue；#813 仍是实际观察到的唯一开放 PR，其历史表述不能代替本轮证据。

| Issue | implemented | verified | merged / attested | 剩余阻塞 |
| --- | --- | --- | --- | --- |
| #815 | 否 | 已调查模型缺口 | 否 / 否 | 没有可证明完整的 Policy→canonical Definition 关联及生产 Policy writer；分阶段 unavailable 契约尚未获批，固定零仍存在。 |
| #816 | 仅 Subject 页 | 真实根路由 SQL 预算及批量/空集/缺失/故障 | 否 / 否 | Definition/usage 仍逐行增长，依赖 #815。 |
| #817 | 是 | 共用真实 API/PG 与产品 mock 向量、集成服务端和浏览器 | 否 / 否 | 最终集成门禁和批准未齐。 |
| #818 | 真实 Agent pin 读取及经批准的 Binding 工作流修复 | 18 条真实 HTTP/PG Agent；仅模型提供商确定性替代；另有 23 条真实 PG 身份测试 | 否 / 否 | T5 adapter-disagreement/missing-current-pointer 补充证据仍缺；边界门禁见下文。 |
| #819 | Proposal 刷新/重确认、真实冲突/重放/parity 和夹具修正 | 代码候选三份 Catalog spec 共 21 通过，无失败/跳过 | 否 / 否 | 完整候选仍缺 #815/#816 和完整 Gate 0。 |
| #820 | 计划、映射、初步容量、独立审查及产物框架 | 部分，结果分 SHA 如下 | 否 / 否 | Policy 决策、Definition 批量/容量、T5、扫描位置重定位、广域门禁失败。 |

### 根因、文件所有权与永久回归

- #816：正式 Subject handler 原先逐行投影。`read/types.ts`、`read/ports.ts`、`read/handlers.ts` 在授权/业务筛选和 Kernel 分页后，对本页 ID 去重并批量映射必要结果。`rootBatchQueries.integration.test.ts` 实测根路由 SQL，`read/ports.batch.test.ts` 验证缺失、故障和空页语义。Definition 明确未修复。
- #817：可变重放结果、先检查已推进 ETag、固定 mock 版本破坏请求身份与历史。Proposal command/writer/repositories/result/query 和 HTTP DTO 保存首次成功快照；mockAdapter 具有新 opaque ETag、状态/作者/审核权限和不可变结果。`proposalContractVectors.ts`、`proposalContract.test.ts`、`proposalAdapterParity.integration.test.ts` 覆盖生命周期、重放、key 语义、并发、权限、终态和副作用唯一。历史缺快照返回 `proposal-replay-unavailable`，不补当前可变对象。
- #818：perception 伪造空结果且未真实读取 pin。Binding 所有的 `adapters/projectReadAdapter.ts` 读取实际受保护引用，Agent perception 使用可信 invocation。`xiaoze/catalogBoundary.integration.test.ts` 经过本地认证、真实 orchestrator/registry/dispatcher、PG、pin 与高权限发起者的 Agent 限制。T6 暴露语义绝对路径与结构相对路径差异。`sensitiveNode.ts` 只在锁定范围/版本内接受两种严格校验的完整表示，零行或多行均拒绝。独立作者的 `sensitiveNode.identity.integration.test.ts` 用真实 PG 覆盖两种表示、根、重复、外组织/current、兄弟及畸形路径；基线 Red 为 14 失败/9 通过，候选 Green 为 23/23。`propertyKeyCutover.integration.test.ts` 重复 charger 夹具改为更新已有身份，未删除 critical/审计断言。
- #819：`ProposalPanel.tsx` 和 `CatalogOrganizationSurface.tsx` 刷新 Proposal/release 证据、清除旧确认并保留输入，新写入必须再次显式确认。`catalogConcurrency.ts` 证明真实 A/B 旧 ETag、真实安装器 drift、提交后响应阶段故障重放和浏览器操作 parity。共享文件从 #818 的 guest-only `835700c` 交接，经父集成 `ee60c5a1d`，再有 `116273025`、`c1032d730` 和当前候选修复。主 Catalog spec 残留 guest/Agent 错名已改。`catalogEvidence.ts` 创建真实 platform-only 审核用户；bearer 可选组织参数由生产 verifier 测试，claims 不授予权限。停止 owned server 前页面先脱离。lane guard 保留 loopback/端口/数据库/所有权检查，并拒绝 query/fragment 重定向。

额外路径均通过对应独立 threat/readiness 审查后交接：sensitiveNode 及测试、精确重复夹具修复、新身份测试（Scratch `aa6b603`）、Catalog 浏览器夹具/spec、`bearerAuth.ts` 的兼容组织参数及 `scripts/catalog-bearer-auth.test.ts`。审查者未写父生产文件；实现子智能体未开 PR、合并、关单或修改他人 worktree。

### 执行账本与证据层级

| 候选 / 输入 | 实际执行 | 结果与限制 |
| --- | --- | --- |
| `b54a126b594e` | 四个真实文件：`server/modules/agent/xiaoze/catalogBoundary.integration.test.ts`；`server/modules/parameter-kernel/sensitiveNode.identity.integration.test.ts`；`server/modules/parameter-catalog-api/rootBatchQueries.integration.test.ts`；`server/modules/parameter-catalog-api/governance/proposalAdapterParity.integration.test.ts` | 86/86，无跳过；真实 PG/根 HTTP，其中 18 条真实 Agent。另处 40 条 sensitiveNode Queryable 测试是纯测试，不能称 PG。 |
| `b54a126b594e` | `acceptance:e2e` 三份 Catalog spec，Desktop Chrome，无依赖 project，真实 owned 本地 runtime | 21/21，无跳过，1.3 分钟；含三视口冲突、提交后响应故障、操作 parity、角色及历史链接。原始 metadata 保留精确起止与命令。 |
| `b54a126b594e` | build、lint、contract:check、ui:check、acceptance:coverage、acceptance:operations、acceptance:models | 通过。lint 仅 src，不声称 server lint。报告提交 docs 检查单独记录。 |
| `77586ba67d50` | `npm run test:server` | 501 文件、3816/3816、无跳过。到代码候选 server 字节不变；没有把它称为较后 helper-only SHA 的重新执行。 |
| `ee60c5a1d` | `npm run test:all` | 前端 3354 通过；scripts 1178 通过/20 失败/5 跳过，在 bridge/server 前停止。三个本轮脚本失败已修；15 个临时库路由失败在专用容器的一次受控复查中消失；两个未改动的 finalize-gate0-upload 进程身份用例仍失败，未第三次重试或相邻修复。后来的 boundary 失败另记。 |
| `1162730256fd` | bridge:test、acceptance:gate0 | Bridge 通过。Gate 0 visual 16 通过/4 失败；完整 server 暴露本轮回归后父发送 SIGINT，exit130，browser 不完整。属于失败/中断，不是完整 Gate 0 通过。其自身 safety scan 为零违例。 |
| `c1032d730d50` | playwright-cli，经真实 local-login/API/PG 访问 `/parameter-admin/specs` | 1440×900、768×1024、390×844 snapshot/screenshot；输入、弹层、Tab 焦点、取消/输入保留、滚动及显式创建。认证后 console 零错误/两警告；初次未登录 401 保留在 network。到代码候选 UI src 字节不变。 |

代码候选 Subject limit 1/25/100 的 business/auth/Kernel/transaction/other SQL 均为 `4/1/15/8/0`，waitingCount0；空页无页投影查询。保留的 Definition Red 实测业务查询 `5/101/401`，证明 N+1 残留。上文容量仅是早期初步结果，不能升级成最终候选或代表性库存证据。

代码候选 boundary 失败：总数 3513，23 个 unallowlisted、23 个 stale，逐项配对到 property-key 夹具中内容未变但位置移动的旧 SQL。`work/catalog-r2/evidence/boundary-relocation-23.json` 保存两边 ID、位置、token 和 evidence。独立 Standards 未找到现有获授权的重定位机制。未增加 allowance、未替换 trusted base、未填充空白或放宽扫描。需要单独批准并独立审查的重定位机制；数量相同不等于通过。

独立 Standards/Spec 报告在 `work/catalog-r2/reviews/`，包括 `standards-b54.md`、`spec-b54.md`，均为保留阻塞的限定 PASS。Spec 编写了 23 条 PG 测试但未实现生产，Standards 独立检查了这些测试。历史 finding 和修复记录保留。当前没有 Hosted job/checkout、新 PR、merge SHA 或 attestation。

### 文档处置与交付

已更新计划/索引、双语 API transition 和生成 operation coverage；Proposal 实际契约/错误变化对应 OpenAPI 已经生成器更新，数据库 schema 未变。保留 requirement/operation ID 和 mandatory 状态。仓库地图、架构、产品、安全模型、前端设计系统、runbook 和通用验证参考不变，原因是沿用既有边界，未授权新的产品、领域或发布工作流。覆盖 metadata 通过只是结构检查，不是全部 mandatory 验收通过。计划保持 active，不伪造完成记录。

脱敏后的日志、metadata、SQL、截图、审查和 SHA 适用性比较位于 `work/catalog-r2/shareable-evidence/`，安全检查和 hash manifest 独立于源文件交付。`work/catalog-r2/delivery/<report-head>/complete-changed-files.zip` 按原目录保存全部已修改 tracked 文件的完整字节，`paths.json` 逐项列路径/hash；排除私密 lane URL、storage-state token 和 runtime descriptor。保留原始与所有 Scratch/受控 mutant worktree；owned 测试进程已停止，失败运行的数据库/object-store 证据保留，不静默清理。

重跑时按现有脚本 provision/doctor 实际 lane820，私下读取其真实输出 URL，然后执行各 metadata JSON 中的精确命令。focused 命令列出上表四个真实文件；`work/catalog-r2/run-catalog-specs.ts` 使用既有 owned runtime provisioner 执行三份 spec，不伪造 descriptor。完整 Gate0/容量待解除其阻塞后再执行。OP-09、#811/#735 目标机工作、P12–P15、生产恢复/数据修改/切流均未执行，仍独立待授权。
