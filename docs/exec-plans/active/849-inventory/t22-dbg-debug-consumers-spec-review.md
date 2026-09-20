# T2.2-DBG design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-dbg-debug-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-dbg-debug-consumers-design.md](t22-dbg-debug-consumers-design.md) and [t22-dbg-debug-consumers-threat-matrix.md](t22-dbg-debug-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-DBG completion in the review itself.

Review `01a0aff9-7f3a-7f81-ad64-4132a6d2e2e6` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Intercept is not the pin. Unbound snapshot is not kept as the list pin. Reload stays 410. Debug-node catalog stays 2xx. DTS promotion not stolen. Edits not pre-authorized.

## P2 (folded before implementation)

1. ZH: Client/mock + Jobs/scripts; FIL in non-steal; 1440x900 default-no-sweep.
2. Never `readProtectedReference` with `DBG_UNBOUND_SNAPSHOT` / `binding: null`. Stored binding → that binding; else typed-block `missing-binding`.
3. `listDebugParameters` must SELECT stored `project_parameter_binding_id` (not in `debugParameterColumns` today).

**Implementation may start** (P2s folded). Do not start T2.2-DTS. Do not mark T2.2-DBG complete from this review.
