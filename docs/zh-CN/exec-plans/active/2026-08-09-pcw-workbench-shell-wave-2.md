# PCW 工作台壳层 wave-2 — 展示适配器 + ConfigSetOps

> 状态：**Active（策划）** — 仅在 [PR #266](https://github.com/tzrea1-Q/WiseEff/pull/266) 合入 `main` 后实现
> 日期：2026-08-09
> English: [`docs/exec-plans/active/2026-08-09-pcw-workbench-shell-wave-2.md`](../../../exec-plans/active/2026-08-09-pcw-workbench-shell-wave-2.md)
> 父程序：[#258](https://github.com/tzrea1-Q/WiseEff/issues/258)（wave-1 会话见 PR #266）
> 锁定设计：[`docs/zh-CN/design-docs/2026-08-06-project-configuration-workbench-design.md`](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §16

## 背景

Wave-1（#259–#265 / PR #266）已抽出 Workbench session：`StructuredEditSession`、`CandidateVersionFlow`、`ReleaseBaselineSession`、`ConflictLocateFacade`，以及 `AuditQuery` 注入。

壳层 [`ProjectConfigurationWorkbench.tsx`](../../../src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx) 仍约 **4021** 行；剩余主要是 JSX 展示与配置集运维 / URL / 加载编排。

已锁定决策（2026-08-09）：

| ID | 决策 |
| --- | --- |
| W2-D1 | **混合**波次：先抽最大展示适配器，再抽一个 deferred 会话（`ConfigSetOps`）。 |
| W2-D2 | 中间成功标准：壳 **≤ ~2500 行** 且以编排为主。原 **800–1000** 留给 wave-3（树/搜索 + 画布 chrome + 导航/加载会话）。 |
| W2-D3 | **实现必须等 PR #266 合入后从 `main` 开分支。** 策划与开票可提前。 |

## 目标

1. 抽出 **WorkbenchInspectorPanel**（约 660 行 JSX）为展示适配器。
2. 抽出 **WorkbenchCommandBar**（约 360 行命令栏）为展示适配器。
3. 抽出 **ConfigSetOpsSession**（创建配置集 / 增删成员 / 导出 / 手动同步）。
4. 验收壳 ≤ ~2500 行，更新模块图，在 #258 留完成证据（除非产品负责人要求，否则不强制关 #258）。

## 非目标

- 本波达到 800–1000 行壳。
- 统一搜索、源码画布 chrome、完整 Activity 会话（wave-3+）。
- 服务端 ReleaseUnit、宽 port 拆分、ADR-0018 遗留上传、产品行为变更。
- 在 #266 合入前往 `feat/pcw-workbench-sessions` 叠提交。

## 绞杀顺序

1. Inspector 展示适配器  
2. Command bar 展示适配器  
3. ConfigSetOpsSession  
4. 瘦身验收 + 文档  

## Git 与 PR

实现分支：`feat/pcw-workbench-shell-wave-2`（#266 合入后的 `origin/main`）。实现子代理只提交、不开/合 PR；父代理开 PR、合并并同步 `main`。

## 验证

```bash
npx vitest run src/application/project-configuration/ src/components/project-configuration-workbench/
npm run build
wc -l src/components/project-configuration-workbench/ProjectConfigurationWorkbench.tsx
npm run docs:check
```

UI 结构搬迁时按 `AGENTS.md` 做 playwright-cli 视口检查。

## 文档影响矩阵与门禁

见英文计划同名章节；完成前须更新 EN/ZH FRONTEND 与 design §16，并跑通 `npm run docs:check`。
