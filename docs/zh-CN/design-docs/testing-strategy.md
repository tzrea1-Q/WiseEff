# WiseEff 测试策略

> English: [English](../../design-docs/testing-strategy.md)

日期：2026-05-25

## 1. 测试目标

WiseEff 需要从“原型测试”升级为“产品质量门禁”。测试体系必须覆盖领域规则、API 合同、关键 UI 流程、权限边界、异步任务、Agent 工具治理和设备网关。

## 2. 测试分层

| 层级 | 目标 | 工具方向 |
| --- | --- | --- |
| 领域单元测试 | 纯函数、状态机、权限规则、数据派生 | Vitest |
| 组件测试 | 页面和组件交互、无障碍、边界状态 | Testing Library |
| API 集成测试 | 后端路由、数据库、事务、错误模型 | 后端测试框架 + 测试数据库 |
| 契约测试 | OpenAPI、DTO、前后端类型一致 | schema 校验 |
| 状态模型测试 | 工作流状态转移、权限可见性、审计不变量 | fast-check + Vitest |
| E2E 测试 | 登录、参数提交、审阅、日志上传、设备调试 | Playwright |
| 任务测试 | worker、重试、失败、幂等 | 队列测试环境 |
| Agent 测试 | 工具权限、审批、输出结构 | 模型 mock + golden cases |
| 设备测试 | 网关读写、错误、回读、模拟器 | 设备模拟器 |
| 安全测试 | RBAC、越权、审计、输入校验 | 自动化安全用例 |

## 3. 前端测试

保留现有测试资产，并在 API 化时做以下调整：

- 页面测试不直接依赖 `initialState`，改用端口 mock。
- 保留领域派生逻辑的纯单元测试。
- 对权限隐藏和禁用状态保持覆盖。
- 对表格筛选、排序、分页、弹窗、键盘操作保留覆盖。
- 对生产模式禁用 mock runtime 增加测试。

关键命令：

```bash
npm test
npm run build
```

## 4. 后端测试

后端每个模块至少包含：

- service 单元测试。
- repository 集成测试。
- controller/API 集成测试。
- 权限负向测试。
- 审计写入测试。

参数管理必须测试：

- 重复未完成变更请求被拒绝。
- 高风险参数缺少审阅不能合入。
- 过期版本合入返回 `CONFLICT`。
- 合入成功写入历史和审计。

日志分析必须测试：

- 不支持文件失败。
- 任务失败可重试。
- 阶段进度顺序正确。
- 证据行号与原始日志绑定。

调试平台必须测试：

- 只读节点写入被拒绝。
- 设备离线写入被拒绝。
- 高风险写入缺少确认被拒绝。
- 回读不一致返回明确结果。

## 5. E2E 场景

MVP 必须覆盖：

1. 参数变更闭环：登录、进入参数页、筛选、创建草稿、提交、审阅、合入、查看历史和审计。
2. 参数权限边界：Guest 不能提交，普通用户不能审阅，Committer 不能进入 Admin。
3. 日志分析闭环：上传支持文件、查看进度、查看证据、关联参数。
4. 日志失败路径：上传不支持文件、查看失败原因、重新上传。
5. 设备调试闭环：检测模拟设备、读取节点、写入、回读、查看调试历史。
6. Agent 审批边界：Agent 可以生成写操作申请，但不能绕过批准。

M5.10 之后，浏览器 E2E 还承担审计级证据生成职责。每个自动化 operation 必须写入 `docs/generated/acceptance-operation-evidence.md` 和 `docs/generated/acceptance-operation-evidence/index.json` 可复核记录；当 operation matrix 声明 `api`、`db` 或 `audit` 断言时，证据必须包含对应的 API 请求/响应、数据库状态和审计事件摘要。缺少这些摘要时，`npm run acceptance:evidence` 应失败。

证据级 artifact 不得放在 Playwright 会清空的 `outputDir`。完整 browser runner 在 `test-results/acceptance-evidence-runs/runs/<sourceCommit>/<runId>/{records,artifacts}` 创建同一运行目录，仅当干净 source 的完整 Playwright 与 operation evidence 均通过时，才原子发布 `latest-full.json`。Record 必须携带相同 `runId` 与 `sourceCommit`；`npm run acceptance:evidence` 拒绝混合身份和缺失 artifact。直接聚焦的 `acceptance:e2e` 使用未发布 focused 目录，不能覆盖或删除最近完整运行证据。

