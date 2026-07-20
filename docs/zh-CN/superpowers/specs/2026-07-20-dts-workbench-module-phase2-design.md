# DTS 参数工作台模块化 — 阶段二设计摘要（中文）

> 英文完整版：[English](../../../superpowers/specs/2026-07-20-dts-workbench-module-phase2-design.md)  
> 阶段一摘要：[阶段一](./2026-07-20-dts-workbench-module-refocus-design.md)

## 问题

阶段一只把模块做成展示层派生；binding 身份仍不含模块；详情历史/跨项目对比仍是占位。

## 决策（已批准）

- **干净切换、无兼容层**：不双写、不以前端派生为主路径、不以 legacy `parameter_history_entries` 填详情。
- **分段干净切片**：物化 `module_id` → 切唯一键并重种子 → 身份规则生效 → 历史 API → 跨项目对比。
- **唯一键**：`(project_id, logical_node_id, parameter_spec_id, module_id)`。
- **数据**：改迁移 + 重写/重跑种子；本地库可重置。
- **历史**：仅 topology binding 修订链；**对比**：同 org 按 `parameter_spec_id` + `module_id`。

## 切片要点

1. binding 增加 `module_id NOT NULL`；ingest/种子写入；未映射用确定性「未分类」模块，禁止 null。  
2. 映射变更提供显式重算 binding.module_id。  
3. 详情接真实 history API。  
4. 详情接真实跨项目 compare API。

## 非目标

- 不做长期双读/双写兼容。  
- 不恢复 `recommendedValue` / 扁平 Excel。
