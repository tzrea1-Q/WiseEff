# DTS 节点启用状态 — 执行方案

> English: [`docs/exec-plans/active/2026-07-27-dts-node-enablement.md`](../../../exec-plans/active/2026-07-27-dts-node-enablement.md)  
> ADR：[`docs/adr/0003-node-enablement-is-not-a-parameter.md`](../../../adr/0003-node-enablement-is-not-a-parameter.md)  
> 分支：`feat/dts-node-enablement`

## 目标

让 DTS `status` 按其真实语义运作——它是节点级的启停开关，不是可调数值——而不是像现在这样同时被三条互相矛盾的代码路径处理。先解除结构属性对发布闸门的阻塞，再把节点启用状态做成可见、可改的一等能力。

## 问题

`status` 并非"没有处理"，而是**同时被三套不兼容的逻辑处理**。

| 入口 | 路径 | 当前后果 |
| --- | --- | --- |
| 匹配成功 | 节点有 `compatible`，命中 35 份定义了 `status` 的 vendor schema | `upsertMatchedPropertySpec` 建出 spec + binding，`status` 在规格库里就是一条普通参数 |
| 匹配失败 | `&direct_charge_ic { status = "ok"; };` 这类 overlay 片段没有 `compatible`，驱动匹配失败；而 `isParameterSurfaceRow` 对结构键返回 false，跳过 provisional surface 捷径 | 掉到 `reviewDrafts.push(...)`，变成 open 规格审核任务 |
| Mock 运行时 | `mockParameterTopologyRepository.ts` 硬编码 `spec-sc8562-status` 与 `binding-sc8562-status` | Mock 把 `status` 建模成参数，其 description 却已经写着 "Node enablement status" |

第二个入口代价最大。`evaluateCandidateSemanticGate` 对 `openSpecReviews > 0` 与 `unmatchedOccurrences > 0` 均 fail-closed，`migration.ts` 的 finalize 更是对**任何** open 审核任务直接抛错。而 `editService.ts` 另有一份用于闸门排除的结构键清单，漏掉了 `status`、`#gpio-cells`、`interrupt-controller`、`gpio-controller`；`parameterSurface.ts` 那份又漏掉 `phandle`、`linux,phandle`、`device_type`。两份互不包含。可观察到的症状就是 50 条清一色 `status` 的 open 审核任务，正在堵住候选修订晋级与迁移收尾，今天唯一的解法是逐条点 50 次驳回。

与此同时，界面上没有任何一处显示节点启用状态：`TopologyTree.tsx`、`DtsNodeTreeView.tsx`、`DtsStructureBrowserPanel.tsx` 全无引用，尽管 resolver 早就把它提到了 `ResolvedNode.status`，并落库在 `dts_nodes.status` 列。

## 领域决策

已记入 [`CONTEXT.md`](../../../../CONTEXT.md) 与 [ADR-0003](../../../adr/0003-node-enablement-is-not-a-parameter.md)。

- **节点启用状态**是一等概念，绝不是参数。主体是**逻辑节点实例**而非驱动模块：`&fm1230` 与 `&fm1230_1` 各自独立启停。判定为启用当且仅当该节点自身没有 `status`，或取值为 `ok` / `okay`；其余一律视为未启用。这与内核 `of_device_is_available()` 一致，包括"缺省即启用"这条默认规则。
- **节点可达性**在启用之外，还要求祖先链全部启用。一个自身写着 `ok` 但父级 `i2c@FDF5E000` 已禁用的节点，应报出**阻断的祖先**，而不是改口把它说成禁用。永远不改写子节点。
- **非标准取值**（`reserved`、`fail`、未知文本）语义上视为未启用，保留原文，禁止一键切换。
- **三态可观测，开关两档。** 未声明 / 显式启用 / 显式禁用三者都可观测，但只有启用与禁用可直接选择；回到"未声明"是一个低调的独立动作，写 `/delete-property/ status;`。这样单文件项目（主流的 `BindingDraftWriteTarget.role === "base"` 场景）与遗留的 base+overlay 配置集共用同一模型。
- **新写入的拼写**沿用项目自身习惯，从当前配置修订实测得出（种子 DTS 中 `ok` 以 264:4 领先 `okay`）。平局或无样本时回退 `ok`。实测结果在确认框中展示，可就本次写入覆盖。
- **复用管线，不复用概念。** 草稿的主体从"一个 binding"泛化为"一个编辑目标"（binding 或 node-enablement），从而共享工作版本、候选修订、toolchain 校验、发布闸门与审计。若另起一条平行管线，同轮混改会以 `mixed-working-tips`（HTTP 409）失败。
- **不新增权限档位。** 复用 `canEditParameters` 与现有 `SensitiveNodeRule` 匹配（其匹配键已经是节点路径与 `compatible`）。禁用操作额外要求填写理由与二次确认，并使用独立的审计事件类型。需要提档的节点由运营配置 sensitive 规则解决。
- **小泽 v1 只读。** 可解释某节点为何未启用、指出阻断的祖先，但不提供启停写工具。

