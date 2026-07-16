# HDC Device Lab Runbook

> Chinese: [Chinese](../zh-CN/runbooks/hdc-device-lab.md)

Use this runbook to collect local real-device evidence for the HDC debugging gateway path. This procedure is explicit lab evidence, not a default CI gate.

## Minimal Write/Restore Environment

The HDC lab auto-configures when exactly one HDC target is connected. It creates or updates a lab-only WiseEff device inventory row and a lab-only temporary-file parameter binding that points at `/data/local/tmp/wiseeff_hdc_smoke_node` by default. During setup, same-project non-lab HDC bindings are disabled so the frontend auto-read loop cannot touch simulator or customer-like nodes on real hardware.

```bash
DEBUG_DEVICE_GATEWAY_MODE=hdc \
HDC_DEVICE_LAB_AVAILABLE=true \
HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write \
HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback \
npm run acceptance:e2e -- e2e/acceptance/hdc-device-lab.acceptance.spec.ts
```

`HDC_SMOKE_PROJECT_ID` defaults to `aurora`. It is the operation context for permissions, session records, node operations, audit, and evidence.

The lab discovers or prepares:

- `targetRef` from `hdc list targets`, requiring exactly one target.
- `deviceId` as the lab-only WiseEff inventory row `hdc-device-lab-aurora`.
- `parameterId` as the lab-only parameter `hdc-smoke-temp-node`.
- `nodePath` as `/data/local/tmp/wiseeff_hdc_smoke_node` unless overridden.
- original and write values as safe lab strings unless overridden.

Optional validation overrides:

- `HDC_SMOKE_PROJECT_ID`
- `HDC_SMOKE_DEVICE_ID`
- `HDC_SMOKE_TARGET_REF`
- `HDC_SMOKE_PARAMETER_ID`
- `HDC_SMOKE_NODE_PATH`
- `HDC_SMOKE_ORIGINAL_VALUE`
- `HDC_SMOKE_WRITE_VALUE`
- `HDC_SMOKE_EXPECT_READ_PATTERN`
- `HDC_SMOKE_USER_ID`

When device, target, parameter, or node overrides are set, they must match the auto-discovered lab config. The lab fails before writing hardware if any override differs.

## Required Write Confirmations

The HDC lab intentionally exercises the governed write/readback/snapshot-rollback path. These confirmations are always required:

- `HDC_SMOKE_CONFIRM_WRITE=confirm-high-risk-write`
- `HDC_SMOKE_CONFIRM_ROLLBACK=confirm-rollback`

Do not point `HDC_SMOKE_NODE_PATH` at customer or production nodes. The default temporary file node is the approved local lab target.

## Procedure

1. Confirm the HDC device is connected to the same machine that runs the WiseEff API.
2. Run `hdc list targets` and confirm exactly one target is present.
3. Confirm the default temporary node is acceptable for read/write/rollback evidence.
4. Start the API with `DEBUG_DEVICE_GATEWAY_MODE=hdc`.
5. Start the frontend in API mode.
6. Export the same HDC lab variables in the shell that runs Playwright; otherwise the spec will skip even if the API was started correctly.
7. Run the command from the minimal environment section.

## Acceptance

Generated operation evidence is intentionally compact and redacted; it should show shape, presence, status, and equality proof rather than publishing raw identifiers or values.

Evidence must show:

- successful `/node-debugging` HDC target detection through the frontend,
- successful read of the lab-only temporary node,
- successful UI write with readback,
- snapshot presence from the governed write path,
- audit events for target detect, session create, node read, node write, and snapshot rollback,
- rollback result and final restoration equality,
- browser screenshot, `test-results/acceptance-operation-evidence/...json`, and `playwright-report/acceptance/index.html` locations.

## Safety Notes

- Do not run this lab against customer hardware or unapproved nodes.
- Do not directly write nodes with `hdc shell`; the test must use WiseEff APIs so lease, snapshot, readback, rollback, and audit rules apply.
- Treat non-lab HDC bindings disabled by this lab as temporary local evidence setup. Restore or reseed local data only when you intentionally leave the HDC lab context.
- Missing, duplicate, or unreachable HDC targets block the run.
- Simulator and fake-runner evidence remain useful for development, but they do not replace real HDC device-lab signoff.
