# Fleet coordination

> Chinese: [Fleet coordination](../zh-CN/agents/fleet-coordination.md)

Read this only when multiple sessions or worktrees can touch shared integration state. Accepted sealed programs also follow `agent-delivery-protocol.md`.

## Ownership and main-red repair

Before repairing an unrelated main failure, check existing Issues, open PRs, and claim comments for that failure. The coordinator records one bounded claim with owner, affected paths, and stop boundary. Prefer an existing Issue comment; create a claim artifact only when authorized. Implementation subagents do not open claim PRs. This removes the former conflict between an early draft-PR claim and the delivery protocol's PR-last rule.

Do not repair the same failure in several lanes. Continue disjoint work when its evidence is unaffected. Classify an unrelated failure with a focused reproduction or current-main comparison; do not repeatedly rerun the entire suite.

## Shared identifiers and source changes

Migration, ADR, and technical-debt identifiers are checked against current main immediately before integration. If renumbering is necessary, update all references and both language companions. Do not edit applied migrations to resolve a numbering collision.

After a rebase, run the affected checks; a conflict-free rebase is not behavioral evidence. Use the existing `npm run typecheck` for TypeScript changes and preserve required build/environment gates. Capture the original command's exit status; use `pipefail` or structured results instead of trusting a filter's exit status.

When stacking on an unmerged branch, record its exact tip. If it is rewritten, reconstruct the stack using the recorded old base, not a blind rebase that replays upstream commits. Preserve other sessions' worktrees and dirty edits.

## Catalog isolation

Wayfinder #668 launch PostgreSQL evidence keeps its dedicated lane database and role requirements. Use the existing `catalog:lane:env` and `catalog:lane:accept` commands from the verification matrix. Never substitute the shared compose application database or a bootstrap-superuser-only run. Zero collected tests fail the gate.

Coordinate shared resources explicitly; parallelize independent development and review, not conflicting migrations or writes to a shared acceptance database. Merge authority stays with the coordinator and the user's authorized boundary.
