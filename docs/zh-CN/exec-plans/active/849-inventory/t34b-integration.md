# T3.4b 集成回执

> English: [English](../../../exec-plans/active/849-inventory/t34b-integration.md)

状态：**条件 Scratch 已在 `main`。T3.4a 仍非 full SEAL。不要关 #849/#853。**

## PR #884

| 字段 | 值 |
| --- | --- |
| PR | https://github.com/tzrea1-Q/WiseEff/pull/884 |
| 合入 | 2026-09-20T02:15:43Z squash 进 `main` |
| Merge SHA | `fbb17717ad05f521da8651ed6dcf1ba08e502819` |
| Hosted | `35481683792` Merge bar SUCCESS / `CLEAN` |
| 跳过 | local-non-HDC、target-synthetic、minimal-upgrade |

## PR #885

| 字段 | 值 |
| --- | --- |
| PR | https://github.com/tzrea1-Q/WiseEff/pull/885 |
| 合入 | 2026-09-20T05:13:41Z squash `--admin` 进 `main` |
| Merge SHA | `be052265588bd9da0602c099bd82cae0ad02b1c5` |
| Hosted | `35489948533` |
| 已跑 | L1 四项、quality、smoke — SUCCESS |
| 未启动 | Build and test、Merge bar — Actions 额度耗尽 |

`be0522655` 本机复测（helper PG **55438**，不是 `5432/wiseeff`）：

- 边界检查 **24 通过**，leftover 仍 **55**
- `dispose.integration.test.ts` **6 通过**（残留处置，不是 DROP）

不封 T3.4a，不清 leftover，不授权 DROP 后继表。
