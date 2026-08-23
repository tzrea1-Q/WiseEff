# 验收基线完整性收口

> English: [English](../../../exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md)
>
> 状态：**已完成，2026-08-24**
>
> Tracker：TD-122

> 实现 PR：#603、#604、#605、#606、#607
>
> 最终 merged-main 证明：`493a257a1f3507f883715c5b5235af7a233914c7`

## 目标

恢复可复现的整库本地验收基线，不把失败藏进无关功能关闭项。固定诊断起点有两种不同证据质量：

- Darwin `npm run acceptance:visual` 使用任务专属 isolated DB：9 passed / 11 failed，其中 4 个 stale、7 个 missing snapshot。
- `npm run acceptance:browser -- --mode local-non-hdc` 从含测试生成变化的 TD-112 implementation worktree 运行，并使用既有共享本地验收库：109 passed / 29 个 planned skip / 18 failed，涉及 toolchain、permission、knowledge、小泽及其它共享状态夹具。
- 失败的 full browser run 没有可发布 full evidence manifest；它只提供待复现清单，不证明 18 项能在 fresh DB 复现。

29 个失败全部归 TD-122。Wave 3 没把这些命令写成全绿；四条关闭项各自的 scoped operation/visual gate 与实现 CI 独立通过。

## 历史诊断清单

先持久化该清单，供第一轮 clean/fresh run 精确对照；它不代表根因已分类，也不代表能复现。

Visual stale snapshot（`e2e/quality/visual.quality.spec.ts:38`）：

- `/` → `home-shell.png`
- `/parameter-review` → `parameter-review-workbench.png`
- `/logs` → `logs-workbench.png`
- `/debugging` → `debugging-simulator.png`

Visual missing snapshot：

- `/organization` → `organization.png`
- `/organization/members` → `organization-members.png`
- `captures the primary button hover state` → `state-button-primary-hover.png`
- `captures the primary button keyboard focus-visible state` → `state-button-primary-focus-visible.png`
- `captures the ModalDialog open state with backdrop` → `state-dialog-modal-open.png`
- `captures the data-table row hover state` → `state-table-row-hover.png`
- `captures the data-table sort header keyboard focus state` → `state-table-sort-header-focus.png`

历史 Playwright full browser result 从 `2026-08-22T08:50:17.791Z` 开始，18 个失败为：

1. `debugging-simulator.acceptance.spec.ts` — `blocks node writes for non-writer roles in UI and forced API calls`
2. `knowledge.acceptance.spec.ts` — `uploads a file entry and sees its extraction status`
3. `log-analysis.acceptance.spec.ts` — `configures a domain result webhook and delivers a signed payload after a domain-bound analysis`
4. `parameter-topology.acceptance.spec.ts` — `governs specs, browses real topology, edits, maps identity, and gates publish`
5. `permissions-matrix.acceptance.spec.ts` — Guest 的 `enforces visible route permissions`
6. `permissions-matrix.acceptance.spec.ts` — Hardware User 的 `enforces visible route permissions`
7. `permissions-matrix.acceptance.spec.ts` — Software User 的 `enforces visible route permissions`
8. `permissions-matrix.acceptance.spec.ts` — Hardware Committer 的 `enforces visible route permissions`
9. `permissions-matrix.acceptance.spec.ts` — Software Committer 的 `enforces visible route permissions`
10. `permissions-matrix.acceptance.spec.ts` — Admin 的 `enforces visible route permissions`
11. `permissions.acceptance.spec.ts` — `loads users, shows role/status, and gates user governance to Admin`
12. `permissions.acceptance.spec.ts` — `lets Admin manage a non-self user in UI while denying non-Admin access`
13. `permissions.acceptance.spec.ts` — `protects API-mode user context with production bearer authentication`
14. `product-feedback.acceptance.spec.ts` — `blocks non-Admin feedback admin APIs and page access`
15. `project-configuration-workbench.acceptance.spec.ts` — `creates, compares, releases, and restores baselines in source context`
16. `xiaoze-action.acceptance.spec.ts` — `denies out-of-permission approval execution with a safe message`
17. `xiaoze-perception.acceptance.spec.ts` — `does not leak data for an out-of-scope project question`
18. `xiaoze-perception.acceptance.spec.ts` — `rejects unauthenticated xiaoze requests`