调试管理 catalog 变更由 `e2e/acceptance/debugging-admin.acceptance.spec.ts` 中的 `DEBUG-ADMIN-001` 覆盖。该验收流程覆盖管理界面、API、数据库持久化和审计证据，验证参数新增、编辑、归档、恢复、HDC/ADB binding 管理，以及复杂值元数据编辑。

多层级模块树由 `e2e/acceptance/hierarchical-modules.acceptance.spec.ts` 中的 `MOD-TREE-PARAM-001/002`、`MOD-TREE-DEBUG-001`、`MOD-TREE-AUTHZ-001` 覆盖（嵌套创建、子树筛选、移动/循环守卫、authz、非空删除 409）。

模拟器调试由 `e2e/acceptance/debugging-simulator.acceptance.spec.ts` 中的 `DEBUG-SIM-001` 覆盖，包含复杂 JSON 写入路径，并在 `node_operations` 中记录 `valueKind`、digest 和 preview 元数据，同时避免在 operation evidence 中泄露完整 payload。

定向单元测试覆盖 `server/modules/debugging/valueCodec.test.ts`、gateway 保真测试、管理端/运行时 UI 测试，以及 legacy 标量默认值的 DTO mapper 测试。

M5.11 之后，浏览器质量门禁还包括无障碍、视觉回归和响应式可用性检查。脚本入口包括 `npm run acceptance:quality`、`npm run acceptance:a11y`、`npm run acceptance:visual` 和 `npm run acceptance:responsive`，分别覆盖脚本/spec wiring、WCAG A/AA 扫描、稳定区域截图和 desktop/tablet/mobile overflow/usable state。这些门禁补充 A-H browser acceptance，不替代 operation evidence 或人工视觉判断。

M5.9 在浏览器验收背后新增确定性的状态模型门禁：

```bash
npm run acceptance:models
```

该命令使用固定 seed 的 `fast-check` 模型测试覆盖参数审批、日志任务、调试会话和权限可见性。它不替代 Playwright；它先在 API/domain 层检查“乱点、乱提交、回头操作”仍满足不变量，例如未授权角色不能写入、终态请求不能再次合入或拒绝、回滚必须基于有效快照、生产写入必须有审计、UI 可见权限不能强于 API eligibility。模型失败时必须输出 seed、path 和最小复现步骤，便于把问题再转化成更具体的单元、API 或浏览器用例。

Current M2 acceptance command:

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff OBJECT_STORE_ROOT=.wiseeff-object-store npm run test:m2
```

`npm run test:m2` runs `npm run test:all`, `npm run build`, and `npm run test:e2e`. The M2 Playwright smoke in `e2e/log-analysis.api.spec.ts` runs migrations and seeds `db:seed:m0`, `db:seed:m1`, and `db:seed:m2` in `beforeAll`, then uses `test-fixtures/logs/charging-foldback.log` and `test-fixtures/logs/unsupported.bin`.

The smoke proves the supported upload reaches `Complete`, the conclusion/evidence mention thermal foldback, raw line 3 or 4 highlights from the evidence card, helpful feedback audits, admin archive hides the log from default `/logs`, and unsupported upload creates a readable `Failed` record.

Current M3 acceptance command:

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff DEBUG_DEVICE_GATEWAY_MODE=simulator OBJECT_STORE_ROOT=.wiseeff-object-store npm run test:m3-5
```

`npm run test:m3-5` runs `npm run test:all`, `npm run build`, and `npm run test:e2e -- e2e/debugging.api.spec.ts`. The M3 Playwright smoke runs migrations and seeds `db:seed:m0`, `db:seed:m1`, and `db:seed:m3` in `beforeAll`, then uses the built-in simulator fixture exposed as `Aurora Simulator 1`.

The smoke proves the simulator target is detected, fast charge current reads `3000`, writing `3100` succeeds with readback, `Cycle count` is not writable from the UI, `Readback mismatch probe` reports mismatch text, rollback returns fast charge current to `3000`, and debugging write/rollback audit events exist. If `/debugging` has no enabled rollback card for an API write snapshot, the test records that UI-state gap and verifies rollback through the backend API rather than faking the UI path.

当前 Xiaoze acceptance 命令：

