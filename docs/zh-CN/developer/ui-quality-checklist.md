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

```bash
# 默认 PC 布局检查，1440x900。
npm run acceptance:responsive
# 按需检查紧凑 PC 窗口，仅选择受影响测试。
WISEEFF_QUALITY_VIEWPORT_PROFILE=compact npm run acceptance:responsive -- --grep '/parameter-admin'
# 明确需要时检查桌面、平板和手机兼容性。
WISEEFF_QUALITY_VIEWPORT_PROFILE=extended npm run acceptance:responsive
```

仅支持 `desktop`、`compact`、`extended`；非法值直接失败，不会悄悄减少覆盖。测试名称记录实际视口。默认 PC 通过不表示平板或手机兼容；共享响应式套件之外已有的特定视口测试不会因此删除或改名为已通过。

## 原生命令与证据

执行定向组件或行为测试；TypeScript、Vite、路由、共享类型变化执行 `npm run build`；前端代码执行相应 `npm run lint`；样式、令牌、弹窗、动态效果、可见文案变化执行 `npm run ui:check`。交互修改按 `docs/PLANS.md` 审阅验收测试、需求编号、操作编号和操作证据影响。

只汇总一次候选身份、页面与模式、实际视口和交互、命令结果、必要截图、控制台与网络问题和缺失证据。产物应脱敏，不在技能、PR 和最终回复中重复整套清单。
