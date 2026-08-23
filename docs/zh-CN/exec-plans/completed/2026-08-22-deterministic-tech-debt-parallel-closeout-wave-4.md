# 确定性技术债并行收口——第 4 轮

> English: [English](../../../exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md)
>
> 状态：**已完成，2026-08-24**
>
> 日期：2026-08-22
>
> 规划基线：`origin/main@86f2f409b6529ca459c0079e58c4d68bbdae2dc4`
>
> 规划分支：`codex/deterministic-tech-debt-wave4-plan`

> 收口分支：`codex/deterministic-td-wave4-closeout`
>
> 实现 PR：#598（TD-067）、#599（TD-105）、#600（TD-014）、#601（TD-005 切片）、#602（hotspot）、#603–#607（TD-122）
>
> 最终实现基线：`main@493a257a1f3507f883715c5b5235af7a233914c7`

## 目标

在不依赖 HDC/ADB 硬件、目标部署、真实模型、KMS、专家标注或未决客户输入的前提下，关闭最大一组独立、可确定验证的遗留项：

- **TD-105**：通过两种日志 worker 共用的保留接口限制 `log_webhook_deliveries` 无界增长。
- **TD-014，条件式**：退役无人消费的 legacy 调试参数 Admin HTTP/客户端合同并证明节点目录导入导出治理。只有 node-only 架构决策把 live HDC 证据明确归入 TD-100，且确认没有更广 catalog 治理余量时才关闭；否则完成本切片但保持 Open。
- **TD-067，条件式**：把 stock self-hosted 的单 API 拓扑变成可执行、规范化约束。只有 ADR-0020 和支持部署合同明确所有非 bridge-aware 多副本拓扑都不受支持时才关闭；只拦 wrapper 不够。
- **TD-005 切片**：机器约束 superseded 计划的位置并归档已知陈旧计划。除非有 repo-wide completed-plan 状态/section inventory 与合同覆盖更广历史歧义，否则保持 TD-005 Open。
- **项目热点计划收口**：让 API 合同与已上线的行为评分结构一致，删除不可达 legacy 投影并归档计划；这不是新增 tracker 关闭项。
- **TD-122，条件式**：所有影响验收的分支合入后执行 clean source、owned runtime、fresh isolated DB Gate 0。只有失败清单确定、已修复、最终全量证据绿色才关闭；否则保持 Open 并记录下一组工作。

每条实现轨都要在生产改动前留下公共接口 RED，跑相称全门禁、独立 Standards/Spec 双轴复审和独立 PR。只有 merged-main 证据成立后才更新 tracker/计划状态。

## 收口结果

