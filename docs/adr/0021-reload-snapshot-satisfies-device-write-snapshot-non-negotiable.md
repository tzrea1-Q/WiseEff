# ADR-0021: Reload snapshot satisfies the device-write snapshot non-negotiable

- Status: Accepted
- Date: 2026-08-10

## Context

`docs/SECURITY.md` lists snapshot as a non-negotiable for device writes. Node debugging satisfies that with `debugging_snapshots`: capture the previous node value so rollback can write it back. DTS reload debugging has no device-tree value read-back and no unload/clear entry point, so that undoable snapshot model does not apply. Leaving the requirement silently unmet would contradict the security document.

## Decision

For the reload write path, a **reload snapshot** satisfies the snapshot non-negotiable. It records: each parameter's library baseline value, the deployed artifact digest verified against the on-device copy (with the integrity-check strength actually achieved), and any kernel-side signal obtained later. It deliberately makes no claim about effective device-tree values. The existing `debugging_snapshots` table is **not** reused.

## Consequences

- SECURITY.md (and its Chinese companion) must state this form explicitly in the same change that ships deploy.
- Restore-baseline (#288) is a compensating overlay re-deploy from library baselines, not a snapshot rollback write-back.
- Audit and run DTOs carry `reloadSnapshot` JSON on `dts_reload_runs`, shaped to accept kernel signal from #286 without a new table.
