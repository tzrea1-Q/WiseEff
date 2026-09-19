# T3.3a S2 控制器与 Docker 彩排 — 进度回执

> English: [English](../../../exec-plans/active/849-inventory/t33a-s2-rehearsal.md)

状态：**T3.3a 本地候选已绿。** 随后 T3.3b 作为已授权本机自托管目标跑过（见 [t33b-remaining-verification.md](t33b-remaining-verification.md)）。T3.2 剩余 target-synthetic/minimal-upgrade 仍延期。未 SEALED。未 push。封印点仍是 T3.4a。

## 必须补齐的缺口

来自 [round report S2](../2026-09-15-parameter-unification-round-report.md) 与 [PU-07](../2026-09-14-parameter-unification-and-seed-parity.md#controlled-archive-rebuild-procedure)：

| 缺口 | 现状 | T3.3a 义务 |
| --- | --- | --- |
| P2 静默 | 现场 Docker 观察到写/代理端口关闭、Redis 队列 `LLEN=0`、冻结键为 `1`；execute 仍要求 digest 绑定的 `ObservedQuiescence` 才写 P2。`WISEEFF_CATALOG_QUIESCED` 证明不是 P2 | 观察到的写屏障/队列排空/代理停止/发布冻结；`WISEEFF_CATALOG_QUIESCED` 证明不是 P2 |
| 恢复点 | 隔离三存储 capture/verify/`restoreCheck` 对着 Postgres **55441**／MinIO **59000**／Redis **56379**；Redis 变更后先前恢复点拒绝 restore | 绑定到本次 run 的三存储恢复点（`ops/self-hosted/storage/recoveryPoint.ts`） |
| 身份 | Plan 钉死 artifact SHA + release digest | 还要钉 database/image/schema/seed/scope/archive；拒绝漂移或不完整库存 |
| 发布 | 现场 Redis 独占解冻，成功/失败都重新冻结并要求激活回执。编排器上 P11–P16 仍不可用 | 独占授权下临时解冻、激活回执、成功/失败都重新冻结 — 不得把 P11–P16 变成静默默认 |
| 中断 | 已有 P0–P10 crash/resume（`liveRun: false`） | 每个持久阶段注入中断；续跑或 recovery-required；整套恢复；非参数保留 |
| 工作目录 | 仓库根 **和** `ops/self-hosted` 的 `rehearse-s2-docker` 以及 plan/execute/inspect/recover；密钥已脱敏 | 仓库根 **和** `ops/self-hosted` 都输出脱敏诊断 |
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

本轮（对着 `ops/self-hosted/compose.t34a-stores.yaml` 的现场 Docker S2 彩排）：

- P2 是观察结果，不是硬编码：写端口 **19991** 与代理端口 **19992** 必须关闭，Redis `LLEN wiseeff:t33a:jobs` 必须为 `0`，`GET wiseeff:t33a:publication-freeze` 必须为 `1`。写端口仍在监听则失败关闭。
- 独占解冻对着该 Redis 冻结键。激活拒绝会重新冻结；成功则写入 `wiseeff:t33a:activation-receipt` 并重新冻结。编排器上 P11–P16 仍不可用。
- 三存储 capture/verify/`restoreCheck` 对着隔离 Postgres **55441**／Redis **56379**／MinIO **59000**。Redis 校验和是 identity + PING + DBSIZE + 排序后的键 dump，不是 `INFO persistence`。回执写入后，先前恢复点拒绝 restore。
- `rehearse-s2-docker` 是 plan/execute/inspect/recover 之外的第二个工作目录入口。仓库根和 `ops/self-hosted` 都输出脱敏诊断（不含 MinIO 密钥）。

| 命令 | 结果 |
| --- | --- |
| `npm run test:scripts --` `t33aDockerRehearsal.integration.test.ts` `liveStorePorts.integration.test.ts` `cutoverWorkingDirectory.test.ts` | **5 通过** |
| `npx vitest run --config vitest.server.config.ts` `catalog-cutover/exclusiveUnfreeze.test.ts` `catalog-cutover/quiescence.test.ts` | **2 通过** |

本地 Docker 彩排不是 T3.3b、Hosted、目标或生产证据。

## 环境

Helper PG **55438**。隔离 T3.3a/T3.4a 存储：Postgres `127.0.0.1:55441/wiseeff_t34a`，Redis `127.0.0.1:56379`，MinIO `127.0.0.1:59000`。不用 `wiseeff_lane_849`。不用 compose `5432/wiseeff`。本机 Docker 为 `linux/aarch64`；T3.3a 本地彩排可用 helper PG 与该隔离存储栈，但不是 linux/x86_64 Hosted/minimal-upgrade 证据。
