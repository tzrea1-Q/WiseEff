# WiseEff 开发路线图

> English: [English](../../exec-plans/active/development-roadmap.md)

日期：2026-10-13

## 1. 当前状态

M0–M5 的产品化基础和 M6 的大量自托管实现已合并。当前仓库包含 React/Vite/TypeScript 前端、mock/API 两套运行时、TypeScript 模块化后端、PostgreSQL 迁移、认证与审计边界、OpenAPI 检查、Redis/BullMQ 队列、worker/对象存储与 HDC 网关接入、小泽、可观测性及发布升级工具。实现落地和目标环境验收是两回事。

当前分支已交付的能力包括：

- **用户指南与平台概览（#1143）：** 本次变更交付了双语操作指南和平台导览，并接入产品用户及新读者的阅读入口。在当前分支交付，不代表已合并或已达到生产就绪。
- **规范参数 Catalog：** 发布、Release 构建，以及工作台、调试、知识库、日志和小泽的规范参数接入。模型以[创作与发布设计](../design-docs/catalog-authoring-and-publication-control-plane.md)为准；代码合并不代表已具备生产切换条件。
- **知识库：** 检索、条目发布及规范 Definition 引用，主题说明见[知识库设计](../design-docs/2026-08-12-knowledge-base-design.md)。
- **Agent 日志分析：** 多步分析内核、业务域与工具上下文、评估框架，以及明确标注来源的规则降级。[日志分析计划](active/2026-08-12-agent-log-analysis-system.md)已记录实现完成；真实专家标注案例、第二个试点业务域和人工评审校准仍需外部输入。提议中的[分析技能平台计划](active/2026-10-18-log-analysis-skill-platform.md)（ADR-0047）将其通用化，管理员无需改代码即可按模块构建分析技能。
- **DTS 重载与组织管理：** 重载候选、运行、部署、基线恢复和草稿提升；组织设置、成员角色治理、启停及注册角色申请审批。组织管理说明见[设计文档](../design-docs/2026-08-19-organization-administration-design.md)。
- **前端改造的已交付部分：** 共享设计系统、参数/Catalog 导航工作台、统一评审收件箱和 Catalog 中文名称已通过 #1117、#1124、#1125 合并。#1126 下的其余页面模板迁移和回归守卫仍未完成，不能把整个改造标为完成。

产品适合受控 staging 和试点证据采集。与 [README](../root/README.md) 保持一致：在真实目标环境补齐 live API、PostgreSQL E2E、HDC 设备实验室、备份恢复、回滚、身份、队列、可观测性、容量和小泽 LLM 就绪检查的证据前，不能宣称已普遍具备生产就绪条件。本地测试、代码合并和单个主机演练都不能替代这些验收；mock 仅用于演示和测试，不能作为生产业务数据源。

小泽的感知、动作和规划阶段已完成；后续 PostgreSQL 持久检查点实现已关闭 TD-029。早期 P2 计划中的延后项不是当前待办，现状以[技术债跟踪表](tech-debt-tracker.md)为准。

## 当前工作重点

以下是截至本页日期的优先事项，不是交付时间表。计划留在 active 目录，不一定表示代码尚未实现：有些保留了历史状态，有些只等外部证据。开工前应结合已合并代码、[技术债跟踪表](tech-debt-tracker.md)和仍开放的 `ready-for-agent` Issue 判断。

