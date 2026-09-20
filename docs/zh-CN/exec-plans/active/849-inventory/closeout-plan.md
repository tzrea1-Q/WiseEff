# 收口计划 — leftover、T3.2、T2.3b、T3.4a/T3.5

> English: [English](../../../exec-plans/active/849-inventory/closeout-plan.md)

基线：`origin/main` **`3d5e3b1348a02973545be353d83fc3fdb390d8d2`**。分支：`codex/849-853-closeout`。Helper PG **55438**。不用 `5432/wiseeff`，不是生产，不靠 Hosted 额度，不 DROP 后继表。

| ID | 项 | 本机通过 | 停止条件 |
| --- | --- | --- | --- |
| C1 | **T1.4 leftover 55** | checker `unallowlisted: 0` 且 `staleAllowances: 0`。不弱化 checker | 不弱化就到不了 0 |
| C2 | **T3.2 local-non-HDC** | 本 SHA 上 Gate0 / `acceptance:browser --mode local-non-hdc`，独占端口，helper PG | 环境缺失 |
| C3 | **T3.2 target-synthetic** | 对本机 Docker 目标（`:18080`）跑 `acceptance:browser --mode target-non-hdc --no-start-runtime` | 目标未起 |
| C4 | **T2.3b `disposeProjectParameterPlaneResidue`** | 在 helper PG 55438 对已捕获的 Atlas/Aurora/Nebula 平面执行残留 DELETE（不是 DROP）。记录命令、archive id、残留计数、replay 空操作 | 无 archive / 鉴权拒绝 |
| C5 | **T3.4a full SEAL** | 把 S1/S2/浏览器/处置证据绑到本 SHA；grok-4.6 Standards+Spec PASS；seed/release fixture 评审。**C1–C3 失败或 minimal-upgrade 仍无 amd64 通过则不能 SEAL** | 仍缺 amd64 升级 |
| C6 | **T3.5 先关 #853 再关 #849** | 仅在 C5 之后。docs/diff、故事／决策对账，然后关 Issue | C5 未 SEAL |

`minimal-upgrade` 不在本计划（要 linux/x86_64）。若它是 T3.2 唯一缺口，C5/C6 保持打开，PR 里写明。

C1–C4 有本机证据后开 PR（C5/C6 仅在真正封印后）。

## 进展

| ID | 状态 |
| --- | --- |
| C1 | **未清零。** 上次完整计数 **55** / stale **0**。当前树 CLI 因 dest-blob（`parameter-topology.acceptance.spec.ts`，Gate0 需要的 Catalog 404 allowlist）拒绝，不能 dest-rebind。T1.4 不勾。未弱化 checker。 |
| C2 | **通过。** `bc16fc633` / helper PG **55438** / run `full-20260920t095422270z-bc16fc6334ff-65e3c7fe`。视觉 **20**。Playwright **174 通过 / 32 跳过**。覆盖与操作证据 **通过**。库存 **0**。runtime 已清理。 |
| C3 | **不是本 SHA 证据。** 本机 T3.3b `:18080` 在线（HTTP 200），镜像 `wiseeff-app:t33b-19b987e5a`，不是本 closeout HEAD。未对错版本目标跑 174 条。先前 target-synthetic 仍是 `d520964e4`。 |
| C4 | `dispose.integration.test.ts` **6 通过**。CLI 对 M1 种子捕获缺表。无 DROP。 |
| C5 | **未 SEAL。** leftover 55、C3 非当前 SHA、minimal-upgrade 仍只要 amd64。 |
| C6 | **未开始。** Issue 保持打开。 |
