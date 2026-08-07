# 项目配置工作台活动时间线（#239）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-activity-timeline`
> Issue：[#239](https://github.com/tzrea1-Q/WiseEff/issues/239)，父议题 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> English：[English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-activity-timeline.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md)（PCW-D11）
> 起点：`4f1c25b9c41f6b52bac06fc16488b81e6f5d5b39`

## 目标

用上下文「活动」检查器取代配置工作台源码区上方的常驻审计横幅模式。Admin 可打开项目范围内的服务器审计投影时间线，以产品用语阅读事件，并在目标仍存在时从可定位事件回到配置集、文件、候选、节点、属性、冲突或发布基线。变更即时反馈用 toast；时间线从服务器证据刷新。

## 非目标

不含 #232/#233/#236；不重建审计中心；不移除项目运营弹窗最近审计条。

## 任务与验收

接缝与英文计划一致。验收 ID：`PROJ-CONFIG-ACTIVITY-001`。证据目录：`work/ui-checks/project-configuration-workbench-activity-timeline/`。

文档影响矩阵 / 更新门禁与英文计划一致；`npm run docs:check` 通过后方可移入 `completed/`。