fresh 复现前只做严格、非扩张的归属：

- 11 个 visual 没有现成 Open TD 精确承接，全部归 TD-122；不扩 TD-113/097，也不重开已关闭 TD-095。
- parameter-topology 与 project-configuration baseline 两项是 toolchain 候选；本机 `dts:toolchain:bootstrap` / `dts:toolchain:check` 前置按设计 fail-closed，不因此重开 TD-040/043/042。
- 其余 15 个 debugging/knowledge/permission/product-feedback/小泽失败可能与 TD-076 的 fixture/auth/runtime seam 重叠，但 fresh run 证明根因前仍只算 TD-122 诊断。
- 单个 log-webhook 失败使用的 root 本地环境缺少 `.env.example` 的 `LOG_WEBHOOK_ALLOW_INSECURE_LOCAL=true`；先按验收 runner/env parity 候选处理，不归 TD-116 的 crash-retry/outbox 债。

## 边界

- 使用任务专属 PostgreSQL 数据库；创建前先确认名字不存在。不得为了验收变绿而清理或修改共享开发库。
- 第一轮 fresh run 必须保存精确失败 test title、project、route、错误分类、截图/trace，以及每项在 `origin/main` 是否可复现。
- visual diff 必须人工 review；不得批量更新 snapshot 换绿。每个接受的图片都要有 route/state/viewport 与 console/network 证据。
- 将确定性 fixture/runtime 缺陷与硬件、目标环境、live provider、planned skip 分开。planned skip 不是 failure。
- 不把 TD-075 注册表归并、TD-076 fixture 总重构、TD-100 HDC 证据或 TD-118 L2 时延扩进本计划；只有证据证明时才建立关联，TD-122 仍负责恢复绿色基线。

## Git 与 PR 工作流

- 从刷新后的 `main` 创建 `codex/td-122-acceptance-baseline-integrity` 与隔离 worktree。
- implementation agent 只在 feature branch 实现/提交；parent 负责 review、开 PR、等待所有适用 CI 与 Merge bar、合入并刷新本地 `main`。
- snapshot、fixture/runtime 修复与文档证据必须可审；单次变更过大可拆多个 PR，但 final merged-main 绿之前 TD-122 保持 Open。

## 工作项

1. 在 fresh isolated DB 上运行 visual 与 full local non-HDC acceptance，保存机器可读 Playwright result 与人工可读 failure inventory。
2. 将起始 11 + 18 项逐一分类为 snapshot drift、确定性 fixture/runtime 缺陷、产品回归或错误纳入的外部依赖；有重叠时关联现有 TD，但不移除 TD-122 责任。
3. 每次只修一个确定性分组，先取得 focused RED；不放宽 authz、audit、DB、toolchain 或 evidence 断言换绿。
4. 只在支持平台上 review 并更新确认接受的 visual snapshot；每个更新都证明 route/state/viewport 前后状态。
5. 在最终 merged main 上重跑两条整库命令并校验 full evidence manifest。确认任务库精确名称与无连接后再删除。

## 成功标准

- `npm run acceptance:visual` 在记录的支持平台 0 failure，所有 snapshot 变化均已 review。
- `npm run acceptance:browser -- --mode local-non-hdc` 0 个非计划失败，只保留声明的 planned skip。
- `npm run acceptance:evidence -- --run <runDir>` 校验 full run 与所有 required operation ID。
- 每组修复的 focused test、`acceptance:coverage`、`acceptance:operations`、`acceptance:quality`、`docs:check`、`git diff --check` 全绿。
- 每个实现 PR 的 required CI/Merge bar 全绿；若 GitHub Actions 无法运行，必须明确记录经仓库负责人批准的完整本地 CI 例外。TD-122 移 Completed 前，final merged-main 重跑仍为绿色。

## 完成证据

