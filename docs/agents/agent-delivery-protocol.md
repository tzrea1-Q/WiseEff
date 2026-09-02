# Agent Delivery Execution Protocol

> Chinese: [Chinese](../zh-CN/agents/agent-delivery-protocol.md)

This protocol governs goal-driven delivery by a parent coordinator and one or more implementation and review agents. It complements [fleet coordination](fleet-coordination.md): fleet coordination handles collisions between worktrees, while this document controls when work is designed, reviewed, sealed, sent to CI, merged, and unlocked.

## Authority and invariants

Apply rules in this order:

1. Safety, security, destructive-action, and human-approval boundaries.
2. The accepted Issue, ADR, implementation specification, and exact evidence contract.
3. This delivery protocol.
4. The run profile recorded by the active program.

A lower layer cannot waive a higher layer. A conflict is a stop condition that the parent records before asking for a decision. Evidence levels remain distinct: documentation/static, local pure/fake, real local PostgreSQL, browser-real, Hosted/CI, target-host, release, and production approval never imply one another.

## Leading concepts

- **Scratch**: a mutable implementation worktree or branch with no open PR. It is where Red -> Green and review-driven iteration happen.
- **Threat matrix**: the finite set of success, failure, concurrency, lineage, rollback, and forgery cases that define a high-risk invariant before it is sealed.
- **Seal**: the first candidate whose bytes, lineage, generated artifacts, and fingerprints are intended to remain unchanged through integration.
- **Delivery candidate**: the exact commit offered for final independent review and Hosted execution.
- **Lane**: one node plus its worktree, agent, owned paths, evidence, and merge position.
- **Frontier**: ready nodes whose native blockers, body-only gates, attestations, and labels are all satisfied.

The optimization target is **one seal, one final review round, one Hosted run**. It is a budget, not permission to skip required evidence.

## Risk classes

The parent classifies every node before dispatch. When classes overlap, use the highest class.

| Class | Typical change | Required design treatment |
| --- | --- | --- |
| R1 — bounded | Documentation, generated metadata, mechanical adapters, isolated tests | Exact paths, focused test, bounded review |
| R2 — behavioral | Domain logic, public API, UI workflow, persistence adapter | State/contract cases, focused tests at the production seam, independent Standards and Spec review |
| R3 — sealed | Security, authorization, migration, concurrency, recovery, destructive action, provenance, checksums, release gates | Threat matrix before implementation, adversarial Red cases, independent Standards and Spec review before sealing, environment-specific evidence |
| Temporal | Compatibility windows, telemetry windows, multi-release retirement, production approval | Implementation may finish; the program stays open until real elapsed-time and release evidence exist |

R3 classification applies to a small risky seam, not automatically to an entire program. Split broad work so ordinary consumers do not inherit sealed-process cost.

## State machine

Each lane has exactly one current state. A parent status report names it explicitly.

| State | Entry condition | Completion criterion |
| --- | --- | --- |
| `PREFLIGHT` | User scope and stop boundary are known | Goal state, exact `origin/main`, clean worktree, Issue readiness, blockers, paths, and run profile recorded |
| `THREAT-READY` | An R3 node has completed preflight | Every threat-matrix row defines its expected observation and has an executable Red case or an explicit non-executable evidence owner |
| `SCRATCH` | R1/R2 preflight is complete, or an R3 node is `THREAT-READY` | Reproducer is red and implementation is locally green on focused checks |
| `PRESEAL-REVIEW` | Scratch candidate is locally green | All parallel review findings are collected into one disposition |
| `SEALED` | Pre-seal findings are closed | Exact candidate, base, paths, lineage, fingerprints, and evidence commands are frozen |
| `INTEGRATION-READY` | Earlier merge positions are known | Candidate is refreshed on current main; sequential identifiers and affected focused checks pass |
| `HOSTED` | Final PR is open on the exact candidate | Required jobs finish on that SHA; skipped jobs are recorded as skipped |
| `MERGED` | Reviews and Hosted gates pass | GitHub reports the exact merge SHA and the feature branch is deleted when policy requires it |
| `ATTESTED` | Merge is visible on `origin/main` | Downstream CF slots, evidence boundary, Issue state, and local main synchronization are verified |
| `CLOSED` | Attestation is complete | Frontier is recomputed; only separately authorized ready-label mutations occur |

Any byte-changing finding before `SEALED` returns the lane to `SCRATCH`. Any byte-changing finding after `SEALED` invalidates the seal, reviews, fingerprints, and Hosted evidence; the lane returns to `SCRATCH`, not directly to another final CI run.

## Step 1 — Preflight the goal and capacity

Before dispatch, the parent records:

- the user-authorized outcome and stop boundary;
- whether the durable Goal is active, paused, complete, or blocked;
- exact `origin/main`, Issue IDs, native dependencies, CF/ID/RE gates, and current frontier;
- available agent slots, development WIP, review capacity, and deterministic merge order;
- the evidence levels required by each lane;
- the deadline lower bound.