- **完成前端改造：** [#1126](https://github.com/tzrea1-Q/WiseEff/issues/1126) 仍开放并标为 `ready-for-agent`，包括管理列表和设置表单模板（#1128、#1129、#1132）、其余工作台迁移、紧凑 PC 覆盖、无障碍 lint、视觉基线和 TD-113 token 检查收紧。现有权限与审批行为保持不变。
- **收口可信执行来源：** DTS 重载和参数路径已接入 TD-068 的可信上下文，但 #609 下的 [#615](https://github.com/tzrea1-Q/WiseEff/issues/615) 及其 `ready-for-agent` 子票仍负责旧来源标签收缩和统一证据验收。[可信调用上下文计划](active/2026-08-24-td-068-trusted-invocation-context-seam.md)和跟踪表中的历史描述不能当作端到端关闭的证明。TD-123 的调试审计来源问题独立保留，仍未关闭。
- **补齐目标环境和业务域证据：** 按[非 HDC 目标证据计划（英文）](../../exec-plans/active/2026-05-29-wiseeff-m5-2-non-hdc-target-evidence-closure.md)、M6 身份/存储/队列/可观测性/发布计划，以及日志分析计划的外部输入要求推进。TD-007 仍需目标 Redis 证据和容量调优；仓库检查不能证明完整试点验收通过。
- **维护自托管操作路径：** [IP 实验室 profile](active/2026-08-18-self-hosted-ip-lab-profile.md)、[配置向导](active/2026-08-18-self-hosted-setup-wizard.md)和[升级计划](active/2026-08-20-self-hosted-one-command-upgrade.md)分别维护部署、恢复及剩余验证要求。其中旧分支和运行记录只是历史背景，不是当前主机健康声明。[CI 反馈环计划](completed/2026-08-18-ci-feedback-loop-optimization.md)已完成（#523–#525）。
- **补齐剩余合同：** TD-003 继续跟踪手写客户端的合同覆盖缺口。这项后续工作不构成新的生产就绪声明。

只有计划自身的 Documentation Update Gate 和验证命令满足要求后，才能移入 completed。本路线图不承诺完成日期。

## 2. 开发原则

- 先补后端地基，再替换前端数据源。
- 每个业务域都先走端口，再接真实 API。
- 每个里程碑都必须有测试和验收脚本。
- 不把 Agent、设备写入或批量导入作为无审计的快捷路径。
- 保留现有原型页面，逐步把数据来源从 mock 切换到 API。

## 3. 仓库结构建议

短期可以采用单仓库：

```text
apps/
  web/                 # 迁移现有 Vite React 前端，或保持 src 在根目录到 M0 结束
  api/                 # 后端 API
  worker/              # 异步任务 worker
  device-gateway/      # 设备网关
packages/
  contracts/           # OpenAPI、共享 DTO、schema
  config/              # eslint、tsconfig、测试配置
docs/
```

若短期不迁移目录，也可以先在根目录新增 `server/`，等 M1 后再整理 monorepo。不要在 M0 为目录重组消耗过多时间。

## 4. M0 实施顺序

1. 建立后端服务骨架。
2. 建立数据库迁移。
3. 建立用户、角色、权限、审计基础表。
4. 实现 `GET /api/v1/me`。
5. 前端新增真实 API client 基础层。
6. 前端增加 runtime mode：`mock`、`api`。
7. CI 运行前端测试、后端测试和 build。
8. 本地开发文档补充启动方式。

验收：

- 本地可以同时启动 web、api、db。
- 登录上下文来自后端。
- 审计写入接口可用。
- mock 模式仍可用于演示。

## 5. M1 实施顺序

1. 参数数据模型迁移：项目、模块、参数定义、项目参数值。
2. 参数列表 API。
3. 参数详情和历史 API。
4. 参数草稿 API。
5. 提交轮次和变更请求 API。
6. 审阅状态机和合入逻辑。
7. 批量导入预览和应用。
8. 前端 `ParameterRepository` 切换到真实 API。
9. 参数工作台、审阅页、管理后台 E2E。

验收：

- 刷新页面后参数状态保留。
- 合入会生成历史和审计。
- 高风险参数审批规则生效。

## 6. M2 实施顺序

1. 文件上传和对象存储。
2. 日志记录 API。
3. 分析任务和 worker。
4. 文本日志解析。
5. 分析阶段进度接口。
6. 证据和报告生成。
7. 前端 `LogAnalysisRepository` 切换到真实 API。
8. 失败、重试、归档和反馈。

验收：

- 上传支持格式日志能完成分析。
- 不支持格式有失败记录和可解释原因。
- 证据行号可点击定位。

## 7. M3 实施顺序

1. 设备网关 skeleton。
2. 设备模拟器。
3. 目标检测。
4. 节点读取。
5. 节点写入和回读校验。
6. 调试会话和快照。
7. 前端 `DebuggingGateway` 切换到真实网关。
8. 高风险写入确认和审计。

验收：

- 模拟器环境可稳定通过调试 E2E。
- 写入失败有错误原因和审计。
- 回滚只能基于有效快照。

## 8. M3.5 Commercial Readiness 实施顺序

M3.5 插在 M3 和 M4 之间。原因是 Agent 会放大现有系统能力，也会放大数据、权限、审计、设备写入和运维边界的风险；因此先把 M1-M3 从 API-mode MVP 硬化成可控商用试点基线，再进入 M4。

1. 生产健康检查与 readiness：`/health/live`、`/health/ready`、依赖状态和部署 smoke 命令。
2. 环境契约硬化：生产模式必须显式配置数据库、对象存储、runtime mode 和设备网关设置。
3. API contract 防漂移：为 M1-M3 手写 HTTP client/DTO 增加契约覆盖。
4. M2 worker 生产化切片：任务租约、重试/退避元数据、幂等和重复 worker 防护。
5. 对象存储生产 seam：本地 object store 保留，补 readiness 和未来 S3/OSS adapter 边界。
6. M3 设备安全硬化：真实 gateway adapter 边界、设备租约、超时/离线/stderr 归一化、模拟器一致性测试。
7. 可观测性：结构化日志、request/trace id、审计关联和运维文档。
8. M3.5 验收后再启动 M4 Agent。

验收：
- API readiness 能报告数据库、对象存储、worker、gateway 等依赖状态，并给出可行动失败原因。
- 生产配置不能在 mock runtime 或缺少关键依赖时启动。
- M1-M3 API client 有契约漂移检测。
- M2 job 不会被两个 worker 重复处理。
- M3 真实设备写入前具备租约、超时和审计保护。
- `npm run test:all`、`npm run build` 和 M3.5 targeted smoke 通过。

## 9. M4 实施顺序

1. Agent 会话和消息持久化。
2. Tool registry。
3. 读工具接入参数、日志、审计。
4. 写工具审批流。
5. 前端 `AgentGateway` 切换到真实 API。
6. 工具调用审计。
7. Agent 输出引用和置信度展示。

验收：

- Agent 可以总结真实数据。
- Agent 写工具必须审批。
- 审批后执行结果可追溯。

## 10. M5 Commercial Pilot Readiness 实施顺序

M5 的目标不是一次性完成完整企业生产上线，而是把 M0-M4 已完成的全链路能力硬化到可进入受控商用试点的状态。重点是减少合同漂移、替换开发态身份、让长任务/对象存储/设备网关/Agent Provider 具备生产边界，并补齐部署、监控、备份、回滚和验收门槛。最终要落到一个可执行的操作门槛：`GET /api/v1/operations/pilot-readiness`、`npm run smoke:m5`、`docs/runbooks/m5-commercial-pilot-readiness.md` 和 `docs/generated/m5-pilot-acceptance.md`。

1. API contract productionization：从静态 route manifest 升级到 OpenAPI/schema 生成或强校验，覆盖参数、日志、调试、Agent 和运维端点。
2. 生产身份与权限边界：保留开发身份作为本地模式，引入生产 token 验证、组织/租户边界、权限负向测试和审计关联。
3. Worker/queue hardening：将日志分析 worker 从 API 进程内轮询硬化为独立运行单元，补齐 retry、backoff、dead-letter、状态可观测和幂等验收。
4. Object storage hardening：保留本地对象存储实现，新增 S3/OSS 适配边界、配置校验、健康探针、checksum/retention/encryption 元数据。
5. Device gateway hardening：在现有 `DebugDeviceGateway` 合同后增加真实 HDC adapter，覆盖超时、stderr 归一化、离线检测、设备实验室 smoke 和 simulator parity。
6. Agent provider hardening：在 deterministic provider 之外增加真实 LLM provider seam，记录 prompt/model/version、引用约束、安全评估、成本/延迟预算和 provider outage 降级策略。
7. Release/operations：补齐 CI/CD 质量闸门、staging/prod smoke、监控告警、备份恢复演练、回滚手册、pilot-readiness 端点和试点验收报告。

验收：

- `npm run test:m5`、`npm run test:all`、`npm run build`、关键 API-mode E2E、`npm run smoke:m5`（需要 live API URL，除非本地文档运行显式设置 `M5_SMOKE_ALLOW_NO_API=true`）和 `git diff --check` 通过。
- 前后端关键 DTO 由合同生成或由 schema 合同测试覆盖，新增/变更端点会在 CI 中触发漂移失败。
- 生产模式不能使用开发身份、mock runtime、缺失对象存储、缺失 worker/queue 配置或不安全 Agent provider 配置启动。
- 日志分析任务在 worker 崩溃、重试耗尽、重复 worker、对象存储失败时有明确状态、dead-letter 记录和可追踪失败原因。
- 对象存储、数据库、worker、设备网关、Agent provider 的 readiness 能返回可行动的依赖状态。
- 真实 HDC adapter 在设备实验室或受控本地环境完成读、写、超时、离线、stderr 和 read-back mismatch smoke。
- 真实 LLM provider 只能通过受控工具边界读写，写工具仍需人工审批；prompt/version、输入摘要、输出摘要、成本/延迟和安全评估结果可审计。
- staging 和 production 有独立部署配置、健康检查、备份/恢复、回滚演练记录和试点上线 checklist，且 `docs/generated/m5-pilot-acceptance.md` 记录了哪些外部检查真的跑过。

## 10.1 M5.1 Documentation Governance And Pilot Evidence Closure

M5 code has merged through PR #39. M5.1 closes the documentation governance gap before new product scope begins: archive completed plans, update all key docs to reflect the M5 baseline, add a mandatory Documentation Impact Matrix and Documentation Update Gate to future plans, and keep external pilot evidence visibly blocked until staging, HDC device-lab, backup/restore, and live smoke checks are actually run.

M5.1 also adds `npm run docs:check` to the CI build-and-test workflow so active implementation plans cannot silently omit documentation governance metadata.

## 10.2 M5.2 Staging Pilot Evidence Execution

M5.2 executes the real target-environment evidence that M5 and M5.1 intentionally left unclaimed: synchronize the local baseline with GitHub after M5.1 merges, run the staging API with PostgreSQL, worker, S3/OSS-compatible object storage, HDC gateway, and live Agent provider configuration, then record live API smoke, staging PostgreSQL-backed E2E, HDC device-lab, backup/restore, rollback, and pilot-readiness evidence in `docs/generated/m5-pilot-acceptance.md`. Local PostgreSQL-backed API-mode E2E evidence is now recorded, but it does not replace staging evidence.

M5.2 is not a production-hardening feature phase. Enterprise SSO/OIDC, Redis/BullMQ or equivalent durable queue, cloud SDK/IaC, monitoring/alerting, and capacity testing are tracked as M6 Production Hardening work after the controlled staging evidence package is complete.

## 10.3 M5.5 Browser Acceptance Coverage Hardening

M5.5 corrects the coverage-model gap found after M5.4. M5.4 added deterministic Playwright browser acceptance and generated evidence, but manual validation showed that workflow-level happy paths did not cover enough real user behavior: API-mode auth parity, blank required fields, workflow assignee eligibility, permission inheritance, negative API responses, and unexpected browser runtime failures.

M5.5 keeps Playwright as the release-grade browser automation engine and adds a requirement-level user-operation inventory, `npm run acceptance:coverage`, browser diagnostics that fail on unexpected console/API failures, parameter negative-path coverage, permissions matrix coverage, and requirement-level evidence reporting. Future UI/API interaction plans must name affected acceptance requirement IDs, or add new IDs before implementation.

## 10.4 M5.6 User Operation Coverage Matrix

M5.6 deepens M5.5 by replacing broad workflow confidence with a role-aware user-operation matrix. It adds operation IDs, `npm run acceptance:operations`, generated operation coverage docs, and an honest status model for high-risk gaps such as draft edit/remove, review rejection, log reanalysis, debug write permissions, unapproved Agent write execution, and Admin user management. Current automated P0/P1 operations are release-gated; unstable or product-gap operations remain visible as `future` or `conditional` until their UI/API contracts are ready.

M5.6 is a coverage-truth phase. It should answer which exact user operations are automated, manual, conditional, or deferred before the project claims broader browser acceptance confidence.

## 10.5 M5.7 Evidence-Grade Browser Acceptance

M5.7 builds on the M5.6 operation matrix and upgrades browser acceptance output into replayable evidence packages. Each automated operation now emits role, route, assertion types, screenshot artifact paths, and generated evidence indexes under `docs/generated/`; richer API, DB, audit, request-id, and trace summaries remain a future enhancement where an operation needs deeper forensic review.

M5.7 is an auditability phase. It should make acceptance results reviewable by a human without reading raw test code, while keeping Playwright as the deterministic gate and leaving AI exploratory QA for a later optional phase.

## 10.6 M5.8 Deterministic Acceptance Coverage Closure

M5.8 stays fully non-AI. It closes the remaining browser-acceptance gaps that M5.6 and M5.7 kept visible as `future` or `conditional`, then keeps requirement IDs, operation IDs, and operation evidence aligned so reviewers can see exactly what is automated and why. Any gap that cannot be closed deterministically stays explicit instead of being hidden behind a broader workflow pass.

## 10.7 M5.9 State Model & Contract-Driven Testing

M5.9 hardens the state model behind the browser flows so UI state, API contracts, and seeded test data do not drift apart. The focus is deterministic contract checks, stronger fixture discipline, and tests that fail fast when workflow state changes unexpectedly.

Completion gate: `npm run acceptance:models` must pass with fixed seeds for parameter approval, log analysis task, debugging session, and permission visibility models. Failures must include a reproducible seed, path, and step list so regressions can be promoted into focused unit, API, or browser tests.

## 10.8 M5.10 Evidence-Grade Upgrade

M5.10 deepens browser evidence beyond pass/fail and operation summaries by adding richer API, DB, audit, request-id, and trace metadata where a human reviewer needs better forensic context. It is still deterministic; it does not introduce AI decision-making into the release gate.

Completion gate: `npm run acceptance:browser` must produce passed local or target browser evidence, `npm run acceptance:evidence` must pass with zero validation errors, and generated operation evidence must include runtime, trace/report, reproduction, and required API/DB/audit summaries for every declared assertion type.

## 10.9 M5.11 Accessibility / Visual / Responsive Gates

M5.11 has landed non-AI quality gates for accessibility, responsive layout, and visual regressions. It catches the kinds of user-facing bugs that workflow automation alone can miss, while staying deterministic and replayable.

Completion gate: `npm run acceptance:quality` must pass for quality-gate metadata, and UI-facing candidates should run the relevant focused gates: `npm run acceptance:a11y`, `npm run acceptance:visual`, and `npm run acceptance:responsive`. Visual snapshot updates must be intentional: update snapshots once with `npm run acceptance:visual -- --update-snapshots`, then rerun `npm run acceptance:visual` without update mode.

## 10.10 M5.12 Staging Synthetic & CI Evidence Archiving

M5.12 moves the browser gate further into staged and CI environments by archiving evidence from synthetic runs, preserving the proof trail for release candidates, and making the browser validation output easier to review after the fact. The PR merge bar is L1 (unit/integration plus `@ci-smoke` and one quality-run when paths require them). L2 still runs a local non-HDC acceptance job with PostgreSQL, state models, quality gates, and browser acceptance on `main` / nightly / label / dispatch; manual workflow dispatch can run target non-HDC or full-pilot synthetic checks against externally managed runtimes.

Completion gate: `npm run acceptance:ci` must pass, `.github/workflows/ci.yml` must retain `detect`, `required` (`Merge bar`), `acceptance-smoke`, `acceptance-local-non-hdc`, and `target-synthetic-acceptance`, and L2 CI artifacts must include Playwright acceptance reports, test results, generated browser evidence, generated operation evidence, and quality reports. PR artifacts prove L1 / smoke only. Full-pilot artifacts remain valid only with real target environment secrets plus HDC, backup/restore, rollback, object-store, worker, and live Agent evidence.

## 10.11 M6 Self-Hosted Production Hardening

M6 is scoped for operators who do not want cloud-provider managed services but can deploy and maintain services on their own Linux servers. The goal is a commercially usable self-hosted pilot baseline, not new product scope and not AI enhancement.

M6 is split into active execution plans so each phase can be implemented, verified, and archived independently:

1. M6.1 Self-Hosted Runtime Baseline: Linux deployment, PostgreSQL, API/web/worker services, reverse proxy, TLS, and basic smoke evidence.
2. M6.2 Identity & User Governance: self-hosted OIDC, Keycloak-compatible setup, backend user/role APIs, audit, and permission acceptance.
3. M6.3 Self-Hosted Storage & Backup: S3-compatible object storage, PostgreSQL/object-store backup and restore, and Redis backup procedure once M6.4 lands.
4. M6.4 Durable Queue: Redis/BullMQ durable queue is implemented locally for log-analysis dispatch while PostgreSQL remains the source of truth for job state and audit; target Redis evidence remains pending.
5. M6.5 Observability & Operations: OpenTelemetry, Prometheus/Grafana, structured logs, alerts, and incident runbooks.
6. M6.6 Release, Rollback & Capacity Gate: versioned release process, rollback rehearsal, capacity testing, and target synthetic acceptance.

M6 completion should honestly report three levels: local self-hosted gates, target non-HDC self-hosted gates, and full-pilot gates with HDC hardware. Full-pilot readiness remains blocked unless real HDC, backup/restore, rollback, identity, queue, object storage, observability, and target acceptance evidence all exist.

## 11. 工程工作流

每个功能分支要求：

- 先写或更新测试。
- 保持 `npm test` 和 `npm run build` 通过。
- 后端变更包含迁移和集成测试。
- API 合同变更同步更新前端 DTO。
- 涉及权限、审计、Agent、设备的变更必须有负向测试。
