# 小泽前端体验与交互效果提升

> English: [English](../../../exec-plans/active/2026-09-14-xiaoze-frontend-experience-enhancement.md)
> Status: **执行中**
> Date: 2026-09-14. 分支: `feat/xiaoze-frontend-experience`

## 目标与背景

针对小泽（Xiaoze）智能助手的前端实现进行系统性优化，包括设计系统 Tokens 合规、暗黑模式适配、弹窗动效渲染性能（移除滤镜重绘）、代码块一键复制与语法高亮标签、流式思考面板防抖动（防 CLS）、欢迎卡片快捷 Prompt 药丸、以及业务页面到小泽的上下文联动传参。

## Git 与分支工作流

- **Scratch 特性分支**: 从 `main` 切出的 `feat/xiaoze-frontend-experience`。
- **交付边界**: 完成 5 个维度的优化，通过单元测试与全量构建，通过 Playwright 跨三视口真机验证，并通过 `npm run docs:check`。

## 工作包划分

- **XZ-01 (设计系统与暗黑模式合规)**:
  - 替换 `src/styles.css` 中的硬编码色彩为语义 Design Tokens（`--surface`, `--text`, `--accent`, `color-mix()`）。
  - 为 `.copilotKitPopup .copilotKitInput:focus-within` 增加焦点环（`var(--ring)`）。
  - 将 `XiaozeApprovalCardContent.tsx` 中草稿审批的英文动作词（`Reject` / `Approve`）规范为中文“拒绝”与“批准”。
- **XZ-02 (动效与渲染性能)**:
  - 移除 `.xiaoze-popup-window` 动画中的 `filter: blur(10px)` 与常驻 `will-change: filter`。
  - 将悬浮球光晕无限呼吸循环调整为克制的 2 次循环或悬浮态。
- **XZ-03 (AI 内容与 Streamdown 交互)**:
  - 在 `src/features/agent/xiaozeStreamdownComponents.tsx` 中增加自定义代码块组件，提供语言标签与“复制”按钮。
  - 优化 `XiaozeTurnReasoningPanel.tsx` 思考完成时的平滑收拢过渡，消除视口抖动。
  - 在 `XiaozeWelcomePanel.tsx` 中增加交互式快捷提问药丸。
- **XZ-04 (业务上下文联动)**:
  - 扩展 `dispatchXiaozeOpenHandoff` 与 `XiaozeOpenHandoffListener`，将外部点击的建议或预设填入小泽输入框并聚焦。
  - 联动 `useXiaozeSuggestions` 的“问小泽”动作。
- **XZ-05 (可用性与快捷键)**:
  - 打开小泽后光标自动聚焦到 `textarea`。
  - 增加全局 `⌘J` / `Ctrl+J` 快捷键切换小泽开关。

## 文档影响矩阵

| 领域 | 路径 | 状态 | 说明 |
| --- | --- | --- | --- |
| 架构文档 | `ARCHITECTURE.md` | 无变更 | 接口与 Agent 协议保持稳定 |
| 产品规格 | `docs/product-specs/` | 无变更 | 产品业务能力保持一致 |
| 设计文档 | `docs/design-docs/ui-design-system.md` | 审阅 | 核验小泽 Tokens 与设计系统标准一致 |
| 前端文档 | `docs/FRONTEND.md` | 审阅 | 前端小泽规范对齐 |
| 英文活跃计划 | `docs/exec-plans/active/2026-09-14-xiaoze-frontend-experience-enhancement.md` | 更新 | 英文执行计划 |
| 中文活跃计划 | `docs/zh-CN/exec-plans/active/2026-09-14-xiaoze-frontend-experience-enhancement.md` | 更新 | 本计划文件 |

## 文档更新门禁

- [x] 双语执行计划创建并建立交叉链接。
- [x] 严格遵循 UI Design System 规范与 Tokens 标准。
- [x] `npm run docs:check` 检查通过。

## 验证计划

- 单元测试: `npm test src/features/agent/`
- 构建检查: `npm run build`
- 文档检查: `npm run docs:check`
- Playwright-cli 真机验证: 桌面端 `1440x900`、平板端 `768x1024`、移动端 `390x844`。