- **TD-067 经 #598（`3a2cfc408bd737751420f976cbd30a511332e443`）关闭。** stock 单 API 约束既由 compose wrapper 执行，也在 ADR-0020 和中英文 reliability/deployment/bridge/self-hosted 入口成为规范边界。自带 bridge-aware routing 的定制部署仍在 stock 声明之外；不推导 target HA ready。
- **TD-105 经 #599（`62a100e3b0e42817d7006a62b89aeb012af2c9ba`）关闭。** 一个有界 retention seam 与每种 worker mode 各一个 lifecycle loop 终止 webhook-delivery 无界增长；包含按域稳定排序、脱敏重试、shutdown 等待、显式停用开关，以及已删行只能由备份恢复的边界。
- **TD-014 经 #600（`e528c4a52d7646b70f8b2e576448684cf36aacf9`）关闭。** unused legacy parameter-Admin HTTP/client 合同已退役，node-only 边界明确；历史 schema/data/runtime read 与 audit 证据保留。真实 node-catalog export/import acceptance 全绿，HDC 真机证据仍归 Open TD-100。
- **TD-005 在 #601（`a5a0b653a3f2cd65320757523eb38fc51049d7d7`）后保持 Open。** superseded 计划已被机器门禁拦在 active 之外，四组已验证 stale plan 已归档；但 177 个英文 completed-plan basename 中只有 4 个被本次有界 inventory 管理，剩余 173 个阻止 repo-wide 关闭声明。
- **陈旧 hotspot 计划经 #602（`b2181d956129c844d86d6782f52d57dcf57efb37`）完成。** 线上四键 score contract 已精确化，不可达 legacy projection 已删除；API-mode Parameter Home 证明排序/标签不变，并修复 mobile FAB 覆盖。该轨不新增或关闭 tracker 行。
- **TD-122 经 #603–#607 关闭；最终证明为 `493a257a1f3507f883715c5b5235af7a233914c7`。** 最终 clean merged-main owned run：visual 20/20，browser 127 expected / 29 planned skipped / 0 unexpected / 0 flaky；125 条 operation record 覆盖全部 108 个 required ID，无 missing/invalid/error；11 个 nested runtime 与所有 root resource 全部清理；artifact scan 为 0 violation；`latest-full.json` 绑定精确 run/commit。详细保留证据见已完成的 acceptance-baseline 计划。
- #598–#605 使用各自记录的 required checks。#606/#607 执行时 GitHub Actions 额度耗尽，仓库负责人明确授权完整本地 CI 通过后合入；本地门禁与 fresh 双轴复审均为绿色。收口明确记录该例外，不把排队中的 GitHub job 写成 green。
- shared closeout 在修改前按 Open 章节边界重算 tracker 与 durable 编号空间：`493a257a1` 上英文 Open 38 行、中文 Open 26 条；移除四条有证明关闭项后分别为 34 与 22。ADR 仍为 37 个，SQL migration 仍为 113 个。中英文 tracker 因中文版是精简 companion，数量本来就不要求完全相等，但两侧都移动相同四个 ID。TD-005 的有界归档清理完成后，仍保留在英文权威 Open 表中。
- 其余 Review/No-change 行已对最终 `493a257a1` 复核。此次纯文档 closeout 不改变产品 workflow、permission、target evidence、HDC/provider readiness、KMS、API trust boundary、仓库地图或 reference contract。矩阵要求的 runtime、architecture、quality、runbook、API、frontend 与 generated-artifact 更新已由实现 PR 提供。

## 固定审计决策

### TD-105

每次 webhook 投递都会插入记录，目前没有删除路径。确定策略是“每域保留最近 N 条”，不虚构尚无流量证据的天数门槛。`LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED` 默认 `true`；`LOG_WEBHOOK_DELIVERY_RETENTION_PER_DOMAIN` 保守默认 `10000`，只接受 `1..1000000` 整数。内部维护常量固定为每 batch 删除 1000 行、每 cycle 最多 10 batch、每 60 秒一轮，并立即异步执行首轮。记录按 `created_at DESC, id DESC` 稳定排序。polling/durable 共用一个 loop。清理失败只发脱敏结构化 warning，下轮重试且不停止 webhook 投递。operator 可设 `..._ENABLED=false` 停止后续删除，但已清行只能通过标准数据库 backup/restore 恢复；审计保留文档必须写清。

### TD-014

当前产品是 node-only。`/debugging-admin/nodes` 使用节点 CRUD 和节点目录导入导出；legacy parameter client 方法没有产品调用者，但旧 route 仍在 manifest/OpenAPI。本轮只退役该 HTTP/client 表面，保留历史表、数据、binding 和 audit。`DEBUG-ADMIN-001` 必须实际覆盖节点 export/import 和审计计数。关闭前，node-only 架构合同必须明确退役 legacy catalog，并把 live device evidence 归入 Open TD-100；否则 TD-014 保持 Open。

### TD-067

ADR-0020 记录 bridge 进程内亲和，stock self-hosted 是单 Linux、单 API service，因此支持边界是一个 API 副本。compose wrapper 拒绝 `api>1`，允许 `api=1`，其它服务 scale 不受影响。ADR-0020 和规范部署文档还必须说明：direct Compose、orchestrator、external 多副本只有自带 bridge-aware routing 才可能使用，否则不受支持。只有这份 repo-wide 合同成立才允许关闭。

