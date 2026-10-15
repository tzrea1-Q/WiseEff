# Development workflow

> Chinese: [Development workflow](../zh-CN/agents/development-workflow.md)

This is the default path for all development outside the sealed scope named in `AGENTS.md` (Wayfinder #668 launch children #683–#735). That sealed scope, independent-review requirements, and release evidence contracts retain their gates. The PC-first viewport policy in `docs/developer/ui-quality-checklist.md` replaces the old repository-wide three-viewport default; it does not cancel specialized release acceptance.

## Select the evidence, not a ceremony

| Change | Working record and verification |
| --- | --- |
| Bounded documentation or mechanical change | Task/PR summary; relevant static and focused checks. No artificial failing test for prose. |
| Behavior, API, or UI change | State the acceptance cases; test the changed public seam and relevant failure cases; perform a focused review. |
| Authorization, tenancy, migration, concurrency, recovery, or destructive behavior | Explicit invariants and adversarial tests at the changed seam; one independent review of the PR diff; a real PostgreSQL test where the invariant lives in the database. |
| Wayfinder #668 launch children, or an Issue whose body explicitly requires seals, lineage, fingerprints, or staged release approval | Existing `agent-delivery-protocol.md` and its accepted program profile. |

Risk-sensitive evidence is mandatory where relevant. A large orchestration state machine is not mandatory merely because a task edits more than one file. When an accepted plan specifies two independent reviews, keep both unless its owner explicitly amends that contract.

## Implementation loop

Establish the requested outcome, affected seam, current worktree ownership, and relevant acceptance criteria. For clear reversible choices, proceed with an explicit assumption instead of requesting approval for each step. Ask before material scope changes or irreversible effects.

Read the changed implementation and its closest tests, then only the supporting design sections needed to resolve uncertainty. Reproduce defects when practical. Add or update behavior tests; use red/green where it demonstrates the defect, not as a ritual for documentation, formatting, or generated files.

Follow the [verification tiers](../developer/verification-matrix.md#verification-tiers): inner loop → pre-hand-off → PR CI → merge → nightly. Run `npm run test:impact -- <changed-files>` or `npm run test:impact -- --base <integration-base>` to select suites, static gates, quality routes and cross-route acceptance specs. Inspect both fallback flags; do not narrow a fallback to fit a budget. For authorized real API browser checks, use the selector's commands with isolated `WISEEFF_RUNTIME_LANE` IDs; quality coverage partitions use the separate `WISEEFF_QUALITY_LANE` setting.

Run focused feedback while editing. Once the implementation is coherent, inspect the diff, check adjacent integration seams, and execute the required candidate gates within the [agent verification budget](../developer/verification-matrix.md#agent-verification-budget). A coordinator-owned budget means one final related pass, changed-file ESLint and affected-project TypeScript checks, sequentially; hand selected extra suites, static gates, builds and browser evidence to the coordinator. Prose-only work selects docs validation, not artificial tests. Do not repeatedly run broad suites after unchanged edits or rerun an unchanged failure without a hypothesis. An existing result can inform diagnosis; it does not become current candidate acceptance after the source or relevant environment changes.

An unavailable browser, database, external service, or independent reviewer blocks the evidence it owns, not unrelated safe implementation. Continue unaffected work, name the missing evidence, and do not claim readiness or merge through a required gate.

## Planning and recovery

Keep a durable plan for cross-session work, multi-team coordination, architecture changes, risky rollout, or when an accepted contract requires one. A short task summary is sufficient for other bounded work. Existing active plans retain their Documentation Impact Matrix, Documentation Update Gate, UI operation-coverage obligations, and bilingual companions.

A useful handoff contains: goal and scope; branch/base/head; owned paths and relevant dirty edits; decisions; exact commands/results with evidence locations; remaining blocker and next action. Keep raw logs local. Do not reconstruct a long transcript or record runtime token samples as a mandatory development gate. When measuring performance, keep unavailable usage as unknown.

## Delegation and integration

Delegate independent investigation, disjoint implementation, or a required review. Give each worker an outcome, owned paths, relevant contract, expected evidence, and stop boundary. The coordinator retains integration and external mutation authority. Do not create workers merely to fill slots, or launch dependent work during CI just to satisfy an activity metric.

For ordinary work, open one integration-ready PR when the user has authorized delivery. Fix findings on that PR; closing and reopening is not an ordinary repair mechanism. Accepted sealed programs keep their explicit PR/seal lifecycle. Do not bypass required checks or fabricate a reviewer when only one agent is available.

### Draft-PR CI early signal

When PR creation and pushes are authorized, open the same PR as a draft early enough to receive integration feedback during implementation. After every push, the coordinator reads the CI run for that exact pushed head: check failed jobs and bounded logs immediately, fix integration failures before accumulating more work, and verify the final `Merge bar` result before marking the PR ready. A pending, cancelled, or older-head run is not current acceptance; draft status does not waive any gate.

CI runs on PR open, synchronize and reopen, and on adding or removing `full-acceptance`. Unrelated label edits skip the expensive jobs and use a separate concurrency group so they cannot cancel active or pending PR CI. Their lightweight result is named `Merge bar (ignored label)`, not the required `Merge bar`; it does not replace the real gate result. Acceptance-label transitions rerun selection against the current label list. Pushes to `main`, nightly runs and manual acceptance modes retain their existing coverage.

Every Chromium-installing job restores the browser cache by runner OS, architecture and installed Playwright version, then still installs Chromium with system dependencies on both cache hits and misses. For CI-hygiene changes, the coordinator records before/after setup timings in the PR: exact head/run/job, cache hit or miss, and durations for dependency installation, cache restore and browser/system-dependency installation. Compare like jobs and distinguish cold from warm runs; report unavailable measurements as missing, not as savings.

After a rebase, retest affected behavior and required identifiers/artifacts. Use `npm run typecheck` for relevant TypeScript changes, and retain the final build gate. Do not force unrelated worktrees to reset or pull; synchronize a designated clean main worktree only when authorized.

## Completion

In the existing PR description, keep three evidence-derived rows separate. Include the source head/tree, environment and actual commands/counts next to regression evidence; selector output alone has `testExecution: not-run`.

| State | Evidence that completes it | Missing or contrary evidence |
| --- | --- | --- |
| Effect approved | The human's explicit approval of the applicable rendered behavior, with its scope/version. Mark not applicable only when there is no visible change. | Pending approval stays pending; approval of an earlier UI does not approve a later change. |
| Affected regression complete | Every selected required check actually passed for the current source/environment; API/browser/PostgreSQL evidence retains its own scope. | List failed, unrun, cancelled or unavailable checks. A partial pass is partial, and stale evidence is historical. |
| Merge ready | The current pushed candidate's real `Merge bar`, all task-required checks/artifacts, and applicable independent review are complete; required effect approval is present. | Pending/failed/skipped-required checks, an older head, missing review or approval prevent readiness. |

For example, approved UI with a failed regression is **approved / failed / not ready**; passed affected checks with CI still running is **approval as observed / complete / pending**; a selected command with no execution is **approval as observed / not run / not ready**. These are PR reporting states, not a new approval service or acceptance granted by a diagnostic artifact.

When CI fails, use the exact run/attempt/shard compact link in the existing diagnostic-settlement summary, then follow the [bounded diagnostic navigation](../developer/verification-matrix.md#compact-failure-index-navigation). Record failure classification as **product regression**, **test/harness**, **environment/infrastructure**, **intended baseline change**, or **unknown**, with supporting evidence. A locator or category such as `TEST_FAILED` does not establish root cause. Shared-root-cause fixes include sibling callers before the next stable candidate. Visual replacements still require explicit approval for every image and normal Linux comparison.

Report changed behavior, actual checks and failures/skips, missing external evidence, and actual PR/merge status. No release, target-host, or production claim follows automatically from local or Hosted results.
