# 验证矩阵

> English: [English](../../developer/verification-matrix.md)

这是日常开发文档，帮助开发者完成本地启动、环境配置、验证选择和验收覆盖判断。

## 使用方式

- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；如果只更新一侧，`npm run docs:check` 应阻止完成。
- 若中文页与源码、测试或英文页冲突，以源码、测试和当前英文页为准，并在同一变更中修正中文页。

## 关键阅读点

- 先确认该文档属于哪个决策面：developer。
- 阅读英文版中的完整细节、表格和命令，再用本页确认中文语境下的执行边界。
- 任何 target-environment readiness、pilot-ready、release-ready 结论都必须有真实目标环境证据，不能由本地 skip 代替。
- M5.12：PR 合入门槛是 L1 + `@ci-smoke`（产品路径）+ 一次 `acceptance:quality-run`（UI/产品路径）。L2 事件把 `acceptance-quality` 当兄弟 job；`acceptance-local-non-hdc` 通过权威 `acceptance:gate0` 让 visual 与 full browser 共用一个独占运行时，并在 `main` / 夜间 / 标签 `full-acceptance` / 手动 `local-non-hdc` 归档证据。文档-only 只跑 `docs:check` 与哨兵 `Merge bar`。以后若打开 branch protection，required check 只设 `Merge bar`。

## 补充命令

