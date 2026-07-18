# 参数拓扑第六轮 Review 阻断修复

> English: [English](../../../exec-plans/active/2026-07-16-parameter-topology-round6-review-blockers.md)
> 上一轮：[第五轮](./2026-07-16-parameter-topology-round5-review-blockers.md)

**目标：** 关闭父智能体第五轮 Review 阻断：历史跨租户 review task scope 校正、无损手工规格 ID、全局规格激活权限、完整 valueShape 激活 UX、真实 submit→review→merge 验收、租户作用域 fixture 清理、稳定 `npm run test:all`。

**分支：** `fix/parameter-topology-round6-review-blockers`
**保留基线：** Round5 `a2669639`（`--no-ff` 合并）。**TD-042 仍为 BLOCKER — 非 production cutover ready。**

## 成功标准

1. 新增前向迁移（0058+）仅从可信 join 重算 review-task 作用域；污染 FK 清除；歧义行保持 needs-review 并阻断 finalize；从脏 0055 状态升级路径有真实 PG 证明。
2. `vendor,limit` 与 `vendor-limit`（及其他有损 sanitize 对）生成不同稳定 ID；碰撞审计 fail-closed，不静默重写已引用 ID。
3. 组织 Admin 只能激活本组织 draft；global draft 激活服务端拒绝；仍可读取/绑定 active global spec。
4. 激活面板/API 保留完整推断 valueShape；gpio_int 三单元保留；不完整 shape 阻断激活。
5. 拓扑验收走真实 submit→review→merge→writeback→validate（无 repository 伪造状态）；base 不可变；candidate 新建；`writeback.skipped === false`。
6. Fixture 清理按 organizationId+projectId+name 解析 Config Set；跨组织/项目同名数据不受影响。
7. 默认 `npm run test:all` 稳定，无需临时 maxWorkers；从根因隔离 migration/dashboard。
8. 双语文档更新；`npm run docs:check` 通过；TD-042 保持 BLOCKER。
9. 默认 shell 下，检查脚本、API runtime、seed 编译与拓扑验收都从项目本地 dtschema venv 解析固定工具链，不再要求导出个人 Python 路径。
10. API 模式 `/parameters` 只渲染 binding-centric 拓扑、编辑与提交表面；遗留扁平表格和 `recommendedValue` 草稿语义仅保留在 mock，真实提交、角色审核和合入走正式 UI/API 边界。
11. `projectId` 改变时，在加载新项目前清除全部项目作用域状态：preferred revision、待提交草稿、候选人/错误、发布消息和映射消息；新项目必须从自身 `current` revision 开始加载。
12. 可交付的 operation record 与 artifact 存放在 Playwright 临时输出目录之外、按 `runId + sourceCommit` 唯一隔离的不可变目录中；聚焦运行不能覆盖或破坏最近一次完整运行证据，checker 必须拒绝混合 run/commit。
13. Binding draft 提交使用明确的 wire identity（`draftId`、`projectParameterBindingId`、`parameterSpecId`），不再用 legacy `parameterId` 冒充 binding；服务端验证组织、项目、binding/spec 一致性和 candidate revision/write lock，同时仅通过独立 item shape 保留遗留扁平提交合同。
14. 新的前向迁移会失效所有缺少精确 candidate revision 的活动草稿，包括 `file_sync` 和冲突衍生行；使用真实 PostgreSQL 证明 0060→0061 升级、回滚、报告和幂等，且不重写 0060。
15. Typed binding 的 `set|delete` action 会持久贯穿 draft、submission item、change request、candidate proof、audit 和 locked writeback。Delete 必须在同一条精确 candidate evidence chain 中存在 tombstone，完成真实审核/合入/re-ingest 后属性消失，且不会为已删除值创建替代 binding revision。
16. 人工维护的数据库 schema 摘要准确反映 0053/0059/0060+ 以及本轮新增的 action/invalidation 字段、约束、索引和表。

## 任务映射

