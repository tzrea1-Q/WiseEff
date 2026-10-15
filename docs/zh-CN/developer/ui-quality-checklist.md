# UI 质量检查清单

> English: [UI quality checklist](../../developer/ui-quality-checklist.md)

WiseEff 主要服务 PC 用户。本规则取代原先全仓默认的桌面、平板、手机三视口走查；旧文档中一般性的三视口说明不再额外增加门禁。已接受的发布或功能契约明确要求特定设备支持时，仍为该范围执行对应检查。

## 复用设计体系

按需阅读 `docs/design-docs/ui-design-system.md` 和相邻组件测试。复用 `ModalDialog`、`ConfirmDialog`、`ColumnFilter`、`DataTable` 及 `src/components/ui/`，不要另建平行基础组件。

保留设计令牌、中文优先文案、公共格式化器、键盘焦点、可访问标签与错误关联、弹窗焦点管理和减少动态效果支持。验证本次变更影响的加载、空、错误、禁用与交互状态，不强迫重做页面所有无关状态。

## 默认只做一次 PC 检查

| 变更 | 最小浏览器观察 |
| --- | --- |
| 局部文案、图标、孤立视觉修复 | 在 `1440x900` 检查受影响页面和状态，观察换行与修改元素。 |
| 表单、搜索、筛选、导航、弹窗等交互 | 在真实运行模式的 `1440x900` 下验证相关成功、失败和键盘流程。 |
| 布局、密集表格、共享外壳、窗口缩放 | 先做桌面检查；只有布局存在风险时，补一个例如 `1280x800` 的紧凑 PC 窗口。只检查受影响页面或边界，不重跑全站。 |
| 明确的移动端、平板支持或设备专属发布契约 | 对指定范围主动启用额外视口检查。 |

可使用已有定向 Playwright 测试或可用的真实浏览器工具；只有契约点名时才强制使用 `playwright-cli`。已有当前候选的等价证据无需重复手工走查。DOM 快照不等于视觉证据：外观或布局改变需要截图并实际查看；普通交互修改无需额外制作无关截图集。

检查相关控制台与网络错误，区分存量问题和新回归。缺少浏览器仅阻塞浏览器验收，不阻止安全的独立实现，也不能声称验证通过。

## 自动化质量档位

`npm run acceptance:responsive` 及 `npm run acceptance:quality-run` 中的响应式项目默认仅运行桌面档位，保留原有页面和桌面布局断言。无障碍、视觉项目、原生 CI 回执和合入门禁保持不变。

完整质量检查还包含 `1280x800` 的独立 `compact` 项目，分别检查浅色和深色主题。它覆盖 NavigatorWorkbench、AdminListPage、OverviewPage、SettingsFormPage、ReviewInbox、RetiredNotice 各一个代表页面，并保留此前 Catalog 高度预算失败的全部页面：`/parameter-admin`、`/parameter-admin/specs`、`/parameter-admin/modules`、`/parameter-admin/specs/identity-mapping`。`e2e/quality/compact-routes.ts` 的九个页面仅增加 18 项检查，不重复完整页面矩阵。既有滚动与控件预算不变；Catalog 使用共享模板的有界面板和内部滚动。CI 在任务摘要中报告 Playwright 实际耗时，并保留质量任务的 35 分钟上限；协调者须确认实际耗时未超限。

```bash
# 默认 PC 布局检查，1440x900。
npm run acceptance:responsive
# 按需检查紧凑 PC 窗口，仅选择受影响测试。
WISEEFF_QUALITY_VIEWPORT_PROFILE=compact npm run acceptance:responsive -- --grep '/parameter-admin'
# 明确需要时检查桌面、平板和手机兼容性。
WISEEFF_QUALITY_VIEWPORT_PROFILE=extended npm run acceptance:responsive
```

仅支持 `desktop`、`compact`、`extended`；非法值直接失败，不会悄悄减少覆盖。测试名称记录实际视口。默认 PC 通过不表示平板或手机兼容；共享响应式套件之外已有的特定视口测试不会因此删除或改名为已通过。

## 质量阶段计时与可选 UI 就绪状态

已认证内容区域依据所属初始 API 域（参数、日志或调试）暴露 `data-runtime-state="loading|ready|error"` 与 `aria-busy`。加载期间页面内容使用原生 `inert`，导航、状态及重试区域仍可用。各域独立完成，无关设备发现、可选轮询及其他页面请求不能阻塞当前区域。错误保留无演示数据警告和重试；重试成功恢复 `ready`。初始外壳契约之后，业务页面已有加载/错误状态继续适用。

验收 `prepareInteractionSurface` 在导航/刷新后要求所有已挂载就绪 owner 均为 `ready`，不再以横幅消失推断。Bearer 登录导航等待同一组就绪标记；初始化/失败场景继续直接导航。节点目录拥有必需 nodes/modules 加载、取消与重试，其标记和外壳标记组合；可选设备发现不能阻塞目录，节点调试路由仍保留设备要求。有意验证初始化/失败的测试绕过该辅助：持有真实必需 API 响应，在释放前对已渲染控件按下指针，完成响应后抬起指针，验证没有意外菜单/确认。复用现有 API 场景及运行时，不使用统一 sleep、`networkidle`、增加重试或额外浏览器环境。

每次质量测试尝试都会在现有 Playwright JSON/HTML 结果中附带 `quality-phase-timings` JSON。具名步骤 `quality:navigation`、`quality:readiness`、`quality:axe` 和 `quality:capture` 记录毫秒耗时、各阶段总耗时、失败状态、重试编号和测试耗时。采集阶段包含截图与一致性测量。嵌套阶段只计一次，未执行的阶段总耗时为零。这些操作计时不等于质量分片的墙钟耗时；优化前后的 CI 作业耗时须单独比较。

隐藏的 `xiaoze-popup-readiness` 标记仅在弹窗层卸载后报告 `closed`，测试工具仍断言弹窗层已隐藏。`xiaoze-toggle-hint-readiness` 标记报告 `pending`、`revealed` 或 `suppressed`。首次提示仍等待真实的 1.4 秒延迟；已关闭或本次页面加载已展示过的提示立即就绪，不再通过超时证明不存在。`revealed` 表示已渲染，不保证 CSS 可见（对话框可以隐藏提示）；测试工具关闭可见提示，并保留隐藏状态断言。几何、axe 规则、截图断言、遮罩和基线均不变。

## 原生命令与证据

执行定向组件或行为测试；TypeScript、Vite、路由、共享类型变化执行 `npm run build`；前端代码执行相应 `npm run lint`；样式、令牌、弹窗、动态效果、可见文案变化执行 `npm run ui:check`。交互修改按 `docs/PLANS.md` 审阅验收测试、需求编号、操作编号和操作证据影响。

只汇总一次候选身份、页面与模式、实际视口和交互、命令结果、必要截图、控制台与网络问题和缺失证据。产物应脱敏，不在技能、PR 和最终回复中重复整套清单。