### TD-005 与 hotspot

completed plan 是历史证据；当前代码、生成合同、规范文档和 tracker 优先。已知陈旧项包括已合入的 organization administration（#560）、local-eval auth hardening（#563）、被后续实现取代的 node-only/DTS-workbench，以及只剩 API 复核的 hotspot 计划。`Superseded` 计划不得留在 active；历史未勾选框不会隐式成为当前工作。若没有 full completed-plan inventory 证明所有 feature plan 的 implementation status 和 superseded section 都明确，本次 known-plan 修复不得关闭 TD-005。

生产 project/module/parameter 热点已经统一使用 `frequency`、`scope`、`workflow`、`collaboration`，文档和不可达分支仍保留旧 `frequency/risk/impact/workflow/drift`。把 `DashboardHotspot.scoreBreakdown` 收窄成行为结构，只删除当前 kind schema 下不可达的代码；不改变分数、排序、路由或可见标签。

### TD-122 Gate 0

历史 full browser 使用共享数据库和 dirty worktree，18 个失败只是 inventory。当前 preflight 会接纳任意固定端口健康进程，却不证明数据库、对象存储、源码 commit 或 run ID。新增 `OwnedLocalAcceptanceRuntime`：拥有先确认不存在的 `wiseeff_acceptance_full_*` 数据库、run/source marker、run-scoped object store、唯一端口、production HMAC、deterministic Xiaoze、本地 webhook policy、子进程生命周期和 exact-target cleanup。健康但 marker/DB/run ID 不匹配的旧服务必须拒绝。

Darwin visual 的 4 个 stale 和 7 个 missing 是独立确定证据。每张图按 route/state/viewport 评审，禁止批量接受。

## 非目标

- TD-062 shell 瘦身、TD-075 registry/state-machine 统一、TD-076 fixture 收敛、TD-097 全站清理、TD-113 stock burn、TD-118 时延关闭。
- TD-055/068/090/103/116/119/120/121，或需要产品策略、KMS、专家反馈、外部身份、目标流量、客户环境的工作。
- 删除调试历史、改变设备写策略或声称 HDC ready。
- 建设 bridge router、sticky routing、broker、HA。
- 改变热点排序或重做 Parameter Home。
- 用 retry、放宽断言、清共享库、批量快照或未计划 skip 掩盖 TD-122。

## 深接口

| 轨道 | 公共/深接口 | 边界 |
| --- | --- | --- |
| TD-105 | `pruneLogWebhookDeliveries(db, { keepPerDomain, batchLimit })` 与一个 worker-owned loop | 断言真实 PG；transport、queue、cleanup policy 分离。 |
| TD-014 | route manifest/OpenAPI、node-catalog service、`debuggingAdminClient` 公共表面 | 只退役 unused parameter Admin；保留 schema/history/authz/audit。 |
| TD-067 | `ops/self-hosted/scripts/compose`、ADR-0020、规范部署合同 | Docker 前拒绝 stock 不支持拓扑，并声明所有非 bridge-aware 多副本入口不受支持；不声称目标环境 ready。 |
| TD-005 | `validatePlanDocument` 与 completed-plan 解释合同 | 对 known superseded plan 机器约束位置；没有 full inventory 就保持 Open。 |
| Hotspot | `DashboardHotspot.scoreBreakdown` 与 `getDashboardHotspots` | 有效 kind 只有一个行为结构；测试断言值，不匹配源码文本。 |
| TD-122 | preflight、Playwright、evidence 共用 `OwnedLocalAcceptanceRuntime` | runner 拥有并验证依赖，不收养任意健康旧进程。 |

## 调度与所有权

先合入本规划 PR，再从刷新后的 `main` 建立三个 worker：