```bash
DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff OBJECT_STORE_ROOT=.wiseeff-object-store XIAOZE_DETERMINISTIC=true npm run acceptance:e2e -- e2e/acceptance/xiaoze-perception.acceptance.spec.ts
npm run acceptance:e2e -- e2e/acceptance/xiaoze-action.acceptance.spec.ts
```

Xiaoze 测试覆盖 AG-UI endpoint、read-only `perception.*` tools、mutating action approval/resume、LangGraph planning/checkpoint，以及 orchestrator approval 边界。负面测试应覆盖 `APPROVAL_REQUIRED`、`INVALID_APPROVAL_STATE`、`FORBIDDEN`、`VALIDATION_FAILED`、错误 session approval、inactive user、missing permissions 和 tool execution failures。

## 6. 契约测试

每次 API 合同变更必须：

- 更新 OpenAPI schema。
- 更新前端 DTO 映射。
- 运行 schema 兼容检查。
- 检查错误码、分页结构和字段命名一致性。

前后端类型不应通过手写重复定义长期分叉。M1 后建议把合同放入共享 `contracts` 包或使用 OpenAPI 生成客户端类型。

## 7. 性能与可靠性测试

关键指标：

- 参数列表 1000 条内 P95 小于 800ms。
- 日志上传 100MB 以内有进度反馈。
- 日志分析任务失败可重试且不重复创建结果。
- 设备写入超时有明确错误。
- Agent 工具调用失败不破坏会话。

测试方式：

- API 压测覆盖列表、搜索和审计查询。
- worker 压测覆盖日志任务并发。
- 设备网关模拟超时、断连、stderr 和回读不一致。
## 8. M5.12 CI And Synthetic Evidence

M5.12 adds CI and target synthetic evidence archiving on top of the deterministic browser gates. PR and push workflows run `acceptance-local-non-hdc` with a PostgreSQL service, local object store, deterministic Agent provider, simulator gateway, `npm run acceptance:models`, M5.11 quality gates, and `npm run acceptance:browser -- --mode local-non-hdc`.

Manual `workflow_dispatch` runs can select `target-non-hdc` or `full-pilot`. These runs use `--no-start-runtime`, target frontend/API URLs, GitHub Secrets, and uploaded Playwright/evidence artifacts. `full-pilot` is never a default PR gate and remains valid only with external HDC, backup/restore, rollback, object-store, worker, and live Agent evidence.

## 9. M5 Release Operations

M5 adds the release smoke and pilot gate on top of the existing API-mode checks:

```bash
npm run smoke:m5
npm run test:m5
```

`npm run smoke:m5` checks the committed OpenAPI artifact, `/health/live`, `/health/ready`, and `/api/v1/operations/pilot-readiness`. It requires a live API base URL by default and only skips with `M5_SMOKE_ALLOW_NO_API=true` for local documentation runs. `npm run test:m5` is the intended end-to-end pilot baseline, but it still depends on PostgreSQL and any external backup, device-lab, or staging evidence that is not fully simulated in-repo.

## 9.1 M6.1 Self-Hosted Runtime Gates

M6.1 adds deployment-shape tests rather than product workflow tests:

```bash
npm test -- ops/self-hosted/scripts/check-self-hosted-config.test.ts ops/self-hosted/scripts/run-self-hosted-smoke.test.ts
npm run selfhost:check
npm run selfhost:smoke -- --base-url <target-url>
```

`selfhost:check` validates the compose services, self-hosted env template, Caddy routing, and package script wiring. `selfhost:smoke` probes a running self-hosted target and writes redacted evidence. It can accept `--allow-only-blocked=deviceGateway` only for non-HDC staging.

## 9.2 M6.2 Identity And User Governance Gates

M6.2 adds OIDC verifier, frontend token-provider, user-governance API, and user-permission browser evidence gates:

```bash
npm run test:server -- server/modules/auth/oidcVerifier.test.ts server/modules/users/service.test.ts server/modules/users/routes.test.ts server/config/env.test.ts server/modules/contracts/openapi.test.ts
npm test -- src/infrastructure/auth/oidcAuthProvider.test.ts src/infrastructure/http/userGovernanceClient.test.ts src/UserPermissionsPage.test.tsx src/App.test.tsx
npm run acceptance:browser
npm run acceptance:evidence
```

Local non-HDC evidence can use the deterministic HMAC smoke token. Target self-hosted identity evidence must use real OIDC access tokens and must include discovery/JWKS, issuer/audience/expiry negative checks, browser token refresh/logout behavior, `/api/v1/me`, and redacted user-governance mutation evidence before TD-020 closes.

