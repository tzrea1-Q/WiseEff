# 技术与测试文档融合计划

> English: [English](../../../exec-plans/completed/2026-09-06-technical-test-documentation.md)

状态：已完成本地文档交付（2026-09-06）；用户已确认范围。
历史状态：已实施文档融合，无产品运行时修改。
剩余归属：产品、目标环境与发布验证仍由各自既有门禁负责；本计划不关闭这些工作。

## 目标与范围

维护一套文档体系，沿用两个入口：`docs/design-docs/full-stack-architecture.md` 支持研发接手，`docs/design-docs/testing-strategy.md` 支持测试设计和执行规划。覆盖已实现的参数管理、日志、调试与公共能力。复用领域、API、安全与运行手册的权威内容，不建立平行手册；保留历史决策和生成的覆盖记录；新增内容维护独立且对应的中英文版本。

源码基线：`67d4a77325b6009b77c2373bd788298a6d022bcf`；开始时工作区干净。源码核查只能说明实现存在，不能证明测试通过、GitHub 当前状态、目标环境就绪或发布授权。

## 任务与成功标准

- [x] 核对运行时组合、业务边界、测试源码和现有文档。
- [x] 完善技术入口：内容归属、代码地图、业务流程、数据、异常处理和修改影响。
- [x] 完善测试设计：风险、数据准备、追踪关系、可执行核心与负向用例、自动化入口、清理和结果规则。
- [x] 修正经源码确认的过时描述，将目录指向既有权威页面。
- [x] 校验中英文新增内容、文件与锚点，执行 `npm run docs:check` 和 `git diff --check`，记录实际结果后归档。

## Git 与 PR 工作流

本次仅文档任务从用户提供的工作区提交建立 `codex/docs-technical-test-design`，无实现子智能体和运行时代码修改。停止于本地可审阅文档与检查结果；不提交、推送、创建 PR、合并、修改生产数据、补测试代码、执行全量产品测试或目标环境验证。

## 文档影响矩阵

下列英文路径均包含既有 `docs/zh-CN/` 对应页。

| 范围 | 处理 | 路径与核查依据 |
| --- | --- | --- |
| 仓库地图 | Update | `docs/README.md`、`docs/design-docs/index.md`：两个阅读入口与内容归属；核对 `ARCHITECTURE.md` 的目录组合。 |
| 计划 | Update | 本计划与 `docs/PLANS.md`；保留其他活动计划。 |
| 产品 | Review | `docs/product-specs/index.md`、`src/appConfig.ts`：范围和路由，不改产品行为。 |
| 架构 | Update | `docs/design-docs/full-stack-architecture.md`；核对 `docs/design-docs/domain-model.md`、`docs/design-docs/api-contract.md`、`server/app.ts` 和领域服务。 |
| 质量与测试 | Update | `docs/design-docs/testing-strategy.md`、`docs/QUALITY_SCORE.md`；核对 `docs/developer/verification-matrix.md` 和验收源码。 |
| 可靠性与手册 | Review | `docs/RELIABILITY.md`、`docs/runbooks/manual-acceptance.md`、`docs/runbooks/README.md`：复用详细流程，仅在直接核实时修正过时路由。 |
| 安全治理 | Review | `docs/SECURITY.md`、`docs/security/user-permission-design.md` 和可信调用实现：引用已有规则，不建立新授权策略。 |
| 前端与设计 | Review | `docs/FRONTEND.md`、`src/app/routes.tsx`：仅代码索引，无产品界面修改。 |
| 生成产物 | No change | `docs/generated/db-schema.md`、`docs/developer/user-operation-coverage-matrix.md`、`e2e/acceptance/operationMatrix.ts`：引用，不手改或虚构覆盖。 |
| 参考资料 | Review | 既有 API 过渡、内核边界、ADR 与历史计划：区分规范目标和观察到的实现。 |

## 文档更新门禁

所有 Update/Review 行处理完毕，中英文链接和新增内容对应，本地引用及两项文档门禁通过后才完成。测试设计及源码中存在的测试不是本次执行证据。本任务不引入延期实现工作。

