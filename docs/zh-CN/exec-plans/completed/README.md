# 已完成执行计划

> English: [English](../../../exec-plans/completed/README.md)

completed plan 是历史实施证据，可解释系统为何形成，但不得覆盖当前源码、生成物、现行设计文档、runbook、质量文档或 tracker。

## 当前里程碑历史

英文 companion 保存完整里程碑索引。主要里程碑包括 M0 基础、M1 参数管理、M2 日志分析、M3 调试、M3.5 商业化准备、M4 Agent 协作、M5 商业试点准备、M5.1 文档治理、M5.5–M5.12 验收质量、M6.1 自托管基础，以及中英文开发者文档。

## 历史功能计划

- 2026-08-19 的 property-key source cutover 与余量计划经 #544/#549/#553/#555/#558 归档；TD-117 按接受残留关闭，余量是跨页导航。
- 2026-08-18 的 CI feedback-loop 计划经 #523–#525 归档；TD-118 继续承接共享库 browser suite 时延。
- 2026-08-17 两轮归档覆盖已落地的 path-reachable、产品反馈、topology review、DTS 工作台/seed、归属/driver registry/overlay、参数后台、批量导入、日志组织作用域、个人总览、ADB/HDC、调试后台、Device Bridge、小泽 UX 与 CORS 等计划。
- 2026-08-23 的有界计划治理清单归档了 organization administration（#560）、local evaluation auth hardening（#563）、node-only debugging 与 DTS parameter workbench 四组已知陈旧 active plan。该清单不构成 repo-wide completed-plan inventory，TD-005 因此仍须保持 Open。

## 历史状态合同

受机器清单管理的 completed plan 必须显式声明以下一种状态，并说明真实余量归属：

- **已实施并归档**：有明确合入证据；未交付范围继续由 Open TD 或 active plan 承接。
- **已实施，部分章节已被取代，现已归档**：实施结果存在，但历史计划中的部分决策或施工步骤已被后续合同取代。
- **已被取代并归档**：不得把历史未勾选框解释为当前任务；当前事实由后继计划/规范承接。

本合同目前只覆盖 `scripts/check-doc-governance.ts` 中 `managedHistoricalPlanInventory` 的有界清单。未进入清单的 completed feature plan 仍需后续 repo-wide inventory；不能据此关闭 TD-005。

## 阅读优先级

如 completed plan 与当前文档冲突，按以下顺序解释：

1. 源码与测试。
2. OpenAPI、数据库 schema 等生成物。
3. 当前 runbook、安全、可靠性、API 与架构文档。
4. 产品规格。
5. completed execution plan。

历史计划中的旧 Superpowers banner 只属于历史。当前智能体编排使用 Matt Pocock skills、`docs/agents/*` 与 `docs/PLANS.md`。
