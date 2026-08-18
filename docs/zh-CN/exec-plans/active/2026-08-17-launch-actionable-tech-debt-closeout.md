# 上线可关闭技术债收口

> 状态：**进行中** — 只按可执行批次推进；不要假装一次关完整个追踪表  
> 日期：2026-08-17  
> 分支：`feat/launch-actionable-td-closeout`  
> English: [`docs/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`](../../../exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md)  
> 追踪表：[`docs/zh-CN/exec-plans/tech-debt-tracker.md`](../tech-debt-tracker.md)

## 目标

在**不需要** HDC 真机、专家标注日志、或目标环境（自托管 Linux / 真实 OIDC / 生产近似快照）的前提下，把对上线有感的产品与文档缺口关完。其余追踪行必须诚实标成 **Done**、**Deferred** 或 **Blocked**。

本计划是上线窗口的可执行切片，**不是**一次合入关掉约 61 条。后续批次写在这里，避免下一任把 Blocked 项重新当施工单。

## 非目标

- HDC 真机 smoke 或硬件写入证据。
- 专家标注金标准日志或真实模型质量宣称。
- 目标环境证据（自托管 Linux、真实 OIDC、容量、回滚演练、对象存储恢复、生产近似身份 cutover 快照）。
- 需要 KMS 信封加密或真实投递量才能做的 Webhook outbox。
- 不是工单的长期约束（mock 模式存在、仅归档的调试 catalog 表）。
- 上线窗口高风险/低收益项（环境变量改名、token burn 大波次、PCW stretch 行数、可选 Admin L2 工具链面板）。
- 在本分支实现 **TD-079** 或 **TD-082**。它们属于点名的并行兄弟分支；不要改那些文件。

## Git 与 PR 工作流

| 角色 | 允许 |
| --- | --- |
| 实现代理 | 在从最新 `origin/main` 切出的 `feat/launch-actionable-td-closeout` 上提交；可以 `git push -u origin HEAD`；不开、不合 GitHub PR |
| 父代理 | 评审、开/合 PR，然后同步本地 `main` |

分支：`feat/launch-actionable-td-closeout`，在隔离 worktree 从最新 `origin/main` 检出。不要 push `main`，不要 `--no-verify`，不要改写已发布历史。

一计划一支。本分支上的连续提交是切片（方案 → 归属收口 → TD-056）。时间不够就停在已提交的完整切片。

### 并行兄弟分支（不要改他们的文件）

| 分支 | 负责 | 本计划的义务 |
| --- | --- | --- |
| `fix/td-079-acceptance-semantic-fixtures` / `#509` | TD-079 第一刀残留 PPV 夹具 | 已合入 `main` |
| `fix/td-079-acceptance-remaining` / `#510` | IMPACT + PERM-MATRIX-002 | 已合入 `main` |
| `chore/td-082-apierror-status-codemod` / `#507` | **TD-082** 机械删除 `ApiError` 第三参数 | 已合入 `main` |
| `fix/td-079-hierarchical-modules` / `#511` | **TD-079** hierarchical-modules 夹具 | 已合入 `main` |
| `fix/td-079-import-wizard` / `#512` | **TD-079** import-wizard 夹具 | 已合入 `main` |
| `feat/td-057-config-set-revision-gate` / `#513` | **TD-057** 配置集修订门禁 | 已合入 `main` |
| `fix/td-079-workbench-semantic` / `#516` | **TD-079** 工作台残留 PPV 夹具 | 已合入 `main` |
| `feat/td-079-parameter-files-semantic-sync` / `#519` | **TD-079** 语义 file-sync | 已合入 `main` |
| `feat/dts-reload-handoff-and-shapes` / `#517` | **TD-064** / **TD-065** | 已合入 `main` |
| `feat/openapi-client-or-dto-validation` / `#515` | schema 级 DTO 校验（TD-003/012/018 部分；TD-008 关闭并记残差） | 已合入 `main` |
| `test/td-073-render-harness` / `#518` | **TD-073** 部分（harness + 4 页测） | 已合入 `main` |
| `docs/parameter-governance-deferred-adr` / `#520` | D1–D8 / TD-117 / TD-063 ADR 锁定（TD-050 / TD-053 关闭） | 已合入 `main` |

