# T3.4a 冻结与独立评审 — 封印记录

> English: [English](../../../exec-plans/active/849-inventory/t34a-seal.md)

状态：**有条件 — 不是完整 SEALED。** 操作员接受 A+C：本机继续推进；**minimal-upgrade** 记为环境例外（`linux/aarch64` vs `linux/x86_64`）。独立评审仍为 **grok-4.6**。T3.4a 作为完整封印 **仍未勾**。T2.3b DROP 仍未授权。

第 4 轮候选 HEAD `d12bc808c9de2903b143ebfada4ccd9ec67eec23`：`tsc -b` **通过**，`npm run build` **通过**，T3.3a+T3.3b+liveStorePorts **5 通过**。grok-4.6 Standards **PASS**（P0=0 P1=0 P2=1）。Spec **FAIL**（T3.1/T3.2 仍开；Gate0/`test:server` 不在此 SHA；target-synthetic/minimal-upgrade 不是通过）。T3.3b 是已授权本机自托管目标，不能单独封印 T3.4a。

## 候选身份

| 字段 | 值 |
| --- | --- |
| 实现冻结（typecheck 修复前） | `dc660481fe76656990520dbd503d693207373d09` |
| 当前 HEAD / Gate0 SHA | `3dc5c94119c10061de92e90a4f99c8a36b7089d0` |
| Base / 已接受 main | `46b6068693942b95f7cba28ee5de6748a97170fa` |
| 分支 | `codex/849-853-t11-source-identity` |
| Helper PG | **55438**。不是 `wiseeff_lane_849`。不是 5432/`wiseeff`。 |
| `S2_SCH_CONTRACT_FINGERPRINT` | `7bc944915eabc1689a9976332864bae3bc602fd9c407e91ed826340dbe0f69e1` |

`3dc5c9411` = `dc660481f` 加上只读 identity pin 的 typecheck 修复。

## 独立评审（grok-4.6）

第 1–2 轮 Standards FAIL P1（操作员 JSON / 内存 stub）。第 3 轮 Standards（`f2c7ef968`，grok-4.6）：**PASS**。隔离 Docker postgres/redis/MinIO；仅在设置 `WISEEFF_REDIS_URL` 与 `OBJECT_STORAGE_*` 时 `threeStoreRecoveryPoint: true`。

第 4 轮 Spec（`d12bc808c`，grok-4.6）：**FAIL**。T3.3b「无目标」已由本机自托管实例关闭，仍不能单 SHA 封印。处置：**未 SEALED**。

本机隔离 Docker 三存储（不是 5432/`wiseeff`，不是 `wiseeff_lane_849`）：

```bash
docker compose -p wiseeff-t34a-stores -f ops/self-hosted/compose.t34a-stores.yaml up -d
```

端口：postgres `127.0.0.1:55441/wiseeff_t34a`，redis `127.0.0.1:56379`，MinIO `127.0.0.1:59000`。`liveStorePorts.integration.test.ts` 已对三存储做 `captureRecoveryPoint`（**1 通过**）。`upgrade.sh` 在设置 `WISEEFF_REDIS_URL` 与 `OBJECT_STORAGE_*` 时走这套活端口；否则仍报告 `threeStoreRecoveryPoint: false`。

## 绑在 `3dc5c9411` 上的证据

Gate0 **通过**（`full-20260919t063253898z-3dc5c94119c1-ddcd3c3d`）：visual/browser/operation-evidence/清理。quality/coverage/operations/`tsc -b`/`build` 通过。target-synthetic、minimal-upgrade **不是通过**。随后在 `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f` 上完成本机自托管 T3.3b（见 [t33b-remaining-verification.md](t33b-remaining-verification.md)），**不**因此重新 SEAL。T3.1 全量 `test:server` 未在封印 SHA 上重跑。

## 目标 / 恢复计划

已授权本机目标：[t33b-target-plan.md](t33b-target-plan.md) / [t33b-remaining-verification.md](t33b-remaining-verification.md)。整套恢复（应用 + PostgreSQL + 对象存储 + Redis）。不是生产，也不是 T3.4a 封印后的远端主机。

T3.4a 保持开放，**未 SEALED**。未启动 T3.4b。