| 槽位 | 首分支 | 首项 | 合入后复用 |
| --- | --- | --- | --- |
| Worker 1 | `fix/td-105-webhook-retention` | TD-105 | `refactor/project-hotspot-behavioral-contract` |
| Worker 2 | `fix/td-014-retire-legacy-debug-admin` | TD-014 | review/support；先于 TD-122 final |
| Worker 3 | `fix/td-067-single-api-invariant` | TD-067 | `docs/td-005-superseded-plan-governance` |
| Parent/空闲槽 | `fix/td-122-owned-acceptance-runtime` | TD-122 Gate 0 | 验收相关 PR 合入后开始；复现修复组可用后续分支 |
| Parent/shared | `docs/deterministic-td-wave4-closeout` | tracker/PLANS/Wave 归档 | final evidence 后开始 |

实现 agent 只提交自己的分支，不改本计划/tracker，不打开或合并 PR。

- **TD-105**：webhook repository；新 retention 模块/测试；workerRunner/test；env/test；`.env.example`；中英环境/日志运维文档。
- **TD-014**：debugging routes/tests；contract manifest/OpenAPI tests；debugging Admin client/tests；debugging-admin acceptance；requirements/operation matrix；OpenAPI/coverage 和中英 API/验收文档。
- **TD-067**：compose/test；中英 RELIABILITY、local-device-bridge、deployment-operations；review 前 rebase #595/#596。
- **TD-005**：doc-governance checker/tests；命名 stale plans；completed README 与新中文 companion；中英 PLANS。tracker 只由 shared closeout 改。
- **Hotspot**：dashboard service/scoring/tests；dashboard types、score panel、presentation/tests；中英 API contract；热点计划与新中文 companion。
- **TD-122**：browser runner/preflight/tests；shared owned-runtime helper；Playwright config；必要时 CI；评审过的 Darwin snapshots；TD-122 plan/quality docs。必须在 TD-014/hotspot 后 rebase。
- **Shared closeout only**：中英 tracker、本计划、launch summaries、final PLANS。

## TDD 纵切

### A — TD-105

1. **RED**：真实 PG 测试调用不存在的 prune seam，覆盖两组织、多域、最近 N、batch、重复执行收敛、跨域隔离。
2. **GREEN**：实现一个有界事务；时间排序后用稳定 row identity tie-break。
3. **RED/GREEN**：证明 polling/durable 各启动且关闭一个 retention loop；接入立即异步首轮与 60 秒维护。非法 enabled/keep 必须失败；batch=1000、max-batches=10 是命名内部常量。日志只含 deleted count/duration 或脱敏 error code；失败不停止 delivery，下轮重试。测试 `enabled=false` rollback switch，并记录删除不可逆。
4. focused PG 零 skip，跑 full log/server gates。

### B — TD-014

1. **RED**：manifest/OpenAPI 要求旧 parameter route 不存在；route 返回 404；TypeScript public surface 不再有 legacy client methods。
2. **GREEN**：只删 route、manifest、专属 schema、无人调用 client；保留 DB/node CRUD/import/export/authz/audit。
3. **RED/GREEN**：把 `DEBUG-ADMIN-001` 改为 node catalog，执行 UI export/import，验证两类 audit。
4. 生成 contracts/coverage，跑 API-mode focused evidence。

### C — TD-067

1. **RED**：两种 `api=2` 语法在 Docker 前失败；`api=1` 和其它服务透传。
2. **GREEN**：最小 wrapper 校验，保留 #595/#596 行为。
3. 更新 ADR-0020 和中英可靠性/部署/bridge 文档，覆盖 wrapper、direct Compose、orchestrator、external deployment；跑 self-hosted gates。任何规范面仍暗示不受支持的 multi-replica ready，就保持 TD-067 Open。

### D — TD-005 与 hotspot