合入前对照 `origin/main` 再核一次 `docs/PLANS.md` 与中英技术债追踪表。这两类文件经常撞车。

## 成功标准

- 本计划中英都在，并已从 `docs/PLANS.md` / `docs/zh-CN/PLANS.md` 挂出；本上线切片关心的追踪行都有 Done / Deferred / Blocked。
- 归属 deferred 计划已在验收登记 + playwright-cli 证据通过后移到 `completed/`（批次 1）。
- **TD-056** 只在归属收口已经提交且绿灯后，才作为本分支后续提交。**批次 3** 已于 2026-08-17 合入 `main`（#511 hierarchical-modules、#512 import-wizard、#513 TD-057）。**批次 4** 已于 2026-08-18 合入（#516 工作台、#519 file-sync、#517 TD-064/065、#515 DTO 校验、#518 TD-073 部分、#520 治理 ADR）。**TD-079 已关闭**（`fix/td-079-flip-ci-acceptance`，共享 CI 验收为 post-cutover）。
- 文档切片完成前 `npm run docs:check` 绿灯。UI 切片还要跑相关测试、`npm run build` 和 playwright-cli。

## 批次

### 批次 0 — 方案本身（本会话）

1. 新增本计划中英文本，含目标、批次、Git 与 PR、文档影响矩阵、文档更新门禁、验收命令、逐条 TD 状态。
2. 从 `docs/PLANS.md` 与 `docs/zh-CN/PLANS.md` 挂出。
3. TD-079 / TD-082 追踪行写明由并行分支负责，不改写他们的 Next Action 细节。

### 批次 1 — 归属 deferred 收口（本会话）

所属计划（已归档）：`docs/exec-plans/completed/2026-08-01-attribution-deferred-implementation.md`（中文孪生在 `docs/zh-CN/exec-plans/completed/`）。

PR1–PR3 代码已在 `main`（D-AG-01–04，TD-046 / TD-047 已关）。剩余：

1. 登记 PR3 缺失的验收/操作 ID（`DRV-REG-005` 从注册回放放置）；`DRV-REG-004` 保持诚实的 `required: false` / `@acceptance-planned` 桩，避免撑大共享 pre-cutover CI 套件（TD-079）。
2. 在 `/parameter-admin/modules` 收集 playwright-cli 证据（`1440x900` / `768x1024` / `390x844`，0 console error），覆盖性质/基数与回放控件。
3. 在覆盖图与操作矩阵（中英）记录补充证据。**不要**把这些 ID 翻成共享 CI job 的阻断 Playwright。
4. 若证据和文档更新门禁都过，把归属计划移到 `completed/`（中英都要，且不得在 `active/` 留同名文件），并更新 `PLANS.md`。

若 `playwright-cli` 不能运行，停止并报告 blocker，不要谎称前端验收完成。

### 批次 2 — TD-056 参数文件回滚 / 操作者显示名（批次 1 已提交后，本会话若有余力）

TDD。API + port + UI + 测试 + 中英文档。不要重写配置工作台。

- 在参数文件 API 与 `ParameterFileRepository` 增加 promote-to-current / 回滚到指定版本。
- 复用基线恢复已有的 `origin='rollback'` 指针版本：插入新的当前版本，把所选字节带到最新指针；不要倒带历史。
- 把 `createdByUserId` 解析成显示名，写进版本列表。
- 扩展已有版本历史表面（POD-C6）。影响范围用 ConfirmDialog。产品文案用中文。
- 若这是新的用户可见交互，先登记验收/操作 ID；否则写明既有覆盖加 playwright-cli 为何足够。
- 验证绿灯后在中英追踪表关闭 TD-056。**已于 2026-08-17 在本分支完成。**

### 批次 3 — 并行轨道（批次 2 已在 `main` 之后）

不要另开一份总方案。这些轨道从最新 `origin/main` 并行推进。每条轨道只碰自己的文件。**已于 2026-08-17 合入：** #511 hierarchical-modules、#512 import-wizard、#513 TD-057。

