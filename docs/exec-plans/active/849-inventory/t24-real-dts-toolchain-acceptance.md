# T2.4 real DTS toolchain — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t24-real-dts-toolchain-acceptance.md)

Status: **T2.4 local candidate complete.** Independent design Spec FAIL then PASS with P2; implementation Standards PASS with P2 and Spec PASS with P2 (grok-4.6; requested gpt-5.6-luna unavailable). Formal SEALED, commit, PR, merge, Hosted, target and Issue updates are not performed.

Contract: [threat matrix](t24-real-dts-toolchain-threat-matrix.md), [design](t24-real-dts-toolchain-design.md), [design Spec review](t24-real-dts-toolchain-spec-review.md), [implementation review](t24-real-dts-toolchain-impl-review.md), #849/#853 T2.4.

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- Accepted main: `46b6068693942b95f7cba28ee5de6748a97170fa`
- T1.1–T1.3 remain uncommitted dirty work on the same tree. No commit.

## Behaviour delivered

1. Pinned real tools: `dtc` 1.8.1, `fdtoverlay` 1.8.1, `dtschema` 2026.6 (`npm run dts:toolchain:bootstrap` for the project venv).
2. `compileDtsSeedEffectiveTrees` loads `board.dts` as entry and `charging-thermal.dts` as the sole overlay. JSON and `vendor-drivers.dts` stay out.
3. dtc 1.8.1 emits no overlay fragments from committed `/plugin/; / { … }`. The runner wraps that body as tmp `fragment@0` / `target-path = "/"` / `__overlay__` on overlay members only. Git source is unchanged; L1 locators stay `wiseeff_node_type_demo/charging_core/…`.
4. Ephemeral dangling-anchor stubs still apply to the **entry** only. Overlay files are never the stubbed entry (comment `&charging_core` does not mint a stub). No committed stub header, no persisted 29-label empty base.
5. Effective DTB SHA-256 after overlay application (≠ board-only intake):
   - aurora `cacbf2c931f33ade9fba124b911f82908c2ce76756cd5a2dba1c740d063ee468` (board-only was `69b3fcdd…`)
   - nebula `aaaeea4b5ebff841a6df50e0e8344fcfed5806d8adac4cfc99b54c16f0207c82` (board-only was `c9b09708…`)
   - atlas `a0deb6cb64dd5d9b062bce02568c190a2b6ff599eed1ad13e813bd6602b72f59` (board-only was `e78751d4…`)
6. Production source defect: generator `/bits/ 8` hex bump now masks to the declared width so nebula `rx_mod_cm_cfg` stays `0xfa` instead of `0xfffffffa`. Empty-stub `#gpio-cells` warnings remain warnings, not persisted SoC nodes.
7. Goldens aligned to T1.3 board `compatible` additions: 200 properties / 600 `dts_properties` rows. Demo headers unchanged.

## Verification (do not sum)

Helper PG for tests: `TEST_DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t13_successor`. Not `wiseeff_lane_849`, not compose `5432/wiseeff`.

| Command | Result |
| --- | --- |
| `dts:toolchain:check -- --required` | dtc 1.8.1, fdtoverlay 1.8.1, dtschema 2026.6, versionsMatch true |
| `dtc:seed:compile` | ok; three distinct effective hashes above |
| T2.4 core `test:server` (dtsToolchain, goldenPowerFixture, dtsPowerSeed, seedM1DtsFiles, seedM1DtsIntegrity, danglingAnchorStub, dtc-toolchain) | 7 files, **48 passed** |
| `seedSources.fidelity` | **18/18 passed** |
| `seed:reconcile:check` | current |
| `git diff --check` | passed |
| `docs:check` | passed |
| `npm run build` | passed |

Not a full `test:server` suite. Not S1/S2, Hosted, or target. Local compile is not target qualification. T1.3 124/372 was not re-run: committed charging-thermal bytes and locators are unchanged.

## Remaining limits (implementation review P2)

- `compileDtsSeedEffectiveTrees` overlay membership is proven by `dtc:seed:compile`, not a dedicated unit test on that function. Tests lock the **source** wrap (`fragment@0` in tmp text), not a decompiled DTBO token.
- `/bits/` mask applies to hex cells; decimal `/bits/ 8` still uses signed `(-n)` as in committed nebula.
- Empty-stub `#gpio-cells` / default `#address-cells` warnings remain.

No commit/PR/seal.
