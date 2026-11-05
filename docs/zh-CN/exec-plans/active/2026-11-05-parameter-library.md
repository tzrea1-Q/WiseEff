# 参数库实施

> English: [English](../../../exec-plans/active/2026-11-05-parameter-library.md)

完成[规格 #1513](https://github.com/tzrea1-Q/WiseEff/issues/1513) 及[已接受设计](../../design-docs/2026-11-05-parameter-library-design.md)。复用发布目录、规范 Binding／当前值来源和项目编辑器。平台定义与组织配置阅读保持明确边界，保留写入授权和来源完整性，不引入第二套值存储。

## 任务和责任

#1514 定义阅读、#1515 组织读取范围可并行；两者完成后实施 #1516 当前实例和准确用量。随后并行推进 #1517 筛选、#1518 实例对比、#1519 编辑往返；#1520 分享与复制依赖 #1517、#1518。当前全部待实施。

协调者负责集成、运行环境、重验证及 PR。每票由 GPT-6.1 Terra、xhigh 推理子智能体在独立托管工作区按 TDD 实施，合并子智能体负责集成。全部完成后独立进行规范和规格双轴审查，再由单一实施智能体修复发现。

## Git & PR Workflow

基线为 `origin/main@d867166f5332dbceacbce348f7e73f1b16911ac1`；集成分支为 `codex/parameter-library`。用户明确调用的 `implement-spec` 采用单一集成 PR，替代通常的逐片 PR 约定。首次子任务合并后打开草稿，最终合并时关闭 #1513–#1520。交付边界是已验证、已审查、可供审阅的 PR；不合并主线或部署。

## 验证

已确认边界为公开 HTTP＋真实 PostgreSQL，以及真实 API 浏览器流程。实施者运行聚焦红绿测试与静态检查；协调者运行基于上述基线的 `npm run test:impact -- --base <base>`，遵循两个 fallback 标志，承担选定回归、构建、UI 与文档检查。

新增浏览器文件 `e2e/acceptance/parameter-library.acceptance.spec.ts`；需求／操作 ID 为 `PARLIB-READ-001`、`PARLIB-SCOPE-001`、`PARLIB-INSTANCES-001`、`PARLIB-FILTER-001`、`PARLIB-COMPARE-001`、`PARLIB-RETURN-001`、`PARLIB-SHARE-001`。通过原生验收流程记录操作证据。检查 1440×900，并对密集表格和对比补充 1280×800；覆盖 DTS、软件配置、键盘、长值、错误及过期响应。采用独立数据库和运行通道，不把 mock 或跳过当作后端验收。

## 文档影响矩阵

| 领域 | 动作 | 路径及处理 |
| --- | --- | --- |
| 仓库地图 | Review | `ARCHITECTURE.md`、`CONTEXT.md`，仅更新变化的所有权／术语。 |
| 计划 | Update | `docs/PLANS.md`、本计划及中英文配套。 |
| 产品 | Update | 参数库设计及配套，记录最终状态。 |
| 架构 | Update | ADR-0055、领域模型及配套。 |
| 质量 | Update | 浏览器覆盖图、`e2e/acceptance/operationMatrix.ts`、生成的操作矩阵及配套。 |
| 可靠性 | Review | `docs/RELIABILITY.md`；预计无新服务和部署。 |
| 安全 | Update | `docs/SECURITY.md` 及配套，仅调整当前配置读取。 |
| 前端和用户 | Review | `docs/FRONTEND.md`、UI 设计体系、适用用户指南及配套。 |
| 生成物 | Review | `docs/openapi.yaml`、`docs/DB_SCHEMA.md`，核实实际 API 文档位置；预计无表结构变化。 |
| 引用 | Review | 关联目录和项目工作台文档，保留历史证据。 |

## 文档更新门禁

移入完成目录前，为全部 Update／Review 项记录更新或明确的不变结论，完成文档检查并记录真实运行证据及 PR 状态。计划创建时尚未运行验收。
