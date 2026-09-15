# 参数定义工作区恢复与受控身份迁移（#847）

> English: [English](../../../exec-plans/active/2026-09-14-parameter-definition-workspace-restoration.md)

## 状态

进行中。Issue：[#847](https://github.com/tzrea1-Q/WiseEff/issues/847)。

英文计划是权威版本；本页是与之配对的中文维护页，内容按英文计划同步。当前中文页记录范围、基线与门禁，详细的检查清单与证据表格以英文页为准。

## 纠错成功路径闭环（2026-09-15）

在真实浏览器 + 真实 API + 真实发布管理器上完整走通纠错成功路径后，修复了三处此前未被接缝测试覆盖的缺口，均已有测试覆盖：

1. **源格式无法从记录的 source_ref 判定。** dts 摄取记录的是 `config-set:<id>`，而源格式门禁只接受 `.dts`，导致所有项目都以 `unsupported-source-format` 被阻止。现在在预览与执行时都通过取值背后的 DTS occurrence 解析真实 `.dts` 文件与节点定位（追加型取值行不改写），新写入直接记录解析后的 `.dts` 位置，`resolveConfigRevisionForSource` 同时接受两种形态。证据：`provenance.integration.test.ts`、`evaluate.test.ts`、`catalogProjectValueSync.integration.test.ts`。
2. **浏览器永远到不了服务端写路由。** `apiAdapter` 只转发了 release pin，丢掉了必需的 `Idempotency-Key`/`If-Match`，预览先返回 409 `revision-conflict`；即使通过，`create` 也因 API 把激活留给发布管理器、随后拒绝该发布产生的 release 而无法落库。现在适配器完整转发写上下文，对话框用同一幂等命令 + 刷新后的 release pin 重试，API 通过管理器的激活回执**观察**激活（自身不安装 release，遵守 CP-07），预检也接受该预览自己铸造的后继 release 为当前 release。证据：`DefinitionCorrectionDialog.test.tsx`、`provenance.integration.test.ts` 与下方浏览器记录。
3. **过期审核工作会永久阻塞纠错。** 属于已被取代 release 的 open `parameter_review_items` 行既不在列表中、也无法再被解决，却按组织全量计入未完成工作。现在只统计被纠错 release 的未完成审核项，与审核队列自身的口径一致（VL-06、ADR-0044 §9）。

**真实浏览器成功路径（已记录）**：专用通道 `wiseeff_lane_847`；浏览器验收库 `wiseeff_i847lane_1_1`（同一 pgvector 服务，`publicationEnabled=true`、`adopted=true`、`authoringAllowed=true`、`publishingAllowed=true`、`blockers=[]`）；发布管理器以独立进程和专用 manager LOGIN 运行。在 `/parameter-admin/specs` → 主体 `charger` → 定义 `iin_final_16660` → **身份纠错**，替代主体 `acme,correction`、新属性键、影响项目 `nebula`、填写原因后：影响预览为 选定项目 1 / 可迁移 1 / 被阻止 0 / 源格式受支持 **是**、无 blocker、项目"待处理/兼容"；执行结果为 `data-correction-result="completed"`、已完成 1 / 被阻止 0 / 失败 0 / 待处理 0；数据库中 `definition_replacements` 为 `completed`，新 `pbind_*`/`pval_*` 继承了 `nebula-board.dts!/charger@0` 与取值 `1000`，旧绑定、旧取值与旧定义保持不变。截图位于 `work/ui-checks/847/correction-{form,preview,result}-{desktop,tablet,mobile}.png`（`work/` 不入库）。控制台仅有握手过程中两次预期内的过渡状态（首次 create 的 503 `catalog-not-ready`、管理器激活后重试的 409 `release-drift`），无 UI 错误态。

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

## 运行配置：前端打磨阶段的批量验证（操作者已同意）

针对本 Issue 剩余的前端小改动，操作者同意收窄运行配置：**迭代期间不逐个改动重跑测试套件**，改为批量验证，并在操作者确认"闭环"后统一执行：

- 迭代期：在运行中的浏览器里按受影响的视口检查改动效果（这才是迭代反馈环），保持 `typecheck` 通过并提交。
- 操作者发出信号后：一次性执行下节全部验证（隔离库上的服务端全量套件、Catalog 浏览器验收规格、候选门禁），并附证据报告结果。

收窄的只是**节奏**，不是证据契约：在最终候选上完成上述批量运行之前，不得把任何改动的验证状态说成已完成，也不得把计划标记为完成。此处的记录即为 `docs/agents/agent-delivery-protocol.md` 所要求的"已接受的运行配置"。

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
