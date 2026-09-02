# 目录 launch 操作规则

> English: [English](../../agents/catalog-launch-operating-rules.md)

本规则适用于仍开放的 Wayfinder #668 launch Issues（#683–#735 中尚未关闭者）。它不改变验收标准、CD/CF/ID/RE 边、所有权路径或证据层。它是这些已冻结 ticket 的执行合同。

父会话在 map Issue #668 上放置指针。各 launch Issue 正文保持冻结。

## 保持冻结的内容

- D / L / PG / B / H / T / R 继续严格区分。不得把 local 或 Hosted 输出标成 target、release 或 production evidence。
- skipped job 仍按 skip 记录。
- Issue 点名的命令保持 mandatory，除非 accepted run profile 写明 exact Hosted job 运行相同命令或已证明的 superset。
- 安全、授权和人工审批边界仍优先于本文。

## 专用 lane 数据库

凡证据包含真实 PostgreSQL 的 node：

1. 在独立 worktree 中运行 `npm run catalog:lane:env -- provision --issue <n>`。
2. 导出打印出的 `DATABASE_URL` / `TEST_DATABASE_URL`（数据库 `wiseeff_lane_<n>`，地址 `127.0.0.1:55438`，镜像 `pgvector/pgvector:pg16`）。
3. 禁止使用默认 compose 应用库 `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff`。该实例是 `postgres:16-alpine`，跨 checkout 共享，不能作为 catalog evidence。

`npm run catalog:lane:env -- doctor --issue <n>` 在禁用 URL、缺少 pgvector、或 `catalog_migration_owner` 对 `public.parameter_specs` 的 SELECT 失败时失败关闭。

## 打开 PR 前的本地验收

Hosted 只做确认，不做发现。

```bash
npm run catalog:lane:accept -- --issue <n> -- <issue-named command>
```

命令必须是 Issue 拥有的 focused suite（Vitest 路径、schema 测试、compiler 测试或点名的 PG 命令）。收集到 0 个测试文件是硬失败——该输出通常是 `globalSetup` 崩溃，而不是空套件。RBAC 与 migration 节点必须让 `catalog_migration_owner` 通过 role canary，而不能只以 bootstrap 超级用户跑绿。

精确候选上该本地门禁变绿之前，不得打开 final PR。

## 并发

- 合入保持串行：同一时间只有一个功能 Hosted PR。
- 开发不串行。路径不相交的 Scratch lane 在 merge lane 处于 `HOSTED` 时可以继续做到 `SEALED`。
- Hosted 运行期间，父会话必须派发或继续至少一条不相交 lane，或记录当前没有不相交工作。空手等待 CI 是协议违规。
- 纯流程修订（协议、操作规则、lane-env 脚本、双语文档）是独立 merge wave，可以与已经打开的功能 PR 并存。

共享的 migration、生成的 `docs/generated/db-schema.md`、OpenAPI 和 fingerprint 文件仍然串行，这些 lane 保持 WIP 2。

## 盘点与 fingerprint

在 `THREAT-READY` 对受信基线做完整扫描后，一次性锁定 occurrence 计数、allow-list、schema fingerprint 和 lock 文件。同一不变量的第二次补丁触发 circuit breaker。若只有一个选项能通过 Hosted，父会话记录该选择并继续，不得把 merge lane 停在无法产生绿色 merge bar 的 publisher 问题上。

## 无关失败

只分类一次。无关 Hosted flake 允许一次 `gh run rerun --failed`。lane 不得修补无关测试。

## Issue 正文

不得为了“让 Hosted 更好过”而修改已冻结的验收标准。流程变更写入本文、[智能体交付执行协议](agent-delivery-protocol.md) 以及 Wayfinder 计划中的 G0.3 run profile。