- 历史 11 个 visual failure 已由 #604 的逐图评审 baseline 与 deterministic fixture/runtime 修复收口。最终 merged-main Gate0 的 Darwin visual 为 20/20；没有批量接受 snapshot，也没有靠 mask 隐藏缺陷。
- 历史 18 个 browser failure 已由 #603、#605–#607 的生命周期/runtime/evidence 修复收口。权威 owned run `full-20260823t165107589z-493a257a1f35-046f55ca` 从 clean `main@493a257a1f3507f883715c5b5235af7a233914c7` 启动，创建前确认 fresh database 不存在，应用 113 个 migration 到 `0115_log_webhook_delivery_retention_order.sql`，写入声明的 seed sentinel，并使用 run-scoped object root。
- 固定工具链通过：dtc/fdtoverlay 1.8.1、dtschema 2026.6。browser 为 127 expected、29 个声明的 planned skip、0 unexpected、0 flaky。运行产出 125 条 operation record，覆盖全部 108 个 required operation ID，missing/invalid/validation error 均为 0；原子发布的 `latest-full.json` 绑定精确 run 与 source commit。
- 11 个 nested disposable runtime 全部 `cleaned`；每个 nested API/frontend 均 stopped，每个 nested database/object root 均 removed。root cleanup 为 `complete`：owner/API/frontend/visual/browser PID 独立核验均不存在，精确 root database 查询计数为 0，精确 object root 不存在，18800/5180 空闲。
- artifact finalization 为 0 violation；单独执行事后 `acceptance:artifacts:check` 扫描 672 个文件，0 change、0 replacement、0 violation。前两次失败 Gate0 run 继续保留作取证；成功清理没有删除它们。
- #607 最终候选通过 scripts 811 passed / 5 planned skip、typecheck、build、docs governance、`acceptance:ci`、lint 0 error / 299 baseline warning、diff check。真实 SIGTERM 用例在一次 full-suite 未复现时序红灯后，定向压力循环 55/55；真实 nested PostgreSQL disposable-runtime smoke 独立证明 process/database/object cleanup。最终 Standards/Spec 复审均为 0 finding。
- #606/#607 执行时 GitHub Actions 月度额度已耗尽。仓库负责人明确授权在完整本地 CI 通过后合入，因此这两个 PR 按例外合入，不冒充 GitHub CI green；更早实现 PR 仍采用各自记录的 required checks。该例外不降低上述 final merged-main Gate0 证明。
- 计划其余 Review/No-change 文档行已对 `493a257a1` 复核；本次 closeout 没有改变产品 workflow、API contract、authz/audit 边界、target/HDC/provider 声明或仓库入口。新增 closeout diff 只涉及 planning/tracker 路径与中英文 companion。

## 文档影响矩阵

