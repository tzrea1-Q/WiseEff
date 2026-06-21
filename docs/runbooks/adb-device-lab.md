# ADB Device Lab Runbook

> Chinese: [Chinese](../zh-CN/runbooks/adb-device-lab.md)

Use this runbook to collect local real-device evidence for the ADB debugging gateway path. This procedure is explicit lab evidence, not a default CI gate.

## Required Read-Only Inputs

- `DEBUG_DEVICE_GATEWAY_MODE=adb`
- `ADB_DEVICE_LAB_AVAILABLE=true`
- `ADB_SMOKE_PROJECT_ID`
- `ADB_SMOKE_DEVICE_ID`
- `ADB_SMOKE_TARGET_REF`
- `ADB_SMOKE_PARAMETER_ID`
- `ADB_SMOKE_NODE_PATH`
- optional `ADB_SMOKE_EXPECT_READ_PATTERN`
- optional `ADB_SMOKE_USER_ID`

## Optional Write Inputs

Write mode is disabled unless `ADB_SMOKE_ENABLE_WRITE=true`.

- `ADB_SMOKE_ENABLE_WRITE=true`
- `ADB_SMOKE_WRITE_VALUE`
- optional `ADB_SMOKE_CONFIRM_WRITE`, default `confirm-high-risk-write`
- optional `ADB_SMOKE_CONFIRM_ROLLBACK`, default `confirm-rollback`

## Procedure

1. Confirm the ADB device is connected to the same machine that runs the WiseEff API.
2. Run `adb devices` and confirm `ADB_SMOKE_TARGET_REF` is present with state `device`.
3. Confirm `ADB_SMOKE_PARAMETER_ID` and `ADB_SMOKE_NODE_PATH` already map to an existing enabled ADB parameter binding.
4. Confirm the chosen node is safe to read.
5. If write mode is enabled, confirm the node is safe to write and that rollback by snapshot is acceptable.
6. Start the API with `DEBUG_DEVICE_GATEWAY_MODE=adb`.
7. Start the frontend in API mode.
8. Export the same ADB lab variables in the shell that runs Playwright; otherwise the spec will skip even if the API was started correctly.
9. Run:

```bash
DEBUG_DEVICE_GATEWAY_MODE=adb \
ADB_DEVICE_LAB_AVAILABLE=true \
npm run acceptance:e2e -- e2e/acceptance/adb-device-lab.acceptance.spec.ts
```

## Acceptance

The operator must configure the raw project, device, target, parameter, and node inputs locally. Generated operation evidence is intentionally compact and redacted; it should show shape, presence, status, and equality proof rather than publishing raw node paths, identifiers, or values.

Read-only generated evidence must show:

- configured project, device, target, parameter, and node inputs as present or shape summaries,
- successful ADB target detection,
- successful node read,
- request or audit correlation as redacted shape summaries when available,
- browser screenshot, `test-results/acceptance/operation-evidence/...json`, and `playwright-report/acceptance/index.html` locations.

Write-mode generated evidence must additionally show:

- previous, requested, and readback value shapes,
- snapshot presence,
- rollback result,
- final restoration equality without recording raw values.

## Safety Notes

- Do not run write mode against customer hardware or unapproved nodes.
- Do not directly write nodes with `adb shell`; the test must use WiseEff APIs so lease, snapshot, readback, rollback, and audit rules apply.
- Use existing enabled ADB parameter bindings only; this lab must not create or mutate parameter bindings.
- `unauthorized`, `offline`, missing, or duplicate ADB targets block the run.
- Local ADB evidence supplements HDC and target-environment evidence. It does not replace full-pilot HDC signoff.