| 轨道 | 分支 | 负责 | 不要碰 |
| --- | --- | --- | --- |
| TD-079 hierarchical-modules | `fix/td-079-hierarchical-modules` / `#511` | `e2e/acceptance/hierarchical-modules.acceptance.spec.ts`，以及它需要的语义 list `moduleId` 接缝（`listSemanticParameters` 从 `b.module_id` 取值；删除门禁改数 bindings） | `parameter-import-wizard.acceptance.spec.ts`；`project-configuration-workbench.acceptance.spec.ts`；`parameter-files.acceptance.spec.ts`；翻转 CI env |
| TD-079 import wizard | `fix/td-079-import-wizard` / `#512` | `parameter-import-wizard.acceptance.spec.ts` | 其他批次 3 轨道不要改那个 spec |
| TD-057 修订门禁 | `feat/td-057-config-set-revision-gate` / `#513` | 给配置集视图接真实修订来源，再恢复门禁。不要发明 `revision-teaching-1`。 | TD-079 夹具轨道不要改 `ConfigSetBaselinePanel` / 发布基线产品代码 |

**明确不在本批，批次 3 之后仍开放（后续已关闭）：**

- ~~`parameter-files.acceptance.spec.ts` 的 file-sync~~（#519；`PARAM-FILE-ROLLBACK-001` 仍 skip）
- ~~`project-configuration-workbench.acceptance.spec.ts`~~（#516）
- ~~`xiaoze-action.acceptance.spec.ts` 的 pre-cutover 回退~~（`fix/td-079-flip-ci-acceptance`）
- ~~非 acceptance 的 `e2e/parameter-management.api.spec.ts`~~（`fix/td-079-flip-ci-acceptance`）
- ~~翻转共享 CI 验收 job / `WISEEFF_SEED_LEGACY_FLAT_IDENTITY`~~（`fix/td-079-flip-ci-acceptance`）
- ~~**TD-064** / **TD-065**~~（#517）

### 批次 4 — 更后的上线可见产品切片

**已于 2026-08-18 合入 `main`：** #516、#519、#517、#515、#518、#520。

| ID | 为何排在后面 | 说明 |
| --- | --- | --- |
| **TD-064** | 工作台交接至 `/dts-reload` | **已完成**（#517）。 |
| **TD-065** | 拓宽 DTS 重载值形态 | **已完成**（#517；删除 = 诚实预检失败）。 |

### 更后的产品/平台批次（本切片不阻断上线）

卫生与架构余量是真债，但不该抢走上线窗口：TD-003 / TD-012 / TD-018（生成客户端余量；TD-008 已关并记 POST logs + SSE 残差）、TD-005（已完成计划卫生）、TD-014（#532 导入导出之后的目录余量）、TD-048 / TD-049 / TD-051 / TD-052 / TD-055 / TD-117（治理——决策已锁、实现仍开；TD-050 / TD-053 已关）、TD-059（剩余弹窗；`fix/td-059-binding-draft-modaldialog` 未合入）、TD-063 / TD-067 / TD-068（重载/桥/安全后续；TD-066 已由 #531 关闭）、TD-071–TD-077（测试架构；TD-073 / TD-075 部分关闭；TD-076 / TD-077 / TD-071 仍开）、TD-097 / TD-109 / TD-110 / TD-112 / TD-114（前端余量；TD-097 / TD-112 经 #533 / #526 部分关闭）。触及那些表面时再捡；不要捆进本分支。TD-013 已由 #529 关闭。

## 本上线切片的逐条 TD 状态

图例：**Done** = 已关或由上面批次关闭；**进行中（兄弟分支）** = 由点名并行分支负责；**Deferred** = 上线窗口主动不做；**Blocked** = 没有真机、专家或目标环境就关不了；**Open（后续）** = 真工作，但不在本分支。