1. **RED/GREEN**：governance 要求 `Superseded` 在 active 外；实现位置门并归档已知 landed/superseded 计划，同时保留 invitation/org-directory/project-ACL rows。
2. **RED/GREEN hotspot**：通过 public DTO/service 固定行为 breakdown，删除不可达 legacy scorer/projection，更新中英 API contract。
3. 热点归档新增中文 companion；completed-plan 文档说明历史 unchecked item 不是 current work。除非同时加入并通过 repo-wide inventory 与 completed-plan metadata/section 合同，否则切片完成后 TD-005 仍保持 Open。

### E — TD-122

1. **RED**：固定端口健康但 marker/database/run ID 不匹配的旧服务今天会被接纳；新合同必须拒绝或分配新端口。
2. **GREEN**：实现 runtime descriptor，验证 DB absence、fresh migrate/seed、marker、object store、port/PID、auth/runtime、teardown、cleanup target。`acceptance:visual` 与 full browser 必须共同消费 descriptor。
3. Gate 0 先作为独立可审 PR 合入。从 TD-014/hotspot 后的 clean merged tree 跑 visual/full browser，编辑前持久化 results、trace/screenshot、commit/runtime marker、project/route/error class。失败时保留 DB、object store、runtime manifest 与 artifacts 供诊断；只在成功后 exact cleanup。
4. 每组先 focused RED 再修，逐张评审 Darwin baseline。
5. 复现组可拆独立 PR。最终 merged-main 上 visual/full browser 均消费 owned descriptor、evidence 全绿且清理验证成立才关闭；否则保持 Open 并记录下一组。Gate 0 不冒充 closure。

## 验证门禁

- **TD-105**：PG preflight/focused integration 零 skip；focused logs；`npm run test:server`；`npm run test:m2`；type；build；docs；diff。
- **TD-014**：focused debugging/contracts/frontend；contract check；`npm run test:m3-5`；`DEBUG-ADMIN-001` API-mode acceptance/evidence；frontend/server full；type/build/lint/ui:check；acceptance a11y/visual/responsive；docs/diff。`/debugging-admin/nodes` 在 1440×900、768×1024、390×844 做 snapshot+screenshot、export/import、audit、console error 0、相关请求 2xx。
- **TD-067**：compose tests、`npm run test:scripts`、`npm run selfhost:check`、docs、diff。
- **TD-005**：governance tests、`npm run test:scripts`、docs、diff。
- **Hotspot**：focused 前后端、contract、frontend/server full、type/build/lint/ui:check、acceptance a11y/visual/responsive、docs/diff。运行 `e2e/acceptance/parameter-home.acceptance.spec.ts` 的 requirement/operation `PARAM-HOME-001`，再执行 `npm run acceptance:evidence -- --run <runDir> --require PARAM-HOME-001`。Parameter Home 三视口 snapshot+screenshot、展开热点、console error 0、请求 2xx、排序/标签不变。
- **TD-122**：scripts/type/build；coverage/operations/quality/visual；full local-non-hdc browser；exact-full-run evidence；clean commit、owned marker、fresh migrate/seed evidence、0 unplanned failure、声明 skip、有效 latest-full、快照评审、成功后 DB/object-store exact cleanup、失败 forensic retention；docs/diff。

target/HDC/provider job 的 skip 不能支撑 ready 声明。

## Git 与 PR 工作流

1. Parent 先合入本 planning-only PR；实现分支随后从刷新 main 建立。
2. 三个隔离 worktree 并行 TD-105、TD-014、TD-067。
3. Implementer 留 RED/GREEN，只 commit 自己分支，不 push main、开/合 PR、改 shared state。
4. Parent rebase、重跑 typecheck/affected tests，并让两个非 implementer agent 并行做 Standards/Spec fixed-point review。
5. findings 修到两轴为 0。只有 Parent push/open PR；全部适用 CI 与 Merge bar 绿色才合入并刷新 main。pending 不是 green。
6. 空闲槽从当前 main 独立做 hotspot 与 TD-005，保持不同 PR；先合 hotspot 再由 TD-005 移动其计划。
7. TD-014 与所有影响可见/验收的改动合入后才开始 TD-122；final evidence 引用最终合入构成。
8. PR 全合、TD-122 状态确定后才做 shared closeout；改 tracker 前重查 TD/ADR/migration 数量。