| 区域 | 状态 | 精确文件 / 证据 |
| --- | --- | --- |
| 仓库地图 | No change | `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`、`ARCHITECTURE.md`、`docs/zh-CN/root/ARCHITECTURE.md`、`docs/README.md`、`docs/zh-CN/README.md`；验收基线责任不改变仓库入口。 |
| 计划 / 技术债 | Update | `docs/exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`、`docs/zh-CN/exec-plans/completed/2026-08-22-acceptance-baseline-integrity.md`、`docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md`、`docs/PLANS.md`、`docs/zh-CN/PLANS.md`。 |
| 产品规格 | Review | `docs/product-specs/index.md`、`docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/index.md`、`docs/zh-CN/product-specs/product-spec.md`；只有复现证明产品合同有缺陷才更新，否则记录 unchanged。 |
| 架构 / 领域 | Review | `CONTEXT.md`、`docs/adr/README.md`、`docs/design-docs/full-stack-architecture.md`、`docs/zh-CN/design-docs/full-stack-architecture.md`；只有修复改变持久边界才更新。 |
| 质量 / 测试 | Update | `docs/QUALITY_SCORE.md`、`docs/zh-CN/QUALITY_SCORE.md`、`docs/design-docs/testing-strategy.md`、`docs/zh-CN/design-docs/testing-strategy.md`、`docs/developer/verification-matrix.md`、`docs/zh-CN/developer/verification-matrix.md`、`playwright.quality.config.ts`、`playwright.acceptance.config.ts`；只在平台/基线/运行时门禁语义变化时更新。 |
| 验收注册 / 证据 | Review | `e2e/acceptance/requirements.ts`、`e2e/acceptance/operationMatrix.ts`、`docs/developer/browser-acceptance-coverage-map.md`、`docs/zh-CN/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md`、`docs/zh-CN/developer/user-operation-coverage-matrix.md`、`e2e/acceptance/helpers/evidence.ts`、`e2e/acceptance/helpers/evidenceRun.ts`、`docs/generated/acceptance-browser-evidence.md`、`docs/generated/acceptance-operation-evidence.md`、`docs/generated/acceptance-operation-evidence/index.json`。 |
| 夹具 / 运行时 | Review | `e2e/acceptance/debugging-simulator.acceptance.spec.ts`、`e2e/acceptance/knowledge.acceptance.spec.ts`、`e2e/acceptance/log-analysis.acceptance.spec.ts`、`e2e/acceptance/parameter-topology.acceptance.spec.ts`、`e2e/acceptance/permissions-matrix.acceptance.spec.ts`、`e2e/acceptance/permissions.acceptance.spec.ts`、`e2e/acceptance/product-feedback.acceptance.spec.ts`、`e2e/acceptance/project-configuration-workbench.acceptance.spec.ts`、`e2e/acceptance/xiaoze-action.acceptance.spec.ts`、`e2e/acceptance/xiaoze-perception.acceptance.spec.ts`；`e2e/acceptance/helpers/database.ts`；`playwright.acceptance.config.ts`。fresh inventory 证明归属后才改。 |
| 视觉基线 | Review | `e2e/quality/visual.quality.spec.ts`、`e2e/quality/visual.quality.spec.ts-snapshots/darwin/`、`e2e/quality/visual.quality.spec.ts-snapshots/linux/`、`e2e/quality/visual.quality.spec.ts-snapshots/win32/`；只改已 review 的 route/state/viewport snapshot。 |
| 可靠性 / Runbook | Review | `docs/RELIABILITY.md`、`docs/zh-CN/RELIABILITY.md`、`docs/runbooks/manual-acceptance.md`、`docs/zh-CN/runbooks/manual-acceptance.md`；只有复现改变 operator prerequisite/runtime gate 才更新。 |
| 安全 / 治理 | Review | `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md`、`docs/security/README.md`、`docs/zh-CN/security/README.md`、`scripts/check-doc-governance.ts`、`scripts/check-doc-governance.test.ts`；保持 authz/evidence redaction 语义。 |
| 前端 / 设计 | Review | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`、`docs/design-docs/ui-design-system.md`、`docs/zh-CN/design-docs/ui-design-system.md`、`docs/developer/ui-quality-checklist.md`、`docs/zh-CN/developer/ui-quality-checklist.md`；只有接受的可见/交互合同变化才更新。 |
| API / 生成物 | No change | `docs/api/README.md`、`docs/zh-CN/api/README.md`、`docs/design-docs/api-contract.md`、`docs/zh-CN/design-docs/api-contract.md`、`docs/generated/openapi.json`；基线修复不得暗改 HTTP 合同。 |
| References | Review | `docs/references/productization-api-contract-draft.md`、`docs/references/pi-agent-provider-evidence.md`；只有复现暴露当前运行时引用过时才更新。 |

## 文档更新门禁

- 编辑产品或 snapshot 前，先持久化 fresh run 的逐用例 failure inventory。
- 每个 snapshot 变化都有明确 review 证据，不做批量接受。
- 所有延期/外部项仍关联 Open tracker，不计为绿色。
- 最终 merged main 上两条整库命令与 full evidence manifest 全绿。
- 每个 Update/Review 行已更新或有明确 unchanged 记录；中英文 companion 对齐；移动到 `completed/` 前 `npm run docs:check` 与 `git diff --check` 通过。
