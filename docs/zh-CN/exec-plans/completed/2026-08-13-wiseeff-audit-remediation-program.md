# WiseEff 审计修复计划 — 收尾记录

> 状态：**已完成 2026-08-13**（多 PR 计划；唯一遗留项为产品决策，追踪号 TD-108）
> 日期：2026-08-12 → 2026-08-13
> English: [English](../../../exec-plans/completed/2026-08-13-wiseeff-audit-remediation-program.md)

## 背景

2026-08-12 的六智能体审计从产品规格对照实现、前端体验、后端安全与 API 契约、质量门禁、进行中工作、文档治理六个视角输出了带优先级的问题清单，本计划跟踪其修复。原 active 计划文件在同期高并发开发的 worktree 竞态中丢失，本收尾文档补记持久结论。

## 本计划落地项

- **文档诚实性（#325）。** `docs/product-specs/prototype-functional-spec.md` 补上真实的 "Simulation boundaries" 章节（规则化分析、模板化 AI 摘要），修复 `product-spec.md` 的悬空引用；zh-CN 规格页同步。`docs/FRONTEND.md` 标注 ADR-0001 的 `ProjectOperationsDialog` 已被 #240 配置工作台取代。`ARCHITECTURE.md` 后端地图补列 `jobs/`、`notifications/`、`deviceBridge/`、`contracts/`。
- **路径遍历防护（#325）。** `nodePathSchema` 拒绝含 `..` 的路径段；带点的节点路径（`battery.0`）仍合法。`server/modules/debugging/schemas.ts` 及测试。
- **全局错误边界（#325）。** `src/components/common/ErrorBoundary.tsx` 包裹应用根节点；渲染崩溃落在可恢复的中文兜底页（重试 / 刷新 / 返回首页 / 复制诊断信息），不再白屏。
- **文档治理重复检查（#325）。** `scripts/check-doc-governance.ts` 在同名计划同时存在于 `active/` 与 `completed/` 时报错。
- **设备桥审计链路（#337）。** 配对码签发、配对（复用与新建两条路径，落在服务层）、重命名、吊销均写入审计事件并映射严重级别；令牌值永不入日志。
- **CI 契约门禁（#433）。** `contract:check`（OpenAPI 漂移检查）加入 `build-and-test`；同窗口内 `bridge:test` 与 `test:scripts` 门禁由并行工作补齐。
- **#417 冲突解决。** P2 页面缺陷波与 main 上的 DebuggingGateway 端口重构相撞。解法保留双方意图：`debuggingActions` 必填 + `runtimeStatus`/`runtimeError`/`onRuntimeRetry` 状态面，桥接缝保持；测试的 fetch mock 补应答 `/health` 与 `/api/v1/device-bridges/{mine,releases}`，面板挂载不再偷走队列中的 hdc 响应；演示模式 toast 测试随重构删除的分支一并退役（检测失败仍由事件历史断言覆盖）。页面测试 58/58 通过。

## 经核实已被并行开发关闭

- **认证 fail-closed。** `contextFactory`、`tokenVerifier`、`oidcVerifier` 生产路径的全部失败都重抛为 401 `ApiError`；不存在 fail-open 的 catch。
- **Mock 运行时诚实性。** 由 `2026-08-05-mock-honesty-and-dead-residual-cleanup.md` 承接并完成。
- **CI 测试文件缺口。** `test:scripts` / `bridge:test` 步骤已在 main。

## 遗留产品决策 → TD-108

`packages/device-bridge` 的 `/connect` 与 `/health` **有意**以 `Access-Control-Allow-Origin: *` 加 Private Network Access 放行应答（任意 WiseEff 来源零摩擦配对，含内网/自托管）。审计曾标记为 P0 候选；调查确认是有意权衡——配对仍需短时效配对码与桥侧确认。是否收窄为来源白名单是产品决策，追踪号 TD-108。

## 验证

- `npm run contract:check` 在 main `57364c79` 之上通过。
- 冲突解决后 `src/NodeDebuggingPage.test.tsx` 58/58 通过。
- 含本收尾文档对的 `npm run docs:check` 通过。
