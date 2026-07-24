# 技术视图展示项目主 DTS — 实现计划摘要

> English plan: [`docs/superpowers/plans/2026-07-24-tech-view-primary-dts-source.md`](../../../superpowers/plans/2026-07-24-tech-view-primary-dts-source.md)  
> 设计：[`docs/zh-CN/superpowers/specs/2026-07-24-tech-view-primary-dts-source-design.md`](../specs/2026-07-24-tech-view-primary-dts-source-design.md)  
> 分支：`feat/tech-view-primary-dts-source`

## 目标

「技术视图」不再切换左侧拓扑树；左侧固定模块导览，右侧换成只读项目主 DTS 源码（模块跳行、文内查找、下载 `fileName · vN`）。

## 任务概览

1. `ProjectPrimaryDtsViewer`（TDD）
2. `selectPrimaryProjectDtsFile` 纯函数（TDD）
3. 工作台 `resultsMode` 重接线 + 改旧测例（TDD）
4. 模块跳转 / 查找 / 下载工具栏
5. `ApiProjectTopologyWorkspace` 注入加载 + FRONTEND EN/ZH
6. 验证门禁

## 验证

```bash
npm test -- src/components/parameter-topology/ProjectPrimaryDtsViewer.test.tsx
npm test -- src/application/parameters/selectPrimaryProjectDtsFile.test.ts
npm test -- src/components/parameter-topology/DtsParameterWorkbench.test.tsx
npm run docs:check
```

## 协作

实现子代理只在功能分支提交；父代理开 PR / 合并。
