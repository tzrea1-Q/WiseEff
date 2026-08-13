# HCI Wave 2 —— 语言与效率

> 状态：**已完成 —— 2026-08-13 经 PR #411 合入（W2-1..W2-4 全部交付；/audit 已浏览器验证）**
> 日期：2026-08-13
> 来源：TD-097（`completed/2026-08-12-hci-interaction-trust-repair.md` 的延期范围）
> 分支：`feat/hci-wave-2-language`
> English: [`docs/exec-plans/completed/2026-08-13-hci-wave2-language-efficiency.md`](../../../exec-plans/completed/2026-08-13-hci-wave2-language-efficiency.md)

## 范围决策

对照并行工作流已交付的内容重新分诊：审计中心现已具备模块分组/项目/严重度/trace 筛选、游标分页、详情对话框与中文事件类型标签，缺口比原始发现更窄。AI 中文输出在 `server/modules/agent/**`（审批链计划的地盘），本计划不碰。

| # | 任务 | 理由 |
| --- | --- | --- |
| W2-1 | **权限拒绝页中文化**（`src/app/routes.tsx`） | 产品壳里最后一个全英文页面。 |
| W2-2 | **服务端错误用户话术接缝**：`userErrorMessage.ts` 按 `WiseEffApiError.code`（+ 已知 `details.reason`）映射中文，服务端原文做补充细节、`requestId` 作技术后缀；接入三个 runtime 的通知构造器。 | 英文服务端原文当前逐字出现在 toast 里。 |
| W2-3 | **审计搜索下推 + 时间窗**：列表 API 增加 `q` 与 `from`/`to`；工作台搜索不再只过滤已加载页，增加时间窗选择。只动读路径，不触碰 audited-write seam 迁移。 | 现在搜索只过滤已加载的 50 条，覆盖面在撒谎。 |
| W2-4 | **审计 CSV 导出**：按当前筛选分页拉全量（带上限与进度提示）导出 UTF-8-BOM CSV（中文表头）。 | 审计人员需要证据摘录，现在只能截图。 |

Wave 2 内继续延期（留在 TD-097）：评审批量（部分失败语义需产品决策）、macOS 快捷键、深链、a11y 系统化、响应式收敛。

## 验证

- 单测：话术映射表测试；审计仓储 `q`/`from`/`to` 测试；工作台下推与导出测试。
- PR 前 `npm test`、`npm run build`、`npm run docs:check`。
- 浏览器：桌面 1440 下 `/audit` 搜索 + 时间窗 + 导出；非管理员角色查看权限拒绝页。

## 文档影响矩阵

| 区域 | 文件 | 动作 |
| --- | --- | --- |
| 计划文档 | `docs/PLANS.md` | 更新 |
| API 文档 | `docs/api/examples.md`、`docs/design-docs/api-contract.md` | 更新（审计列表 `q`/`from`/`to`） |
| 前端文档 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` | 更新（错误话术接缝、审计中心能力） |
| 质量/测试 | 覆盖图 | 审阅 |
| 中文伴随 | 本计划 + frontend | 更新 |
| 其余 | — | 预期无变化，完成时复查 |

## 文档更新门——已结清

PLANS.md 已更新（功能 PR 注册 + 本收尾改为 completed 条目）；API 契约文档已记录审计列表 `q`/`from`/`to`；前端文档（中英）已记录错误话术接缝与审计中心能力；覆盖图审阅后无需登记（本波未新增验收 id）；收尾时 `npm run docs:check` 绿。
