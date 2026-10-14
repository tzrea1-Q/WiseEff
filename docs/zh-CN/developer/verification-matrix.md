# 验证矩阵

> English: [English](../../developer/verification-matrix.md)

这是日常开发文档，帮助开发者完成本地启动、环境配置、验证选择和验收覆盖判断。

## 验证分层

贡献者和智能体使用同一模型。选择不等于执行，本地通过不等于 PR、合入、夜间、目标主机或生产证据。已接受任务及发布契约的额外门禁保持不变。

| 层级 | 负责人及必需证据 |
| --- | --- |
| 编辑内循环 | 实现者：仅运行正在修改的测试文件；通过 `test:impact` 发现受影响套件、静态门禁、quality 路由及跨路由 acceptance spec，不凭文件名猜测。行为变更使用红 → 绿；纯文档不制造失败测试。 |
| 交接前 | 实现者：在分配预算内执行受影响选择、检查差异并报告两个回退标志。协调者：执行预算外的选中门禁和真实 API 浏览器检查，以及 TypeScript/Vite/路由/共享类型变更必需的构建。纯文档选择 `docs:check`，不选择 Vitest 或浏览器。 |
| PR CI | 协调者：检查精确推送 head 的实际工作流，包括原生选中作业、回执及必需汇总。Spec #1164 要求 PR 按影响运行验收；本地选择器不会安装此 CI 策略。CI 集成落地前，仍由既有路径选择和 `full-acceptance` 标签决定 CI L2。 |
| 合入 | 协调者仅在获授权时执行：要求当前候选版本真正的 `Merge bar` 成功及全部已接受任务证据。pending、cancelled、旧 head 或 `Merge bar (ignored label)` 均不能替代。本地选择不能豁免必需作业。 |
| 夜间 | `main` 上的 CI：main push 与夜间运行保留完整 L1/L2，包括完整 quality/backend 清单和归属 Gate0 验收。定向本地通过不能替代此层。 |

### 选择一次，按层执行

```bash
# 显式文件，或实际集成基线及全部工作树变更：
npm run test:impact -- src/DebuggingPage.tsx
npm run --silent test:impact -- --base origin/main --json > /tmp/wiseeff-impact.json
# 编辑内循环：替换为正在修改的具体测试文件。
VITE_WISEEFF_RUNTIME_MODE=mock npx vitest run --configLoader runner <test-file>
```

