# T3.3b 剩余验证 — 已授权的本机自托管目标

> English: [English](../../../exec-plans/active/849-inventory/t33b-remaining-verification.md)

状态：**已授权本机目标在 HEAD `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f` 上通过。** 不是生产。不是 Hosted。T3.4a 仍 **未 SEALED**。破坏性 T2.3 DROP 不在计划内。计划：[t33b-target-plan.md](t33b-target-plan.md)。

操作员指定一套本机自托管实例作为 T3.3b 目标（不是 T3.3a 的 t34a-stores 彩排栈，也不是 compose `5432/wiseeff`）。

## 实例

| 钉 | 值 |
| --- | --- |
| 公共 URL | `http://127.0.0.1:18080` |
| Postgres | `127.0.0.1:55442/wiseeff` |
| Redis | `127.0.0.1:56380` |
| MinIO | `127.0.0.1:59010` / bucket `wiseeff` |
| 镜像 | `wiseeff-app:t33b-19b987e5a` |
| Compose 项目 | `wiseeff-t33b-target` |
| 迁移 | API 容器内 **157 条**，到 `0159_plane_disposal_definer_select.sql` |

## 本轮

- 真实围栏：停止 `proxy`、`api`、`worker`、`publication-manager`；写容器已停、18080 关闭、Redis 队列排空、冻结键为 `1`。
- 独占解冻写入激活回执，成功/失败都重新冻结。P11–P16 仍不可用。
- 三存储 capture/verify/`restoreCheck`；Redis 回执变更后先前恢复点拒绝 restore。
- 非参数哨兵 `t33b_preservation.sentinel` 重启后仍在。
- 恢复后 `/health/live` 与 `/health/ready` 均为 **200**（`postRestart.ready: true`）。首次引入下 `dtsToolchain` 与 `catalogPublication` 仍为 `missing`（无专用 manager LOGIN；镜像 dtc 探针仍报 missing）。不是生产发布。
- 破坏性归档/重建：**不在计划内**。

| 命令 | 结果 |
| --- | --- |
| `npm run test:scripts -- ops/self-hosted/storage/t33bTargetRehearsal.integration.test.ts` | **1 通过** |
| `npx tsx scripts/wayfinder/rehearse-s2-target.ts`（仓库根） | **ok**，restore-authorized，哨兵保留，postRestart live+ready |
| `parameter-catalog-cutover.sh rehearse-s2-target`（`ops/self-hosted`） | **ok**，未打印密钥 |
| T3.3a `t33aDockerRehearsal` + `liveStorePorts`（Redis TYPE dump 修复后） | **4 通过** |

## 仍不是本项

带 T3.4a 封印 SHA 的远端/预发主机、Hosted、merge、生产发布、T2.3 破坏性 DROP。
