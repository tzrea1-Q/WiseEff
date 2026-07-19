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

## 补充命令

| 命令 | 证明内容 | 使用场景 |
| --- | --- | --- |
| `npm run dtc:check -- --required` | PATH 上存在真实 Device Tree Compiler | M1 seed、DTS 校验或自托管镜像验收前使用。 |
| `npm run dtc:seed:compile` | Aurora、Nebula、Atlas 三份已提交 overlay 均通过真实 `dtc -@` 编译 | 修改 DTS fixture、seed 生成、验证门禁或 dtc 部署流程后使用。 |
| `npm run dts:toolchain:bootstrap` | 安装/检查 dtc、fdtoverlay，并把钉扎 dtschema 安装到忽略提交的 `.wiseeff-tools/dts-toolchain` | 首次本地设置，或修改 requirements/version pin 后。 |
| `npm run dts:toolchain:check -- --required` | API/CLI 共享解析器找到 dtc + fdtoverlay + 项目本地 dt-validate，且版本与钉扎一致 | 发布模式校验或身份切换演练前；不得把个人 Python PATH 导出作为必要步骤。 |
| `npm run parameter-identities:check` | 语义身份迁移只读预检/后检 | 维护窗口前后；见 cutover runbook。 |
| `npm run parameter-identities:migrate` | 默认 dry-run，或门禁后的 `--apply` 历史迁移 | 仅切换演练；生产禁止双写。 |
| `npm run test:server -- server/modules/parameter-topology/legacyDependencyGuard.test.ts --run` | Vitest **源码扫描**（非运行时中间件），禁止在 migrations/cutovers/adapters/scripts/tests 之外出现已退役扁平身份/shadow token | 修改 cutover 后工作流、可能重新引入遗留 SQL 或 shadow PPV helper 后。 |
| `npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameters/seedM1DtsFiles.test.ts server/modules/parameter-specs/matcher.test.ts --run` | 锁定黄金拓扑计数：**173** 属性 occurrence、**519** 行 `dts_properties` seed | 修改 DTS seed fixture、ingest 或 matcher 覆盖后。 |
| `npm run test:server -- scripts/vendorDtSchemaGenerator.test.ts --run` | 黄金 DTB 真实 `dt-validate`；负例 DTB 按预期失败 | 修改厂商 dt-schema 生成或 linux-binding schema 后。 |
| `npm run test:server -- server/modules/parameter-topology/migration.test.ts --run` | 可运维 `stage-review` → `finalize` 跨 PostgreSQL 事务（重连 + 注入失败） | 修改迁移 CLI 或 staged-run 持久化后。 |
| `npm run test:server -- server/modules/parameter-specs/matcherScope.integration.test.ts --run` | Matcher override locator 指纹隔离；审核 `blocker_scope` 门禁 | 修改 matcher override 或审核阻断作用域后。 |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-topology/schemaMigration.test.ts server/modules/parameters/schemas.test.ts --run` | 精确 draft/action/candidate identity、双连接 draft+candidate 锁、原子 `pending_approval` 推进、0060→0061 失效与 0062→0063 回滚/幂等、merge 复核、base revision 不可变 | 修改 typed 提交、0059–0063、set/delete 合入回写、并发或 binding revision 后。需 PostgreSQL。 |
| `npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-topology/schemaMigration.test.ts server/modules/parameters/routes.test.ts --run` + `npx vitest run src/components/parameter-topology/ApiProjectTopologyWorkspace.test.tsx` | 显式 draft/binding/spec/action/candidate wire identity、legacy 拒绝、candidate 状态与 proof 复核、迁移 0059–0063，以及项目切换隔离 | 修改 typed binding 提交、项目切换、0059–0063、candidate locking 或 write lock 后。服务端集成需 PostgreSQL。 |
| `npx vitest run scripts/check-operation-evidence.test.ts scripts/run-browser-acceptance.test.ts` + `npm run acceptance:evidence` | full run 的 record/artifact 按 runId+sourceCommit 隔离；focused 不覆盖 `latest-full`；混合运行和缺失 artifact fail-closed | 修改 Playwright output、operation evidence helper、browser runner 或 checker 后。 |
| `npm run test:server -- server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts --run` | 手工规格 draft→`activate`→resolve；draft 在激活前不得 resolve | 修改 `createSpec`、activate 路由或规格审核 resolve 后。需 `DATABASE_URL`。 |
| `npm run acceptance:e2e -- e2e/acceptance/parameter-topology.acceptance.spec.ts` | 融合 `/parameters` 工作台证明语义搜索、真实源/生效嵌套选择、`gpio_int` 行/raw/shape/provenance 详情、本轮修改区、真实 set/delete typed draft→submit→角色审核→merge/writeback/reload 与 base 不可变性；自动创建、标记、cutover、校验并销毁可丢弃数据库。因当前无 delete 控件，delete 创建/提交走公开 API，全部角色决议/merge 仍走 UI。 | 修改 DTS 工作台/树/详情/本轮修改区、拓扑验收辅助、规格审核 UI、set/delete 回写或不可变合入行为后。`DATABASE_URL` 仅提供 PostgreSQL 服务端/管理连接；生成库名、test marker、cutover migration run 任一不匹配时拒绝破坏性清理。 |
| `npm run parameter-identities:migrate -- --stage-review` / `--finalize` | 维护窗口推断迁移暂存与原子 finalize（仅临时库演练） | Cutover 演练；见 `docs/runbooks/parameter-identity-cutover.md`。`parameter_identity_migration_phases` 行不可变；推断任务携带 `migration_run_id`。**TD-042 未关闭前不得宣称生产就绪。** |
| `npm run db:seed:m1` 连续执行两次 | 全量参数、DTS 结构、版本与基线可幂等刷新 | 修改 M1 seed 或结构化 ingest 后使用；版本数和历史数不得因无变化重跑而增长。 |
| `npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts` | 本机真实 HDC 前端/API/设备写入、回读和回滚证据 | 已连接审批过的本机 HDC target，并配置 `DEBUG_DEVICE_GATEWAY_MODE=hdc`、`HDC_DEVICE_LAB_AVAILABLE=true`、`HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write` 和 `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback` 时使用。默认自动准备 lab-only 临时文件节点。 |
| `npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts` | 本机真实 ADB 前端/API/设备证据 | 已连接审批过的本机 ADB 设备，并配置 `DEBUG_DEVICE_GATEWAY_MODE=adb` 与 `ADB_DEVICE_LAB_AVAILABLE=true` 时使用。默认只读，除非设置 `ADB_SMOKE_ENABLE_WRITE=true`。 |
| `npm run acceptance:e2e -- e2e/acceptance/xiaoze-planning.acceptance.spec.ts` 及 `npm run test:server -- planningGraph checkpointer suggest agUiEndpoint` | 小泽 P2 规划循环、checkpoint resume（确定性验收用 memory；生产用 Postgres）、只读主动 suggest、`useXiaozeSuggestions` / `AgentInsightBar`（`XIAOZE-PLAN-MULTISTEP-001`、`XIAOZE-PROACTIVE-001`） | 与 P0/P1 相同依赖，主动建议验收另需 `XIAOZE_PROACTIVE_ENABLED=true` 与 `VITE_XIAOZE_PROACTIVE_ENABLED=true`。 |
| `npm run test:server -- durableCheckpointer checkpointer env`；可选 `npm run test:server -- durableCheckpointer.integration`（需 `DATABASE_URL` 或 `XIAOZE_CHECKPOINTER_TEST_DATABASE_URL`） | Postgres LangGraph checkpoint 工厂、生产 env 门禁、migrate 建表、跨实例 resume 证明（TD-029） | 集成证明需 PostgreSQL；单元测试默认 memory，CI 无需 live DB。 |

## 同类中文文档

- [docs/zh-CN/developer/README.md](README.md)
- [docs/zh-CN/developer/local-development.md](local-development.md)
- [docs/zh-CN/developer/environment-variables.md](environment-variables.md)
- [docs/zh-CN/developer/verification-matrix.md](verification-matrix.md)
- [docs/zh-CN/developer/user-operation-coverage-matrix.md](user-operation-coverage-matrix.md)
- [docs/zh-CN/developer/browser-acceptance-coverage-map.md](browser-acceptance-coverage-map.md)
