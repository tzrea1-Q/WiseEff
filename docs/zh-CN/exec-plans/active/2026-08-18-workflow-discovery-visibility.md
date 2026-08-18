# 工作流发现面可见性

> English: [`docs/exec-plans/active/2026-08-18-workflow-discovery-visibility.md`](../../../exec-plans/active/2026-08-18-workflow-discovery-visibility.md)

> **给实现代理：** 按任务勾选推进。优先用 Matt skills `implement` / `tdd`。遵守 `docs/PLANS.md` 的分支与 PR 流程。

- 日期：2026-08-18
- 状态：**进行中**
- 分支：`cursor/workflow-discovery-visibility-b895`
- 决策：[ADR-0036](../../../adr/0036-workflow-discovery-uses-a-visible-workflow-allowlist.md)

## 目标

用代码里的**可见工作流 allowlist** 从发现面拿掉未打磨工作流。不等于未授权、不等于路由退役、不等于关 API。

第一次名单：`parameter-management`、`debugging`。日志分析和知识库不在发现面，直达 URL 仍可用。

## 接缝

单一公开模块：`WorkflowId`、`VISIBLE_WORKFLOWS`、`isWorkflowVisible`、`isDiscoveryGroupVisible`、首页推销文案。侧栏和首页只读这一处。

## 非目标

- 不改 API / 权限
- 不藏小泽工具
- 不藏「相关知识 / 沉淀为知识」
- 不做环境变量或租户开关
- 不对隐藏工作流使用 `NoEntryPage`

细则、文档矩阵和验收 ID 以英文版为准。