## Git 与 PR 流程

| 角色 | 允许 |
| --- | --- |
| 实现方 | 从 `main` 检出 `feat/dts-node-enablement`，在特性分支上提交 |
| 实现方 | 不得推送 `main`、开/合 PR，或快进本地 `main` |
| 父代理 / 会话所有者 | 审阅、开 PR、合并、同步本地 `main` |

以下四批可独立合并。批次 1 先行先合，因为它正在堵发布，且不依赖后续任何一批。

## 批次 1 — 止血

- [x] 将 `src/domain/parameter-topology/parameterSurface.ts` 确立为结构键判定的单一事实来源。`STRUCTURAL_PROPERTY_KEYS` 取两份清单的并集：`compatible`、`reg`、`status`、`ranges`、`interrupt-controller`、`gpio-controller`、`phandle`、`linux,phandle`、`device_type`，并保留现有的 `#` 前缀规则。
- [x] 删除 `server/modules/parameter-topology/editService.ts` 中内联的 `structuralKeys` 数组（约 1372 行），改由 `loadCandidateSemanticGateCounts` 消费共享判定。
- [x] 在 `matchBindAndQueueReviews` 中，于 `matchProperty` 执行**之前**对结构键短路，使"匹配成功"这扇门与"匹配失败"那扇一起关闭，不再产生任何新的 `status` spec 或 binding。
- [x] 对 `migration.ts` 的 finalize 检查施加同样的排除——它目前统计所有 open 审核任务，完全没有结构键过滤。
- [x] 数据迁移：将现存结构键的 open 审核任务标记为 `dismissed`，附机器可读的系统性原因。保留行以延续审计链，不删除。
- [x] 数据迁移：将现存 `status` spec 与 binding 标记为 deprecated 并隐藏，不删除；其取值由批次 2 的启用模型重新派生。
- [x] 增加回归测试防止两份清单再次分叉——单一导出常量，并断言闸门查询与参数面判定消费同一来源。

## 批次 2 — 让启停可见

- [ ] 在 `src/domain/parameter-topology/` 中加入启用派生：自身启用状态取自本节点 `status`，可达性取自祖先链，另含非标准取值的分类。词汇表硬编码于此——它来自 Devicetree 规范，不来自厂商 YAML。
- [ ] 通过拓扑端口与 API 响应暴露启用与可达性，使 mock 与 API 模式服务同一语义模型（ADR-0002）。
- [ ] `TopologyTree.tsx` / `DtsTopologyNavigator.tsx`：节点行上的启用/禁用徽标，以及"不可达"标记，标出阻断的祖先并可跳转。
- [ ] `DtsParameterWorkbenchTable.tsx`：行级提示"所属节点已禁用，此参数不生效"，并可跳转到该节点。
- [ ] Mock 对齐：从 `mockParameterTopologyRepository.ts` 移除 `spec-sc8562-status` 与 `binding-sc8562-status`，改为在 mock 拓扑节点上以字段表达启用状态。

## 批次 3 — 让启停可改

- [ ] 在 `server/modules/parameter-topology/editService.ts` 中把草稿主体从 `bindingId` 泛化为编辑目标可辨识联合（`binding` | `node-enablement`），保持工作版本协调、候选修订生成、toolchain 校验与闸门评估共享。
- [ ] 复用现有 `ensureOverlayProperty` 写回机制：启用/禁用走 `set`，回到未声明走 `delete`。已有属性保持其原拼写，新写入采用实测的项目习惯。
- [ ] 节点详情中的开关 UI：两档 + 低调的"恢复为未声明"动作，禁用路径的理由输入与二次确认。
- [ ] 非标准取值渲染为只读并说明原因，另设二级"仍要修改"入口：展示原文、要求填写理由、明确告知将覆盖原始意图。
- [ ] 鉴权走 `canEditParameters` 加现有 `SensitiveNodeRule` 评估；启停变更使用独立审计事件类型，携带原值、新值与理由。

## 批次 4 — 收尾

- [ ] 停止在 `scripts/lib/vendorDtSchemaGenerator.ts`（约 54 行）生成 `status`，并重新生成 `schemas/dts/vendor/wiseeff/` 下受影响的 35 份文件；下线 `common-status.yaml`，或将其降为不再参与匹配的文档。
- [ ] 验证 `PARAM-CONFIG-PUBLISH-GATE-001` 仍然通过——其 fixture 依赖 `status=okay`，不能悄悄改为依赖一条已不存在的 spec。
- [ ] 按下方矩阵完成文档更新，并运行 `npm run docs:check`。

## UI 交互自动化

需新增到 `docs/developer/browser-acceptance-coverage-map.md` 的验收需求 ID 与 `docs/developer/user-operation-coverage-matrix.md` 的操作 ID，均落在 `e2e/acceptance/parameter-topology.acceptance.spec.ts`：

