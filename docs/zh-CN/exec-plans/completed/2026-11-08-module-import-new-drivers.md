# 在模块结构导入中创建驱动

> English: [Implementation plan](../../../exec-plans/completed/2026-11-08-module-import-new-drivers.md)

日期：2026-11-08。用户要求扩展模块管理现有 JSON 导入，在一批文件中创建业务模块和此前不存在的驱动主体，并设置归属。实现已完成；当前候选的验证和合入证据记录在 PR 描述中，不包含部署。

## 目标与文件契约

保留现有窗口和更新格式，新增可选的 `newDrivers`，最多 128 项。每项提供稳定的包内 `ref`、单个精确 `compatible`、明确的 `driverNature` 和 `instanceCardinality`、可选 `displayAlias`，以及 `placement: { kind: "module", moduleRef }`。目标可以是已有业务模块或同文件新增模块。原 `subjects` 仍使用已有身份；导出元数据和计数保持不变。

新驱动可以只有主体声明，不需要编造参数定义、源码或项目实例。重复引用或 compatible、已有身份、未知字段、无效标识、缺少驱动属性、无效或已删除目标、复制模式中的创建指令，都应返回具体字段和修复建议。

## 发布与组织应用

1. 只读预览校验整份文件，列出模块、新驱动和目标完整路径。
2. 人工确认将声明发布到共享 Catalog。重新校验预览，保存服务端候选及引用映射，沿用现有发布授权并入队；只有 publication-manager 激活发布。
3. 以对应候选和任务的激活回执为准。重新上传同一文件可恢复服务端映射；客户端不能自行提供分配的身份。丢失响应和重试不能重复创建。
4. 根据原导出基准和当前状态生成新的结构预览。人工最终确认后，在同一事务创建模块、登记主体、设置归属并记录审计和回执。

Catalog 发布与组织应用是两次提交。界面明确提示“驱动已发布，模块与归属尚未提交”；第二步失败时保留已发布身份供恢复。不含 `newDrivers` 的文件继续使用原单次确认流程。

## 验收与分工

- 后端：契约、持久化迁移、授权、声明校验、发布适配、回执与引用映射、最终事务，以及真实 PostgreSQL / HTTP 回归。
- 前端：合并预览、共享目录发布确认、进度和刷新、重新上传恢复、最终确认和具体诊断。
- 协调者：中英文文档、生成 OpenAPI、1440×900 真实 API 浏览器验收、集成检查、独立检视和 PR 交付。
- 覆盖两个新层级模块和两个无参数驱动；重复或已有标识；无效归属；预览无写入；真人、角色及组织隔离；冻结发布；并发和过期；丢失响应；发布成功但组织应用失败；重复提交和审计回滚。
- 浏览器验证两次确认和刷新页面后重新上传恢复；单独的发布回执不能被视为导入完成。

## Git 与 PR 工作流

分支 `feat/module-import-create-drivers`，基线 `87dd3709340775ac98ec3d7d221594dec2f3dfaa`。使用一个 PR；协调者负责外部写入，在当前必需 CI、截图核对和独立检视完成后合入。用户已授权实现、PR 和合入。不部署、不修改线上发布策略、不写生产数据。

## 文档影响矩阵

| 类别 | 动作 | 文件与依据 |
| --- | --- | --- |
| 仓库地图 | No change | `ARCHITECTURE.md`：沿用发布和组织治理的模块职责。 |
| 计划 | Update | 本计划及英文对应文件。 |
| 使用说明 | Update | `docs/user-guide/module-structure-editing.md` 与中文对应文件：字段、示例、确认和恢复。 |
| 架构 | Update | `docs/adr/0054-module-structure-transfer-is-explicit-organization-governance.md` 与中文对应文件：明确新增编制入口及两次提交。 |
| 验证 | Review | `docs/developer/verification-matrix.md`：沿用原生 PostgreSQL、浏览器、静态和构建检查。 |
| 可靠性和安全 | Review | `docs/RELIABILITY.md`、`docs/SECURITY.md`：保留发布进程职责、恢复、授权和组织隔离。 |
| 前端 | Review | `docs/developer/ui-quality-checklist.md`：沿用现有对话框和 1440×900 验证。 |
| 生成契约 | Update | `docs/generated/openapi.json`、`docs/generated/db-schema.md`，包含迁移 `0335_module_structure_driver_publications.sql`。 |
| 相关入口 | Review | `docs/user-guide/parameter-management.md` 与中文对应文件：补充批量新建驱动入口。 |

## 文档更新门禁

填写指南、ADR、参数管理入口和两份生成产物已更新。现有验证分层及 1440×900 UI 规则不变；权限、组织隔离、发布激活和事务回滚继续遵循原安全与可靠性边界，两阶段恢复说明已写入 ADR 和指南。本地文档治理与 OpenAPI 检查通过；由于本地无 PostgreSQL，数据库产物仍需原生 pgvector CI 对照验证。当前测试、CI、独立检视和合入状态记录在 PR 描述中，本计划不能代替必需验收。
