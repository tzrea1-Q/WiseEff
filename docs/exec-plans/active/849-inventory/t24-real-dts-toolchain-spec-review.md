# T2.4 design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t24-real-dts-toolchain-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna / max unavailable)
Verdict: **PASS with P2**

Independent re-review after the prior FAIL (P1 overlay syntax vs T1.3 parser/locators). Chinese twins spot-checked for decision parity. `parser.ts` still accepts `&` + ident only. Pinned `dtc`/`fdtoverlay` 1.8.1 re-checked. No production edits; T2.4 is not marked complete. Prior P1 is **closed**. Implementation may start; fold the P2s below with the first commits.

## P1

None open.

## P2

1. **T24-18 evidence owner vs tests.** Design §3/§8 forbid running `missingReferencedLabels` on the overlay and require a test that comment `&charging_core` does not mint a stub. Matrix T24-18 still names evidence “overlay compile of the overlay file alone”. Independent check: `missingReferencedLabels` on atlas `charging-thermal.dts` returns `charging_core` from the comment. Compiling that file as a stubbed **entry** would mint a stub. Point T24-18 at “overlay is never the stubbed entry”, matching §8.

2. **Goldens 176/528.** Unchanged: T24-13 / design §6 update T1.3 leftover 176/528 locks if those tests are in the gate. Todolist T2.4 does not ask for golden identity. Gate-unblock only; not a 124/372 change.

These do not reopen identity, 124/372, or B6.

## Closed prior P1 (do not re-open)

Committed `&{/}` broke `parseDts` (`Expected label after &`); committed `fragment@0` regressed locators to `fragment@0/__overlay__/wiseeff_node_type_demo/charging_core/…`. Revision keeps Git source as `/plugin/; / { wiseeff_node_type_demo { charging_core { … } } }` and wraps `fragment@0` / `target-path = "/"` / `__overlay__` only in the toolchain tmp overlay DTBO input (same class as the ephemeral entry stub). Independent wrap: atlas effective SHA-256 `a0deb6cb…` ≠ board-only `e78751d4…`; decompile contains `fast-charge-profile-matrix` under `wiseeff_node_type_demo/charging_core`. Parser never sees tmp. T24-03 forbids persisting either rewrite.

## Checked and accepted

- Board-only `overlayOrder: []`; 29 unique fragments (`amba` twice), 37 missing `&name`, defined `batt`; no committed stub header.
- Round-report withdrawal: no 29-label empty base.
- Demo headers, NodeType nesting, JSON excluded, `vendor-drivers.dts` not the T2.4 board, L1 not fail-closed on dangling warnings, local ≠ target.
- Chinese twins match (tmp wrap, committed `/ { }` kept, `&{/}`/`fragment@0` not Git, T24-18: do not stub overlay). They share these P2s.

Start implementation against design §3 wrap in `dtsToolchain.ts` overlay DTBO path and §8 locator/stub proofs. Align T24-18’s evidence owner with that test.