| 命令 | 证明内容 | 使用场景 |
| --- | --- | --- |
| `npm run dtc:check -- --required` | PATH 上存在真实 Device Tree Compiler | M1 seed、DTS 校验或自托管镜像验收前使用。 |
| `npm run dtc:seed:compile` | Aurora、Nebula、Atlas 三份已提交 overlay 均通过真实 `dtc -@` 编译 | 修改 DTS fixture、seed 生成、验证门禁或 dtc 部署流程后使用。 |
| `npm run dts:toolchain:bootstrap` | 项目 venv 安装钉扎 dtschema；dtc/fdtoverlay 匹配 `tools/dts-toolchain/versions.json`（复用宿主或构建钉扎 commit 到 `.wiseeff-tools/dts-toolchain`） | 首次本地设置，或修改 requirements/version pin 后。 |
| `npm run dts:toolchain:check -- --required` | API/CLI 共享解析器找到 dtc + fdtoverlay + 项目本地 dt-validate，且版本与钉扎一致 | 发布模式校验或身份切换演练前；不得把个人 Python PATH 导出作为必要步骤。 |
| `npm run parameter-identities:check` | 语义身份迁移只读预检/后检 | 维护窗口前后；见 cutover runbook。 |
| `npm run parameter-identities:migrate` | 默认 dry-run，或门禁后的 `--apply` 历史迁移 | 仅切换演练；生产禁止双写。 |
| `npm run test:server -- server/modules/parameter-topology/legacyDependencyGuard.test.ts --run` | Vitest **源码扫描**（非运行时中间件），禁止在 migrations/cutovers/adapters/scripts/tests 之外出现已退役扁平身份/shadow token | 修改 cutover 后工作流、可能重新引入遗留 SQL 或 shadow PPV helper 后。 |
| `npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameters/seedM1DtsFiles.test.ts server/modules/parameter-specs/matcher.test.ts --run` | 锁定黄金拓扑计数：**176** 属性 occurrence、**528** 行 `dts_properties` seed | 修改 DTS seed fixture、ingest 或 matcher 覆盖后。 |
| `npm run test:scripts -- scripts/vendorDtSchemaGenerator.test.ts --run` | 黄金 DTB 真实 `dt-validate`；负例 DTB 按预期失败 | 修改厂商 dt-schema 生成或 linux-binding schema 后。（`test:server` 不包含 `scripts/**`，直接传该路径会静默零执行。） |
| `npm run test:scripts` | ops/治理脚本套件（`scripts/**`、`ops/**`，Node 环境） | 修改脚本或 ops 自动化后。 |
| `npm run selfhost:setup` | 按向导答案渲染自托管 `.env` | 本机已有 Node.js 22 时使用。服务器用 `ops/self-hosted/scripts/setup.sh`。 |
| `npm run selfhost:doctor` | 校验已生成的 `.env` 与 Caddyfile | 配置完成后、或 `compose up` 前。 |
| `npm run selfhost:ip-lab:init` | 为无域名 IP 实验室生成 `ops/self-hosted/.env` | 兼容辅助。优先 `setup.sh` 或 `selfhost:setup`。 |
| `npm run selfhost:ip-lab:preflight` | 校验 IP 实验室 `.env` 与选定 Caddyfile | IP 实验室 `compose up` 前，或改过实验室环境变量后。 |
| `npm run selfhost:ip-lab:provision` | 导入 M0–M3（`WISEEFF_LAB_SEED=none` 时跳过）并把实验室管理员挂到 ChargeLab | 栈就绪后在 API 容器内执行。 |
| `npm run observability:check` | 校验监控 Compose profile、运维入口、自动 provisioning、四套 Dashboard、告警、全服务探针、runbook 链接和 secret hygiene | 修改监控栈或 worker 私网指标端点后使用；另在 `ops/self-hosted/` 运行 `./scripts/compose --env-file .env --profile observability config --quiet`。 |
| `npm run ui:check` | UI 设计系统棘轮门禁:逐规则统计令牌块之外的裸颜色/裸 `z-index`/裸 `font-size`/手写 `box-shadow`/`ease` 关键字,以及 `window.confirm`、手写 modal-backdrop、固定英文残留清单,计数不得超过 `scripts/ui-standards-baseline.json` | 涉及样式、令牌、弹窗、动效或可见 UI 文案的前端变更后使用;计数下降时在同一变更里运行 `npm run ui:check -- --update-baseline` 下调棘轮。 |
| `npm run lint` | eslint 9 flat config（`jsx-a11y` + `react-hooks`）作用于 `src/**/*.{ts,tsx}`:零违规规则为 error,存量规则为 warn 且计数记录在 `eslint.config.js` | 任何 `src/` TypeScript/React 变更后使用;error 阻断,warn 是已记录的待清偿存量。 |
| `npm run bridge:test` | 设备桥工作区套件（`packages/**`，Node 环境） | 修改 device-bridge 或 device-command-core 后。 |
| `npm run test:server -- server/modules/parameter-topology/migration.test.ts --run` | 可运维 `stage-review` → `finalize` 跨 PostgreSQL 事务（重连 + 注入失败） | 修改迁移 CLI 或 staged-run 持久化后。 |
| `npm run test:server -- server/modules/parameter-specs/matcherScope.integration.test.ts --run` | Matcher override locator 指纹隔离；审核 `blocker_scope` 门禁 | 修改 matcher override 或审核阻断作用域后。 |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-topology/schemaMigration.test.ts server/modules/parameters/schemas.test.ts --run` | 精确 draft/action/candidate identity、双连接 draft+candidate 锁、原子 `pending_approval` 推进、0060→0061 失效与 0062→0063 回滚/幂等、merge 复核、base revision 不可变 | 修改 typed 提交、0059–0063、set/delete 合入回写、并发或 binding revision 后。需 PostgreSQL。 |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-topology/schemaMigration.test.ts server/modules/parameters/routes.test.ts --run` + `npx vitest run src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx` | 显式 draft/binding/spec/action/candidate wire identity、legacy 拒绝、candidate 状态与 proof 复核、迁移 0059–0063，以及项目切换隔离 | 修改 typed binding 提交、项目切换、0059–0063、candidate locking 或 write lock 后。服务端集成需 PostgreSQL。 |
| `npx vitest run scripts/check-operation-evidence.test.ts scripts/run-browser-acceptance.test.ts` + `npm run acceptance:evidence` | full run 的 record/artifact 按 runId+sourceCommit 隔离；focused 不覆盖 `latest-full`；混合运行和缺失 artifact fail-closed | 修改 Playwright output、operation evidence helper、browser runner 或 checker 后。 |
| `npm run acceptance:evidence -- --run <运行目录> [--require <操作ID列表>]` | focused 运行一等证据校验（TD-088）：校验 `test-results/acceptance-evidence-runs/runs/<commit>/<runId>` 下单个运行目录内的记录（司法元数据 + 声明断言必须有对应载荷）；`--require` 在列出的操作未被覆盖时判失败。结果写入该目录的 `evidence-check.{md,json}`，绝不改写 docs/generated 全量索引。 | 单 spec focused 验收运行之后、引用其证据之前；无参数缺省行为不变。 |
| `npm run acceptance:a11y` / `acceptance:visual` / `acceptance:responsive` / `acceptance:e2e` | 质量与验收 Playwright 配置在产品用例前运行 `runtime-warmup`：webServer ready 后通过 `page.goto` 加载 SPA 入口，Vite 首次 transform 不计入首条产品用例超时 | 修改质量/验收 Playwright 配置或冷启动预热后。 |
| `npm run seed:quality:visual-review` / `npm run cleanup:quality:visual-review` | 只在可丢弃质量库安装/清理 populated review 视觉 fixture；命令校验 `current_database()` 与固定 ID 精确归属 | 必须同时设置 `WISEEFF_QUALITY_ALLOW_VISUAL_FIXTURE=true` 和 `WISEEFF_QUALITY_FIXTURE_DATABASE_NAME=<current_database()>`。外部 Gate0 从自有数据库 descriptor 派生期望库名。Target synthetic 不设置两者，只 planned-skip populated `/parameter-review` 视觉用例，其余视觉及全部 a11y/响应式覆盖保持只读执行。 |
| GitHub Actions `Acceptance quality` Linux 视觉基线 | 合并权威的 Linux 渲染环境；下载失败工件并在原始分辨率逐张检查 actual PNG | 只把已审查的精确失败图片复制到 `visual.quality.spec.ts-snapshots/linux/`。本地 MCR Playwright arm64 容器只作预检；其中文字体度量或 seed 身份可能与 GitHub runner 不同，容器像素不能作为基线权威。截图交互态前，visual spec 必须用正向 DOM 断言锁定 production/HMAC 可见 fixture 身份。 |
| `npm run acceptance:gate0` | 一个 owner 创建 checked-absent `wiseeff_acceptance_full_*` 数据库并执行 `db:migrate`、`db:seed:all`，创建 run-scoped 本地对象存储，启动精确 loopback API/frontend 子进程，再把同一份不含秘密的 descriptor 交给 visual 与 full browser。未知健康监听者以及 PID、DB marker、object marker 不匹配均 fail-closed。嵌套 disposable suite 仅在子运行时作用域取消根 descriptor，并把不含秘密的子 DB/object/PID/endpoint 生命周期记入父运行清单。 | TD-122 的权威本地 L2 基线。owner 执行端到端 60 分钟硬超时；超时时先停止当前阶段进程树和精确归属的 API/frontend PID，再保留证据。执行前记录生成文档和 visual snapshot 文件，归档本轮新建/修改文件后恢复运行前的精确内容或不存在状态，使源码工作树回到干净状态。仅两个阶段都通过后精确清理 DB/object；失败时在 `test-results/acceptance-runtime-runs/` 保留数据库、对象、descriptor、preflight、源码输出/嵌套运行时清单、日志、报告、trace、截图和 failure inventory。该基础 PR 本身不关闭 TD-122。 |
| `npm run test:server -- server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts --run` | 手工规格 draft→`activate`→resolve；draft 在激活前不得 resolve | 修改 `createSpec`、activate 路由或规格审核 resolve 后。需 `DATABASE_URL`。 |
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
