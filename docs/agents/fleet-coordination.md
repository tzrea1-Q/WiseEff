# Fleet Coordination

Rules for parallel agent sessions — many worktrees merging to `main` continuously. Each rule is derived from a real collision during the 2026-08-12→13 overnight run and names its incident.

This document handles cross-worktree collisions. For lane lifecycle, WIP limits, pre-seal review, CI scheduling, merge attestation, and stop boundaries, use the [Agent Delivery Execution Protocol](agent-delivery-protocol.md).

## Main-red repair: claim before you fix

When `main`'s CI is red:

1. Check for an existing claim before writing a fix: `gh pr list --state open --search "unbreak main"`, plus a scan of open PR titles and claim comments for the failing test's name.
2. If unclaimed, open your claim PR early — a draft titled `fix(test): unbreak main — <symptom>` is enough. The claim is the coordination artifact; the polished fix follows.
3. If already claimed, leave the repair to the claimant; rebase onto their branch or wait for their merge.

Incident: #364 carried both of the night's main-red fixes while #365 (ErrorBoundary clipboard mock) and #367 (semantic-cleanup schema gate) landed the same two fixes first; #364 had to be rewritten into a coverage-restore PR.

## Sequential numbers are claimed at merge time

ADR numbers, migration numbers, and TD numbers belong to whoever reaches `main` first — a number picked at branch time is a guess, not a reservation. Immediately before requesting merge:

1. `git fetch origin`, then re-check your number against `origin/main`: `ls docs/adr/`, `ls server/migrations/`, and the highest row ID in `docs/exec-plans/tech-debt-tracker.md` (both language twins).
2. If raced, renumber on your branch — including every cross-reference (index tables such as `docs/adr/README.md`, plan docs, tracker rows) — then re-check once more.

Incidents from one night: two ADR-0022s (knowledge retrieval renumbered to 0025 in merge `53444520`); migration `0102_knowledge_foundation.sql` renumbered to 0103 in the same merge; two different 0105 migrations reached `main` and were renumbered there (`1d18b50b`); a plan doc drafted "TD-083" while the tracker row it described landed as TD-084.

## After every rebase: typecheck and execute affected tests

A textually clean rebase still breaks when a parallel stream moved or renamed the symbols your change touches. After each rebase onto refreshed `main`:

1. Run the typecheck (`npx tsc -b`).
2. Execute the tests your change touches — run them for real; a conflict-free rebase proves nothing about semantics.
3. When piping test output through a filter, assert on the printed matches: `$?` after a pipe reports the last command in the pipe, not the test run.

Incidents: the 08-12→13 split program recorded eight semantic-drift catches after clean rebases; drift that reached `main` needed repair commits (`853e1cec` adopt parameterIdentityMode single seam after rebase; `d9c3e523` repair xiaoze-action retired-identity drift).

## Catalog launch lanes: dedicated PostgreSQL, never the compose app database

Wayfinder catalog nodes (#668 launch Issues) must not point `DATABASE_URL` / `TEST_DATABASE_URL` at the default compose app database `postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff`. That instance is `postgres:16-alpine`, is shared across worktrees, lacks pgvector, and previously turned `globalSetup` crashes into “No test files found.” Provision `wiseeff_lane_<issue>` on the dedicated pgvector server with `npm run catalog:lane:env -- provision --issue <n>`, and pass the Issue-named command through `npm run catalog:lane:accept` before opening the Hosted PR. RBAC/migration evidence must run as `catalog_migration_owner`, not only as the bootstrap superuser.

Incident: Goal 6753b193 spent Hosted cycles on `42501` DEFINER grants and dirty shared databases that local superuser runs did not reproduce. See [Catalog Launch Operating Rules](catalog-launch-operating-rules.md).

## Stacked branches: record the base tip

When building on another session's unmerged branch:

1. Record the base branch's tip SHA at the moment you branch off it.
2. When the base is rewritten (rebased or squash-merged), rebuild with `git rebase --onto <new-base-tip> <old-recorded-tip>`; a plain `git rebase <base>` would replay the base's rewritten commits into your branch.