| 任务 | Finding | 实现焦点 |
| --- | --- | --- |
| T1 | 0057 通过 coalesce 信任污染 FK | 0058 仅信任 evidence join + PG 升级测试 |
| T2 | sanitize 后再哈希碰撞 | 无损 canonical 哈希输入 + 碰撞审计 |
| T3 | 组织 Admin 激活全局草稿 | activate 仅限本组织；global fail-closed |
| T4 | UI 丢失 valueShape 字段 | mapper→detail→panel 完整 shape；服务端复核 |
| T5 | 验收跳过 merge 路径 | 真实 CR 工作流 + writeback 断言 |
| T6 | cleanup 仅按 name 查 Config Set | 租户作用域解析 + PG 隔离测试 |
| T7 | test:all PG 竞态 | 标准 vitest/npm 脚本固化隔离 |
| T8 | 文档/浏览器/证据 | 双语文档 + playwright-cli + 门禁 |
| T9 | `dt-validate` 依赖开发者 PATH 导出 | 项目本地 venv bootstrap + 共享二进制解析器 + 默认 shell 验收 |
| T10 | API 模式渲染遗留推荐值工作台 | API/mock 渲染隔离 + binding 草稿提交 UI + 角色审核/合入 UI 验收 |
| T11 | 切换项目时泄漏上一项目 candidate revision | 原子清除项目状态 + rerender 回归测试 |
| T12 | 聚焦 Playwright 会删除完整运行的 evidence artifact | 不可变 evidence run 目录 + latest-full 发布 + 混合运行拒绝 |
| T13 | 提交 schema 剥离 binding/spec 语义身份 | 显式 binding-draft wire item + 服务端租户/spec/write-lock 校验 |
| T14 | 0060 保留缺少 candidate 的 `file_sync` 草稿 | 前向全 origin 失效迁移 + PG 升级/回滚/幂等测试 |
| T15 | Typed `action=delete` 无法提交或合入 | 持久化 action + 精确 candidate tombstone proof + delete writeback acceptance |
| T16 | 生成数据库摘要过期 | 从迁移人工重推导 `docs/generated/db-schema.md`（TD-004） |

## 任务依赖

```text
计划
  → T1/T2/T3/T6 可并行
  → T4（前端 + 激活校验）
  → T5（验收 merge；依赖 T3/T4 语义）
  → T7（测试隔离）
  → T8 文档 + 浏览器 + 全量门禁
```

## 验证矩阵

| 领域 | 命令 / 焦点 |
| --- | --- |
| Scope reconcile | 从污染 0055 状态升级的 0058 PG 测试 |
| Spec identity | `vendor,limit` ≠ `vendor-limit`；属性化测试 |
| Global authz | activate 服务层 + HTTP/PG 负向 |
| ValueShape | mapper/panel/service + playwright-cli |
| Acceptance merge | topology acceptance submit→merge→reload |
| Cleanup | 跨组织/项目同名 Config Set PG 测试 |
| 稳定性 | 默认配置连续 `npm run test:all` ×3 |
| 工具链 | `dts:toolchain:check`、`dtc:seed:compile` |
| 默认 shell 工具链 | 从 `PATH` 移除个人 Python bin；共享 resolver 单测；bootstrap 项目 venv；不注入 PATH 运行检查和 API 拓扑验收 |
| API 模式语义 UI | `ParametersPage` 缺席断言；binding 编辑/提交组件测试；Playwright typed edit → submit → 角色审核 → merge |
| 项目切换隔离 | 组件从 Aurora candidate `rerender` 到 Nebula；Nebula 首次请求使用 `current`；旧消息/草稿不残留 |
| Evidence 稳定性 | 完整证据 → 聚焦 topology 运行 → `acceptance:evidence` 仍通过；混合 `runId`/commit 与缺失 artifact 均 fail-closed |
| 提交身份 | Schema 单测、HTTP/PG 成功、跨项目/规格不匹配/stale draft 负向，以及 legacy item 回归 |
| 无 candidate 草稿门禁 | 真实 PG：迁移到 0060，插入 manual/file_sync/冲突衍生草稿，执行 0061，注入回滚并幂等重跑 |
| Delete 工作流 | Schema/HTTP/PG 测试 + 真实 delete draft → submit → 角色审核 → semantic merge/writeback → re-ingest/reload acceptance |
| 生成 DB 摘要 | 将文档字段/约束/索引与 0053/0059/0060+ 对照，并运行 `npm run docs:check` |

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | 更新 | 本计划；`docs/PLANS.md`；中英文配对 |
| 领域模型 | 更新 | `docs/design-docs/domain-model.md` + 中文 |
| API 合同 | 更新 | `docs/design-docs/api-contract.md` + 中文 |
| 测试策略 | 更新 | `docs/design-docs/testing-strategy.md` + 中文 |
| 验证矩阵 | 更新 | `docs/developer/verification-matrix.md` + 中文 |
| Cutover / 身份 runbook | 更新 | `docs/runbooks/parameter-identity-cutover.md` + 中文 |
| 前端 | 更新 | `docs/FRONTEND.md` + 中文 |
| 安全 / 授权 | 审阅/更新 | `docs/SECURITY.md` + 全局规格治理说明 |
| 技术债 | 审阅 | TD-042 保持 BLOCKER |
| 验收证据 | 更新 | `e2e/acceptance/helpers/operationEvidence.ts`；browser runner/checker 测试；测试/验证文档及中文配对 |
| 生成数据库 schema | 更新 | `docs/generated/db-schema.md`（人工摘要；仓库无生成器，由 TD-004 跟踪） |