任务集成基线与 `origin/main` 不同时使用实际基线。读取 `suites`、`gates`、`commands` 和 `browser`；检查 **两个** `fullFallback` 和 `browser.fullFallback` 及其原因。执行输出命令时不删除配置、预热、跨路由 spec 或静态门禁。共享、删除、未知映射或发现失败均保守回退；完整覆盖超预算时交给协调者，不擅自缩小范围。空变更是错误，不是验收。选择器契约见[贡献指南](../root/CONTRIBUTING.md#本地-vitest-影响选择)。

### 智能体验证预算

委派任务由协调者承担昂贵门禁时，所有检查顺序执行。编辑期间仅运行正在修改的测试文件。全部编辑结束后，对每个变更源码运行一次 related，再 lint 这些文件并检查受影响 TypeScript 项目：

```bash
VITE_WISEEFF_RUNTIME_MODE=mock npx vitest related --run --configLoader runner <changed-source-files>
npx eslint <changed-code-files>
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
git diff --check
```

`src/` TypeScript 变更运行 app 类型检查；server/scripts/e2e/config TypeScript 变更运行 node 类型检查。related 仅覆盖当前 Vitest 配置：使用 `test:impact` 识别其他套件/门禁，并明确将未执行选择交给协调者。纯文档不需要 related、ESLint 或 TypeScript 检查；选中的 `npm run docs:check` 仍为必需，任务将文档门禁保留给协调者时由其执行。related 失败可修复后最多重跑两次。此预算下不执行完整套件、构建、全仓 lint、浏览器循环或并发测试/构建会话。协调者每个任务执行一次昂贵门禁；只是移交，不是取消。环境不可用或沙箱错误属于缺失证据，不是通过。

### 隔离浏览器泳道

获准执行定向浏览器检查时，先按照[本地设置](../root/CONTRIBUTING.md#测试数据库隔离)准备并播种可丢弃的 lane 数据库。导出基础 PostgreSQL `DATABASE_URL` 后，使用 `browser.commands` 输出的精确 grep 和 spec 清单：

```bash
WISEEFF_RUNTIME_LANE=1 npx playwright test --config playwright.quality.config.ts --grep '<browser.qualityGrep>'
WISEEFF_RUNTIME_LANE=1 npx playwright test --config playwright.acceptance.config.ts <browser.acceptanceSpecs>
# 只执行一个已注册 quality 分区，而不是全部项目：
WISEEFF_RUNTIME_LANE=1 WISEEFF_QUALITY_LANE=consistency-1 npx playwright test --config playwright.quality.config.ts --grep '<browser.qualityGrep>'
```

占位符须替换为选择器输出，不是字面参数。分区执行选择时运行所有适用 quality 分区（`visual`、`consistency-1`、`consistency-2`、`accessibility`）。`WISEEFF_RUNTIME_LANE` 隔离端口、数据库、对象存储和报告；`WISEEFF_QUALITY_LANE` 选择覆盖范围，不隔离运行时。顺序执行 quality/acceptance 可复用 lane；同时执行必须使用不同运行时 lane ID。`WISEEFF_VITEST_LANES` 是并发 Vitest 进程总数，不是浏览器 lane 设置。描述符不创建数据库，不能与归属 Gate0 运行时控制混用。定向 Playwright 证据不是完整 Gate0 证据；受控运行时及回执义务保持不变。可见变更要求 `1440x900` 的真实 API 证据；mock 测试、收集和元数据不能代替执行。浏览器归协调者时，报告选中路由/spec 和缺失截图，不自行启动。

## 本地 Vitest worker 预算

协调者在同一主机并发运行 Vitest 泳道时，应为每条泳道设置 `WISEEFF_VITEST_LANES`，其值为同时运行的 Vitest 进程总数，而非运行时泳道 ID。例如，`WISEEFF_VITEST_LANES=3 npm test -- src/NodeDebuggingPage.test.tsx` 会将主机的 `availableParallelism()` 分给三条泳道。单进程默认使用 `1` 条泳道。

前端和 Bridge 默认最多四个 worker；server 保留半数 CPU、最多四个 worker 的默认值；scripts 保持串行。每个上限还受 `floor(availableParallelism / lanes)` 限制，最少一个 worker。`VITEST_SERVER_MAX_WORKERS` 仍可设置，但不能超过每条泳道的 CPU 预算。两个设置均须为正安全整数。使用此预算时不要覆盖 `--maxWorkers`。泳道数超过可用 CPU 时仍需协调者串行调度，因为每条泳道最少需要一个 worker。

负载敏感的 DOM 测试应等待界面就绪，并在 `act` 内完成受控 Promise，而不是把请求开始、URL 改变或固定 sleep 当作完成。保留原有断言和超时。重复的隔离运行、并发负载运行及 PR CI 仍由协调者提供验收证据，与局部本地通过结果分开。

## 使用方式

L2 的 `wiseeff-diagnostic-<run>-<attempt>-acceptance-local-non-hdc-shard-<i>` 产物是有界的工作流状态快照，与经过安全门禁的各分片完整 ZIP 分开。它记录候选初始化前实测的 checkout SHA/tree、workflow SHA、PR head/base（非 PR 事件使用 push 前驱或定时运行的 head），以及执行、归档、完整上传的结果。首版内部阶段、清理和测试数量仍是 unknown，不读取候选报告或原始日志。发布器失败时只生成 `DIAGNOSTIC_REJECTED`；后备诊断或上传成功不能覆盖先前失败。诊断自身上传在快照中为 pending，最终状态见 Actions 和作业摘要；runner 丢失时可能 incomplete。完整产物的大小、所有权及安全要求保持不变。

修改此通道时运行 `npm run test:scripts -- scripts/acceptance-diagnostic.test.ts scripts/check-acceptance-ci.test.ts` 和 `npm run acceptance:ci`。测试提取并执行实际工作流内的隔离发布器，合成失败只证明诊断行为，不是完整验收通过。新增有界步骤均计入 L2 平台预算（下界 151 分钟、作业上限 155 分钟），Gate0 owner 及原安全扫描/上传预算不变。

L2 浏览器验收使用 `--shard=i/4` 分为四个独立 Gate0 作业，各自拥有 PostgreSQL 服务及运行时。视觉验收仅在分片 1 执行，浏览器预热依赖在每个分片执行。执行前由原生 Playwright 收集确定非空测试清单及按文件划分的工作流/操作证据义务，结果清单必须一致；整套静态覆盖检查及所有运行时归属证据检查继续保留。每个必须自动验收的操作只能有一个浏览器 spec 所有者。分片不发布最新完整证据指针。稳定的 `Acceptance local non-HDC` 汇总门要求矩阵全部成功，或由成功的 detect 有意跳过矩阵，之后 `Merge bar` 才能通过。不带参数的 `npm run acceptance:gate0` 仍在本地执行两个完整阶段。

分片执行前，不分片的原生测试收集必须仍包含所有必需操作的浏览器所有者。分片参数仅用于具备有效归属描述符及归属输出路径的本地非 HDC 运行；独立、target 或 full-pilot 片段不能覆盖完整运行证据。收集、清单及其他阶段命令失败均进入 Gate0 的结构化失败清单，即使原生报告中没有失败测试结果。

浏览器分片按耗时均衡分配，不再使用 Playwright 原生的测试数量分片。`scripts/acceptance-shard-plan.ts` 从完整原生收集结果中按文件分配：先处理实测耗时最长的文件，再交给当前负载最低的分片；相同耗时按文件名、分片序号确定顺序。分片 1 的初始负载包含实测视觉阶段墙钟耗时，每个分片至少拥有一个浏览器文件。`scripts/acceptance-durations.json` 保存输入测量值及来源：2026-10-10 完整收集运行的浏览器 list 报告按文件累加耗时，以及 2026-09-18 视觉 JSON 报告的 `stats.duration`。两次历史运行均含失败，这些值仅用于调度，不代表当前验收通过或已实测的加速。新增或零耗时文件使用已记录最慢文件的权重，不会被遗漏。显式转义的文件筛选保留预热项目，原有计划、完整收集、结果清单及操作检查保持不变。

协调者使用完整浏览器 JSON 报告按文件累加结果耗时（含重试），以及视觉报告的墙钟耗时，更新这些权重；快照保留来源日期及失败限制说明。协调者必须在变更前后运行全部四个 Gate0 分片，报告实际作业墙钟耗时，不能用测试耗时之和代替；既有 CI 中位数（24.35 / 15.55 / 16.43 / 9.73 分钟，混合成功和失败运行）仅作背景。验收超时、必需汇总门和视觉验收义务均不变。

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## Parameter Catalog boundary baseline

运行 `npm run parameter-catalog-boundaries:check`，将当前 AST/SQL 检测结果与 `scripts/parameter-catalog-boundaries/baseline.json` 比较。按仓库相对文件路径和规则统计已配置消费者族的出现次数；计数不变即可通过，无需 Git 历史、blob 哈希或外部证明文件。新增文件/规则或计数增加会失败并输出证据。计数减少也会以基线过期失败：运行 `npm run parameter-catalog-boundaries:check -- --update` 锁定改进。

`--update` 遇到任何增加都会拒绝更新，且不写入基线。只有明确评审过的增加才应使用 `--update --allow-increase`；该命令也用于初始化缺失基线。零出现次数的文件不写入，键按序排列。计数不会区分同一文件/规则中保持数量不变的替换。使用 `npm run test:scripts -- scripts/check-parameter-catalog-boundaries.test.ts` 验证变更。

## CI shadow 观察

`Build and test` 汇总器先强制校验现有原生 L1 回执和必需结果，通过后才发布有界、无放行权的 shadow 摘要。适用的 PR 若有四份新鲜且匹配的原生观察，返回 `observed`、`planValid:true`；证据缺失、畸形或不匹配时返回 `unavailable`、`planValid:false`。纯文档和非 PR 运行返回 `not-applicable`、`planValid:false`。适用范围由原生 Detect 输出确定，观察不可用不能掩盖原生失败或生成有效计划。

原有 L1 命令全部继续执行。四个反馈模块保持 `observation-pending`，enforce 与 memo 关闭；策略变更仍以原有完整要求验证自身。摘要路径和字段固定且有界，被拒绝的证据不能回退为原始目录上传。此边界使用 `npm run test:scripts -- scripts/check-acceptance-ci.test.ts scripts/ci-required-results.test.ts scripts/verification/ci-shadow.test.ts scripts/verification/plan.test.ts scripts/verification/selection.test.ts scripts/ci-changed-paths.test.ts`、`npm run acceptance:ci` 和原有 build 验证。测试内的有限原生夹具证明回执接线，不计作真实模块启用样本。

## CI D2 质量泳道与后端分片

D2 将 CI 的单次质量执行拆为四个矩阵泳道。原生 Playwright 从已注册质量项目收集精确测试清单；仅有元数据检查或清单收集通过，不代表浏览器执行通过：

| 质量泳道 | 已注册覆盖 | 质量工件 |
| --- | --- | --- |
| `visual` | `visual`，以及已注册时的 `compact` | `wiseeff-acceptance-quality` |
| `consistency-1` | `consistency` 的第一个路由分区 | `wiseeff-acceptance-quality-consistency-1` |
| `consistency-2` | `consistency` 的第二个、互不重叠的路由分区 | `wiseeff-acceptance-quality-consistency-2` |
| `accessibility` | `a11y` 与 `responsive` | `wiseeff-acceptance-quality-accessibility` |

`runtime-warmup` 有意在每个泳道执行。其他每个已注册测试必须且只能归属一个泳道；两个 consistency 路由分区必须覆盖完整的已注册 consistency 清单，非路由的 collector/readiness 测试也只能分配一次。未注册 `compact` 时不能虚构其覆盖；新增已注册项目或测试没有归属时必须在收集阶段失败，不能静默遗漏。

新增 consistency 路由与查询状态按基础路径自动分组，优先将最大组分配给测试数较少的 consistency 泳道，同大小组按字典序处理。分配结果不受注册顺序影响，路由数量差不超过最大组的大小。已注册的 `compact` 测试自动归属 `visual`；允许 `compact` 项目尚未存在。回执动态收集已注册测试，不依赖固定的项目测试数量。

每个质量泳道拥有独立的 PostgreSQL 服务与运行时。迁移后必须依次运行 `npm run db:seed:all` 与 `npm run --if-present seed:quality:admin-lists`，命令成功后才为质量执行设置 `WISEEFF_QUALITY_SKIP_SEED=true`。main 上允许管理员列表 seed 尚未注册；一旦注册，该脚本必须成功，不能抑制失败。脚本缺失不代表管理员列表 fixture 已获覆盖。每个质量泳道保留原有 **35 分钟**作业超时。

L1 后端使用两个按时长均衡的整文件分片，各自拥有 `pgvector/pgvector:pg16` 服务，保留原有 **20 分钟**作业超时。原生未分片 `vitest list --filesOnly` 文件发现沿用未变更的后端 include/exclude 规则，不导入测试或执行 global setup。`npm run test:server` 接收分片拥有的绝对文件列表，替代 `--shard`，保留正常数据库 setup 与测试语义。`scripts/ci-server-inventory-reporter.ts` 在同一次实际运行的收集阶段、测试体执行之前，记录已注册测试快照，不再额外执行导入/数据库收集。每份回执包含共同的完整文件清单与本分片的已收集测试 ID。文件发现/收集/实际执行清单精确匹配、`filesSha256` 与汇总回执继续要求每个配置文件和已注册测试恰好执行一次。全部原有 L1 命令及文档/vector 检查继续保留。

`scripts/server-shard-plan.ts` 复用验收时长均衡器：最长文件优先，分配给当前权重最小的分片，文件名/分片编号确定性破同分。`scripts/server-durations.json` 保存建议性 Vitest JSON 文件权重（`endTime - startTime`，含 hooks 与失败结果）；新文件或零时长文件使用最慢已记录文件的权重（没有测量数据时回退为 1 ms）。通过 `node --experimental-strip-types scripts/server-shard-plan.ts refresh <report.json> [<report-root>]` 刷新；报告 checkout 根目录与当前 checkout 不同时须传入该根目录。初始 653 个文件的快照来自协调者于 2026-10-14 提供的报告，其中包含失败与跳过；来源记录报告摘要和失败状态，不能视为验收。协调者须测量两个 Hosted 分片的实际作业墙钟时间后，才能声称达到 ≤11 分钟目标；调度权重不能作为墙钟证据。

汇总通过工件回执完成，不能使用矩阵输出的最后写入者覆盖语义。必须精确收齐四个质量泳道和两个后端分片，核验工件/回执唯一归属、收集与实际执行清单完全一致，以及 checkout SHA/tree、repository/run 和命令/project/lane 或 shard 身份一致。工件/回执缺失、同一 attempt 重复、陈旧、格式错误、身份不匹配、上传失败、必需 worker 失败或取消、必需测试为零或全部跳过，均按 fail-closed 拒绝通过。质量清单并集将 warmup 按每泳道一次计入，其他测试仅计入一次；后端清单保留精确分片归属。

GitHub Actions **Re-run failed jobs** 支持无需全量重跑的恢复（2026-10-14 决策）。成功作业输出及分片/泳道回执允许来自 `1 <= attempt <= current attempt` 的任意一次执行，但 repository、run ID、event、ref、checkout SHA/tree、PR head/base、mode/full-acceptance 选择和 job/lane 身份仍须一致。下载使用 `wiseeff-ci-server-*-*` 与 `wiseeff-ci-quality-*-*`，仅获取当前 run 的工件并保留各 attempt 独立目录；汇总按数值选择每个预期分片/泳道的最新回执，不依赖下载顺序。attempt 缺失或无效、其他 run/commit、未来 attempt、同一 attempt 重复及分片/泳道缺失均 fail-closed；最新回执无效时不得退回旧回执。必需 worker 结果与 Detect 门禁不变。这不构成新 commit 的验收，也不替代协调者必须执行的完整门禁。

保留稳定汇总 job ID/名称 `acceptance-quality` / `Acceptance quality` 与 `l1-server` / `L1 backend`。`Build and test`、`Merge bar` 的 always-run 及 Detect 控制的跳过语义不变：必需矩阵必须全部成功且回执有效；仅成功检测判定不需要时才允许跳过。文档-only 仍要求稳定合入汇总门成功。保留 `Merge bar` 作为 `main` 的 required status check，不能换成各矩阵 worker。此契约不改变 L2 Gate0 预算或验收义务。

## 关键阅读点

- 先确认该文档属于哪个决策面：developer。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- 永久注销用户必须执行 API 模式的 `PERM-USER-MGMT-001`，证明 PostgreSQL 外键策略（账号自有数据 `CASCADE`、历史保留数据可空 `SET NULL`）、无 PII 的注销审计，以及非 Admin 调用 `DELETE /api/v1/users/:userId` 返回 401/403。Mock 模式浏览器通过不能满足这一 API/数据库门禁。
- M5.12：PR 合入门槛是 L1 + `@ci-smoke`（产品路径）+ 四个 D2 质量泳道经稳定 `Acceptance quality` 汇总（UI/产品路径）。L1 保留 `l1-static`、`l1-frontend`、`l1-scripts`、`l1-server` 汇总 ID 及全部原命令；脚本和两个按时长均衡的后端分片各自使用 pgvector 服务与已验证 DTS 工具链，L1 `docs:check` 保留在 vector 设置之后、后端测试之前。原生收集/实际执行清单共同覆盖配置中的完整文件集，并生成本次私有原生 JSON 报告；工件回执、报告、命令结果、实际执行 SHA/tree/run/attempt 必须一致。必需检查缺失、跳过、取消、零测试或全部必需测试跳过均失败。`Build and test` 与 `Merge bar` 始终运行，文档-only 也要求二者成功。L2 事件继续使用 `acceptance-quality` 作为这些泳道的兄弟汇总门；`acceptance-local-non-hdc` 通过权威 `acceptance:gate0` 让 visual 与 full browser 共用独占运行时，在 `main` / 夜间 / 标签 `full-acceptance` / 手动 `local-non-hdc` 归档证据。完整证据 finalizer 成功后只上传 `test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip`，live runs root 绝不作为 upload 输入。以后若打开 branch protection，required check 只设 `Merge bar`。

## 有界浏览器夹具检查

EFF 夹具工作复用原有自有 Gate0 runtime 与原生验收配置，保持一个 worker、仅模拟器调试及原 warmup 依赖。有界回归集包括 `product-feedback.acceptance.spec.ts` 原三项、`parameter-files.acceptance.spec.ts` 的上传/列表/同步项，以及 `debugging-simulator.acceptance.spec.ts` 的读/写/替代回读/回滚/审计项：五个场景加 warmup，必须取得六项实际原生结果，且无跳过或 flaky。保留嵌套临时语义 runtime 的清理 manifest 和产物 finalizer。旧 SHA 结果、无 descriptor 运行及模拟器回滚不能当作当前 main 全量或目标/设备验收。本次夹具修复不引入分片、重试、golden 更新或覆盖裁剪。

## 补充命令

| 命令 | 证明内容 | 使用场景 |
| --- | --- | --- |
| `npm run acceptance:quality` | consistency（含 collector）、compact、visual、a11y 和 responsive 的质量门禁脚本/规格文件元数据及项目注册；配置在产品规格之前运行 `runtime-warmup`。元数据通过不代表浏览器执行通过。 | 修改 package 脚本、质量 Playwright 配置或质量规格文件位置后使用。 |
| `npm run verify:plan -- --base <40-hex-SHA> [--head <40-hex-SHA>]` | 对 clean 已提交仓库输出有界、只读的 JSON 影响预览，核对 base、逻辑 head、实际 checkout SHA/tree 和唯一 diff base。完整必需任务保留，`executable:false`、`acceptancePending:true`、shadow/observation-pending，memo 禁用。 | 从仓库根目录在提交后运行。拒绝 dirty、冲突、shallow、partial 和不安全 Git 配置，不自动 fetch。head 默认实际 HEAD；指定不同 head 时，实际 HEAD 必须恰以提供的 base/head 为有序双亲。不执行测试，不探测 npm/运行环境。edit profile、输出路径与 enforce 参数尚不可用。本地原始路径不自动上传。 |
| `npm run verify:run -- --base <40-hex-SHA> --task <ci-changed-paths\|feedback-frontend-client> [--force]` | 重新发现并执行一个固定本地任务：原有 changed-path 脚本文件，或五个反馈前端/client 文件。核对 Git、源码、依赖、环境身份和非零原生计数；任务失败与清理错误保持失败。 | 从 clean 已提交仓库根目录运行。每次调用均重新执行，`--force` 也相同。手工任务不代表完整验证计划或验收门禁。所属完整日志、原生 JSON 与 `record.json` 保存在 `work/verification-runs/<UUID>/`；没有 PG、浏览器、Hosted、目标环境或缓存结果适配器。 |
| `npm run verify:report -- --run <UUID>` | 有界校验并读取已保存本地记录，标注 `scope:recorded-local-data`、`freshness:unverified`、memo 禁用及验收待完成。 | 使用新执行返回的 UUID。此命令不运行测试，不能授权复用或当前验收；缺失、畸形或身份不匹配证据均拒绝。其他验证继续使用原生命令。 |
| `npm run catalog:lane:env -- provision --issue <n>` | 在 `127.0.0.1:55438` 上隔离 pgvector 数据库 `wiseeff_lane_<n>`；拒绝 compose `5432/wiseeff` | 任何 Wayfinder #668 PostgreSQL 节点开始前。 |
| `npm run catalog:lane:env -- doctor --issue <n>` | pgvector 可用；角色存在时 `catalog_migration_owner` 能对 `public.parameter_specs` 做 canary | RBAC/migration/catalog-kernel PG 证据的 Hosted 前。 |
| `npm run catalog:lane:accept -- --issue <n> -- <issue-named command>` | 在专用 lane DB 上跑 Issue 点名 focused tests；收集到 0 个文件是硬失败 | 精确候选的本地门禁。Hosted 仍只是 H，不能替代该 PG/L 证据。 |
| `npm run catalog:compile-vendor [-- --out <bundle.json>]` | 以 `schemas/dts/catalog.json` 去掉退役/歧义夹具，编译 `crel_acme_1` 的后继 `crel_vendor_catalog_1`，并打印冻结 digest | 修改厂商 YAML、`catalog.json` 或 D1 后继编译器后。不是 CP-09 生产导入路径；新正式 ID 由服务端分配不透明身份。 |
| `npm run catalog:install-release -- <bundle.json> --confirm-digest sha256:... [--mode advance --expected-current-id ... --expected-current-digest ...]` | 仅在 `catalog_activation_receipts` 为空时允许的管理面 Catalog bootstrap 或 advance；需要 `DATABASE_URL`。一旦存在 Receipt，命令失败为 `catalog-install-publication-regime-required` | 未接管实例上的首次夹具发布或历史 D1 厂商后继。禁止由应用启动调用，禁止第二次 bootstrap，禁止 skip-authorization 旁路。 |
| `npx tsx scripts/catalog-publication-ops.ts <inspect\|adopt\|capabilities\|policy\|freeze>` | 操作员预检/接管/授权/策略/冻结，封装已有 collector、`adoptPreexistingCatalog`、`revisePublicationPolicy` 与 `setPublicationFreeze`。`policy status/check/enable/disable` 覆盖隔离启用与正式实例身份引脚。 | 自托管 Catalog 发布操作。见 `ops/self-hosted/catalog-publication.zh-CN.md`。 |
| `WISEEFF_CATALOG_DELIVERY_ACCEPTANCE=1 npm run catalog:publication:delivery-accept` | 隔离正式镜像 M1：接管、真实账号发布、Receipt/current、DTS ingest、工作台存值、第二次发布、重启回读；ID 绑定本轮 | 正式镜像/Compose 对临时 pgvector。缺前提非零退出。不是生产启用。 |
| `npm run dtc:check -- --required` | PATH 上存在真实 Device Tree Compiler | M1 seed、DTS 校验或自托管镜像验收前使用。 |
| `npm run dtc:seed:compile` | Aurora、Nebula、Atlas 三份已提交 overlay 均通过真实 `dtc -@` 编译 | 修改 DTS fixture、seed 生成、验证门禁或 dtc 部署流程后使用。 |
| `npm run dts:toolchain:bootstrap` | 项目 venv 安装钉扎 dtschema；dtc/fdtoverlay 匹配 `tools/dts-toolchain/versions.json`（复用宿主或构建钉扎 commit 到 `.wiseeff-tools/dts-toolchain`） | 首次本地设置，或修改 requirements/version pin 后。 |
| `npm run dts:toolchain:check -- --required` | API/CLI 共享解析器找到 dtc + fdtoverlay + 项目本地 dt-validate，且版本与钉扎一致 | 发布模式校验或身份切换演练前；不得把个人 Python PATH 导出作为必要步骤。 |
| `npm run parameter-identities:check` | 语义身份迁移只读预检/后检 | 维护窗口前后；见 cutover runbook。 |
| `npm run parameter-identities:migrate` | 默认 dry-run，或门禁后的 `--apply` 历史迁移 | 仅切换演练；生产禁止双写。 |
| `npm run parameter-definitions:reconcile -- --dry-run` / `--apply --organization-id <id>` | 经审计的生效驱动定义对账；dry-run 分类 blocker，apply 按组织原子修复 | Issue #649 维护窗口；先做快照，遇 blocker 立即停止。 |
| `npm run parameter-definitions:check [-- --organization-id <id>]` | 独立完整只读的生效目录/绑定一致性门禁 | 目录迁移前后及配置修订发布前。 |
| `npm run parameter-definitions:check -- --catalog-only` | 自托管候选就绪使用的规范驱动身份/版本/schema/属性/放置子门禁 | `upgrade.sh` 内自动运行；诊断存量升级时可手工运行。不能替代配置发布完整门禁。 |
| `npm run test:server -- server/modules/parameter-specs/populatedUpgrade.integration.test.ts --run` | 真实 PostgreSQL pre-`0127` 存量升级至 `0128`，覆盖规范放置、同 key 自动主体切换、未决证据保留、binding 迁移与 curated 失败关闭 | 修改生效驱动迁移、验证或放置修复后。 |
| `npm run test:server -- server/modules/parameter-topology/legacyDependencyGuard.test.ts --run` | Vitest **源码扫描**（非运行时中间件），禁止在 migrations/cutovers/adapters/scripts/tests 之外出现已退役扁平身份/shadow token | 修改 cutover 后工作流、可能重新引入遗留 SQL 或 shadow PPV helper 后。 |
| `npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameters/seedM1DtsFiles.test.ts server/modules/parameter-specs/matcher.test.ts --run` | 锁定黄金拓扑计数：**200** 属性 occurrence、**600** 行 `dts_properties` seed | 修改 DTS seed fixture、ingest 或 matcher 覆盖后。 |
| `npm run test:scripts -- scripts/vendorDtSchemaGenerator.test.ts --run` | 黄金 DTB 真实 `dt-validate`；负例 DTB 按预期失败 | 修改厂商 dt-schema 生成或 linux-binding schema 后。（`test:server` 不包含 `scripts/**`，直接传该路径会静默零执行。） |
| `npm run test:scripts` | ops/治理脚本套件（`scripts/**`、`ops/**`，Node 环境） | 修改脚本或 ops 自动化后。 |
| `npm run typecheck` | 使用与 `npm run build` 第一阶段相同的 4096 MiB 堆空间，检查 `tsconfig.json` 引用的 TypeScript 项目（`tsconfig.app.json` 和 `tsconfig.node.json`） | 仅用于编辑反馈；交付前仍须运行 `npm run build`，因为此命令不包含 Vite 生产构建。 |
| `npm run selfhost:setup` | 按向导答案渲染自托管 `.env` | 本机已有 Node.js 22 时使用。服务器用 `ops/self-hosted/scripts/setup.sh`。 |
| `npm run selfhost:doctor` | 校验已生成的 `.env` 与 Caddyfile | 配置完成后、或 `compose up` 前。 |
| `npm run selfhost:ip-lab:init` | 为无域名 IP 实验室生成 `ops/self-hosted/.env` | 兼容辅助。优先 `setup.sh` 或 `selfhost:setup`。 |
| `npm run selfhost:ip-lab:preflight` | 校验 IP 实验室 `.env` 与选定 Caddyfile | IP 实验室 `compose up` 前，或改过实验室环境变量后。 |
| `npm run selfhost:ip-lab:provision` | 导入 M0–M3（`WISEEFF_LAB_SEED=none` 时跳过）并把实验室管理员挂到 ChargeLab | 栈就绪后在 API 容器内执行。 |
| `npm run observability:check` | 校验监控 Compose profile、运维入口、自动 provisioning、四套 Dashboard、告警、全服务探针、runbook 链接和 secret hygiene | 修改监控栈或 worker 私网指标端点后使用；另在 `ops/self-hosted/` 运行 `./scripts/compose --env-file .env --profile observability config --quiet`。 |
| `npm run ui:check` | UI 设计系统棘轮门禁:逐规则统计令牌块之外的裸颜色/裸 `z-index`/裸 `font-size`/手写 `box-shadow`/`ease` 关键字,以及 `window.confirm`、手写 modal-backdrop、固定英文残留清单,计数不得超过 `scripts/ui-standards-baseline.json` | 涉及样式、令牌、弹窗、动效或可见 UI 文案的前端变更后使用;计数下降时在同一变更里运行 `npm run ui:check -- --update-baseline` 下调棘轮。 |
| `npm run lint` | eslint 9 flat config（`jsx-a11y` + `react-hooks`）作用于 `src/**/*.{ts,tsx}`:零违规规则为 error,存量规则为 warn 且计数记录在 `eslint.config.js` | 任何 `src/` TypeScript/React 变更后使用;error 阻断,warn 是已记录的待清偿存量。 |
| `npm run bridge:test` | 设备桥工作区套件（`packages/**`，Node 环境） | 修改 device-bridge 或 device-command-core 后。 |
| `npm run bridge:package:check` | 已发布的 Bridge 制品、`clientVersion` 与 `sourceFingerprint` 与当前 `packages/device-bridge` 运行时源码一致；便携包仍包含 `/connect` 和配对码 `forceRestart` | 修改 Bridge 运行时源码、安装器模板或 `ops/self-hosted/bridge-artifacts` 后。若源码变动但未重建制品，CI L1 static 必须失败。 |
| `npm run test:server -- server/modules/parameter-topology/migration.test.ts --run` | 可运维 `stage-review` → `finalize` 跨 PostgreSQL 事务（重连 + 注入失败） | 修改迁移 CLI 或 staged-run 持久化后。 |
| `npm run test:server -- server/modules/parameter-specs/matcherScope.integration.test.ts --run` | Matcher override locator 指纹隔离；审核 `blocker_scope` 门禁 | 修改 matcher override 或审核阻断作用域后。 |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-topology/schemaMigration.test.ts server/modules/parameters/schemas.test.ts --run` | 精确 draft/action/candidate identity、双连接 draft+candidate 锁、原子 `pending_approval` 推进、0060→0061 失效与 0062→0063 回滚/幂等、merge 复核、base revision 不可变 | 修改 typed 提交、0059–0063、set/delete 合入回写、并发或 binding revision 后。需 PostgreSQL。 |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-topology/schemaMigration.test.ts server/modules/parameters/routes.test.ts --run` + `npx vitest run src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx` | 显式 draft/binding/spec/action/candidate wire identity、legacy 拒绝、candidate 状态与 proof 复核、迁移 0059–0063，以及项目切换隔离 | 修改 typed binding 提交、项目切换、0059–0063、candidate locking 或 write lock 后。服务端集成需 PostgreSQL。 |
| `npx vitest run scripts/check-operation-evidence.test.ts scripts/run-browser-acceptance.test.ts` + `npm run acceptance:evidence` | full run 的 record/artifact 按 runId+sourceCommit 隔离；focused 不覆盖 `latest-full`；混合运行和缺失 artifact fail-closed。凡按 expected full run 校验的 record 都必须携带 owned-runtime 证明；report/trace 必须是 runRoot 下真实存在的普通后代，且顶层 record 与 expected run identity 都必须绑定经 SHA-256 复核的不可变 snapshot。若记录发生在 owned Gate0 nested disposable runtime 中，仍保留父运行证明，并把 child 的精确 ID、数据库、对象根、URL、PID 与 process-start identity 绑定到父 nested manifest；最终校验要求 child 终态为 `cleaned`，两个进程均 stopped，数据库与对象根均 removed。descriptor-free focused/legacy disposable 运行仅保留基础 runtime 元数据，不能满足 full-run owned-proof 门禁。 | 修改 Playwright output、operation evidence helper、browser runner 或 checker 后。 |
| `npm run acceptance:evidence -- --run <运行目录> [--require <操作ID列表>]` | focused 运行一等证据校验（TD-088）：校验 `test-results/acceptance-evidence-runs/runs/<commit>/<runId>` 下单个运行目录内的记录（司法元数据 + 声明断言必须有对应载荷）；`--require` 在列出的操作未被覆盖时判失败。结果写入该目录的 `evidence-check.{md,json}`，绝不改写 docs/generated 全量索引。 | 单 spec focused 验收运行之后、引用其证据之前；无参数缺省行为不变。 |
| `npm run acceptance:a11y` / `acceptance:visual` / `acceptance:responsive` / `acceptance:e2e` | 质量与验收 Playwright 配置在产品用例前运行 `runtime-warmup`：webServer ready 后通过 `page.goto` 加载 SPA 入口，Vite 首次 transform 不计入首条产品用例超时 | 修改质量/验收 Playwright 配置或冷启动预热后。 |
| `npm run seed:quality:visual-review` / `npm run cleanup:quality:visual-review` | 只在可丢弃质量库安装/清理 populated review 视觉 fixture；命令校验 `current_database()` 与固定 ID 精确归属 | 必须同时设置 `WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true` 和 `WISEEFF_QUALITY_FIXTURE_DATABASE_NAME=<current_database()>`。外部 Gate0 从自有数据库 descriptor 派生期望库名。Target synthetic 不设置两者，只 planned-skip populated `/parameter-review` 视觉用例，其余视觉及全部 a11y/响应式覆盖保持只读执行。 |
| GitHub Actions `Acceptance quality` Linux 视觉基线 | 合并权威的 Linux 渲染环境；下载失败工件并在原始分辨率逐张检查 actual PNG | 只把已审查的精确失败图片复制到 `visual.quality.spec.ts-snapshots/linux/`。本地 MCR Playwright arm64 容器只作预检；其中文字体度量或 seed 身份可能与 GitHub runner 不同，容器像素不能作为基线权威。截图交互态前，visual spec 必须用正向 DOM 断言锁定 production/HMAC 可见 fixture 身份。 |
| 候选视觉基线复核（#1172） | visual lane 仅因已有 Linux 截图比较失败时，CI 上传 `wiseeff-visual-baseline-review`：自包含 `index.html`，按基线展示 expected/actual/diff，以及 Git 二进制 `candidate.patch` | 生成器读取失败 lane 原始的 `$RUNNER_TEMP/wiseeff-ci-shard/results.json`。断言、运行时、compact 项目、缺失基线、中断、重试、全局失败，以及截图三件套不完整或替换冲突时，不发布候选。它不修改已跟踪基线，也不改变门禁失败结果。打开图库，使用图片的浏览器右键菜单单独打开，在原始分辨率逐张复核；必须由人明确批准每张替换。在失败 run 精确 head 的干净 checkout 中先运行 `git apply --check /absolute/path/candidate.patch`，批准后才运行 `git apply --binary /absolute/path/candidate.patch`。复核仅含基线的 diff，走正常 PR 流程，并在 GitHub Actions Linux 上重跑正常比较，不使用 `--update-snapshots`。下载候选、成功应用补丁、本地或容器渲染均不是验收。 |
| 视觉遮罩约定 | 优先固定 fixture/时钟；否则只在 `stableMasks`（`e2e/quality/helpers.ts`）中遮罩已记录的易变值，不为过关而新增遮罩控件或整个交互区域 | 必需 route 遮罩包含 seed 时间单元格、参数行、现有 Catalog anchor/workspace、按日期变化的趋势图、审核标识/时间和日志时间；缺失定位器在截图前失败。shell 用户/历史/audit/live-region、条件 Catalog banner、bridge 配对数字/过期时间、日志 metadata/confidence fill 仅因目标状态可能未挂载而为可选；只在匹配非空时纳入。`resolveVisualMasks` 返回截图遮罩前再次检查所有已纳入定位器；零匹配即失败，包括解析过程中消失的可选区域。保留既有 seed 行数量和可见性断言。已知 seed 状态应添加必需定位器，不能借可选遮罩绕过坏 selector；每个 route/state 的解析需在真实 quality run 中证明。 |
| `npm run acceptance:gate0` | owner 在创建任何数据库、对象根或进程之前，先执行公开的钉扎门禁 `npm run dts:toolchain:check -- --required`；CI 由 `setup-dts-toolchain` 安装，本地操作者另行显式 bootstrap，Gate0 本身绝不联网安装依赖。之后创建 checked-absent `wiseeff_acceptance_full_*` 数据库并完成 migrate/seed/marker 证明，创建 checked-absent run-scoped 对象根和精确 loopback API/frontend 进程，再把同一份不含秘密的 descriptor 交给 visual 与 full browser。未知监听者以及 PID/DB/object marker 不匹配均 fail-closed。`CREATE DATABASE` 前先原子写入精确创建意图；若 create 响应丢失，则使用独立有界的 admin 重连把数据库判定为存在、不存在或未知，`provision-failure.json` 会把存在/未知目标记录为 `unverified-no-marker`，在精确 marker 证明成功前拒绝破坏性清理。phase 与 nested child 环境都从最小 OS 启动 allowlist 加本轮精确 owned 变量重新构造；Playwright config 与 27 个原 dotenv-backed acceptance spec 统一经过 owned-runtime-aware helper：descriptor 先校验，descriptor-free nested worker 使用显式 owned flag，两种 owned 路径都不得隐式读取工作树 `.env`；legacy/manual runner 继续显式加载所选 env file。`PGPASSWORD`、`DOCKER_AUTH_CONFIG`、`GIT_ASKPASS`、CI JWT、通用 secret key 与无关宿主设置都不会因继承进入 child。嵌套 disposable suite 在第一个外部资源创建前先写 `provisioning` 清单，随后由 tracked-spawn handshake 同步登记 migration identity 与 detached PID；清单原子写入，并使用原子发布的 PID/token/parent-run/process-start 锁串行化：锁龄不能证明失效，仅死 owner 或已证明的 PID 复用可恢复。根 owner 在 finalize 时读取该清单：成功前每个 child 必须终态为 cleaned；Playwright 非预期失败只停止 child 进程，child DB/object 以 `failed-retained` 留存；timeout/crash 则接管部分 provision、running 与可重试的 `cleanup-failed` child，直到进程清理稳定。 | TD-122 的权威本地 L2 基线。60 分钟 owner 硬时限从进程入口开始，覆盖 DTS、source check、provision、HTTP startup、两阶段、进程停止、artifact finalize 和 cleanup；operation deadline 会在硬时限前 5 分钟启动收尾，因此 prerequisite 与 provision 也不能耗尽 finalize 预算。`SIGINT`/`SIGTERM` 会取消 provision/phase，但进程在同一套有界失败收尾完成前不会退出。全部 Playwright output/report/snapshot、preflight、浏览器/operation evidence、日志、trace、截图、清单和 inventory 都写入独占 runRoot；operation record 使用真实存在的 report/trace 后代与不可变 runtime snapshot digest，不哈希可变 descriptor bytes。失败保留精确 DB/object/descriptor/artifact 并记录清理状态；只有成功才删除精确 DB/object。root 与 nested 本轮生成 secret 仅在带 token 的 loopback registry 原子发布加密 exact-value 上下文后才 ACK；Gate0 在递归文本/ZIP 脱敏与 fail-closed scanner 前先封存 writer，manifest 始终不含 secret。不支持格式或二进制一旦命中凭据即 fail-closed；普通路径和 ZIP entry name 也会以不泄密的 artifact ID 扫描，且 `npm run acceptance:artifacts:check -- --root test-results/acceptance-runtime-runs` 必须为 0 violation。该基础 PR 本身不关闭 TD-122。 |
| Gate0 ownership 补充合同 | root descriptor 生成前的 provision failure 必须逐进程记录 PID、端口、命令、日志及 cleanup 状态/原因。nested object root 必须是 parent runRoot 内 checked-absent、带 marker 的普通后代；递归删除前重新验证 realpath、marker 与 symlink 祖先。tracked spawn 同步持久化 PID、端口与 OS process-start identity；一旦持久化，PID/端口/start-token/command-digest identity 在进入 ready 前后都不可变。stale-lock 恢复先 hard-link 一个独占 recovery claim，再复核同一 inode、token 与 owner 后才 unlink，因此并发 stale waiter 不会删除替换后的 live lock。parent takeover 每次 signal 前重新读取 identity，不确定或不匹配时禁止 kill，并保留 `cleanup-failed`。 | hard 60 分钟截止覆盖最终资源操作；各 finalizer 消费 hard-deadline signal，公开 CLI 与 hard deadline 竞速，因此忽略取消的 finalizer 也不能延长终态边界。 |
| Gate0 fixed-point 安全合同 | root owner、visual/browser phase group、root/nested API/frontend 都持久化精确 process-start identity；TERM、KILL 分别在发信号前重新验证持久 identity。root 或 nested PID 已退出时，只有 process identity 读取为空、内核 PID 不存在且已登记 loopback port 无监听者三项同时成立，才会在不发信号的情况下记为 stopped；live 或 identity 不匹配的 PID 仍 fail-closed。process-group 探测出现瞬时 `EPERM` 时，会在有界 verification grace period 内重试，且绝不会把 `EPERM` 判为进程不存在。root provisioning 在 run 目录可见前先原子发布不含秘密的 journal，并显式记录 migration/seed/API/frontend 状态。它的 rename 前 durable staging 位于 live runs root 的私有同级目录，因此不会被枚举成 child run；fresh finalizer 只有在证明精确 owner 已退出后才会 promote。provision 命令、root/nested runtime 与 visual/browser phase 命令共用受控启动协议：先落 durable intent，process-group launcher 自行发布 PID/start identity，父进程 ACK 前真实命令不得 exec。因此 owner 遭 `SIGKILL` 后，fresh finalizer 能接管“API 已登记、frontend 明确 not-started”、phase identity 回写中断等 partial writer；未知或 PID reused 时绝不 signal，DB/object 始终保留取证。nested manifest 初始版本从同父目录的 durable 私有 candidate 以原子 no-replace 方式发布；损坏、半写、歧义或语义不可能的 manifest 一律 fail-closed，crash candidate 只会在所有可证明 writer 停止后被 promote。recovery owner 与 reclaimer 崩溃残留 link 只在 dead/expired identity 加 inode/token 证明后回收。每次 exact secret 注册在 ACK 前原子发布加密二扫上下文。exact context 会保留到私有 staging 与其中生成的单一 ZIP 都达到 0 violation；之后才原子发布只读 ZIP 并退役 registry。artifact safety 会递归脱敏/扫描 nested ZIP（含 magic sniff 识别的改名 ZIP）；raw envelope 校验会在上传前拒绝重复/不安全路径、前后附加数据、加密或不支持压缩、metadata 凭据、CRC/尺寸不一致，以及整棵树范围的深度、entry 数、解压总量与膨胀率超限。精确位于 Playwright 直接报告资源、报告数据 ZIP 或本轮 owned trace ZIP 资源路径下的可打印 UTF-8 文本按报告文本脱敏；任意其他路径、二进制附件或含禁用控制字符的文本仍 fail-closed。CI 只上传该精确 ZIP，绝不上传 live runs root。nested object intent 在首次 mkdir 前登记；启动失败保留 DB/object 证据，没有 marker/cutover 证明的数据库绝不 drop。root 与 nested object cleanup 会持久化 provision 时的目录 identity chain，只原子隔离已证明的 root，并在递归删除前再次验证每个祖先、inode、realpath 与 marker。CI timeout 统计不依赖 YAML step 键顺序，枚举全部 step。 | 修改 Gate0 provision、进程清理、manifest lock、artifact safety、不可变上传 finalizer 或 CI workflow 解析后，运行聚焦 scripts 测试与 `npm run acceptance:ci`。 |
| `npm run test:server -- server/modules/parameter-catalog-api/legacy/*Retirement.integration.test.ts server/modules/parameter-catalog-api/productionComposition.integration.test.ts server/modules/parameter-files/canonicalBatchRollbackHttp.integration.test.ts` | 组装服务的 Spec/overlay/identity 退休合同：410、后继链接、可信拒绝审计和无 DML；canonical 精确身份、租户、执行来源与原子源写入负向验证 | 修改退休合同或 canonical owner 后。需要 PostgreSQL。旧 Spec/overlay 成功写入实现及其成功测试已删除（#1084）。 |
| `npm run acceptance:e2e -- e2e/acceptance/parameter-topology.acceptance.spec.ts` | 融合 `/parameters` 工作台证明语义搜索、真实源/生效嵌套选择、`gpio_int` 行/raw/shape/provenance 详情、本轮修改区、真实 set/delete typed draft→submit→角色审核→merge/writeback/reload 与 base 不可变性；自动创建、标记、cutover、校验并销毁可丢弃数据库。因当前无 delete 控件，delete 创建/提交走公开 API，全部角色决议/merge 仍走 UI。 | 修改 DTS 工作台/树/详情/本轮修改区、拓扑验收辅助、规格审核 UI、set/delete 回写或不可变合入行为后。`DATABASE_URL` 仅提供 PostgreSQL 服务端/管理连接；生成库名、test marker、cutover migration run 任一不匹配时拒绝破坏性清理。 |
| `npm run parameter-identities:migrate -- --stage-review` / `--finalize` | 维护窗口推断迁移暂存与原子 finalize（仅临时库演练） | Cutover 演练；见 `docs/runbooks/parameter-identity-cutover.md`。`parameter_identity_migration_phases` 行不可变；推断任务携带 `migration_run_id`。**TD-042 未关闭前不得宣称生产就绪。** |
| `npm run db:seed:m1` 连续执行两次 | 全量参数、DTS 结构、版本与基线可幂等刷新 | 修改 M1 seed 或结构化 ingest 后使用；版本数和历史数不得因无变化重跑而增长。 |
| `npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts` | 本机真实 HDC 前端/API/设备写入、回读和回滚证据 | 已连接审批过的本机 HDC target，并配置 `DEBUG_DEVICE_GATEWAY_MODE=hdc`、`HDC_DEVICE_LAB_AVAILABLE=true`、`HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write` 和 `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback` 时使用。默认自动准备 lab-only 临时文件节点。 |
| `npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts` | 本机真实 ADB 前端/API/设备证据 | 已连接审批过的本机 ADB 设备，并配置 `DEBUG_DEVICE_GATEWAY_MODE=adb` 与 `ADB_DEVICE_LAB_AVAILABLE=true` 时使用。默认只读，除非设置 `ADB_SMOKE_ENABLE_WRITE=true`。 |
| `npm run acceptance:e2e -- e2e/acceptance/xiaoze-planning.acceptance.spec.ts` 及 `npm run test:server -- planningGraph checkpointer suggest agUiEndpoint` | 小泽 P2 规划循环、checkpoint resume（确定性验收用 memory；生产用 Postgres）、只读主动 suggest、`useXiaozeSuggestions` / `AgentInsightBar`（`XIAOZE-PLAN-MULTISTEP-001`、`XIAOZE-PROACTIVE-001`） | 离线使用 `XIAOZE_DETERMINISTIC=true`；live 目标环境配置 `XIAOZE_LLM_API_BASE_URL`、`XIAOZE_LLM_MODEL`、`XIAOZE_LLM_API_KEY`。主动建议验收另需 `XIAOZE_PROACTIVE_ENABLED=true` 与 `VITE_XIAOZE_PROACTIVE_ENABLED=true`。 |
| `npm run test:server -- durableCheckpointer checkpointer env`；可选 `npm run test:server -- durableCheckpointer.integration`（需 `DATABASE_URL` 或 `XIAOZE_CHECKPOINTER_TEST_DATABASE_URL`） | Postgres LangGraph checkpoint 工厂、生产 env 门禁、migrate 建表、跨实例 resume 证明（TD-029） | 集成证明需 PostgreSQL；单元测试默认 memory，CI 无需 live DB。 |
| `npm run logs:eval` | 日志分析行为层评测（确定性假模型，CI 门禁）：证据接地、诚实降级标注、analysisQuestion 注入、prompt version 记录、循环工具调用合法性、步数/预算收敛、诚实拒答与 meta 自检 | 修改日志分析提示词、`llmAnalyzer`、`agentLoop`、工具、prefilter、降级链或评测场景后使用；输出 `docs/generated/log-analysis-eval.{json,md}`。 |
| `npm run logs:eval:quality` | 日志分析效果层评测（金标准案例集）：证据行重叠、幻觉率、拒答恰当率、rubric judge 根因打分、基线门禁、judge 校准抽样 + judge-human 一致性（P3b） | 提示词/模型变更与发布前使用。确定性演示：`LOG_ANALYSIS_DETERMINISTIC=true npm run logs:eval:quality`；输出 `docs/generated/log-analysis-quality.{json,md}` 与复核清单 `docs/generated/log-analysis-judge-sample.md`；门禁将 realLog 案例与 `eval-cases/logs/baseline.json` 比较（案例集无真实案例时不激活）；一致性读取 `eval-cases/logs/reviews/*.yaml`。 |
| GitHub Actions `log-analysis-quality-gate.yml` | 定时/手动的质量门禁自动化：以确定性模式跑带门禁的 `logs:eval:quality` 并把报告上传为工件 | 发布检查单：提示词/模型/内核/金标准集变更后手动触发（workflow_dispatch）；每周定时跑一次作漂移监控。基线门禁激活且违反、或存在加载/复核文件问题时失败；工件读法见 `docs/zh-CN/runbooks/log-analysis-llm.md`。 |

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
