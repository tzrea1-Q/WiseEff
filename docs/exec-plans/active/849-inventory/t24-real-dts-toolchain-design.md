# T2.4 real DTS toolchain — implementable design

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t24-real-dts-toolchain-design.md)

Companion to the [threat matrix](t24-real-dts-toolchain-threat-matrix.md). Product questions already closed by T1.3 and the 2026-09-15 round-report withdrawal (do not commit a 29-label empty authoritative base) are not reopened.

Status: **design Spec PASS with P2 (grok-4.6 re-review).** Implementation local candidate: Standards PASS with P2, Spec PASS with P2. Receipt: [t24-real-dts-toolchain-acceptance.md](t24-real-dts-toolchain-acceptance.md).

## 1. What changes

Reuse the existing L2 runner (`createDtsToolchainRunner`: `dtc -@` → overlay DTBO → `fdtoverlay` → `dt-validate`) and the ephemeral stub owner (`danglingAnchorStub.ts`). Do not add a parallel compiler.

| Seam | File | Change |
| --- | --- | --- |
| Overlay compile wrap | `server/modules/parameter-files/dtsToolchain.ts` (overlay DTBO path) | **Tmp-only** wrap: a `/plugin/;` overlay whose body is a root `/ { … }` without `fragment`/`__overlay__` is rewritten in the isolated compile tree to an fdtoverlay-applicable fragment targeting `/` (`fragment@0` + `target-path = "/"` + `__overlay__`, or equivalent `&{/}` **only in tmp**). Committed charging-thermal bytes stay `/ { wiseeff_node_type_demo { charging_core { … } } }` so L1 locators stay `wiseeff_node_type_demo/charging_core/…`. Analogous to the entry dangling stub: never Git, never config-set, never writeback |
| Effective-tree compile | `scripts/compile-dts-seed.ts` | Load `board.dts` as entry and `charging-thermal.dts` as the sole overlay. JSON stays out. Record tool versions and `effectiveDtbSha256` |
| Persistence proof | dangling-stub / compile tests | Assert committed DTS never contains the ephemeral stub header; runner still stubs the **entry** only |
| Goldens | `goldenPowerFixture.test.ts`, `dtsPowerSeed.test.ts`, `seedM1DtsFiles.test.ts` | Align 176/528 locks with T1.3’s measured 200/600 if those tests run in the T2.4 gate |

No new ADR. No new SQL migration. No rewrite of T1.1 0151–0153. No change to T1.3 materialize/JSON/B6.

## 2. Final demo DTS set

Per project:

| Role | Path | Toolchain |
| --- | --- | --- |
| entry / base | `src/config/dts-seed/<project>-board.dts` | `dtc -I dts -O dtb -@` after ephemeral entry stub |
| overlay | `src/config/seed-sources/<project>/charging-thermal.dts` | `dtc -@` to DTBO, then `fdtoverlay` |
| not DTS | `src/config/seed-sources/<project>/power-config.json` | excluded |
| not the T2.4 board | `src/config/seed-sources/<project>/vendor-drivers.dts` | excluded (T1.3 board addend is `board.dts`) |

`compileDtsSeedEffectiveTrees` today passes `overlayOrder: []`, so `fdtoverlay` never runs a second file. T2.4 sets `overlayOrder: ["charging-thermal.dts"]` and includes that file in `files`.

## 3. Overlay application (production source defect)

Intake: with pinned `dtc` 1.8.1, committed `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }` compiles to a fragment-less DTB. `fdtoverlay` exits 0 and the effective hash equals board-only. Thermal nodes are absent.

Independent Spec FAIL of the first draft: committing `&{/}` makes `parseDts` throw `Expected label after &` (parser accepts `&` + ident only), so ingest drops the overlay. Committing `fragment@0` parses but locators become `fragment@0/__overlay__/wiseeff_node_type_demo/charging_core/…` (T24-07 regression). Neither committed rewrite satisfies T24-02 **and** T24-07/T24-10.

**Specified fix:** keep the committed overlay body as a root `/ { wiseeff_node_type_demo { charging_core { … } } }` (T1.3 locators). In the toolchain overlay DTBO step, wrap that body in the **tmp** compile input as:

```dts
/dts-v1/;
/plugin/;

/ {
	fragment@0 {
		target-path = "/";
		__overlay__ {
			wiseeff_node_type_demo { charging_core { /* unchanged property bytes */ } };
		};
	};
};
```