## 文档更新门禁

计划完成前：每个 Update/Review 行已更新或有证据标明未变；`npm run docs:check` 通过；不得关闭 TD-042。

## 执行检查点（2026-07-18）

- T1/T2 复审项已关闭：污染任务即使 evidence 不含 scope ID 也会重新打开；finalize 阻断该迁移运行的全部 open task；手工实体 ID 与持久化 `specificationKey` 均采用无损摘要，同组织可同时保存两个碰撞样例。
- T4 复审项已关闭：规格或 valueShape 切换时重置激活表单，前后端均拒绝小数 cell 数。
- T5 自动创建并销毁带 marker 校验的 `wiseeff_acceptance_disposable_*` 数据库，执行全部 migration、真实 identity apply+cutover，并跑通 Software User → Hardware Committer → Software Committer → Software User 的正式 submit/review/merge/writeback/reload 链路。candidate binding 保存合法三单元 phandle AST，base config/binding revision 保持不变。
- 曾被弱化的 `PARAM-ASSIGNEE-001/002` 与参数审阅 operation 已恢复可见 UI 操作。API 模式从组织+项目作用域接口读取 eligible assignee；浏览器验收在每个角色 UI 操作前切换 production HMAC 身份。
- 已用 `playwright-cli` 在 1440×900、768×1024、390×844 三种视口验收 `/parameters` 与 `/parameter-admin`。真实 API 拓扑显示 `sc8562@6E` 的 `gpio_int = <&gpio13 29 0>`；disposable 管理夹具完整保留 `phandle-list`、`bits=32`、`groups=1`、`cellsPerGroup=3`，验证了切换规格后表单重置、小数/缺失 cell 阻断、本组织草稿经真实 HTTP 200 激活、global draft 无可用激活入口以及强制 global 激活返回 HTTP 403。console error 为 0。验收中发现的 390px topbar 溢出已在 `51bc0608` 修复，两个页面随后均为 document overflow=false。
- 已从干净 source commit `51bc06085df382754197270611cc25e990e19758` 重新生成完整 `acceptance:browser` 证据（`Dirty worktree: false`）。Playwright 共 85 项：81 expected/pass、4 项硬件条件 skip、0 failure/error。需求覆盖 59/59；operation evidence 覆盖 56/56，共 71 条记录，0 invalid、0 validation error；`npm run acceptance:evidence` exit 0。外层 runner 仅因 pilot readiness 的外部 `deviceGateway`、`xiaozeLlm`、`backups` 阻断而保持 failed。
- 已记录三次默认 `npm run test:all`（日志 2/3/4）且均 exit 0，结果一致：前端 314 files，2178 passed / 5 skipped；服务端 214 files，1531 passed / 1 skipped。未使用临时 worker 参数。
- 工具链门禁通过：dtc 1.8.1、fdtoverlay 1.8.1、dtschema 2026.6；Aurora、Nebula、Atlas 均真实编译成功且 diagnostics 为空。Generated evidence/docs 已记录在 `4c199b3a`；提交后 contract/docs/build、独立前后端测试、默认 `test:all`、工具链、self-host、operation evidence、diff 门禁均通过。计划仅因明确的外部 pilot/cutover 阻断继续 active。TD-042 仍为 BLOCKER：尚未执行干净非客户快照 apply→cutover→整库恢复演练。

## 父智能体 Review 续修检查点（2026-07-18）

父智能体仍为 `Request changes`，包含两个 P1。复现确认：默认 shell 无法解析 `dt-validate`；API 模式 `/parameters` 在拓扑工作区之后继续进入遗留 `recommendedValue` 表格/草稿表面。

