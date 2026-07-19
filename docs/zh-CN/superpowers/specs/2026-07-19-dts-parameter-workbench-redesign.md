# DTS 参数工作台深度重设计

> English: [English](../../../superpowers/specs/2026-07-19-dts-parameter-workbench-redesign.md)

日期：2026-07-19
状态：设计已确认；融合实现与验收文档已完成，等待父智能体 Review

## 背景

DTS 适配已经建立了源码 occurrence、生效拓扑、参数规格、项目绑定、value shape、映射、candidate revision 和类型化回写等真实语义模型。API 模式的 `/parameters` 页面随后几乎完全切换到了紧凑的 `ProjectTopologyWorkspace` 三栏拓扑界面。

这保留了数据流，却丢失了用户已经熟悉的成熟参数工作台：

- `WorkbenchLayout` 与原页面层级；
- 搜索、模块和重要性筛选；
- 主参数表格与行聚焦；
- “本轮已修改参数”区域；
- 草稿抽屉、详情对话框、批量提交预览与历史提交入口。

因此本次设计必须把两套模型融合起来：工作台仍然是主界面，DTS 拓扑成为其中的一等导航和来源链层。语义 API 与失败关闭的工作流保持不变。

## 已确认决策

1. 保留原参数工作台作为两种运行模式的页面外壳与主要心智模型。
2. API 模式把语义 DTS binding 映射为工作台行，不恢复已退役的扁平 `parameterId` 身份和业务 `recommendedValue`。
3. 增加可折叠的内嵌 DTS 拓扑导航器，不再以永久三栏拓扑布局替代整个页面。
4. 复用原有表格、详情对话框、草稿抽屉和提交预览交互，并补充 DTS 内容和状态。
5. 继续从既有语义仓储读取源树/生效树、occurrence、provenance、schema/policy 诊断、映射、candidate revision 和类型化 `set|delete` 编辑。
6. 保持 API 模式的失败关闭：无 teaching 数据回退、无静默身份转换、无客户端业务状态绕过。
7. 这是前端视图模型与组合方式调整，不新增数据库迁移，也不改变 API 身份契约。

## 目标

- 让 `/parameters` 保持原参数工作台的使用感，同时展示 DTS 行的完整含义。
- 用户可以从参数行进入 `amba → i2c@FDF5E000 → sc8562@6E → gpio_int`。
- 搜索、筛选、选中、草稿、批量提交和审核交接保持熟悉且支持键盘。
- 在不过度压缩表格的前提下展示驱动、器件地址、挂载路径、raw value、value shape、源码 occurrence、schema、policy 和映射状态。
- 桌面、平板、移动端都具备一致的层级，页面不出现横向溢出。
- 真实 typed edit → candidate → submit → 角色审核 → merge 链路保持不变。

## 非目标

- 不恢复扁平参数身份，也不从路径推断身份。
- 不把示例值当作推荐值或强制默认值。
- 不新增第二套 API 或第二套提交工作流。
- 当前产品没有安全的删除控件，因此不在本次范围新增 delete authoring；既有 delete API/验收行为保持。
- 不重做 `/parameter-admin`、`/parameter-review` 或无关页面。
- API 模式在空态、加载态、错误态都不能回退到 mock/teaching 数据。

## 用户体验模型

### 页面层级

保留原页面顺序：

1. 工作台页面上下文与项目身份；
2. 权限/初始化提示；
3. DTS 上下文工具栏与可选拓扑导航；
4. 有草稿时显示本轮修改汇总；
5. 主参数工作台列表；
6. 选中 binding 的详情对话框或移动端详情 sheet；
7. 原有提交预览与角色分配流程。

拓扑导航是上下文控制，用来筛选和解释主列表，不再成为与列表竞争的第二主工作区。

### 语义工作台行

API 模式使用独立于旧 `ParameterRecord` 的前端视图模型：

```text
DtsParameterWorkbenchRow
- bindingId
- parameterSpecId
- parameterSpecVersionId
- propertyKey
- driverModule
- compatible/display driver label（若 API 提供）
- instanceName
- unitAddress
- topologyPath
- sourceFileName / sourceNodePath
- rawValue
- effectiveValue
- valueShapeSummary
- schemaState / policyState
- mappingState
- source/effective occurrence references
```

行映射器必须是纯函数且结果确定。它组合现有拓扑节点、binding、effect 和源码节点，不创造规格默认值，也不把路径作为身份。缺少的可选关联显示明确的破折号或“不可用”。

### 主列表列

桌面端使用可读表格并渐进披露：

