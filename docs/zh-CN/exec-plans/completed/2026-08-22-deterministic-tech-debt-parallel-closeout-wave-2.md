# 确定性技术债并行收口——第二批

> 状态：**已于 2026-08-22 完成**
> 日期：2026-08-22
> 计划分支：`docs/deterministic-tech-debt-parallel-closeout-wave2-plan`
> 收口分支：`docs/deterministic-td-parallel-closeout-wave2`
> 实现 PR：#580（TD-109）、#582（TD-018）、#583（TD-077）、#585（TD-114）
> English: [English](../../../exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-2.md)
> 追踪表：[技术债追踪表](../tech-debt-tracker.md)

## 目标

关闭四条不需要硬件、目标环境证据、专家标注数据、KMS、真实投递量或未决产品决策的独立技术债：

- **TD-018**：在现有合同接缝补齐 Xiaoze suggest 请求/响应及 AG-UI CUSTOM frame 校验。
- **TD-077**：退役最后的 raw CSS/源码样式测试，以结构化 CSS 断言和零存量 lint 规则形成长期合同。
- **TD-109**：删除服务端/mock adapter 新出现的 DTS reload promotion eligibility 重复状态机。
- **TD-114**：把本就整行显示的 action panel 改成单列，删除所有 review 页 `full` 布局钩子。

每条只有在独立实现 PR、聚焦/全量门禁、两轴复审和共享 tracker/归档收口都合入后才算关闭。

## 审计结论与锁定决策

- 规划时 `origin/main` 为 `3da2212a`。
- TD-018 是窄合同切片；其它手写客户端与 endpoint schema 仍由 TD-003、TD-012 保持 Open。
- `@wiseeff/xiaoze-protocol` 继续保持无依赖。Zod schema 放在服务端 DTO 合同层，校验真实产出的 frame，不包裹或替换 `@ag-ui/client` 流解析。
- TD-077 原 17 文件 CSS 文本迁移已由 `8be6f459` 落地。本轨只处理集中残余与零存量 lint 规则；不会因为其它架构测试使用 `readFileSync` 就一并重写。
- TD-109 只共享 eligibility 决策与稳定 reason/details。服务端和 mock adapter 保留各自文案与存储细节；`src/` 不得导入 `server/`。
- TD-114 不新增 Button variant 或布局 prop。当前双列面板内每个动作都跨两列，因此改成单列行为等价，且可删除本地钩子。

## 非目标

- TD-072 queue fake、TD-075 注册表统一或 TD-076 验收夹具收口。
- TD-062 工作台壳 stretch、TD-110 API 用户目录设计、TD-112 表格范围澄清或 TD-113 存量烧减。
- 修改 Xiaoze 产品行为、suggest 排序或 AG-UI 协议包依赖模型。
- 修改 DTS reload promotion 策略或用户可见错误文案。
- 重设计审阅/提交动作、流程权限或主动作层级。

## Git 与 PR 工作流

本计划合入后，四条实现轨道从刷新后的 `main` 建隔离 worktree。实现子智能体只提交本轨代码/测试/文档，不开、不合 PR；父流程负责 rebase、验证、评审、开 PR、合入，最后统一更新 tracker/计划。

| 轨道 | 分支 | 归属文件 | 明确排除 |
| --- | --- | --- | --- |
| TD-018 | `fix/td-018-xiaoze-contracts` | agent DTO schema/registry、suggest route/hook、真实 frame 合同测试、直接相关 API 文档 | 不改 tracker/计划；不给协议包加依赖；不包流解析器 |
| TD-077 | `test/td-077-style-contracts` | 样式测试残余、`cssAssertions`、ESLint 规则/配置/测试、直接相关质量证据 | 不改生产 CSS/组件；不改 tracker/计划；不清理无关源码测试 |
| TD-109 | `refactor/td-109-promotion-guard` | 共享 DTS reload promotion guard、服务端/mock adapter 与聚焦测试 | 不改可见文案；不改 tracker/计划；`src/` 不导入 server |
| TD-114 | `fix/td-114-action-panel-layout` | review/submission 页面、范围内 action-panel CSS 与聚焦测试 | 不改 Button 接口/variant；不改流程行为；不改 tracker/计划 |
| 共享收口 | `docs/deterministic-td-parallel-closeout-wave2` | 中英 tracker、本计划、PLANS 索引、失真的当前状态引用 | 不改实现 |