- T9 设计：从固定 `tools/dts-toolchain/requirements.txt` 创建忽略提交的 `.wiseeff-tools/dts-toolchain` venv；提供显式 bootstrap；API runner 与 CLI check 共用同一解析器。项目本地二进制优先，非法显式 override 失败关闭，runtime 校验不得自动联网安装或修改宿主机。
- T10 设计：API 模式只渲染 `ApiProjectTopologyWorkspace`；遗留 table/detail/draft/export 仅保留 mock。Binding 编辑必须填写原因，保留 `/api/v2` 返回的 typed binding/candidate 身份，并通过 `/api/v1/parameter-submission-rounds` 提交。Hardware Committer、Software Committer、Software User 继续在真实 `/parameter-review` UI 操作。
- TDD 门禁：先让 resolver 与渲染隔离测试失败；binding 提交测试须断言 typed identity/value/reason 和服务端过滤的角色候选；Playwright 必须用可见的编辑/提交/审核/合入交互替换直接推进业务状态的 API。
- 文档门禁：从中英文开发、测试、验证和 cutover 文档移除个人 `~/Library/Python/...` PATH 指引；记录项目 bootstrap/解析顺序以及遗留参数工作台仅限 mock。

### 续修执行结果

- T9 已在 `858d8751` 关闭：`npm run dts:toolchain:bootstrap` 创建被忽略的项目 venv，CLI check 与 API runtime 共用同一解析器。默认 shell 不添加个人 Python PATH 时，`npm run dts:toolchain:check` 直接通过：dtc/fdtoverlay 1.8.1、dtschema 2026.6；Aurora、Nebula、Atlas diagnostics 均为空。
- T10 由 `e9eb025f`、`0843cc75`、`1abb57f2` 关闭：API mode 只渲染 binding-centric 拓扑工作区；typed edit 保留 candidate/binding/spec/value/reason；可见的项目作用域处理人下拉框经公开接口 submit；真实角色 UI 完成 review 与 semantic merge/writeback。`PARAM-ASSIGNEE-001/002` 现已在 disposable 全链路中精确断言默认值与排除集合，不再依赖已移除的遗留表格。
- in-app browser 使用 disposable post-cutover API/数据库验收 `http://127.0.0.1:5173/parameters`，视口为 1440×900、768×1024、390×844。遗留表格、`recommendedValue` 文案和遗留 Excel 导出计数均为 0；可见 `gpio_int` 编辑保留 `<&gpio13 30 0>`，三类处理人来自 API，并提交正式审核；console error 为 0。验收发现的 390px 拓扑树溢出已在 `7de8f56c` 修复，最终 document width 为 390px、无横向滚动。截图为 `work/ui-checks/parameter-topology-round6-followup-*.png`。
- 在续修 source 状态连续运行三次默认 `npm run test:all`，均 exit 0 且计数一致，无 worker override：前端 315 files、2182 passed / 5 skipped；后端 214 files、1534 passed / 1 skipped。
- 从干净 source `1abb57f2` 运行标准外层 `npm run acceptance:browser`，结果准确为 failed：preflight 受外部 `deviceGateway`、`xiaozeLlm`、`backups` 阻断；用户已有 8787 同时配置为 HDC/development auth，Playwright 为 69 passed / 11 failed / 4 skipped。诊断证据保存在 `bb2e3e61`。
- 另一次从干净 source `bb2e3e6160b05930ecc8a7e5a0a88ab22fcd7bab` 运行，使用隔离端口 5174/18787、production HMAC、simulator 与 deterministic Xiaoze，未触碰 8787。Playwright 共 84 项：80 passed / 4 项硬件条件 skipped / 0 failed；workflow A–E、G–I 通过；requirements 59/59；operation evidence 56/56、71 records、0 invalid、0 validation error；`npm run acceptance:evidence` exit 0。该次外层 runner 仅因显式跳过 preflight 保持 failed，不能覆盖真实外部 preflight blocker。
- TD-042 保持 BLOCKER。尚未执行干净非客户快照 apply→cutover→整库 restore 演练，因此本计划不宣称 production ready、cutover ready，也不会在父智能体 Review 前宣称可合并。

## 父智能体 Review 后续检查点 2（2026-07-18）

父智能体仍为 `Request changes`，要求关闭 T11–T13。实现前的根因检查确认三项 finding 均成立：

