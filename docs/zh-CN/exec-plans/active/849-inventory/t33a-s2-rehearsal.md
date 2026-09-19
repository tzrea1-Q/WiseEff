# T3.3a S2 控制器与 Docker 彩排 — 进度回执

> English: [English](../../../exec-plans/active/849-inventory/t33a-s2-rehearsal.md)

状态：**已启动，尚未绿。** T3.2 剩余的 target-synthetic 与 minimal-upgrade 已记入后续合适环境；T3.2 保持未勾。本 todo 只拥有本地 S2/Docker 彩排。未 SEALED。未 push。T3.3b 仍是目标。封印点仍是 T3.4a。

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

T3.3a 剩余：三存储恢复点、artifact/release 之外的身份钉死、逐阶段中断、两个工作目录、helper PG 上的 export/import rehearsal、独占解冻/激活回执。

## 环境

Helper PG **55438**。不用 `wiseeff_lane_849`。不用 compose `5432/wiseeff`。本机 Docker 为 `linux/aarch64`；T3.3a 本地彩排可用 helper PG 容器，但不是 linux/x86_64 Hosted/minimal-upgrade 证据。