每条合入前 fetch `origin/main`、rebase，执行 `npx tsc -b` 与受影响测试，并复核共享 TD/计划状态。先合非可见轨道，TD-114 后合，共享文档最后合。

## 已确认的 TDD 接缝

写测试前锁定以下公开接缝：

1. **TD-018 合同接缝**：suggest route 请求校验、`useXiaozeSuggestions` 响应解析/失败关闭，以及对 `xiaozeTurnStream` 真实产出 CUSTOM frame 的 schema 校验。
2. **TD-077 样式测试接缝**：ESLint 规则拒绝直接 raw CSS 文本断言；视觉 declaration 通过 `cssAssertions` 查询；既有 Playwright quality/acceptance 承接 computed-style 与交互覆盖。
3. **TD-109 领域接缝**：共享 promotion eligibility 结果区分允许与稳定拒绝 reason/details；服务端和 mock adapter 独立映射结果。
4. **TD-114 布局接缝**：渲染后的 review/submission 动作不带 `full` 钩子，结构化 CSS 合同显示 `.action-panel` 为单列，同时动作顺序和 variant 不变。

每条轨道按纵向红→绿切片推进。禁止真实 sleep、私有方法测试、SQL/源码格式断言和推测性重构。

## 任务

### 轨道 A——TD-018

1. 为无效 suggest 输入/输出和所有真实 CUSTOM frame 家族写红色表驱动测试。
2. 在服务端 contract 模块增加保持协议包无依赖的 Zod schema，并把 suggest OpenAPI metadata 绑到具体 schema。
3. 校验服务端请求与前端响应；保持 hook 诚实降级为空列表，并通过既有接缝报告 contract drift。
4. 跑前后端/contract 聚焦测试、`contract:check`、typecheck、build、docs。

### 轨道 B——TD-077

1. 为直接读取 CSS 后用 raw `toMatch`/`toContain` 的模式增加会失败的 lint fixture。
2. 把 `DtsParameterWorkbench`、Xiaoze approval、退役首页以及真正属于样式的源码约定迁到结构化 CSS 或渲染 DOM/primitive 合同。
3. 无关架构源码测试保持范围外；证明格式/顺序调整不会破坏结构化断言。
4. 跑聚焦测试、前端全量、lint、UI standards、既有 `/parameters` quality 与 Xiaoze approval 覆盖。

### 轨道 C——TD-109

1. 为 verified、restore-baseline、unverifiable acknowledgement 与其它状态写红色表驱动测试。
2. 实现共享 eligibility 结果，并由服务端/mock adapter 消费，不共享展示文案。
3. DB/store 细节保留在 adapter 内，补 parity/敏感性测试。
4. 跑服务端/mock/domain 聚焦测试、按比例跑前后端全量、typecheck、build。

### 轨道 D——TD-114

1. 为无钩子动作与单列 CSS 写红 DOM/结构化 CSS 测试。
2. 删除 6 个 `full` class、`.action-panel .full` 与死 `.button.full`，保留动作顺序/variant。
3. 跑前端聚焦/全量与相关参数审阅/驳回验收。
4. API 模式下用 `playwright-cli` 对 `/parameter-review`、`/parameter-submissions` 在 1440×900、768×1024、390×844 执行 snapshot、screenshot、交互、console、network 检查。

### 共享收口

