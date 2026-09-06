# Populated self-hosted upgrade compatibility

> Chinese: [Chinese](../../zh-CN/exec-plans/active/2026-09-06-populated-upgrade.md)

## Scope and state

Current state: SCRATCH, incomplete. See the [execution evidence](../../../ops/self-hosted/populated-upgrade-evidence.md) for refreshed base/candidate, passing checks and unresolved boundary/release blockers. The following paragraph records the initial preflight.

PREFLIGHT, R3. Source deployment stays `82344044b436a8dafecefbb85dfd724cecb05e3f`; development base is freshly fetched `origin/main@1c9fa56e3eaca6e7984f35a097876772a6e4025d` (no difference from the supplied main). Source counts and image identity are supplied historical observations, not rerun evidence. The local clean isolated worktree uses `codex/populated-upgrade-scratch`. No production access is authorized. Stop at a reviewed candidate/PR; do not merge, close historical issues, approve release, or operate production.

## Ownership and dependencies

| Package | Owner / paths | Dependencies / success |
| --- | --- | --- |
| A | Parent: this bilingual plan, final evidence and operator guide | Freeze threats before production edits; independent Spec challenge |
| B | Parent: reconcile CLI/tests, upgrade.sh/upgrade-lib.sh and tests, new handoff helper | Real old invocation fails closed; diagnostic queries cannot authorize release |
| C | Parent: release-verification integration and controller adapters | B, approved role/recovery contracts; unavailable frozen phases remain blocked |
| D | Identity/recovery lane, initially read-only: runtime roots, database roles | Explicit parent handoff before edits; real restricted login proof |
| E | Identity/recovery lane, initially read-only: storage/recovery | Isolated three-store evidence, never target proof |
| F | Build lane: build-network-specific helpers/tests | Existing policy; synthetic trust evidence separate from corporate CA |
| G | Parent: isolated rehearsal, documentation, delivery archive | A-F; authentic backup and production approval are external dependencies |

Single writers: parent owns upgrade shell, Compose, runtime integration, migrations, generated docs and proof fingerprints. Other worktrees and inherited bytes are preserved. Development WIP 2 for shared schema; path-disjoint build work may proceed. Final Standards and Spec reviews run against one candidate. One final Hosted batch after integration readiness, no speculative broad reruns.

## Threat matrix

| Threat | Required observation / evidence owner |
| --- | --- |
| Missing args, absent/unapproved/blocked report; unknown CLI option | Nonzero typed refusal at real CLI, parent B |
| Old source controller invokes new check | Actual source command cannot resume traffic on diagnostic success, parent B |
| Cross candidate/target/release/mapping/source, stale purpose/attempt | Existing verifier rejects exact-input mismatch; no Bash verifier, parent B/C |
| Pre-activation used for runtime/public release; forged approvals | Refusal at each action; distinct approval records, parent C |
| apply/resume/recover-candidate/no-op bypass | All reachable release paths gated; old-service recovery distinct, parent B |
| Missing/ordered phases, concurrent controller, unknown commit | Journal/lock refusal; no reset/guess, parent C |
| Fresh with any old inventory; partial migration/checksum drift | Refuse false fresh; immutable historical SQL; retry evidence, parent G |
| Runtime superuser/role inheritance/DEFINER escalation | Real limited logins and business/negative PG proof, D |
| Wrong DB/host/Compose/volume/bucket/Redis or partial restore | Keep isolated; explicit bound recovery, E |
| Candidate write/queue/public traffic followed by pointer rollback | Persistent refusal, E |
| Untrusted/expired/wrong TLS chain; insecure readiness | Reject; trusted synthetic chain succeeds; no secret leakage, F |
| Lost values/history/protected references or unknown Policy count | Full classification/consumer oracle, no count equivalence, G |
| Lane pgvector assumed equivalent to source postgres:16-alpine | Separate extension compatibility evidence, G |

## Test levels and stop points

Red then focused Green at CLI/controller seams; real subprocess exit codes; real PostgreSQL migration/role tests; isolated Docker/Compose ordering; synthetic populated oracle; build/contract/boundary/selfhost/docs checks. Browser changes require playwright-cli desktop/tablet/mobile. Each run records exact SHA/tree, command, exit and collected/passed/failed/skipped separately. Setup failure is not zero-test success. A synthetic rehearsal, B authorized backup rehearsal and C production execution remain separate.

External blockers: no authorized real backup, enterprise CA, or production maintenance authorization supplied. #815 still needs authoritative Policy association or approved unavailable contract. Frozen unavailable release phases are an integration blocker, not permission to forge implementation or approvals. Continue independent work while these remain blocked.

## Documentation Impact Matrix

| Change | English | Chinese | Gate |
| --- | --- | --- | --- |
| Scope/threats/evidence | This plan | Companion plan | docs:check |
| Upgrade/diagnostic/handoff contract | ops/self-hosted/upgrade.md | ops/self-hosted/upgrade.zh-CN.md | CLI tests + docs:check |
| Operator procedure | New populated-upgrade runbook | Chinese terminal procedure | Only tested real commands; unavailable steps explicit |
| Build trust | Existing build-network documentation as needed | Matching companion | Trust tests |

## Documentation Update Gate

Update both language files in the same change; generators own generated artifacts. Run `npm run docs:check` before plan completion. This plan remains active until its independent deliverables and limitations are recorded; no production readiness inferred from code completion.