- T11：项目切换 effect 清除了 pending draft 和候选人，却保留 `preferredRevisionId`；load effect 因而会在项目 B 下请求项目 A candidate，并把 404 映射成错误的空状态。
- T12：operation JSON 记录持久化在 `test-results/acceptance-operation-evidence`，而通过 `testInfo.outputPath()` 写入的 JSON/截图位于 Playwright 会清空的 `test-results/acceptance`。聚焦运行会删除后者，却不会原子替换前者。
- T13：前端发送语义 ID，但 `submitRoundBodySchema` 只声明 `parameterId`、`targetValue` 和 `reason`，Zod 会剥离 binding/spec identity。当前 service 依赖把 binding ID 填入 legacy `parameterId` 后再间接推断状态。

实现顺序与 TDD 门禁：

1. 先增加组件 `rerender` 回归并观察跨项目 revision 请求，再在新项目加载前清除全部项目作用域状态。
2. 先增加 run manifest/checker/runner 测试，复现聚焦运行删除 artifact 和混合 run 聚合，再把可交付 artifact 移到不可变完整运行目录，仅在完整成功后发布 `latest-full`。
3. 先增加显式 binding draft identity 的 schema 与 HTTP/PG RED 测试，以及租户/spec/write-lock mismatch 负向，再引入独立 binding item shape，不放宽 legacy 提交。
4. 更新中英文 API/测试/验证/前端文档，执行浏览器跨项目验收和全量验证矩阵。外部 readiness 与 TD-042 继续如实保留为 blocker。

### 后续执行结果 2

- T11 已由 `a585162b` 与 `4fcc707a` 关闭：workspace 将 preferred revision 与所属项目一起保存；切换项目时清除 preferred revision、draft、候选人、发布消息和映射消息；草稿使用数据库实际返回的持久化 ID。组件 rerender 回归与真实 topology acceptance 都先创建 Aurora candidate，再切到 Nebula，断言加载 Nebula 自身 `current` revision、没有伪 404，然后切回 Aurora 继续正式工作流。
- T12 已由 `b0c9d644` 关闭：可交付 record/artifact 位于 `test-results/acceptance-evidence-runs/runs/<sourceCommit>/<runId>`；只有完成的 full run 才发布 `latest-full.json`。聚焦 topology 运行不再清除或重新发布 full namespace；checker 会拒绝缺失 artifact 和混合 run/commit 输入。
- T13 已由 `c3da65ea` 关闭：提交 wire contract 增加独立 binding-draft item，显式携带 `draftId`、`projectParameterBindingId`、`parameterSpecId`。Schema、service 与 HTTP/PG 测试证明组织、项目、spec、candidate 和 write lock 校验，同时保留彼此独立的 legacy flat-item 合同。
- 干净 source commit `4fcc707a4c8a8a12860a2e4ad36051990e66385b` 生成 full run `full-20260718T045954503Z-4fcc707a4c8a`：Playwright 80 passed / 4 项硬件条件 skipped / 0 failed；requirements 59/59；operations 56/56；71 条 evidence record；0 invalid；0 validation error。`latest-full.json` SHA-256 为 `ed93176d505d7e9a418bb0573d20a93a8c9ad6aeebec0c8bed7bcd0947068531`。
- 随后聚焦 topology acceptance 通过；latest-full manifest hash 未改变，`npm run acceptance:evidence` 仍 exit 0；不可变 full namespace 中 71 个 record 文件和 71 个被引用 artifact 均保持存在。
- in-app browser 使用 disposable API `http://127.0.0.1:50645` 与前端 `http://127.0.0.1:5174/parameters` 验收。先通过可见 typed-edit UI 创建 Aurora candidate `185c2846-78da-4c18-9ec8-be851f317858`，再通过项目控件切换到 Nebula；页面加载 revision `8e211c47-4e0a-45e4-bffa-6d01350f2376`，提交面板被清除，且没有出现错误的“无语义修订”状态。1440×900、768×1024、390×844 三个视口均完成 snapshot/screenshot，console error 为 0，document-level 无横向溢出。验收结束后 disposable runtime 已停止且端口已释放。
- 标准外层 acceptance 门禁继续受外部 `deviceGateway`、`xiaozeLlm`、`backups` readiness 阻断。TD-042 仍为 BLOCKER，因为干净非客户快照 apply→cutover→整库 restore 演练尚未执行；不宣称 production ready、cutover ready 或可合并。

## 父智能体 Review 后续检查点 3（2026-07-18）

