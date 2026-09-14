# 参数定义工作区恢复与受控身份迁移（#847）

> English: [English](../../../exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md)

## 状态

进行中。Issue：[#847](https://github.com/tzrea1-Q/WiseEff/issues/847)。

英文计划是权威版本；本页是与之配对的中文维护页，内容按英文计划同步。当前中文页记录范围、基线与门禁，详细的检查清单与证据表格以英文页为准。

## 目标

在**当前正式目录（canonical Catalog）**之上恢复 2026-09-05 之前的组织参数定义工作区：模块导航位于宽定义表旁，唯一的"新建"入口，紧凑的搜索/列筛选/分页，按需展开的定义历史与带计数的待处理工作，以及带固定操作区的宽编辑器。同一变更恢复定义弃用/恢复，并新增受控的**定义身份纠错**能力：发布替代身份并迁移明确选定的当前引用。

仅恢复外观不合格：验收必须通过真实 HTTP 接口、独立 PostgreSQL 库与真实发布管理器证明读取、调用、持久化与重新打开的行为。

## 不在范围内

- 回退正式目录数据模型、重开旧版结构写入、私有组织覆盖层或第二个目录物化器。
- 硬删除或在原地重写永久定义/主体/绑定/取值/历史身份。
- 普通共享定义发布自动修改项目取值或修订固定点。
- 未明确确认的跨组织引用迁移、自动全局弃用、强制单位/取值换算、覆盖并发用户工作。

## 风险级别与运行配置

- 总体：**R2 — 行为级**。
- 密封子通道：身份纠错迁移为 **R3 — 密封级**，实现前先冻结威胁矩阵。
- 专用通道数据库：`wiseeff_lane_847`（`127.0.0.1:55438`，`pgvector/pgvector:pg16`），由 `npm run catalog:lane:env -- provision --issue 847` 创建。禁止使用默认 compose 应用库作为目录证据。

## 基线

| 项 | 值 |
| --- | --- |
| 已接受的 `origin/main` | `6d72e17cb4c581e7235b181dbbfd45d92f4dee7b` |
| 历史 UX 参考 | `0b2b769a5106b99a80db08fc381dbf16024efd77` |
| 替换提交（回归来源） | `f96fed3948a6d09f2afe372dbeb74f6a89b1ce30` |
| Scratch 分支 | `feat/847-parameter-definition-ux-restoration` |
| 停止边界 | 不创建 PR、不合并、不推送 `main`、不执行生产/目标环境操作 |

已测得的回归：桌面工作区宽 1136 px 时定义表仅约 328 px，原因是 `src/features/parameter-catalog/parameter-catalog.css` 为列表/详情/时间线保留了三条并列轨道。

### 侦察结论（实现前记录）

`f96fed394`（#809）**没有删除**历史工作区：全部历史规格组件与 `src/styles.css` 从 `0b2b769a` 到 `main` **逐字节相同**。历史编排仍在，但因 `OrganizationSpecsArea` 优先渲染 `catalogLibrary` 节点、且 `AppRuntime` 始终提供两个 Catalog 端口，运行时不可达。

因此：

1. **回归来自新的挂载点，而不是丢失的布局。** `CatalogPage` 在历史参考点没有任何引用者，其三列工作区是未被挂载的潜在代码，#809 首次启用它。
2. **旧编排是被取代的写入方，不是目标。** `docs/design-docs/parameter-catalog-api-transition.md` 已将 `/api/v2/parameter-specs*` 的 activate/deprecate/restore/reattribute/rename/cutover 判定为 `410`。恢复该界面等于复活已退役写入方，明确超出范围。

历史**呈现与交互**决策仍是已接受基线：模块导航 240–520 px 旁接占满剩余宽度的表格、URL 作为搜索/筛选/模块选择的唯一真源、20/50/100 页大小与真实结果计数、单一行操作打开操作区固定分离的宽编辑器、按需历史、带计数的待处理工作入口。

## 文档影响矩阵与更新门禁

以英文页 `docs/exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md` 的 `## Documentation Impact Matrix` 与 `## Documentation Update Gate` 为准；中文开发者文档在对应英文页更新时同步维护。

## 验证命令

```bash
npm run catalog:lane:env -- provision --issue 847
npm run catalog:lane:env -- doctor --issue 847
npm run typecheck
npm run build
npm run ui:check
npm run contract:check
npm run docs:check
```

跳过、不支持或失败的子检查必须显式报告；退出码为 0 但存在跳过的子检查不构成 PASS。
