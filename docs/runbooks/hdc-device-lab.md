# HDC Device Lab Runbook

Use this runbook to collect real-device evidence for the HDC gateway path.

## Required Inputs

- `DEBUG_DEVICE_GATEWAY_MODE=hdc`
- `HDC_DEVICE_LAB_AVAILABLE=true`
- `HDC_SMOKE_PROJECT_ID`
- `HDC_SMOKE_DEVICE_ID`
- `HDC_SMOKE_TARGET_REF`
- `HDC_SMOKE_PARAMETER_ID`
- `HDC_SMOKE_NODE_PATH`
- `HDC_SMOKE_WRITE_VALUE`
- optional `HDC_SMOKE_EXPECT_READ_PATTERN`
- optional `HDC_SMOKE_USER_ID`

## Procedure

1. Confirm the device is in the approved lab environment.
2. Confirm the target node is safe to read and write.
3. Start the API with HDC gateway mode.
4. Run the debugging E2E smoke that includes the HDC device-lab case.
5. Verify target detection.
6. Verify node read.
7. Verify node write with readback.
8. Verify snapshot rollback.
9. Record timeout/offline behavior if the lab procedure allows safe simulation.
10. Record stderr/nonzero failure normalization if the lab procedure allows safe simulation.

## Acceptance

Evidence must show:

- command timestamps,
- target and node identifiers,
- requested value,
- previous/readback value,
- rollback value,
- audit event id or request id,
- failure cases tested or explicitly skipped.

Simulator evidence is useful for local development, but it is not HDC signoff.