| 列 | 内容 |
| --- | --- |
| 属性 | `gpio_int` 与类型 badge |
| 器件/驱动 | `sc8562`，以及 API 提供时的 compatible |
| DTS 位置 | `i2c@FDF5E000 / sc8562@6E`，完整 `amba` 路径放在详情/提示中 |
| 生效值 | raw DTS 值，截断并提供复制入口 |
| 类型 | `phandle-list · 32 bit · 3 cells` |
| 治理 | schema、policy、mapping badge |
| 操作 | 查看/编辑，受权限和状态控制 |

平板/移动端将行转换为卡片，优先显示属性、器件路径、值和状态，类型与来源链进入详情。

### 搜索和筛选

保留原工作台搜索，同时加入以下 DTS 语义字段：属性键、驱动/compatible、实例与地址、完整拓扑路径、源码文件/节点路径和 raw value。

搜索框增加搜索图标、清除动作、可见焦点样式和结果数量。模块、风险、schema、policy、mapping 和 source/effective 过滤器使用紧凑 filter chip 或既有列筛选菜单。清除全部筛选不会清除待提交草稿。

### 拓扑导航器

`DtsTopologyNavigator` 替换当前扁平 `TopologyTree` 展示。它基于源码 occurrence 的 parent ID 或生效逻辑节点的 parent ID 构造嵌套树，并保持仓储返回顺序。

每个节点可以显示名称与地址、compatible/驱动摘要、binding 数量、开放映射数量以及 schema/policy 警告标记。

导航器提供：

- 源树/生效树 segmented control；
- 按节点展开/收起与全部展开/收起；
- 保留路径的搜索高亮；
- 与主列表联动的节点选中状态；
- 当前节点的紧凑面包屑。

选中节点后主列表只展示该节点下的 binding；取消节点选择恢复完整筛选列表。选中行不会丢失当前树上下文。

### 详情与编辑

继续以原 `ParameterDetailDialog`/sheet 为入口，详情分为五个卡片区：

1. 身份：属性、驱动、实例、地址、binding/spec ID；
2. 位置：完整源码路径、文件/版本、occurrence 范围和行号；
3. 来源链：base、overlay、effect，以及 source/effective 切换；
4. 值契约：raw value、解析 shape、schema/policy、诊断；
5. 类型化编辑：raw 编辑器、原因、校验与创建草稿。

创建 draft 后返回真实 candidate 身份，并加入原有“本轮已修改参数”区域。草稿卡显示当前值→目标值、原因、action、candidate revision 以及 stale/validation 状态。提交继续使用 binding-draft wire contract 和项目角色候选人 API。

### 视觉语言

使用项目现有蓝灰/靛蓝令牌，同时建立更清晰的层级：工作台上下文卡、带图标的紧凑工具栏、轻浮起的拓扑导航卡、带行状态的列表卡、带文字的语义状态 badge，以及统一的 8/12/16px 间距和 10/12/16px 圆角。

加载、空态、错误和阻断状态必须是设计好的面板，不能继续以无样式段落呈现。沿用全局 `.button` 契约；DTS 控件只添加图标和语义修饰，不创建第二套按钮系统。

## 响应式行为

### 桌面端（至少 1200px）

- 主列表是核心；
- 拓扑导航为 260–300px 可折叠侧栏；
- 详情使用原有宽对话框或右侧详情表现；
- 页面无横向溢出。

### 平板端（821–1199px）

- 拓扑导航收起为工具栏触发面板或顶部上下文区；
- 保留属性、器件/路径、值和治理列；
- 详情以模态抽屉打开。

### 移动端（390px 基准）

- 工具栏堆叠为搜索、筛选、视图切换和动作；
- 树、列表、详情使用明确面包屑导航；
- 行变为卡片，长路径/raw value 自动换行或复制；
- 详情使用满高 sheet；
- 验收断言 `document.documentElement.scrollWidth === innerWidth`。

## 组件与数据边界

计划新增：

- `src/domain/parameter-topology/workbenchTypes.ts`：语义行和展示状态；
- `src/application/parameters/buildDtsWorkbenchRows.ts`：纯拓扑行映射与搜索文本；
- `src/components/parameter-topology/DtsTopologyNavigator.tsx`：嵌套树；
- `src/components/parameter-topology/DtsParameterWorkbench.tsx`：工具栏、树、列表、草稿、详情组合；
- `src/components/parameter-topology/DtsParameterRow.tsx`：响应式行/卡片；
- `src/components/parameter-topology/DtsBindingDetailDialog.tsx`：语义详情，必要时安全扩展现有详情组件。

`ApiProjectTopologyWorkspace` 变为数据加载/协调边界，或缩减为向新工作台提供数据的薄适配器。`ParametersPage` 保留 mock 渲染路径，API 模式挂载 DTS 工作台。

