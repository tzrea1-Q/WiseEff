# Agent 工具:一个工具一处声明,其余全部派生

> 状态:**已完成 2026-08-13**(单 PR 变更;计划在完成时记录)
> 日期:2026-08-13
> 分支:`refactor/agent-tool-single-definition`
> English: [`docs/exec-plans/completed/2026-08-13-agent-tool-single-definition.md`](../../../exec-plans/completed/2026-08-13-agent-tool-single-definition.md)
> 来源:2026-08-12 架构审查候选 4

## 目标

一个 Agent 工具此前要穿过 8–10 种表示:手写的 `AgentToolName` 联合、带 `run` 的注册表定义、`types.ts` 里死掉的第二个同名 `AgentToolDefinition`、`toolCatalog.ts` 三张按名字键控的旁表(中文标签、模型描述、schema——漏一行就静默降级)、规划描述符、OpenAI 定义与系统提示词条目,外加每个工具一个无人消费的英文 `label`。新增一个只读工具至少改六个文件。

现在 `server/modules/agent/toolMetadata.ts` 是唯一声明点:每个工具一条 `{ name, label(中文), kind, permission, requiresApproval, scope?, description, schema }`,其余全部机械派生。

## 变更内容

- **新建 `toolMetadata.ts`**:`AGENT_TOOL_METADATA` 表、派生的 `AgentToolName` 联合(`types.ts` 转发;手写联合删除)、字面量收窄的 `requireAgentToolMetadata`、`getXiaozeToolLabel`。
- **`tools/*`**:每个工具 spread 自己的元数据、只补 `run`——逐工具的 `label/kind/permission/requiresApproval/scope` 字面量消失。工具 `label` 全线统一为面向用户的中文标签(运行步骤、工具结果帧、审计、审批、管理 DTO),替代原先无人消费的英文变体。
- **`toolCatalog.ts`**:三张名字键控旁表删除;`buildXiaozePlanningToolDescriptors` 变为注册工具所携元数据的机械投影(不再有静默降级的回退路径)。`formatToolCatalogForSystemPrompt` / `toOpenAiToolDefinitions` 作为消费方不变。
- **`types.ts`**:死掉的第二个 `AgentToolDefinition` 删除;`AgentToolKind` 从元数据模块转发。

范围外(属审查候选 5——共享线协议契约):前端回退标签表(`xiaozeToolLabels.ts`)与在 AG-UI 帧里下发标签。

## 验证

- `npx tsc -b --force` 绿;`server/modules/agent` 套件绿(32 文件 / 179 测试);`npm run build`、`npm run docs:check` 绿。
- description/schema 逐字迁移,既有工具的模型目录、OpenAI 定义与系统提示词字节级不变。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 计划 | Update | 本计划 + 中文伴页;`docs/PLANS.md` + 中文版 |
| 其他 | No change | 线协议不变;权限不变;除工具调用存量行的标签统一为中文外无产品行为变化 |

## 文档更新门禁

- [x] `docs/PLANS.md` 中英文列出本计划
- [x] `npm run docs:check` 全绿
