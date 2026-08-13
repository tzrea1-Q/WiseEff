# HCI 交互信任修复（Wave 0–1）

> 状态：**已完成 —— 2026-08-13 经 PR #331 合入 `main`（Wave 1 以 PR #369 先行 squash 进同一分支）**
> 日期：2026-08-12（实施完成于 2026-08-13）
> English: [`docs/exec-plans/completed/2026-08-12-hci-interaction-trust-repair.md`](../../../exec-plans/completed/2026-08-12-hci-interaction-trust-repair.md)

## 背景

2026-08-12 的全面 HCI 审计（7 个并行静态审查智能体 + API 模式 15 条路由的真实浏览器走查，证据在 `work/ui-checks/hci-audit/`）发现约 130 个去重问题（P0 10+、P1 约 60）。本计划与前端美学提升计划互补：对方负责视觉执行质量，本计划负责**行为信任**——反馈可见性、数据诚实、破坏性操作保护、小泽审批门。

## 交付内容

- **Wave 0（止血）**：全局 toast 层双运行时可见（关闭按钮标签为「关闭提示」）；审批卡层级加固；回滚 reducer 修复（API 模式回滚安全网重新生效）；置信度 DTO 归一化（0–1 → 百分比）；auth 探测按 401/403 与网络/5xx 分流（后者保 token + 重试屏）；CopilotKit 调试横幅收敛到环境开关。
- **Wave 1（信任修复）**：草稿托盘与服务端同步（移除即删、提交后清空重载、所见即所提语义）；API 模式绝不回退 mock 业务数据（空切片启动 + 失败清域 + 常驻横幅重试）；基线/定义/模块失败投影进所属对话框；数据诚实清理（假趋势线删除、看板结论按真实失败/滞留计数、/logs 反馈真实落库、无消费者的前端工具移除）；破坏性操作确认矩阵 + 脏状态守卫；审批卡知情同意（AI 理由渲染、按钮中文化、可选拒绝理由回传）。

## 合并史（供未来考古）

评审期间 `main` 前进约 240 个提交（App 壳拆分、组合根重构、美学计划的对话框/Toast/DataTable 波次全部在途落地），共做四轮同步合并。冲突解决策略为「**main 的结构 + 本计划的行为**」：

- reducer 修复重放到 `src/application/state/appState.ts`；/logs 修复重放到 `src/features/log-analysis/`。
- 用户权限页的治理确认流重接到 main 的 `DataTable` 列；向导脏关闭守卫重接到 main 的 `ModalDialog`（`onDismiss → requestClose`），删除重复的 window Escape 监听。
- `ModalDialog` 的 Escape 竞态防护由时间戳改为**事件身份**（jsdom 的 timeStamp 是 epoch 而 `performance.now()` 是页面相对时间，旧防护会让同一次按键关掉它刚打开的确认层）。
- z 阶梯收敛为单一 `--z-toast: 1350` 与单一审批 token `--z-xiaoze-approval`。
- checking 态统一为 main 的 `AppShellSkeleton`（wave-0 的恢复会话屏成为死代码删除；`unreachable` 重试屏保留）。
- 删除 main 在 LogsPage 的 mock-only 通知桥（`AppToastLayer` 已双运行时覆盖）。
- 并行工作流撞号的迁移 `0105` 重命名为 `0106_log_domains.sql`（幂等文件），为所有分支解锁 CI。

## 跨工作流发现

- **Issue #333**（agent SSE 缺 `TEXT_MESSAGE_END` 导致审批卡不渲染）：main 侧审批链工作流已独立修复，并确认了 GOV-01 的层叠诊断（「scrim 吞掉每次点击」）。合并后的审批流端到端验证已登记到债务追踪。
- 视觉基线：全局 toast 是时序元素，截图前用 `settleAppToasts()` 确定性清空；linux `/parameter-admin` 基线因 main 种子漂移（195 → 193 条定义）用 CI 环境重拍。
- 浏览器验收：角色调整/关闭反馈补确认步骤；toast 关闭按钮更名「关闭提示」避免与通知铃撞名；拓扑验收不再钉死过期 binding id。

## 文档影响矩阵——结清

PLANS.md 已更新；FRONTEND.md（中英）已在功能 PR 内更新；product-specs / ui-design-system / SECURITY / RELIABILITY 审阅后无需变更（结论见英文版矩阵）；testing-strategy 与验收覆盖图的新增 requirement id 延期登记为债务；`db-schema.md` 随迁移重命名再生成。

## 延期范围 → `tech-debt-tracker.md`

Wave 2–3（语言与术语清洗含 AI 中文输出、审计中心产品化、评审批量、macOS 快捷键、深链、a11y 系统化、响应式收敛）与合并产生的事项（通知双轨收敛、审批 z 规则去重、jsdom Escape 守卫测试 skip、审批流端到端验证、HDC 真机手工验证）均已登记。

## 验证证据

- 合并时 `npm test` 2537 通过、1 skip（jsdom 特异用例，文件内有说明）；`npm run build`、`npm run docs:check` 绿。
- CI：合并提交 Build and test 绿；遗留浏览器验收失败与 `main` 自身 CI 完全同集合（属并行工作流，另行跟踪）。
