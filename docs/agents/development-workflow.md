# Development workflow

> Chinese: [Development workflow](../zh-CN/agents/development-workflow.md)

This is the default path for ordinary development. Existing explicitly accepted sealed programs, independent-review requirements, and release evidence contracts retain their gates. The PC-first viewport policy in `docs/developer/ui-quality-checklist.md` replaces the old repository-wide three-viewport default; it does not cancel specialized release acceptance.

## Select the evidence, not a ceremony

| Change | Working record and verification |
| --- | --- |
| Bounded documentation or mechanical change | Task/PR summary; relevant static and focused checks. No artificial failing test for prose. |
| Behavior, API, or UI change | State the acceptance cases; test the changed public seam and relevant failure cases; perform a focused review. |
| Authorization, tenancy, migration, concurrency, recovery, or destructive behavior | Explicit invariants and adversarial cases; independent review; real environment evidence where required. |
| A program explicitly requiring seals, lineage, fingerprints, or staged release approval | Existing `agent-delivery-protocol.md` and its accepted program profile. |

Risk-sensitive evidence is mandatory where relevant. A large orchestration state machine is not mandatory merely because a task edits more than one file. When an accepted plan specifies two independent reviews, keep both unless its owner explicitly amends that contract.

## Implementation loop

Establish the requested outcome, affected seam, current worktree ownership, and relevant acceptance criteria. For clear reversible choices, proceed with an explicit assumption instead of requesting approval for each step. Ask before material scope changes or irreversible effects.

Read the changed implementation and its closest tests, then only the supporting design sections needed to resolve uncertainty. Reproduce defects when practical. Add or update behavior tests; use red/green where it demonstrates the defect, not as a ritual for documentation, formatting, or generated files.

Run focused feedback while editing. Once the implementation is coherent, inspect the diff, check adjacent integration seams, and execute the required candidate gates. Do not repeatedly run broad suites after unchanged edits or rerun an unchanged failure without a hypothesis. An existing result can inform diagnosis; it does not become current candidate acceptance after the source or relevant environment changes.

An unavailable browser, database, external service, or independent reviewer blocks the evidence it owns, not unrelated safe implementation. Continue unaffected work, name the missing evidence, and do not claim readiness or merge through a required gate.

## Planning and recovery

Keep a durable plan for cross-session work, multi-team coordination, architecture changes, risky rollout, or when an accepted contract requires one. A short task summary is sufficient for other bounded work. Existing active plans retain their Documentation Impact Matrix, Documentation Update Gate, UI operation-coverage obligations, and bilingual companions.

A useful handoff contains: goal and scope; branch/base/head; owned paths and relevant dirty edits; decisions; exact commands/results with evidence locations; remaining blocker and next action. Keep raw logs local. Do not reconstruct a long transcript or record runtime token samples as a mandatory development gate. When measuring performance, keep unavailable usage as unknown.

## Delegation and integration

Delegate independent investigation, disjoint implementation, or a required review. Give each worker an outcome, owned paths, relevant contract, expected evidence, and stop boundary. The coordinator retains integration and external mutation authority. Do not create workers merely to fill slots, or launch dependent work during CI just to satisfy an activity metric.

For ordinary work, open one integration-ready PR when the user has authorized delivery. Fix findings on that PR; closing and reopening is not an ordinary repair mechanism. Accepted sealed programs keep their explicit PR/seal lifecycle. Do not bypass required checks or fabricate a reviewer when only one agent is available.

After a rebase, retest affected behavior and required identifiers/artifacts. Use `npm run typecheck` for relevant TypeScript changes, and retain the final build gate. Do not force unrelated worktrees to reset or pull; synchronize a designated clean main worktree only when authorized.

## Completion

Report changed behavior, actual checks and failures/skips, missing external evidence, and actual PR/merge status. No release, target-host, or production claim follows automatically from local or Hosted results.