## 9.3 M6.3 Backup And Restore Gates

M6.3 adds reliability evidence gates for self-hosted PostgreSQL and S3-compatible object storage:

```bash
npm run restore:drill
npm run backup:drill
npm run backup:check
```

`restore:drill` checks restore target safety before any restore command runs. `backup:drill` writes redacted JSON/Markdown evidence for provider, environment, database backup/restore, object-store backup/restore, checksum validation, sampled log references, command exit statuses, and queue status. `backup:check` validates the generated evidence shape, redaction status, failed command exit codes, unsafe restore targets, missing object references, and conditional Redis status.

Local evidence proves the scripts and safety gates. Target readiness requires the same gates after a real isolated restore in a non-customer or pilot target environment.

## 9.4 M6.5 Observability Gates

M6.5 adds local observability configuration and runtime checks:

```bash
npm test -- scripts/check-observability-config.test.ts server/observability/*.test.ts server/app.test.ts server/shared/http/router.test.ts server/modules/agent/orchestrator.test.ts server/modules/agent/routes.test.ts server/modules/debugging/service.test.ts server/modules/debugging/routes.test.ts
npm run observability:check
```

`observability:check` validates Prometheus config, alert runbook links, dashboard JSON, package script wiring, obvious secret leakage, and unknown `wiseeff_*` metric references. Runtime tests cover `/metrics`, HTTP request counters, readiness/dependency/queue gauges, log-analysis terminal job duration/failure-reason counters, Xiaoze LLM readiness gauges, device gateway operation counters, structured log redaction, correlation metadata, tracing export failure isolation, HTTP route-template spans, Agent approval/tool metrics, and debugging gateway detect/read/write/rollback spans. Target Prometheus scrape, trace collector export, Alertmanager routing, and Grafana import screenshots remain target-environment evidence, not local unit-test evidence.

## 9.5 M6.6 Release, Rollback, And Capacity Gates

M6.6 adds release-operation tests and evidence writers rather than new product workflow tests:

```bash
npm test -- scripts/run-self-hosted-release-gate.test.ts scripts/run-capacity-gate.test.ts
npm run identity:check
npm run rollback:rehearsal
npm run capacity:gate -- --target-url <target-url>
npm run selfhost:release-gate -- --target-environment <label> --artifact-ref <artifact> --env-fingerprint <sha256>
```

`capacity:gate` verifies target URL handling, threshold evaluation, auth-token redaction, k6 command construction, and evidence output. Without observed target metrics, it must stay failed or pending. After a real target run, operators can pass observed p95 latency, error rate, throughput, CPU, memory, database connections, queue backlog, and object-store probe status as CLI inputs.

`rollback:rehearsal` records stop-writes, queue drain, artifact rollback, optional database/object-store restore, and post-rollback smoke status in `docs/generated/m6-rollback-rehearsal-evidence.md`. It proves evidence shape locally; it proves rollback readiness only when the steps were executed on a non-customer self-hosted target and linked from the release record.

`selfhost:release-gate` verifies release metadata, command-gate wiring, identity/backup/rollback/capacity/synthetic/queue/observability evidence paths, dependency statuses, and explicit HDC scope. It can verify local script configuration, but release readiness requires target OIDC evidence from `npm run identity:check` plus target evidence from backup/restore, rollback rehearsal, queue drain/pause/resume, observability snapshots, capacity, and target synthetic acceptance. Local HMAC smoke or static bearer injection must not be treated as M6.2 identity readiness. Rollback, capacity, target synthetic, queue, and observability dependencies cannot be marked `passed` without the matching evidence path in the release record.

## 参数拓扑（第四轮）

第四轮在分支 `fix/parameter-topology-round4-review-blockers` 关闭父智能体 Review 阻断。**TD-042 仍为 BLOCKER**——下列门禁证明本地/临时库行为，不构成生产 cutover 就绪。

