# T2.4 real DTS toolchain — pre-implementation threat matrix

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t24-real-dts-toolchain-threat-matrix.md)

Contract: #849, #853 T2.4, [ADR-0046](../../../adr/0046-source-occurrence-identity-spans-dts-and-software-configuration.md), T1.3 [design](t13-complete-successor-design.md) / [acceptance](t13-complete-successor-acceptance.md). Product direction (real `dtc` + `fdtoverlay` on the final demo baselines, no persistent dangling-anchor stubs, demo labeling, source/subject ownership, fix production source defects before later UI/target) is already decided. This matrix freezes the remaining implementation boundary.

Status: **revised after Spec FAIL (P1).** Companion: [implementable design](t24-real-dts-toolchain-design.md). Awaiting independent re-review. No production edits, commit, PR, or seal in this design pass.

## Lane and boundaries

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`, branch `codex/849-853-t11-source-identity`.
- Inherited HEAD `f9c710f6a90d67462965a06abd47e33aa200e75e`; accepted main `46b6068693942b95f7cba28ee5de6748a97170fa`. T1.1–T1.3 remain uncommitted dirty candidates and are not rewritten.
- Risk **R3**. Independent Spec review of this matrix and the design precedes production edits. Independent Standards and Spec review of the resulting candidate follows local green.
- Stop after T2.4 local delivery. No T2.1 UI, T2.2 consumers, commit, PR, merge, Hosted, target, or Issue mutation.
- Requested independent-review model `gpt-5.6-luna` / `max` is unavailable; reviewers use `grok-4.6` and must disclose that substitution.

## Invariant under protection

Every final demo DTS baseline for Atlas/Aurora/Nebula compiles with pinned real `dtc` 1.8.1 and `fdtoverlay` 1.8.1. `charging-thermal.dts` is applied as a real overlay, not string-concatenated and not a no-op DTBO. Ephemeral dangling-anchor stubs remain compile companions only: they are never Git members, config-set members, writeback, or export. Overlay fragments keep T1.3 reviewed source/subject ownership. Unresolved `&label` targets stay measured and mint no bindings. Demo headers stay. Production source defects that make overlay application or compile fail are fixed. T1.3 Binding identity **124×3=372** is unchanged.

## Intake (measured, 2026-09-17)

Pinned tools after `npm run dts:toolchain:bootstrap`: `dtc` 1.8.1, `fdtoverlay` 1.8.1, `dtschema` 2026.6. `npm run dtc:seed:compile` on **board-only** files is `ok: true` with ephemeral stubs and **empty** `overlayOrder`. Effective board-only DTB SHA-256: aurora `69b3fcdd…`, nebula `c9b09708…`, atlas `e78751d4…`.

Atlas board: **29** unique overlay `&label` targets (30 fragments, `amba` twice), **37** missing `&name` refs, one defined label (`batt`). Matches manifest `danglingOverlayTargetsPerBoard: 29` / `missingReferencedLabelsPerBoard: 37`. No committed file contains the ephemeral stub header.

`charging-thermal.dts` is `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }`. Compiling that with `dtc -@` yields a 324-byte regular DTB with **no** `__overlay__` / `fragment` / `target-path`. `fdtoverlay` exits 0 and leaves the effective hash **identical** to board-only (`e78751d4…` for atlas). A **tmp** wrap as `fragment@0` / `target-path = "/"` produces `__overlay__` and a new hash (`a0deb6cb…`) whose decompile contains `fast-charge-profile-matrix`. Committing `&{/}` is not allowed: `parseDts` throws `Expected label after &`. Committing `fragment@0` regresses locators. The no-op is a **toolchain overlay-compile defect**, not a committed-syntax rewrite.

Empty ephemeral `gpioN` nodes produce `dtc` **warnings** (`#gpio-cells`), not errors. `danglingAnchorStub.ts` already disclaims phandle-cell shapes.

## Rows

