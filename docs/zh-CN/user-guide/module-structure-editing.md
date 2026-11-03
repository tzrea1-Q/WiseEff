# 编辑模块结构包

当前导入支持在来源组织更新已有模块的名称、描述、范围、排序和重要性，以及根主体的登记生命周期、归属和展示别名。移动已停用登记不会启用它。新增模块、移动模块、删除、识别设置变更及跨组织复制尚不支持，出现时会拒绝整批导入。下文的完整格式示例也包含计划中的操作。

请保留原始导出作为备份。将 JSON 作为数据编辑，不要执行其中的文本；导入仍须由人在 WiseEff 中审阅并确认。包包含组织分类和主体设置，不包含项目值、绑定、源文件、凭据、权限或审计历史。

## 身份与引用

保留 `format`、`version`、来源信息、`exportId`、已有 `sourceId`、主体 ID 和 Catalog 归属事实。导出 ID 不授予读取其他组织基准的权限。每个模块有唯一的包内 `ref`；`parentRef` 和模块归属引用此值，而非名称或数据库路径。改名或移动时保留原有 ref。新增模块时提供新的唯一 ref，省略 `sourceId`，并填写全部必填模块字段。新父模块和子模块可以在同一个包中出现。

例如，已有模块改名时保留身份，新子模块通过 ref 引用它：

```json
[
  { "ref": "power", "sourceId": "pmod_example", "operation": "upsert", "name": "电源系统", "parentRef": null },
  { "ref": "battery", "operation": "upsert", "name": "电池", "parentRef": "power", "description": "", "scope": "", "sortOrder": 0, "importance": "medium" }
]
```

这只是片段，不是完整包。不要修改模块的 `reference` 事实、保留的未分类根、Catalog 归属、所属子主体的生命周期事实，以及遗留技术和归档引用；它们是说明来源结构的只读信息。`kind: "reference"` 的归属描述已有遗留引用，不是需要重建的目标。

模块的 `name`、`parentRef`、`description`、`scope`、`sortOrder` 和 `importance` 可编辑。使用空字符串清空描述或范围，根模块的 `parentRef` 使用 null，`sortOrder` 使用整数，重要性使用 `high`、`medium` 或 `low`。新增模块须提供这六个字段、`ref` 和 `operation: "upsert"`；`sourceId` 和只读 `reference` 之后由 WiseEff 产生。

根主体的归属可填写 `{ "kind": "module", "moduleRef": "power" }`、`{ "kind": "unclassified" }` 或 `{ "kind": "unset" }`；将 `displayAlias` 设为 null 可清空别名。导出的 `state` 为 `active` 或 `retired`。驱动和节点类型的识别 `mode` 为 `inherit` 或 `override`；`override` 包含 `compatibles`、`nodeTypeName`、`driverNature` 和 `instanceCardinality`，不适用的字段保持导出值。`effective` 保持不变；配置规范的识别设置为 null。Catalog ID、`kind`、`ownerSubjectId` 和子主体的 `cascadeRetired` 为只读。

## 修改

- 修改模块的名称、描述、范围、排序、重要性或 `parentRef`，可编辑或移动模块。移动父模块会带动子树。父引用必须有效，最终树不能成环，同一父模块下名称不能重复。
- 删除已有条目或省略可编辑字段不会删除或清空数据。使用 `operation: "delete"` 请求删除；每个子模块都须显式移动或删除，受影响的根主体（包括已停用登记）须明确选择归属处置。删除分类不会删除主体登记、参数或历史。
- 添加 `{ "subjectId": "catalog-id", "operation": "register", "placement": { "kind": "module", "moduleRef": "power" } }`，可将符合条件的 Catalog 根主体登记到已有业务模块。对已有根主体添加 `"operation": "retire"` 或 `"operation": "restore"`，保留导出的状态字段。省略主体不会停用登记。所属子主体不是独立的生命周期或归属操作；保留导出的状态与级联停用事实，以维持后续恢复语义。
- 根主体归属可指向业务模块 ref、保留的未分类，或明确设为未设置。未设置和未分类含义不同；不能将归档或技术模块作为目标。
- 使用字段规定的清空值编辑或明确清空根主体显示别名；省略字段则保持原值。别名不改变 Catalog 身份。
- 保留识别模式。继承使用 Catalog 默认值且 `override` 为 null；显式覆盖的可编辑值位于 `override`。`effective` 是只读有效值，不要为了保留继承而把它写成覆盖。需要恢复继承时，将模式设为 `inherit`，并将 `override` 设为 null。审阅冲突时，识别数组作为一个值处理。

以对应版本导出包中的字段形状和清空值为准，保持只读值不变。智能体编辑文件时应保留身份及无关条目，只执行要求的修改，并向人工审阅者说明修改内容。

## 审阅和导入

更新会比较文件、服务端保留的基准和组织当前状态。独立修改可以保留，冲突修改需要选择。复制的目标是同一部署内的另一个组织；路径匹配仅供建议，不代表已授权复用。来源删除标记不会删除目标模块。缺少基准时不能用编辑后文件中的值替代。确认前请审阅全部操作、冲突、受影响主体和项目影响；预览后目标发生变化时，需要重新预览。

服务端会显示支持的包大小和数量。超限包会被拒绝，不会截断或分批应用。
