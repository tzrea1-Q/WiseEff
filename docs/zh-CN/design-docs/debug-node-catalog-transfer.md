# 调试节点目录传输

> English: [English](../../design-docs/debug-node-catalog-transfer.md)

Issue #846 把原来偏窄的「导出目录 / 导入目录」升级为一次完整的组织级目录传输：**导出全部节点**、
**预览合并**、**原子导入**。本页是 `server/modules/debugging/catalogTransfer.ts` 背后的持久规格；
路由行见 [api-contract.md](api-contract.md)。

## 范围

被传输的对象是当前组织节点库中已保存的调试节点：模块是其组织结构，节点是条目，协议绑定是节点配置。
参数目录定义、DTS 拓扑节点、尚未入库的设备发现结果、设备当前值、会话、操作历史、用户与凭证都不在范围内。
目标组织始终由已认证身份决定，文件里的来源组织仅作说明。

## 文件格式

服务写出 `wiseeff.debug-node-catalog.v2`：

```jsonc
{
  "format": "wiseeff.debug-node-catalog.v2",
  "source": { "organizationId": "org-1", "organizationName": "ChargeLab", "exportedAt": "…" },
  "counts": { "modules": 3, "nodes": 6, "bindings": 5 },
  "modules": [{ "name": "Charging", "parentNamePath": ["Battery"], "description": "", "scope": "lab", "sortOrder": 2 }],
  "nodes": [{
    "sourceId": "…", "name": "Fast charge current", "moduleNamePath": ["Battery", "Charging"],
    "description": "", "detailedDescription": "", "writeFormatExample": "", "writeFormatHint": "",
    "valueKind": "scalar", "valueFormat": "raw", "normalizationMode": "trim", "maxValueBytes": 16,
    "enabled": true, "archived": false, "archiveReason": null,
    "bindings": [{ "protocol": "hdc", "nodePath": "/sys/hdc/current", "accessMode": "RW", "enabled": true }]
  }]
}
```

`wiseeff.debug-node-catalog.v1` 文档继续可导入，并被归一化为同一内部结构。两种格式都是 `.strict()`：
未知的外层、模块、节点或 binding 字段会返回带定位的 `VALIDATION_FAILED`，而不是被静默丢弃。

### 字段存在性

v2 的可选字段具有存在性语义，解析不会把省略变成默认值：

| 文件状态 | 匹配到已有目标时的含义 |
| --- | --- |
| 省略字段 | 保留目标值 |
| `""` | 清空可清空的文本字段 |
| `null` | 清空可空字段（`maxValueBytes`、`archiveReason`、binding `notes`） |
| 提供值 | 更新为该值 |

v1 为兼容旧文件保留 schema 默认值，因此归一化时从原始 JSON 读取存在性，而不是从解析结果读取。
这就是为什么缺少 `description` 的 v1 文件会保留目标描述，即使 schema 会填入 `""`。

## 单一权威取数路径

导出与导入规划都调用 `loadCatalogTargetSnapshot`，一次性读取该组织的所有模块、**所有**已持久化节点
（含归档、禁用、无绑定）和所有 binding。它不受当前表格分页、搜索词、模块选择、协议筛选或树展开状态影响，
响应中的 `counts` 与同一对象集合同源。若某节点的 `debug_node_module_id` 在本组织内无法解析，
会以带定位的阻断冲突报告，而不是被静默导出或跳过，因此文件不会一边声明完整一边丢行。

## 导出入容量

容量约定为**单个文档 20 MiB（按 UTF-8 文件字节计）**（`DEBUG_CATALOG_MAX_DOCUMENT_BYTES`）。
它取代原先 500 模块 / 2,000 节点的数量上限——那个上限会让服务生成自己读不回来的合法文件。
HTTP 层对两个导入路由最多收集 22 MiB（`resolveRouteBodyLimit`），超限请求在**有界收集阶段**即返回
`413 PAYLOAD_TOO_LARGE`，而不是先把整个请求体读进内存；文档级检查会报出精确字节上限。
导出序列化后超过上限时整次失败，不返回部分文件。

## 预览与执行共用一份计划

`buildCatalogImportPlan` 只校验、匹配并分类一次：

- **模块**按完整父级名称路径 + 名称匹配；只比较并写入文件声明的字段，因此往返一次不会被判为更新；
- **节点**先按源节点 ID 匹配，再按唯一的「完整模块名称路径 + 节点名称」匹配；未命中则创建新的目标 ID，
  命中的保留目标 ID、历史引用和创建身份；
- **binding** 按目标节点 + 协议匹配；文件中缺失的协议被保留，绝不删除。

阻断冲突（整份文件被拒绝，不自动猜测匹配）包括：重复模块完整路径、悬空模块父级、悬空节点模块、
重复源 ID、ID 与名称路径命中不同目标、两个文件条目争用同一目标、重复 binding 协议、
目标模块引用成环或悬空，以及目标节点模块引用无法解析。

归档状态不会被静默改写：新导入的归档节点保持归档，并记录当前操作者与时间；已有目标保留其归档状态与原因，
文件值不同会产生 `archive-state-preserved` 提示，归档/恢复仍由独立的节点操作完成。

## 摘要与并发保护

预览返回 `previewDigest`：对规范化文件、目标组织，以及计划涉及的全部目标对象规范化状态做 SHA-256。
执行必须携带该摘要，并在同一事务内：

1. 对由组织派生的键取 `pg_advisory_xact_lock`，使同一组织的目录传输写入串行化；
2. 重新读取目标快照并重建计划；
3. 存在阻断冲突时返回 `409 CONFLICT`；
4. 摘要不一致时——包括文件变化、已审阅目标被编辑/移动/删除，或文件中要新增的节点此时已存在——返回
   `409 CONFLICT` 且 `details.reason: "stale-preview"`；
5. 应用全部模块、节点、binding 变更与成功审计事件。

因此预览是并发证据而不是授权凭证；服务端报告预览过期时，界面会请求重新预览，而不是盲目重试。

## 原子性、权限与审计

三个路由都由服务端要求 `debugging:admin`。所有写入（含 `debug-node-catalog-import` 审计事件）共用一个事务，
注入的导入中途失败会全部回滚。导出与导入审计记录当前操作者、目标组织、请求关联、格式、字节数、结果计数与
预览摘要，绝不记录原始 node path、完整文件或来源组织的审计身份。预览与取消不产生业务写入，也不产生虚假的导入成功事件。

## 界面

节点库保留一个导出按钮和一个导入按钮。导出下载完整 v2 文件并显示实际节点、模块与绑定数量；演示模式会把
文件标注为本地演示数据。导入会读取文件、在上传前检查字节大小、向服务端请求预览，并打开弹窗展示来源与目标范围、
新增/更新/不变/冲突计数、提示与逐对象字段差异，突出协议路径、访问模式和启用状态变化。只有在服务端报告
没有阻断冲突时才可确认，提交过程中弹窗按钮禁用。
