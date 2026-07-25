# 技术视图展示项目主 DTS 源码 — 设计

> 日期：2026-07-24  
> 状态：已批准实现  
> English: [`docs/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md`](../../../superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md)  
> 分支：`feat/tech-view-primary-dts-source`

## 问题

工作台头部「技术视图」当前会把**左侧导航**从业务模块树切成 DTS 拓扑树，**右侧结果区**仍是参数表。想看项目事实 DTS 源码时，既失去模块导览，也得不到源码视图。

期望：模块导览固定不变；仅将右侧结果区替换为项目主 DTS 的只读渲染。

## 目标

- 「技术视图」把右侧参数表换成只读项目主 DTS 源码查看器。
- 左侧始终为业务模块树（本开关不再切换拓扑树）。
- 点选模块时，尽力滚动/高亮相关 DTS 行（借助 binding 的 `sourceLine` / 路径）。
- 技术视图下：搜索 = DTS 文本内查找；导出 = 下载当前主 DTS，并显示 `fileName · vN`。
- 废除旧语义「技术视图 = 拓扑导航」，并同步测例/文档。

## 非目标

- 在工作台内编辑或写回 DTS 文本。
- 保留并列的「左侧拓扑导航」模式。
- 多文件切换 UI（仅项目主 / 单一启用 board DTS）。
- 每个模块都能完美定位（无 `sourceLine` 时状态提示，不硬失败）。

## 设计

### 状态模型

用**结果模式**替代 `navigatorMode: "module" | "topology"`：

```ts
type WorkbenchResultsMode = "parameters" | "dtsSource";
```

- 左侧：始终 `moduleTree` + `DtsTopologyNavigator`（标题固定「模块导航」）。
- 头部「模块导航 / 技术视图」只控制 `resultsMode`：
  - `parameters` → 现有 `DtsParameterWorkbenchTable`
  - `dtsSource` → 新组件 `ProjectPrimaryDtsViewer`（命名可微调）

从该开关移除拓扑树切换；若工作台内无其它引用，可删掉对应死代码路径。

### 数据加载

由 `ApiProjectTopologyWorkspace`（或等价协调器）提供：

```ts
loadPrimaryDtsSource(): Promise<{
  fileName: string;
  versionNumber: number;
  text: string;
}>
```

实现要点：

1. `ParameterFileRepository.listFiles(projectId)`
2. 选定项目主 DTS（启用的 `format: "dts"`；优先 `{projectId}-board.dts`，否则唯一启用 DTS）
3. `downloadVersion` → UTF-8 文本
4. 按 `projectId` + version id 在工作台挂载期内缓存

加载中 / 失败 / 空态在右侧结果区展示，可重试。

### 查看器 UX

`ProjectPrimaryDtsViewer`：

- 等宽只读文本 + 行号
- 支持 `scrollToLine(line)` + 短暂高亮
- 文内查找：高亮匹配；Enter / 控件跳下一处（最小可用即可）
- 元信息条：`fileName · v{versionNumber}`

### 模块 → 行号映射

当 `resultsMode === "dtsSource"` 且用户选中模块节点：

1. 收集该模块子树下的工作台行（与参数列表同筛选规则）。
2. 取其中最小的正 `sourceLine`（v1 可仅行号；路径文本匹配为可选增强）。
3. 找到 → 滚动并高亮。
4. 找不到 → 提示「当前模块暂无源码行定位」。

### 工具栏

| 控件 | `parameters` | `dtsSource` |
| --- | --- | --- |
| 搜索 | 过滤参数行（不变） | DTS 文本内查找 |
| 结果计数 | `显示 N / M 个参数` | 匹配计数或弱化；优先匹配状态 |
| 导出 | 可见行 CSV（不变） | 下载当前 DTS；控件旁显示 `fileName · vN` |

### 测试

- 更新点击「技术视图」后断言拓扑导航 / 拓扑筛选的旧测例。
- 新增：技术视图后左侧仍为模块导览；右侧展示 DTS 文本（mock `loadPrimaryDtsSource`）。
- 新增：带 `sourceLine` 的模块选中会触发滚动/高亮（或等价状态断言）。
- 新增：dts 模式下搜索语义与导出下载文案。
- FRONTEND EN/ZH 各改一句技术视图说明。

## 成功标准

1. 技术视图：左 = 模块树，右 = 主 DTS 源码。
2. 「模块导航」恢复参数表。
3. 有 `sourceLine` 的模块点击会滚到对应行。
4. 搜索作用于 DTS 文本；导出下载文件且可见文件名+版本。
5. 相关工作台测例与 `docs:check` 通过。

## 文档影响（简表）

| 区域 | 动作 |
| --- | --- |
| 本设计双语对 | Update（本次） |
| `docs/FRONTEND.md` + ZH | Update（技术视图一句） |
| Product / domain | Review；仅当仍写「拓扑技术视图」时改 |
| API 契约 | No change（复用参数文件下载） |