| ID | Dimension | Expected observation | Evidence owner |
| --- | --- | --- | --- |
| T24-01 | Real tools | Pinned `dtc` 1.8.1 and `fdtoverlay` 1.8.1 compile every final demo DTS baseline. `dts:toolchain:check -- --required` is current. No stubbed validator as T2.4 evidence | `dts:toolchain:check`, `dtc:seed:compile` |
| T24-02 | Overlay application | Per project, entry is `board.dts`, `overlayOrder` is `[charging-thermal.dts]`, JSON is absent. Effective DTB SHA-256 ≠ board-only hash. Decompile contains `wiseeff_node_type_demo` / `fast-charge-profile-matrix` / `battery-thermal-derate-curve` | `compileDtsSeedEffectiveTrees` |
| T24-03 | Overlay compile wrap | Committed charging-thermal **keeps** `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }` (T1.3 locators). The toolchain overlay DTBO step wraps that body in tmp as `fragment@0` / `target-path = "/"` / `__overlay__`. Committed `&{/}` or `fragment@0` is forbidden here (`parseDts` rejects `&{/}`; `fragment@0` regresses locators). Tmp DTBO has overlay tokens; Git source does not | runner wrap + parser locators + DTBO token check |
| T24-04 | Ephemeral only | `EPHEMERAL toolchain stub` / synthesized `label: label { };` companions never appear in `src/config/**/*.dts`, config-set members, writeback, or export. Runner still prepends the stub to the **entry** only | grep + `danglingAnchorStub` / toolchain tests |
| T24-05 | No fabricated base | T2.4 does **not** commit a 29-label empty authoritative base. Round-report withdrawal stands. SoC gpio/bus scaffolding is not promoted to business identity | diff review |
| T24-06 | Dangling honesty | Unique overlay targets stay **29**, missing `&name` refs stay **37** per board unless a measured source fix changes them; the new count is recorded. They mint no canonical bindings | manifest + existing 124 oracle |
| T24-07 | Source/subject ownership | Board overlay fragments keep T1.3 reviewed compatibles. NodeType `charging_core` stays nested under `wiseeff_node_type_demo`, distinct from `&charging_core` / `huawei,charging_core`. Locators for the two thermal properties do not regress | seed fidelity + overlay decompile |
| T24-08 | Demo labeling | Board and charging-thermal headers remain demonstration sources, not real-device firmware | source headers |
| T24-09 | JSON out of dtc | `power-config.json` is not a dtc/fdtoverlay input | compile seed loader |
| T24-10 | Binding conservation | T1.3 124/372 is unchanged. Overlay syntax repair must not retarget thermal nodes onto the board driver | t13 oracle only if DTS business bytes change |
| T24-11 | Artifact evidence | Receipt records exact tool versions, per-project `effectiveDtbSha256`, and that overlay application changed the hash | `dtc:seed:compile` JSON |
| T24-12 | Warning vs defect | Empty-stub `#gpio-cells` / default `#address-cells` warnings are not persisted SoC nodes. Optional ephemeral gpio-controller enrichment stays ephemeral. `dtc` **errors** in committed bytes are defects and are fixed | compile diagnostics |
| T24-13 | Goldens | T1.3 added 24 board `compatible` properties (176→200 / 528→600). T2.4 updates locked goldens that still assert 176/528 when those tests are in the gate | `goldenPowerFixture`, `dtsPowerSeed`, `seedM1DtsFiles` |
| T24-14 | Local ≠ target | Local compile is not target-host qualification, Hosted, or `wiseeff_lane_849` | receipt |
| T24-15 | L1 unchanged | Unresolved `&label` remains an L1 `dangling-reference` **warning** (self-anchor). T2.4 does not fail-close ordinary ingest on those warnings | `configSetResolver` tests kept |
| T24-16 | Board baseline | T2.4 board input is `src/config/dts-seed/<project>-board.dts`, not generated `vendor-drivers.dts` | compile loader |
| T24-17 | Existing runner | Use `createDtsToolchainRunner` (dtc → DTBO → fdtoverlay → dt-validate). Bootstrap `dtschema` 2026.6 rather than a parallel dtc-only path. Seed effective-tree mode may keep schema advisory (`failOnSchema: false`) | runner + bootstrap |
| T24-18 | Comment refs | Documentation `&charging_core` in charging-thermal comments must not mint an overlay stub node. The overlay file is never the stubbed entry; `missingReferencedLabels` is not run on overlay members | overlay is never the stubbed entry |

## Non-goals

- T2.1 UI, T2.2 consumers, T2.3 disposal, T3.x S1/S2/Hosted/target.
- Making L1 ingest fail-closed on dangling overlay targets.
- Persisting ephemeral stubs as config-set members.
- TD-124 YAML/TOML/ENV.
- New SQL migration or 0151 rewrite.
- Commit, PR, merge, Hosted, target, Issue mutation.

## Self-review limit

This matrix was written by the coordinating implementer. Independent Spec review is required before production edits; this file is not that review.
