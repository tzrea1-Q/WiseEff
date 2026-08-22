# 节点式调试平台——历史实施计划

> English: [English](../../../exec-plans/completed/2026-07-01-wiseeff-node-only-debugging-platform.md)
>
> 历史状态：**已实施，部分章节已被取代，现已归档**——节点目录 pivot 经 `8e9656ff` 落地；后续 DTS reload 工作取代了“删除所有参数调试表面”的绝对表述。当前节点式调试目录仍是事实。
>
> 余量归属：历史调试表仍归 TD-033，HDC 真机证据仍归 TD-100。英文历史计划中的未勾选项不构成当前任务。

## 已实施范围

- 运行时与调试后台以 `debug_nodes` 节点目录为主，不恢复旧参数目录作为实时产品模型。
- `/node-debugging`、节点 CRUD、模块治理、节点 binding 与对应服务端/前端合同已经落地。
- 历史 `debugging_parameters` 数据只保留迁移、审计和兼容解释；不得由本计划归档推导为已删除。

## 已被取代的章节

原计划把“隐藏 `/debugging` 并删除所有参数调试表面”写成完整方向。后续 DTS reload 恢复了独立的参数调试能力，因此该绝对表述不再是当前产品合同。当前行为应以源码、生成合同、`ARCHITECTURE.md`、`docs/FRONTEND.md`、调试/DTS reload 设计文档和 tracker 为准。

## 历史解释

英文 companion 保留当时的完整实施步骤和未勾选框，供追溯设计过程使用。它们不是当前 backlog；真实余量必须由 Open TD 或 active plan 承接。