## 文档影响矩阵

| 类别 | 状态 | 精确文件/证据 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`；`docs/zh-CN/root/AGENTS.md`；`ARCHITECTURE.md`；`docs/zh-CN/root/ARCHITECTURE.md`；`docs/README.md`；`docs/zh-CN/README.md`。入口未变则记 unchanged。 |
| 规划/技术债 | Update | `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md`；`docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-4.md`；`docs/exec-plans/tech-debt-tracker.md`；`docs/zh-CN/exec-plans/tech-debt-tracker.md`；`docs/PLANS.md`；`docs/zh-CN/PLANS.md`；`docs/exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`；`docs/zh-CN/exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`；`docs/exec-plans/active/2026-08-19-organization-administration.md`；`docs/zh-CN/exec-plans/active/2026-08-19-organization-administration.md`；`docs/exec-plans/completed/2026-08-19-organization-administration.md`；`docs/zh-CN/exec-plans/completed/2026-08-19-organization-administration.md`；`docs/exec-plans/active/2026-08-19-local-eval-auth-hardening.md`；`docs/zh-CN/exec-plans/active/2026-08-19-local-eval-auth-hardening.md`；`docs/exec-plans/completed/2026-08-19-local-eval-auth-hardening.md`；`docs/zh-CN/exec-plans/completed/2026-08-19-local-eval-auth-hardening.md`；`docs/exec-plans/active/2026-07-01-wiseeff-node-only-debugging-platform.md`；`docs/exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md`；`docs/zh-CN/exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md`；`docs/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`；`docs/zh-CN/exec-plans/active/2026-07-19-dts-parameter-workbench-redesign.md`；`docs/exec-plans/completed/2026-07-19-dts-parameter-workbench-redesign.md`；`docs/zh-CN/exec-plans/completed/2026-07-19-dts-parameter-workbench-redesign.md`；`docs/exec-plans/active/2026-07-08-project-hotspot-scoring-redesign.md`；`docs/exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md`；`docs/zh-CN/exec-plans/completed/2026-07-08-project-hotspot-scoring-redesign.md`；`docs/exec-plans/completed/README.md`；`docs/zh-CN/exec-plans/completed/README.md`。 |
| 产品规格 | Review | `docs/product-specs/index.md`；`docs/product-specs/product-spec.md`；`docs/zh-CN/product-specs/index.md`；`docs/zh-CN/product-specs/product-spec.md`。只有 TD-014 影响当前陈述才更新。 |
| 架构/领域 | Review | `CONTEXT.md`；`docs/adr/README.md`；`docs/adr/0020-reload-runs-execute-in-request-on-bridge-holding-process.md`；`docs/design-docs/full-stack-architecture.md`；`docs/zh-CN/design-docs/full-stack-architecture.md`；`docs/design-docs/api-contract.md`；`docs/zh-CN/design-docs/api-contract.md`；`docs/design-docs/2026-06-22-debugging-admin-hdc-adb-crud-design.md`；`docs/zh-CN/design-docs/2026-06-22-debugging-admin-hdc-adb-crud-design.md`。 |
| 质量/测试 | Update | `docs/QUALITY_SCORE.md`；`docs/zh-CN/QUALITY_SCORE.md`；`docs/design-docs/testing-strategy.md`；`docs/zh-CN/design-docs/testing-strategy.md`；`docs/developer/verification-matrix.md`；`docs/zh-CN/developer/verification-matrix.md`；`playwright.acceptance.config.ts`；`playwright.quality.config.ts`。 |
| 验收/生成证据 | Update | `e2e/acceptance/debugging-admin.acceptance.spec.ts`；`e2e/acceptance/parameter-home.acceptance.spec.ts`；`e2e/acceptance/requirements.ts`；`e2e/acceptance/operationMatrix.ts`；`docs/developer/browser-acceptance-coverage-map.md`；`docs/zh-CN/developer/browser-acceptance-coverage-map.md`；`docs/developer/user-operation-coverage-matrix.md`；`docs/zh-CN/developer/user-operation-coverage-matrix.md`；`docs/generated/acceptance-browser-evidence.md`；`docs/generated/acceptance-operation-evidence.md`；`docs/generated/acceptance-operation-evidence/index.json`。 |
| 可靠性/runbook | Update | `docs/RELIABILITY.md`；`docs/zh-CN/RELIABILITY.md`；`docs/design-docs/deployment-operations.md`；`docs/zh-CN/design-docs/deployment-operations.md`；`docs/runbooks/local-device-bridge.md`；`docs/zh-CN/runbooks/local-device-bridge.md`；`docs/developer/environment-variables.md`；`docs/zh-CN/developer/environment-variables.md`；`docs/api/log-analysis-integration.md`；`docs/zh-CN/api/log-analysis-integration.md`。 |
| 安全/治理 | Review | `docs/SECURITY.md`；`docs/zh-CN/SECURITY.md`；`docs/security/README.md`；`docs/zh-CN/security/README.md`；`docs/security/audit-retention.md`；`docs/zh-CN/security/audit-retention.md`；`scripts/check-doc-governance.ts`；`scripts/check-doc-governance.test.ts`。明确 delivery row 是 audit-adjacent，不是 immutable audit log。 |
| 前端/设计 | Review | `docs/FRONTEND.md`；`docs/zh-CN/frontend.md`；`docs/design-docs/ui-design-system.md`；`docs/zh-CN/design-docs/ui-design-system.md`；`docs/developer/ui-quality-checklist.md`；`docs/zh-CN/developer/ui-quality-checklist.md`。 |
| API 合同 | Update | `server/modules/contracts/routeManifest.ts`；`server/modules/contracts/routeManifest.test.ts`；`server/modules/contracts/openapi.test.ts`；`docs/generated/openapi.json`；`docs/api/README.md`；`docs/zh-CN/api/README.md`；`docs/design-docs/api-contract.md`；`docs/zh-CN/design-docs/api-contract.md`。 |
| Operations/self-hosted | Update | `ops/self-hosted/scripts/compose`；`ops/self-hosted/scripts/compose.test.ts`；`.env.example`；`server/config/env.ts`；`server/config/env.test.ts`；`docs/developer/environment-variables.md`；`docs/zh-CN/developer/environment-variables.md`。 |
| References | Review | `docs/references/productization-api-contract-draft.md`；`docs/references/pi-agent-provider-evidence.md`。current contract 未漂移则 unchanged。 |

## 文档更新门

- 每个 Update/Review 行已更新或以证据记录 unchanged；中英 companion 对齐。
- TD-105 默认启用、每域最近 10000、稳定排序、每批 1000、每 60 秒最多 10 批；delivery fail-open/下轮重试；有显式停用开关、脱敏可观测性，已删除记录只可由备份恢复。
- intentional API retirement 同步 manifest、generated OpenAPI、API docs、acceptance registry/evidence 和当前产品文案。
- TD-014 只有在 node-only 架构决策把 live device evidence 归入 TD-100 且无其它 catalog-governance 余量时才关闭；否则记录切片并保持 Open。
- 单 API 必须在 ADR-0020、wrapper、direct Compose、orchestrator、external deployment 表述中都是规范支持约束；external HA 不计入本轮。合同不完整则 TD-067 保持 Open。
- superseded plan 不得留 active；真实余量归档前必须有 Open tracker 或 active plan；没有 repo-wide completed-plan status/section 证据则 TD-005 保持 Open。
- final owned-runtime visual/browser/evidence 未全绿，TD-122 保持 Open；Gate 0 不冒充 closure。
- 每 PR 跑 scoped docs，merged-main closeout 移 completed 前跑 `npm run docs:check` 与 `git diff --check`。
