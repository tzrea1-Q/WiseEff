# 项目配置工作台发布基线生命周期（#238）

> 状态：**已完成**
> 日期：2026-08-07
> 分支：`feat/project-configuration-workbench-release-baselines`
> Issue：[#238](https://github.com/tzrea1-Q/WiseEff/issues/238)，父级 [#227](https://github.com/tzrea1-Q/WiseEff/issues/227)
> 阻塞项：[#237](https://github.com/tzrea1-Q/WiseEff/issues/237)（已关闭 / 已合并）
> English：[English](../../../exec-plans/completed/2026-08-07-project-configuration-workbench-release-baselines.md)
> 设计：[项目配置工作台](../../design-docs/2026-08-06-project-configuration-workbench-design.md) §10.5 / §10.6 / Phase 5 / PCW-D6
> 起点：`39d98958`（含 #253 readiness 的 `origin/main`）

## 目标

在**源码上下文**中完成发布基线完整生命周期：Admin 从就绪的 Working 配置创建草稿快照，与 working/released 源码对比，确认允许的警告后带影响确认发布，或原子恢复历史基线，且**不静默改动当前已发布身份**。

## 范围与成功标准

1. 创建基线只快照配置集当前成员文件版本，不上传或改写源文件。
2. 创建与发布消费服务端就绪证据，拒绝 blocked / unavailable / stale 门禁。
3. 命令栏、检查器与源码上下文可见草稿 / 已发布 / 历史身份及钉住的成员版本。
4. 对比以统一或并排源码模式呈现成员与结构差异，退出后恢复先前 Working 位置。
5. 策略允许的警告在放行前需显式确认。
6. 发布带影响确认、持久审计，并刷新已发布身份与 working-versus-released drift。
7. 恢复预览精确成员/版本 blast radius，并原子应用。
8. 恢复仅为漂移成员创建 `origin=rollback` 版本，重算就绪，且不改变当前已发布基线。
9. API/数据库集成与 API 模式浏览器验收覆盖 create / compare / warning / release / restore / rollback 历史 / 原子失败 / 已发布身份不变（`PROJ-CONFIG-BASELINE-001`）。

## 非目标

- 遗留四视图 / `ProjectOperationsDialog` / `ConfigSetBaselinePanel` 切换（#240）。
- 在客户端用无关计数拼装就绪权限（#237 已拥有门禁）。
- 超出既有配置集导出的 Git 导出集成。

## 架构与测试接缝

| 接缝 | 行为 | TDD 证据 |
| --- | --- | --- |
| 应用服务 | 仅快照创建；对比 working/released；发布 tip + 旧 tip → historical；恢复预览 + 原子回滚；就绪 in-sync 基于真实成员漂移 | `baselineService.test.ts` + readiness 测试 |
| HTTP / 契约 | GET baseline；compare `against`；restore preview；OpenAPI/routeManifest | routes + openapi 测试 |
| Ports | previewRestore；compare 选项；mock + HTTP 对等 | port + mock + client 测试 |
| 工作台 UI | 历史/身份；对比模式；警告确认；发布影响；恢复预览；退出恢复 Working；刷新就绪/drift | 组件测试 |
| 浏览器验收 | `PROJ-CONFIG-BASELINE-001` | 中英文地图 + requirements + operationMatrix + e2e |

## 任务

### 0. 注册计划

- [x] 创建双语 active 计划并写入 EN/ZH `PLANS.md`。
- [x] Claim issue #238。
- [x] 锁定上表 TDD 接缝。

### A–D

详见英文计划：服务端生命周期、Ports/HTTP/OpenAPI、工作台源码 UI、验收与文档收口。

## 浏览器验收映射

| Requirement | Operation | 验收行为 | 证据 |
| --- | --- | --- | --- |
| `PROJ-CONFIG-BASELINE-001` | `PROJ-CONFIG-BASELINE-001` | Admin 在工作台源码上下文完成创建/对比/确认/发布/恢复；预览 blast radius；原子恢复；已发布 tip 不变；就绪刷新 | `e2e/acceptance/project-configuration-workbench.acceptance.spec.ts` + `work/ui-checks/project-configuration-workbench-release-baselines/` |

## 验证与文档门禁

命令、完成门禁、Documentation Impact Matrix 与 Update Gate 以英文版为准；中英文需同步更新，完成后迁移至 `completed/`。
