# T2.2-AGT agent consumers — local implementation receipt

> Chinese: [中文](../../../zh-CN/exec-plans/active/849-inventory/t22-agt-agent-consumers-acceptance.md)

Status: **T2.2-AGT local candidate complete.** Design Spec PASS with P2; implementation Standards PASS; implementation Spec PASS (grok-4.6; requested gpt-5.6-luna unavailable). No SEALED, commit, PR, merge, Hosted, target, or Issue update.

Contract: [threat matrix](t22-agt-agent-consumers-threat-matrix.md), [design](t22-agt-agent-consumers-design.md), [design Spec review](t22-agt-agent-consumers-spec-review.md), [implementation review](t22-agt-agent-consumers-impl-review.md).

## Candidate

- Worktree: `/Users/tzrea1/Develop/WiseEff-worktrees/849-853-t11-source-identity`
- Branch: `codex/849-853-t11-source-identity`
- HEAD (unchanged): `f9c710f6a90d67462965a06abd47e33aa200e75e`
- T1.1–T2.2-FIL remain uncommitted. No commit.

## Behaviour delivered

1. `submitLegacyParameterChange` removed. `action.submitParameterChange` refuses non-semantic identity mode with `CONFLICT` `reason: "legacy-identity-mode-retired-for-agent"` (no `getProjectParameterForUpdate`, no flat `{ parameterId, targetValue }` submit).
2. Semantic path unchanged: durable invocation + approval, binding id, `createBindingDraft`, submit with `parameterSpecId` from the draft.
3. Perception / knowledge draft / tool metadata unchanged. No 410 of Agent tools. Xiaoze checkpointer/`orchestrator.ts` unedited.

## Classification (T22A-01)

S12-AGT **30** entries, **7** file×rule groups, 0 unexplained. Table: [t22-agt-agent-consumers-classification.md](t22-agt-agent-consumers-classification.md).

| Class | Count |
| --- | --- |
| canonical-current-agent-read | 0 |
| canonical-current-agent-draft | 2 |
| exact-canonical-history | 28 |
| archived-notice | 0 |

## Ratchet (T22A-10)

AGT 30→30, total 3513→3513, delta 0. `submitLegacyParameterChange` is gone. Honest zero: checker **did not complete** (`editService.ts` relocation blob from T2.2-TOP; fixtures not rewritten). Remaining production identifiers are draft `parameterSpecId`.

## Verification (do not sum)

Helper PG **55438** / `wiseeff_t22_cgh`. No UI sweep.

| Command | Result |
| --- | --- |
| `DATABASE_URL=postgres://wiseeff:wiseeff@127.0.0.1:55438/wiseeff_t22_cgh npm run test:server -- actionTools.test.ts toolRegistry.test.ts` | **14 passed** (8+6) |
| `npx tsc -b` | **passed** |
| `git diff --check` on AGT code files | **passed** |
| grep `submitLegacyParameterChange` in `*.ts` | **no matches** |
| boundary checker | **did not complete** (T2.2-TOP `editService.ts` blob) |
| browser 1440x900 | **not run** (no visible Xiaoze UI change) |

## Remaining limits

- Xiaoze unused `getProjectParameterForUpdate` mock left in-family-out (`xiaoze/**`).
- Checker blocked; AGT shard not ratcheted.
- Integration sql-write rows kept (not a zero-30 mandate).
- No T2.2-LOG, no commit.