| ID | 状态 | 批次 / 负责人 |
| --- | --- | --- |
| 归属计划收口（DRV-REG-004 / `DRV-REG-005`） | 批次 1 Done（本分支） | 批次 1 |
| TD-046 / TD-047 | Done（已在 `main` 关闭） | 批次 1 补证据并归档 |
| TD-056 | 批次 2 Done（本分支） | 本分支，批次 1 之后 |
| TD-057 | 已由 #513 合入 `main` | 批次 3：`feat/td-057-config-set-revision-gate` |
| TD-064 / TD-065 | 已由 #517 合入 `main` | 批次 4 |
| TD-079 | **Done**（`fix/td-079-flip-ci-acceptance`） | 共享 CI 验收为 post-cutover。小泽 pre-cutover 回退与 `e2e/parameter-management.api.spec.ts` 已迁离退役 PPV 提交。 |
| TD-082 | 已由 #507 合入 `main` | `chore/td-082-apierror-status-codemod` |
| TD-001 | Deferred | mock/API 长期对等约束，不是工单 |
| TD-033 | Deferred | 仅归档的遗留调试 catalog 表 |
| TD-031 | Deferred | 环境变量改名；上线窗口混淆成本高 |
| TD-113 | Deferred | token burn 大波次；只在触及表面时继续 |
| TD-062 | Deferred | PCW stretch 800–1000 行；勿重开 #258 |
| TD-043 | Deferred | 可选 Admin L2 工具链面板 |
| TD-100 | Blocked | 剩余是 HDC 真机 |
| TD-009 / TD-090 | Blocked | 专家日志 / 真实模型质量 |
| TD-007 | Blocked | 目标 Redis/队列证据 |
| TD-019–TD-025 | Blocked | 目标 OIDC、自托管 smoke、备份恢复、容量、回滚演练 |
| TD-022 | Blocked | 第一台已部署 Linux 目标 |
| TD-038 / TD-042 | Blocked | 目标证明 / 干净快照 cutover 演练 |
| TD-039 / TD-040 | Blocked | 跟拓扑 cutover 走；不要另开程序 |
| TD-103 / TD-105 / TD-116 | Blocked | 需要 KMS 或真实投递量 |
| 其余开放行（TD-003、TD-005、TD-012、TD-014、TD-018、TD-048–049、TD-051–052、TD-055、TD-059、TD-063、TD-067–068、TD-071–077、TD-097、TD-109–112、TD-114、TD-117 等） | Open（后续） | 不在本分支。TD-003/012/014/018/073/075/097/112/048 保持**部分**开放；TD-008/013/050/053/064/065/066 已关。 |

## UI 交互自动化审查

批次 1 受影响 spec：`e2e/acceptance/parameter-topology.acceptance.spec.ts`。

| ID | 行为 | 自动化 |
| --- | --- | --- |
| `DRV-REG-004` | Admin 编辑 `driverNature` / `instanceCardinality`；组织 Admin 不能改平台主体；platform-admin 组织侧编辑进入组织审计；改为 singleton 只刷新发布阻断。 | 保持 `@acceptance-planned` / `required: false`。单元与服务端已在 `main`。补充 playwright-cli 在 `work/ui-checks/attribution-deferred/`。不要撑大共享 pre-cutover CI 套件（TD-079）。 |
| `DRV-REG-005` | Admin 设置注册默认业务分类并执行「从注册回放放置」；auto 驱动组移动；curated 冻结。 | 新 planned ID + `@acceptance-planned` 桩。单元覆盖：`ModuleEditDialog.test.tsx` + 服务端放置测试。同一证据目录的补充 playwright-cli。阻断 Playwright 等 TD-079。 |

批次 2（TD-056）已在实现前登记 `PARAM-FILE-ROLLBACK-001`（`required: false`，`@acceptance-planned`），落在 `e2e/acceptance/parameter-files.acceptance.spec.ts`。共享 Playwright 仍等 TD-079；本切片证据是单元/服务端测试加 `work/ui-checks/param-file-rollback/` 的 playwright-cli。

操作证据在桩被自动化后仍走 `npm run acceptance:browser` / `npm run acceptance:evidence`。本切片的操作证据是 playwright-cli 加单元/服务端测试。

## 验证