The wrap is a throwaway compile companion (same class as the entry dangling stub). Proof: tmp DTBO contains `__overlay__`; effective DTB decompile contains `fast-charge-profile-matrix` at `wiseeff_node_type_demo/charging_core`; SHA-256 ≠ board-only intake hash; committed charging-thermal still parses to the two T1.3 locators.

Do not retarget onto `&charging_core`. Do not persist `&{/}` or `fragment@0` as the Git source. Do not run `missingReferencedLabels` on the overlay file (comment `&charging_core` must not mint a stub node — T24-18).

Rejected: parser-wide `&{/}` support in this todo (extra ingest surface; not required once the compile wrap exists). Rejected: committed `fragment@0` (locator regression).

## 4. Ephemeral stubs stay ephemeral

L1: unresolved `&label` remains a `dangling-reference` warning and self-anchors. Not fail-closed.

L2: `withEphemeralEntryCompileStub` prepends empty-node labels so `dtc` can link overlay-only boards. The stub **MUST NOT** be written to Git, config-set membership, writeback, or export.

T2.4 “remove persistent dangling-anchor stubs” means: prove none are persisted, and do not add a committed 29-label empty base. Measured unique overlay targets stay **29**; missing `&name` refs stay **37**, unless a recorded source fix changes them.

Empty ephemeral `gpioN` nodes yield `#gpio-cells` **warnings**. Those are not production errors and are not fixed by committing SoC gpio-controller nodes. Optional gpio-controller text belongs only inside the ephemeral companion.

## 5. Source/subject ownership and demo labeling

Keep T1.3 reviewed `compatible` on board overlay fragments. Keep NodeType `charging_core` under `wiseeff_node_type_demo`. Keep demonstration headers on board and charging-thermal files.

Do not infer new Driver identities for `amba`, `spmi`, `gpioN`, `gic`.

## 6. Goldens

T1.3 added `compatible` to 24 overlay fragments. Manifest already records 200 raw properties / 80 structural / 600 across three boards. Tests that still lock **176** properties and **528** `dts_properties` rows are stale relative to that board. T2.4 updates them when they are in the gate. Do not revert the 24 reviewed compatibles to recover 176.

## 7. Authorization, tools, environment

- Tools: existing resolver + `npm run dts:toolchain:bootstrap` for pinned `dtschema` 2026.6. Do not invent a dtc-only runner.
- Seed effective-tree mode may keep `mode: "warn"` / `failOnSchema: false` (vendor bindings do not describe every child node). Overlay **application** still must change the DTB.
- Helper PostgreSQL is not required unless overlay syntax accidentally changes business locators; then re-run the T1.3 oracle on 55438 / disposable DB, never `wiseeff_lane_849` or compose `5432/wiseeff`.
- Local compile is not target qualification.

## 8. Evidence

Required before handoff:

- `npm run dts:toolchain:check -- --required` (dtc 1.8.1, fdtoverlay 1.8.1, dtschema 2026.6)
- `npm run dtc:seed:compile` with overlays; JSON output records three distinct effective hashes that are not the board-only intake hashes
- Tests: tmp overlay DTBO has overlay tokens; committed DTS has no stub header and no persisted `fragment@0`/`&{/}` wrap; ingest locators remain `wiseeff_node_type_demo/charging_core/…`; comment `&charging_core` does not mint a stub node
- Affected goldens if in gate
- `seed:reconcile:check` if DTS bytes change
- `git diff --check`
- Independent Standards + Spec implementation review
- Bilingual acceptance receipt

Not S1/S2, Hosted, or target.

## 9. Implementation order (after Spec PASS)

1. Tmp overlay-fragment wrap in the toolchain runner; prove fdtoverlay applies thermal nodes; committed overlay bytes and L1 locators unchanged.
2. Wire `compileDtsSeedEffectiveTrees` mixed membership (board + overlay).
3. Persistence / ownership tests.
4. Align goldens 200/600 if those tests run.
5. Independent implementation review; bilingual receipt; stop.

## PR Plan

This todo does not open a PR. The local candidate stays on `codex/849-853-t11-source-identity` with T1.1–T1.3 dirty work.

| Step | Title | Paths | Depends on |
| --- | --- | --- | --- |
| A | Tmp overlay-fragment wrap | `dtsToolchain.ts` + tests | Spec PASS |
| B | Effective-tree overlay wiring | `compile-dts-seed.ts` + tests | A |
| C | Persistence and ownership proofs | stub/compile tests | B |
| D | Goldens + bilingual receipts | golden tests, T2.4 acceptance | C |