不新增 API endpoint。现有拓扑仓储继续作为 Config Set、源/生效树、binding、mapping、校验、candidate draft 和类型化提交的事实来源。

## 状态与错误行为

- 加载：显示树/列表骨架；
- Config Set 为空：显示原 empty-state 卡并给出项目管理入口提示；
- 缺少语义修订：显示 ingest/setup 卡，不显示空表；
- 需要映射：显示 warning banner 与节点/行 badge，校验保持失败关闭；
- schema/policy 失败：行和详情显示诊断，只禁用受影响动作，保留读取；
- stale revision：沿用 409 诊断，要求刷新后重新编辑；
- 项目切换：加载新项目之前清除 preferred revision、pending draft、assignee、发布消息、映射消息以及树/列表选中状态；
- API 错误：显示可重试错误卡，绝不回退 teaching 数据。

## 可访问性

- 搜索保持带标签的 `searchbox`，提供清除按钮和结果数量；
- 树使用 `role=tree/treeitem`、`aria-expanded`、`aria-selected`，可展开节点提供键盘操作；
- 表格行/卡片提供单一可预测激活目标，并保留可见焦点；
- badge 包含文字，不依赖颜色；
- 对话框/sheet 遵循现有焦点管理；
- 所有仅图标动作提供 accessible label 和 tooltip。

## 验证计划

### 单元/组件测试

- `gpio_int` 映射为正确属性、器件、地址、路径和值；
- 搜索覆盖属性、器件、地址、路径和 raw value；
- 源树/生效树嵌套展开与选中；
- 节点选中筛选列表、清除后恢复列表；
- 行→详情→typed draft 保留 binding/spec/candidate 身份；
- 草稿卡渲染 action、原因、目标和 candidate 状态；
- loading/empty/error/mapping/schema/policy 状态；
- 移动端 pane 切换与键盘/焦点行为。

保持 mock `ParametersPage` 和 `ParametersTable` 测试通过；API topology 测试只更新组合断言，不弱化语义仓储和失败关闭工作流断言。

### 浏览器验证

使用当前本地 API 和 `playwright-cli` 验收 `/parameters`，必要时确认 `/parameter-admin` 的共享导航上下文，视口为 `1440×900`、`768×1024`、`390×844`。

需要验证：搜索 `gpio_int`、从嵌套树选中 `sc8562@6E`、查看路径/raw/shape/provenance、填写原因创建 typed draft、在原“本轮修改”工作流中看到 draft、树/列表/详情和清除筛选、console/network、焦点与无横向溢出。

完成前运行 `npm run build`、前端聚焦测试、`npm run docs:check` 以及相关 topology acceptance/evidence 门禁。

## 发布与兼容

1. 先实现纯行模型和嵌套导航器，并用组件测试锁定行为；
2. 在保留 mock 旧路径的前提下组合 API 工作台；
3. 运行浏览器验收，对照原工作台交互清单；
4. 只有新流程具备等价或更好的覆盖后，才移除 API 模式旧的纯拓扑组合；本范围不移除 mock 兼容代码。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 表格信息过密 | 渐进披露、语义 badge、响应式卡片、详情对话框 |
| 树与列表选中漂移 | 单一协调状态与纯 binding/node join |
| 旧身份泄漏回 API 模式 | 新行视图模型与显式语义提交合同 |
| DTS 长路径破坏布局 | 换行、截断+详情复制、移动端卡片 |
| 原有工作流回归 | 保留 mock 路径，先添加 API 行/草稿/浏览器测试 |
| CSS 再次形成孤立系统 | 复用现有令牌、`.button`、卡片、间距与 modal primitive |

## 实现约束

- 当前 binding DTO 不一定携带 `compatible` 或完整规格详情。首版只展示 API 已证明的字段，缺失处明确显示“不可用”；增加新 endpoint 需要另行设计 API。
- 当前产品没有 delete authoring 控件。删除展示保持读取/验收兼容，不虚构新的删除入口。

## 验收结果

可见验收继续使用 `PARAM-TOPOLOGY-BROWSE-001`、
`PARAM-TOPOLOGY-EDIT-001` 和 `PARAM-HAPPY-001`。流程驱动的是融合后的
`WorkbenchLayout`，不是纯拓扑替代：覆盖搜索、真实源/生效嵌套选择、
`gpio_int` 语义行与详情弹窗、typed draft/本轮修改区、角色审核、语义合入
回写、reload 和 base 不可变性。API 模式继续禁止推荐值和教学回退语义。
浏览器矩阵覆盖 1440×900、768×1024、390×844。标准外层验收可能被
`deviceGateway`、`xiaozeLlm`、`backups` readiness 阻断；隔离 evidence 不会关闭
TD-042，也不证明 production/cutover ready。