## 验证

- `npm ci --ignore-scripts`：安装锁定依赖，仅用于本地文档工具；初次检查因缺少 `tsx` 未启动，安装后重跑。
- `npm run docs:check`：退出码 0；文档治理通过。数据库 schema 子检查因本机缺少 pgvector 跳过，未对生成 schema 与迁移进行验证。
- `git diff --check`：通过。
- 最终复查 24 个变更 Markdown 的本地路径、锚点及入站锚点：447 处链接，0 错误，包含导航和归档计划链接；无非文档受跟踪文件变更。
- 英文与中文设计用例各 20 个，ID 与顺序一致；每个用例均含准备、步骤、预期和清理。
- 本次未运行产品测试、浏览器或目标演练；未提交、推送或创建 PR。

## 文档影响处理结果

- 地图、全栈架构、测试策略、质量看板及计划索引已更新；两个现有入口继续承担技术与测试职责，没有新增平行手册。
- API、领域、安全文档原 Review 项已按实际组合、项目范围和可信调用构造修正；不改授权策略，不声明 TD-068 或目录计划关闭。
- 人工手册仅更新测试设计链接、当前人员管理路由和工作流导航范围，仍负责常规流程；A–H 和目标运行步骤未复制进新手册。
- 产品索引、运行手册索引、可靠性、权限设计、前端约定经阅读保持不变；源码 `src/appConfig.ts`、`src/domain/workflowDiscovery.ts`、`server/app.ts` 为当前入口依据。本任务不修改产品要求或执行运维步骤。
- 生成 schema、操作矩阵与机器可读覆盖源码保持不变；测试设计 ID 不冒充自动化覆盖。保留拓扑第四至六轮历史内容，删除的重复命令说明统一引用验证矩阵。
- 历史 ADR、契约及其他计划保留。所有本轮新增或修改的技术、测试及状态说明均有独立中文/英文对应；链接检查已核对。

## 交付格式与详实程度修订 — 2026-09-06

用户纠正了 Word 交付方向，要求后续维护包含充分正文和可编辑图表的 Markdown 合集，并要求 Excel 测试用例表采用严格黑白样式。

既有中英文全栈架构页面现各含 13 章正文与 22 张 Mermaid 图：系统上下文、运行时与模块架构、真实接口摘录、概念 ER、源文件到写回的数据流、业务时序、状态机、部署与恢复。正文补充版本身份、类型化值、事务与外部副作用边界、并发、幂等、授权、租约、持久审批、观测和恢复。继续维护原有权威页面，不增加竞争性的 Markdown 手册；此前 Word 产物仅为历史附件，不再作为持续维护的技术格式。

既有 Excel 工作簿保留 79 条用例、20 个设计 ID、四个工作表、公式、筛选、冻结窗格与执行状态下拉。应用到单元格的颜色仅有黑、白、灰，彩色条件格式和交替行底色已移除。全部用例仍为未执行，没有填写虚构结果。

本次修订验证：

- Mermaid 11.15.0 在无头 Chromium 中成功渲染中英文共 44 张图；逐张检查 22 张中文图，调整三张过宽流程图为纵向布局，修复一处英文时序图语法错误。
- 只读检查 XLSX：79 行用例与原始用例数据一致；237 个查找公式、五个带筛选的表、状态下拉及冻结窗格保留；汇总仍为 79 条未执行、零通过和失败，没有公式错误或残留条件格式规则。
- 对 24 个变更 Markdown 检查 379 处本地引用，零错误；两种语言的章节数及图表类型一致。
- `npm run docs:check`：退出码 0，文档治理通过；数据库 schema 子检查仍因本机缺少 pgvector 跳过。
- `git diff --check`：通过。本次浏览器仅用于文档图表渲染，没有执行产品界面验收、产品测试或目标演练。该修订记录形成时尚未提交、推送或创建 PR；之后用户已明确授权交付 PR。

本节结果替代此前针对已修订文件的链接数量快照；前述融合阶段记录继续作为历史保留。