1. 四个实现 PR 都合入后，在中英 tracker 把 TD-018、TD-077、TD-109、TD-114 从 Open 移到 Completed，并记录精确证据。
2. 只更新旧 active 计划中失真的当前状态引用，保留历史 partial 事实。
3. 把本计划中英文件从 `active/` 移到 `completed/`，并更新两份 PLANS 索引。
4. 从刷新后的 `main` 运行文档、contract、UI、build、lint、前后端全量和 diff 组合门禁。

## 成功标准

- 四个可独立评审的实现 PR 合入，无跨轨代码冲突。
- TD-018 对 suggest 与全部真实 CUSTOM frame 家族做具体校验，TD-003/012 继续 Open。
- TD-077 范围内不存在 raw CSS/源码样式断言，并有零存量 lint 规则防止回归。
- TD-109 只有一套共享 promotion eligibility 状态机，adapter 文案不变，mock/server parity 有证明。
- TD-114 不再有 review/submission `full` 钩子或匹配 CSS，并通过双路由三视口浏览器 QA。
- 每个实现与共享收口 diff 的最终 Standards/Spec 复审均为 0 个遗留问题。
- 中英 tracker 都把四条移到 Completed，本计划只存在于 `completed/`。

## 验证

```bash
npx tsc -b
npm test
npm run test:server
npm run build
npm run lint
npm run ui:check
npm run docs:check
npm run contract:check
git diff --check
```

每条轨道的专用命令、红绿证据与浏览器产物路径记录在实现 PR 和最终 tracker 条目。

## 收口证据

- **TD-109——#580（`8d8f06bd`）：** domain/mock 23/23、服务端 promotion 9/9 通过。实现阶段全量为前端 402 files / 3001 tests、服务端 346 files / 2682 tests，另有 2 files / 8 tests 按既有条件跳过。仓库 CI 为前端 402/3001、服务端 347 files / 2686 tests，另有 1 file / 4 tests 跳过。
- **TD-018——#582（`693a4da8`）：** 聚焦前端 12/12、服务端/CUSTOM 44/44 通过。实现阶段全量为前端 401 files / 2991 tests、服务端 348 files / 2698 tests，另有 2 files / 8 tests 跳过。仓库 CI 为前端 403/3005、服务端 349 files / 2711 tests，另有 1 file / 4 tests 跳过。
- **TD-077——#583（`c3937904`）：** 仓库 CI 为前端 404 files / 3005 tests、服务端 349 files / 2711 tests，另有 1 file / 4 tests 跳过；脚本覆盖 500 tests 通过，保留 5 个既有 skip。最后七个残余已改用结构化/渲染/primitive 合同，error 级回归规则的 6/6 聚焦用例通过。
- **TD-114——#585（`bf3739a2`）：** 本地聚焦 4 files / 148 tests、实现阶段前端全量 402 files / 2993 tests、参数验收 3/3 通过。仓库 CI 为前端 405/3010、服务端 349 files / 2711 tests，另有 1 file / 4 tests 跳过；Acceptance quality 97 tests、Acceptance smoke 4 tests 通过。API 模式在 `/parameter-review`、`/parameter-submissions` 的 1440×900、768×1024、390×844 完成 snapshot、screenshot 与 reject/approve/withdraw 交互，请求均 HTTP 200，overflow 和 console error 均为 0。走查发现并修复移动端规则顺序、history-card specificity 与 merge-link 隐式网格轨道；剩余 warning 只有本地 CopilotKit license 提示。
- 四个 PR 的仓库 Detect、Build and test、Acceptance quality、Acceptance smoke、Merge bar 门禁全部通过；四条实现的最终独立 Standards / Spec 复审均为 0 个问题。
- 本次共享收口只更新中英 tracker、计划、索引和失真的当前状态引用。仓库地图、产品规格、runbook、安全规则、设计系统规则与 ADR-0031 均已复核且无需修改；#582 已包含必要的 API/OpenAPI 产物，#583 已包含质量规则。
- 本次关闭只提供本地与仓库 CI 实现证据。按路径过滤的 local non-HDC 与 target-synthetic job 已跳过；本批次**不声明** HDC/设备实验室、目标环境、target synthetic 或真实模型/provider 证据。

