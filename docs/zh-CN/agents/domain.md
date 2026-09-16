# 领域文档

> English: [Domain documentation](../../agents/domain.md)

使用仓库既有术语和已接受的决策。从受影响代码和测试开始，在 `CONTEXT.md` 中检索相关概念，不为每个任务通读整个词汇表。

`ARCHITECTURE.md` 描述系统地图；`docs/design-docs/domain-model.md` 定义实体和状态机；`docs/design-docs/full-stack-architecture.md` 说明边界。修改涉及相关决策时，再读取对应 ADR 和功能设计章节。

这些文档是互补参考，不是一组依次全文导入的必读材料。历史计划仅描述历史证据，除非当前任务明确采纳。探索或修改 WiseEff 不依赖外部领域建模技能。

方案与既有 ADR 冲突时，明确指出具体冲突，并在改变不变量前取得必要决定。普通术语问题应根据代码和文档解决，不必为可逆措辞选择升级审批。

持久决策发生变化时，优先更新最近的权威文档。保持 `CONTEXT.md` 可导航，不建立第二套架构叙述。不因为旧模板中的示例而发明新术语或重新启动已完成项目。
