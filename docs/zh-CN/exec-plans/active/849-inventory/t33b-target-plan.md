# T3.3b 目标计划 — 已授权的本机自托管实例

> English: [English](../../../exec-plans/active/849-inventory/t33b-target-plan.md)

状态：**已授权的本机目标计划。** 不是生产。不是 Hosted。T3.4a 仍 **未 SEALED**；本轮绑定 HEAD `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f`，SHA 变动后须重新绑定。破坏性 T2.3 DROP **不在**本计划内。

## 授权

操作员指定一套**本机自托管实例**作为 T3.3b 目标，并授权在该实例上做目标彩排。这不是远端机房证据，也不是生产发布。

## 实例身份

| 钉 | 值 |
| --- | --- |
| 候选 SHA | `19b987e5ab5aeb0f51ad5f86a8a9c3d310ea2c5f` |
| Compose 项目 | `wiseeff-t33b-target` |
| 公共 URL | `http://127.0.0.1:18080` |
| API（经代理） | `http://127.0.0.1:18080/api/` |
| Postgres | `127.0.0.1:55442/wiseeff`（不是 `5432/wiseeff`） |
| Redis | `127.0.0.1:56380` |
| MinIO | `127.0.0.1:59010` bucket `wiseeff` |
| 镜像标签 | `wiseeff-app:t33b-19b987e5a` |
| Overlay | `compose.yaml` + `ops/self-hosted/compose.t33b-target.yaml` |
| Postgres 镜像 | `pgvector/pgvector:pg16`（Catalog 扩展；库存 compose 是 `postgres:16-alpine`） |

禁止：根 compose `127.0.0.1:5432/wiseeff`、`wiseeff_lane_849`、T3.3a 栈 `55441/56379/59000`。

## 计划内

1. 按上表拉起 api、worker、web、proxy、postgres、redis、minio、publication-manager。
2. 写入非参数哨兵（`t33b_preservation.sentinel`）。
3. 真实围栏：`docker compose stop proxy api worker publication-manager`；观察写容器已停、代理端口 18080 关闭、Redis 队列排空、冻结键已设。
4. 三存储 capture/verify/`restoreCheck`。Redis 回执变更后，先前恢复点必须拒绝 restore。
5. 独占解冻并写激活回执；成功/失败都重新冻结。编排器上 P11–P16 仍不可用。
6. 恢复服务；`/health/live` 必须通过；哨兵必须仍在。

## 计划外

- T2.3 破坏性 DROP 在线后继表或离线归档处置。
- 生产 `publication_enabled=true`。
- 把 Catalog apply / P11–P16 当成静默默认激活。
- Hosted、merge、push、Issue 关闭。

首次引入的 publication-manager LOGIN 故意不设；不声称经由专用 manager DSN 的 catalog freeze。操作冻结是 Redis 冻结键，外加已停止的 manager/api 写路径。

## 执行结果

见 [t33b-remaining-verification.md](t33b-remaining-verification.md)。本 SHA 上本机目标探针已通过。未执行破坏性 DROP。