| 领域 | 测试 / 命令 | 证明内容 |
| --- | --- | --- |
| 厂商 dt-schema | `goldenPowerFixture.test.ts`、`scripts/vendorDtSchemaGenerator.test.ts` | 由属性规格确定性生成 linux-bindings；黄金 DTB 通过真实 `dt-validate`；负例按预期失败 |
| 黄金计数 | `goldenPowerFixture.test.ts`（173 属性）、`seedM1DtsFiles.test.ts`（519 行 `dts_properties`）、`matcher.test.ts`、`ingestService.test.ts` | 锁定 **173/519** 拓扑/seed 计数 |
| stage → finalize | `migration.test.ts`（临时 PostgreSQL、重连、注入失败） | 可运维 `stage-review` 事务；原子 `finalize`；cutover 拒绝非 `finalized` 运行 |
| 精确回写 | `editService.test.ts`、合入工作流测试 | occurrence 锁定合入/回写；base 不可变；身份过期 → `409` |
| Matcher / 审核作用域 | `matcher.test.ts`、`matcherScope.integration.test.ts` | override 按节点 locator 指纹隔离；`blocker_scope` 门禁 |
| Manifest 门禁 | `manifestBackfillMigration.test.ts`、`configRevisionManifest.test.ts`、`editService` needs_review 路径 | 从 `dts_config_revision_members` 回填；`needs_review` 对编辑/校验/发布/回写失败关闭 |
| 全局规格 hotspot | `postCutoverDashboard.integration.test.ts` | 租户项目包含 `organization_id IS NULL` 厂商规格 |
| 未匹配审核 | `service.test.ts`、`routes.test.ts` | `createSpec` + `confirmPropertyMismatch` 与治理审计 |
| 浏览器验收 | `parameter-topology.acceptance.spec.ts` | `PARAM-SPEC-GOVERN-001` 至 `PARAM-CONFIG-PUBLISH-GATE-001`；API 模式无教学回退 |

拓扑发布前工具链门禁：

```bash
npm run dts:toolchain:bootstrap
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/dts/goldenPowerFixture.test.ts server/modules/parameter-topology/migration.test.ts server/modules/parameter-specs/matcherScope.integration.test.ts --run
```

## 参数拓扑（第五轮）

第五轮在分支 `fix/parameter-topology-round5-review-blockers` 关闭父智能体 Review 阻断。**TD-042 仍为 BLOCKER**——下列门禁证明本地/临时库行为，不构成生产 cutover 就绪。

| 领域 | 测试 / 命令 | 证明内容 |
| --- | --- | --- |
| 不可变 base 与 candidate | `postCutoverWorkflow.integration.test.ts`、`editService.test.ts` | 合入/回写后 base binding revision 不变；合入值仅在 candidate revision |
| Fail-closed 回写 | `parameters/service` 合入路径、`writebackService`、`editService` 工具链门禁 | 缺 `objectStore`、项目范围、write lock 或工具链失败关闭；无 `WISEEFF_WRITEBACK_SKIP_TOOLCHAIN` 生产绕过 |
| Phase 审计与运行关联 | `migration.test.ts`（`parameter_identity_migration_phases`、`migration_run_id`） | `stage-review`/`finalize` 不可变 phase 行；推断任务关联 staged 运行；cutover 拒绝伪造状态 |
| 租户 resolve | `validateSpecReviewTenantEvidence`、跨租户 PG 负向测试 | 跨租户证据拒绝；0055 不信任 raw evidence ID |
| Draft→激活→resolve | `draftSpecWorkflow.integration.test.ts`、`service.test.ts`、`routes.test.ts` | `createSpec` 仅 draft；`activate` 需 Admin+完整形状；resolve 拒绝 draft |
| 验收 fixture 诚实化 | `acceptanceTaskLookup.ts`、`semanticFixtureCleanup.ts`、topology/files/dts acceptance | 无 `items[0]` fallback；前缀作用域 FK 完整清理；覆盖 draft→activate→resolve |

第五轮工具链门禁（同第四轮）：

```bash
npm run dts:toolchain:check
npm run dtc:seed:compile
npm run test:server -- server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts server/modules/parameter-specs/draftSpecWorkflow.integration.test.ts server/modules/parameter-topology/migration.test.ts --run
```

## 参数拓扑（第六轮）

第六轮在分支 `fix/parameter-topology-round6-review-blockers` 关闭剩余 Review 阻断。**TD-042 仍为 BLOCKER。**

