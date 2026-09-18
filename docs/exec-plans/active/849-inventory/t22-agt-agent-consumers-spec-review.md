# T2.2-AGT design Spec review

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-agt-agent-consumers-spec-review.md)

Model: grok-4.6 (requested gpt-5.6-luna unavailable)
Verdict: **PASS with P2**

Independent Spec review of [t22-agt-agent-consumers-design.md](t22-agt-agent-consumers-design.md) and [t22-agt-agent-consumers-threat-matrix.md](t22-agt-agent-consumers-threat-matrix.md). Reviewer did not write the design. No production edits, commit, or T2.2-AGT completion in the review itself.

Review `01a0afc7-92e3-7393-af5a-442594f0cc6c` **PASS with P2**. P2s folded into the design/matrix before production edits.

## P1

None open. Design deletes `submitLegacyParameterChange`; does not steal xiaoze/orchestrator; does not 410 Agent tools; does not drop draft `parameterSpecId`; does not pre-authorize edits.

## P2 (folded before implementation)

1. Leftover `submitLegacyParameterChange` after repair is a Spec fail even if delta ≠ 0. Honest zero only when the function is gone and the checker is blocked.
2. ZH twins: do not invent a spec id; E2E keeps binding id; honest-zero-if-blocked.
3. Retarget TD-079 only in `actionTools.test.ts`. Do not zero 14 integration sql-write rows. Do not edit xiaoze unused `getProjectParameterForUpdate` mocks.

**Implementation may start** (P2s folded). Do not start T2.2-LOG. Do not mark T2.2-AGT complete from this review.
