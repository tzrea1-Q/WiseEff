export const DEFINITION_IMPORT_TEMPLATE = `# Driver \`vendor,existing-driver\`

## \`current-limit\` 电流限制
| 字段 | 值 |
| --- | --- |
| 类型 | integer |
| 单位 | uA |
| 最小值 | 0 |
| 最大值 | 5000000 |
| 示例 | 3000000 |
| 简述 | 电流限制 |

在此填写定义的 Markdown 说明。

## \`voltage\` 电压
| 字段 | 值 |
| --- | --- |
| 类型 | number |
| 示例 | 3.3 |

## \`label\` 名称
| 字段 | 值 |
| --- | --- |
| 类型 | string |
| 示例 | 示例文本 |
| 示例 | 另一个示例 |

## \`enabled\` 开关
| 字段 | 值 |
| --- | --- |
| 类型 | boolean |
| 示例 | true |

## \`empty\` 空值
| 字段 | 值 |
| --- | --- |
| 类型 | null |
| 示例 | null |

## \`groups\` 嵌套数组
| 字段 | 值 |
| --- | --- |
| 类型 | array<array<integer>> |
| 最小值 | 0 |
| 最少项数 | 1 |
| 最多项数 | 2 |
| 示例 | [[1,2]] |

## \`mixed\` 混合值
| 字段 | 值 |
| --- | --- |
| 类型 | mixed |
| 类型说明 | mixed |
| 示例 | {"value":1} |

数组和 mixed 的示例使用 JSON；每行一个示例，最多 8 行。数组的项数限制作用于最外层，数值边界作用于最内层的数值类型，最多嵌套 4 层。字段值中的竖线请写为 \\|。

# Driver \`vendor,new-driver\`
nature: physical-device · cardinality: multiple · 业务分类：电源 / 充电管理 · 模块名称：充电芯片

## \`new-property\` 新主体参数
| 字段 | 值 |
| --- | --- |
| 类型 | string |
`;