| 领域 | 测试 / 命令 | 证明内容 |
| --- | --- | --- |
| Evidence-only scope 校正 | `0058_*.sql`、`specReviewTenantEvidence.integration.test.ts` | 历史污染 FK 按可证 evidence 重建/清空；未证明 resolved→open；幂等与回滚 |
| 无损规格身份 | `specIdentity.test.ts`、`draftSpecWorkflow.integration.test.ts` | `vendor,limit` ≠ `vendor-limit`；sanitize 不入哈希；碰撞审计 fail-closed |
| 全局激活权限 | `globalSpecActivate.authz.test.ts` | 组织 Admin 激活全局 draft → 403；本组织 draft 可激活；读/绑定全局仍允许 |
| 完整 valueShape 激活 | `DraftSpecActivatePanel.test.tsx`、`specCompleteness.ts` | gpio_int cellsPerGroup=3 保留；不完整形状阻断 |
| 融合 DTS 工作台 | `ParametersPage.test.tsx`、`DtsParameterWorkbench.test.tsx`、`DtsTopologyNavigator.test.tsx`、`DtsBindingDetailDialog.test.tsx`、`DtsBindingDraftTray.test.tsx` | 成熟 `WorkbenchLayout` + 真实语义嵌套导航、搜索/筛选、raw 值/shape/provenance 详情、本轮修改区、项目安全 typed 提交与响应式可访问性；无旧推荐值/教学回退 |
| 租户作用域清理 | `semanticFixtureCleanup.isolation.test.ts` | 其他组织/项目同名 Config Set 不受影响 |
| submit→review→merge 验收 | `parameter-topology.acceptance.spec.ts`、`disposablePostCutoverRuntime.ts` | 先通过融合 DTS 工作台执行语义搜索/树/详情/本轮修改，再自动创建可丢弃数据库，执行 migrations+identity cutover，校验 marker/run 一致性，并证明真实 set/delete 角色链、writeback、candidate AST/tombstone、reload 与 base 不可变，最后销毁数据库。因无 delete UI 控件，delete 创建/提交走公开 API；角色决议与 merge 仍走 UI。 |
| assignee/审阅 UI 验收 | `parameters-negative.acceptance.spec.ts`、`parameters.acceptance.spec.ts` | 三个可见下拉框使用 API 作用域 eligible user；production HMAC 浏览器身份分别执行硬件、软件与合入 UI 操作。不得用 DB 角色查询或同一 Admin token 替代 |
| 项目切换隔离 | `ApiProjectTopologyWorkspace.test.tsx` rerender + deferred-response 回归、浏览器交互 | 项目 A 的 candidate/draft/message 不得影响项目 B；B 从 `current` 开始；迟到的 A 草稿响应被忽略且不能加载 B 候选人。 |
| Evidence 运行隔离 | `check-operation-evidence.test.ts`、`run-browser-acceptance.test.ts` | 完整 record/artifact 共享 run+commit 目录；focused 保留 `latest-full`；混合运行 fail-closed。 |
| Binding 提交身份 | `routes.test.ts`、`postCutoverWorkflow.integration.test.ts`、迁移 `0059`–`0063` | HTTP 保留 draft/binding/spec/action 并返回 exact candidate ID。两个真实 PG 连接证明 submission 持有 draft+candidate 锁时，candidate 状态修改必须等待；提交执行 `draft -> pending_approval` 并把 ID 持久化到 item/request。Merge 拒绝 candidate 缺失、状态/value/delete proof 变化。升级测试覆盖 0061 全 origin 失效与 0063 事务回滚/幂等。 |
| Typed delete 生命周期 | `schemas.test.ts`、`postCutoverWorkflow.integration.test.ts`、`parameter-topology.acceptance.spec.ts` | `delete` 要求空 target，贯穿 draft/submission/CR/audit，证明 candidate binding 缺失及匹配 occurrence effect，写出 `/delete-property/`，re-ingest/validate 后不产生替代 binding revision，并在真实角色审核/合入/reload 后保持缺失。 |
| test:all 稳定性 | App API runtime 隔离、dashboard fixture 唯一命名空间、每个事务 PG client 的 FIFO 查询 | 默认 `npm run test:all` 无需临时 worker 覆盖或全局提高 timeout |

不得为了让拓扑验收变绿而对共享开发/验收库就地 cutover。拓扑 spec 自主管理 `wiseeff_acceptance_disposable_*` 数据库，并在破坏性清理前校验 test marker。独立的干净快照演练完成前，TD-042 仍保持开放。

## 10. Documentation Governance

Documentation-impacting work must run `npm run docs:check` plus `git diff --check`. The docs check enforces that active implementation plans carry a documentation impact matrix and update gate.