| ID | 批次 | 行为 |
| --- | --- | --- |
| `PARAM-ENABLE-GATE-001` | 1 | 结构属性不产生规格审核任务，也不阻塞候选晋级与迁移收尾；存量结构任务以系统性原因驳回 |
| `PARAM-ENABLE-VISIBLE-001` | 2 | 拓扑树显示启用/禁用，并为不可达节点标出阻断的祖先；被禁用节点下的参数行显示不生效提示 |
| `PARAM-ENABLE-TOGGLE-001` | 3 | 禁用节点需填理由并二次确认，可与参数编辑同轮提交而不触发 `mixed-working-tips`，写入项目拼写习惯，并记录独立审计事件 |
| `PARAM-ENABLE-GUARD-001` | 3 | `status = "reserved"` 的节点渲染为只读；二级入口要求显式确认后方可写入 |

需回归的既有 ID：`PARAM-SPEC-GOVERN-001`（队列内容变化）、`PARAM-CONFIG-PUBLISH-GATE-001`（fixture 依赖 `status=okay`）、`PARAM-TOPOLOGY-BROWSE-001`（树行新增徽标）。

## 文档影响矩阵

| 领域 | 动作 | 路径 |
| --- | --- | --- |
| 领域词汇表 | 更新 | `CONTEXT.md`（已完成：节点启用状态、节点可达性、启用覆盖、非标准启用取值） |
| ADR | 更新 | `docs/adr/0003-node-enablement-is-not-a-parameter.md`（已完成）、`CONTEXT.md` 的 ADR 索引 |
| 计划 | 更新 | `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、本方案及英文版 |
| 领域模型 | 更新 | `docs/design-docs/domain-model.md`、`docs/zh-CN/design-docs/domain-model.md` |
| 参数面 RFC | 更新 | `docs/design-docs/2026-07-21-dts-parameter-surface-boundary-rfc.md` §3.3 及中文版——结构属性的表述需从"排除"改为"排除出参数面**并**路由到节点启用状态" |
| DTS 评估 | 复查 | `docs/design-docs/2026-07-14-dts-parameter-management-assessment.md` §4.1 已记录缺失节点级启停能力，标记为已解决 |
| Schema 管理设计 | 更新 | `docs/design-docs/2026-07-16-parameter-topology-schema-management-design.md`——`status` 不再参与匹配 |
| 前端 | 更新 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`——拓扑树徽标、工作台不生效提示 |
| 安全与治理 | 更新 | `docs/SECURITY.md`——启停审计事件类型与 sensitive-node 复用 |
| API 契约 | 更新 | `docs/design-docs/api-contract.md`、`docs/zh-CN/design-docs/api-contract.md`——拓扑响应的启用字段、草稿创建的启停编辑目标 |
| 验收覆盖 | 更新 | `docs/developer/browser-acceptance-coverage-map.md`、`docs/developer/user-operation-coverage-matrix.md` |
| 生成的 schema | 更新 | `schemas/dts/vendor/wiseeff/*.yaml`（重新生成 35 份）、`scripts/lib/vendorDtSchemaGenerator.ts` |
| 测试策略 | 复查 | `docs/design-docs/testing-strategy.md`——预期无策略变更 |
| 运维手册 | 复查 | `docs/runbooks/parameter-identity-cutover.md`——迁移会在收尾阶段驳回结构审核任务 |
| 产品规格 | 复查 | `docs/product-specs/prototype-functional-spec.md`——启停是新的可见行为 |
| 可靠性 | 无变更 | — |
| 架构 / AGENTS | 无变更 | — |

## 文档更新闸门

阻塞性。在所有"更新"与"复查"行完成、或以证据明确记录为无需变更，且新的需求 ID 与操作 ID 已存在之前，本方案不得移入 `completed/`。运行 `npm run docs:check`。任何延后项写入 `docs/exec-plans/tech-debt-tracker.md`。

## 验证

```bash
# 批次 1
npm run test:server -- --run \
  server/modules/parameter-topology/ingestService.test.ts \
  server/modules/parameter-topology/editService.test.ts \
  server/modules/parameter-topology/candidateRevisionStateMachine.test.ts
npm test -- --run src/domain/parameter-topology

# 批次 2-3
npm test -- --run src/components/parameter-topology
npm run test:server -- --run server/modules/parameter-topology

# 全部批次
npm run test:all
npm run build
npm run docs:check
npm run acceptance:browser
```

批次 1 完成后针对本地种子库人工确认：`/parameter-admin` 的规格审核队列中 `status` 任务为 0，且候选晋级无需手工驳回即可成功。

批次 2、3 的前端验证需以 `playwright-cli` 对 `npm run dev` 在 1440x900、768x1024、390x844 三档视口执行，覆盖拓扑树、节点详情开关、工作台不生效提示，以及非标准取值只读路径，`console error` 干净，截图存于 `work/ui-checks/`。
