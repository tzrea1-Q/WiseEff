# DTS 拓扑鼠标/触控展开折叠实施计划

> English: [English](../../../superpowers/plans/2026-07-20-dts-topology-expand-collapse.md)

> **面向代理执行者：** 按任务逐步实施；步骤使用 `- [ ]` 勾选跟踪。详细代码与命令以英文计划为准。

**目标：** 为 `DtsTopologyNavigator` 父节点增加独立展开/折叠控件：点击控件只切换子节点可见性；点击行主体仍只负责选中与参数筛选；键盘与 roving-focus 行为保持不变。

**架构：** 将行级 `<button role="treeitem">` 改为可聚焦的 `role="treeitem"` 容器，内嵌 `tabIndex={-1}` 的原生展开按钮，复用现有 `setExpanded` / 可见性计算。不改 API、树构建、身份或提交流程。

**设计规格：** [2026-07-20-dts-topology-expand-collapse-design.md](../specs/2026-07-20-dts-topology-expand-collapse-design.md)

## 全局约束

- 展开按钮不调用 `onSelectNode`，不改变参数列表筛选。
- 点击树节点主体不切换展开状态。
- 展开按钮不是第二个 Tab 停靠点；指针操作后焦点回到树节点。
- 叶子节点无展开按钮。
- 折叠祖先不丢弃已选后代身份。
- 触控布局展开热区 ≥ 44×44 CSS 像素，并有悬停/焦点样式。
- 无障碍文案：`展开 ${label}` / `折叠 ${label}`。

## 文件

| 路径 | 职责 |
| --- | --- |
| `DtsTopologyNavigator.test.tsx` | 锁定指针展开契约 |
| `DtsTopologyNavigator.tsx` | treeitem 容器 + 展开按钮 |
| `styles.css` | 热区与触控样式 |

## 任务摘要

1. **TDD：** 追加四类失败测试（折叠/展开不选中、行点击不切换、叶子无按钮、折叠后保留选中身份）。
2. **实现：** 替换 markup，复用既有键盘逻辑。
3. **样式：** 桌面悬停/焦点；移动端 44×44。
4. **验证：** 组件测试、`npm run build`、playwright-cli 在 `/parameters` 三视口检查。

完整步骤、代码片段与提交信息见英文计划。