## 文档影响矩阵

| 区域 | 状态 | 文件/证据 |
| --- | --- | --- |
| 仓库地图 | No change | 已复核 `AGENTS.md`、`docs/zh-CN/root/AGENTS.md`、`ARCHITECTURE.md`、`docs/zh-CN/root/ARCHITECTURE.md`、`docs/README.md`、`docs/zh-CN/README.md`；导航仍准确。 |
| 计划 | Update | 已归档 `docs/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-2.md`、`docs/zh-CN/exec-plans/completed/2026-08-22-deterministic-tech-debt-parallel-closeout-wave-2.md`；已更新 `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、`docs/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`、`docs/zh-CN/exec-plans/active/2026-08-17-launch-actionable-tech-debt-closeout.md`。 |
| 技术债 | Update | 已更新 `docs/exec-plans/tech-debt-tracker.md`、`docs/zh-CN/exec-plans/tech-debt-tracker.md`：TD-018/077/109/114 移入关闭项，TD-003/012 与 TD-072/075/076 保持 Open。 |
| 产品规格 | No change | 已复核 `docs/product-specs/index.md`、`docs/product-specs/product-spec.md`、`docs/zh-CN/product-specs/index.md`、`docs/zh-CN/product-specs/product-spec.md`；没有工作流或产品决策变化。 |
| 架构/领域 | Update | #580、#582 已更新 `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`；共享收口复核这些长期前端/领域边界后无需追加修改。 |
| 质量/测试 | Update | #583 已更新 `docs/design-docs/testing-strategy.md`、`docs/zh-CN/design-docs/testing-strategy.md`，记录 error 级 lint/结构化样式测试合同；tracker 同步记录收口证据。 |
| 可靠性/runbook | No change | 已复核 `docs/RELIABILITY.md`、`docs/zh-CN/RELIABILITY.md`、`docs/runbooks/README.md`、`docs/zh-CN/runbooks/README.md`；没有运行时/运维流程或 readiness 声明变化。 |
| 安全/治理 | Review | 已复核且不修改 `docs/SECURITY.md`、`docs/zh-CN/SECURITY.md`、`docs/security/README.md`、`docs/zh-CN/security/README.md`；畸形合同失败关闭，不改 authz、secret、audit 或设备写入。 |
| 前端/设计 | Review | 已复核且不修改 `docs/design-docs/ui-design-system.md`、`docs/zh-CN/design-docs/ui-design-system.md`；#585 是由既有设计规则和浏览器证据覆盖的行为等价布局清理。 |
| API/生成物 | Update | #582 已更新 `docs/api/README.md`、`docs/zh-CN/api/README.md`、`docs/design-docs/api-contract.md`、`docs/zh-CN/design-docs/api-contract.md`、`docs/generated/openapi.json`；具体 suggest/OpenAPI contract 已在该 PR 生成并检查。 |
| references | Review | 已复核且不修改 `docs/adr/0031-xiaoze-wire-contract-is-a-shared-package.md`；协议包继续保持无依赖，无需修订 ADR。 |

## 文档更新门禁

本批次只有满足以下条件才能完成：

- 每个 Update/Review 行都已更新，或有证据记录为不变；
- 中英 tracker 与计划状态一致；
- 完成后计划文件只存在于 `completed/`；
- 共享收口分支的 `npm run docs:check` 与 `git diff --check` 通过；
- TD-114 证据记录两条路由、三个视口、交互、截图、console/network 检查以及发现/修复的问题；
- 跳过的目标环境/HDC/模型 provider 门禁保持明确不在关闭声明内。
