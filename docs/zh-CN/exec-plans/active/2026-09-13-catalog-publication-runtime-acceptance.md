# Catalog 发布运行时验收（RA-01–RA-04）

> English: [English](../../../exec-plans/active/2026-09-13-catalog-publication-runtime-acceptance.md)

状态：**进行中**。本计划把已合入的 CP-00–CP-10 栈接到正式交付路径。不重做 Catalog 架构，也不重跑 CP-02–CP-10。

接受基线：`origin/main` `1059acb57379bd120d0d2b1a4b4733d4c2e02901`（PR #827 合入；head `8622a1d7da419725bc142b2ab917483c3ddfce68`）。

## 目标

操作员使用正式交付镜像和受支持的自托管入口，完成：已有目录预检 → 准确接管 → 真实发布者授权 → 页面新增定义 → 正式生效 → DTS ingest → 保存项目值 → 第二次发布 → 重启回读。

不得要求临时写 TypeScript、直接 SQL 改 Catalog，也不得靠 `WISEEFF_CATALOG_TEST_CAPABILITIES` 才能启用。

## 停止边界

本轮**不授权**：登录业务服务器、使用真实客户 DSN、改生产账号、在共享库名 `wiseeff` 上打开 `publication_enabled`、CP-12 目标机启用、重开 #824，以及在用户另行授权前开 GitHub PR/合入。

`publication_enabled` 默认保持 `false`。隔离启用只允许在临时库名（`wiseeff_<alnum>_<n>_<n>`）上使用 `EPHEMERAL_POLICY_REVISION_CONFIRMATION`。这不是生产启用授权。

## 四个发现

| ID | 发现 | 处理 |
| --- | --- | --- |
| F1 | compose 只有 `worker:logs` | **RA-01** 增加同镜像 `publication-manager` |
| F2 | operations.md 仍写“调用 adapter” | **RA-02** 可执行 `catalog-publication-ops` |
| F3 | 验收把排队/执行中当成功 | **RA-04** 超时仍非终态则失败 |
| F4 | freeze 无升级入口调用 | **RA-03** 升级停栈前冻结并停 manager |

## 文档影响矩阵

| 区域 | 路径 | 动作 |
| --- | --- | --- |
| 仓库地图 | `AGENTS.md` | Review |
| 计划 | `docs/PLANS.md`、本计划及英文对页 | Update |
| 产品规格 | `docs/product-specs/*` | No change |
| 架构 / ADR | ADR-0043、control-plane | Review |
| 质量 / 测试 | `docs/developer/verification-matrix.md` 及中文对页 | Update |
| 可靠性 / runbook | `ops/self-hosted/operations.md`、`upgrade.md`、README 及中文对页；新增 `ops/self-hosted/catalog-publication.md` 对页 | Update |
| 安全 / 环境变量 | `docs/developer/environment-variables.md` 及中文对页 | Update |
| 前端 / 设计 | 发布验收 spec | Review |
| 生成物 | 无 | No change |
| 参考 | baseline verification | Review |

## 文档更新门禁

阻塞：中英操作手册、operations/upgrade 表、环境变量行、verification-matrix 命令、`npm run docs:check`。延期项必须写入 `exec-plans/tech-debt-tracker.md`。
