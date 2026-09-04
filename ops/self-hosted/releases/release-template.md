# WiseEff Self-Hosted Release Evidence

> Chinese: [Chinese](release-template.zh-CN.md)

## Candidate

| Field | Value |
| --- | --- |
| Release label |  |
| Branch |  |
| Commit SHA |  |
| Dirty worktree | true / false |
| Target environment |  |
| Target host |  |
| Artifact reference |  |
| Environment fingerprint |  |
| Maintenance window |  |
| Approval owner |  |
| HDC status | unavailable / skipped by scope / enabled with evidence |

## Migration Set

- 

## Pre-Release Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run docs:check` |  |  |
| `npm run contract:check` |  |  |
| `npm run test:all` |  |  |
| `npm run build` |  |  |
| `npm run acceptance:coverage` |  |  |
| `npm run acceptance:operations` |  |  |
| `npm run acceptance:evidence` |  |  |
| `npm run selfhost:check` |  |  |
| `git diff --check` |  |  |

## Target Evidence

| Evidence | Result | Location |
| --- | --- | --- |
| Backup before release |  |  |
| Restore rehearsal |  |  |
| Queue pause/drain/resume |  |  |
| Deployment smoke |  |  |
| Target synthetic acceptance |  |  |
| Capacity gate |  |  |
| Observability watch |  |  |
| Rollback rehearsal |  |  |
| HDC device lab |  |  |

## Capacity Summary

| Metric | Observed | Threshold |
| --- | --- | --- |
| p95 latency |  |  |
| error rate |  |  |
| throughput |  |  |
| CPU |  |  |
| memory |  |  |
| database connections |  |  |
| queue backlog |  |  |
| object-store probe |  |  |

## Catalog apply

| Mode | Result | Evidence |
| --- | --- | --- |
| fresh zero-mode (empty inventory, P11a; not populated P0-P10) |  |  |
| populated full-mode through P0-P10 + P11a |  |  |

P11a reports gate statuses; isolation remains; P12-P16 are not executed.
WISEEFF_CATALOG_QUIESCED=true is operator attestation, not P2 proof.

## Go / No-Go

Outcome: Go / No-Go

Blockers:

- 

Pending evidence:

- 

Notes:

-
