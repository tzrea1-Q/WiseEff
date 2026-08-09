/** Hover descriptions for ParameterSpecDetail / ValueShapeFields. */
export const SPEC_EDITOR_FIELD_HELP = {
  propertyKey:
    "DTS 属性键，与归属主体共同构成定义身份。默认只读；仅零引用时可通过「修正属性键」纠正，并同步重写派生键。",
  attributionSubject:
    "声明的归属主体（驱动登记或节点类型）。选错时用「修正归属」纠正；不改模块树结构。",
  displayName: "列表与工作台展示用的可读名称；可留空。",
  attributionModule:
    "来自归属主体或实测绑定的模块路径，本页只读。树结构与映射请到「模块管理」调整。",
  reviewState: "定义生命周期：草稿 / 已启用 / 已废弃。废弃后仅可查看或恢复。",
  units: "物理或逻辑单位（如 mV、µA）。清空后保存为 null，可真正清除已有单位。",
  valueShape:
    "取值形态（kind 及 cells/phandle 等布局）。保存时一并更新；请勿在未改动时自动补齐历史缺失键。",
  bits: "每个数值的位宽（常见 32）。整数数组固定为 32；单元格/句柄引用可填。留空表示未设置。",
  cellsPerGroup:
    "每组数值个数，也就是列宽。写入校验只检查「每一组的数值个数等于此值」，不限制组数（行数）。行列都不固定时请留空。修改示例值或切换到数值类形态时会从示例自动推断。",
  bytesLength: "字节数组的字节长度；留空表示未设置。",
  constraints:
    "约束 JSON 对象（如 cells、min、max）。必须是对象；保存时整表替换，删除的键会从存储中消失。",
  schemaDefault:
    "来自 schema/解析侧的默认值，只读。有值时才在编辑器中展示；不在此修改。",
  exampleValue:
    "仅供示意的示例（JSON 或原文均可）。不参与校验或初始化；修改后若当前为数值数组 / 句柄引用 / 整数数组，会自动推断位宽与每组数值个数。",
  description: "面向操作者的短描述，可与参数说明互补；可清空。",
  documentation: "参数含义、取值范围与使用注意；保存与激活时必填。",
  usage: "引用该定义的项目参数落点摘要；明细未加载时可能只显示计数。",
  schemaHistory: "定义版本与来源的简要历史。",
} as const;
