# #884 合入后的本机 Docker 轮次

> English: [English](../../../exec-plans/active/849-inventory/local-docker-round.md)

基线：`origin/main` **`fbb17717ad05f521da8651ed6dcf1ba08e502819`**（#884 squash）。分支：`codex/849-853-local-docker-round`。Helper PG **55438**（`wiseeff-g668-pg`）。不用 `5432/wiseeff`，不用 `wiseeff_lane_849`，不是生产，不 DROP 后继表，不关 #849/#853。

## 本轮要做

| ID | 项 | 完成标准 |
| --- | --- | --- |
| L0 | 从已合入 main 建分支 | 本文件在 `codex/849-853-local-docker-round` |
| L1 | T3.4b 回执 | [t34b-integration.md](t34b-integration.md) 记下 merge SHA、Hosted、skipped |
| L2 | TD-125 种子 writer | 质量／开发种子在 helper PG 写出 catalog 当前绑定；`csub_drv_sc8562` 有 placement；缺容量仍 fail-closed |
| L3 | 空 Catalog GET | L2 证明 catalog 行非 0 之前保留 topology fallback；之后改回 canonical-only 并更新路由测试 |
| L4 | T1.4 leftover | 在本 SHA 实测；dest 漂移则 dest-rebind；**清零前不勾 T1.4** |
| L5 | T3.2 本机 Docker | 独占端口 smoke + helper PG；compose 可用则 target-synthetic 或 T3.3a stores 彩排 |
| L6 | 独立评审 | grok-4.6 对本轮产品 diff 做 Standards + Spec |

## 本轮不做

- T3.2 **minimal-upgrade**（本机 aarch64，契约要 amd64）
- T2.3b DROP
- 远端／生产目标
- T3.4a full SEAL
- T3.5 关 Issue
- 除非 L3 去掉 fallback 且画面漂了，才重录 Hosted linux 快照

## 停止边界

禁止 5432/`wiseeff`。不弱化 parameter-catalog 边界 checker。overlay／governance **详情**保持 2xx。