父智能体继续 `Request changes`，包含两个 P1 和三个 P2。根因核对确认：cutover 后 service dispatch 仍接受 legacy item/save；精确提交读取 draft 时未加行锁，也未比较 candidate binding revision 的值；项目 A 的未完成草稿响应可以回灌项目 B；一个新增 assignee 断言与 effect 存在竞态；0059 会让升级前 semantic draft 缺少 candidate identity。

实现与 TDD 顺序：

1. 先增加 cutover 后 legacy save/submit 拒绝、candidate value mismatch 的 PG/HTTP RED 测试；semantic mode 仅接受显式 binding-draft 合同，并比较 candidate binding revision 与锁定 draft 的值。
2. 增加双连接真实 PostgreSQL 并发测试，先证明未加锁读取会与编辑竞态，再使用 `FOR UPDATE OF d` 锁定 `parameter_drafts d`，证明新编辑不会被静默删除。
3. 增加 deferred Promise 跨项目组件测试；仅在捕获的项目世代仍为当前项目时接收响应，并把 pending draft 与 assignee 加载绑定到其所属项目。
4. 将 assignee effect 的即时断言改为 `waitFor`，连续执行标准 `test:all`。
5. 不修改已部署 0059，新增前向 migration 0060。对无法证明精确 candidate chain 的旧 semantic draft fail-closed 失效，记录确定性迁移 evidence，增加升级/幂等/回滚 PG 测试，并在中英文 runbook 明确要求重建。

文档门禁：更新本计划、API/domain/testing/frontend 行为和中英文 identity cutover runbook。TD-042 与外部 readiness 继续保留为 blocker。

### 后续执行结果 3

- `7e571f7c` 关闭 cutover 后遗留绕过：semantic mode 对遗留草稿保存和仅含 parameterId 的提交返回 `409`；精确提交会锁定用户所属 draft，并在创建轮次前证明 candidate binding revision raw value 与 draft target 完全一致。
- 同一提交增加确定性的双连接 PostgreSQL 回归。并发 typed edit 会等待 draft 行锁；submission 消费旧 draft 并提交后，编辑事务重建较新的 draft，因此新 value/reason 不会作为丢更新被删除。
- `713133b6` 将 pending draft 与所属项目绑定，并拒绝项目切换后迟到的 create-draft 响应。Deferred-response 组件回归证明 Aurora 响应不能回灌 Nebula 面板或加载 Nebula 候选人；load effect 的断言已使用 `waitFor`。
- `0fc167e6` 新增前向 migration `0060_parameter_draft_candidate_identity_gate.sql`。它不会为 0059 前数据猜测 candidate：缺少 candidate identity 的 manual draft 会在不记录 value/reason 的情况下写入 `parameter_draft_identity_invalidations`，随后从活动 draft 表删除，并要求用户通过 typed editor 重建。PostgreSQL 升级测试覆盖 0059 状态、注入失败回滚、报告计数与幂等。
- 精确身份/并发 PG 流程、0060 schema 升级、HTTP routes 和项目工作区组件的聚焦验证已通过（最终聚焦运行服务端 44 项、组件 10 项）。标准 `npm run test:all` 最终连续三次通过；每次均为前端 2,190 passed / 5 skipped、服务端 1,540 passed / 1 skipped。
- 浏览器验收使用 disposable API `http://127.0.0.1:52857` 与前端 `http://127.0.0.1:5174/parameters`。通过可见项目控件从 Aurora 切换到 Nebula；Nebula 加载自身 current revision `a491efaf-648b-4652-830d-49c79a27e5d2`，未显示错误空状态，也未保留 pending draft。`playwright-cli` 在 1440×900、768×1024、390×844 完成 snapshot/screenshot，console error 为 0，无 document-level 横向溢出，Nebula current/source/binding/mapping 请求均返回 200。验收后 disposable 数据库已销毁，两个端口已释放。
- 标准 full run 使用干净 source `186c3f73ff5629931fd7a0b32ec9969fc2011fea` 连接用户自有 `8787` runtime，并准确失败：preflight 受 `deviceGateway`、`xiaozeLlm`、`backups` 阻断；该 runtime 的 HDC/development-auth 状态产生 69 passed / 11 failed / 4 skipped，operation coverage 为 49/56。失败 evidence 由 `0d639e40` 保留，且未替换 `latest-full`。
- 另一次从干净 source `0d639e40ba5e4004c7602ad389e4b07cc354317a` 运行，使用隔离端口 5174/18787、production HMAC、simulator 与 deterministic Xiaoze，未触碰 8787。Playwright 共 84 项：80 passed / 4 项硬件条件 skipped / 0 failed；workflow A–E、G–I 通过；requirements 59/59；operation evidence 56/56、71 records、0 invalid、0 validation error。`npm run acceptance:evidence` 通过，`latest-full.json` SHA-256 更新为 `a8ecd8a150c0f8d2beff029a368d9b85a3f5612d6426071b01e7cec52198e1d0`。该次外层 runner 仅因显式跳过 preflight 保持 failed，不能覆盖真实外部 preflight blocker。TD-042 继续为 BLOCKER，且不宣称 production ready、cutover ready 或可合并。