```bash
npm run docs:check
npm run acceptance:coverage
npm run acceptance:operations
# 批次 1 UI 证据（Admin 弹窗走查用 mock 前端即可）：
# VITE_WISEEFF_RUNTIME_MODE=mock npm run dev
# playwright-cli 三视口 + snapshot + screenshot + console error
# 批次 2（实现时）：
# npx vitest run server/modules/parameter-files/service.test.ts \\
#   server/modules/parameter-files/repository.test.ts \\
#   server/modules/parameter-files/routes.test.ts \\
#   src/infrastructure/mock/mockParameterFileRepository.test.ts \\
#   src/infrastructure/http/parameterFileClient.test.ts \\
#   src/components/project-configuration-workbench/ProjectConfigurationWorkbench.test.tsx
# npm run build
# playwright-cli 三视口打开 /parameter-admin/projects/:id/configuration
#   + 检查器版本历史 + 恢复确认 + console error
# 证据：work/ui-checks/param-file-rollback/
# 批次 3 hierarchical-modules（本轨道）：
# npm run test:server -- server/modules/parameters/parameterModuleRepository.test.ts
# npm run acceptance:e2e -- e2e/acceptance/hierarchical-modules.acceptance.spec.ts
# npm run docs:check
# npm run build
```

除非成本很低，否则不跑完整浏览器验收。不要用本地 skip 宣称目标环境就绪。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | Review | `AGENTS.md`、`ARCHITECTURE.md` — 预期不改运行模式或地图 |
| 规划 | Update | 本计划 + 英文孪生；`docs/PLANS.md`；`docs/zh-CN/PLANS.md`；批次 1 移动归属计划 |
| 产品规格 | Review | 不变：产品规格里的「回滚」是审阅/调试快照语义，不是文件历史恢复。操作文案在工作台检查器。 |
| 领域 / 词汇 | Update | `docs/design-docs/domain-model.md`（+ 中文）：文件版本 `origin` 含 `rollback`；单文件历史恢复使用同一套指针版本规则。 |
| 设计文档 | Review | 归属延期问题保持 Locked；不重开 grilling |
| API | Update | `docs/design-docs/api-contract.md`（+ 中文）：`POST .../rollback`、版本列表 `createdByDisplayName`、审计 `parameter-file-rollback` |
| 前端 | Update | `docs/FRONTEND.md`（+ 中文）— 工作台检查器「恢复为当前」+ 显示名；去掉旧文件面板 TD-056 待办句 |
| 安全 | Review | 带审计写入 `parameter-file-rollback`；复用既有参数文件审计接缝；不新增密钥 |
| 可靠性 / runbook | 无变更 | 不做目标环境宣称 |
| 开发者环境 | 无变更 | 不新增环境变量 |
| 质量 / 验收 | Update | 覆盖图 + 操作矩阵中英；`PARAM-FILE-ROLLBACK-001` 在 `requirements.ts` / `operationMatrix.ts` / `parameter-files.acceptance.spec.ts` |
| 生成物 | 无变更 | 无迁移；批次 2 复用 schema 已有的 `origin='rollback'` |
| 参考 | Review | 不变：产品化 API 草稿不是现行合同；现行合同已在上方更新 |
| 技术债 | Update | 中英追踪表：TD-056 关闭；批次 3 已合入（#511 hierarchical-modules、#512 import-wizard、#513 TD-057）；批次 4 已合入（#516/#519 TD-079 夹具、#517 TD-064/065、#515 DTO 校验、#518 TD-073 部分、#520 ADR；TD-008/050/053 关闭）。**TD-079 已关闭**（`fix/td-079-flip-ci-acceptance`，共享 CI post-cutover）。TD-082 已由 #507 关闭 |

## 文档更新门禁

一批次在下列完成前不得称为完成：

1. 该批次影响矩阵里每个 `Update` / `Review` 行都已更新，或有证据记录为不变。
2. 该批次关闭或推进的中英追踪行已更新。**TD-079 已关闭**（`fix/td-079-flip-ci-acceptance`，共享 CI 验收为 post-cutover）。TD-082 已由 #507 关闭。
3. `npm run docs:check` 绿灯。
4. 该批次的 UI 交互覆盖已登记（planned 桩 + 补充 playwright-cli 是诚实做法；伪造 `@acceptance` 标记不是）。
5. 把计划移到 `completed/` 后，同名文件不得留在 `active/`（中英皆然）。

Deferred 或 Blocked 工作留在 `tech-debt-tracker.md`；不要删那些行。