A user-authorized bounded round may proceed while a durable Goal is paused, but the parent must report that it is not an automatically resumable Goal. It must not create a duplicate Goal to disguise the state.

Compute deadline feasibility before promising it. The lower bound includes the critical path, non-overlappable review, final Hosted duration, target/release windows, and integration refreshes. Temporal programs are reported separately from code-complete nodes. When the requested deadline is below the lower bound, offer a smaller code/evidence milestone instead of silently accepting an impossible completion promise.

### Required control records

The parent keeps one compact durable record for the wave and one for each lane. Repository plans or Issue comments are preferred when the state must outlive the session; ephemeral coordination may use the current task state.

```text
Wave: goal, accepted-main, stop-boundary, deadline-lower-bound,
      lanes-in-merge-order, shared-resources, development-WIP,
      review-slots, next-Hosted-lane
Lane: node, issue, risk, state, base, head, editable/read-only/forbidden paths,
      threat-matrix, focused/local/PG/browser/Hosted/target/release gates,
      repair-cycles, fingerprint-count, PR/CI state, blocker, next-transition
Seal: base, head, tree/path-set, lineage, generated hashes, fingerprint,
      completed reviews, evidence commands/results, explicit skips
```

Agents report only state transitions, blockers, and final structured evidence. They do not stream routine narration or paste successful full logs. The parent waits on task/CI events with a cursor or bounded event wait and does not poll unchanged state. A failure report includes the command, exit status, smallest useful excerpt, classification, and next owner.

## Step 2 — Plan a wave before starting lanes

The parent selects a bounded wave and freezes:

1. lane membership and risk class;
2. exact editable, read-only, generated, and forbidden paths;
3. shared resources such as migration numbers, generated schema, fixtures, and UI registries;
4. merge order;
5. which lane is allowed to open the next PR and run Hosted;
6. the post-merge refresh required by every later lane.

Reserve capacity for integration and review. Foundation and R3 work defaults to development WIP 2. When an R2/R3 lane enters pre-seal review, completed implementation agents release their slots so Standards and Spec review can run in parallel. Independent R1/R2 leaf work may use more lanes only when path ownership is disjoint, review capacity remains available, and the program run profile permits it.

The next merge lane may reach `HOSTED`; later lanes stop at `PRESEAL-REVIEW` or `SEALED`. This prevents a green CI run from becoming stale immediately after an earlier lane merges.

## Step 3 — Develop in Scratch

Implementation agents receive a bounded task packet containing:

- exact Issue and accepted base;
- risk class and threat-matrix requirement;
- allowed/read-only/forbidden paths;
- public seam and Red -> Green statement;
- required focused commands and evidence levels;
- branch/worktree, model/reasoning profile, and stop boundary;
- an explicit ban on PR creation, main mutation, unrelated repair, and downstream dispatch.

Scratch branches may be pushed for durable backup, but they have no open PR. The implementation loop runs only the narrowest real check that can turn the current Red case green. Typecheck, build, real PostgreSQL, or browser-real checks are added when the changed seam requires them; broad suites are not used as an inner loop.

An unrelated failure is classified with one isolated rerun or a current-main comparison. The lane records it and continues only when its own focused evidence is unaffected. It does not repair unrelated main-red work without a separate claim.

## Step 4 — Freeze the threat matrix before sealing R3

For R3, a Spec reviewer challenges the invariant before production implementation begins. The matrix covers every applicable dimension:

- initial state and owner/scope combinations;
- success, duplicate, retry, lost response, and idempotent replay;
- partial failure, rollback, cleanup failure, and recovery;
- concurrent, stale, reordered, and multi-parent histories;
- missing, malformed, ambiguous, forged, and cross-boundary inputs;
- fresh, populated, upgrade, downgrade/restore, and zero-data modes;
- direct, shallow, Hosted merge, and later full-history execution when Git lineage is trusted evidence.

Each row names the observable result and the evidence owner. Executable cases begin red in Scratch. A checksum, lock, migration, or release report is not created until this matrix is complete. Counterexamples discovered here become permanent tests before the final fingerprint exists.

## Step 5 — Pre-seal review and circuit breaker

For R2/R3, Standards and Spec reviews run in parallel against the same Scratch SHA. R1 uses one bounded combined review unless its accepted contract requires more. Prompts contain the exact base/head, accepted contract, path policy, fixed checklist, permitted commands, and evidence boundary. Reviewers return `PASS` or a numbered list of actionable findings with severity, invariant, path/line, reproducer or proof, and minimum correction. They do not perform adjacent research, but any concrete counterexample to a stated invariant remains in scope.

The parent waits for every required review and sends one consolidated, deduplicated repair packet. It never reacts to the first R2/R3 reviewer while the second is still running.

Circuit breakers:

- A second P1/P0 repair cycle on the same invariant stops patching and returns to threat-matrix design.
- More than two fingerprints or lock generations before Hosted means the candidate was sealed too early; rebuild the delivery candidate from the reviewed Scratch bytes.
- A review that cannot name its current check or conclusion within the run budget is narrowed or stopped; it does not expand the test plan silently.
- A flaky broad-suite failure is not rerun as a full suite repeatedly. Isolate once, classify, and preserve the output.