## 父智能体 Review 后续检查点 4（2026-07-18）

父智能体继续 `Request changes`，包含两个 P1 和一个 P2。实现前的代码/数据流核查确认三项均成立：

- 0060 的 evidence insert 和 delete 都用 `origin = 'manual'` 过滤；缺少 candidate 的 `file_sync` 草稿会在 cutover 后继续存在，但此时 file sync 会跳过且 legacy submission 已被拒绝。
- Typed draft 端点可以创建有效 delete candidate（`rawText = ''` 和 `/delete-property/`），但精确提交 schema 拒绝空 target；工作流表均未保存 action；candidate proof 只接受存在且值匹配的 binding revision；semantic writeback 默认执行 `set`。
- `docs/generated/db-schema.md` 是人工摘要（TD-004），仓库没有 `db:schema:docs` 命令；其中 `parameter_drafts` 小节遗漏 0053/0059/0060 状态。

实现与 TDD 顺序：

1. 新增真实 PostgreSQL RED 升级测试：迁移到 0060 后插入缺少 candidate 的 manual 与 `file_sync` 行（含 resolved-file conflict 血缘），先证明非 manual 行残留。新增前向 0061，不区分 origin 地记录并删除所有 candidate-less draft；验证注入失败回滚与幂等重跑。
2. 新增 binding submission item `{ action: 'delete', targetValue: '' }` 的 schema/HTTP/PG RED。新增 0062，为 `parameter_drafts`、`parameter_submission_items`、`parameter_change_requests` 增加受 check 约束的 `action` 字段；既有行默认 `set`，精确 binding 提交必须携带持久化 action。
3. 使用同一条精确 evidence chain 证明 delete candidate：candidate revision 属于 draft 的组织/项目/config set，不存在该 binding 的 binding revision，且候选 revision 对 binding 的 logical node + property spec 存在 `delete` occurrence effect。缺失、混合或矛盾 tombstone 必须拒绝。
4. 将持久化 action 传入 locked semantic writeback。`delete` 生成 `/delete-property/`，执行 fail-closed re-ingest/validate，并且有意不产生新 binding revision。Submit/merge/writeback audit metadata 记录 action，workflow DTO 对外暴露 action。
5. 扩展 disposable topology acceptance，以第二个真实请求完成属性删除的 submit → Hardware Committer → Software Committer → Software User merge。断言 base revision/binding 不变、`writeback.skipped=false`、candidate 中属性与 binding 均不存在、reload 后仍保持删除，并且完整 writeback+validate 前无成功 audit。
6. 从迁移人工重推导数据库摘要，更新中英文 domain/API/testing/cutover 文档，执行完整门禁，然后重新生成干净 source evidence。外部 readiness 与 TD-042 继续为 blocker。

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 改哈希破坏 createSpec 幂等 | 先按 org+property 查找既有规格；碰撞审计只报告；不静默改 ID |
| 0058 清除过多作用域 | 仅保留 join 可证明链路；其余 needs_review + 诊断 |
| test:all 隔离拖慢 CI | 优先唯一命名空间 + migration 文件串行，避免全局单 worker |

## Git 与 PR 工作流

- 从本地 `main` 建实现分支，`--no-ff` 合并 Round5（`a2669639`）。
- 实现智能体：仅在特性分支提交；**不得** push、开 PR 或合并 `main`。
- 父智能体：Review、开 PR、合并并同步 `main`。

## 明确不宣称

- 不执行生产 cutover；不使用客户库/快照。
- 非 production ready；非 cutover ready；未经父智能体 Review 不可合并。
- `deviceGateway` / `backups` 等外部阻断如实报告。
- 若无已设计的 platform 治理入口，对 global 规格激活 fail-closed。
