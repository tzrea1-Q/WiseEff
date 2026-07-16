# 参数拓扑第四轮 Review 阻断修复计划

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-round4-review-blockers.md)
> 上一轮：[第三轮语义切换](./2026-07-16-parameter-topology-semantic-cutover-round3.md)

**目标：** 关闭第三轮 Review 阻断——真实 dt-validate schema、可运维 stage→finalize、精确锁定 merge 回写、matcher/review 作用域、诚实 manifest 回填、全局规格 hotspot、未匹配审核 UI+审计、回归与浏览器门禁。

**分支：** `fix/parameter-topology-round4-review-blockers`（merge `fix/parameter-topology-semantic-cutover-round3` @ `a94d0f57`，不 squash）。

**TD-042 仍为 BLOCKER，不得宣称生产 cutover 就绪。**

## 第四轮已落地修复（实现证据）

| 修复项 | 证据 |
| --- | --- |
| 有效厂商 dt-schema 生成 | `scripts/vendorDtSchemaGenerator.test.ts`；`dts:toolchain:check` + `dtc:seed:compile`（`failOnSchema: true`） |
| 可运维 `stage-review` → `finalize` | `migration.test.ts`（临时 PG、重连、注入失败）；runbook §7–9 |
| 精确 occurrence 锁定合入/回写 | `editService` 过期 `409`；base revision 不可变 |
| Matcher override + 审核阻断作用域（含 locator） | `matcherScope.integration.test.ts`；`nodeLocatorFingerprint`；`blocker_scope` |
| Manifest 回填 + `needs_review` 失败关闭 | `manifestBackfillMigration.test.ts`、`configRevisionManifest.test.ts`；编辑/校验/发布/回写门禁 |
| Hotspot 含全局厂商规格 | `postCutoverDashboard.integration.test.ts`；`organization_id IS NULL` |
| 未匹配 `createSpec` + `confirmPropertyMismatch` | `service.test.ts`、`SpecReviewQueue.tsx`；治理审计 |
| 黄金计数 **173/519** | `goldenPowerFixture.test.ts`、`ingestService.test.ts`、`matcher.test.ts`、`seedM1DtsFiles.test.ts` |

## 成功标准与验证

任务依赖、阶段提交建议、测试矩阵、文档影响矩阵与最终验证命令见英文计划正文。

文档更新门禁（与英文版同步）：

- [x] 中英文成对更新
- [x] `npm run docs:check` 通过
- [x] TD-042 明确为 BLOCKER（未关闭）
- [ ] 计划保持 active 直至父智能体 review
- [ ] `git diff --check` 无尾随空白