## Step 6 — Seal once

Ordinary R1/R2 work seals the reviewed commit. R3 provenance/checksum work uses two layers:

1. Iterate freely on a Scratch branch with no PR and no final fingerprint.
2. After the threat matrix and pre-seal reviews pass, materialize the approved bytes on a clean delivery branch in the exact required commit topology, generate the fingerprint once, and add the external lock once.

The seal record contains base SHA, candidate SHA, tree/path set, file modes where relevant, generated-artifact hashes, contract fingerprint, focused results, review results, and known skipped evidence. Any change to a sealed byte or lineage creates a new seal record and consumes the exceptional rework budget.

## Step 7 — Refresh in merge order

Immediately before PR creation, fetch current `origin/main` and apply the repository's integration method. Recheck migration/ADR/TD numbers and generated artifacts. Run typecheck and affected tests after the refresh. Migration/schema lanes regenerate schema documentation and rerun focused real-PostgreSQL checks in the environment that owns that evidence.

If another lane must merge first, do not run final Hosted yet. A conflict-free refresh is not evidence, but a broad local suite is not automatically required either: rerun the affected seam plus every explicit node gate not delegated to exact-candidate Hosted by the accepted run profile.

## Step 8 — Open the PR last

The parent opens a PR only when the lane is `INTEGRATION-READY` and final reviews are green. The PR body records exact candidate/base, Issue, risk class, focused and environment-specific evidence, skipped/not-run evidence, and the intended Hosted jobs.

Target one PR creation, zero synchronize events, and one Hosted run. One synchronize event and a second Hosted run are exceptional and allowed only for a failure observable exclusively in Hosted or for a mandatory post-main-refresh candidate. If a new push supersedes an in-progress run, cancel the obsolete run immediately. Code/spec failures return to Scratch; keep the PR closed while repairing, then reopen on the new reviewed seal.

CI annotations are triaged by changed path and reproducer. Existing or unrelated warnings are reported, not repaired inside the lane. A skipped job is never described as passing.

## Step 9 — Merge, attest, and advance

The parent alone merges. After merge it verifies:

- PR state and merge SHA;
- `origin/main` and the dedicated clean local main worktree;
- remote feature-branch disposition;
- exact Issue state and labels;
- required downstream CF attestation slots;
- unchanged unrelated worktrees;
- the recomputed frontier.

Closing a producer does not authorize starting a consumer. Ready-label mutations and new dispatch are separate frontier transitions. A user stop boundary is applied as follows:

- **Stop now**: make no further external mutation; report the safe current state.
- **Stop after current merge**: finish only the already approved PR, attestation, Issue closure, branch cleanup, and main synchronization. Do not refresh another PR, mutate the frontier, or dispatch work.
- **Stop after wave**: finish only lanes already named in the frozen wave; do not add newly unlocked nodes.

## Verification scheduling

| Moment | Run |
| --- | --- |
| Every implementation edit | Narrow Red/Green focused check only |
| Scratch locally green | Affected typecheck/build plus required PG/browser/environment seam |
| Pre-seal | Fixed adversarial matrix and review-focused checks |
| Integration refresh | Affected focused checks and identifier/generated-artifact checks |
| Exact delivery candidate | Each explicitly required local evidence level once |
| Open PR | One exact-candidate Hosted run |
| Target/release | Only the real target/release procedure; never inferred from local or Hosted |

An Issue-specific command remains mandatory unless an accepted amendment explicitly remaps it. A run profile may avoid duplicate execution only when it names the exact Hosted job that runs the same command or a proven superset and does not mislabel Hosted evidence as local evidence. Never run `test:all` twice on the same tree merely to create two logs.

## Run metrics and round report

The parent tracks, when observable:

- nodes merged, sealed, in review, and blocked;
- active development, review wait, CI wait, and integration wait;
- repair cycles and P0/P1/P2 findings by discovery stage;
- fingerprints generated;
- CI runs started/cancelled/failed/passed and runner-minutes;
- focused, full, PG, browser, Hosted, target, and release evidence separately;
- token use only when the runtime reports it for the bounded unit.

Do not invent missing token or timing telemetry. A round ends with the next frontier and the largest avoidable delay. Throughput is evaluated by merged nodes and reusable sealed candidates, not commit count or test count.

## Default budgets

These budgets trigger redesign; they are not permission to lower quality:

- development WIP: 2 for foundation/R3;
- open final PRs: 1 program-wide unless the accepted run profile identifies independent merge waves;
- final Hosted runs: 1, exceptionally 2 for Hosted-only failure or mandatory refresh;
- P0/P1 repair cycles on one invariant: 2 before threat-matrix redesign;
- final fingerprint generations: 1, exceptionally 2;
- unrelated full-suite reruns: 0;
- downstream dispatch after a user stop boundary: 0.

Programs may override a budget only in their accepted run profile, with the cost and reason recorded before dispatch.
