# T2.2-TOP design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-top-topology-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-top-topology-consumers-design.md](t22-top-topology-consumers-design.md) and [t22-top-topology-consumers-threat-matrix.md](t22-top-topology-consumers-threat-matrix.md). Reviewer did not write the design. Chinese twins: 410 vs keep parity. P2s folded before production edits.

## P1

None. Implementation may start.

## P2 (folded)

1. Topology-client PATCH/deprecate/restore/reattribute/cutover remain **canonical-current-dts-spec until T1.4**, not archived-notice. Port signatures kept.
2. Client GONE: no POST-or-map fork; never parse a 201 spec body.
3. Mock activate tests seed without `createParameterSpec`.

## Checked

Value vs enablement specified on `createBindingDraft` after load; mint GONE is client/mock only; CGH routes untouched; binding tuple not rekeyed; T2.1 fixture unchurned; shard 783 / 3513.

**Implementation may start** (P2s folded). Do not start T2.2-PRJ.
