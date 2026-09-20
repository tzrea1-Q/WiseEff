# #884 合入后的本机 Docker 轮次

> English: [English](../../../exec-plans/active/849-inventory/local-docker-round.md)

基线：`origin/main` **`fbb17717ad05f521da8651ed6dcf1ba08e502819`**（#884 squash）。分支：`codex/849-853-local-docker-round`。Helper PG **55438**（`wiseeff-g668-pg`）。不用 `5432/wiseeff`，不用 `wiseeff_lane_849`，不是生产，不 DROP 后继表，不关 #849/#853。

## 本轮要做

| ID | 项 | 完成标准 |
| --- | --- | --- |
| L0 | 从已合入 main 建分支 | 本文件在 `codex/849-853-local-docker-round` |
| L1 | T3.4b 回执 | [t34b-integration.md](t34b-integration.md) 记下 merge SHA、Hosted、skipped |
| L2 | TD-125 种子 writer | **helper `wiseeff_quality_snap` 已完成：** `ensureCanonicalCatalogAfterLegacySeed` 为 atlas/aurora/nebula 各写 **120** 条 catalog 绑定（合计 360）；catalog `crel_vendor_catalog_1`。拓扑平面保留（436 条 legacy）。缺 placement 时 `materializeSeedSources` 仍 fail-closed。 |
| L3 | 空 Catalog GET | **已恢复 canonical-only。** 路由测试 **20 通过**。空 Catalog 为 `{ items: [] }`。种子 writer 每个演示项目 120 条 catalog 行。Hosted linux `/parameters` 外观可能漂（驱动组树 vs 拓扑快照）。 |
| L4 | T1.4 leftover | **本 SHA 实测：** `check-parameter-catalog-boundaries.test.ts` **24 通过**。库存仍是 `3558 / 3503 / 55 / 0`。T1.4 不勾。 |
| L5 | T3.2 本机 Docker | T3.3b `:18080` **200**。独占 `:5174`/`:18787` + helper `wiseeff_quality_snap` smoke **4 通过**（warmup、auth、parameter-home、shell）。 |
| L6 | 独立评审 | grok-4.6 Standards **FAIL**（新 writer 无测试，已补）。Spec **FAIL**（先 sync 再预检，已改全项目预检）。本 commit 未复评。 |

## 本轮不做

- T3.2 **minimal-upgrade**（本机 aarch64，契约要 amd64）
- T2.3b DROP
- 远端／生产目标
- T3.4a full SEAL
- T3.5 关 Issue
- 除非 L3 去掉 fallback 且画面漂了，才重录 Hosted linux 快照

## 停止边界

禁止 5432/`wiseeff`。不弱化 parameter-catalog 边界 checker。overlay／governance **详情**保持 2xx。
