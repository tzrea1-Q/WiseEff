# T3.3a S2 控制器与 Docker 彩排 — 进度回执

> English: [English](../../../exec-plans/active/849-inventory/t33a-s2-rehearsal.md)

状态：**T3.3a 本地候选已绿。** T3.3b 不是通过（见 [t33b-remaining-verification.md](t33b-remaining-verification.md)）。T3.2 剩余 target-synthetic/minimal-upgrade 仍延期。未 SEALED。未 push。封印点仍是 T3.4a。

## 必须补齐的缺口

来自 [round report S2](../2026-09-15-parameter-unification-round-report.md) 与 [PU-07](../2026-09-14-parameter-unification-and-seed-parity.md#controlled-archive-rebuild-procedure)：

| 缺口 | 现状 | T3.3a 义务 |
| --- | --- | --- |
| P2 静默 | `orchestrator.ts` 硬编码 `writersFenced/queuesDrained/publicProxyStopped: true` | 观察到的写屏障/队列排空/代理停止/发布冻结；`WISEEFF_CATALOG_QUIESCED` 证明不是 P2 |
| 恢复点 | `captureInventoryDump` 只是关系计数，不是 PG/对象存储/Redis | 绑定到本次 run 的三存储恢复点（`ops/self-hosted/storage/recoveryPoint.ts`） |
| 身份 | Plan 钉死 artifact SHA + release digest | 还要钉 database/image/schema/seed/scope/archive；拒绝漂移或不完整库存 |
| 发布 | P11–P16 不可用 | 独占授权下临时解冻、激活回执、成功/失败都重新冻结 — 不得把 P11–P16 变成静默默认 |
| 中断 | 已有 P0–P10 crash/resume（`liveRun: false`） | 每个持久阶段注入中断；续跑或 recovery-required；整套恢复；非参数保留 |
| 工作目录 | CLI 在 `scripts/wayfinder` | 仓库根 **和** `ops/self-hosted` 都输出脱敏诊断 |
| export/import rehearsal | `export/import-parameter-catalog-rehearsal.sh` + `rehearse-parameter-catalog-replacement.sh` | 在自有 helper PG 上补齐身份/漂移/容器缺口，不用 compose `5432/wiseeff` |

## 本轮

关闭 P2 硬编码 true：没有 digest 绑定的观察证据时，execute 不得写下 P2 checkpoint。`upgrade.sh apply` 仍要求 `WISEEFF_CATALOG_QUIESCED`，且它仍不是 P2 证明；apply 另外要求 `WISEEFF_CATALOG_QUIESCENCE_JSON`。

验证（helper PG **55438** / `wiseeff_t23b`）：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run --config vitest.server.config.ts` `catalog-cutover/quiescence.test.ts` `orchestrator.test.ts` `recovery.integration.test.ts` | **10 通过** |
| `npx vitest run --config vitest.scripts.config.ts` `execute-parameter-catalog-cutover.test.ts` | **3 通过** |
| `upgrade.sh.test.ts` `-t "quiesce\|QUIESCENCE\|P2"` | **4 通过**，243 跳过 |
| `upgrade.sh.test.ts` `-t "S11-APL catalog apply"` | **15 通过**，232 跳过 |

本轮（T3.3a 收口）：

- Plan 钉死 database/image/schema/seed/scope/archive；库存不全或观察漂移失败即关闭。
- P3 要求 digest 绑定的 postgres/对象存储/Redis 恢复点观察；库存 dump 只用于回滚相等，不当备份。
- 在隔离库上对每个 P0–P10 注入崩溃再续跑到完成。
- 独占解冻要求已冻结 + 匹配 token，总是重新冻结，并要求激活回执。编排器上 P11–P16 仍不可用。
- inspect/plan/execute/recover JSON 脱敏；`ops/self-hosted/scripts/parameter-catalog-cutover.sh` 是第二个工作目录入口。
- export/import rehearsal 对着 helper 容器 `wiseeff-g668-pg` 跑过（不是 compose `5432/wiseeff`）。

静默与恢复点 JSON 仍是操作员提交的证明，不是从 compose 队列/代理自动采集。缺证明失败即关闭。

## 环境

Helper PG **55438**。不用 `wiseeff_lane_849`。不用 compose `5432/wiseeff`。本机 Docker 为 `linux/aarch64`；T3.3a 本地彩排可用 helper PG 容器，但不是 linux/x86_64 Hosted/minimal-upgrade 证据。
